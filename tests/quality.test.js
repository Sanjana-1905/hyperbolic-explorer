// quality.test.js - tier choice, the adaptive resolution step and the interface fade (pure logic, no browser).
// Run: node tests/quality.test.js
import assert from 'node:assert/strict';
import { THEME } from '../src/theme.js';
import { detectTier, settingsFor, createAdaptive } from '../src/quality.js';
import { stepFade } from '../src/idlefade.js';

globalThis.document = { hidden: false };   // createAdaptive looks at document.hidden

// Tier: a coarse pointer and a short side <= 600 is a phone; the URL can force a tier.
assert.equal(detectTier('', true, 412), 'phone');
assert.equal(detectTier('', true, 915), 'high');          // a tablet / big touch screen: full quality
assert.equal(detectTier('', false, 412), 'high');         // a small desktop window with a mouse
assert.equal(detectTier('?quality=low', false, 1080), 'low');
assert.equal(detectTier('?quality=phone', false, 1080), 'phone');
assert.equal(detectTier('?quality=high', true, 412), 'high');
assert.equal(settingsFor('phone').pixelRatio, THEME.PHONE_PIXEL_RATIO);
assert.ok(settingsFor('phone').dustCount < settingsFor('high').dustCount);
assert.ok(settingsFor('phone').maxHalos < settingsFor('high').maxHalos);

// Adaptive step. Example with ratio 1.5, step 0.8: 1.5 -> 1.2 -> 0.96 -> 0.768 -> (floor 0.75).
const lowered = [];
const a = createAdaptive({ pixelRatio: 1.5, enabled: true, onLower: (r) => lowered.push(r) });
let t = 0;
const run = (seconds, fps) => { for (const end = t + seconds * 1000; t < end; t += 100) a.tick(t, fps); };
run(THEME.ADAPT_WARMUP_S - 0.5, 20);
assert.equal(lowered.length, 0, 'no judging during the warm-up');
run(THEME.ADAPT_SECONDS + 1, 20);
assert.equal(lowered.length, 1, 'slow for 2 s -> one step');
assert.ok(Math.abs(lowered[0] - 1.2) < 1e-9);
run(THEME.ADAPT_COOLDOWN_S - 0.5, 20);
assert.equal(lowered.length, 1, 'cool-down after a step');
run(THEME.ADAPT_SECONDS + 1, 55);
assert.equal(lowered.length, 1, 'fast enough: no step');
for (let i = 0; i < 20; i++) run(THEME.ADAPT_SECONDS + THEME.ADAPT_COOLDOWN_S + 1, 20);
assert.equal(a.pixelRatio, THEME.ADAPT_MIN_PIXEL_RATIO, 'never below the floor');
// A short dip does not count.
const b = createAdaptive({ pixelRatio: 1.5, enabled: true, onLower: () => assert.fail('dip lowered quality') });
t = THEME.ADAPT_WARMUP_S * 1000 + 100;
for (let i = 0; i < 10; i++) { b.tick(t, 20); t += 100; }   // 1 s slow
b.tick(t, 60); t += 100;
for (let i = 0; i < 10; i++) { b.tick(t, 20); t += 100; }   // another 1 s slow (timer was reset)
// Disabled: never.
const c = createAdaptive({ pixelRatio: 1.5, enabled: false, onLower: () => assert.fail('disabled') });
for (let i = 0; i < 200; i++) c.tick(10000 + i * 100, 5);

// Fade: out takes UI_FADE_SECONDS, in takes UI_FADE_BACK_SECONDS.
assert.ok(Math.abs(stepFade(1, 0, THEME.UI_FADE_SECONDS / 2) - 0.5) < 1e-9);
assert.equal(stepFade(1, 0, 100), 0);
assert.equal(stepFade(0, 1, 100), 1);
assert.ok(Math.abs(stepFade(0, 1, THEME.UI_FADE_BACK_SECONDS / 4) - 0.25) < 1e-9);

console.log('quality.test.js: all checks passed');
