// capabilities.test.js - dataset capability detection (Phase 0 of the Disease Atlas). Run: node tests/capabilities.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveCapabilities, CAPABILITY_NAMES, NO_CAPABILITIES } from '../src/capabilities.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const on = (c) => CAPABILITY_NAMES.filter((n) => c[n]);

// 1. The real legacy datasets (no "capabilities" field) are inferred and behave exactly as before.
const sample = deriveCapabilities(load('sample_tree.json'));
assert.equal(sample.source, 'inferred');
assert.deepEqual(on(sample), ['symbols', 'codePanel', 'gitHeat', 'dependencies'], 'sample repo keeps every code feature');
assert.deepEqual(sample.warnings, []);
const wordnet = deriveCapabilities(load('wordnet_tree.json'));
assert.equal(wordnet.source, 'inferred');
assert.deepEqual(on(wordnet), [], 'WordNet has no code features');
assert.deepEqual(wordnet.warnings, []);

// 2. A dataset can declare its own list (a future ontology: nothing code-specific).
const leaf = (name, extra = {}) => ({ name, type: 'file', size: 1, children: [], ...extra });
const ontology = { name: 'root', type: 'folder', size: 2, children: [leaf('a'), leaf('b')], capabilities: [] };
const o = deriveCapabilities(ontology);
assert.equal(o.source, 'declared');
assert.deepEqual(on(o), []);

// 3. Declared + backed by data: on. Missing from the list: off, even though the data exists (the list is the whole truth).
const gitTree = (extra) => ({ name: 'r', type: 'folder', size: 1, children: [leaf('f', { commits: 3, modified: '2025-01-01' })], ...extra });
assert.deepEqual(on(deriveCapabilities(gitTree({ capabilities: ['gitHeat'] }))), ['gitHeat']);
assert.deepEqual(on(deriveCapabilities(gitTree({ capabilities: [] }))), [], 'git data exists but is not declared: off');
assert.deepEqual(on(deriveCapabilities(gitTree({}))), ['gitHeat'], 'legacy: inferred from the data');

// 4. Declared but nothing behind it: switched off with a warning (no dead buttons).
const liar = deriveCapabilities({ name: 'r', type: 'folder', size: 1, children: [leaf('f')], capabilities: ['gitHeat', 'symbols', 'dependencies', 'codePanel'] });
assert.deepEqual(on(liar), []);
assert.equal(liar.warnings.length, 4);

// 5. Dependencies and the code panel need symbols plus their files; unknown names warn and are ignored.
const sym = { name: 'r', type: 'folder', size: 1, children: [leaf('f', { hasSymbols: true })], symbolsDir: 's' };
assert.deepEqual(on(deriveCapabilities({ ...sym, capabilities: ['symbols', 'dependencies', 'codePanel'] })), ['symbols'], 'no linksFile / sourceDir');
assert.deepEqual(on(deriveCapabilities({ ...sym, linksFile: 'l', sourceDir: 'src', capabilities: ['symbols', 'dependencies', 'codePanel'] })), ['symbols', 'codePanel', 'dependencies']);
const typo = deriveCapabilities({ ...sym, capabilities: ['symbols', 'githeat'] });
assert.deepEqual(on(typo), ['symbols']);
assert.ok(typo.warnings.some((w) => w.includes('githeat')));

// 6. Before loading, nothing optional is on; results are frozen.
assert.deepEqual(on(NO_CAPABILITIES), []);
assert.throws(() => { 'use strict'; sample.symbols = false; });
console.log('capabilities.test.js: all checks passed');
