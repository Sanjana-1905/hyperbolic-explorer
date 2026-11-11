// disease_layout.test.js - does the UNCHANGED 3D layout cope with the full Disease Ontology tree? Run: node tests/disease_layout.test.js
// KNOWN ISSUE (Phase 1, see PROGRESS.md): with edge length 0.7 and depth 12, 93 nodes (depths 9-12) hit the 0.995 radius clamp and
// their edges are shortened. The layout was NOT changed (a fix is only proposed). So this test REPORTS the clamp and only enforces
// the hard limit; run with STRICT=1 to make "0 clamped edges" a requirement once the fix has been approved and implemented.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, computeLayout3d, radiusOf, EDGE_LENGTH } from '../src/layout3d.js';
import { hyperbolicDistance3, MAX_RADIUS } from '../src/mobius3d.js';

const json = JSON.parse(readFileSync(new URL('../public/data/disease_tree.json', import.meta.url), 'utf8'));
const { root, nodes } = buildTree(json);
computeLayout3d(root);
let maxR = 0, maxDepth = 0, clamped = 0, minSib = Infinity, nearRim = 0, deepest = null;
const radiusByDepth = [];
for (const n of nodes) {
  const r = radiusOf(n);
  assert.ok(Number.isFinite(r), 'finite position');
  if (r > maxR) { maxR = r; deepest = n; }
  maxDepth = Math.max(maxDepth, n.depth);
  radiusByDepth[n.depth] = Math.max(radiusByDepth[n.depth] || 0, r);
  if (r >= MAX_RADIUS - 1e-9) nearRim++;
  // An edge the clamp had to shorten is not EDGE_LENGTH long any more.
  if (n.parent && Math.abs(hyperbolicDistance3(n.parent.pos, n.pos) - EDGE_LENGTH) > 1e-6) clamped++;
  for (let i = 0; i < n.children.length; i++) for (let j = i + 1; j < n.children.length; j++)
    minSib = Math.min(minSib, hyperbolicDistance3(n.children[i].pos, n.children[j].pos));
}
console.log(`disease layout: ${nodes.length} nodes, depth ${maxDepth}, max radius ${maxR.toFixed(5)} (limit ${MAX_RADIUS}), ` +
  `edges shortened by the clamp ${clamped}, nodes at the rim ${nearRim}, min sibling distance ${minSib.toFixed(4)}`);
console.log('  max radius per depth: ' + radiusByDepth.map((r, d) => `${d}:${r.toFixed(4)}`).join(' '));
assert.ok(maxR <= MAX_RADIUS + 1e-12, `radius clamp limit exceeded: ${maxR}`);
if (clamped > 0) console.log(`  KNOWN ISSUE: ${clamped} edges shortened by the clamp (depth problem), layout intentionally unchanged in Phase 1`);
if (process.env.STRICT) assert.equal(clamped, 0, `${clamped} edges were shortened by the 0.995 clamp (depth problem)`);
console.log('disease_layout.test.js: all checks passed');
