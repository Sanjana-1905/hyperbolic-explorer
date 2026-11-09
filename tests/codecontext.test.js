// codecontext.test.js - neighbours, dimmed context range, tappable call names and import lines (Phase 4d). Pure logic, no browser.
// Run: node tests/codecontext.test.js
import assert from 'node:assert/strict';
import { createLinkData, LINK_IMPORT, LINK_CALL } from '../src/links.js';
import {
  neighbours, contextRange, definitionLines, subtreeIndexes, callTargets, resolveSpec, matchImport, importTargets,
} from '../src/codecontext.js';

// ---- neighbours: siblings in source order; the (top level) block is never a neighbour ------------------------------
const file = { type: 'file', children: [] };
const sym = (name, startLine, kind = 'function', parent = file) => {
  const n = { type: 'symbol', kind, name, startLine, endLine: startLine + 5, parent, children: [] };
  parent.children.push(n);
  return n;
};
const c = sym('c', 30), a = sym('a', 3), b = sym('b', 12);              // deliberately not in source order
const block = sym('(top level)', 1, 'block');
assert.deepEqual([neighbours(b).prev, neighbours(b).next], [a, c], 'middle symbol: prev and next by line');
assert.equal(neighbours(a).prev, null, 'first symbol has no prev (the block does not count)');
assert.equal(neighbours(c).next, null, 'last symbol has no next');
assert.deepEqual(neighbours(block), { prev: null, next: null }, 'the block has no neighbours');
assert.deepEqual(neighbours(file), { prev: null, next: null }, 'a file has no neighbours');
const method = sym('m1', 4, 'method', a);                               // only child of a: no neighbours
assert.deepEqual(neighbours(method), { prev: null, next: null });

// ---- contextRange: n lines each side, clipped to the file ----------------------------------------------------------
assert.deepEqual(contextRange(10, 20, 21, 3), { beforeFrom: 7, beforeTo: 9, afterFrom: 21, afterTo: 21 });
const top = contextRange(1, 4, 50, 3);
assert.ok(top.beforeFrom > top.beforeTo, 'nothing before line 1');
const bottom = contextRange(48, 50, 50, 3);
assert.ok(bottom.afterFrom > bottom.afterTo, 'nothing after the last line');

// ---- helpers on the symbols document ------------------------------------------------------------------------------
const doc = { symbols: [
  { kind: 'class', name: 'A', startLine: 2, endLine: 20, children: [
    { kind: 'method', name: 'one', startLine: 3, endLine: 8 }, { kind: 'method', name: 'two', startLine: 10, endLine: 15 } ] },
  { kind: 'function', name: 'B', startLine: 22, endLine: 30 },
] };
assert.deepEqual([...definitionLines(doc)].sort((x, y) => x - y), [2, 3, 10, 22]);
assert.deepEqual([...subtreeIndexes(doc, 0)].sort(), [0, 1, 2], 'class A (0) = itself and its two methods');
assert.deepEqual([...subtreeIndexes(doc, 2)], [2], 'a method is only itself');
assert.deepEqual([...subtreeIndexes(doc, 3)], [3], 'B (3) is not part of A');

// ---- callTargets ---------------------------------------------------------------------------------------------------
// link = [fromFile, fromSym, toFile, toSym, type, confPercent]
const data = createLinkData({
  names: { 0: ['A', 'A.one', 'A.two', 'B'], 1: ['TreeState', 'TreeState.collectLayer', 'helper'] },
  links: [
    [0, 1, 1, 1, LINK_CALL, 80],   // A.one  -> TreeState.collectLayer (file 1)
    [0, 1, 0, 2, LINK_CALL, 70],   // A.one  -> A.two (same class)
    [0, 2, 0, 2, LINK_CALL, 70],   // A.two  -> A.two (recursion)
    [0, 3, 1, 2, LINK_CALL, 60],   // B      -> helper
    [0, 3, 1, 1, LINK_CALL, 30],   // B      -> TreeState.collectLayer again, but a weaker guess
    [0, -1, 1, -1, LINK_IMPORT, 100],
  ],
});
let t = callTargets(data, 0, subtreeIndexes(doc, 0));
assert.deepEqual([...t.keys()].sort(), ['collectLayer', 'two'], 'class A: calls of its methods, keyed by the part after the dot');
assert.equal(t.get('collectLayer').fileId, 1);
t = callTargets(data, 0, subtreeIndexes(doc, 2), 2);
assert.equal(t.size, 0, 'a recursive call leads nowhere new: left out');
t = callTargets(data, 0, null);
assert.deepEqual([...t.keys()].sort(), ['collectLayer', 'helper', 'two'], 'whole file: every call, imports are not calls');
assert.ok(Math.abs(t.get('collectLayer').conf - 0.8) < 1e-6, 'two links, same name: the more confident one wins (80 %, not 30 %)');
assert.equal(callTargets(data, 0, new Set([-1])).size, 0, 'top-level code made no calls here');

// ---- import lines --------------------------------------------------------------------------------------------------
const importer = 'api/events/views/server.js';
assert.deepEqual(resolveSpec('./index.js', importer), { path: 'api/events/views', relative: true }, 'index.js = its folder');
assert.deepEqual(resolveSpec('../lib/q', importer), { path: 'api/events/lib/q', relative: true });
assert.deepEqual(resolveSpec('../../../main', importer), { path: 'main', relative: true });
assert.deepEqual(resolveSpec('src/util', importer), { path: 'src/util', relative: false }, 'alias: not relative');
// Python: one dot = this folder, each extra dot one folder up
assert.deepEqual(resolveSpec('.helpers', 'pkg/sub/mod.py'), { path: 'pkg/sub/helpers', relative: true });
assert.deepEqual(resolveSpec('..core.m', 'pkg/sub/mod.py'), { path: 'pkg/core/m', relative: true });
assert.deepEqual(resolveSpec('core.m', 'pkg/sub/mod.py'), { path: 'core/m', relative: false });

const cands = [
  { fileId: 5, path: 'api/events/views/index.js' }, { fileId: 6, path: 'api/events/lib/q.ts' },
  { fileId: 7, path: 'main.js' }, { fileId: 8, path: 'other/main.js' }, { fileId: 9, path: 'lib/src/util/index.js' },
];
assert.equal(matchImport('./index.js', importer, cands).fileId, 5);
assert.equal(matchImport('../lib/q', importer, cands).fileId, 6, 'extension is optional');
assert.equal(matchImport('../../../main', importer, cands).fileId, 7, 'a relative import matches exactly, not another main.js');
assert.equal(matchImport('src/util', importer, cands).fileId, 9, 'an alias matches by its tail');
assert.equal(matchImport('lodash', importer, cands), null, 'an external package matches nothing');
assert.equal(matchImport('./missing', importer, cands), null);

const map = importTargets([
  { from: './index.js', names: ['X'], line: 1 }, { from: 'lodash', names: ['_'], line: 2 }, { from: '../lib/q', names: ['q'], line: 3 },
], importer, cands);
assert.deepEqual([...map.keys()], [1, 3], 'only resolved import lines are tappable');
assert.deepEqual(map.get(3), { fileId: 6, sym: -1, spec: '../lib/q' });

console.log('codecontext.js: all checks passed');