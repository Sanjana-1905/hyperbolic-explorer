// main2d.js - 2D Poincaré disk viewer (Phase 1). Open with ?mode=2d.
// Kept unchanged as the baseline for the user study (only the help text and
// the fps counter were added in Phase 2).
//
// What happens here:
//   1. Load the tree JSON and lay it out once (layout.js). Each node keeps a
//      FIXED home position `node.z` on the disk.
//   2. To show the tree focused on some point f, we draw every node at
//      (-f) ⊕ z. That is the Möbius move that brings f to the centre.
//   3. Clicking a node animates f along the geodesic from the old focus to the
//      new one (0.5 s, ease-in-out). Backspace focuses the parent.

import * as THREE from 'three';
import { complex, cNeg, cAbs, mobiusAdd, geodesicLerp } from './mobius.js';
import { buildTree, computeLayout, nodePath } from './layout.js';
import { treeFileFromUrl } from './dataset.js';
import { createFpsCounter } from './fps.js';

document.getElementById('help').textContent =
  'Click a node to focus it · Backspace = go to parent · F = fps';
const fps = createFpsCounter();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const ANIM_SECONDS = 0.5;       // refocus animation length
const FOLDER_RADIUS = 0.16;     // hyperbolic radius of a folder circle
const FILE_RADIUS = 0.06;       // hyperbolic radius of a file circle
const MIN_PIXELS = 1.2;         // never draw a circle smaller than this radius
const CLICK_TOLERANCE_PX = 8;   // how far from a circle a click still hits it
const EDGE_SEGMENTS = 8;        // line pieces per curved edge
const COLORS = {
  folder: new THREE.Color('#4cc9f0'),
  file: new THREE.Color('#8d99ae'),
  focus: new THREE.Color('#ffb703'),
  parent: new THREE.Color('#fb8500'),
  edge: new THREE.Color('#2b3a55'),
  rim: new THREE.Color('#1d2a44'),
};

// ---------------------------------------------------------------------------
// three.js scene: an orthographic camera looking at the unit disk
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x05060a);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 5;

// The view always shows x and y from -VIEW to +VIEW on the shorter screen side,
// so the whole disk (radius 1) fits with a little margin.
const VIEW = 1.04;
let pixelsPerUnit = 1; // screen pixels per disk unit, updated on resize

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const aspect = w / h;
  if (aspect >= 1) {
    camera.left = -VIEW * aspect; camera.right = VIEW * aspect;
    camera.top = VIEW; camera.bottom = -VIEW;
  } else {
    camera.left = -VIEW; camera.right = VIEW;
    camera.top = VIEW / aspect; camera.bottom = -VIEW / aspect;
  }
  camera.updateProjectionMatrix();
  pixelsPerUnit = h / (camera.top - camera.bottom);
  dirty = true;
}

// The unit circle (the "edge of the universe"), drawn as a faint ring.
const rimPoints = [];
for (let i = 0; i <= 128; i++) {
  const a = (i / 128) * Math.PI * 2;
  rimPoints.push(new THREE.Vector3(Math.cos(a), Math.sin(a), -1));
}
scene.add(new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(rimPoints),
  new THREE.LineBasicMaterial({ color: COLORS.rim }),
));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let nodes = [];          // all nodes (from buildTree)
let root = null;
let focusNode = null;    // node we are focused on (or animating toward)
let focusPoint = complex(0, 0); // the disk point currently at the screen centre
let anim = null;         // { from, to, start } while animating
let dirty = true;        // redraw geometry on the next frame?

// Per-node results of the latest transform (filled by updateGeometry):
let screenX, screenY, screenR; // transformed position and drawn radius (disk units)

let nodeMesh = null;     // one InstancedMesh holding every circle (1 draw call)
let edgeLines = null;    // one LineSegments holding every edge (1 draw call)
let edgePositions = null;

// ---------------------------------------------------------------------------
// Building the drawables
// ---------------------------------------------------------------------------
function buildDrawables() {
  const n = nodes.length;
  screenX = new Float32Array(n);
  screenY = new Float32Array(n);
  screenR = new Float32Array(n);

  nodeMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial(),
    n,
  );
  nodeMesh.frustumCulled = false;
  scene.add(nodeMesh);

  // Worst case every edge needs EDGE_SEGMENTS pieces, 2 vertices each, 3 floats each.
  edgePositions = new Float32Array((n - 1) * EDGE_SEGMENTS * 2 * 3);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3).setUsage(THREE.DynamicDrawUsage));
  edgeLines = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: COLORS.edge }));
  edgeLines.frustumCulled = false;
  scene.add(edgeLines);

  updateColors();
}

// Colours depend only on which node is focused (focus orange, parent darker
// orange, otherwise folder/file colours), so we refresh them on refocus only.
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
  const shift = cNeg(focusPoint);
  const minRadius = MIN_PIXELS / pixelsPerUnit;

  // 1. Move every node and work out how big to draw it.
  const m = nodeMesh.instanceMatrix.array;
  for (const node of nodes) {
    const p = mobiusAdd(shift, node.z);
    const r = cAbs(p);

    // A hyperbolic circle of radius ρ drawn at Euclidean distance r from the
    // centre of the disk has Euclidean radius about ρ·(1 - r²)/2: the factor
    // (1 - r²) is the Poincaré disk's squeeze, so things shrink toward the rim.
    const rho = node.type === 'folder' ? FOLDER_RADIUS : FILE_RADIUS;
    const size = Math.max(rho * (1 - r * r) / 2, minRadius);

    screenX[node.id] = p.x;
    screenY[node.id] = p.y;
    screenR[node.id] = size;

    // Write the 4x4 matrix by hand: uniform scale `size`, translation (x, y, z).
    // z = -r puts circles nearer the centre in front of those near the rim.
    const o = node.id * 16;
    m[o] = size; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = size; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1; m[o + 11] = 0;
    m[o + 12] = p.x; m[o + 13] = p.y; m[o + 14] = -r * 0.5; m[o + 15] = 1;
  }
  nodeMesh.instanceMatrix.needsUpdate = true;

  // 2. Edges: a geodesic arc from each parent to its child, drawn as a short
  // polyline. Tiny edges are drawn straight (a curve would be invisible anyway).
  let v = 0; // number of floats written
  for (const node of nodes) {
    if (!node.parent) continue;
    const ax = screenX[node.parent.id], ay = screenY[node.parent.id];
    const bx = screenX[node.id], by = screenY[node.id];
    const chord = Math.hypot(bx - ax, by - ay);
    if (chord * pixelsPerUnit < 1) continue; // sub-pixel edge: skip

    if (chord * pixelsPerUnit < 6) {
      v = pushSegment(v, ax, ay, bx, by);
      continue;
    }
    const a = { x: ax, y: ay }, b = { x: bx, y: by };
    let prev = a;
    for (let i = 1; i <= EDGE_SEGMENTS; i++) {
      const next = i === EDGE_SEGMENTS ? b : geodesicLerp(a, b, i / EDGE_SEGMENTS);
      v = pushSegment(v, prev.x, prev.y, next.x, next.y);
      prev = next;
    }
  }
  edgeLines.geometry.setDrawRange(0, v / 3);
  edgeLines.geometry.attributes.position.needsUpdate = true;
}

// Append one line segment (two 3D vertices) to the edge buffer.
function pushSegment(v, x1, y1, x2, y2) {
  edgePositions[v++] = x1; edgePositions[v++] = y1; edgePositions[v++] = -0.9;
  edgePositions[v++] = x2; edgePositions[v++] = y2; edgePositions[v++] = -0.9;
  return v;
}

// ---------------------------------------------------------------------------
// Focusing
// ---------------------------------------------------------------------------

// Ease-in-out: slow start, fast middle, slow end. smoothstep(t) = 3t² - 2t³.
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
    // If a previous animation is still running, restart from where the view is now.
    anim = { from: focusPoint, to: node.z, start: performance.now() };
  } else {
    focusPoint = node.z;
    anim = null;
  }
  dirty = true;
}

function stepAnimation(now) {
  if (!anim) return;
  const t = Math.min((now - anim.start) / (ANIM_SECONDS * 1000), 1);
  // Slide the focus point along the geodesic between old and new focus.
  focusPoint = geodesicLerp(anim.from, anim.to, easeInOut(t));
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

// Find the node under a mouse/touch position. A node is a candidate if the
// point is inside its circle or within CLICK_TOLERANCE_PX of it. Among
// candidates we take the one with the smallest distance relative to its size,
// so the node you are really pointing at wins over big circles nearby.
function pickNode(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const nx = (clientX - rect.left) / rect.width;
  const ny = (clientY - rect.top) / rect.height;
  const wx = camera.left + nx * (camera.right - camera.left);
  const wy = camera.top - ny * (camera.top - camera.bottom);

  const tol = CLICK_TOLERANCE_PX / pixelsPerUnit;
  let best = null, bestScore = Infinity;
  for (const node of nodes) {
    const d = Math.hypot(screenX[node.id] - wx, screenY[node.id] - wy);
    const reach = screenR[node.id] + tol;
    if (d > reach) continue;
    const score = d / reach;
    if (score < bestScore) { bestScore = score; best = node; }
  }
  return best;
}

// Distinguish a click from a drag/scroll, so later phases can add dragging.
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
  stepAnimation(now);
  if (dirty) {
    updateGeometry();
    dirty = false;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

async function start() {
  // ?tree=name.json loads public/data/name.json instead of the default dataset (see dataset.js).
  const file = treeFileFromUrl();
  const url = `${import.meta.env.BASE_URL}data/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);

  const tree = buildTree(await response.json());
  root = tree.root;
  nodes = tree.nodes;
  computeLayout(root);

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

// Handy for debugging in the browser console.
window.__explorer = {
  get nodes() { return nodes; },
  focusOn,
  focusId: () => focusNode.id,
  get fps() { return fps.value; },
  // Screen (CSS pixel) position of a node's centre, for automated tests.
  screenPos: (id) => {
    const w = camera.right - camera.left, h = camera.top - camera.bottom;
    return {
      x: ((screenX[id] - camera.left) / w) * window.innerWidth,
      y: ((camera.top - screenY[id]) / h) * window.innerHeight,
    };
  },
};
