// disease_layout.test.js - the depth-tapered edge length and the full Disease Ontology tree (Phase 1 fix).
// Run: node tests/disease_layout.test.js     (STRICT=1 is accepted for compatibility; the checks are always strict)
//
//  A. the schedule itself (pure numbers): full 0.7 on the upper levels, shrinking below, total always inside the radius budget,
//     and trees that already fit (the sample repo and WordNet, depth 8) get EXACTLY the old uniform lengths
//  B. 3D layout of the 12,419-node disease tree: zero edges shortened by the clamp, every edge = its scheduled length, radius < 0.995
//  E. comparison with the old uniform 0.7 and uniform 0.5: min sibling distance (overall and by depth band) and closest pair of nodes
// (The 2D layout is now "S5" with rings, groups and list-only nodes: it is checked in tests/displaytree.test.js, also against the 3D layout.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, computeLayout3d, radiusOf, EDGE_LENGTH, edgeLengthSchedule, treeDepth } from '../src/layout3d.js';
import { EDGE_LENGTH as EDGE_LENGTH_2D, EDGE_RADIUS_LIMIT } from '../src/layout.js';
import { hyperbolicDistance3, MAX_RADIUS } from '../src/mobius3d.js';

const data = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const sum = (a) => a.slice(1).reduce((x, y) => x + y, 0);
const BUDGET = 2 * Math.atanh(EDGE_RADIUS_LIMIT);

// ---- A. the schedule ---------------------------------------------------------------------------------------------------
for (const base of [EDGE_LENGTH, EDGE_LENGTH_2D, 0.5]) {
  for (let m = 1; m <= 40; m++) {
    const L = edgeLengthSchedule(m, base);
    assert.equal(L.length, m + 1);
    assert.ok(sum(L) <= BUDGET + 1e-12, `base ${base}, depth ${m}: sum ${sum(L)} exceeds the budget ${BUDGET}`);
    assert.ok(Math.tanh(sum(L) / 2) < MAX_RADIUS, 'even a perfectly straight path stays under 0.995');
    for (let k = 1; k <= m; k++) { assert.ok(L[k] <= base + 1e-15 && L[k] > 0); if (k > 1) assert.ok(L[k] <= L[k - 1] + 1e-15, 'never grows with depth'); }
    if (base * m <= BUDGET) assert.ok(L.every((x) => x === base), `depth ${m} fits: unchanged uniform length`);
    else { assert.equal(L[1], base, 'the top level keeps the full length'); assert.ok(L[m] < base, 'the deepest level is shorter'); assert.ok(Math.abs(sum(L) - BUDGET) < 1e-9, 'the budget is used up exactly'); }
  }
}
assert.deepEqual(edgeLengthSchedule(12, 0.7), edgeLengthSchedule(12, 0.7), 'deterministic');
const L12 = edgeLengthSchedule(12, EDGE_LENGTH);
console.log('schedule (base 0.7, depth 12): ' + L12.slice(1).map((x) => x.toFixed(3)).join(' ') + `  sum ${sum(L12).toFixed(3)} of budget ${BUDGET.toFixed(3)}`);
for (const f of ['sample_tree.json', 'wordnet_tree.json']) {
  const { root } = buildTree(data(f));
  assert.ok(edgeLengthSchedule(treeDepth(root), EDGE_LENGTH).every((x) => x === EDGE_LENGTH), `${f} keeps the uniform 0.7`);
  assert.ok(edgeLengthSchedule(treeDepth(root), EDGE_LENGTH_2D).every((x) => x === EDGE_LENGTH_2D), `${f} keeps the uniform 2D length`);
}

// ---- B. 3D ---------------------------------------------------------------------------------------------------------------
const json = data('disease_tree.json');
const M = (() => { const { root } = buildTree(json); return treeDepth(root); })();
assert.equal(M, 12);
function measure3d(opts) {
  const { root, nodes } = buildTree(json);
  computeLayout3d(root, opts);
  const r = { nodes, root, maxR: 0, clamped: 0, minSib: Infinity, band: { 'depth<=6': Infinity, 'depth 7-9': Infinity, 'depth 10-12': Infinity }, minAny: Infinity };
  for (const n of nodes) {
    assert.ok(Number.isFinite(n.pos.x) && Number.isFinite(n.pos.y) && Number.isFinite(n.pos.z));
    r.maxR = Math.max(r.maxR, radiusOf(n));
    if (n.parent && Math.abs(hyperbolicDistance3(n.parent.pos, n.pos) - n.edgeLength) > 1e-6) r.clamped++;
    const band = n.depth <= 6 ? 'depth<=6' : n.depth <= 9 ? 'depth 7-9' : 'depth 10-12';
    for (let i = 0; i < n.children.length; i++) for (let j = i + 1; j < n.children.length; j++) {
      const d = hyperbolicDistance3(n.children[i].pos, n.children[j].pos);
      r.minSib = Math.min(r.minSib, d);
      const b = n.children[i].depth <= 6 ? 'depth<=6' : n.children[i].depth <= 9 ? 'depth 7-9' : 'depth 10-12';
      r.band[b] = Math.min(r.band[b], d);
    }
  }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) r.minAny = Math.min(r.minAny, hyperbolicDistance3(nodes[i].pos, nodes[j].pos));
  return r;
}
const uniform = (len) => ({ edgeLengths: new Array(M + 1).fill(len) });
const taper = measure3d({});
const old07 = measure3d(uniform(0.7));
const old05 = measure3d(uniform(0.5));
const f = (x) => x.toFixed(4);
console.log('3D, 12,419 nodes, depth 12:');
console.log('  config                max radius  clamped edges  min sibling  closest pair  (min sibling by depth band)');
for (const [name, r] of [['uniform 0.7 (old)', old07], ['uniform 0.5', old05], ['taper (new)', taper]])
  console.log(`  ${name.padEnd(20)} ${f(r.maxR).padStart(10)} ${String(r.clamped).padStart(14)} ${f(r.minSib).padStart(12)} ${f(r.minAny).padStart(13)}   ` + Object.entries(r.band).map(([k, v]) => `${k} ${f(v)}`).join(' | '));
assert.ok(old07.clamped > 0, 'sanity: the old uniform layout really did clamp');
assert.equal(taper.clamped, 0, `${taper.clamped} edges were shortened by the 0.995 clamp`);
assert.ok(taper.maxR < MAX_RADIUS, `max radius ${taper.maxR}`);
assert.ok(taper.minSib > 0.02, 'siblings stay separated');
// Per-depth edge lengths are exactly the schedule; shallow levels exactly 0.7; an edge is never longer than its parent's edge.
for (const n of taper.nodes) {
  if (!n.parent) continue;
  assert.equal(n.edgeLength, L12[n.depth]);
  if (n.depth <= 6) assert.equal(n.edgeLength, 0.7, 'upper hierarchy keeps 0.7');
}
// Max-depth nodes: they exist, sit inside the ball and are distinct from their parents.
const deepest = taper.nodes.filter((n) => n.depth === M);
assert.ok(deepest.length >= 1);
for (const n of deepest) { assert.ok(radiusOf(n) < MAX_RADIUS); assert.ok(hyperbolicDistance3(n.pos, n.parent.pos) > 0.1); }
console.log(`  max-depth nodes: ${deepest.length}, radius ${f(Math.max(...deepest.map(radiusOf)))}`);

console.log('disease_layout.test.js: all checks passed');
