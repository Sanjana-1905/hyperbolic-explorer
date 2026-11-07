// theme.test.js - keeps src/theme.js honest.
//  1. Every value is a finite number, a 2-list or a 3-list of finite numbers.
//  2. Every theme name is used somewhere outside theme.js (no dead constants).
//  3. Shaders contain no leftover tuning literals of the kind that used to live there
//     (checked loosely: no `vec3(a, b, c)` colour constructors with fractional literals).
// Run: node tests/theme.test.js
import { readFileSync, readdirSync } from 'node:fs';
import { THEME, THEME_DEFINES } from '../src/theme.js';

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.error('FAIL: ' + msg); } };

for (const [k, v] of Object.entries(THEME)) {
  const nums = Array.isArray(v) ? v : [v];
  check(nums.length >= 1 && nums.length <= 3, `${k}: lists must have 1-3 numbers`);
  check(nums.every(Number.isFinite), `${k}: not a finite number`);
  check(typeof THEME_DEFINES[k] === 'string' && THEME_DEFINES[k].length > 0, `${k}: no GLSL define produced`);
  check(!/^\d+$/.test(THEME_DEFINES[k]), `${k}: define "${THEME_DEFINES[k]}" would be an int in GLSL`);
}

const srcDir = new URL('../src/', import.meta.url);
const source = readdirSync(srcDir).filter((f) => f.endsWith('.js') && f !== 'theme.js')
  .map((f) => readFileSync(new URL(f, srcDir), 'utf8')).join('\n');
for (const k of Object.keys(THEME)) {
  check(new RegExp(`\\b${k}\\b`).test(source), `${k}: defined in theme.js but never used`);
}

// Colour literals must not creep back into shaders (they belong in theme.js).
const glsl = readFileSync(new URL('glsl.js', srcDir), 'utf8');
// (Structural vectors such as vec3(0.0, 0.0, 1.0) are fine: only literals with a fractional part count.)
const num = '-?\\d*\\.\\d+';
const colourLiterals = (glsl.match(new RegExp(`vec3\\(\\s*${num}\\s*,\\s*${num}\\s*,\\s*${num}\\s*\\)`, 'g')) || [])
  .filter((lit) => /\.\d*[1-9]/.test(lit));
check(colourLiterals.length === 0, `glsl.js has colour-like literals: ${colourLiterals.join(' ')}`);

if (failures) { console.error(`${failures} problem(s)`); process.exit(1); }
console.log(`theme.js: all checks passed (${Object.keys(THEME).length} constants)`);
