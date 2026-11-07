// heat.test.js - git heat numbers (Phase 6b). Run: node tests/heat.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeHeat, encodeHeat } from '../src/heat.js';
import { buildTree } from '../src/layout3d.js';
import { createLinkData, linkCounts, subjectOf } from '../src/links.js';

// Hand-made tree: root > [a (file, 9 commits), b (file, 99 commits), c (file, no git), d (folder) > e (file, 1 commit)]
const raw = (name, type, extra = {}, children = []) => ({ name, type, size: 1, children, ...extra });
const { nodes, root } = buildTree(raw('root', 'folder', {}, [
  raw('a', 'file', { commits: 9, modified: '2025-01-01' }),
  raw('b', 'file', { commits: 99, modified: '2026-01-01' }),
  raw('c', 'file'),
  raw('d', 'folder', {}, [raw('e', 'file', { commits: 1, modified: '2023-01-01' })]),
]));
const heat = computeHeat(nodes);
const id = (name) => nodes.find((n) => n.name === name).id;
const close = (x, y, msg) => assert.ok(Math.abs(x - y) < 1e-6, `${msg}: ${x} vs ${y}`);
close(heat.commits[id('b')], 1, 'most commits = 1');
close(heat.commits[id('a')], Math.log(10) / Math.log(100), 'ln(1+9)/ln(1+99) = 0.5');
close(heat.commits[id('e')], Math.log(2) / Math.log(100), '1 commit = 0.15');
assert.equal(heat.commits[id('c')], -1, 'no git data stays neutral');
close(heat.recency[id('b')], 1, 'newest = 1');
close(heat.recency[id('e')], 0, 'oldest = 0');
close(heat.recency[id('a')], (Date.parse('2025-01-01') - Date.parse('2023-01-01')) / (Date.parse('2026-01-01') - Date.parse('2023-01-01')), 'in between');
// Folders: average of their files, then ranked 0..1 among all folders (d averages 0.15, the root 0.55: d is lowest, root highest).
close(heat.commits[id('d')], 0, 'lowest folder -> 0');
close(heat.commits[root.id], 1, 'highest folder -> 1');
assert.equal(encodeHeat(-1), 0); close(encodeHeat(0.75), 2.75, 'flag = 2 + heat');

// Sample dataset: every number in range, some neutral, fake flag set.
const json = JSON.parse(readFileSync(new URL('../public/data/sample_tree.json', import.meta.url), 'utf8'));
assert.equal(json.fakeGit, true, 'the sample must say its git data is fake');
const sample = buildTree(json).nodes;
const h = computeHeat(sample);
const files = sample.filter((n) => n.type === 'file');
const neutral = files.filter((n) => h.commits[n.id] < 0).length;
assert.ok(neutral > 0 && neutral < files.length * 0.3, `some files without git data (${neutral})`);
assert.ok(files.every((n) => h.commits[n.id] <= 1 && h.recency[n.id] <= 1));
const hotShare = files.filter((n) => h.commits[n.id] > 0.6).length / files.length;
assert.ok(hotShare > 0.05 && hotShare < 0.5, `a pattern: some hot, most not (${hotShare.toFixed(2)})`);

// linkCounts: file 0 imports files 1 and 2; file 3 imports file 0; file 0 has an internal call.
const data = createLinkData({ links: [[0, -1, 1, -1, 0, 100], [0, -1, 2, -1, 0, 100], [3, -1, 0, -1, 0, 100], [0, 1, 0, 2, 1, 70], [3, 0, 0, 1, 1, 60]] });
const c = linkCounts(data, { fileId: 0, sym: null }, () => null);
assert.deepEqual(c, { importsIn: 1, importsOut: 2, callsIn: 1, callsOut: 0 }, 'file counts (the internal call is not counted)');
const cs = linkCounts(data, { fileId: 0, sym: 1 }, () => null);
assert.deepEqual(cs, { importsIn: 0, importsOut: 0, callsIn: 1, callsOut: 1 }, 'symbol counts');
console.log('heat.test.js: all checks passed');
