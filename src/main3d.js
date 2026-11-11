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
//   6. (Phase 4c) Imports and calls (links.json, resolved by the scanner) are drawn as bundled glowing arcs: only the
//      links of the focus and of the hovered node, at most 300, routed through the tree (hierarchical edge bundling,
//      links.js) and drawn by ONE instanced mesh whose vertex shader builds a hyperbolic Bézier curve (glsl.js).
//      Clicking an arc (or its far end, or an entry of the panel's link lists) follows it and remembers where you came
//      from; Backspace goes back.

import * as THREE from 'three';
import { vNeg, vLength, mobiusAdd3, conformalFactor3, hyperbolicDistance3, geodesicBezier3, geodesicLerp3 } from './mobius3d.js';
import { computeLayout3d, layoutSymbols, assignFitAll, nodePath } from './layout3d.js';
import { createNavigation } from './navigation.js';
import { createSymbolStore, buildSymbolNodes, hash01 } from './symbols.js';
import {
  createLinkData, linkCounts, subjectOf, selectLinks, buildArcs, arcTarget, bundledControlPoints, linkLists, symbolName,
  confidenceDots, liftEnd, MAX_VISIBLE_LINKS, CONTROL_POINTS,
} from './links.js';
import { createToolbar } from './toolbar.js';
import { createIndex } from './search.js';
import { createSearchUI } from './searchui.js';
import { createInfoCard } from './infocard.js';
import { createMinimap } from './minimap.js';
import { treeFileFromUrl } from './dataset.js';
import { makeDisplayTree, groupLabel, CAP_DESKTOP, CAP_PHONE } from './displaytree.js';
import { aggregateRule, childAllowed } from './disclosure.js';
import { createMemberList } from './memberlist.js';
import { dataLayerFor } from './diseasedata.js';
import { createDiseasePanel } from './diseasepanel.js';
import { deriveCapabilities, NO_CAPABILITIES } from './capabilities.js';
import { computeHeat, encodeHeat, HEAT, HEAT_NAMES } from './heat.js';
import { createCodePanel } from './codepanel.js';
import { createFpsCounter } from './fps.js';
import { detectTier, settingsFor, createAdaptive } from './quality.js';
import { createIdleFade } from './idlefade.js';
import {
  NODE_VERT, NODE_FRAG, NEBULA_VERT, NEBULA_FRAG, HAZE_VERT, HAZE_FRAG,
  SUN_VERT, SUN_FRAG, EDGE_VERT, EDGE_FRAG, DUST_VERT, DUST_FRAG, LINK_VERT, LINK_FRAG,
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
const ARC_PICK_PX = 10;         // a click this close to a link arc (and no node under it) follows the arc
const ARC_WINS_PX = 5;          // ... and a click THIS close to an arc line follows it even if a node is under the pointer (mouse)
const ARC_WINS_TOUCH_PX = 9;    // same for a finger (less precise)
const ARC_FOCUS_GUARD_PX = 14;  // ... except right around the focus itself (all its arcs start there): that click means the focus
const ARC_PICK_STEPS = 40;      // an arc is measured as a polyline of this many pieces

// Debug: ?time=12.5 freezes the clock the shaders animate with, so screenshots are repeatable.
const FROZEN_TIME = new URLSearchParams(location.search).has('time')
  ? Number(new URLSearchParams(location.search).get('time')) : null;

// Quality tier (quality.js): 'high' on desktop, 'phone' on a phone (automatic), 'low' with ?quality=low; ?quality=high|phone|low overrides.
//   maxHalos: halo quads (focus + this many children - 1) · octaves: nebula noise layers · starLayers: starfield layers
//   pixelRatio: cap on render resolution (device pixels per CSS pixel) · dustCount: faint background specks inside the ball
//   edgeSegments: pieces per curved edge · linkSegments: pieces per link arc
const TIER = detectTier();
const QUALITY = settingsFor(TIER);

// Link filters (Phase 4c): I toggles import arcs, K toggles call arcs. ?links=0 starts with both off.
let showImports = new URLSearchParams(location.search).get('links') !== '0';
let showCalls = showImports;
// A whole folder's imports are a hairball for a newcomer, so they are OFF until asked for (D key / Dependencies chip).
// Hovering a file still previews its own arcs.
let showFolderDeps = false;
let caps = NO_CAPABILITIES;     // which optional features this dataset supports (capabilities.js); set once the tree is loaded
// Short help line (the buttons and the "?" card explain the rest); keys for people who like them.
function updateHelp() {
  document.getElementById('help').textContent =
    caps.symbols
      ? 'Drag to look · scroll to zoom · click a node to fly in · keys: Backspace back · I imports · K calls · D folder deps · C code · F fps'
      : 'Drag to look · scroll to zoom · click a node to fly in · keys: Backspace back · / search · F fps';
  if (typeof refreshToolbar === 'function') refreshToolbar();
}
// Real nodes below a node: navigation groups are display nodes, not diseases, so they are not counted.
const realCount = (n) => (n.realWeight ?? n.weight) - 1;
const MAX_CODE_ORB_LABELS = 4;  // at file/symbol level, label at most this many "+N" orbs (the biggest on screen)
const COLLAPSE_MIN_NODES = 4;   // folders with fewer nodes inside than this are never collapsed (a "+2" orb is pointless)
const fps = createFpsCounter(() => `${labels ? labels.count : 0} labels · ${visibleCount} nodes · ${dynamicCount} symbols · ${linkArcs.length} links`);

// ---------------------------------------------------------------------------
// three.js scene: a perspective camera orbiting the centre of the unit ball
// ---------------------------------------------------------------------------
// No MSAA: nodes are soft additive glows (no hard edges to smooth), and MSAA is expensive on phones.
const renderer = new THREE.WebGLRenderer({ antialias: false });
// Two passes per frame (3D scene, then the label overlay), so we clear by hand and count draw calls ourselves.
renderer.autoClear = false;
renderer.info.autoReset = false;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.pixelRatio));
// Adaptive step: lower the resolution if the frame rate stays under ~50 for 2 s (phones by default; ?adapt=1 / ?adapt=0 forces it).
const adaptParam = new URLSearchParams(location.search).get('adapt');
const adaptive = createAdaptive({
  pixelRatio: renderer.getPixelRatio(),
  enabled: adaptParam !== '0',   // on for every tier now; ?adapt=0 switches it off
  fps: TIER === 'phone' ? THEME.ADAPT_FPS : THEME.DESKTOP_ADAPT_FPS,
  seconds: TIER === 'phone' ? THEME.ADAPT_SECONDS : THEME.DESKTOP_ADAPT_SECONDS,
  onLower: (ratio) => { renderer.setPixelRatio(ratio); resize(); },
});

// The interface fades while you only look (touch screens; idlefade.js). Labels are drawn by WebGL, so they get the level by callback.
const idleFade = createIdleFade({ onLevel: (v) => { if (labels) labels.setOpacity(v); } });
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
// Strength 0..1 of the search-result path highlight (set every frame from the time since the highlight started).
const uMark = { value: 0 };
// 1 for a folder focus, SYMBOL_FOCUS_SCALE for a file or symbol focus: shrinks the focus "sun" at code level.
const uFocusScale = { value: 1 };
// 1 while git heat is on (nodes without git data are dimmed), else 0.
const uHeatOn = { value: 0 };
// Size factor for the current zoom (see updateZoomSize): 1 at the default camera distance, smaller when closer.
const uZoomSize = { value: 1 };

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
  linkUniforms.uResolution.value.copy(buf);
  linkUniforms.uLineWidth.value = THEME.LINK_WIDTH_PX * renderer.getPixelRatio();
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

// Links (Phase 4c)
let displayInfo = null;         // displaytree.js statistics: cap, groups, list-only nodes
let memberList = null;          // the member list of a list-only node (memberlist.js)
let diseasePanel = null;        // the disease panel (diseasepanel.js): replaces the info card for the Disease Ontology; null elsewhere (or with ?panel=0)
let diseaseData = null;         // the disease data layer (diseasedata.js): null for datasets without one; loads its files lazily
let linkData = null;            // links.json in typed arrays (links.js), null until loaded / if the dataset has none
let linkArcs = [];              // the arcs drawn right now (buildArcs in links.js), at most MAX_VISIBLE_LINKS
let linkSelected = 0;           // links selected for the focus + hover before merging and capping
let linksDirty = true;          // focus, hover, open files, collapsed folders or filters changed: rebuild the arcs
let linkBornAt = new Map();     // arc key -> time it appeared (so an arc that stays does not fade in again)
const fileById = new Map();     // file id (symbols-file number) -> base tree file node
let pendingSymbol = null;       // { fileId, sym }: glide to this symbol as soon as its file has opened
let linkMesh = null;            // every visible link as an instanced thick curved strip (1 draw call)

let shown = [];                 // per node: transformed position {x, y, z} (CPU copy, ONLY for picking)
let shownStale = true;          // is `shown` out of date? (it is rebuilt lazily when a pick needs it)
let shownRadius = null;         // per node: drawn core radius (world units), for picking

let nodeMesh = null;            // ONE instanced quad mesh holding every node (1 draw call)
let haloMesh = null;            // a few additive glow quads behind the focus and its children (1 draw call)
let edgeMesh = null;            // every edge as an instanced thick-line strip (1 draw call)
let sunMesh = null;             // the focus sun billboard (1 draw call)
let dustMesh = null;            // faint background specks (1 draw call)

// The two shader uniforms that change on refocus. _Focus is the whole GPU refocus.
const focusUniforms = { _Focus: { value: new THREE.Vector3() }, uFocusId: { value: -1 }, uTime, uBloom, uMark, uFocusScale, uHeatOn, uZoomSize };
const edgeUniforms = { _Focus: focusUniforms._Focus, uTime, uBloom, uMark, uResolution: { value: new THREE.Vector2(1, 1) }, uLineWidth: { value: 1.8 } };
const sunUniforms = { _Focus: focusUniforms._Focus, uFocusPos: { value: new THREE.Vector3() }, uTime, uFocusScale };
const linkUniforms = { _Focus: focusUniforms._Focus, uTime, uBloom, uResolution: { value: new THREE.Vector2(1, 1) }, uLineWidth: { value: 2.2 }, uGain: { value: 1 } };

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
    aState: add('aState', 1), aOrigin: add('aOrigin', 3), aBorn: add('aBorn', 1), aMark: add('aMark', 1), aFit: add('aFit', 1),
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
  a.aFit[slot] = node.fit ?? 1;       // size limit from the neighbours (1 = no limit)
  a.aMark[slot] = node.mark ?? 0;     // 1 while on the highlighted search path
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
  const eg = makeStripGeometry(QUALITY.edgeSegments);
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
  const eMark = ea('aMark', 1);
  edgeArr = { eA, eB, eHue, eEnergy, eSeed, eHide, eBorn, eMark };
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

  buildLinkMesh();
}

// A thin strip of SEG pieces: a pair of vertices (left, right) at each of SEG+1 stops along a curve. aT = 0..1 is how far
// along the pair is, aSide = -1 / +1 which side. Edges and links both use it; their vertex shaders bend it into a curve.
function makeStripGeometry(SEG) {
  const g = new THREE.InstancedBufferGeometry();
  const verts = (SEG + 1) * 2;
  const aT = new Float32Array(verts), aSide = new Float32Array(verts);
  for (let i = 0; i <= SEG; i++) {
    aT[2 * i] = aT[2 * i + 1] = i / SEG;
    aSide[2 * i] = -1; aSide[2 * i + 1] = 1;
  }
  const idx = [];
  for (let i = 0; i < SEG; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3)); // unused, three.js wants one
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  return g;
}

// Links: ONE instance per visible arc (at most MAX_VISIBLE_LINKS), 5 control points each (glsl.js LINK_VERT).
function buildLinkMesh() {
  const g = makeStripGeometry(QUALITY.linkSegments);
  g.arrays = {};
  const add = (name, size) => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VISIBLE_LINKS * size), size);
    g.setAttribute(name, attr);
    g.arrays[name] = attr.array;
  };
  for (let k = 0; k < CONTROL_POINTS; k++) add(`aP${k}`, 3);
  for (const name of ['aType', 'aConf', 'aCount', 'aRole', 'aSeed', 'aBorn']) add(name, 1);
  g.instanceCount = 0;
  linkMesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: linkUniforms, vertexShader: LINK_VERT, fragmentShader: LINK_FRAG, defines: THEME_DEFINES,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    side: THREE.DoubleSide,
  }));
  linkMesh.frustumCulled = false;
  linkMesh.renderOrder = 0;
  linkMesh.visible = false;
  scene.add(linkMesh);
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
  if (node === focusNode) rho = THEME.FOCUS_R * uFocusScale.value;
  else if (node.type === 'folder') {
    const hero = node.seed >= THEME.HERO_AT ? THEME.HERO_SIZE : 1;
    rho = THEME.FOLDER_R * (1 + THEME.SIZE_SPREAD * node.energy) * hero;
    if (node.state === 2) rho *= THEME.COLLAPSED_SIZE;
  } else if (node.type === 'symbol') {
    const base = [THEME.CLASS_R, THEME.FUNCTION_R, THEME.METHOD_R, THEME.BLOCK_R][node.kindCode - 2];
    rho = base * (1 + THEME.SYMBOL_SIZE_SPREAD * node.energy);
    if (node.state === 2) rho *= THEME.COLLAPSED_SIZE;
  } else rho = THEME.FILE_R;
  if (node !== focusNode) rho = Math.min(rho, node.fit ?? 1) * uZoomSize.value;   // same limits as the shader (aFit, uZoomSize)
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
    // Navigation groups and list-only nodes follow disclosure.js (closed unless on the focus path); everything else the distance rule below.
    const rule = aggregateRule(node);
    if (hidden) state = 1;
    else if (rule) { node.collapsed = rule.orb; state = rule.orb ? 2 : 0; }
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
    for (const child of node.children) visit(child, childrenHidden || !childAllowed(rule, child));
  };
  visit(root, false);

  if (changed) {
    nodeMesh.geometry.attributes.aState.needsUpdate = true;
    edgeMesh.geometry.attributes.aHide.needsUpdate = true;
    shownStale = true;                       // sizes of orbs changed: rebuild the pick radii
    linksDirty = true;                       // link ends may now land on (or leave) an orb
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
    node.flag = heatFlagFor(node);   // symbols of a hot file glow hot too
    node.energy = node.energy ?? 0.5;
    slotFor(node);
    writeInstance(g, node.id, node);
    // Its edge lives in the edge slot parallel to the node slot.
    const e = baseEdgeCount + (node.id - baseCount);
    node.edgeIndex = e;
    edgeArr.eA.set([node.parent.pos.x, node.parent.pos.y, node.parent.pos.z], e * 3);
    edgeArr.eB.set([node.pos.x, node.pos.y, node.pos.z], e * 3);
    edgeArr.eHue[e] = node.hue; edgeArr.eEnergy[e] = node.energy; edgeArr.eSeed[e] = node.seed;
    edgeArr.eHide[e] = 0; edgeArr.eBorn[e] = bornAt; edgeArr.eMark[e] = 0;
    dynamicCount++;
    allNodes.push(node);
  }
  g.instanceCount = highWater;
  edgeMesh.geometry.instanceCount = baseEdgeCount + (highWater - baseCount);
  uploadBuffers();
}

function uploadBuffers() {
  for (const name of Object.keys(nodeMesh.geometry.arrays)) nodeMesh.geometry.attributes[name].needsUpdate = true;
  for (const name of ['aA', 'aB', 'aHue', 'aEnergy', 'aSeed', 'aHide', 'aBorn', 'aMark']) edgeMesh.geometry.attributes[name].needsUpdate = true;
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
  assignFitAll(file, THEME.NODE_FIT_FRACTION);
  addSymbolNodes(file, made);
  // Symbol index -> node, so link ends (file id, symbol index) find their node (Phase 4c).
  file.symByIndex = new Map(made.filter((n) => n.symIndex >= 0).map((n) => [n.symIndex, n]));
  file.symState = 'open';
  openFiles.add(file);
  dirty = true; // semantic zoom, halos and the info line must see the new children
  linksDirty = true;
  if (focusNode === file) updateInfo();
  // A link led to a symbol of this file while it was closed: continue the glide to that symbol now.
  if (pendingSymbol && pendingSymbol.fileId === file.fileId) {
    const target = file.symByIndex.get(pendingSymbol.sym);
    pendingSymbol = null;
    if (target && focusNode === file) focusOn(target);
  }
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
  file.symByIndex = null;
  file.symState = undefined;
  openFiles.delete(file);
  uploadBuffers();
  dirty = true;
  linksDirty = true;
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
  // Nearest first, but the file we are gliding to (or are inside) always first: a followed link must open it.
  near.sort((a, b) => (b.file === focusFile) - (a.file === focusFile) || a.d - b.d);
  near.slice(0, MAX_OPEN_FILES).forEach(({ file }) => { openFile(file); });
}

// ---------------------------------------------------------------------------
// Focusing
// ---------------------------------------------------------------------------

// Start moving the view so that `node` ends up at the centre.
function focusOn(node, animate = true, via = null) {
  if (!node) return;
  // A link glide waiting for a file to open is cancelled when the user focuses anything else.
  if (pendingSymbol && node !== fileById.get(pendingSymbol.fileId)) pendingSymbol = null;
  focusNode = node;
  focusUniforms.uFocusId.value = node.id;
  sunUniforms.uFocusPos.value.set(node.pos.x, node.pos.y, node.pos.z);
  uFocusScale.value = node.type === 'folder' ? 1 : THEME.SYMBOL_FOCUS_SCALE;
  if (minimap) minimap.setFocus(node.type === 'symbol' ? node.file : node);
  nav.flyTo(node.pos, animate, via);
  idleFade.poke();                  // a focus change (even one made by search or a link) wakes the interface
  if (diseasePanel) diseasePanel.select(node); else if (memberList) memberList.update(node);
  updateInfo();
  showCode(node);
  updatePanelLinks();
  dirty = true;
  linksDirty = true;
  refreshToolbar();
  // The search result was a symbol of a file that was closed: now that it exists, light the last step of the path too.
  if (markTarget && node.type === 'symbol' && node.file.fileId === markTarget.fileId && node.symIndex === markTarget.sym) markPath(node, false);
}
import { neighbours, callTargets, importTargets, definitionLines, subtreeIndexes } from './codecontext.js';

async function showCode(node) {
  const file = node.type === 'symbol' ? node.file : node;
  if (!caps.codePanel || !file || !file.hasSymbols || node.type === 'folder') { codePanel.hide(); return; }
  const [lines, doc] = await Promise.all([store.getLines(file), store.getDoc(file)]);
  if (focusNode !== node) return;
  const from = node.type === 'symbol' ? node.startLine : 1;
  const to = node.type === 'symbol' ? node.endLine : (file.loc || (lines ? lines.length : 1));
  const nb = neighbours(node);
  const neighbour = (n) => (n ? { name: n.name, tap: () => goToPlace(placeOf(n), true) } : null);

  codePanel.show({
    title: node.name,
    subtitle: `${nodePath(file)} · lines ${from}–${to}`,
    lines, from, to, lang: file.ext === 'py' ? 'py' : 'js',
    context: node.type === 'symbol' && node.kind !== 'block'
      ? { lines: THEME.CODE_CONTEXT_LINES, prev: neighbour(nb.prev), next: neighbour(nb.next) } : null,
    tokens: lines ? codeTokens(node, file, doc) : null,
    onToken: followToken,
  });
}

const relPath = (file) => (file ? nodePath(file).split('/').slice(1).join('/') : '');

function codeTokens(node, file, doc) {
  if (!linkData || !doc) return null;
  const isSymbol = node.type === 'symbol';
  const symSet = !isSymbol ? null : node.symIndex >= 0 ? subtreeIndexes(doc, node.symIndex) : new Set([-1]);
  const calls = callTargets(linkData, file.fileId, symSet, isSymbol ? node.symIndex : null);
  const candidates = linkLists(linkData, { fileId: file.fileId, sym: null }).imports
    .map((e) => ({ fileId: e.fileId, path: relPath(fileById.get(e.fileId)) }));
  const imports = importTargets(doc.imports, relPath(file), candidates);
  return { calls, imports, skipLines: definitionLines(doc) };
}

function followToken(kind, entry) {
  const type = kind === 'import' ? LINK_IMPORT : LINK_CALL;
  const arc = linkArcs.find((a) => a.type === type && !a.target.node && a.target.fileId === entry.fileId && a.target.sym === entry.sym);
  if (arc) followArc(arc); else goToPlace({ fileId: entry.fileId, sym: entry.sym }, true);
}

// ---------------------------------------------------------------------------
// Links (Phase 4c): which arcs to draw, the panel lists, following a link, going back
// ---------------------------------------------------------------------------

// The node that stands for a link end right now: the symbol node if its file is open, else the file; if that node
// is hidden inside a collapsed folder or class, its nearest visible ancestor (the "+N" orb). null if unknown.
function resolveEnd(fileId, sym) {
  const file = fileById.get(fileId);
  if (!file) return null;
  let node = (sym >= 0 && file.symByIndex && file.symByIndex.get(sym)) || file;
  while (node && node.state === 1) node = node.parent;
  return node;
}

// Rebuild the visible arcs (only when something changed: focus, hover, opened/closed files, orbs, filters).
// Each arc gets its 5 bundled control points (links.js) and its look attributes; the GPU does the rest every frame.
function updateLinks() {
  linksDirty = false;
  const g = linkMesh.geometry;
  if (!linkData) return;
  const selected = selectLinks(linkData, {
    focus: focusNode.type === 'folder' && !showFolderDeps ? null : subjectOf(focusNode),
    hover: hoverNode && hoverNode !== focusNode ? subjectOf(hoverNode) : null,
    showImports, showCalls, fileNode: (id) => fileById.get(id),
  });
  linkSelected = selected.length;
  // A focused folder shows the imports between its parts merged per sub-folder (liftEnd), not file by file.
  const folder = focusNode.type === 'folder' ? focusNode : null;
  const endOf = folder ? (fileId, sym) => liftEnd(resolveEnd(fileId, sym), folder) : resolveEnd;
  linkArcs = buildArcs(linkData, selected, endOf, MAX_VISIBLE_LINKS);
  const focusSubject = subjectOf(focusNode);
  const a = g.arrays;
  const now = performance.now() / 1000;
  const born = new Map();
  linkArcs.forEach((arc, i) => {
    arc.points = bundledControlPoints(arc.a, arc.b, THEME.LINK_TENSION);
    arc.points.forEach((p, k) => a[`aP${k}`].set([p.x, p.y, p.z], i * 3));
    arc.target = arcTarget(linkData, arc, focusSubject);
    arc.far = arc.target.drawn || arc.target.node;
    a.aType[i] = arc.type;
    a.aConf[i] = arc.conf;
    a.aCount[i] = arc.count;
    a.aRole[i] = arc.role === 'hover' ? 1 : folder ? 2 : 0;
    a.aSeed[i] = hash01(arc.links[0]);
    const t = linkBornAt.get(arc.key) ?? now;    // arcs that were already there do not fade in again
    born.set(arc.key, t);
    a.aBorn[i] = t;
  });
  linkBornAt = born;
  g.instanceCount = linkArcs.length;
  // Exposure: many arcs share the glow, so a dense bundle does not burn out to white.
  // Example (LINK_CROWD 20): 20 arcs or fewer -> 1; 80 arcs -> sqrt(20/80) = 0.5; 320 -> 0.25.
  linkUniforms.uGain.value = Math.min(1, Math.sqrt(THEME.LINK_CROWD / Math.max(linkArcs.length, 1)));
  for (const name of Object.keys(a)) g.attributes[name].needsUpdate = true;
  linkMesh.visible = linkArcs.length > 0;
}

// Where we are, in a form that can be found again later (symbol nodes are rebuilt when a file reopens, so a
// symbol is remembered by file id + symbol index, everything else by its base tree id, which never changes).
function placeOf(node) {
  if (node.type === 'symbol') return { fileId: node.file.fileId, sym: node.symIndex };
  return { baseId: node.id };
}

// Glide to a place. `remember` = push the current focus on the back stack (following a link does; going back does not).
// A symbol of a CLOSED file: glide to the file; the file opens on the way (it is always first in line to open), and
// as soon as its symbols exist openFile() continues the glide to the symbol (a second short glide starting from
// wherever the first one is, so it reads as one movement).
function goToPlace(place, remember, viaArc = null) {
  let target;
  if (place.baseId !== undefined) target = nodeById[place.baseId];
  else {
    const file = fileById.get(place.fileId);
    if (!file) return;
    target = (place.sym >= 0 && file.symByIndex && file.symByIndex.get(place.sym)) || file;
    pendingSymbol = target === file && place.sym >= 0 && file.symState !== 'open' ? place : null;
  }
  if (!target || (target === focusNode && !pendingSymbol)) return;
  if (remember) nav.pushBack(placeOf(focusNode));
  // Following an arc: glide ALONG the arc (its curve), not along the straight geodesic, when the arc really ends at this target.
  focusOn(target, true, viaArc && target === viaArc.far ? arcRoute(viaArc) : null);
  updateBackButton();
}

function goBack() {
  const place = nav.popBack();
  if (place) goToPlace(place, false);
  updateBackButton();
}

// Follow an arc: to the exact symbol/file at its far end (or the drawn node if it merges several targets).
function followArc(arc) {
  const t = arc.target;
  goToPlace(t.node ? placeOf(t.node) : { fileId: t.fileId, sym: t.sym }, true, arc);
}

// The ball points along an arc from its near end to its far end (what the camera flies through when you follow it).
// The arc is a hyperbolic Bézier curve through its 5 bundled control points (links.js); sample it at 1/20 .. 19/20 of
// the way. Control points run a -> b; if the far end is `a` the list is reversed so we travel toward the far end.
const ARC_ROUTE_STEPS = 20;
function arcRoute(arc) {
  const ctrl = arc.far === arc.b ? arc.points : [...arc.points].reverse();
  const route = [];
  for (let k = 1; k < ARC_ROUTE_STEPS; k++) route.push(geodesicBezier3(ctrl, k / ARC_ROUTE_STEPS));
  return route;
}

// The arc under the pointer (only used when no node is under it). CPU copy of the GPU curve: refocus the control
// points, sample the hyperbolic Bézier curve, project, and take the arc that passes closest (within ARC_PICK_PX).
// Only the far half of each arc counts, so a click right next to the focus still means the focus.
function pickArc(clientX, clientY, maxPx = ARC_PICK_PX, focusOnly = false) {
  const shift = vNeg(nav.focusPoint);
  // Right around the focus every arc of the focus starts: a click there means the focus, not "some arc".
  const rect = renderer.domElement.getBoundingClientRect();
  const fs = focusNode ? projectNode(focusNode.id, rect) : null;
  const guard = fs ? fs.r + ARC_FOCUS_GUARD_PX : 0;
  let best = null, bestD = maxPx;
  for (const arc of linkArcs) {
    // focusOnly: the faint hover previews (the arcs of the node under the mouse) must not steal a click that is aimed at that node.
    if (focusOnly && arc.role !== 'focus') continue;
    const pts = arc.points.map((p) => mobiusAdd3(shift, p));
    // The WHOLE arc counts: project it as a polyline and measure the distance from the click to each piece (a piece, not just
    // its corners, so a click between two samples is still close to the line).
    let prev = null;
    for (let k = 0; k <= ARC_PICK_STEPS; k++) {
      const s = projectPoint(geodesicBezier3(pts, k / ARC_PICK_STEPS));
      if (s && prev) {
        const mx = (s.x + prev.x) / 2, my = (s.y + prev.y) / 2;
        if (!fs || Math.hypot(mx - fs.x, my - fs.y) > guard) {
          const d = distToSegment(clientX, clientY, prev.x, prev.y, s.x, s.y);
          if (d < bestD) { bestD = d; best = arc; }
        }
      }
      prev = s;
    }
  }
  return best;
}

// Distance from the point (px, py) to the segment (ax, ay)-(bx, by): project the point onto the segment's line, clamp the
// position to the segment (0..1), and measure to that spot.  Example: segment (0,0)-(10,0), point (4,3) -> t = 0.4, nearest
// spot (4,0), distance 3.  Point (15,0) -> t clamps to 1, nearest spot (10,0), distance 5.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// The panel's "Imports / Imported by / Calls / Called by" lists for the focus.
function updatePanelLinks() {
  if (!codePanel) return;
  const subject = subjectOf(focusNode);
  if (!linkData || !subject || subject.folder) { codePanel.setLinks([], null); return; }
  const lists = linkLists(linkData, subject);
  const entry = (e) => {
    const file = fileById.get(e.fileId);
    const path = file ? nodePath(file).split('/').slice(1).join('/') : '';
    const name = symbolName(linkData, e.fileId, e.sym) ?? (file ? file.name : '?');
    return { ...e, name, sub: path, dots: confidenceDots(e.conf) };
  };
  codePanel.setLinks([
    { title: 'Imports', color: THEME.LINK_IMPORT_COLOR, entries: lists.imports.map(entry) },
    { title: 'Imported by', color: THEME.LINK_IMPORT_COLOR, entries: lists.importedBy.map(entry) },
    { title: 'Calls', color: THEME.LINK_CALL_COLOR, entries: lists.calls.map(entry) },
    { title: 'Called by', color: THEME.LINK_CALL_COLOR, entries: lists.calledBy.map(entry) },
  ], (e) => goToPlace({ fileId: e.fileId, sym: e.sym }, true));
}

// On-screen navigation (toolbar.js): Home, Up, Back and the link chips. Touch screens have no Backspace/I/K keys.
const toolbar = createToolbar({
  onSearch: () => { if (searchUI) searchUI.open(); },
  onHome: () => { if (root && focusNode !== root) focusOn(root); },
  onUp: () => { if (focusNode && focusNode.parent) focusOn(focusNode.parent); },
  onBack: () => goBack(),
  onImports: () => { showImports = !showImports; linksDirty = true; updateHelp(); },
  onCalls: () => { showCalls = !showCalls; linksDirty = true; updateHelp(); },
  onInfo: () => { const ui = diseasePanel || infoCard; if (ui) { ui.toggle(); refreshToolbar(); } },
  onHeat: () => cycleHeat(),
  onFolderDeps: () => { showFolderDeps = !showFolderDeps; linksDirty = true; updateHelp(); },
  onFullscreen: () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});   // refused (e.g. not from a tap): ignore
  },
});
// The part of the screen covered by a panel (code panel or disease panel): the picture is centred in what is left. The toolbar strip at the bottom
// also covers something (unless the compact landscape layout puts it at the left).
function applyInset(right, bottom) {
  const toolbarAtBottom = window.innerHeight > THEME.COMPACT_HEIGHT_PX;
  nav.setInset(right, bottom + (toolbarAtBottom ? THEME.TOOLBAR_BAND_PX : 0));
}
function refreshToolbar() {
  if (!focusNode) return;
  toolbar.update({
    backDepth: nav.backDepth, isRoot: !focusNode.parent,
    focusKind: focusNode.type === 'symbol' ? 'symbol' : focusNode.type === 'folder' ? 'folder' : 'file',
    showImports, showCalls, showFolderDeps,
    infoOpen: diseasePanel ? diseasePanel.open : infoCard ? infoCard.open : false, heatMode,
    hasGit: caps.gitHeat && !!(heatData && heatData.files), hasLinks: caps.dependencies,
  });
}
function updateBackButton() { refreshToolbar(); }
updateHelp();


// ---------------------------------------------------------------------------
// Search (Phase 6a)
// ---------------------------------------------------------------------------
// The index (search.js) holds every folder and file name at once; function/class names are added in the background:
// the symbol files are read 4 at a time, 25 files per slice, with a pause between slices so the page stays smooth.
let searchIndex = null;
let searchUI = null;
let indexStats = { treeMs: 0, symbolsMs: 0, files: 0, done: false };   // reported by __explorer.searchStats()
let markTarget = null;          // { fileId, sym } while a symbol result is highlighted (see markPath)
let markNodes = [];             // nodes currently carrying the path highlight
let markStart = 0;              // when the highlight started (performance.now)

function buildSearch() {
  searchIndex = createIndex();
  const t0 = performance.now();
  searchIndex.addTree(nodes.filter((n) => !n.isGroup), nodePath);   // navigation groups are not diseases: never search results
  indexStats.treeMs = performance.now() - t0;
  searchUI = createSearchUI({ index: searchIndex, onSelect: goToResult });
  indexStats.files = symbolFiles.length;
  setTimeout(indexSymbolsInBackground, 600);   // let the first frames and the first interaction go first
}

async function indexSymbolsInBackground() {
  const t0 = performance.now();
  const queue = symbolFiles.slice();
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      const doc = await store.getDoc(file, { cache: false });
      if (doc) searchIndex.addFileSymbols(file, nodePath(file), doc);
      if (++done % 25 === 0) {
        searchUI.setProgress(done / symbolFiles.length);
        await new Promise((resolve) => setTimeout(resolve, 0));   // give the page a turn
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  indexStats.symbolsMs = performance.now() - t0;
  indexStats.done = true;
  searchUI.setProgress(1);
}

// The user chose a search result: glide there (the previous place goes on the back stack, so ‹ Back returns),
// and light up the path from the root to it for a few seconds. The breadcrumb follows the focus by itself.
function goToResult(r) {
  const place = r.baseId >= 0 ? { baseId: r.baseId } : { fileId: r.fileId, sym: r.sym };
  goToPlace(place, true);
  markTarget = r.baseId >= 0 ? null : place;
  const file = fileById.get(r.fileId);
  // A symbol of a closed file has no node yet: light the path as far as the file now, the last step when it opens.
  const target = r.baseId >= 0 ? nodeById[r.baseId] : ((file && file.symByIndex && file.symByIndex.get(r.sym)) || file);
  if (target) markPath(target, true);
}

// Highlight root -> node: every node on the way and every edge between them gets aMark = 1; the shaders scale it
// by uMark, which stepMark() fades from 1 to 0 (PATH_HOLD_SECONDS at full strength, then PATH_FADE_SECONDS).
function markPath(node, restart) {
  setMarks(markNodes, 0);
  markNodes = [];
  for (let n = node; n; n = n.parent) markNodes.push(n);
  setMarks(markNodes, 1);
  if (restart || !markStart) markStart = performance.now();
}

function setMarks(list, value) {
  for (const n of list) {
    if (nodeById[n.id] !== n) continue;                          // freed slot: nothing to write
    nodeMesh.geometry.arrays.aMark[n.id] = value;
    if (n.edgeIndex !== undefined) edgeArr.eMark[n.edgeIndex] = value;
  }
  nodeMesh.geometry.attributes.aMark.needsUpdate = true;
  edgeMesh.geometry.attributes.aMark.needsUpdate = true;
}

// Fade: full strength for PATH_HOLD_SECONDS, then linear to 0 over PATH_FADE_SECONDS. Example (4 s, 1.5 s): at 4.75 s
// the strength is 1 - 0.75/1.5 = 0.5; at 5.5 s it is 0 and the marks are cleared.
function stepMark(now) {
  if (!markNodes.length) return;
  const t = (now - markStart) / 1000;
  const fade = t < THEME.PATH_HOLD_SECONDS ? 1 : Math.max(0, 1 - (t - THEME.PATH_HOLD_SECONDS) / THEME.PATH_FADE_SECONDS);
  uMark.value = fade;
  if (fade === 0) {
    setMarks(markNodes, 0);
    markNodes = []; markTarget = null; markStart = 0;
  }
}


// ---------------------------------------------------------------------------
// Git heat (Phase 6b) and the info card
// ---------------------------------------------------------------------------
let heatData = null;            // heat.js: { commits, recency, ... } per base node id (-1 = no git data)
let heatMode = HEAT.OFF;
let infoCard = null;
let minimap = null;            // small 2D map in a corner (minimap.js)
let datasetWords = { folder: 'Folder', file: 'File' };   // what this dataset calls its two node types (WordNet: Category / Word)
let fakeGit = false;            // the sample dataset's git history is generated, not real: say so on screen

// The aFlag value (see heat.js) for a node under the current heat mode. Symbols take their file's heat.
function heatFlagFor(node) {
  if (heatMode === HEAT.OFF || !heatData) return 0;
  const base = node.type === 'symbol' ? node.file : node;
  const arr = heatMode === HEAT.COMMITS ? heatData.commits : heatData.recency;
  return encodeHeat(arr[base.id]);
}

// H key / Heat button: off -> commits -> recency -> off. Only numbers change: aFlag of every node, one uniform.
function cycleHeat() {
  heatMode = (heatMode + 1) % 3;
  for (const node of allNodes) {
    node.flag = heatFlagFor(node);
    nodeMesh.geometry.arrays.aFlag[node.id] = node.flag;
  }
  nodeMesh.geometry.attributes.aFlag.needsUpdate = true;
  uHeatOn.value = heatMode === HEAT.OFF ? 0 : 1;
  updateLegend();
  refreshToolbar();
  dirty = true;     // the halos copy node data
}

const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);
function updateLegend() {
  if (!infoCard) return;                                   // (the disease panel has no heat legend)
  if (heatMode === HEAT.OFF || !heatData || !heatData.files) { infoCard.setLegend(null); return; }
  // Short title (the legend sits next to the node title); the tooltip says what grey means.
  const fake = fakeGit ? ' (FAKE data)' : '';
  const tip = fakeGit ? 'The sample dataset has generated, not real, git history. Grey = no git data.' : 'Grey = no git data.';
  if (heatMode === HEAT.COMMITS) infoCard.setLegend(`Heat: commits${fake}`, '1', `${heatData.maxCommits}`, tip);
  else infoCard.setLegend(`Heat: last change${fake}`, fmtDate(heatData.oldest), fmtDate(heatData.newest), tip);
}

// Facts about the focused node (the info card). Folders add up their files; symbols show their own lines and calls.
function updateInfoCard() {
  if (!infoCard) return;
  const n = focusNode;
  const rows = [];
  const file = n.type === 'symbol' ? n.file : n;
  const counts = linkData ? linkCounts(linkData, subjectOf(n), (id) => fileById.get(id)) : null;
  rows.push(['Path', n.type === 'symbol' ? `${nodePath(file)} › ${n.name}` : nodePath(n)]);
  const word = (t) => (t === 'folder' ? datasetWords.folder : datasetWords.file);
  if (n.type === 'folder') {
    let files = 0, commits = 0, newest = 0, loc = 0;
    for (let i = n.id + 1; i < n.id + n.weight; i++) {
      const f = nodes[i];
      if (f.type !== 'file') continue;
      files++; loc += f.loc || 0;
      if (f.commits) { commits += f.commits; newest = Math.max(newest, Date.parse(f.modified) || 0); }
    }
    rows.push(['Contains', caps.symbols ? `${n.children.length} items · ${files} files` : `${n.children.length} direct · ${realCount(n)} in all`]);
    if (loc) rows.push(['Lines of code', loc.toLocaleString()]);
    if (commits) rows.push(['Git commits', `${commits.toLocaleString()} (all files)`]);
    if (newest) rows.push(['Last modified', fmtDate(newest)]);
    if (!caps.symbols) rows.push(['Depth', `${n.depth} below the top`]);
  } else if (n.type === 'symbol') {
    rows.push(['Signature', n.signature]);
    rows.push(['Lines of code', `${n.endLine - n.startLine + 1} (${n.startLine}–${n.endLine})`]);
    rows.push(['In file', `${file.name} · ${file.commits ? `${file.commits} commits` : 'no git data'}`]);
  } else {
    if (n.loc) rows.push(['Lines of code', n.loc.toLocaleString()]);
    if (n.hasSymbols) rows.push(['Symbols', n.symState === 'open' ? String(dynamicCountOf(n)) : 'opens when you fly in']);
    if (n.commits) { rows.push(['Git commits', String(n.commits)]); rows.push(['Last modified', n.modified || '—']); }
    if (!caps.symbols) rows.push(['Depth', `${n.depth} below the top`]);
  }
  if (caps.dependencies) {
    if (counts) {
      if (n.type !== 'symbol') rows.push(['Imports', `${counts.importsOut} out · ${counts.importsIn} in`]);
      if (n.type !== 'folder') rows.push(['Calls', `${counts.callsOut} out · ${counts.callsIn} in`]);
    } else if (n.type !== 'folder') rows.push(['Imports / calls', '—']);
  }
  if (n.isGroup) {                                       // a navigation group is not a disease: say so plainly, show only facts about the list
    infoCard.setCard('Navigation group', [
      ['Part of', nodePath(n.parent)],
      ['Members', n.kind === 'subtypes' ? `${n.members} diseases that have subtypes` : n.kind === 'groups' ? `${n.members} groups` : `${n.members} diseases without subtypes`],
      ['Names', `${n.firstName} … ${n.lastName}`],
      ['Diseases inside', String(realCount(n))],
    ], 'An alphabetical run of names, made only to keep long lists readable. Not an ontology category.');
    return;
  }
  if (n.listOnly) rows.push(['Display', `${n.children.length} members listed, too close to draw one by one`]);
  const kind = n.type === 'symbol' ? n.kind : caps.symbols ? (n.type === 'folder' ? 'Folder' : `File${n.ext ? ` · .${n.ext}` : ''}`) : word(n.type);
  infoCard.setCard(kind, rows, fakeGit && (n.type !== 'symbol') ? 'Sample data: the git numbers are FAKE.' : null);
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
  if (n.isGroup) infoPath.textContent = `navigation group: ${n.members} ${n.kind} with names from ${n.firstName} to ${n.lastName}`;
  else if (n.type === 'folder') infoPath.textContent = `${n.children.length} items, ${realCount(n)} nodes inside · click one to fly in`;
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
  updateInfoCard();
}

// Breadcrumb: "repo / src / components" at a fixed place (bottom centre). Each segment is
// clickable and focuses that ancestor. Very long paths keep the first segment and the last
// four, with "…" in between.
const crumbs = document.createElement('div');
crumbs.id = 'crumbs';
Object.assign(crumbs.style, {
  position: 'fixed', left: 'calc((100vw + var(--sai-l) - var(--sai-r) - var(--panel-w, 0px)) / 2)', bottom: 'calc(34px + max(var(--sheet-h, 0px), var(--sai-b)))', transform: 'translateX(-50%)',
  maxWidth: 'calc(100vw - var(--panel-w, 0px) - 24px - var(--sai-l) - var(--sai-r))', padding: '4px 12px', borderRadius: '14px',
  font: `600 ${THEME.CRUMB_FONT_PX}px system-ui, sans-serif`,
  background: cssRgb(THEME.CRUMB_BG, THEME.CRUMB_BG_ALPHA), color: cssRgb(THEME.CRUMB_COLOR),
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 0 4px #000',
});
document.body.appendChild(crumbs);

function updateBreadcrumb() {
  const chain = [];
  // navigation groups are not part of the path of a disease (they are display aids): leave them out unless one IS the focus
  for (let n = focusNode; n; n = n.parent) if (!n.isGroup || n === focusNode) chain.unshift(n);
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

// Project a ball point (already refocused) to CSS pixels, or null if it is behind the camera.
function projectPoint(p) {
  tmp.set(p.x, p.y, p.z).applyMatrix4(camera.matrixWorldInverse);
  if (-tmp.z <= camera.near) return null;
  tmp.applyMatrix4(camera.projectionMatrix);
  return { x: ((tmp.x + 1) / 2) * window.innerWidth, y: ((1 - tmp.y) / 2) * window.innerHeight };
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

// Label sizes shrink in the compact layout (a phone held sideways has very little height).
const labelScale = () => (window.innerHeight <= THEME.COMPACT_HEIGHT_PX ? THEME.COMPACT_LABEL_SCALE : 1);

function collectLabelCandidates() {
  const k = labelScale();
  const out = [];
  const seen = new Set();
  const add = (node, priority, px, color, text) => {
    if (seen.has(node.id) || node.state === 1) return;
    const s = projectForLabel(node);
    if (!s || !visibleOnScreen(s.x, s.y)) return;
    seen.add(node.id);
    out.push({ key: node.id, text, x: s.x, y: s.y, r: s.r, priority, px, color });
  };
  // A folder orb says "+N"; a class/function orb also says WHAT it is ("Parser +12"), or a screen of bare "+N" tells nothing.
  // A navigation group says its alphabetical range and how many members it has ("A–F · 24"); a list-only node says its name too.
  const orbText = (node) => (node.isGroup ? groupLabel(node) : node.listOnly ? `${node.name} +${realCount(node)}`
    : node.type === 'symbol' ? `${node.name} +${node.weight - 1}` : `+${realCount(node)}`);

  add(focusNode, 1000, THEME.LABEL_FOCUS_PX * k, THEME.LABEL_COLOR, focusNode.name);
  if (hoverNode) {
    const text = hoverNode.state === 2 ? (hoverNode.isGroup ? orbText(hoverNode) : `${hoverNode.name}  ${orbText(hoverNode)}`) : hoverNode.name;
    add(hoverNode, 900, THEME.LABEL_HOVER_PX * k, THEME.LABEL_COLOR, text);
  }
  // Children: bigger subtrees first (folders before files, since a file has weight 1).
  for (const child of focusNode.children) {
    const orb = child.state === 2;
    add(child, 500 + 10 * Math.log2(child.weight), THEME.LABEL_FONT_PX * k,
      orb ? THEME.LABEL_ORB_COLOR : THEME.LABEL_COLOR, orb ? orbText(child) : child.name);
  }
  // The far ends of the focus's link arcs (where the arcs lead), surest links first.
  for (const arc of linkArcs.slice(0, 12)) {
    if (arc.role === 'focus' && arc.far && arc.far.state !== 2) {
      add(arc.far, 300 + 100 * arc.conf, THEME.LABEL_FONT_PX * k, THEME.LABEL_COLOR, arc.far.name);
    }
  }
  // Collapsed orbs anywhere: the bigger on screen, the more important.
  // At code level (a file or symbol focused) only the few biggest orbs are labelled, otherwise they bury the code shapes.
  const orbs = [];
  for (const node of collapsedNodes) {
    if (seen.has(node.id)) continue;
    const s = projectForLabel(node);
    if (s && visibleOnScreen(s.x, s.y)) orbs.push({ node, s });
  }
  orbs.sort((a, b) => b.s.r - a.s.r);
  const orbCap = focusNode.type === 'folder' ? Infinity : MAX_CODE_ORB_LABELS;
  for (const { node, s } of orbs.slice(0, orbCap)) add(node, 100 + Math.min(s.r, 50), THEME.LABEL_ORB_PX * k, THEME.LABEL_ORB_COLOR, orbText(node));
  return out;
}

// Pointer hover (mouse only): the node under the pointer gets a label.
let hoverPending = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons !== 0) {
    hoverPending = null;
    if (hoverNode) { hoverNode = null; linksDirty = true; }
    return;
  }
  hoverPending = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerleave', () => {
  hoverPending = null;
  if (hoverNode) { hoverNode = null; linksDirty = true; }
});

// Taps (navigation.js tells a tap from a drag, a pinch and a long press; a drag rotates the view instead).
//   tap on a node = fly to it (or follow the arc whose far end it is) · tap on an arc = follow it
//   touch DOUBLE-tap = go up to the parent. The first tap of the pair already focused something, so "up" is taken from where
//   we were BEFORE that tap (otherwise double-tapping a node would fly into it and then out to its own parent).
let focusBeforeTap = null;
nav.onTap(({ x, y, double, pointerType }) => {
  if (double) {
    const from = focusBeforeTap || focusNode;
    focusBeforeTap = null;
    if (from && from.parent) focusOn(from.parent);
    else if (from && from !== focusNode) focusOn(from);
    return;
  }
  focusBeforeTap = focusNode;
  // A click right on an arc line follows the arc, even over a node (arcs run through crowds of nodes; otherwise they could not be hit).
  const onArc = pickArc(x, y, pointerType === 'mouse' ? ARC_WINS_PX : ARC_WINS_TOUCH_PX, true);
  if (onArc) { followArc(onArc); return; }
  const picked = pickNode(x, y);
  // The "(top level)" block stands for the whole file's loose code: clicking it focuses the FILE (its code panel shows everything).
  const hit = picked && picked.kind === 'block' ? picked.file : picked;
  if (hit && hit !== focusNode) {
    // The far end of one of the focus's arcs: that is following a link (remembered for Backspace).
    const arc = linkArcs.find((a) => a.role === 'focus' && a.far === hit);
    if (arc) followArc(arc);
    else focusOn(hit);
  } else if (!hit) {
    const arc = pickArc(x, y);
    if (arc) followArc(arc);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace') {
    e.preventDefault(); // stop the browser from navigating "back"
    // Backspace = back to where the last followed link started; with nothing to go back to (or with Shift) = parent.
    if (!e.shiftKey && nav.backDepth > 0) goBack();
    else if (focusNode && focusNode.parent) focusOn(focusNode.parent);
  } else if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey) {
    if (caps.dependencies) { showImports = !showImports; linksDirty = true; updateHelp(); }
  } else if ((e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey) {
    if (caps.dependencies) { showCalls = !showCalls; linksDirty = true; updateHelp(); }
  } else if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey) {
    if (caps.gitHeat) cycleHeat();
  } else if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) {
    if (caps.dependencies) { showFolderDeps = !showFolderDeps; linksDirty = true; updateHelp(); }
  }
});

window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Main loop and startup
// ---------------------------------------------------------------------------
// Zoom-dependent size: zooming in magnifies sizes and distances equally, so crowds would stay crowded. Instead the cores shrink a
// little as the camera comes closer than its default distance:  factor = (distance / default)^ZOOM_SIZE_EXPONENT, between ZOOM_SIZE_MIN and 1.
// Example (exponent 0.7): camera at half the default distance -> 0.5^0.7 = 0.62: cores are 62 % as big while distances doubled on screen,
// so the gaps between them open up by a factor 3.2. At a quarter of the distance: 0.38.
function updateZoomSize() {
  const f = Math.min(1, Math.max(THEME.ZOOM_SIZE_MIN, Math.pow(nav.zoomRatio, THEME.ZOOM_SIZE_EXPONENT)));
  if (Math.abs(f - uZoomSize.value) > 1e-4) { uZoomSize.value = f; shownStale = true; }   // picking radii depend on it
}

function frame(now) {
  fps.tick(now);
  adaptive.tick(now, fps.value);
  idleFade.update(now);
  uTime.value = FROZEN_TIME ?? now / 1000; // ?time=12.5 freezes the shader clock (repeatable screenshots)
  uBloom.value = performance.now() / 1000;  // bloom clock: always real time
  stepMark(now);                            // fade of the search-path highlight
  updateZoomSize();
  if (nav.update(now)) dirty = true;        // camera damping + the refocus glide (navigation.js)
  if (dirty) {
    const f = nav.focusPoint;
    focusUniforms._Focus.value.set(f.x, f.y, f.z); // the whole GPU refocus
    if (minimap) minimap.setFocusPoint(f);
    shownStale = true;                              // CPU copy is rebuilt only if a pick needs it
    updateExpansion();                              // open / close files near the focus
    updateSemanticZoom();                                                      // collapse / expand folders by distance
    updateHalos();                                                             // halos copy each node's state, so refresh them too
    dirty = false;
  }
  nebula.position.copy(camera.position); // the sky follows the camera, so it never shows parallax
  if (hoverPending) {                     // at most once per frame
    const before = hoverNode;
    hoverNode = pickNode(hoverPending.x, hoverPending.y);
    hoverPending = null;
    if (hoverNode !== before) linksDirty = true; // the hovered node's links are shown too
  }
  if (linksDirty) updateLinks();          // only when something changed, never every frame
  renderer.info.reset();                  // we count draw calls of BOTH passes below
  renderer.clear();
  renderer.render(scene, camera);         // pass 1: the 3D galaxy
  labels.update(collectLabelCandidates());
  labels.render();                        // pass 2: labels on top (one batched draw call)
  requestAnimationFrame(frame);
}

async function start() {
  // ?tree=name.json loads public/data/name.json instead of the default dataset (see dataset.js).
  const file = treeFileFromUrl();
  const url = `${import.meta.env.BASE_URL}data/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);

  const json = await response.json();
  // The display tree = the real tree + alphabetical navigation groups under very wide parents (displaytree.js), the same tree the 2D viewer
  // draws. ?cap=N overrides how many siblings may show at once (default 36, 24 on a phone).
  const capParam = Number(new URLSearchParams(location.search).get('cap'));
  const tree = makeDisplayTree(json, { cap: capParam > 0 ? capParam : TIER === 'phone' ? CAP_PHONE : CAP_DESKTOP });
  displayInfo = tree.info;
  root = tree.root;
  nodes = tree.nodes;
  computeLayout3d(root);
  assignFitAll(root, THEME.NODE_FIT_FRACTION);   // sizes limited by the neighbours, so crowded nodes never overlap
  // Symbol and source files sit in folders named by the tree JSON, relative to the tree file's folder.
  const baseUrl = url.slice(0, url.lastIndexOf('/') + 1);
  // The disease data layer (only datasets that declare `dataLayer`): attached to the tree now, its files are fetched only when asked for.
  diseaseData = dataLayerFor(json, (file) => fetch(`${baseUrl}${file}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }));
  if (diseaseData) diseaseData.attachTree(nodes);
  store = createSymbolStore(baseUrl, json.symbolsDir, json.sourceDir);
  caps = deriveCapabilities(json);
  for (const w of caps.warnings) console.warn('dataset capabilities:', w);
  symbolFiles = caps.symbols ? nodes.filter((n) => n.hasSymbols) : [];
  for (const n of symbolFiles) fileById.set(n.fileId, n);
  buildSearch();
  heatData = caps.gitHeat ? computeHeat(nodes) : null;
  fakeGit = !!json.fakeGit;
  // The Disease Ontology gets the disease panel (it owns the right-hand column / bottom sheet and the view inset); other datasets keep the info
  // card. ?panel=0 gives the old card + floating member list back (used by tests that need the whole canvas).
  if (diseaseData && new URLSearchParams(location.search).get('panel') !== '0') {
    diseasePanel = createDiseasePanel({ data: diseaseData, nodeById: (id) => nodeById[id], onNavigate: (n) => focusOn(n), onLayout: applyInset });
    memberList = diseasePanel.memberList;
  } else {
    infoCard = createInfoCard();
    memberList = createMemberList({ onPick: (n) => focusOn(n) });
  }
  if (json.words) datasetWords = json.words;
  toolbar.setDataset({ about: json.about, words: json.words, hasLinks: caps.dependencies });
  updateHelp();
  minimap = createMinimap({ nodes, onPick: (n) => goToPlace({ baseId: n.id }, true) });
  refreshToolbar();
  // The code panel reports how much of the screen it covers. The one-row toolbar always covers a strip at the bottom,
  // so the picture is centred above it too (only when the toolbar IS at the bottom, i.e. not in the compact landscape layout).
  codePanel = createCodePanel({ onInset: applyInset, ownsLayout: !diseasePanel });
  // Links (Phase 4c) load in the background: the galaxy is usable before they arrive.
  if (caps.dependencies && json.linksFile) {
    fetch(`${baseUrl}${json.linksFile}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((lj) => { if (lj) { linkData = createLinkData(lj); linksDirty = true; updatePanelLinks(); if (focusNode) showCode(focusNode); updateInfoCard(); } })
      .catch((err) => console.warn('links not loaded', err));
  }

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
  setHover: (id) => { hoverNode = id === null ? null : nodeById[id]; linksDirty = true; },
  // Links (Phase 4c)
  get linkCount() { return linkData ? linkData.count : 0; },
  get linkStats() { return linkData ? linkData.stats : null; },
  get visibleLinks() { return linkArcs.length; },
  get selectedLinks() { return linkSelected; },
  arcs: () => linkArcs.map((a) => ({ a: a.a.id, b: a.b.id, type: a.type, conf: a.conf, count: a.count, role: a.role, far: a.far ? a.far.id : null })),
  // ---- Test hooks for the navigation / link audit (tests/phone/*.mjs) ----
  // Every arc with its raw links [fromFile, fromSym, toFile, toSym], its chosen target, and the end points as the GPU got them.
  arcDetails: () => linkArcs.map((a, i) => {
    const g = linkMesh.geometry.arrays;
    return {
      a: a.a.id, b: a.b.id, type: a.type, conf: a.conf, count: a.count, role: a.role, far: a.far ? a.far.id : null, key: a.key,
      links: a.links.map((k) => [linkData.fromFile[k], linkData.fromSym[k], linkData.toFile[k], linkData.toSym[k]]),
      target: a.target.node ? { node: a.target.node.id } : { fileId: a.target.fileId, sym: a.target.sym },
      gpuP0: [...g.aP0.slice(i * 3, i * 3 + 3)], gpuP4: [...g.aP4.slice(i * 3, i * 3 + 3)],
      posA: [a.a.pos.x, a.a.pos.y, a.a.pos.z], posB: [a.b.pos.x, a.b.pos.y, a.b.pos.z],
    };
  }),
  get folderLinks() { return showFolderDeps; },
  setFolderDeps: (on) => { showFolderDeps = on; linksDirty = true; updateHelp(); },
  fileNode: (fileId) => fileById.get(fileId) || null,
  symNode: (fileId, sym) => { const f = fileById.get(fileId); return (f && f.symByIndex && f.symByIndex.get(sym)) || null; },
  get pendingSymbol() { return pendingSymbol; },
  // Screen polylines (CSS px) of every edge that is drawn right now, computed on the CPU exactly like the edge shader does.
  edgePolylines: () => {
    const shift = vNeg(nav.focusPoint);
    const out = [];
    for (const n of allNodes) {
      if (!n.parent || n.state === 1 || n.edgeIndex === undefined || edgeArr.eHide[n.edgeIndex] === 1) continue;
      const A = mobiusAdd3(shift, n.parent.pos), B = mobiusAdd3(shift, n.pos);
      const pts = [];
      for (let k = 0; k <= 12; k++) pts.push(projectPoint(geodesicLerp3(A, B, k / 12)));
      out.push({ child: n.id, parent: n.parent.id, d: hyperbolicDistance3(nav.focusPoint, n.pos), pts });
    }
    return out;
  },
  // Show / hide the drawing layers (to look at edges alone). Anything not mentioned keeps its state.
  setLayers: (l) => {
    const map = { nodes: nodeMesh, halos: haloMesh, sun: sunMesh, edges: edgeMesh, dust: dustMesh, links: linkMesh, nebula, haze };
    for (const [k, v] of Object.entries(l)) if (map[k]) map[k].visible = v && (k !== 'links' || linkArcs.length > 0);
  },
  // Render the scene now (no labels) and read the pixels back: { w, h, data } (rows bottom-up, RGBA bytes).
  readFrame: () => {
    renderer.clear();
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const data = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { w, h, data };
  },
  get pixelScale() { return renderer.getPixelRatio(); },
  get backStackDepth() { return nav.backDepth; },
  setGlideScale: (k) => nav.setGlideScale(k),
  get backDepth() { return nav.backDepth; },
  goBack,
  cycleHeat,
  get capabilities() { return caps; },
  get displayInfo() { return displayInfo; },
  get data() { return diseaseData; },
  get panel() { return diseasePanel; },
  get memberList() { return memberList; },
  get orbCount() { return collapsedNodes.length; },
  get heatMode() { return heatMode; },
  get cardText() { return document.getElementById('card').innerText; },
  get legendText() { return document.getElementById('legend').innerText; },
  heatOf: (id) => (heatMode === HEAT.COMMITS ? heatData.commits[id] : heatData.recency[id]),
  get focusScale() { return uFocusScale.value; },
  get zoomSize() { return uZoomSize.value; },
  minimap: () => minimap,
  arcRoute: (i) => arcRoute(linkArcs[i]),
  searchStats: () => ({ ...indexStats, entries: searchIndex.size, indexed: searchIndex.symbolFilesIndexed, lastSearchMs: searchUI.lastMs }),
  search: (text, n = 10) => { const t0 = performance.now(); const r = searchIndex.search(text, n); return { ms: performance.now() - t0, results: r }; },
  searchUI: () => searchUI,
  goToResult,
  get markCount() { return markNodes.length; },
  get markStrength() { return uMark.value; },
  followArc: (i) => followArc(linkArcs[i]),
  goToPlace: (fileId, sym) => goToPlace({ fileId, sym }, true),
  setLinkFilter: (imports, calls) => { showImports = imports; showCalls = calls; linksDirty = true; updateHelp(); },
  get linkTabs() { return codePanel.linkTabs; },
  openLinkTab: (i) => codePanel.openTab(i),
  // Screen position of the point at fraction t along a visible arc (CPU copy of the shader's curve).
  arcScreenPos: (i, t) => projectPoint(geodesicBezier3(linkArcs[i].points.map((p) => mobiusAdd3(vNeg(nav.focusPoint), p)), t)),
  get spinning() { return nav.spinning; },
  setSpin: nav.setSpin,
  get drawCalls() { return renderer.info.render.calls; },
  get triangles() { return renderer.info.render.triangles; },
  quality: TIER,
  get pixelRatio() { return renderer.getPixelRatio(); },
  get adaptiveSteps() { return adaptive.steps; },
  get uiFade() { return idleFade.level; },
  get camPosition() { return camera.position.toArray(); },
  idleFade,
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
