// links.test.js - Phase 4c: link data, symbol numbering, selection + cap, arcs, bundling control points, panel lists.
// Uses the committed sample (public/data/sample_tree.json + sample/links.json).
// Run: node tests/links.test.js
import { readFileSync } from 'node:fs';
import { buildTree, computeLayout3d, layoutSymbols } from '../src/layout3d.js';
import { buildSymbolNodes, MAX_SYMBOLS_PER_FILE } from '../src/symbols.js';
import {
  createLinkData, subjectOf, linksOf, selectLinks, buildArcs, arcTarget, treePath, bundledControlPoints, linkLists,
  confidenceDots, LINK_IMPORT, LINK_CALL, MAX_VISIBLE_LINKS,
} from '../src/links.js';
import { vec3, vLength, geodesicLerp3Free, hyperbolicDistance3, geodesicBezier3 } from '../src/mobius3d.js';

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.error('FAIL: ' + msg); } };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const closeVec = (p, q, eps = 1e-9) => close(p.x, q.x, eps) && close(p.y, q.y, eps) && close(p.z, q.z, eps);

const json = JSON.parse(readFileSync(new URL('../public/data/sample_tree.json', import.meta.url), 'utf8'));
const lj = JSON.parse(readFileSync(new URL(`../public/data/${json.linksFile}`, import.meta.url), 'utf8'));
const { root, nodes } = buildTree(json);
computeLayout3d(root);
const data = createLinkData(lj);
const fileById = new Map(nodes.filter((n) => n.hasSymbols).map((n) => [n.fileId, n]));
const docOf = (f) => JSON.parse(readFileSync(new URL(`../public/data/${json.symbolsDir}/${f.fileId}.json`, import.meta.url), 'utf8'));

// ---- 1. data -------------------------------------------------------------------------------
check(data.count === lj.links.length && data.count > 10000, `links loaded: ${data.count}`);
check(data.importLinks.length === lj.links.filter((l) => l[4] === LINK_IMPORT).length, 'import index');
let indexed = 0;
for (const list of data.byFile.values()) indexed += list.length;
const intra = lj.links.filter((l) => l[0] === l[2]).length;
check(indexed === 2 * data.count - intra, 'every link is indexed under both of its files (once if both ends are one file)');
check(close(data.conf[0], lj.links[0][5] / 100, 1e-6), 'confidence stored as 0..1');

// ---- 2. symbol numbering: symbols.js gives every node the scanner's pre-order index --------------
// Opening EVERY sample file must give nodes whose names match links.json's names table at their symIndex.
let numbered = 0, mismatched = 0;
for (const f of fileById.values()) {
  const made = buildSymbolNodes(f, docOf(f));
  const names = lj.names[String(f.fileId)];
  for (const n of made) {
    if (n.kind === 'block') { check(n.symIndex === -1, 'block node stands for the file (-1)'); continue; }
    numbered++;
    // links.json shows methods as Class.method, so compare the last part (the node's own name).
    const expect = n.parent.kind === 'class' ? `${n.parent.name}.${n.name}` : n.name;
    if (names[n.symIndex] !== expect) mismatched++;
  }
  const idx = made.filter((n) => n.symIndex >= 0).map((n) => n.symIndex);
  check(new Set(idx).size === idx.length, `${f.name}: symbol indices are unique`);
  check(made.length <= MAX_SYMBOLS_PER_FILE, 'cap respected');
}
check(mismatched === 0 && numbered > 15000, `symbol index -> name agrees with links.json (${numbered} nodes, ${mismatched} wrong)`);

// A hand-made doc: pre-order numbering is independent of the breadth-first build order.
{
  const file = { ...[...fileById.values()][0], children: [] };
  const doc = { loc: 30, symbols: [
    { kind: 'class', name: 'A', startLine: 1, endLine: 10, children: [
      { kind: 'method', name: 'm', startLine: 2, endLine: 3 }, { kind: 'method', name: 'n', startLine: 4, endLine: 9,
        children: [{ kind: 'function', name: 'deep', startLine: 5, endLine: 6 }] }] },
    { kind: 'function', name: 'f', startLine: 11, endLine: 20 }] };
  const made = buildSymbolNodes(file, doc);
  const byName = Object.fromEntries(made.map((n) => [n.name, n.symIndex]));
  check(byName.A === 0 && byName.m === 1 && byName.n === 2 && byName.deep === 3 && byName.f === 4,
    `pre-order: A0 m1 n2 deep3 f4, got ${JSON.stringify(byName)}`);
}

// ---- 3. subjects and links of a subject ---------------------------------------------------------
const busy = [...fileById.values()].sort((a, b) => (data.byFile.get(b.fileId) || []).length - (data.byFile.get(a.fileId) || []).length)[0];
const fileSubject = subjectOf(busy);
check(fileSubject.fileId === busy.fileId && fileSubject.sym === null, 'file subject');
const fileLinks = linksOf(data, fileSubject, null);
check(fileLinks.length === (data.byFile.get(busy.fileId) || []).length, 'a file has every link touching it');
check(subjectOf(nodes.find((n) => n.type === 'file' && !n.hasSymbols)) === null, 'a file without symbols has no links');
// Open the busy file and take one of its symbols.
busy.children = []; // (in case)
const made = buildSymbolNodes(busy, docOf(busy));
busy.children = made.filter((n) => n.parent === busy);
layoutSymbols(busy);
busy.symByIndex = new Map(made.filter((n) => n.symIndex >= 0).map((n) => [n.symIndex, n]));
const sym = made.find((n) => linksOf(data, subjectOf(n), null).length > 0);
const symLinks = linksOf(data, subjectOf(sym), null);
check(symLinks.every((i) => (data.fromFile[i] === busy.fileId && data.fromSym[i] === sym.symIndex)
  || (data.toFile[i] === busy.fileId && data.toSym[i] === sym.symIndex)), 'a symbol has only links that touch it');

// Folder: only import links crossing between its parts.
const folderLinks = linksOf(data, subjectOf(root), (id) => fileById.get(id));
check(folderLinks.every((i) => data.type[i] === LINK_IMPORT), 'folder: imports only');
const childOf = (n) => root.children.find((c) => n.id >= c.id && n.id < c.id + c.weight);
check(folderLinks.every((i) => childOf(fileById.get(data.fromFile[i])) !== childOf(fileById.get(data.toFile[i]))),
  'root: every link crosses between two different top-level folders');
check(folderLinks.length > 100, `root has cross-folder imports: ${folderLinks.length}`);

// ---- 4. selection: order, filter, cap -------------------------------------------------------------
const fileNode = (id) => fileById.get(id);
let sel = selectLinks(data, { focus: fileSubject, fileNode });
check(sel.length === fileLinks.length, 'all links of the focus selected');
check(sel.every((s, k) => k === 0 || data.conf[sel[k - 1].index] >= data.conf[s.index]), 'sorted by confidence');
sel = selectLinks(data, { focus: fileSubject, fileNode, showCalls: false });
check(sel.length > 0 && sel.every((s) => data.type[s.index] === LINK_IMPORT), 'K filter: imports only');
sel = selectLinks(data, { focus: fileSubject, fileNode, showImports: false });
check(sel.every((s) => data.type[s.index] === LINK_CALL), 'I filter: calls only');
check(selectLinks(data, { focus: fileSubject, fileNode, showImports: false, showCalls: false }).length === 0, 'both off: none');
const other = [...fileById.values()].find((f) => f !== busy && (data.byFile.get(f.fileId) || []).length > 3);
sel = selectLinks(data, { focus: fileSubject, hover: subjectOf(other), fileNode });
const roles = sel.map((s) => s.role);
check(roles.indexOf('hover') > roles.lastIndexOf('focus'), 'hover links come after the focus links');
check(new Set(sel.map((s) => s.index)).size === sel.length, 'no link selected twice');

// Arcs: a closed file stands for its symbols; the cap holds.
const resolveEnd = (fileId, s) => {
  const f = fileById.get(fileId);
  if (!f) return null;
  return (s >= 0 && f.symByIndex && f.symByIndex.get(s)) || f;
};
const arcs = buildArcs(data, selectLinks(data, { focus: fileSubject, fileNode }), resolveEnd);
check(arcs.length > 0 && arcs.length <= MAX_VISIBLE_LINKS, `arcs for the busy file: ${arcs.length}`);
check(arcs.every((a) => a.a !== a.b), 'no arc from a node to itself');
check(new Set(arcs.map((a) => a.key)).size === arcs.length, 'merged: one arc per (type, node pair)');
check(arcs.reduce((n, a) => n + a.count, 0) <= fileLinks.length, 'merged counts add up');
const rootArcs = buildArcs(data, selectLinks(data, { focus: subjectOf(root), fileNode }), resolveEnd);
check(rootArcs.length === MAX_VISIBLE_LINKS, `root focus: capped at ${MAX_VISIBLE_LINKS} (${rootArcs.length})`);
check(buildArcs(data, selectLinks(data, { focus: subjectOf(root), fileNode }), resolveEnd, 10).length === 10, 'custom cap');
// Hidden ends move to the visible ancestor (here: pretend a folder is a collapsed orb).
{
  const target = fileById.get(data.toFile[folderLinks[0]]);
  const orb = target.parent;
  const hiddenEnd = (fileId, s) => { let n = resolveEnd(fileId, s); while (n && n.parent === orb) n = n.parent; return n; };
  const a = buildArcs(data, [{ index: folderLinks[0], role: 'focus' }], hiddenEnd);
  check(a.length === 1 && a[0].b === orb, 'an end inside a collapsed folder lands on the orb');
}
// The arc's target: the end that is not the focus.
{
  const arc = arcs.find((a) => a.count === 1);
  const t = arcTarget(data, arc, fileSubject);
  const i = arc.links[0];
  const focusIsFrom = data.fromFile[i] === busy.fileId;
  check(t.fileId === (focusIsFrom ? data.toFile[i] : data.fromFile[i]), 'arc target is the far end');
}

// ---- 5. tree path and bundling ------------------------------------------------------------------
{
  const x = fileById.get(data.fromFile[folderLinks[0]]), y = fileById.get(data.toFile[folderLinks[0]]);
  const { path, lca } = treePath(x, y);
  check(path[0] === x && path[path.length - 1] === y, 'path runs from a to b');
  check(path[lca] === root, 'cross-arm path goes through the root');
  for (let k = 1; k < path.length; k++) {
    check(path[k].parent === path[k - 1] || path[k - 1].parent === path[k], 'path steps along tree edges');
  }
  const deep = sym, { path: p2, lca: l2 } = treePath(deep, busy);
  check(p2[l2] === busy && p2.length === deep.depth - busy.depth + 1, 'path from a symbol up to its own file');

  // tension 0: every control point lies on the straight geodesic a -> b at s = i/4.
  const straight = bundledControlPoints(x, y, 0);
  straight.forEach((p, i) => check(closeVec(p, geodesicLerp3Free(x.pos, y.pos, i / 4), 1e-9), `tension 0: point ${i} on the chord`));
  // tension 1: control points are the picked tree nodes (ends, LCA in the middle).
  const full = bundledControlPoints(x, y, 1);
  check(closeVec(full[2], root.pos, 1e-9), 'tension 1: middle control point is the common ancestor');
  check(closeVec(full[0], x.pos) && closeVec(full[4], y.pos), 'ends fixed');
  // Between: closer to the tree than the chord, and the hyperbolic Bézier curve starts/ends at the nodes.
  const mid = bundledControlPoints(x, y, 0.85);
  check(hyperbolicDistance3(mid[2], root.pos) < hyperbolicDistance3(straight[2], root.pos), 'tension pulls toward the LCA');
  check(closeVec(geodesicBezier3(mid, 0), x.pos, 1e-6) && closeVec(geodesicBezier3(mid, 1), y.pos, 1e-6), 'curve ends at the nodes');
  for (let t = 0; t <= 1; t += 0.1) check(vLength(geodesicBezier3(mid, t)) < 0.996, 'curve stays in the ball (clamped)');
  // Symbols: control points stay inside the ball even beyond 0.995 (unclamped home positions).
  for (const a of arcs) for (const p of bundledControlPoints(a.a, a.b, 0.85)) check(vLength(p) < 1, 'control point inside the ball');
}

// ---- 6. panel lists -------------------------------------------------------------------------------
{
  const lists = linkLists(data, fileSubject);
  const nOut = fileLinks.filter((i) => data.fromFile[i] === busy.fileId && data.toFile[i] !== busy.fileId && data.type[i] === LINK_IMPORT).length;
  check(lists.imports.reduce((n, e) => n + e.count, 0) === nOut, 'imports list counts every outgoing import');
  check(lists.calls.every((e) => e.fileId !== busy.fileId) && lists.calledBy.every((e) => e.fileId !== busy.fileId),
    'file lists leave out links inside the file');
  check(lists.calls.every((e, k) => k === 0 || lists.calls[k - 1].conf >= e.conf), 'lists sorted by confidence');
  const sl = linkLists(data, subjectOf(sym));
  check(sl.calls.length + sl.calledBy.length > 0 && sl.imports.length === 0, 'a symbol has call lists, no imports');
  check(confidenceDots(1) === 3 && confidenceDots(0.6) === 2 && confidenceDots(0.25) === 1, 'confidence dots');
}

console.log(`links.js: ${data.count} links (${data.importLinks.length} import), busiest file ${busy.name} has ${fileLinks.length}`
  + ` -> ${arcs.length} arcs; root focus ${folderLinks.length} cross-folder imports -> ${rootArcs.length} arcs (capped)`);
if (failures) { console.error(`${failures} problem(s)`); process.exit(1); }
console.log('links.test.js: all checks passed');
