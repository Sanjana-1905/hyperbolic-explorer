// semanticzoom.test.js - the rules the 2D and 3D viewers share (src/disclosure.js, src/families.js). Run: node tests/semanticzoom.test.js
//   realParent (Up never lands on an alphabetical group), semanticStates (groups and list-only nodes + the distance collapse with hysteresis),
//   family colours (a disease has the same colour in both viewers).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDisplayTree } from '../src/displaytree.js';
import { realParent, semanticStates, disclosureStates } from '../src/disclosure.js';
import { assignFamilyHues } from '../src/families.js';
import { hyperbolicDistanceExact } from '../src/mobius.js';
import { THEME } from '../src/theme.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const { root, nodes, info } = makeDisplayTree(read('disease_tree.json'), { cap: 36 });
const P = { collapseDist: THEME.COLLAPSE_DIST, hyst: THEME.COLLAPSE_HYST, minNodes: 4 };

// ---- realParent: the ontology parent, never a navigation group ----------------------------------------------------------------------------------
assert.equal(realParent(root), null);
let skipped = 0;
for (const n of nodes) {
  if (!n.parent) continue;
  const up = realParent(n);
  assert.ok(up && !up.isGroup, `${n.name}: Up lands on a real node`);
  let a = n.parent; while (a.isGroup) a = a.parent;
  assert.equal(up, a);
  if (n.parent.isGroup) skipped++;
}
assert.ok(skipped > 2000, 'thousands of diseases sit inside groups, and Up skips them all');
const grp = nodes.find((n) => n.isGroup && n.children.every((c) => !c.isGroup));
assert.equal(realParent(grp.children[0]), realParent(grp), 'a member and its group share the same real parent');
// walking Up from any disease reaches the root through real ancestors only, and that is the primary path
for (const n of nodes.filter((x) => !x.isGroup).slice(0, 3000)) { let c = n, steps = 0; while (realParent(c)) { c = realParent(c); assert.ok(!c.isGroup); steps++; } assert.equal(c, root); assert.ok(steps <= 12); }

// ---- semanticStates ------------------------------------------------------------------------------------------------------------------------------------------
const reset = () => nodes.forEach((n) => { n.collapsed = false; });
const dist2d = (focus) => (n) => hyperbolicDistanceExact(focus.z, n.z);
const foci = [root, nodes.find((n) => n.name === 'syndrome'), nodes.find((n) => n.name === 'heart disease'), nodes.filter((n) => n.depth === 12)[0], grp, grp.children[3], ...info.listOnly];
for (const f of foci) {
  // with the distance rule switched off it is exactly the groups / list-only rule
  reset();
  const noDist = semanticStates(nodes, root, f, () => 0, P);
  assert.deepEqual([...noDist], [...disclosureStates(nodes, root, f)], `${f.name}: without the distance rule = disclosure rule`);
  // with it: check the rule node by node (first pass: nothing was collapsed before, so the limit is collapseDist + hyst)
  reset();
  const st = semanticStates(nodes, root, f, dist2d(f), P);
  const onPath = new Set(); for (let a = f; a; a = a.parent) onPath.add(a);
  for (const n of nodes) {
    if (onPath.has(n)) assert.equal(st[n.id], 0, `${f.name}: the path is always drawn as itself, never collapsed or hidden (${n.name})`);
    if (st[n.id] === 1) { let hidden = false; for (let a = n.parent; a; a = a.parent) if (st[a.id] === 2 || (a.isGroup || a.listOnly) && !a.onPath) hidden = true; assert.ok(hidden || n.parent.listOnly, `${n.name} is hidden only below an aggregate`); }
    if (st[n.id] === 0 && !n.isGroup && !n.listOnly && n.type === 'folder' && n.weight - 1 >= 4 && !onPath.has(n)) {
      const hiddenAbove = (() => { for (let a = n.parent; a; a = a.parent) if (st[a.id] !== 0) return true; return false; })();
      if (!hiddenAbove) assert.ok(dist2d(f)(n) <= P.collapseDist + P.hyst, `${f.name}: ${n.name} is expanded only within ${P.collapseDist + P.hyst}`);
    }
    if (st[n.id] === 2 && !n.isGroup && !n.listOnly) assert.ok(dist2d(f)(n) > P.collapseDist + P.hyst && n.weight - 1 >= 4, `${n.name} collapses only beyond the limit and only if it has >= 4 nodes below`);
  }
  for (const n of nodes) if (st[n.id] === 2) for (const c of n.children) assert.equal(st[c.id], 1, 'below an aggregate everything is hidden');
}
// from the root a lot is collapsed; focusing a deep node expands its neighbourhood and collapses the rest
reset(); const atRoot = semanticStates(nodes, root, root, dist2d(root), P);
const orbsRoot = atRoot.reduce((c, v) => c + (v === 2 ? 1 : 0), 0), drawnRoot = atRoot.reduce((c, v) => c + (v !== 1 ? 1 : 0), 0);
assert.ok(orbsRoot > 100 && drawnRoot < nodes.length / 2, `the overview collapses far categories (${orbsRoot} aggregates, ${drawnRoot} of ${nodes.length} nodes drawn)`);
// hysteresis: a folder just inside the band keeps whatever state it had
{
  const f = root; reset();
  const cand = nodes.find((n) => n.type === 'folder' && !n.isGroup && !n.listOnly && n.weight - 1 >= 4 && n.parent === root.children[0] && hyperbolicDistanceExact(f.z, n.z) > 0);
  const d = hyperbolicDistanceExact(f.z, cand.z);
  const mid = { collapseDist: d, hyst: 0.5, minNodes: 4 };                            // d is in the middle of the band [d - 0.5, d + 0.5]
  cand.collapsed = false; const a = semanticStates(nodes, root, f, dist2d(f), mid)[cand.id];
  cand.collapsed = true; const b = semanticStates(nodes, root, f, dist2d(f), mid)[cand.id];
  assert.equal(a, 0, 'expanded stays expanded inside the band'); assert.equal(b, 2, 'collapsed stays collapsed inside the band');
}

// ---- family colours ----------------------------------------------------------------------------------------------------------------------------------------------------
{
  const t = makeDisplayTree(read('disease_tree.json'), { cap: 36 });
  assignFamilyHues(t.root);
  const arms = t.root.children;
  assert.equal(arms.length, 8);
  const hues = arms.map((a) => a.hue);
  hues.forEach((h, i) => assert.ok(Math.abs(h - (THEME.ARM_HUE_FIRST + ((THEME.ARM_HUE_LAST - THEME.ARM_HUE_FIRST) * i) / 7)) < 1e-12));
  assert.equal(new Set(hues).size, 8, 'eight families, eight hues');
  assert.equal(t.root.hue, THEME.ROOT_HUE);
  for (const n of t.nodes) { let a = n; while (a.parent && a.parent !== t.root) a = a.parent; if (n !== t.root) assert.equal(n.hue, a.hue, `${n.name} has its family's hue (groups too)`); }
  const s = makeDisplayTree(read('sample_tree.json'), { cap: 36 }); assignFamilyHues(s.root);
  assert.ok(s.nodes.every((n) => Number.isFinite(n.hue)));
}
console.log(`semanticzoom.test.js: all checks passed (Up skips groups for ${skipped} diseases; the overview draws ${drawnRoot} of ${nodes.length} nodes with ${orbsRoot} aggregates)`);
