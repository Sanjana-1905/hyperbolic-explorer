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
  NODE_VERT, NODE_FRAG, NEBULA_VERT, NEBULA_FRAG, HAZE_VERT, HAZE_FRAG,
  SUN_VERT, SUN_FRAG, EDGE_VERT, EDGE_FRAG, DUST_VERT, DUST_FRAG,
} from './glsl.js';
import { gpuCheck } from './gpucheck.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const ANIM_SECONDS = 0.5;       // refocus animation length
const CLICK_TOLERANCE_PX = 8;   // how far from a node a click still hits it
const EDGE_WIDTH_PX = 1.8;      // base edge width in CSS pixels (the shader varies it 0.55x..1.45x with fog)

// Node sizes, in hyperbolic units (same meaning as in Phase 2). They are injected
// into the shader as #defines, and the CPU picking code reads the same numbers.
const SIZE = {
  FOLDER_R: 0.04,     // smallest folder core radius; folders scale x1..x3 with log(subtree size)
  FILE_R: 0.02,       // file core radius
  FOCUS_R: 0.11,      // the focus sun's core radius (fixed, bigger than any folder)
  HERO_AT: 0.9,       // folders with seed >= this are "hero" stars (~10 %)
  HERO_SIZE: 1.25,    // hero stars are this much bigger (and twice as bright)
  MIN_R: 0.0025,      // never draw a core smaller than this (keeps far nodes visible)
  GLOW_SCALE: 3.0,    // quad is this many times the core radius (room for the glow)
  CHILD_HALO: 5.0,    // halo quad size for children of the focus (x core radius)
  FOCUS_HALO: 9.0,    // (halo quad size for the focus; the sun billboard now does this job)
  SUN_SCALE: 14.0,    // the sun billboard is this many core radii wide (corona + rays)
  HAZE_R: 1.0,        // the haze billboard fades to 0 at this world radius (= the ball's boundary)
};

// ?quality=low trades looks for speed on weak GPUs.
const LOW = new URLSearchParams(location.search).get('quality') === 'low';
const QUALITY = {
  maxHalos: LOW ? 16 : 64,     // halo quads (focus + this many children - 1)
  octaves: LOW ? 2 : 5,        // nebula noise layers
  starLayers: LOW ? 1 : 2,     // starfield layers
  pixelRatio: LOW ? 1 : 2,     // cap on render resolution (device pixels per CSS pixel)
  dustCount: LOW ? 200 : 450,  // faint background specks inside the ball
  edgeSegments: LOW ? 6 : 10,  // pieces per curved edge
};

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

// No visible shell. Instead a very faint haze behind everything that fades smoothly
// to nothing at the ball's boundary, so the galaxy dissolves into space.
const haze = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    vertexShader: HAZE_VERT, fragmentShader: HAZE_FRAG,
    defines: floatDefines({ HAZE_R: SIZE.HAZE_R }),
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }),
);
haze.renderOrder = -5;
haze.frustumCulled = false;
scene.add(haze);

let pixelsPerUnitAt1 = 1; // screen pixels per world unit at distance 1 from the camera

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  edgeUniforms.uResolution.value.copy(buf);
  edgeUniforms.uLineWidth.value = EDGE_WIDTH_PX * renderer.getPixelRatio();
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
let dirty = true;               // focus point changed: upload the _Focus uniform on the next frame

let shown = [];                 // per node: transformed position {x, y, z} (CPU copy, ONLY for picking)
let shownStale = true;          // is `shown` out of date? (it is rebuilt lazily when a pick needs it)
let shownRadius = null;         // per node: drawn core radius (world units), for picking

let nodeMesh = null;            // ONE instanced quad mesh holding every node (1 draw call)
let haloMesh = null;            // a few additive glow quads behind the focus and its children (1 draw call)
let edgeMesh = null;            // every edge as an instanced thick-line strip (1 draw call)
let sunMesh = null;             // the focus sun billboard (1 draw call)
let dustMesh = null;            // faint background specks (1 draw call)

// The two shader uniforms that change on refocus. _Focus is the whole GPU refocus.
const focusUniforms = { _Focus: { value: new THREE.Vector3() }, uFocusId: { value: -1 }, uTime };
const edgeUniforms = { _Focus: focusUniforms._Focus, uResolution: { value: new THREE.Vector2(1, 1) }, uLineWidth: { value: 1.8 } };
const sunUniforms = { _Focus: focusUniforms._Focus, uFocusPos: { value: new THREE.Vector3() }, uTime };

// ---------------------------------------------------------------------------
// Arm colours and energy (the "data hooks": Phase 6 only has to change these numbers)
// ---------------------------------------------------------------------------
// Every child of the root starts an "arm". Arm hues are spread evenly over a narrow,
// cinematic range of the colour wheel: 0.47 (teal) -> 0.62 (indigo) -> 0.75 (violet) -> 0.87
// (magenta); no greens, no reds. 3 arms: 0.47, 0.67, 0.87; 5 arms: 0.47, 0.57, 0.67, 0.77, 0.87.
// Everything inside an arm inherits its hue.
// Energy drives size and brightness: for a folder it is the log of its subtree size rescaled
// to 0..1 across all folders (smallest folder 0, biggest 1), so the shader's size factor
// 1 + 2*energy makes the biggest folder 3x the smallest. Example: sizes 2, 20 and 200 nodes:
// ln = 0.69, 3.0, 5.3 -> energy 0, 0.5, 1. Files get a small constant.
const HUE_FIRST = 0.47, HUE_LAST = 0.87;
function assignVisuals() {
  root.hue = 0.6;
  // Only FOLDER arms share out the hue range (a loose file in the root is not an arm and
  // gets violet). Example: 3 folder arms -> teal 0.47, indigo 0.67, magenta 0.87.
  const arms = root.children.filter((c) => c.type === 'folder');
  root.children.forEach((c) => { if (c.type !== 'folder') paintArm(c, 0.77); });
  arms.forEach((arm, i) => {
    paintArm(arm, arms.length > 1 ? HUE_FIRST + ((HUE_LAST - HUE_FIRST) * i) / (arms.length - 1) : HUE_FIRST);
  });
  const folders = nodes.filter((n) => n.type === 'folder' && n !== root);
  const lo = Math.log(Math.min(...folders.map((n) => n.weight)));
  const hi = Math.log(Math.max(...folders.map((n) => n.weight)));
  for (const node of nodes) {
    if (node === root) node.energy = 1;
    else if (node.type === 'folder') node.energy = hi > lo ? (Math.log(node.weight) - lo) / (hi - lo) : 0.5;
    else node.energy = 0.05;
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
function makeQuadGeometry(capacity, only = null) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); // unused, but three.js wants one
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const add = (name, itemSize) => {
    if (only && !only.includes(name)) return null;
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

  // Edges: ONE instance per parent->child edge; the vertex shader builds the curve (glsl.js).
  const SEG = QUALITY.edgeSegments;
  const eg = new THREE.InstancedBufferGeometry();
  const verts = (SEG + 1) * 2;                       // a pair (left, right) at each of SEG+1 stops
  const aT = new Float32Array(verts), aSide = new Float32Array(verts);
  for (let i = 0; i <= SEG; i++) {
    aT[2 * i] = aT[2 * i + 1] = i / SEG;
    aSide[2 * i] = -1; aSide[2 * i + 1] = 1;
  }
  const idx = [];
  for (let i = 0; i < SEG; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  eg.setIndex(idx);
  eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3)); // unused, three.js wants one
  eg.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  eg.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  const edgeNodes = nodes.filter((nd) => nd.parent);
  const ea = (name, size) => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(edgeNodes.length * size), size);
    eg.setAttribute(name, attr);
    return attr.array;
  };
  const eA = ea('aA', 3), eB = ea('aB', 3), eHue = ea('aHue', 1), eEnergy = ea('aEnergy', 1), eSeed = ea('aSeed', 1);
  edgeNodes.forEach((nd, i) => {
    eA.set([nd.parent.pos.x, nd.parent.pos.y, nd.parent.pos.z], i * 3);
    eB.set([nd.pos.x, nd.pos.y, nd.pos.z], i * 3);
    eHue[i] = nd.hue; eEnergy[i] = nd.energy; eSeed[i] = nd.seed;
  });
  eg.instanceCount = edgeNodes.length;
  edgeMesh = new THREE.Mesh(eg, new THREE.ShaderMaterial({
    uniforms: edgeUniforms, vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    side: THREE.DoubleSide, // the strip's facing flips with the screen direction
  }));
  edgeMesh.frustumCulled = false;
  edgeMesh.renderOrder = 0;
  scene.add(edgeMesh);

  // Dust: faint specks at random fixed places in the ball. Density falls toward the
  // boundary (radius = 0.95 * sqrt(u)), so there are more in the middle where the gaps are.
  const dg = makeQuadGeometry(QUALITY.dustCount, ['aPos', 'aSeed']);
  for (let i = 0; i < QUALITY.dustCount; i++) {
    let x, y, z, len;
    do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; len = Math.hypot(x, y, z); } while (len > 1 || len < 1e-3);
    const r = 0.95 * Math.sqrt(rand());
    dg.arrays.aPos.set([(x / len) * r, (y / len) * r, (z / len) * r], i * 3);
    dg.arrays.aSeed[i] = rand();
  }
  dustMesh = new THREE.Mesh(dg, new THREE.ShaderMaterial({
    uniforms: focusUniforms, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
    defines: floatDefines({ MIN_R: SIZE.MIN_R }),
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }));
  dustMesh.frustumCulled = false;
  dustMesh.renderOrder = -1;
  scene.add(dustMesh);

  // The sun: one billboard at the focus, with core, gold glow, corona and rays.
  sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: sunUniforms, vertexShader: SUN_VERT, fragmentShader: SUN_FRAG,
    defines: floatDefines({ FOCUS_R: SIZE.FOCUS_R, MIN_R: SIZE.MIN_R, SUN_SCALE: SIZE.SUN_SCALE }),
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }));
  sunMesh.frustumCulled = false;
  sunMesh.renderOrder = 2;
  scene.add(sunMesh);
}

// Halos go behind the focus's heaviest children (the focus itself has the sun billboard) (fake bloom, no post-processing).
function updateHalos() {
  const list = [...focusNode.children].sort((x, y) => y.weight - x.weight).slice(0, QUALITY.maxHalos);
  list.forEach((node, slot) => writeInstance(haloMesh.geometry, slot, node));
  haloMesh.geometry.instanceCount = list.length;
  for (const name of Object.keys(haloMesh.geometry.arrays)) haloMesh.geometry.attributes[name].needsUpdate = true;
}

// The core radius a node is drawn with: the same formula as the vertex shader
// (without the tiny breathing wobble). Used to know how big a click target is.
// Example: folder, energy 0.5, not a hero, at |p| = 0 -> 0.04 * (1 + 2*0.5) * 0.5 = 0.04.
function coreRadius(node, p) {
  let rho;
  if (node === focusNode) rho = SIZE.FOCUS_R;
  else if (node.type === 'folder') {
    const hero = node.seed >= SIZE.HERO_AT ? SIZE.HERO_SIZE : 1;
    rho = SIZE.FOLDER_R * (1 + 2 * node.energy) * hero;
  } else rho = SIZE.FILE_R;
  return Math.max(rho * conformalFactor3(p), SIZE.MIN_R);
}

// ---------------------------------------------------------------------------
// CPU copy of the transform, used ONLY for picking (and debugging). The GPU draws
// everything by itself, so this runs lazily: only when someone clicks or asks where a
// node is, and only if the focus has moved since the last time.
function ensureShown() {
  if (!shownStale) return;
  const shift = vNeg(focusPoint); // the Möbius move that puts the focus point at the centre is "add -f"
  for (const node of nodes) {
    const p = mobiusAdd3(shift, node.pos);
    shown[node.id] = p;
    shownRadius[node.id] = coreRadius(node, p);
  }
  shownStale = false;
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
  sunUniforms.uFocusPos.value.set(node.pos.x, node.pos.y, node.pos.z);
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
  ensureShown();
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
  ensureShown();
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
    shownStale = true;                                                         // CPU copy is rebuilt only if a pick needs it
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
  shownR: (id) => { ensureShown(); return vLength(shown[id]); },
  // Screen (CSS pixel) position of a node's centre, or null if behind the camera.
  screenPos: (id) => projectNode(id, renderer.domElement.getBoundingClientRect()),
};
