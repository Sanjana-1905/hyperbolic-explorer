// minimap.test.js - the minimap's geometry, and the second dataset (WordNet). Run: node tests/minimap.test.js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { flatten, pickNearest } from '../src/minimap.js';
import { buildTree, computeLayout3d, assignFitAll } from '../src/layout3d.js';
import { vLength } from '../src/mobius3d.js';

// flatten: the worked example from the comment.
const p = flatten({ x: 0.5, y: -0.2, z: 0.8 }, 75, 75, 70);
assert.ok(Math.abs(p.x - 110) < 1e-9 && Math.abs(p.y - 89) < 1e-9 && p.z === 0.8);

// pickNearest: the worked example (12 px from a leaf vs 16 px from a folder with weight 100: the folder wins).
const leaf = { id: 0, weight: 1, type: 'file' }, folder = { id: 1, weight: 100, type: 'folder' };
const pts = [{ x: 12, y: 0 }, { x: 0, y: 16 }];
assert.equal(pickNearest([leaf, folder], pts, 0, 0, 22, () => true), folder);
assert.equal(pickNearest([leaf, folder], pts, 0, 0, 10, () => true), null, 'nothing within the hit radius');
assert.equal(pickNearest([leaf, folder], pts, 0, 0, 22, (n) => n === leaf), leaf, 'invisible nodes are skipped');

// The WordNet dataset: a valid tree, small enough for the ball, with the extra root fields and the licence file.
const json = JSON.parse(readFileSync(new URL('../public/data/wordnet_tree.json', import.meta.url), 'utf8'));
assert.ok(existsSync(new URL('../public/data/wordnet_LICENSE.txt', import.meta.url)), 'WordNet licence is shipped');
assert.equal(json.name, 'entity');
assert.ok(json.about && json.words.folder && json.words.file && json.license);
const { root, nodes } = buildTree(json);
assert.equal(nodes.length, 3000);
assert.ok(nodes.every((n) => n.name && (n.type === 'folder') === (n.children.length > 0)), 'folders have children, leaves do not');
assert.ok(Math.max(...nodes.map((n) => n.depth)) <= 8, 'depth limited so the layout fits the ball');
assert.ok(nodes.every((n) => !n.hasSymbols && !n.commits), 'a plain tree: no code fields');
computeLayout3d(root);
assignFitAll(root, 0.4);
const maxR = Math.max(...nodes.map((n) => vLength(n.pos)));
assert.ok(maxR <= 0.995 + 1e-9, `layout fits the ball: max radius ${maxR.toFixed(4)}`);
console.log(`minimap.test.js: all checks passed (WordNet: ${nodes.length} nodes, max radius ${maxR.toFixed(4)})`);
