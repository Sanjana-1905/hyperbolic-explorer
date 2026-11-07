// search.test.js - the name index and fuzzy matching (Phase 6a). Run: node tests/search.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createIndex, scoreName, letterMask, KIND } from '../src/search.js';
import { buildTree, nodePath } from '../src/layout3d.js';

const score = (q, name) => scoreName(q, letterMask(q), name, name.toLowerCase(), letterMask(name.toLowerCase()));

// --- the ranking ladder: exact > prefix > word start > inside > fuzzy > no match ---
assert.equal(score('node', 'node'), 1000);
assert.ok(score('node', 'nodes') > score('node', 'getNode'), 'prefix beats word start');
assert.ok(score('node', 'getNode') > score('node', 'mynodes'), 'word start beats the middle of a word');
assert.ok(score('node', 'mynodes') > score('gtnd', 'getNode'), 'substring beats fuzzy');
assert.ok(score('gtnd', 'getNode') > 0, 'fuzzy: letters in order with gaps still match');
assert.equal(score('xyz', 'getNode'), 0, 'letters missing -> no match');
assert.equal(score('dne', 'node'), 0, 'letters in the wrong order -> no match');
assert.ok(Math.abs(score('node', 'getNode') - 695.5) < 1e-9, 'worked example from the comment');
assert.ok(score('gn', 'getNode') > score('gn', 'agreement_string'), 'fuzzy hits on word starts score higher');

// --- the index on the committed sample ---
const json = JSON.parse(readFileSync(new URL('../public/data/sample_tree.json', import.meta.url), 'utf8'));
const { nodes } = buildTree(json);
const index = createIndex();
let t0 = performance.now();
index.addTree(nodes, nodePath);
const treeMs = performance.now() - t0;
assert.equal(index.size, nodes.length - 1, 'every node but the root is indexed');

t0 = performance.now();
let symbols = 0;
for (const file of nodes.filter((n) => n.hasSymbols)) {
  const doc = JSON.parse(readFileSync(new URL(`../public/data/${json.symbolsDir}/${file.fileId}.json`, import.meta.url), 'utf8'));
  index.addFileSymbols(file, nodePath(file), doc);
  const count = (a) => a.reduce((s, x) => s + 1 + count(x.children || []), 0);
  symbols += count(doc.symbols);
}
const symMs = performance.now() - t0;
assert.equal(index.size, nodes.length - 1 + symbols);

// Searching for the exact name of a symbol / file / folder finds it first.
const file = nodes.find((n) => n.hasSymbols);
let hits = index.search(file.name);
assert.equal(hits[0].name, file.name);
assert.ok(hits.length <= 10);
const folder = nodes.find((n) => n.type === 'folder' && n.parent && n.parent.parent);
hits = index.search(folder.name);
assert.ok(hits.some((h) => h.kind === KIND.folder && h.baseId === folder.id), 'folder found by name');

// A symbol hit carries the file id and the scanner's symbol index (pre-order), which main3d uses to navigate.
const doc = JSON.parse(readFileSync(new URL(`../public/data/${json.symbolsDir}/${file.fileId}.json`, import.meta.url), 'utf8'));
const walkNames = [];
(function walk(l) { for (const s of l) { walkNames.push(s.name); walk(s.children || []); } })(doc.symbols);
const wanted = walkNames[walkNames.length - 1];
hits = index.search(wanted, 50);
const hit = hits.find((h) => h.fileId === file.fileId && h.sym === walkNames.lastIndexOf(wanted));
assert.ok(hit, 'symbol hit has the right (fileId, sym)');

// Multi-word: the second word narrows by path.
hits = index.search(`${file.name} ${file.parent.name}`);
assert.ok(hits.length && hits[0].path.toLowerCase().includes(file.parent.name.toLowerCase()), 'second word narrows by path');
assert.deepEqual(index.search('   '), [], 'blank query -> nothing');

// Latency: 40 mixed queries over the whole index.
const queries = ['pars', 'getn', 'client.ts', 'api', 'rndr', 'store', 'x', 'handler', 'util', 'cache72', 'computeLayer', 'qq'];
t0 = performance.now();
let runs = 0;
for (let r = 0; r < 4; r++) for (const q of queries) { index.search(q); runs++; }
const perQuery = (performance.now() - t0) / runs;
assert.ok(perQuery < 25, `search too slow: ${perQuery.toFixed(2)} ms`);
console.log(`search.js: ${index.size} entries (tree ${treeMs.toFixed(1)} ms, ${symbols} symbols ${symMs.toFixed(0)} ms incl. file reads), ${perQuery.toFixed(2)} ms per query`);
console.log('search.test.js: all checks passed');
