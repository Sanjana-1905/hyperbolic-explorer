// Sanity checks for layout.js (the 2D "S5" layout). Run with:  npm test
// The strict checks on the Disease Ontology (wedges, groups, caps, stability, list-only nodes) are in tests/displaytree.test.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, computeLayout, nodePath, EDGE_LENGTH, S5 } from '../src/layout.js';
import { cAbs, hyperbolicDistanceExact } from '../src/mobius.js';

// --- tiny hand-made tree: root with two children, one has two leaves -------
const tiny = {
  name: 'root', type: 'folder', size: 3, children: [
    { name: 'a', type: 'folder', size: 2, children: [
      { name: 'x', type: 'file', size: 1, children: [] },
      { name: 'y', type: 'file', size: 1, children: [] },
    ] },
    { name: 'b', type: 'file', size: 1, children: [] },
  ],
};
const t = buildTree(tiny);
computeLayout(t.root);
assert.equal(t.root.weight, 5);
assert.equal(t.root.children[0].weight, 3);
assert.equal(nodePath(t.root.children[0].children[1]), 'root/a/y');
assert.equal(cAbs(t.root.z), 0, 'root is at the centre');
// Child 'a' has weight 3 of the 4 nodes below the root: its share of the circle is (1 − MIX)/2 + MIX · 3/4 = 0.15 + 0.525 = 0.675 of 2π (243°).
// The fan starts at −180°, so a's slice is centred at −180° + 121.5° = −58.5°: lower right (x > 0, y < 0).
const a = t.root.children[0];
const expectAngle = -Math.PI + Math.PI * 2 * ((1 - S5.MIX) / 2 + (S5.MIX * 3) / 4) / 2;
assert.ok(Math.abs(Math.atan2(a.z.y, a.z.x) - expectAngle) < 1e-12, `a should be at ${(expectAngle * 180 / Math.PI).toFixed(1)}°, got ${JSON.stringify(a.z)}`);
assert.ok(Math.abs(Math.atan2(a.z.y, a.z.x) * 180 / Math.PI + 58.5) < 1e-9, 'that is −58.5° for MIX = 0.7');
assert.ok(Math.abs(hyperbolicDistanceExact(t.root.z, a.z) - EDGE_LENGTH) < 1e-9, 'edge length');
assert.equal(a.edgeLength, EDGE_LENGTH);

// --- full sample tree ------------------------------------------------------
const sample = JSON.parse(readFileSync(new URL('../public/data/sample_tree.json', import.meta.url)));
const s = buildTree(sample);
computeLayout(s.root);
assert.equal(s.nodes.length, 5000);

let maxR = 0, wrongLen = 0, ringEdges = 0, minSib = Infinity;
for (const n of s.nodes) {
  maxR = Math.max(maxR, cAbs(n.z));
  assert.ok(Number.isFinite(n.z.x) && Number.isFinite(n.z.y), 'finite position');
  // Every edge has EXACTLY the length stored on its node (the scheduled length, or longer on a ring): nothing was clamped.
  if (n.parent) {
    if (Math.abs(hyperbolicDistanceExact(n.parent.z, n.z) - n.edgeLength) > 1e-6) wrongLen++;
    if (n.edgeLength > EDGE_LENGTH + 1e-9) ringEdges++;
  }
  for (let i = 0; i < n.children.length; i++) for (let j = i + 1; j < n.children.length; j++) minSib = Math.min(minSib, hyperbolicDistanceExact(n.children[i].z, n.children[j].z));
}
assert.equal(wrongLen, 0, 'no edge was clamped or shortened');
assert.ok(maxR <= 0.994 + 1e-12, `radius limit 0.994, max was ${maxR}`);
assert.ok(minSib >= S5.ACCEPT, `siblings at least ${S5.ACCEPT} apart on the sample, min was ${minSib}`);
console.log(`layout.js: all checks passed (max radius ${maxR.toFixed(4)}, 0 of ${s.nodes.length - 1} edges clamped, ` +
  `${ringEdges} edges on rings, min sibling distance ${minSib.toFixed(4)})`);
