// displaytree.test.js - strict checks of the S5 layout and the navigation groups (displaytree.js + layout.js + disclosure.js), 2D and 3D,
// on the Disease Ontology (desktop cap 36 and phone cap 24), the sample and WordNet. Run: node tests/displaytree.test.js
//
// What must hold (CLAUDE.md "Approved design decisions" 9-11, PROGRESS.md "Step 2.3a"):
//   zero clamped edges, zero subtree overlap, radius <= 0.994, every disease reachable and still under its real parent, every sibling set
//   >= 0.04 apart EXCEPT the flagged list-only nodes, at most cap siblings in any list, groups open only on the focus path, expansion and
//   collapse never move anything (global depth), the list-only nodes keep every member reachable, distances stay exactly hyperbolic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, computeLayout, nodePath, EDGE_LENGTH, S5, edgeLengthSchedule } from '../src/layout.js';
import { computeLayout3d, EDGE_LENGTH as EDGE_LENGTH_3D } from '../src/layout3d.js';
import { makeDisplayTree, realMembers, runLabel, groupLabel, CAP_DESKTOP, CAP_PHONE } from '../src/displaytree.js';
import { disclosureStates, listFor } from '../src/disclosure.js';
import { mobiusAddFree, hyperbolicDistanceExact, cNeg } from '../src/mobius.js';
import { hyperbolicDistance3, mobiusAdd3, vNeg } from '../src/mobius3d.js';

const data = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const TWO_PI = 2 * Math.PI;
const LABEL_MAX = 12;
const wrap = (a) => { a = (a + Math.PI) % TWO_PI; if (a < 0) a += TWO_PI; return a - Math.PI; };
const lines = [];
const note = (s) => { lines.push(s); console.log(s); };

// ---- helpers ----------------------------------------------------------------------------------------------------------------
const minSiblings = (n) => { let m = Infinity; for (let i = 0; i < n.children.length; i++) for (let j = i + 1; j < n.children.length; j++) m = Math.min(m, hyperbolicDistanceExact(n.children[i].z, n.children[j].z)); return m; };
// Subtree overlap: seen from a parent, the angular extent of each child's WHOLE subtree; two siblings overlap if the extents intersect.
function overlaps(nodes) {
  let pairs = 0, parents = 0;
  for (const p of nodes) {
    const k = p.children;
    if (k.length < 2) continue;
    const angle = (w) => { const u = mobiusAddFree(cNeg(p.z), w.z); return Math.atan2(u.y, u.x); };
    const iv = k.map((c) => {
      const a0 = angle(c);
      let lo = 0, hi = 0;
      for (let id = c.id; id < c.id + c.weight; id++) { const d = wrap(angle(nodes[id]) - a0); if (d < lo) lo = d; if (d > hi) hi = d; }
      return { start: a0 + lo, len: hi - lo };
    });
    let bad = 0;
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
      const dj = ((iv[j].start - iv[i].start) % TWO_PI + TWO_PI) % TWO_PI;
      if (dj < iv[i].len - 1e-9 || TWO_PI - dj < iv[j].len - 1e-9) bad++;
    }
    if (bad) { pairs += bad; parents++; }
  }
  return { pairs, parents };
}
const pathTo = (n) => { const p = []; for (let a = n; a; a = a.parent) p.unshift(a); return p; };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- 0. unit checks of the label rule ------------------------------------------------------------------------------------------
assert.equal(runLabel('abdominal aortic aneurysm', 'cystic fibrosis'), 'A–C');
assert.equal(runLabel('abscess', 'abdomen'), 'Abs–Abd', 'same first letter: more letters until the ends differ');
assert.equal(runLabel('autosomal recessive a', 'autosomal recessive z'), 'Autosomal re…', 'names that all start alike say so');
assert.equal(runLabel('autosomal dominant x', 'autosomal recessive y'), 'Autosomal d–Autosomal r', 'ends that differ after a shared start get letters up to the difference');
assert.equal(runLabel('3-M syndrome', '46,XY'), '#', 'names that do not start with a letter share "#"');
assert.equal(runLabel('Zeta', 'zeta'), 'Zeta', 'identical ends: one label');
assert.equal(groupLabel({ name: 'A–F', kind: 'diseases', members: 24 }), 'A–F · 24');
assert.equal(groupLabel({ name: 'A–F', kind: 'subtypes', members: 12 }), 'A–F · 12 with subtypes');
assert.equal(groupLabel({ name: 'A–F', kind: 'groups', members: 5 }), 'A–F · 5 groups');

// ---- 1. every dataset, both caps ---------------------------------------------------------------------------------------------------
const results = {};
for (const [file, caps] of [['disease_tree.json', [CAP_DESKTOP, CAP_PHONE]], ['sample_tree.json', [CAP_DESKTOP, CAP_PHONE]], ['wordnet_tree.json', [CAP_DESKTOP, CAP_PHONE]]]) {
  const json = data(file);
  const before = JSON.stringify(json);
  const rawNodes = buildTree(json).nodes;                                   // the real tree, for comparison
  for (const cap of caps) {
    const tag = `${file} cap ${cap}`;
    const { root, nodes, info } = makeDisplayTree(json, { cap });
    assert.equal(JSON.stringify(json), before, `${tag}: the input data was not touched`);
    results[tag] = { root, nodes, info };

    // geometry: zero clamped edges, exact hyperbolic edge lengths, radius <= 0.994
    let maxR = 0, clamped = 0, rings = 0;
    for (const n of nodes) {
      assert.ok(Number.isFinite(n.z.x) && Number.isFinite(n.z.y), `${tag}: finite position`);
      maxR = Math.max(maxR, Math.hypot(n.z.x, n.z.y));
      if (n.parent) {
        if (Math.abs(hyperbolicDistanceExact(n.parent.z, n.z) - n.edgeLength) > 1e-6) clamped++;
        if (n.edgeLength > EDGE_LENGTH + 1e-9) rings++;
      }
    }
    assert.equal(clamped, 0, `${tag}: clamped edges`);
    assert.ok(maxR <= 0.994 + 1e-12, `${tag}: max radius ${maxR}`);

    // zero subtree overlap
    const ov = overlaps(nodes);
    assert.equal(ov.pairs, 0, `${tag}: ${ov.pairs} overlapping sibling subtrees in ${ov.parents} parents`);

    // ids are a pre-order, `weight` is the display subtree size
    nodes.forEach((n, i) => assert.equal(n.id, i));
    assert.equal(root.weight, nodes.length);
    for (const n of nodes) assert.equal(n.weight, 1 + n.children.reduce((s, c) => s + c.weight, 0));

    // every real node present once, under its real parent (looking through groups); the data on the nodes is the real data
    const real = nodes.filter((n) => !n.isGroup);
    assert.equal(real.length, rawNodes.length, `${tag}: all real nodes present`);
    const seen = new Set();
    for (const n of real) {
      assert.ok(!seen.has(n.realId), `${tag}: duplicate real node`); seen.add(n.realId);
      const raw = rawNodes[n.realId];
      assert.equal(n.name, raw.name); assert.equal(n.doid, raw.doid);
      assert.equal(n.weight >= 1, true);
      if (raw.parent) { let a = n.parent; while (a.isGroup) a = a.parent; assert.equal(a.realId, raw.parent.id, `${tag}: ${n.name} must stay under its real parent`); }
      assert.equal(n.realWeight, raw.weight, `${tag}: real subtree size`);
    }
    assert.equal(seen.size, rawNodes.length);
    assert.ok(!nodePath(real.find((n) => n.parent && n.parent.isGroup) || root).includes('–'), `${tag}: paths are made of real names only (groups are skipped)`);

    // caps: never more than `cap` siblings in any list
    const widest = Math.max(...nodes.map((n) => n.children.length));
    assert.ok(widest <= cap, `${tag}: a list has ${widest} > ${cap} children`);

    // every sibling set is >= ACCEPT apart, except the flagged list-only nodes (which must really be below it)
    const bad = nodes.filter((n) => n.children.length > 1 && minSiblings(n) < S5.ACCEPT);
    assert.deepEqual(bad.map((n) => n.id).sort((a, b) => a - b), info.listOnly.map((n) => n.id).sort((a, b) => a - b), `${tag}: exactly the list-only nodes are below ${S5.ACCEPT}`);
    for (const n of nodes) assert.equal(!!n.listOnly, bad.includes(n));

    // groups: transparent, alphabetical, complete, not diseases
    const groups = nodes.filter((n) => n.isGroup);
    for (const g of groups) {
      assert.equal(g.type, 'folder'); assert.equal(g.doid, undefined, 'a group is not a disease');
      assert.ok(g.members >= 2 && g.members === g.children.length && g.members <= cap);
      assert.ok(g.name.length >= 1 && g.name.length <= 2 * LABEL_MAX + 3, `${tag}: label "${g.name}" is short`);
      // the label is TRUE: every member's name lies inside [firstName, lastName], and each end of the label is the start of that end's name
      const lo = g.firstName.toLowerCase(), hi = g.lastName.toLowerCase();
      for (const c of g.children) { assert.ok((c.isGroup ? c.firstName : c.name).toLowerCase() >= lo && (c.isGroup ? c.lastName : c.name).toLowerCase() <= hi, `${tag}: "${g.name}" holds a name outside its range`); }
      const [a, b] = g.name.split('–');
      const starts = (txt, name) => txt === '#' ? !/^[A-Za-z]/.test(name.trim()) : name.trim().toLowerCase().startsWith(txt.replace('…', '').toLowerCase());
      assert.ok(starts(a, g.firstName) && starts(b ?? a, b === undefined ? g.firstName : g.lastName), `${tag}: label "${g.name}" does not match ${g.firstName} / ${g.lastName}`);
      assert.equal(g.name, runLabel(g.firstName, g.lastName));
      for (const c of g.children) assert.equal(c.parent, g);
      assert.equal(g.w, g.children.reduce((s, c) => s + (c.w ?? c.weight), 0));
      const names = g.children.map((c) => (c.isGroup ? c.firstName : c.name).toLowerCase());
      assert.deepEqual([...names].sort(), names, `${tag}: group "${g.name}" members are in alphabetical order`);
    }
    results[tag].stats = { maxR, rings, groups: groups.length };
    note(`${tag}: ${nodes.length} display nodes (${real.length} real + ${groups.length} groups in ${info.groupedParents} parents), display depth ${info.M}, max radius ${maxR.toFixed(4)}, 0 clamped, 0 overlapping subtrees, widest list ${widest}, ${info.listOnly.length} list-only (${info.listOnly.map((n) => n.children.length).join('+') || 0} children)`);
  }
}

// ---- 2. the Disease Ontology specifics -------------------------------------------------------------------------------------------
const D36 = results['disease_tree.json cap 36'], D24 = results['disease_tree.json cap 24'];
assert.equal(D36.info.realCount, 12419); assert.equal(D24.info.realCount, 12419);
assert.equal(D36.info.groups, 165, 'S5 as implemented: 165 groups at cap 36 (the prototype had 166: one mixed run is now ordered by where its entries start)');
assert.equal(D36.info.listOnly.length, 3, 'three list-only parents at cap 36');
assert.deepEqual(D36.info.listOnly.map((n) => n.children.length).sort((a, b) => a - b), [2, 5, 10]);
assert.ok(D24.info.groups > D36.info.groups, 'the phone cap needs more groups');
// the 486- and 1,048-child parents are resolved
for (const D of [D36, D24]) {
  for (const name of ['syndrome', 'autosomal recessive disease']) {
    const p = D.nodes.find((n) => n.name === name && !n.isGroup);
    assert.ok(p.children.length <= D.info.cap && !p.listOnly, `${name} is shown as at most ${D.info.cap} children/groups`);
    assert.ok(minSiblings(p) >= S5.ACCEPT, `${name}: children at least 0.04 apart`);
    assert.ok(p.children.some((c) => c.isGroup), `${name} is grouped`);
    assert.equal(realMembers(p).length, (name === 'syndrome' ? 486 : 1048), `${name}: every real child is a member of some group`);
  }
}
// all edges of the ontology still have both ends: every DOID of disease_edges.json is a real display node
const edges = data('disease_edges.json').edges;
const byDoid = new Map(D36.nodes.filter((n) => !n.isGroup).map((n) => [n.doid, n]));
assert.equal(byDoid.size, 12419);
for (const [c, p] of edges) assert.ok(byDoid.has(c) && byDoid.has(p), `ontology edge ${c} -> ${p} keeps both ends`);
note(`all ${edges.length} is_a edges of disease_edges.json still have both ends in the display tree (the file itself is never modified by the layout)`);

// ---- 3. disclosure: groups open only on the focus path, list-only nodes, caps on what is shown at once -------------------------------------
for (const D of [D36, D24]) {
  const { root, nodes, info } = D;
  const foci = [root, nodes.find((n) => n.name === 'syndrome'), nodes.find((n) => n.name === 'autosomal recessive disease'),
    nodes.filter((n) => n.depth === 12)[0], nodes.filter((n) => n.isGroup)[10], nodes.filter((n) => n.isGroup).slice(-1)[0], ...info.listOnly, ...info.listOnly.map((n) => n.children[0])];
  for (const f of foci) {
    const st = disclosureStates(nodes, root, f);
    // groups open (state 0) exactly when they are on the path of the focus
    const onPath = new Set(pathTo(f));
    for (const g of nodes.filter((n) => n.isGroup)) if (st[g.id] !== 1) assert.equal(st[g.id] === 0, onPath.has(g), `group ${g.name} is open only on the focus path`);
    // never all groups open: at most the groups on the path
    const open = nodes.filter((n) => n.isGroup && st[n.id] === 0);
    assert.ok(open.every((g) => onPath.has(g)));
    // simultaneously visible siblings of any shown parent: at most cap
    for (const n of nodes) {
      if (st[n.id] !== 0) continue;
      const shown = n.children.filter((c) => st[c.id] !== 1);
      assert.ok(shown.length <= info.cap, `${n.name}: ${shown.length} siblings shown at once > cap ${info.cap}`);
    }
    // closed groups and list-only nodes are aggregates; their members are hidden
    for (const n of nodes) if (st[n.id] === 2) for (const c of n.children) assert.equal(st[c.id], 1);
  }
  // the list-only nodes
  for (const L of info.listOnly) {
    const members = realMembers(L);
    assert.equal(members.length, L.children.length, 'the member list holds every child');
    assert.equal(new Set(members.map((m) => m.id)).size, members.length);
    let st = disclosureStates(nodes, root, root);
    assert.equal(st[L.id] === 2 || st[L.id] === 1, true, 'away from it, a list-only node is an aggregate (or inside one)');
    st = disclosureStates(nodes, root, L);
    assert.equal(st[L.id], 0, 'focused, it is drawn as itself'); assert.ok(L.children.every((c) => st[c.id] === 1), '... but its children are not drawn individually');
    assert.equal(listFor(L), L);
    for (const m of members) {                                             // every member individually selectable: focusing it works and shows it
      assert.equal(listFor(m), L, 'a member shows its parent list');
      const sm = disclosureStates(nodes, root, m);
      assert.equal(sm[m.id], 0, 'the focused member is drawn'); assert.ok(L.children.filter((c) => c !== m).every((c) => sm[c.id] === 1), 'its siblings are not');
      for (let a = m.parent; a; a = a.parent) assert.notEqual(sm[a.id], 1, 'the way to a member is never hidden');
    }
  }
  // every real disease reachable: focusing it makes it and all its ancestors shown, whatever is closed elsewhere
  const rng = mulberry(11);
  for (let t = 0; t < 400; t++) {
    const n = nodes[Math.floor(rng() * nodes.length)];
    const st = disclosureStates(nodes, root, n);
    for (let a = n; a; a = a.parent) assert.notEqual(st[a.id], 1, `${n.name}: ${a.name} on the path is hidden`);
    assert.notEqual(st[n.id], 1);
  }
}
note('disclosure: groups open only on the focus path (never all at once), at most cap siblings shown at once, list-only members stay selectable, 400 random nodes reachable');

// ---- 4. stability: expanding and collapsing never moves anything --------------------------------------------------------------------------
// A pruned copy (only what is visible) laid out with the GLOBAL depth must give identical positions; with a depth derived from the visible
// part it would not (so the radius schedule must never be derived from what is currently shown).
function visibleSet(root, expanded) { const vis = []; const walk = (n) => { vis.push(n); if (expanded.has(n)) n.children.forEach(walk); }; walk(root); return vis; }
function pruned(root, keep) {
  const mk = (n, parent) => { const c = { name: n.name, w: n.w ?? n.weight, weight: 1, isGroup: n.isGroup, children: [], parent, orig: n, type: n.type, depth: parent ? parent.depth + 1 : 0 }; c.children = n.children.filter((k) => keep.has(k)).map((k) => mk(k, c)); c.weight = 1 + c.children.reduce((s, k) => s + k.weight, 0); return c; };
  return mk(root, null);
}
{
  const { root, nodes, info } = D36;
  const rng = mulberry(5);
  let worst2 = 0, worst3 = 0, free2 = 0;
  const opens = nodes.filter((n) => n.children.length);
  const sched3 = edgeLengthSchedule(info.M, EDGE_LENGTH_3D);
  computeLayout3d(root, { edgeLengths: sched3 });
  for (let t = 0; t < 6; t++) {
    const exp = new Set([root]);
    for (let k = 0; k < 30 + 60 * t; k++) { const n = opens[Math.floor(rng() * opens.length)]; for (const a of pathTo(n)) exp.add(a); }
    const keep = new Set(visibleSet(root, exp));
    // 2D
    const p2 = pruned(root, keep);
    computeLayout(p2, EDGE_LENGTH, { M: info.M });
    (function walk(n) { worst2 = Math.max(worst2, hyperbolicDistanceExact(n.z, n.orig.z)); n.children.forEach(walk); })(p2);
    const pf = pruned(root, keep);
    computeLayout(pf, EDGE_LENGTH);                                      // depth derived from what is visible: positions move
    (function walk(n) { free2 = Math.max(free2, hyperbolicDistanceExact(n.z, n.orig.z)); n.children.forEach(walk); })(pf);
    // 3D
    const p3 = pruned(root, keep);
    computeLayout3d(p3, { edgeLengths: sched3 });
    (function walk(n) { worst3 = Math.max(worst3, hyperbolicDistance3(n.pos, n.orig.pos)); n.children.forEach(walk); })(p3);
  }
  assert.ok(worst2 < 1e-9, `2D: expanding/collapsing moved a node by ${worst2}`);
  assert.ok(worst3 < 1e-9, `3D: expanding/collapsing moved a node by ${worst3}`);
  assert.ok(free2 > 0.01, 'sanity: deriving the depth from the visible part WOULD move nodes');
  note(`stability: worst displacement over 6 random expand/collapse states: 2D ${worst2.toExponential(1)}, 3D ${worst3.toExponential(1)} (a visible-depth schedule would move nodes by up to ${free2.toFixed(2)})`);
}

// ---- 5. the same display tree in 3D -------------------------------------------------------------------------------------------------
for (const tag of ['disease_tree.json cap 36', 'disease_tree.json cap 24', 'wordnet_tree.json cap 24', 'sample_tree.json cap 24']) {
  const { root, nodes } = results[tag];
  computeLayout3d(root);
  let maxR = 0, clamped = 0, minSib = Infinity;
  for (const n of nodes) {
    assert.ok(Number.isFinite(n.pos.x) && Number.isFinite(n.pos.y) && Number.isFinite(n.pos.z), `${tag}: finite 3D position`);
    maxR = Math.max(maxR, Math.hypot(n.pos.x, n.pos.y, n.pos.z));
    if (n.parent && Math.abs(hyperbolicDistance3(n.parent.pos, n.pos) - n.edgeLength) > 1e-6) clamped++;
    for (let i = 0; i < n.children.length; i++) for (let j = i + 1; j < n.children.length; j++) minSib = Math.min(minSib, hyperbolicDistance3(n.children[i].pos, n.children[j].pos));
  }
  assert.equal(clamped, 0, `${tag}: 3D clamped edges`);
  assert.ok(maxR <= 0.994 + 1e-12, `${tag}: 3D max radius ${maxR}`);
  assert.ok(minSib >= S5.ACCEPT, `${tag}: 3D siblings at least ${S5.ACCEPT} apart, min ${minSib}`);
  note(`${tag} in 3D: max radius ${maxR.toFixed(4)}, 0 clamped edges, min sibling distance ${minSib.toFixed(4)}`);
}

// ---- 6. still hyperbolic ------------------------------------------------------------------------------------------------------------
{
  const { root, nodes } = D36;
  // (a) the layout is an isometric picture: refocusing keeps every pair distance exactly
  const f = nodes.find((n) => n.name === 'retinitis pigmentosa');
  const rng = mulberry(3);
  let worst = 0;
  for (let t = 0; t < 300; t++) {
    const a = nodes[Math.floor(rng() * nodes.length)], b = nodes[Math.floor(rng() * nodes.length)];
    const ua = mobiusAddFree(cNeg(f.z), a.z), ub = mobiusAddFree(cNeg(f.z), b.z);
    worst = Math.max(worst, Math.abs(hyperbolicDistanceExact(ua, ub) - hyperbolicDistanceExact(a.z, b.z)));
  }
  assert.ok(worst < 1e-6, `refocusing preserves distances (worst error ${worst})`);
  // (b) magnification: the same sibling pair looks much bigger with the focus on its parent than with the focus on the root
  // (a radial chart would give exactly 1)
  const parent = nodes.filter((n) => !n.isGroup && n.depth === 7 && n.children.length >= 3).sort((x, y) => y.children.length - x.children.length)[0];
  const px = (focus, p, q) => { const u = mobiusAddFree(cNeg(focus.z), p.z), v = mobiusAddFree(cNeg(focus.z), q.z); return Math.hypot(u.x - v.x, u.y - v.y); };
  const ratios = [];
  for (let i = 0; i + 1 < parent.children.length; i++) ratios.push(px(parent, parent.children[i], parent.children[i + 1]) / px(root, parent.children[i], parent.children[i + 1]));
  ratios.sort((x, y) => x - y);
  const med = ratios[Math.floor(ratios.length / 2)];
  assert.ok(med > 10, `focusing magnifies deep siblings (median x${med.toFixed(1)}), unlike a radial chart (x1)`);
  note(`hyperbolic: refocusing preserves pair distances (worst error ${worst.toExponential(1)}); the siblings of "${parent.name}" look x${med.toFixed(1)} bigger when it is focused than from the root`);
}
console.log('displaytree.test.js: all checks passed');
