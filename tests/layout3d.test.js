// Sanity checks for layout3d.js. Run with:  npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildTree, computeLayout3d, fibonacciCap, capArea, capAngleFromArea,
  radiusOf, EDGE_LENGTH,
} from '../src/layout3d.js';
import { vec3, vDot, vLength, hyperbolicDistance3 } from '../src/mobius3d.js';

const close = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

// --- cap helpers ----------------------------------------------------------------
close(capArea(Math.PI / 2), 2 * Math.PI, 'hemisphere area');
close(capArea(Math.PI), 4 * Math.PI, 'sphere area');
close(capAngleFromArea(2 * Math.PI), Math.PI / 2, 'area -> angle');

// --- Fibonacci cap: unit length, inside the cap -----------------------------------
const axis = vec3(0, 0, 1), alpha = Math.PI / 3;
const equal = Array(10).fill(0.1);
const dirs = fibonacciCap(equal, axis, alpha);
for (const d of dirs) {
  close(vLength(d), 1, 'unit direction');
  assert.ok(vDot(d, axis) >= Math.cos(alpha) - 1e-12, 'inside the cap');
}
// The first point sits in the middle of the first 10% of the cap's height:
// h = 1 − (1 − cos 60°) · 0.05 = 1 − 0.5 · 0.05 = 0.975
close(vDot(dirs[0], axis), 0.975, 'first Fibonacci height');
close(vDot(fibonacciCap([1], axis, alpha)[0], axis), 1, 'single child straight ahead');

// --- tiny hand-made tree --------------------------------------------------------
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
computeLayout3d(t.root);
close(radiusOf(t.root), 0, 'root at centre');
const a = t.root.children[0];
close(hyperbolicDistance3(t.root.pos, a.pos), EDGE_LENGTH, 'edge length');
// a's children should be FURTHER from the root than a (their cap faces away)
for (const k of a.children) assert.ok(hyperbolicDistance3(t.root.pos, k.pos) > EDGE_LENGTH, 'grandchild further out');

// --- full sample tree --------------------------------------------------------
const sample = JSON.parse(readFileSync(new URL('../public/data/sample_tree.json', import.meta.url)));
const s = buildTree(sample);
computeLayout3d(s.root);
assert.equal(s.nodes.length, 5000);

let maxR = 0, wrongLen = 0;
let minSib = Infinity, minSibInfo = '';
for (const n of s.nodes) {
  const p = n.pos;
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'finite position');
  maxR = Math.max(maxR, radiusOf(n));
  if (n.parent && Math.abs(hyperbolicDistance3(n.parent.pos, n.pos) - EDGE_LENGTH) > 1e-6) wrongLen++;
  // Minimum hyperbolic distance between any two children of the same folder
  const kids = n.children;
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const d = hyperbolicDistance3(kids[i].pos, kids[j].pos);
      if (d < minSib) { minSib = d; minSibInfo = `(${kids.length} siblings, depth ${kids[i].depth})`; }
    }
  }
}

// Extra information: the closest pair of ANY two nodes (not just siblings),
// to see whether different subtrees run into each other.
let minAny = Infinity;
for (let i = 0; i < s.nodes.length; i++) {
  for (let j = i + 1; j < s.nodes.length; j++) {
    const d = hyperbolicDistance3(s.nodes[i].pos, s.nodes[j].pos);
    if (d < minAny) minAny = d;
  }
}

assert.ok(maxR <= 0.995 + 1e-12, `radius clamp, max was ${maxR}`);
assert.equal(wrongLen, 0, 'every edge has length EDGE_LENGTH');
assert.ok(minSib > 0.1, `siblings too close: ${minSib}`);
assert.ok(minAny > 0.1, `two subtrees run into each other: ${minAny}`);

console.log('layout3d.js: all checks passed');
console.log(`  max Euclidean radius        ${maxR.toFixed(4)}  (limit 0.995)`);
console.log(`  edges off EDGE_LENGTH       ${wrongLen} of ${s.nodes.length - 1}`);
console.log(`  min sibling distance        ${minSib.toFixed(4)} ${minSibInfo}  (edge length ${EDGE_LENGTH})`);
console.log(`  min distance, any two nodes ${minAny.toFixed(4)}`);
