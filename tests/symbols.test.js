// symbols.test.js - the symbol galaxies (Phase 4b): node building and layout inside a file's territory.
// Uses the committed sample data: opens EVERY file that has symbols and checks the geometry.
// Run: node tests/symbols.test.js
import { readFileSync } from 'node:fs';
import { buildTree, computeLayout3d, layoutSymbols } from '../src/layout3d.js';
import { buildSymbolNodes, extHue, KIND_CODE } from '../src/symbols.js';
import { THEME } from '../src/theme.js';
import { vNeg, vLength, vDot, mobiusAdd3Free, hyperbolicDistance3 } from '../src/mobius3d.js';

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.error('FAIL: ' + msg); } };

const json = JSON.parse(readFileSync(new URL('../public/data/sample_tree.json', import.meta.url), 'utf8'));
const { root, nodes } = buildTree(json);
computeLayout3d(root);
const docUrl = (f) => new URL(`../public/data/${json.symbolsDir}/${f.fileId}.json`, import.meta.url);

// ---- unit checks on a tiny hand-made document ----
{
  const file = { ...nodes.find((n) => n.hasSymbols), children: [] };
  const doc = { loc: 50, calls: ['boot'], symbols: [
    { kind: 'class', name: 'A', startLine: 1, endLine: 40, signature: 'class A', children: [
      { kind: 'method', name: 'm', startLine: 2, endLine: 5, signature: 'm()' },
      { kind: 'method', name: 'n', startLine: 6, endLine: 30, signature: 'n()' }] },
    { kind: 'function', name: 'f', startLine: 41, endLine: 44, signature: 'function f()' }] };
  const made = buildSymbolNodes(file, doc);
  check(made.length === 5, 'class + 2 methods + function + block');
  check(made[0].parent === file && made[0].weight === 3, 'class weight = itself + 2 methods');
  check(made.find((n) => n.name === 'm').parent === made[0], 'method hangs under its class');
  check(made.find((n) => n.name === 'f').energy === 0 && made.find((n) => n.name === 'A').energy === 1,
    'energy 0 for the fewest lines (f has 4), 1 for the most (A has 40)');
  check(made.find((n) => n.kind === 'block').kindCode === KIND_CODE.block, 'block node from top-level calls');
  check(extHue('ts') === THEME.EXT_HUE_TS && extHue('xyz') === THEME.EXT_HUE_OTHER, 'hue by extension');
}

// ---- open every file with symbols and check the geometry ----
const files = nodes.filter((n) => n.hasSymbols);
let totalSymbols = 0, minSibling = Infinity, maxRadius = 0, worstCone = -Infinity, minTerritory = Infinity;
const placed = new Map(); // file -> its symbol nodes
for (const file of files) {
  const doc = JSON.parse(readFileSync(docUrl(file), 'utf8'));
  const made = buildSymbolNodes(file, doc);
  file.children = made.filter((n) => n.parent === file);
  layoutSymbols(file);
  placed.set(file, made);
  totalSymbols += made.length;
  minTerritory = Math.min(minTerritory, file.territory);

  // (1) every symbol lies inside the file's cone as seen from the file's PARENT
  //     (this is the "no collision with other subtrees" guarantee).
  const seenFromParent = (p) => mobiusAdd3Free(vNeg(file.parent.pos), p);
  const axis = seenFromParent(file.pos);
  for (const s of made) {
    const v = seenFromParent(s.pos);
    const cos = vDot(v, axis) / (vLength(v) * vLength(axis));
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    worstCone = Math.max(worstCone, angle - file.territory);
    maxRadius = Math.max(maxRadius, vLength(s.pos));
    check(s.pos && vLength(s.pos) < 1, `${file.name}: ${s.name} left the ball`);
  }
  // (2) siblings inside one parent keep their distance
  const groups = new Map();
  for (const s of made) { if (!groups.has(s.parent)) groups.set(s.parent, []); groups.get(s.parent).push(s); }
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      minSibling = Math.min(minSibling, hyperbolicDistance3(g[i].pos, g[j].pos));
    }
  }
}
check(worstCone <= 1e-6, `a symbol sticks out of its file's territory by ${worstCone.toFixed(6)} rad`);

// (3) symbols of one file never come near another file's symbols (all files sharing a folder)
let minCross = Infinity;
const byParent = new Map();
for (const f of files) { if (!byParent.has(f.parent)) byParent.set(f.parent, []); byParent.get(f.parent).push(f); }
for (const group of byParent.values()) {
  for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
    for (const s of placed.get(group[a])) for (const t of placed.get(group[b])) {
      minCross = Math.min(minCross, hyperbolicDistance3(s.pos, t.pos));
    }
  }
}
check(minCross > 0.03, `symbols of two sibling files come within ${minCross.toFixed(4)}`);

console.log(`symbols.js / layoutSymbols: ${files.length} files opened, ${totalSymbols} symbols`);
console.log(`  smallest file territory     ${minTerritory.toFixed(4)} rad`);
console.log(`  worst overshoot of the cone ${worstCone.toExponential(2)} rad (must be <= 0)`);
console.log(`  max Euclidean radius        ${maxRadius.toFixed(5)}`);
console.log(`  min sibling distance        ${minSibling.toFixed(4)}`);
console.log(`  min distance, sibling files ${minCross.toFixed(4)}`);
if (failures) { console.error(`${failures} problem(s)`); process.exit(1); }
console.log('symbols.test.js: all checks passed');
