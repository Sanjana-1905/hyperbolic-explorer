// links.js - imports and calls between files and symbols (Phase 4c): which links to show, and the bundled route of each.
//
// No drawing and no three.js here, so everything can be tested from the command line (tests/links.test.js).
// The scanner (tools/links.py) resolved the links and wrote links.json; this file
//   1. keeps them in compact typed arrays with an index by file      (createLinkData)
//   2. says which node a link is "about" (its subject)                 (subjectOf, linksOf)
//   3. picks the links to draw: those of the focus, then of the hovered node, highest confidence first, by type
//                                                                       (selectLinks)
//   4. turns links into ARCS between nodes that are drawn right now (a symbol of a closed file -> its file; a node
//      hidden inside a collapsed folder -> that folder's "+N" orb), merging arcs that end up between the same two
//      nodes, at most MAX_VISIBLE_LINKS                               (buildArcs)
//   5. routes each arc through the tree (hierarchical edge bundling)  (treePath, bundledControlPoints)
//   6. builds the panel lists "Imports / Imported by / Calls / Called by" (linkLists)
//
// A link END is (file id, symbol index); symbol index -1 = the file itself. Symbol nodes carry the same number
// (`symIndex`, see symbols.js), files carry `fileId`.

import { straightenToward } from './mobius3d.js';
import { neighbours, callTargets, importTargets, definitionLines, subtreeIndexes } from './codecontext.js';
export const LINK_IMPORT = 0;
export const LINK_CALL = 1;
export const MAX_VISIBLE_LINKS = 300;   // CLAUDE.md-style cap: never more arcs than this on screen
export const CONTROL_POINTS = 5;        // control points per arc (the shader has exactly this many attributes)
export const FOLDER_LINK_LEVELS = 2;    // folder focus: link ends are merged up to this many levels below the folder

// ---------------------------------------------------------------------------
// 1. Data
// ---------------------------------------------------------------------------

// json = the parsed links.json. Returns typed arrays (fast to scan, small in memory) plus an index:
// byFile.get(fileId) = indices of every link with an end in that file (a link inside one file is listed once).
export function createLinkData(json) {
  const raw = json.links || [];
  const n = raw.length;
  const data = {
    count: n,
    fromFile: new Int32Array(n), fromSym: new Int32Array(n),
    toFile: new Int32Array(n), toSym: new Int32Array(n),
    type: new Uint8Array(n), conf: new Float32Array(n),
    byFile: new Map(),
    importLinks: [],             // file -> file import links (used for a folder focus)
    names: json.names || {},
    stats: json.stats || {},
  };
  const index = (file, i) => {
    let list = data.byFile.get(file);
    if (!list) data.byFile.set(file, (list = []));
    if (list[list.length - 1] !== i) list.push(i);
  };
  raw.forEach(([ff, fs, tf, ts, type, conf], i) => {
    data.fromFile[i] = ff; data.fromSym[i] = fs; data.toFile[i] = tf; data.toSym[i] = ts;
    data.type[i] = type; data.conf[i] = conf / 100;   // links.json stores percent
    index(ff, i); index(tf, i);
    if (type === LINK_IMPORT) data.importLinks.push(i);
  });
  return data;
}

// Name of a symbol (or null for the file itself / unknown).
export function symbolName(data, fileId, sym) {
  const list = data.names[String(fileId)];
  return sym >= 0 && list ? list[sym] ?? null : null;
}

// ---------------------------------------------------------------------------
// 2. Subjects: what a node "is" in link terms
// ---------------------------------------------------------------------------
// symbol         -> { fileId, sym }          links that start or end at that symbol
// "(top level)"  -> { fileId, sym: -1 }      links of the file itself (its imports, its module-level calls)
// file           -> { fileId, sym: null }    every link with an end anywhere in the file
// folder         -> { folder: node }         import links between its parts (see linksOf)
// a file without symbols -> null (no links)
export function subjectOf(node) {
  if (!node) return null;
  if (node.type === 'symbol') return { fileId: node.file.fileId, sym: node.symIndex };
  if (node.type === 'folder') return { folder: node };
  if (node.hasSymbols && node.fileId !== undefined) return { fileId: node.fileId, sym: null };
  return null;
}

const endMatches = (subject, file, sym) => file === subject.fileId && (subject.sym === null || sym === subject.sym);

// Indices of the links of a subject (not filtered, not sorted).
// For a FOLDER we show only file -> file IMPORT links that cross between its parts: at least one end inside the
// folder, and the two ends in different children of it (or one end outside). Calls are left out there: at the root
// of a big repo they would be tens of thousands of arcs. `fileNode(fileId)` gives the base tree node of a file.
// Base tree ids are pre-order positions, so "x is inside folder F" is just F.id <= x.id < F.id + F.weight.
export function linksOf(data, subject, fileNode) {
  if (!subject) return [];
  if (subject.folder) {
    const F = subject.folder;
    const inside = (n) => n.id >= F.id && n.id < F.id + F.weight;
    const childOf = (n) => F.children.find((c) => n.id >= c.id && n.id < c.id + c.weight) || null;
    const out = [];
    for (const i of data.importLinks) {
      const a = fileNode(data.fromFile[i]), b = fileNode(data.toFile[i]);
      if (!a || !b) continue;
      const ina = inside(a), inb = inside(b);
      if (!ina && !inb) continue;
      if (ina && inb && childOf(a) === childOf(b)) continue;   // stays inside one part: not about F
      out.push(i);
    }
    return out;
  }
  return (data.byFile.get(subject.fileId) || []).filter((i) =>
    endMatches(subject, data.fromFile[i], data.fromSym[i]) || endMatches(subject, data.toFile[i], data.toSym[i]));
}

// ---------------------------------------------------------------------------
// 3. Selection
// ---------------------------------------------------------------------------
// The links to draw, as [{ index, role }] in priority order: first the focus's links ('focus'), then the hovered
// node's ('hover'), each group by confidence (highest first; ties keep file order so the choice is stable).
// Type filter: showImports / showCalls. The cap is applied later, to the merged arcs (buildArcs).
export function selectLinks(data, { focus, hover = null, showImports = true, showCalls = true, fileNode }) {
  const out = [];
  const seen = new Set();
  const take = (subject, role) => {
    const list = linksOf(data, subject, fileNode).filter((i) =>
      !seen.has(i) && (data.type[i] === LINK_IMPORT ? showImports : showCalls));
    list.sort((x, y) => data.conf[y] - data.conf[x] || x - y);
    for (const i of list) { seen.add(i); out.push({ index: i, role }); }
  };
  take(focus, 'focus');
  if (hover) take(hover, 'hover');
  return out;
}

// ---------------------------------------------------------------------------
// 4. Arcs between drawn nodes
// ---------------------------------------------------------------------------
// `resolveEnd(fileId, sym)` returns the node that currently stands for a link end (the symbol node if its file is
// open, else the file node; if that is hidden inside a collapsed folder, the folder's orb), or null.
// Links whose two ends land on the same node are dropped (e.g. both inside one orb). Links that land on the same
// pair of nodes with the same type are MERGED into one arc: conf = the best one, count = how many links it stands for.
// Each arc remembers the real link ends (`refs` of its far end) so clicking it can go to the exact symbol.
// At most `max` arcs; since the selection is sorted, the arcs kept are the most important ones.
export function buildArcs(data, selected, resolveEnd, max = MAX_VISIBLE_LINKS) {
  const arcs = [];
  const byKey = new Map();
  for (const { index: i, role } of selected) {
    const a = resolveEnd(data.fromFile[i], data.fromSym[i]);
    const b = resolveEnd(data.toFile[i], data.toSym[i]);
    if (!a || !b || a === b) continue;
    const type = data.type[i];
    const key = `${type}|${a.id}|${b.id}`;
    let arc = byKey.get(key);
    if (!arc) {
      if (arcs.length >= max) continue;
      arc = { key, a, b, type, conf: data.conf[i], count: 0, role, links: [] };
      byKey.set(key, arc);
      arcs.push(arc);
    }
    arc.count++;
    arc.conf = Math.max(arc.conf, data.conf[i]);
    arc.links.push(i);
  }
  return arcs;
}

// The real link end an arc leads to when clicked: the end that is NOT the focus subject (for a hover arc: its
// target). If the arc merges links to several different targets, the drawn node itself is the target.
// Returns { fileId, sym } (sym -1 = the file) or { node } for a drawn folder/orb.
export function arcTarget(data, arc, focusSubject) {
  const ends = new Map();
  for (const i of arc.links) {
    const fromIsFocus = focusSubject && !focusSubject.folder && endMatches(focusSubject, data.fromFile[i], data.fromSym[i]);
    const toIsFocus = focusSubject && !focusSubject.folder && endMatches(focusSubject, data.toFile[i], data.toSym[i]);
    const useFrom = toIsFocus && !fromIsFocus;
    const fileId = useFrom ? data.fromFile[i] : data.toFile[i];
    const sym = useFrom ? data.fromSym[i] : data.toSym[i];
    ends.set(`${fileId}|${sym}`, { fileId, sym, drawn: useFrom ? arc.a : arc.b });
  }
  if (ends.size === 1) return [...ends.values()][0];
  return { node: [...ends.values()][0].drawn };
}

// Folder focus: lift a link end to its ancestor at most FOLDER_LINK_LEVELS below the focused folder, so the many
// file -> file imports between two sub-folders become ONE thicker arc (its count says how many). Example: focus =
// root (depth 0), end = root/api/events/x.js (depth 3) -> root/api/events (depth 2). Ends outside the folder are
// lifted the same way relative to their own depth (they never get deeper than they are).
export function liftEnd(node, folder) {
  let n = node;
  while (n && n.depth > folder.depth + FOLDER_LINK_LEVELS) n = n.parent;
  return n;
}

// ---------------------------------------------------------------------------
// 5. Routing: hierarchical edge bundling
// ---------------------------------------------------------------------------

// The tree path from node a to node b: a, a's parent, ..., the lowest common ancestor (LCA), ..., b's parent, b.
// Found by walking the deeper node up until both are at the same depth, then both up together until they meet.
// Returns { path, lca } where path[lca] is the common ancestor. Example: a = src/x.js, b = lib/y.js under the root:
// path = [x.js, src, root, lib, y.js], lca = 2.
export function treePath(a, b) {
  const up = [], down = [];
  let p = a, q = b;
  while (p.depth > q.depth) { up.push(p); p = p.parent; }
  while (q.depth > p.depth) { down.push(q); q = q.parent; }
  while (p !== q) { up.push(p); down.push(q); p = p.parent; q = q.parent; }
  up.push(p);
  return { path: up.concat(down.reverse()), lca: up.length - 1 };
}

// The CONTROL_POINTS (= 5) control points of an arc from a to b, in home (not refocused) coordinates.
//   1. Take the tree path and pick 5 nodes on it: the two ends, the common ancestor in the middle, and the node
//      half way up each side. Example: path [s, f, src, root, lib, g, t] (indices 0..6, lca = 3) -> indices
//      0, round(3/2) = 2, 3, 3 + round(3/2) = 5, 6 -> s, src, root, g, t.
//      (Holten uses every node of the path; 5 keeps the shader small and is enough for a smooth bundle.)
//   2. Pull each one toward the straight geodesic a -> b by the tension (straightenToward in mobius3d.js), with
//      s = 0, 1/4, 1/2, 3/4, 1 for the five points. The two ends stay where they are.
// The shader then draws the hyperbolic Bézier curve of these points (geodesicBezier3 / GLSL geodesicBezier5).
export function bundledControlPoints(a, b, tension) {
  const { path, lca } = treePath(a, b);
  const last = path.length - 1;
  const pick = [0, Math.round(lca / 2), lca, lca + Math.round((last - lca) / 2), last];
  const A = a.pos, B = b.pos;
  return pick.map((k, i) => (i === 0 ? A : i === CONTROL_POINTS - 1 ? B
    : straightenToward(A, B, path[k].pos, i / (CONTROL_POINTS - 1), tension)));
}

// ---------------------------------------------------------------------------
// 6. Panel lists
// ---------------------------------------------------------------------------
// For the focused subject: { imports, importedBy, calls, calledBy }, each a list of
// { fileId, sym, conf, count } (the OTHER end of the link), merged per other end (best conf, how many links),
// sorted by confidence then name. For a FILE, links that stay inside the file are left out (they are the file's
// own galaxy; each symbol's own lists show them).
export function linkLists(data, subject) {
  const groups = { imports: new Map(), importedBy: new Map(), calls: new Map(), calledBy: new Map() };
  if (!subject || subject.folder) return { imports: [], importedBy: [], calls: [], calledBy: [] };
  for (const i of linksOf(data, subject, null)) {
    const fromMe = endMatches(subject, data.fromFile[i], data.fromSym[i]);
    const toMe = endMatches(subject, data.toFile[i], data.toSym[i]);
    if (subject.sym === null && fromMe && toMe) continue;   // inside the focused file
    const isImport = data.type[i] === LINK_IMPORT;
    const add = (group, fileId, sym) => {
      const key = `${fileId}|${sym}`;
      const e = group.get(key);
      if (e) { e.count++; e.conf = Math.max(e.conf, data.conf[i]); } else group.set(key, { fileId, sym, conf: data.conf[i], count: 1 });
    };
    if (fromMe) add(isImport ? groups.imports : groups.calls, data.toFile[i], data.toSym[i]);
    if (toMe) add(isImport ? groups.importedBy : groups.calledBy, data.fromFile[i], data.fromSym[i]);
  }
  const sorted = (m) => [...m.values()].sort((x, y) => y.conf - x.conf || x.fileId - y.fileId || x.sym - y.sym);
  return { imports: sorted(groups.imports), importedBy: sorted(groups.importedBy), calls: sorted(groups.calls), calledBy: sorted(groups.calledBy) };
}

// Confidence as 1-3 dots for the lists: >= 0.75 sure (imports, imported names), >= 0.5 likely (same file),
// below that a name-only guess. Example: 0.8 -> 3, 0.6 -> 2, 0.25 -> 1.
export function confidenceDots(conf) {
  return conf >= 0.75 ? 3 : conf >= 0.5 ? 2 : 1;
}

// ---------------------------------------------------------------------------
// 7. Counts for the info card
// ---------------------------------------------------------------------------
// How many links go OUT of / INTO a subject, split by type. For a file: every link with an end in the file, except links
// that stay inside it. For a symbol: links that start/end exactly at it. For a folder: only imports that cross its boundary
// (one end inside, one outside). Example: a file that imports 3 files and is imported by 5 -> importsOut 3, importsIn 5.
export function linkCounts(data, subject, fileNode) {
  const c = { importsIn: 0, importsOut: 0, callsIn: 0, callsOut: 0 };
  if (!subject) return c;
  if (subject.folder) {
    const F = subject.folder;
    const inside = (n) => n.id >= F.id && n.id < F.id + F.weight;
    for (const i of data.importLinks) {
      const a = fileNode(data.fromFile[i]), b = fileNode(data.toFile[i]);
      if (!a || !b) continue;
      const ina = inside(a), inb = inside(b);
      if (ina && !inb) c.importsOut++;
      else if (!ina && inb) c.importsIn++;
    }
    return c;
  }
  for (const i of data.byFile.get(subject.fileId) || []) {
    const from = endMatches(subject, data.fromFile[i], data.fromSym[i]);
    const to = endMatches(subject, data.toFile[i], data.toSym[i]);
    if (from && to) continue;                       // stays inside the subject
    const key = (data.type[i] === LINK_IMPORT ? 'imports' : 'calls') + (from ? 'Out' : 'In');
    if (from || to) c[key]++;
  }
  return c;
}
