// main3d.js - 3D Poincaré ball viewer, "galaxy" look (Phase 3). The default mode.
//
// What happens here (the same plan as the 2D viewer, one dimension up):
//   1. Load the tree JSON and lay it out once (layout3d.js). Each node keeps a
//      FIXED home position `node.pos` inside the ball.
//   2. To show the tree focused on some point f, every node is drawn at
//      (-f) ⊕ pos (the Möbius move that brings f to the centre). Since Phase 3a
//      this happens on the GPU: f is the `_Focus` uniform and the vertex shader
//      (glsl.js) does the move for all nodes at once. The CPU copy of the same
//      maths (mobius3d.js) is still used for picking and the edges.
//   3. Clicking a node animates f along the geodesic from the old focus to the
//      new one (0.5 s, ease-in-out). Backspace focuses the parent.
//   4. Nodes are camera-facing quads ("impostors") drawn with additive blending:
//      folders look like glowing stars, files like faint twinkling points. Each
//      top-level folder is an "arm" with its own hue.
// The camera orbits the centre of the ball (where the focus node sits).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { vec3, vNeg, vLength, mobiusAdd3, geodesicLerp3, conformalFactor3 } from './mobius3d.js';
import { buildTree, computeLayout3d, nodePath } from './layout3d.js';
import { createFpsCounter } from './fps.js';
import {
  NODE_VERT, NODE_FRAG, NEBULA_VERT, NEBULA_FRAG, SHELL_VERT, SHELL_FRAG,
} from './glsl.js';
import { gpuCheck } from './gpucheck.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const ANIM_SECONDS = 0.5;       // refocus animation length
const CLICK_TOLERANCE_PX = 8;   // how far from a node a click still hits it
const EDGE_SEGMENTS = 8;        // line pieces per curved edge (edges move to the GPU in Phase 3b)
const STRAIGHT_EDGE = 0.03;     // edges shorter than this are drawn straight (curve too small to see)

// Node sizes, in hyperbolic units (same meaning as in Phase 2). They are injected
// into the shader as #defines, and the CPU picking code reads the same numbers.
const SIZE = {
  FOLDER_R: 0.075,    // folder core radius (before the energy factor 0.6..1.5)
  FILE_R: 0.02,       // file core radius
  FOCUS_BOOST: 1.7,   // the focus "sun" is this much bigger
  MIN_R: 0.0025,      // never draw a core smaller than this (keeps far nodes visible)
  GLOW_SCALE: 3.0,    // quad is this many times the core radius (room for the glow)
  CHILD_HALO: 5.0,    // halo quad size for children of the focus (x core radius)
  FOCUS_HALO: 9.0,    // halo quad size for the focus
};

// ?quality=low trades looks for speed on weak GPUs.
const LOW = new URLSearchParams(location.search).get('quality') === 'low';
const QUALITY = {
  maxHalos: LOW ? 16 : 64,     // halo quads (focus + this many children - 1)
  octaves: LOW ? 2 : 5,        // nebula noise layers
  starLayers: LOW ? 1 : 2,     // starfield layers
  pixelRatio: LOW ? 1 : 2,     // cap on render resolution (device pixels per CSS pixel)
  dustCount: LOW ? 200 : 450,  // drifting dust particles (added in Phase 3b)
};
const EDGE_COLOR = 0x3a4a9a;

document.getElementById('help').textContent =
  'Drag to look around · scroll to move in/out · click a node to focus it · Backspace = parent · F = fps';
const fps = createFpsCounter();

// ---------------------------------------------------------------------------
// three.js scene: a perspective camera orbiting the centre of the unit ball
// ---------------------------------------------------------------------------
// No MSAA: nodes are soft additive glows (no hard edges to smooth), and MSAA is expensive on phones.
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.pixelRatio));
renderer.setClearColor(0x03040c); // deep navy-black
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// 70° vertical field of view. From 1.8 units away the whole ball (radius 1)
// fits: it spans asin(1 / 1.8) ≈ 34° either side of the centre, under 35°.
const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 40);
camera.position.set(0, 0.3, 1.8);
scene.add(camera);

// OrbitControls: drag rotates the camera around the target (the ball's centre),
// scroll moves it closer or further. Panning is off so the focus node always
// stays at the middle of the screen.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enablePan = false;
controls.enableDamping = true;   // smooth glide after letting go
controls.minDistance = 0.15;     // can go inside the ball, close to the focus
controls.maxDistance = 4;

// Shared by every shader: the time in seconds (breathing, twinkling, drifting clouds).
const uTime = { value: 0 };

// Procedural nebula + stars: one big inward-facing sphere that follows the
// camera (so it behaves like the sky: no parallax), drawn first, ignoring depth.
const nebula = new THREE.Mesh(
  new THREE.SphereGeometry(20, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: { uTime },
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    defines: { OCTAVES: QUALITY.octaves, STAR_LAYERS: QUALITY.starLayers },
    side: THREE.BackSide, depthTest: false, depthWrite: false,
  }),
);
nebula.renderOrder = -10;
nebula.frustumCulled = false;
scene.add(nebula);

// The surface of the ball: only a faint rim glow (no solid disc).
const shell = new THREE.Mesh(
  new THREE.SphereGeometry(1, 64, 48),
  new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
    transparent: true, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  }),
);
shell.renderOrder = -5;
scene.add(shell);

let pixelsPerUnitAt1 = 1; // screen pixels per world unit at distance 1 from the camera

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // At distance D from the camera the screen is 2·D·tan(fov/2) units tall.
  pixelsPerUnitAt1 = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let nodes = [];
let root = null;
let focusNode = null;
let focusPoint = vec3(0, 0, 0); // the ball point currently shown at the centre
let anim = null;                // { from, to, start } while animating
let dirty = true;               // recompute the CPU copy (picking, edges) on the next frame?

let shown = [];                 // per node: transformed position {x, y, z} (CPU copy, for picking/edges)
let shownRadius = null;         // per node: drawn core radius (world units), for picking

let nodeMesh = null;            // ONE instanced quad mesh holding every node (1 draw call)
let haloMesh = null;            // a few additive glow quads behind the focus and its children (1 draw call)
let edgeLines = null;           // one LineSegments holding every edge (1 draw call)
let edgePositions = null;

// The two shader uniforms that change on refocus. _Focus is the whole GPU refocus.
const focusUniforms = { _Focus: { value: new THREE.Vector3() }, uFocusId: { value: -1 }, uTime };

// ---------------------------------------------------------------------------
// Arm colours and energy (the "data hooks": Phase 6 only has to change these numbers)
// ---------------------------------------------------------------------------
// Every child of the root starts an "arm" with its own hue, spread evenly around
// the colour wheel; everything inside the arm inherits that hue. Energy is
// log(subtree size) / log(whole tree size): 0 for a lone file, 1 for the root.
// Example with 5,000 nodes: a folder of 100 nodes -> ln100/ln5000 = 0.54.
function assignVisuals() {
  const logTotal = Math.log(root.weight);
  const armCount = root.children.length;
  const GOLD = 0.11;
  root.hue = GOLD;
  root.children.forEach((arm, i) => paintArm(arm, i / armCount));
  for (const node of nodes) {
    node.energy = node.type === 'folder' ? Math.log(node.weight) / logTotal : 0.05;
    node.flag = 0; // reserved for status markers
  }
}
function paintArm(node, hue) {
  node.hue = hue;
  for (const child of node.children) paintArm(child, hue);
}

// ---------------------------------------------------------------------------
// Building the drawables
// ---------------------------------------------------------------------------

// The instanced geometry: one quad (4 corners) plus per-instance attributes.
// `capacity` instances at most; the real number drawn is set with instanceCount.
function makeQuadGeometry(capacity) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); // unused, but three.js wants one
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const add = (name, itemSize) => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
    g.setAttribute(name, attr);
    return attr.array;
  };
  g.arrays = {
    aPos: add('aPos', 3), aHue: add('aHue', 1), aEnergy: add('aEnergy', 1),
    aFlag: add('aFlag', 1), aKind: add('aKind', 1), aSeed: add('aSeed', 1), aId: add('aId', 1),
  };
  g.instanceCount = capacity;
  return g;
}

// Write node `node` into instance slot `slot` of a quad geometry.
function writeInstance(g, slot, node) {
  const a = g.arrays;
  a.aPos[slot * 3] = node.pos.x; a.aPos[slot * 3 + 1] = node.pos.y; a.aPos[slot * 3 + 2] = node.pos.z;
  a.aHue[slot] = node.hue;
  a.aEnergy[slot] = node.energy;
  a.aFlag[slot] = node.flag;
  a.aKind[slot] = node.type === 'folder' ? 1 : 0;
  a.aSeed[slot] = node.seed;
  a.aId[slot] = node.id;
}

// GLSL is strict: "3" is an int but we need the float "3.0" (otherwise mix(5, 9, t) fails to compile).
function floatDefines(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = Number.isInteger(v) ? v.toFixed(1) : String(v);
  return out;
}

function makeNodeMaterial(isHalo) {
  return new THREE.ShaderMaterial({
    uniforms: focusUniforms,
    vertexShader: NODE_VERT,
    fragmentShader: NODE_FRAG,
    defines: { ...floatDefines(SIZE), CORE: (1 / SIZE.GLOW_SCALE).toFixed(5), ...(isHalo ? { HALO: 1 } : {}) },
    transparent: true,
    blending: THREE.AdditiveBlending, // overlapping glows ADD, they never cover each other
    depthTest: false, depthWrite: false,
  });
}

function buildDrawables() {
  const n = nodes.length;
  shownRadius = new Float32Array(n);

  // A fixed random number per node (the same every run, so screenshots are repeatable).
  let seed = 2024;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const node of nodes) node.seed = rand();

  assignVisuals();

  const geom = makeQuadGeometry(n);
  for (const node of nodes) writeInstance(geom, node.id, node);
  nodeMesh = new THREE.Mesh(geom, makeNodeMaterial(false));
  nodeMesh.frustumCulled = false; // positions are computed in the shader, so CPU bounds are meaningless
  nodeMesh.renderOrder = 1;
  scene.add(nodeMesh);

  haloMesh = new THREE.Mesh(makeQuadGeometry(QUALITY.maxHalos), makeNodeMaterial(true));
  haloMesh.frustumCulled = false;
  haloMesh.renderOrder = 0;
  scene.add(haloMesh);

  // Worst case every edge needs EDGE_SEGMENTS pieces, 2 vertices each, 3 floats each.
  edgePositions = new Float32Array((n - 1) * EDGE_SEGMENTS * 2 * 3);
  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3).setUsage(THREE.DynamicDrawUsage));
  edgeLines = new THREE.LineSegments(edgeGeom, new THREE.LineBasicMaterial({
    color: EDGE_COLOR, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthTest: false,
  }));
  edgeLines.frustumCulled = false;
  edgeLines.renderOrder = 0;
  scene.add(edgeLines);
}

// Halos go behind the focus and its heaviest children (fake bloom, no post-processing).
function updateHalos() {
  const list = [focusNode, ...[...focusNode.children].sort((x, y) => y.weight - x.weight)]
    .slice(0, QUALITY.maxHalos);
  list.forEach((node, slot) => writeInstance(haloMesh.geometry, slot, node));
  haloMesh.geometry.instanceCount = list.length;
  for (const name of Object.keys(haloMesh.geometry.arrays)) haloMesh.geometry.attributes[name].needsUpdate = true;
}

// The core radius a node is drawn with: the same formula as the vertex shader
// (without the tiny breathing wobble). Used to know how big a click target is.
// Example: folder, energy 0.5, at |p| = 0 -> 0.075 * 1.05 * 0.5 = 0.039.
function coreRadius(node, p) {
  let rho = node.type === 'folder' ? SIZE.FOLDER_R * (0.6 + 0.9 * node.energy) : SIZE.FILE_R;
  if (node === focusNode) rho *= SIZE.FOCUS_BOOST;
  return Math.max(rho * conformalFactor3(p), SIZE.MIN_R);
}

// ---------------------------------------------------------------------------
// CPU copy of the transform (runs when `dirty`): positions for picking + edges.
// The GPU already draws the nodes by itself; this is only what the CPU needs.
// ---------------------------------------------------------------------------
function updateGeometry() {
  // The Möbius move that puts the focus point at the centre is "add -f".
  const shift = vNeg(focusPoint);

  for (const node of nodes) {
    const p = mobiusAdd3(shift, node.pos);
    shown[node.id] = p;
    shownRadius[node.id] = coreRadius(node, p);
  }

  // Edges: a geodesic arc from each parent to its child, as a short
  // polyline. A Möbius move sends geodesics to geodesics, so we can build the
  // arc between the MOVED endpoints directly. (Phase 3b moves this to the GPU.)
  let v = 0; // number of floats written
  for (const node of nodes) {
    if (!node.parent) continue;
    const a = shown[node.parent.id], b = shown[node.id];
    const chord = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (chord < STRAIGHT_EDGE) {
      v = pushSegment(v, a, b);
      continue;
    }
    let prev = a;
    for (let i = 1; i <= EDGE_SEGMENTS; i++) {
      const next = i === EDGE_SEGMENTS ? b : geodesicLerp3(a, b, i / EDGE_SEGMENTS);
      v = pushSegment(v, prev, next);
      prev = next;
    }
  }
  edgeLines.geometry.setDrawRange(0, v / 3);
  edgeLines.geometry.attributes.position.needsUpdate = true;
}

// Append one line segment (two 3D vertices) to the edge buffer.
function pushSegment(v, a, b) {
  edgePositions[v++] = a.x; edgePositions[v++] = a.y; edgePositions[v++] = a.z;
  edgePositions[v++] = b.x; edgePositions[v++] = b.y; edgePositions[v++] = b.z;
  return v;
}

// ---------------------------------------------------------------------------
// Focusing
// ---------------------------------------------------------------------------

// Ease-in-out: slow start, fast middle, slow end. smoothstep(t) = 3t² − 2t³.
// Example: t = 0.25 -> 0.156, t = 0.5 -> 0.5, t = 0.75 -> 0.844.
function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

// Start moving the view so that `node` ends up at the centre.
function focusOn(node, animate = true) {
  if (!node) return;
  focusNode = node;
  focusUniforms.uFocusId.value = node.id;
  updateHalos();
  updateInfo();
  if (animate) {
    // If a previous animation is still running, start from where the view is now.
    anim = { from: focusPoint, to: node.pos, start: performance.now() };
  } else {
    focusPoint = node.pos;
    anim = null;
  }
  dirty = true;
}

function stepAnimation(now) {
  if (!anim) return;
  const t = Math.min((now - anim.start) / (ANIM_SECONDS * 1000), 1);
  // Slide the focus point along the geodesic between the old and new focus.
  focusPoint = geodesicLerp3(anim.from, anim.to, easeInOut(t));
  if (t >= 1) {
    focusPoint = anim.to; // land exactly on the target (no rounding drift)
    anim = null;
  }
  dirty = true;
}

// ---------------------------------------------------------------------------
// Text overlay
// ---------------------------------------------------------------------------
const infoName = document.querySelector('#info .name');
const infoPath = document.querySelector('#info .path');

function updateInfo() {
  const n = focusNode;
  infoName.textContent = n.name + (n.type === 'folder' ? '/' : '');
  const extra = n.type === 'folder'
    ? `  ·  ${n.children.length} items, ${n.weight - 1} nodes inside`
    : '';
  infoPath.textContent = nodePath(n) + extra;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// Project a node to the screen. Returns CSS-pixel position, the sphere's
// radius in pixels, and its depth (distance in front of the camera), or null
// if the node is behind the camera (possible when the camera is inside the ball).
const tmp = new THREE.Vector3();
function projectNode(id, rect) {
  const p = shown[id];
  tmp.set(p.x, p.y, p.z).applyMatrix4(camera.matrixWorldInverse);
  const depth = -tmp.z; // the camera looks down its own −z axis
  if (depth <= camera.near) return null;
  tmp.applyMatrix4(camera.projectionMatrix); // -> normalised screen coords (−1..1)
  return {
    x: rect.left + ((tmp.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - tmp.y) / 2) * rect.height,
    // Perspective: something of size s at distance D covers s · (pixels per unit at 1) / D pixels.
    r: (shownRadius[id] * pixelsPerUnitAt1) / depth,
    depth,
  };
}

// Find the node under a mouse/touch position.
//  - If the pointer is inside one or more drawn spheres, take the one nearest
//    the camera (the one you can actually see in front).
//  - Otherwise take the node within CLICK_TOLERANCE_PX whose distance,
//    relative to its size, is smallest, so tiny far-away nodes are still clickable.
function pickNode(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  let inside = null, insideDepth = Infinity;
  let near = null, nearScore = Infinity;
  for (const node of nodes) {
    const s = projectNode(node.id, rect);
    if (!s) continue;
    const d = Math.hypot(s.x - clientX, s.y - clientY);
    if (d <= s.r) {
      if (s.depth < insideDepth) { insideDepth = s.depth; inside = node; }
      continue;
    }
    const reach = s.r + CLICK_TOLERANCE_PX;
    if (d <= reach && d / reach < nearScore) { nearScore = d / reach; near = node; }
  }
  return inside || near;
}

// Tell a click apart from a drag (a drag rotates the view instead).
let downX = 0, downY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
  const hit = pickNode(e.clientX, e.clientY);
  if (hit && hit !== focusNode) focusOn(hit);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace') {
    e.preventDefault(); // stop the browser from navigating "back"
    if (focusNode && focusNode.parent) focusOn(focusNode.parent);
  }
});

window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Main loop and startup
// ---------------------------------------------------------------------------
function frame(now) {
  fps.tick(now);
  controls.update(); // applies the damping glide
  uTime.value = now / 1000;
  stepAnimation(now);
  if (dirty) {
    focusUniforms._Focus.value.set(focusPoint.x, focusPoint.y, focusPoint.z); // the whole GPU refocus
    updateGeometry();                                                          // CPU copy for picking + edges
    dirty = false;
  }
  nebula.position.copy(camera.position); // the sky follows the camera, so it never shows parallax
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

async function start() {
  // ?tree=name.json loads public/data/name.json instead of the sample.
  const file = new URLSearchParams(location.search).get('tree') || 'sample_tree.json';
  const url = `${import.meta.env.BASE_URL}data/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);

  const tree = buildTree(await response.json());
  root = tree.root;
  nodes = tree.nodes;
  computeLayout3d(root);

  buildDrawables();
  resize();
  focusOn(root, false);
  requestAnimationFrame(frame);
}

start().catch((err) => {
  infoName.textContent = 'Error';
  infoPath.textContent = String(err);
  console.error(err);
});

// Handy for debugging in the browser console and for automated tests.
window.__explorer = {
  get nodes() { return nodes; },
  focusOn,
  focusId: () => focusNode.id,
  get fps() { return fps.value; },
  get animating() { return anim !== null; },
  get drawCalls() { return renderer.info.render.calls; },
  get triangles() { return renderer.info.render.triangles; },
  quality: LOW ? 'low' : 'high',
  // Compare the GPU's Möbius maths with the CPU's (see gpucheck.js).
  gpuCheck: () => gpuCheck(renderer),
  // Where the GPU says it drew a node, read back from the uniform + CPU formula.
  get focusPoint() { return focusPoint; },
  // Shown radius of a node's position (0 = at the centre of the ball).
  shownR: (id) => vLength(shown[id]),
  // Screen (CSS pixel) position of a node's centre, or null if behind the camera.
  screenPos: (id) => projectNode(id, renderer.domElement.getBoundingClientRect()),
};
