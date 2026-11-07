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
//      new one (0.5 s, ease-in-out). Backspace focuses the parent. (All camera and navigation
//      code lives in navigation.js.)
//   4. Nodes are camera-facing quads ("impostors") drawn with additive blending:
//      folders look like glowing stars, files like faint twinkling points. Each
//      top-level folder is an "arm" with its own hue.
// The camera orbits the centre of the ball (where the focus node sits).
//   5. (Phase 4b) A file that has symbols OPENS when the focus comes near it: its classes, functions
//      and methods are loaded lazily (symbols.js), laid out inside the file's own territory
//      (layoutSymbols) and written into spare slots of the same instance buffers. Far files close
//      again and free their slots. The code panel (codepanel.js) shows the focused symbol's source.

import * as THREE from 'three';
import { vNeg, vLength, mobiusAdd3, conformalFactor3, hyperbolicDistance3 } from './mobius3d.js';
import { buildTree, computeLayout3d, layoutSymbols, nodePath } from './layout3d.js';
import { createNavigation } from './navigation.js';
import { createSymbolStore, buildSymbolNodes } from './symbols.js';
import { createCodePanel } from './codepanel.js';
import { createFpsCounter } from './fps.js';
import {
  NODE_VERT, NODE_FRAG, NEBULA_VERT, NEBULA_FRAG, HAZE_VERT, HAZE_FRAG,
  SUN_VERT, SUN_FRAG, EDGE_VERT, EDGE_FRAG, DUST_VERT, DUST_FRAG,
} from './glsl.js';
import { gpuCheck } from './gpucheck.js';
import { THEME, THEME_DEFINES, cssRgb } from './theme.js';
import { createLabels } from './labels.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const CLICK_TOLERANCE_PX = 8;   // how far from a node a click still hits it

// Symbol galaxies (Phase 4b). Not look constants: they decide WHEN files open.
const EXPAND_DIST = 0.45;       // a file with symbols opens when the focus is within this hyperbolic distance (a folder's
                                // files sit 0.7 away, so focusing a folder does NOT open them; focusing or reaching a file does)
const EXPAND_HYST = 0.25;       // ... and closes again only beyond EXPAND_DIST + this (no flicker)
const MAX_OPEN_FILES = 6;       // at most this many files open at once (nearest first)
const MAX_SYMBOL_NODES = 3000;  // spare buffer slots for symbol nodes (CLAUDE.md: ~3,000 visible nodes)

// Debug: ?time=12.5 freezes the clock the shaders animate with, so screenshots are repeatable.
const FROZEN_TIME = new URLSearchParams(location.search).has('time')
  ? Number(new URLSearchParams(location.search).get('time')) : null;

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
  'Drag to look around · scroll to move in/out · click a node to focus it (click a file to open its code) · Backspace = parent · C = code panel · F = fps · R = slow spin (desktop)';
const COLLAPSE_MIN_NODES = 4;   // folders with fewer nodes inside than this are never collapsed (a "+2" orb is pointless)
const fps = createFpsCounter(() => `${labels ? labels.count : 0} labels · ${visibleCount} nodes · ${dynamicCount} symbols`);

// ---------------------------------------------------------------------------
// three.js scene: a perspective camera orbiting the centre of the unit ball
// ---------------------------------------------------------------------------
// No MSAA: nodes are soft additive glows (no hard edges to smooth), and MSAA is expensive on phones.
const renderer = new THREE.WebGLRenderer({ antialias: false });
// Two passes per frame (3D scene, then the label overlay), so we clear by hand and count draw calls ourselves.
renderer.autoClear = false;
renderer.info.autoReset = false;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.pixelRatio));
renderer.setClearColor(THEME.CLEAR_COLOR); // deep navy-black (theme.js)
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// Camera, orbit controls, focus animation: all in navigation.js (replaceable by the VR camera later).
const nav = createNavigation(renderer);
const camera = nav.camera;
scene.add(camera);
const controls = nav.controls;

// Shared by every shader: the time in seconds (breathing, twinkling, drifting clouds).
const uTime = { value: 0 };
// Real-time clock (seconds) for the bloom-in of new symbols. Not frozen by ?time=, or new nodes would never grow.
const uBloom = { value: 0 };

// Procedural nebula + stars: one big inward-facing sphere that follows the
// camera (so it behaves like the sky: no parallax), drawn first, ignoring depth.
const nebula = new THREE.Mesh(
  new THREE.SphereGeometry(20, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: { uTime },
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    defines: { ...THEME_DEFINES, OCTAVES: QUALITY.octaves, STAR_LAYERS: QUALITY.starLayers },
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
    defines: THEME_DEFINES,
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
  edgeUniforms.uLineWidth.value = THEME.EDGE_WIDTH_PX * renderer.getPixelRatio();
  nav.resize(w, h);
  if (labels) labels.resize(w, h);
  // At distance D from the camera the screen is 2·D·tan(fov/2) units tall.
  pixelsPerUnitAt1 = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let nodes = [];
let root = null;
let focusNode = null;
let allNodes = [];              // base tree nodes + the symbol nodes that are currently open
let nodeById = [];              // buffer slot -> node (undefined for a free slot)
let baseCount = 0;              // number of base tree nodes (slots 0..baseCount-1); symbol slots follow
let baseEdgeCount = 0;          // edge instances of the base tree; symbol edge slot = baseEdgeCount + (slot - baseCount)
let highWater = 0;              // slots 0..highWater-1 may be in use: this many instances are drawn
let freeSlots = [];             // freed symbol slots, reused first
let dynamicCount = 0;           // symbol nodes currently alive
let symbolFiles = [];           // base file nodes that have a symbols file
const openFiles = new Set();    // files currently opened into galaxies
let store = null;               // lazy loader of symbol / source files (symbols.js)
let codePanel = null;           // HTML code panel (codepanel.js)
let edgeArr = null;             // typed arrays behind the edge instance attributes
let labels = null;              // screen-space SDF labels (labels.js)
let hoverNode = null;           // node under the pointer (desktop), gets a label
let visibleCount = 0;           // nodes currently drawn (not hidden inside a collapsed folder)
let collapsedNodes = [];        // folders currently shown as "+N" orbs
let pathNodes = [];             // focus and its ancestors (never collapsed)
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
const focusUniforms = { _Focus: { value: new THREE.Vector3() }, uFocusId: { value: -1 }, uTime, uBloom };
const edgeUniforms = { _Focus: focusUniforms._Focus, uTime, uBloom, uResolution: { value: new THREE.Vector2(1, 1) }, uLineWidth: { value: 1.8 } };
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
function assignVisuals() {
  root.hue = THEME.ROOT_HUE;
  // Only FOLDER arms share out the hue range (a loose file in the root is not an arm and
  // gets violet). Example: 3 folder arms -> teal 0.47, indigo 0.67, magenta 0.87.
  const arms = root.children.filter((c) => c.type === 'folder');
  root.children.forEach((c) => { if (c.type !== 'folder') paintArm(c, THEME.LOOSE_FILE_HUE); });
  arms.forEach((arm, i) => {
    paintArm(arm, arms.length > 1
      ? THEME.ARM_HUE_FIRST + ((THEME.ARM_HUE_LAST - THEME.ARM_HUE_FIRST) * i) / (arms.length - 1)
      : THEME.ARM_HUE_FIRST);
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
    aState: add('aState', 1), aOrigin: add('aOrigin', 3), aBorn: add('aBorn', 1),
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
  a.aKind[slot] = node.kindCode ?? (node.type === 'folder' ? 1 : 0);   // 0 file, 1 folder, 2.. symbol kinds
  // Where a new symbol grows from (its parent) and when it was born; base nodes were "always there" (-100).
  const from = node.parent ? node.parent.pos : node.pos;
  a.aOrigin[slot * 3] = from.x; a.aOrigin[slot * 3 + 1] = from.y; a.aOrigin[slot * 3 + 2] = from.z;
  a.aBorn[slot] = node.born ?? -100;
  a.aSeed[slot] = node.seed;
  a.aId[slot] = node.id;
  a.aState[slot] = node.state;
}

function makeNodeMaterial(isHalo) {
  return new THREE.ShaderMaterial({
    uniforms: focusUniforms,
    vertexShader: NODE_VERT,
    fragmentShader: NODE_FRAG,
    defines: { ...THEME_DEFINES, CORE: (1 / THEME.GLOW_SCALE).toFixed(5), ...(isHalo ? { HALO: 1 } : {}) },
    transparent: true,
    blending: THREE.AdditiveBlending, // overlapping glows ADD, they never cover each other
    depthTest: false, depthWrite: false,
  });
}

function buildDrawables() {
  const n = nodes.length;
  baseCount = n;
  highWater = n;
  const capacity = n + MAX_SYMBOL_NODES;   // spare slots after the base tree hold symbol nodes
  shownRadius = new Float32Array(capacity);

  // A fixed random number per node (the same every run, so screenshots are repeatable).
  let seed = 2024;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const node of nodes) { node.seed = rand(); node.state = 0; node.collapsed = false; nodeById[node.id] = node; }
  allNodes = nodes.slice();

  assignVisuals();

  const geom = makeQuadGeometry(capacity);
  geom.instanceCount = n;                 // only the used slots are drawn; this grows when symbols open
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
  edgeNodes.forEach((nd, i) => { nd.edgeIndex = i; });
  baseEdgeCount = edgeNodes.length;
  const edgeCapacity = baseEdgeCount + MAX_SYMBOL_NODES; // one spare edge per spare node slot
  const ea = (name, size) => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(edgeCapacity * size), size);
    eg.setAttribute(name, attr);
    return attr.array;
  };
  const eA = ea('aA', 3), eB = ea('aB', 3), eHue = ea('aHue', 1), eEnergy = ea('aEnergy', 1), eSeed = ea('aSeed', 1);
  const eHide = ea('aHide', 1);
  const eBorn = ea('aBorn', 1);
  edgeArr = { eA, eB, eHue, eEnergy, eSeed, eHide, eBorn };
  edgeNodes.forEach((nd, i) => {
    eA.set([nd.parent.pos.x, nd.parent.pos.y, nd.parent.pos.z], i * 3);
    eB.set([nd.pos.x, nd.pos.y, nd.pos.z], i * 3);
    eHue[i] = nd.hue; eEnergy[i] = nd.energy; eSeed[i] = nd.seed;
    eBorn[i] = -100;
  });
  eg.instanceCount = baseEdgeCount;
  edgeMesh = new THREE.Mesh(eg, new THREE.ShaderMaterial({
    uniforms: edgeUniforms, vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG, defines: THEME_DEFINES,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    side: THREE.DoubleSide, // the strip's facing flips with the screen direction
  }));
  edgeMesh.frustumCulled = false;
  edgeMesh.renderOrder = 0;
  scene.add(edgeMesh);

  // Dust: faint specks at random fixed places in the ball. Density falls toward the
  // boundary (radius = DUST_RADIUS * sqrt(u)), so there are more in the middle where the gaps are.
  const dg = makeQuadGeometry(QUALITY.dustCount, ['aPos', 'aSeed']);
  for (let i = 0; i < QUALITY.dustCount; i++) {
    let x, y, z, len;
    do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; len = Math.hypot(x, y, z); } while (len > 1 || len < 1e-3);
    const r = THEME.DUST_RADIUS * Math.sqrt(rand());
    dg.arrays.aPos.set([(x / len) * r, (y / len) * r, (z / len) * r], i * 3);
    dg.arrays.aSeed[i] = rand();
  }
  dustMesh = new THREE.Mesh(dg, new THREE.ShaderMaterial({
    uniforms: focusUniforms, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
    defines: THEME_DEFINES,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }));
  dustMesh.frustumCulled = false;
  dustMesh.renderOrder = -1;
  scene.add(dustMesh);

  // The sun: one billboard at the focus, with core, gold glow, corona and rays.
  sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: sunUniforms, vertexShader: SUN_VERT, fragmentShader: SUN_FRAG,
    defines: THEME_DEFINES,
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
  if (node === focusNode) rho = THEME.FOCUS_R;
  else if (node.type === 'folder') {
    const hero = node.seed >= THEME.HERO_AT ? THEME.HERO_SIZE : 1;
    rho = THEME.FOLDER_R * (1 + THEME.SIZE_SPREAD * node.energy) * hero;
    if (node.state === 2) rho *= THEME.COLLAPSED_SIZE;
  } else if (node.type === 'symbol') {
    const base = [THEME.CLASS_R, THEME.FUNCTION_R, THEME.METHOD_R, THEME.BLOCK_R][node.kindCode - 2];
    rho = base * (1 + THEME.SYMBOL_SIZE_SPREAD * node.energy);
    if (node.state === 2) rho *= THEME.COLLAPSED_SIZE;
  } else rho = THEME.FILE_R;
  return Math.max(rho * conformalFactor3(p), THEME.MIN_R);
}

// ---------------------------------------------------------------------------
// CPU copy of the transform, used ONLY for picking (and debugging). The GPU draws
// everything by itself, so this runs lazily: only when someone clicks or asks where a
// node is, and only if the focus has moved since the last time.
function ensureShown() {
  if (!shownStale) return;
  const shift = vNeg(nav.focusPoint); // the Möbius move that puts the focus point at the centre is "add -f"
  for (const node of allNodes) {
    const p = mobiusAdd3(shift, node.pos);
    shown[node.id] = p;
    shownRadius[node.id] = coreRadius(node, p);
  }
  shownStale = false;
}

// ---------------------------------------------------------------------------
// Semantic zoom: far folders collapse into one "+N" orb, near ones expand
// ---------------------------------------------------------------------------
// Walk the tree from the root. A folder whose hyperbolic distance from the focus point
// is larger than COLLAPSE_DIST becomes an ORB (state 2): it is drawn, but everything below
// it is HIDDEN (state 1: not drawn, not pickable, its edges not drawn). The focus and its
// ancestors are never collapsed, or the focus itself could vanish.
// Hysteresis: a folder collapses only beyond DIST + HYST and expands again only inside
// DIST - HYST, so a folder hovering near the limit does not flicker while you glide.
// Example (DIST 2.4, HYST 0.3): a folder 2.6 away stays expanded; at 3.0 it collapses; it
// re-expands only when the focus comes within 2.1.
// The decision is made on the CPU; the result goes to the shaders as the aState / aHide
// attributes (so the GPU still draws everything in one call each).
function updateSemanticZoom() {
  for (const n of pathNodes) n.onPath = false;
  pathNodes = [];
  for (let n = focusNode; n; n = n.parent) { n.onPath = true; pathNodes.push(n); }

  const stateArr = nodeMesh.geometry.arrays.aState;
  const hideArr = edgeMesh.geometry.attributes.aHide.array;
  let changed = false;
  visibleCount = 0;
  collapsedNodes = [];

  const visit = (node, hidden) => {
    let state;
    if (hidden) state = 1;
    // Folders and symbols that contain other nodes (a class with methods) can collapse; symbols use their own, shorter distance.
    else if ((node.type === 'folder' || node.type === 'symbol') && node.weight - 1 >= COLLAPSE_MIN_NODES && !node.onPath) {
      const d = hyperbolicDistance3(nav.focusPoint, node.pos);
      const base = node.type === 'symbol' ? THEME.SYMBOL_COLLAPSE_DIST : THEME.COLLAPSE_DIST;
      const limit = node.collapsed ? base - THEME.COLLAPSE_HYST : base + THEME.COLLAPSE_HYST;
      node.collapsed = d > limit;
      state = node.collapsed ? 2 : 0;
    } else {
      node.collapsed = false;
      state = 0;
    }
    if (state !== node.state) {
      node.state = state;
      stateArr[node.id] = state;
      if (node.edgeIndex !== undefined) hideArr[node.edgeIndex] = state === 1 ? 1 : 0;
      changed = true;
    }
    if (state !== 1) visibleCount++;
    if (state === 2) collapsedNodes.push(node);
    const childrenHidden = hidden || node.collapsed;
    for (const child of node.children) visit(child, childrenHidden);
  };
  visit(root, false);

  if (changed) {
    nodeMesh.geometry.attributes.aState.needsUpdate = true;
    edgeMesh.geometry.attributes.aHide.needsUpdate = true;
    shownStale = true;                       // sizes of orbs changed: rebuild the pick radii
  }
}

// ---------------------------------------------------------------------------
// Opening files: lazy-loaded symbol galaxies
// ---------------------------------------------------------------------------
// A file that has symbols OPENS when the focus is within EXPAND_DIST of it (or it is the focus, or an
// ancestor of the focused symbol), and closes when the focus is further than EXPAND_DIST + EXPAND_HYST.
// Opening = fetch the symbols file (cached), build nodes, lay them out inside the file's territory, give
// every node a spare buffer slot and write its instance + edge. Closing = hide the slots and free them.
// The base tree is never touched, so nothing else (picking, shaders, semantic zoom) needs a special case.
// Example (EXPAND_DIST 0.45, HYST 0.25): a file 0.3 from the focus opens; it stays open until the focus
// is more than 0.7 away; a file 0.6 away that is closed stays closed.

function slotFor(node) {
  const slot = freeSlots.length ? freeSlots.pop() : highWater++;
  node.id = slot;
  nodeById[slot] = node;
  return slot;
}

function addSymbolNodes(file, made) {
  const g = nodeMesh.geometry;
  const bornAt = performance.now() / 1000;
  for (const node of made) {
    node.born = bornAt;
    node.energy = node.energy ?? 0.5;
    slotFor(node);
    writeInstance(g, node.id, node);
    // Its edge lives in the edge slot parallel to the node slot.
    const e = baseEdgeCount + (node.id - baseCount);
    node.edgeIndex = e;
    edgeArr.eA.set([node.parent.pos.x, node.parent.pos.y, node.parent.pos.z], e * 3);
    edgeArr.eB.set([node.pos.x, node.pos.y, node.pos.z], e * 3);
    edgeArr.eHue[e] = node.hue; edgeArr.eEnergy[e] = node.energy; edgeArr.eSeed[e] = node.seed;
    edgeArr.eHide[e] = 0; edgeArr.eBorn[e] = bornAt;
    dynamicCount++;
    allNodes.push(node);
  }
  g.instanceCount = highWater;
  edgeMesh.geometry.instanceCount = baseEdgeCount + (highWater - baseCount);
  uploadBuffers();
}

function uploadBuffers() {
  for (const name of Object.keys(nodeMesh.geometry.arrays)) nodeMesh.geometry.attributes[name].needsUpdate = true;
  for (const name of ['aA', 'aB', 'aHue', 'aEnergy', 'aSeed', 'aHide', 'aBorn']) edgeMesh.geometry.attributes[name].needsUpdate = true;
  shownStale = true;
}

async function openFile(file) {
  if (file.symState) return;               // already loading or open
  file.symState = 'loading';
  const doc = await store.getDoc(file);
  if (file.symState !== 'loading') return; // closed again while we were loading
  if (!doc) { file.symState = undefined; return; }
  const made = buildSymbolNodes(file, doc);
  if (dynamicCount + made.length > MAX_SYMBOL_NODES) { file.symState = undefined; return; } // out of spare slots
  file.children = made.filter((n) => n.parent === file);
  layoutSymbols(file);
  addSymbolNodes(file, made);
  file.symState = 'open';
  openFiles.add(file);
  dirty = true; // semantic zoom, halos and the info line must see the new children
  if (focusNode === file) updateInfo();
}

function closeFile(file) {
  const doomed = [];
  const collect = (node) => { for (const c of node.children) { doomed.push(c); collect(c); } };
  collect(file);
  for (const node of doomed) {
    nodeMesh.geometry.arrays.aState[node.id] = 1;     // hidden: the vertex shader throws it off screen
    edgeArr.eHide[node.edgeIndex] = 1;
    nodeById[node.id] = undefined;
    freeSlots.push(node.id);
    dynamicCount--;
    if (hoverNode === node) hoverNode = null;
  }
  const gone = new Set(doomed);
  allNodes = allNodes.filter((n) => !gone.has(n));
  file.children = [];
  file.symState = undefined;
  openFiles.delete(file);
  uploadBuffers();
  dirty = true;
}

function updateExpansion() {
  if (!symbolFiles.length) return;
  const f = nav.focusPoint;
  const focusFile = focusNode.type === 'symbol' ? focusNode.file : focusNode; // never close the file we are inside
  const near = [];
  for (const file of symbolFiles) {
    const d = hyperbolicDistance3(f, file.pos);
    if (d < EXPAND_DIST || file === focusFile) near.push({ file, d });
    else if (file.symState === 'open' && d > EXPAND_DIST + EXPAND_HYST) closeFile(file);
  }
  near.sort((a, b) => a.d - b.d);
  near.slice(0, MAX_OPEN_FILES).forEach(({ file }) => { openFile(file); });
}

// ---------------------------------------------------------------------------
// Focusing
// ---------------------------------------------------------------------------

// Start moving the view so that `node` ends up at the centre.
function focusOn(node, animate = true) {
  if (!node) return;
  focusNode = node;
  focusUniforms.uFocusId.value = node.id;
  sunUniforms.uFocusPos.value.set(node.pos.x, node.pos.y, node.pos.z);
  nav.flyTo(node.pos, animate);
  updateInfo();
  showCode(node);
  dirty = true;
}

// Fill the code panel for the focus: a symbol shows its own lines, a file with source shows the file.
async function showCode(node) {
  const file = node.type === 'symbol' ? node.file : node;
  if (!file || !file.hasSymbols || node.type === 'folder') { codePanel.hide(); return; }
  const lines = await store.getLines(file);
  if (focusNode !== node) return; // the user moved on while the file was loading
  const from = node.type === 'symbol' ? node.startLine : 1;
  const to = node.type === 'symbol' ? node.endLine : (file.loc || (lines ? lines.length : 1));
  codePanel.show({
    title: node.name,
    subtitle: `${nodePath(file)} · lines ${from}–${to}`,
    lines, from, to, lang: file.ext === 'py' ? 'py' : 'js',
  });
}

// ---------------------------------------------------------------------------
// Text overlay
// ---------------------------------------------------------------------------
const infoName = document.querySelector('#info .name');
const infoPath = document.querySelector('#info .path');

// Number of symbol nodes under a file.
function dynamicCountOf(file) {
  let count = 0;
  const walk = (node) => { for (const c of node.children) { count++; walk(c); } };
  walk(file);
  return count;
}

function updateInfo() {
  const n = focusNode;
  infoName.textContent = n.name + (n.type === 'folder' ? '/' : '');
  if (n.type === 'folder') infoPath.textContent = `${n.children.length} items, ${n.weight - 1} nodes inside`;
  else if (n.type === 'symbol') infoPath.textContent = `${n.kind} · ${n.signature} · lines ${n.startLine}–${n.endLine}`;
  else {
    // A file: size, git info (if the scanner had it) and how many symbols it holds once opened.
    const bits = [];
    if (n.loc) bits.push(`${n.loc} lines`);
    if (n.hasSymbols) bits.push(n.symState === 'open' ? `${dynamicCountOf(n)} symbols` : 'has symbols');
    if (n.commits) bits.push(`${n.commits} commits, last ${n.modified}`);
    infoPath.textContent = bits.join(' · ');
  }
  updateBreadcrumb();
}

// Breadcrumb: "repo / src / components" at a fixed place (bottom centre). Each segment is
// clickable and focuses that ancestor. Very long paths keep the first segment and the last
// four, with "…" in between.
const crumbs = document.createElement('div');
crumbs.id = 'crumbs';
Object.assign(crumbs.style, {
  position: 'fixed', left: 'calc((100vw - var(--panel-w, 0px)) / 2)', bottom: 'calc(34px + var(--sheet-h, 0px))', transform: 'translateX(-50%)',
  maxWidth: 'calc(100vw - var(--panel-w, 0px) - 24px)', padding: '4px 12px', borderRadius: '14px',
  font: `600 ${THEME.CRUMB_FONT_PX}px system-ui, sans-serif`,
  background: cssRgb(THEME.CRUMB_BG, THEME.CRUMB_BG_ALPHA), color: cssRgb(THEME.CRUMB_COLOR),
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 0 4px #000',
});
document.body.appendChild(crumbs);

function updateBreadcrumb() {
  const chain = [];
  for (let n = focusNode; n; n = n.parent) chain.unshift(n);
  let shownChain = chain;
  if (chain.length > 6) shownChain = [chain[0], null, ...chain.slice(-4)]; // null = "…"
  crumbs.textContent = '';
  shownChain.forEach((n, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.textContent = ' / ';
      sep.style.color = cssRgb(THEME.CRUMB_SEP_COLOR);
      crumbs.appendChild(sep);
    }
    const span = document.createElement('span');
    span.textContent = n ? n.name : '…';
    if (n === focusNode) span.style.color = cssRgb(THEME.CRUMB_LAST_COLOR);
    if (n && n !== focusNode) {
      span.style.cursor = 'pointer';
      span.addEventListener('click', () => focusOn(n));
    }
    crumbs.appendChild(span);
  });
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
  for (const node of allNodes) {
    if (node.state === 1) continue; // hidden inside a collapsed folder: not pickable
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

// ---------------------------------------------------------------------------
// Label candidates: the focus, the node under the pointer, the focus's children,
// and the "+N" orbs. labels.js decides which ones fit without overlapping.
// ---------------------------------------------------------------------------
// Project one node to CSS pixels using its CURRENT position (computed on the spot: only a
// few dozen nodes need it, so we do not rebuild the pick table every animation frame).
function projectForLabel(node) {
  const p = mobiusAdd3(vNeg(nav.focusPoint), node.pos);
  tmp.set(p.x, p.y, p.z).applyMatrix4(camera.matrixWorldInverse);
  const depth = -tmp.z;
  if (depth <= camera.near) return null;
  tmp.applyMatrix4(camera.projectionMatrix);
  return {
    x: ((tmp.x + 1) / 2) * window.innerWidth,
    y: ((1 - tmp.y) / 2) * window.innerHeight,
    r: (coreRadius(node, p) * pixelsPerUnitAt1) / depth,
  };
}

// Labels must stay out of the area the code panel covers (the panel is solid, so they would be hidden anyway,
// and they would use up label slots).
function visibleOnScreen(x, y) {
  const { right, bottom } = nav.inset;
  return x < window.innerWidth - right - 20 && y < window.innerHeight - bottom - 10;
}

function collectLabelCandidates() {
  const out = [];
  const seen = new Set();
  const add = (node, priority, px, color, text) => {
    if (seen.has(node.id) || node.state === 1) return;
    const s = projectForLabel(node);
    if (!s || !visibleOnScreen(s.x, s.y)) return;
    seen.add(node.id);
    out.push({ key: node.id, text, x: s.x, y: s.y, r: s.r, priority, px, color });
  };
  const orbText = (node) => `+${node.weight - 1}`;

  add(focusNode, 1000, THEME.LABEL_FOCUS_PX, THEME.LABEL_COLOR, focusNode.name);
  if (hoverNode) {
    const text = hoverNode.state === 2 ? `${hoverNode.name}  ${orbText(hoverNode)}` : hoverNode.name;
    add(hoverNode, 900, THEME.LABEL_HOVER_PX, THEME.LABEL_COLOR, text);
  }
  // Children: bigger subtrees first (folders before files, since a file has weight 1).
  for (const child of focusNode.children) {
    const orb = child.state === 2;
    add(child, 500 + 10 * Math.log2(child.weight), THEME.LABEL_FONT_PX,
      orb ? THEME.LABEL_ORB_COLOR : THEME.LABEL_COLOR, orb ? orbText(child) : child.name);
  }
  // Collapsed orbs anywhere: the bigger on screen, the more important.
  for (const node of collapsedNodes) {
    if (seen.has(node.id)) continue;
    const s = projectForLabel(node);
    if (s && visibleOnScreen(s.x, s.y)) add(node, 100 + Math.min(s.r, 50), THEME.LABEL_ORB_PX, THEME.LABEL_ORB_COLOR, orbText(node));
  }
  return out;
}

// Pointer hover (mouse only): the node under the pointer gets a label.
let hoverPending = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons !== 0) { hoverPending = null; hoverNode = null; return; }
  hoverPending = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerleave', () => { hoverPending = null; hoverNode = null; });

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
  uTime.value = FROZEN_TIME ?? now / 1000; // ?time=12.5 freezes the shader clock (repeatable screenshots)
  uBloom.value = performance.now() / 1000;  // bloom clock: always real time
  if (nav.update(now)) dirty = true;        // camera damping + the refocus glide (navigation.js)
  if (dirty) {
    const f = nav.focusPoint;
    focusUniforms._Focus.value.set(f.x, f.y, f.z); // the whole GPU refocus
    shownStale = true;                              // CPU copy is rebuilt only if a pick needs it
    updateExpansion();                              // open / close files near the focus
    updateSemanticZoom();                                                      // collapse / expand folders by distance
    updateHalos();                                                             // halos copy each node's state, so refresh them too
    dirty = false;
  }
  nebula.position.copy(camera.position); // the sky follows the camera, so it never shows parallax
  if (hoverPending) { hoverNode = pickNode(hoverPending.x, hoverPending.y); hoverPending = null; } // at most once per frame
  renderer.info.reset();                  // we count draw calls of BOTH passes below
  renderer.clear();
  renderer.render(scene, camera);         // pass 1: the 3D galaxy
  labels.update(collectLabelCandidates());
  labels.render();                        // pass 2: labels on top (one batched draw call)
  requestAnimationFrame(frame);
}

async function start() {
  // ?tree=name.json loads public/data/name.json instead of the sample.
  const file = new URLSearchParams(location.search).get('tree') || 'sample_tree.json';
  const url = `${import.meta.env.BASE_URL}data/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);

  const json = await response.json();
  const tree = buildTree(json);
  root = tree.root;
  nodes = tree.nodes;
  computeLayout3d(root);
  // Symbol and source files sit in folders named by the tree JSON, relative to the tree file's folder.
  const baseUrl = url.slice(0, url.lastIndexOf('/') + 1);
  store = createSymbolStore(baseUrl, json.symbolsDir, json.sourceDir);
  symbolFiles = nodes.filter((n) => n.hasSymbols);
  codePanel = createCodePanel({ onInset: nav.setInset });

  labels = createLabels(renderer);
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
  get animating() { return nav.animating; },
  get allNodes() { return allNodes; },
  nodeById: (id) => nodeById[id],
  get dynamicCount() { return dynamicCount; },
  get openFiles() { return [...openFiles].map((f) => f.id); },
  get symbolFileIds() { return symbolFiles.map((f) => f.id); },
  get panelVisible() { return codePanel.visible; },
  get panelText() { return codePanel.element.innerText; },
  get focusNode() { return focusNode; },
  get labelCount() { return labels.count; },
  labelDebug: () => labels.debug(),
  get visibleCount() { return visibleCount; },
  get collapsedCount() { return collapsedNodes.length; },
  nodeState: (id) => nodeById[id].state,
  pick: (x, y) => { const n = pickNode(x, y); return n ? n.id : null; },
  orbIds: () => collapsedNodes.map((n) => n.id),
  setHover: (id) => { hoverNode = id === null ? null : nodeById[id]; },
  get spinning() { return nav.spinning; },
  setSpin: nav.setSpin,
  get drawCalls() { return renderer.info.render.calls; },
  get triangles() { return renderer.info.render.triangles; },
  quality: LOW ? 'low' : 'high',
  // Compare the GPU's Möbius maths with the CPU's (see gpucheck.js).
  gpuCheck: (count, maxRadius) => gpuCheck(renderer, count, maxRadius),
  // Where the GPU says it drew a node, read back from the uniform + CPU formula.
  get focusPoint() { return nav.focusPoint; },
  // Shown radius of a node's position (0 = at the centre of the ball).
  shownR: (id) => { ensureShown(); return vLength(shown[id]); },
  // Position (from the CPU copy) of any live node id, symbols included.
  shownPos: (id) => { ensureShown(); return shown[id]; },
  // Screen (CSS pixel) position of a node's centre, or null if behind the camera.
  screenPos: (id) => projectNode(id, renderer.domElement.getBoundingClientRect()),
};
