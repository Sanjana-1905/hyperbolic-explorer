// main3d.js - 3D Poincaré ball viewer (Phase 2). The default mode.
//
// What happens here (the same plan as the 2D viewer, one dimension up):
//   1. Load the tree JSON and lay it out once (layout3d.js). Each node keeps a
//      FIXED home position `node.pos` inside the ball.
//   2. To show the tree focused on some point f, we draw every node at
//      (-f) ⊕ pos. That is the Möbius move that brings f to the centre.
//   3. Clicking a node animates f along the geodesic from the old focus to the
//      new one (0.5 s, ease-in-out). Backspace focuses the parent.
//   4. Nodes are drawn smaller the further they are from the centre, using the
//      Poincaré size factor (1 − r²)/2.
// The camera orbits the centre of the ball (where the focus node sits), so you
// can look at the tree from every side. Plain spheres and lines for now; the
// "data galaxy" look is Phase 3.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { vec3, vNeg, vLength, mobiusAdd3, geodesicLerp3, conformalFactor3 } from './mobius3d.js';
import { buildTree, computeLayout3d, nodePath } from './layout3d.js';
import { createFpsCounter } from './fps.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const ANIM_SECONDS = 0.5;       // refocus animation length
const FOLDER_RADIUS = 0.16;     // hyperbolic radius of a folder sphere
const FILE_RADIUS = 0.06;       // hyperbolic radius of a file sphere
const MIN_WORLD_RADIUS = 0.003; // never draw a sphere smaller than this (keeps far nodes visible)
const CLICK_TOLERANCE_PX = 8;   // how far from a sphere a click still hits it
const EDGE_SEGMENTS = 8;        // line pieces per curved edge
const STRAIGHT_EDGE = 0.03;     // edges shorter than this are drawn straight (curve too small to see)
const COLORS = {
  folder: new THREE.Color('#4cc9f0'),
  file: new THREE.Color('#8d99ae'),
  focus: new THREE.Color('#ffb703'),
  parent: new THREE.Color('#fb8500'),
  edge: new THREE.Color('#3d5a80'),
  shell: new THREE.Color('#1d2a44'),
};

document.getElementById('help').textContent =
  'Drag to look around · scroll to move in/out · click a node to focus it · Backspace = parent · F = fps';
const fps = createFpsCounter();

// ---------------------------------------------------------------------------
// three.js scene: a perspective camera orbiting the centre of the unit ball
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x05060a);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// 70° vertical field of view. From 1.8 units away the whole ball (radius 1)
// fits: it spans asin(1 / 1.8) ≈ 34° either side of the centre, under 35°.
const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 20);
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

// Simple lighting so the spheres look round: a soft light everywhere plus a
// light attached to the camera (so the side you look at is always lit).
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const headLight = new THREE.DirectionalLight(0xffffff, 1.8);
headLight.position.set(0.5, 1, 1);
camera.add(headLight);

// The surface of the ball (the "edge of the universe"), drawn as a faint
// transparent shell. BackSide means we see its inside, so it never hides nodes.
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(1, 48, 32),
  new THREE.MeshBasicMaterial({
    color: COLORS.shell, transparent: true, opacity: 0.35,
    side: THREE.BackSide, depthWrite: false,
  }),
));

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
let dirty = true;               // recompute positions on the next frame?

let shown = [];                 // per node: transformed position {x, y, z}
let shownRadius = null;         // per node: drawn sphere radius (world units)

let nodeMesh = null;            // one InstancedMesh holding every sphere (1 draw call)
let edgeLines = null;           // one LineSegments holding every edge (1 draw call)
let edgePositions = null;

// ---------------------------------------------------------------------------
// Building the drawables
// ---------------------------------------------------------------------------
function buildDrawables() {
  const n = nodes.length;
  shownRadius = new Float32Array(n);

  // A low-poly sphere (80 triangles) is plenty at these sizes.
  nodeMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshLambertMaterial(),
    n,
  );
  nodeMesh.frustumCulled = false; // instances move every frame; skip the bounds check
  scene.add(nodeMesh);

  // Worst case every edge needs EDGE_SEGMENTS pieces, 2 vertices each, 3 floats each.
  edgePositions = new Float32Array((n - 1) * EDGE_SEGMENTS * 2 * 3);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3).setUsage(THREE.DynamicDrawUsage));
  edgeLines = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({
    color: COLORS.edge, transparent: true, opacity: 0.6,
  }));
  edgeLines.frustumCulled = false;
  scene.add(edgeLines);

  updateColors();
}

// Colours depend only on which node is focused, so refresh them on refocus.
function updateColors() {
  for (const node of nodes) {
    let color = node.type === 'folder' ? COLORS.folder : COLORS.file;
    if (node === focusNode) color = COLORS.focus;
    else if (focusNode && node === focusNode.parent) color = COLORS.parent;
    nodeMesh.setColorAt(node.id, color);
  }
  nodeMesh.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Updating geometry for the current focus point (runs when `dirty`)
// ---------------------------------------------------------------------------
function updateGeometry() {
  // The Möbius move that puts the focus point at the centre is "add -f".
  const shift = vNeg(focusPoint);

  // 1. Move every node and work out how big to draw it.
  const m = nodeMesh.instanceMatrix.array;
  for (const node of nodes) {
    const p = mobiusAdd3(shift, node.pos);
    shown[node.id] = p;

    // A hyperbolic ball of radius ρ drawn at point p looks like a Euclidean
    // ball of radius about ρ · (1 − r²)/2  (conformalFactor3), so nodes shrink
    // smoothly toward the surface. Example: a folder (ρ = 0.16) at r = 0.9 is
    // drawn with radius 0.16 · 0.095 = 0.015, vs 0.08 at the centre.
    const rho = node.type === 'folder' ? FOLDER_RADIUS : FILE_RADIUS;
    const size = Math.max(rho * conformalFactor3(p), MIN_WORLD_RADIUS);
    shownRadius[node.id] = size;

    // Write the 4x4 matrix by hand: uniform scale `size`, then move to p.
    // (three.js stores matrices column by column; the last column is the move.)
    const o = node.id * 16;
    m[o] = size; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = size; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = size; m[o + 11] = 0;
    m[o + 12] = p.x; m[o + 13] = p.y; m[o + 14] = p.z; m[o + 15] = 1;
  }
  nodeMesh.instanceMatrix.needsUpdate = true;

  // 2. Edges: a geodesic arc from each parent to its child, as a short
  // polyline. A Möbius move sends geodesics to geodesics, so we can build the
  // arc between the MOVED endpoints directly.
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
  updateColors();
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
  stepAnimation(now);
  if (dirty) {
    updateGeometry();
    dirty = false;
  }
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
  // Shown radius of a node's position (0 = at the centre of the ball).
  shownR: (id) => vLength(shown[id]),
  // Screen (CSS pixel) position of a node's centre, or null if behind the camera.
  screenPos: (id) => projectNode(id, renderer.domElement.getBoundingClientRect()),
};
