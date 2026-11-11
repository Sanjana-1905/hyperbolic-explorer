// main2d.js - 2D Poincaré disk viewer. Open with ?mode=2d.
// Step 2.3b brought it level with the 3D viewer: zoom and drag (navigation2d.js), contextual labels (labels.js, shared), the toolbar (toolbar.js, shared),
// search, breadcrumb, category and group expansion (disclosure.js, shared), the disease panel, Up = the real ontology parent, family colours
// (families.js, shared). The look (colours, sizes) is still the old one: the visual restyle is a separate, approved-first milestone.
//
// What happens here:
//   1. Load the tree JSON and lay it out once (layout.js). Each node keeps a
//      FIXED home position `node.z` on the disk.
//   2. To show the tree focused on some point f, we draw every node at
//      (-f) ⊕ z. That is the Möbius move that brings f to the centre.
//   3. Clicking a node animates f along the geodesic from the old focus to the
//      new one (0.5 s, ease-in-out). Backspace focuses the parent.

import * as THREE from 'three';
import { complex, cNeg, cAbs, mobiusAdd, geodesicLerp, hyperbolicDistanceExact } from './mobius.js';
import { nodePath } from './layout.js';
import { treeFileFromUrl } from './dataset.js';
import { makeDisplayTree, CAP_DESKTOP, CAP_PHONE } from './displaytree.js';
import { semanticStates, realParent } from './disclosure.js';
import { createMemberList } from './memberlist.js';
import { dataLayerFor } from './diseasedata.js';
import { createDiseasePanel } from './diseasepanel.js';
import { detectTier } from './quality.js';
import { createFpsCounter } from './fps.js';
import { THEME } from './theme.js';
import { createLabels } from './labels.js';
import { createToolbar } from './toolbar.js';
import { createBreadcrumb } from './breadcrumb.js';
import { createNav2d } from './navigation2d.js';
import { createIndex } from './search.js';
import { createSearchUI } from './searchui.js';
import { assignFamilyHues } from './families.js';
import { groupLabel } from './displaytree.js';

document.getElementById('help').textContent =
  'Drag to move · scroll or pinch to zoom · click a node to select it · keys: Backspace up · / search · F fps';
const fps = createFpsCounter();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const ANIM_SECONDS = 0.5;       // refocus animation length
const FOLDER_RADIUS = 0.16;     // hyperbolic radius of a folder circle
const FILE_RADIUS = 0.06;       // hyperbolic radius of a file circle
const FOCUS_SCALE = 1.5;        // the selected node is drawn this much bigger, with a ring around it
const AGGREGATE_SCALE = 1.5;    // an aggregate (closed group / list-only node) is drawn this much bigger than a folder
const COLLAPSE_MIN_NODES = 4;   // folders with fewer nodes inside than this never collapse into a "+N" aggregate (as in the 3D viewer)
const MIN_PIXELS = 1.2;         // never draw a circle smaller than this radius
const CLICK_TOLERANCE_PX = 8;   // how far from a circle a click still hits it
const EDGE_SEGMENTS = 8;        // line pieces per curved edge
const COLORS = {
  focus: new THREE.Color('#ffb703'),       // the selected node (same meaning as the bright centre in 3D)
  ring: new THREE.Color('#ffffff'),        // the ring drawn around the selected node
  edge: new THREE.Color('#2b3a55'),
  rim: new THREE.Color('#1d2a44'),
};
// A node's colour is its family's hue (families.js, the same hue the 3D viewer uses); lightness / saturation tell a category, a disease and an aggregate apart.
const SAT_LIGHT = { folder: [0.55, 0.52], file: [0.30, 0.62], aggregate: [0.55, 0.70] };
const tmpColor = new THREE.Color();

// ---------------------------------------------------------------------------
// three.js scene: an orthographic camera looking at the unit disk
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x05060a);
renderer.autoClear = false;                    // the label pass is drawn on top of the picture (clear once, by hand, per frame)
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 5;

// The view always shows x and y from -VIEW to +VIEW on the shorter screen side,
// so the whole disk (radius 1) fits with a little margin.
const VIEW = 1.04;
let pixelsPerUnit = 1; // screen pixels per disk unit, updated on resize

// A panel (the disease panel) can cover the right side or the bottom of the screen, and the one-row toolbar always covers a strip at the bottom (unless the
// compact landscape layout puts it at the left): the disk is fitted into, and centred in, the part that is left, then magnified by the zoom.
let panelRight = 0, panelBottom = 0, insetRight = 0, insetBottom = 0;
let nav2d = null;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  insetRight = panelRight;
  insetBottom = panelBottom + (h > THEME.COMPACT_HEIGHT_PX ? THEME.TOOLBAR_BAND_PX : 0);
  const rw = Math.max(80, w - insetRight), rh = Math.max(80, h - insetBottom);   // the free region, in pixels
  const s = (2 * VIEW) / Math.min(rw, rh) / (nav2d ? nav2d.zoom : 1);              // disk units per pixel
  const cx = rw / 2, cy = rh / 2;                                                  // its centre, from the top-left corner
  camera.left = -cx * s; camera.right = (w - cx) * s;
  camera.top = cy * s; camera.bottom = -(h - cy) * s;
  camera.updateProjectionMatrix();
  pixelsPerUnit = 1 / s;
  if (labels) { labels.resize(w, h); labels.setInset(insetRight, insetBottom); }   // labels stay out of the panel and the toolbar strip
  dirty = true;
}
function applyInset(right, bottom) { panelRight = right; panelBottom = bottom; resize(); }

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

// A white ring around the selected node (positioned in updateGeometry).
const focusRing = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), new THREE.MeshBasicMaterial({ color: COLORS.ring }));
focusRing.position.z = 0.6;
focusRing.visible = false;
scene.add(focusRing);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let nodes = [];          // all nodes of the display tree (real tree + navigation groups, displaytree.js)
let states = new Uint8Array(0); // per node: 0 drawn, 1 hidden inside a closed group / list-only node, 2 aggregate (disclosure.js)
let memberList = null;   // member list of a list-only node (memberlist.js)
let displayInfo = null;
let diseasePanel = null; // the disease panel (diseasepanel.js); null for other datasets or with ?panel=0
let labels = null;       // SDF text labels (labels.js, shared with 3D)
let toolbar = null, searchUI = null, breadcrumb = null;
let hoverNode = null;    // the node under the mouse (for its label)
let colorsDirty = false; // node colours must be rewritten (a state or the focus changed)
let diseaseData = null;  // the disease data layer (diseasedata.js): null for datasets without one; loads its files lazily
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

// Colours: the family hue (the same as in 3D) with lightness telling a category, a disease and an aggregate ("+N" / group) apart; the selected node is gold.
// They change only when the focus or a node's state changes.
function updateColors() {
  for (const node of nodes) {
    if (node === focusNode) { nodeMesh.setColorAt(node.id, COLORS.focus); continue; }
    const [sat, light] = states[node.id] === 2 ? SAT_LIGHT.aggregate : node.type === 'folder' ? SAT_LIGHT.folder : SAT_LIGHT.file;
    nodeMesh.setColorAt(node.id, tmpColor.setHSL(node.hue ?? THEME.ROOT_HUE, sat, light));
  }
  nodeMesh.instanceColor.needsUpdate = true;
  colorsDirty = false;
}

// Which nodes are shown: navigation groups and list-only nodes follow the focus path, and far categories collapse into "+N" aggregates by their hyperbolic
// distance from the view point: the SAME rule as the 3D viewer (disclosure.js), measured in the 2D disk.
function updateStates() {
  const next = semanticStates(nodes, root, focusNode, (n) => hyperbolicDistanceExact(focusPoint, n.z),
    { collapseDist: THEME.COLLAPSE_DIST, hyst: THEME.COLLAPSE_HYST, minNodes: COLLAPSE_MIN_NODES });
  let changed = states.length !== next.length;
  if (!changed) for (let i = 0; i < next.length; i++) if (next[i] !== states[i]) { changed = true; break; }
  states = next;
  if (changed) colorsDirty = true;
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
    const rho = (node.type === 'folder' ? FOLDER_RADIUS : FILE_RADIUS) * (states[node.id] === 2 ? AGGREGATE_SCALE : 1) * (node === focusNode ? FOCUS_SCALE : 1);
    // A node hidden inside a closed navigation group (or below a list-only node) is not drawn: scale 0, no edge, not pickable.
    const size = states[node.id] === 1 ? 0 : Math.max(rho * (1 - r * r) / 2, minRadius);

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
  if (focusNode) {                                           // the ring follows the selected node
    const k = screenR[focusNode.id] * 1.28;
    focusRing.position.set(screenX[focusNode.id], screenY[focusNode.id], 0.6);
    focusRing.scale.set(k, k, 1);
    focusRing.visible = true;
  }

  // 2. Edges: a geodesic arc from each parent to its child, drawn as a short
  // polyline. Tiny edges are drawn straight (a curve would be invisible anyway).
  let v = 0; // number of floats written
  for (const node of nodes) {
    if (!node.parent || states[node.id] === 1) continue;
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
  if (animate) {
    // If a previous animation is still running, restart from where the view is now.
    anim = { from: focusPoint, to: node.z, start: performance.now() };
  } else {
    focusPoint = node.z;
    anim = null;
  }
  updateStates();                                    // which groups are open follows the focus path; far categories collapse by distance
  colorsDirty = true;
  if (diseasePanel) diseasePanel.select(node); else if (memberList) memberList.update(node);
  updateInfo();
  if (breadcrumb) breadcrumb.update(node);
  refreshToolbar();
  dirty = true;
}

// Up = the REAL ontology parent (never an alphabetical navigation group; those are display aids, not relationships).
function goUp() { const up = focusNode && realParent(focusNode); if (up) focusOn(up); }

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
  infoName.textContent = n.isGroup ? `${n.name} · ${n.members} ${n.kind}` : n.name + (n.type === 'folder' ? '/' : '');
  const extra = n.isGroup ? `  ·  navigation group (alphabetical, not a category): ${n.firstName} … ${n.lastName}`
    : n.type === 'folder' ? `  ·  ${n.children.length} items, ${(n.realWeight ?? n.weight) - 1} nodes inside${n.listOnly ? '  ·  list-only (see the member list)' : ''}`
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
    if (states[node.id] === 1) continue;            // hidden: not pickable
    const d = Math.hypot(screenX[node.id] - wx, screenY[node.id] - wy);
    const reach = screenR[node.id] + tol;
    if (d > reach) continue;
    const score = d / reach;
    if (score < bestScore) { bestScore = score; best = node; }
  }
  return best;
}

// A tap selects the node under the finger / mouse; a double-tap (touch) goes up.
function onTap({ x, y, double }) {
  if (double) { goUp(); return; }
  const hit = pickNode(x, y);
  if (hit && hit !== focusNode) focusOn(hit);
}
function onHover(x, y) {
  const n = x < 0 ? null : pickNode(x, y);
  if (n !== hoverNode) { hoverNode = n; renderer.domElement.style.cursor = n ? 'pointer' : ''; }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace') {
    if (e.target && /^(input|textarea)$/i.test(e.target.tagName)) return;       // typing in the search box
    e.preventDefault(); // stop the browser from navigating "back"
    goUp();
  }
});

window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Labels (labels.js does the typesetting and keeps them from overlapping; here we say WHICH nodes want one and how much)
// ---------------------------------------------------------------------------
// Priority, high to low: the selected disease, the node under the mouse, its nearest ancestors, its children (bigger subtrees first), the "+N" aggregates,
// and any other node drawn big enough to read (so zooming in gives more labels). At most about 25 are placed (labels.js).
const realCount = (n) => (n.realWeight ?? n.weight) - 1;
const orbText = (n) => (n.isGroup ? groupLabel(n) : n.listOnly ? `${n.name} +${realCount(n)}` : `+${realCount(n)}`);
const labelScale = () => (window.innerHeight <= THEME.COMPACT_HEIGHT_PX ? THEME.COMPACT_LABEL_SCALE : 1);
function screenOf(n) {
  return {
    x: ((screenX[n.id] - camera.left) / (camera.right - camera.left)) * window.innerWidth,
    y: ((camera.top - screenY[n.id]) / (camera.top - camera.bottom)) * window.innerHeight,
    r: screenR[n.id] * pixelsPerUnit,
  };
}
function collectLabelCandidates() {
  const k = labelScale(), out = [], seen = new Set();
  const room = (s) => s.x > 10 && s.x < window.innerWidth - insetRight - 20 && s.y > 40 && s.y < window.innerHeight - insetBottom - 10;
  const add = (n, priority, px, color, text) => {
    if (seen.has(n.id) || states[n.id] === 1) return;
    const s = screenOf(n);
    if (!room(s)) return;
    seen.add(n.id);
    out.push({ key: n.id, text, x: s.x, y: s.y, r: s.r, priority, px, color });
  };
  const text = (n) => (states[n.id] === 2 ? orbText(n) : n.isGroup ? groupLabel(n) : n.name);
  add(focusNode, 1000, THEME.LABEL_FOCUS_PX * k, THEME.LABEL_COLOR, text(focusNode));
  if (hoverNode) add(hoverNode, 900, THEME.LABEL_HOVER_PX * k, THEME.LABEL_COLOR, states[hoverNode.id] === 2 && !hoverNode.isGroup ? `${hoverNode.name}  ${orbText(hoverNode)}` : text(hoverNode));
  let up = realParent(focusNode);                                       // the nearest few real ancestors say where we are
  for (let i = 0; up && i < 3; i++, up = realParent(up)) add(up, 700 - i * 10, THEME.LABEL_FONT_PX * k, THEME.LABEL_COLOR, up.name);
  for (const c of focusNode.children) {
    const orb = states[c.id] === 2;
    add(c, 500 + 10 * Math.log2(c.weight), THEME.LABEL_FONT_PX * k, orb ? THEME.LABEL_ORB_COLOR : THEME.LABEL_COLOR, text(c));
  }
  const rest = [];                                                      // everything else that is big enough on the screen
  for (const n of nodes) {
    if (seen.has(n.id) || states[n.id] === 1) continue;
    const r = screenR[n.id] * pixelsPerUnit;
    if (states[n.id] === 2 ? r >= 4 : r >= THEME.LABEL2D_MIN_RADIUS_PX) rest.push([n, r]);
  }
  rest.sort((a, b) => b[1] - a[1]);
  for (const [n, r] of rest.slice(0, 60)) {
    const orb = states[n.id] === 2;
    add(n, (orb ? 100 : 200) + Math.min(r, 60), (orb ? THEME.LABEL_ORB_PX : THEME.LABEL_FONT_PX) * k, orb ? THEME.LABEL_ORB_COLOR : THEME.LABEL_COLOR, text(n));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Toolbar (toolbar.js is shared with 3D; the 2D disk adds zoom buttons and has no Back / link buttons)
// ---------------------------------------------------------------------------
function refreshToolbar() {
  if (!toolbar || !focusNode) return;
  toolbar.update({
    backDepth: 0, isRoot: !realParent(focusNode),
    homeDisabled: !realParent(focusNode) && nav2d.zoom === 1 && Math.hypot(focusPoint.x - focusNode.z.x, focusPoint.y - focusNode.z.y) < 1e-9,   // Home also resets zoom and view
    focusKind: focusNode.type === 'folder' ? 'folder' : 'file',
    showImports: false, showCalls: false, showFolderDeps: false, infoOpen: diseasePanel ? diseasePanel.open : false, heatMode: 0, hasGit: false, hasLinks: false,
    hasInfo: !!diseasePanel, zoomInDisabled: !nav2d.canZoomIn, zoomOutDisabled: !nav2d.canZoomOut,
  });
}

// ---------------------------------------------------------------------------
// Main loop and startup
// ---------------------------------------------------------------------------
function frame(now) {
  fps.tick(now);
  stepAnimation(now);
  if (dirty) {
    updateStates();                         // collapse / expand categories by distance (also while the view glides or is dragged)
    if (colorsDirty) updateColors();
    updateGeometry();
    dirty = false;
  }
  renderer.clear();
  renderer.render(scene, camera);          // pass 1: the disk
  labels.update(collectLabelCandidates());
  labels.render();                         // pass 2: labels on top (one batched draw call)
  requestAnimationFrame(frame);
}

async function start() {
  // ?tree=name.json loads public/data/name.json instead of the default dataset (see dataset.js).
  const file = treeFileFromUrl();
  const url = `${import.meta.env.BASE_URL}data/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);

  // The display tree (displaytree.js) is already laid out in 2D (positions `z`); the 3D viewer lays out the SAME tree in its own way.
  const capParam = Number(new URLSearchParams(location.search).get('cap'));
  const json = await response.json();
  const tree = makeDisplayTree(json, { cap: capParam > 0 ? capParam : detectTier() === 'phone' ? CAP_PHONE : CAP_DESKTOP });
  displayInfo = tree.info;
  const baseUrl = url.slice(0, url.lastIndexOf('/') + 1);
  diseaseData = dataLayerFor(json, (file) => fetch(`${baseUrl}${file}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }));
  root = tree.root;
  nodes = tree.nodes;
  if (diseaseData) diseaseData.attachTree(nodes);
  if (diseaseData && new URLSearchParams(location.search).get('panel') !== '0') {
    diseasePanel = createDiseasePanel({ data: diseaseData, nodeById: (id) => nodes[id], onNavigate: (n) => focusOn(n), onLayout: applyInset, launcher: false });
    memberList = diseasePanel.memberList;
  } else memberList = createMemberList({ onPick: (n) => focusOn(n) });

  assignFamilyHues(root);                                  // the same family colours as the 3D viewer
  nav2d = createNav2d({
    element: renderer.domElement,
    getFocusPoint: () => focusPoint, setFocusPoint: (p) => { anim = null; focusPoint = p; dirty = true; },
    getPixelsPerUnit: () => pixelsPerUnit,
    onZoom: () => { resize(); refreshToolbar(); }, onMove: () => { dirty = true; refreshToolbar(); }, onTap, onHover,
  });
  labels = createLabels(renderer);
  breadcrumb = createBreadcrumb({ onPick: (n) => focusOn(n) });
  toolbar = createToolbar({
    onSearch: () => { if (searchUI) searchUI.open(); },
    onHome: () => { nav2d.setZoom(1); if (root && (focusNode !== root || anim || Math.hypot(focusPoint.x, focusPoint.y) > 1e-9)) focusOn(root); else refreshToolbar(); },
    onUp: goUp, onBack: () => {}, onImports: () => {}, onCalls: () => {}, onFolderDeps: () => {}, onHeat: () => {},
    onInfo: () => { if (diseasePanel) { diseasePanel.toggle(); refreshToolbar(); } },
    onZoomIn: () => { nav2d.zoomIn(); }, onZoomOut: () => { nav2d.zoomOut(); },
    onFullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});   // refused (e.g. not from a tap): ignore
    },
  });
  toolbar.setDataset({ about: json.about, words: json.words, hasLinks: false });
  const index = createIndex();
  index.addTree(nodes.filter((n) => !n.isGroup), nodePath);   // navigation groups are not diseases: never search results
  searchUI = createSearchUI({ index, onSelect: (r) => { const n = nodes[r.baseId]; if (n) focusOn(n); } });

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
  get displayInfo() { return displayInfo; },
  get data() { return diseaseData; },
  get panel() { return diseasePanel; },
  get ringVisible() { return focusRing.visible; },
  get ringAt() { return { x: focusRing.position.x, y: focusRing.position.y, scale: focusRing.scale.x }; },
  get focusNode() { return focusNode; },
  get memberList() { return memberList; },
  state: (id) => states[id],
  get visibleCount() { let c = 0; for (const n of nodes) if (states[n.id] !== 1) c++; return c; },
  orbIds: () => nodes.filter((n) => states[n.id] === 2).map((n) => n.id),
  pick: (x, y) => { const n = pickNode(x, y); return n ? n.id : null; },
  screenPos: (id) => {
    const w = camera.right - camera.left, h = camera.top - camera.bottom;
    return {
      x: ((screenX[id] - camera.left) / w) * window.innerWidth,
      y: ((camera.top - screenY[id]) / h) * window.innerHeight,
      r: screenR[id] * pixelsPerUnit,
    };
  },
  // ---- parity hooks (same names as the 3D viewer where there is an equivalent) ----
  get animating() { return !!anim; },
  shownR: (id) => Math.hypot(screenX[id], screenY[id]),
  get zoom() { return nav2d.zoom; },
  setZoom: (z) => nav2d.setZoom(z),
  zoomIn: () => nav2d.zoomIn(), zoomOut: () => nav2d.zoomOut(),
  get focusPoint() { return { x: focusPoint.x, y: focusPoint.y }; },
  get labelCount() { return labels.count; },
  labelDebug: () => labels.debug(),
  get hoverId() { return hoverNode ? hoverNode.id : null; },
  nodeById: (id) => nodes[id],
  get orbCount() { let c = 0; for (const n of nodes) if (states[n.id] === 2) c++; return c; },
  goUp,
  get pixelsPerUnit() { return pixelsPerUnit; },
};
