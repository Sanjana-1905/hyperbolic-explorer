// disease_data.test.js - re-checks the generated Disease Ontology files with code that does NOT share anything with
// tools/make_disease_tree.py. Run: node tests/disease_data.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree } from '../src/layout.js';
import { deriveCapabilities } from '../src/capabilities.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const treeJson = read('disease_tree.json'), edgesDoc = read('disease_edges.json'), terms = read('disease_terms.json').terms, meta = read('disease_metadata.json');

// Tree: ids unique, every node has a DOID, and it is the shape the viewer reads.
const { nodes, root } = buildTree(treeJson);
const doidOf = new Map(); // node -> doid
(function walk(raw) { doidOf.set(raw.doid, raw); raw.children.forEach(walk); })(treeJson);
assert.equal(doidOf.size, nodes.length, 'DOIDs unique in the tree');
assert.equal(treeJson.doid, 'DOID:4');
assert.equal(nodes.length, meta.counts.tree_nodes);
assert.equal(nodes.length, meta.counts.active_terms, 'every active term is in the tree (nothing dropped)');
assert.equal(Object.keys(terms).length, meta.counts.active_terms);

// Edges: unique, endpoints are active terms, no self loops, acyclic (DFS), everything reachable from the root.
assert.equal(edgesDoc.edges.length, meta.counts.is_a_edges);
const parentsOf = new Map(), childrenOf = new Map();
const seen = new Set();
for (const [c, p] of edgesDoc.edges) {
  assert.ok(doidOf.has(c) && doidOf.has(p), `edge ${c}->${p} has unknown endpoint`);
  assert.notEqual(c, p);
  const key = `${c}|${p}`; assert.ok(!seen.has(key), `duplicate edge ${key}`); seen.add(key);
  (parentsOf.get(c) ?? parentsOf.set(c, []).get(c)).push(p);
  (childrenOf.get(p) ?? childrenOf.set(p, []).get(p)).push(c);
}
const state = new Map(); // 1 = on the stack, 2 = done
const stack = [['DOID:4', 0]];
state.set('DOID:4', 1);
while (stack.length) {          // iterative DFS: a back edge to a node on the stack is a cycle
  const top = stack[stack.length - 1], kids = childrenOf.get(top[0]) || [];
  if (top[1] < kids.length) {
    const k = kids[top[1]++];
    if (state.get(k) === 1) assert.fail(`cycle through ${k}`);
    if (!state.has(k)) { state.set(k, 1); stack.push([k, 0]); }
  } else { state.set(top[0], 2); stack.pop(); }
}
assert.equal(state.size, nodes.length, 'every term reachable from the root along is_a');
assert.equal([...parentsOf.keys()].length, nodes.length - 1, 'every term except the root has a parent');

// Primary tree is a subgraph of the edges, and the multi-parent count matches.
const doidByNode = new Map(); { let i = 0; (function w(raw) { doidByNode.set(nodes[i++], raw.doid); raw.children.forEach(w); })(treeJson); }
for (const n of nodes) if (n.parent) assert.ok(seen.has(`${doidByNode.get(n)}|${doidByNode.get(n.parent)}`), `tree edge of ${doidByNode.get(n)} is not an is_a edge`);
const multi = [...parentsOf.values()].filter((p) => p.length > 1).length;
assert.equal(multi, meta.parsing_statistics.multi_parent_diseases);
assert.equal(edgesDoc.edges.length - (nodes.length - 1), [...parentsOf.values()].reduce((s, p) => s + p.length - 1, 0), 'edges not in the tree = extra parents');

// Primary-parent rule re-derived: shortest distance (BFS), parent with the smallest distance, ties by numeric id.
const dist = new Map([['DOID:4', 0]]); const q = ['DOID:4'];
for (let h = 0; h < q.length; h++) for (const c of childrenOf.get(q[h]) || []) if (!dist.has(c)) { dist.set(c, dist.get(q[h]) + 1); q.push(c); }
const numeric = (d) => Number(d.split(':')[1]);
let maxDepth = 0;
for (const n of nodes) {
  if (!n.parent) continue;
  const d = doidByNode.get(n), best = [...parentsOf.get(d)].sort((a, b) => dist.get(a) - dist.get(b) || numeric(a) - numeric(b))[0];
  assert.equal(doidByNode.get(n.parent), best, `primary parent of ${d}`);
  assert.equal(n.depth, dist.get(d), `tree depth of ${d} = shortest distance`);
  maxDepth = Math.max(maxDepth, n.depth);
}
assert.equal(maxDepth, meta.parsing_statistics.max_hierarchy_depth_primary_tree);

// Details: nothing invented (only fields present), names agree with the tree.
for (const [d, t] of Object.entries(terms)) assert.equal(t.n, doidOf.get(d).name);
assert.equal(Object.values(terms).filter((t) => !t.def).length, meta.parsing_statistics.missing_definition);

// Provenance and capabilities.
assert.equal(meta.license.name.includes('CC0'), true);
assert.ok(/^[0-9a-f]{64}$/.test(meta.source.sha256) && meta.source.ontology_version && meta.download_date);
assert.deepEqual(treeJson.capabilities, []);
const caps = deriveCapabilities(treeJson);
assert.equal(caps.source, 'declared');
assert.deepEqual([caps.symbols, caps.codePanel, caps.gitHeat, caps.dependencies], [false, false, false, false]);
assert.deepEqual(meta.validation.problems, []);
console.log(`disease_data.test.js: all checks passed (${nodes.length} terms, ${edgesDoc.edges.length} is_a edges, ${multi} multi-parent, depth ${maxDepth})`);
