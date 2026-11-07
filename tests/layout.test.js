// Sanity checks for layout.js. Run with:  npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, computeLayout, nodePath, EDGE_LENGTH } from '../src/layout.js';
import { cAbs, hyperbolicDistance } from '../src/mobius.js';

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
// Child 'a' has weight 3 of 4 below root, so it gets 3/4 of the circle (270°).
// The fan starts at -180°, so a's slice spans -180°..90° and is centred at
// -45° -> lower-right quadrant (x > 0, y < 0, and |x| = |y|).
const a = t.root.children[0];
assert.ok(a.z.x > 0 && a.z.y < 0, `a should be at -45°, got ${JSON.stringify(a.z)}`);
assert.ok(Math.abs(a.z.x + a.z.y) < 1e-12, 'exactly 45° below the x axis');
assert.ok(Math.abs(hyperbolicDistance(t.root.z, a.z) - EDGE_LENGTH) < 1e-9, 'edge length');

// --- full sample tree ------------------------------------------------------
const sample = JSON.parse(readFileSync(new URL('../public/data/sample_tree.json', import.meta.url)));
const s = buildTree(sample);
computeLayout(s.root);
assert.equal(s.nodes.length, 5000);

let maxR = 0, wrongLen = 0;
for (const n of s.nodes) {
  maxR = Math.max(maxR, cAbs(n.z));
  assert.ok(Number.isFinite(n.z.x) && Number.isFinite(n.z.y), 'finite position');
  // Every edge should have length EDGE_LENGTH (unless clamping near the rim).
  if (n.parent && Math.abs(hyperbolicDistance(n.parent.z, n.z) - EDGE_LENGTH) > 1e-6) wrongLen++;
}
assert.ok(maxR <= 0.995 + 1e-12, `radius clamp, max was ${maxR}`);
console.log(`layout.js: all checks passed (max radius ${maxR.toFixed(4)}, ` +
  `${wrongLen} of ${s.nodes.length - 1} edges affected by the rim clamp)`);
