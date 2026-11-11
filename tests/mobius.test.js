// Quick numeric checks for mobius.js. Run with:  npm test
// Each check uses the same small example as the explanation in the docs.
import assert from 'node:assert/strict';
import {
  complex, cAbs, mobiusAdd, hyperbolicDistance, geodesicLerp,
  clampToDisk, distanceToRadius, mobiusScale, cNeg,
  mobiusAddFree, hyperbolicDistanceExact, coshDistancePolar, wedgeAngleForTerritory,
} from '../src/mobius.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// Möbius addition on the real line: 0.5 ⊕ 0.5 = 1 / 1.25 = 0.8
close(mobiusAdd(complex(0.5), complex(0.5)).x, 0.8, '0.5 ⊕ 0.5');

// Order matters: 0.5 ⊕ 0.5i vs 0.5i ⊕ 0.5
const p = mobiusAdd(complex(0.5, 0), complex(0, 0.5));
const q = mobiusAdd(complex(0, 0.5), complex(0.5, 0));
close(p.x, 0.625 / 1.0625, 'p.x'); close(p.y, 0.375 / 1.0625, 'p.y');
close(q.x, 0.375 / 1.0625, 'q.x'); close(q.y, 0.625 / 1.0625, 'q.y');

// Undo: (-a) ⊕ (a ⊕ z) = z
const a = complex(0.3, -0.4), z = complex(-0.2, 0.6);
const back = mobiusAdd(cNeg(a), mobiusAdd(a, z));
close(back.x, z.x, 'undo x'); close(back.y, z.y, 'undo y');

// Distances: 0→0.5 is 1.0986..., 0→0.8 is exactly double that
close(hyperbolicDistance(complex(0), complex(0.5)), 2 * Math.atanh(0.5), 'd(0,0.5)');
close(hyperbolicDistance(complex(0), complex(0.8)), 2 * hyperbolicDistance(complex(0), complex(0.5)), 'd(0,0.8)');

// Möbius addition preserves distance
close(hyperbolicDistance(mobiusAdd(a, z), mobiusAdd(a, complex(0))), hyperbolicDistance(z, complex(0)), 'isometry');

// distanceToRadius is the inverse of 2*artanh
close(distanceToRadius(2 * Math.atanh(0.5)), 0.5, 'distanceToRadius');

// Scale: halving the distance of 0.8 gives 0.5
close(mobiusScale(0.5, complex(0.8)).x, 0.5, 'mobiusScale');

// Geodesic midpoint of 0 and 0.8 is 0.5; endpoints are exact
close(geodesicLerp(complex(0), complex(0.8), 0.5).x, 0.5, 'midpoint');
const g0 = geodesicLerp(a, z, 0), g1 = geodesicLerp(a, z, 1);
close(g0.x, a.x, 'lerp t=0'); close(g1.x, z.x, 'lerp t=1'); close(g1.y, z.y, 'lerp t=1 y');

// Geodesic midpoint is equidistant from both ends
const m = geodesicLerp(a, z, 0.5);
close(hyperbolicDistance(a, m), hyperbolicDistance(m, z), 'equidistant');

// Clamp: 0.999 (at 45°) is pulled back to 0.995 in the same direction
const c = clampToDisk(complex(0.999 * Math.SQRT1_2, 0.999 * Math.SQRT1_2));
close(cAbs(c), 0.995, 'clamp radius'); close(c.x, c.y, 'clamp direction');

console.log('mobius.js: all checks passed');
console.log('0.5 ⊕ 0.5i =', p, ' 0.5i ⊕ 0.5 =', q);

// ---- exact helpers for the 2D layout ----
// mobiusAddFree: same as mobiusAdd inside the disk, no clamp near the rim (0.99 ⊕ 0.99 = 1.98 / 1.9801)
close(mobiusAddFree(complex(0.5), complex(0.5)).x, 0.8, 'free 0.5 ⊕ 0.5');
close(mobiusAddFree(complex(0.99), complex(0.99)).x, 1.98 / 1.9801, 'free 0.99 ⊕ 0.99');
assert.equal(mobiusAdd(complex(0.99), complex(0.99)).x, 0.995, 'the clamped version stops at 0.995');
// hyperbolicDistanceExact: 0 -> 0.5 is 2·artanh(0.5); near the rim it does not saturate like hyperbolicDistance
close(hyperbolicDistanceExact(complex(0), complex(0.5)), 2 * Math.atanh(0.5), 'exact d(0, 0.5)');
close(hyperbolicDistanceExact(a, z), hyperbolicDistance(a, z), 'exact = clamped version away from the rim');
assert.ok(hyperbolicDistanceExact(complex(0.999), complex(-0.999)) > 2 * Math.atanh(0.995) + 1, 'exact distance is not capped at the clamp');
close(hyperbolicDistanceExact(complex(0.999), complex(-0.999)), 2 * 2 * Math.atanh(0.999), 'opposite points = twice the radius distance');
// coshDistancePolar: same point -> cosh d = 1; opposite points at L = 1 -> d = 2
close(coshDistancePolar(1, 1, 0), 1, 'polar same point');
close(Math.acosh(coshDistancePolar(1, 1, Math.PI)), 2, 'polar opposite points');
close(Math.acosh(coshDistancePolar(0.7, 0.4, 1.1)), hyperbolicDistanceExact(
  { x: Math.tanh(0.35), y: 0 }, { x: Math.tanh(0.2) * Math.cos(1.1), y: Math.tanh(0.2) * Math.sin(1.1) }), 'polar law of cosines matches the disk distance');
// wedgeAngleForTerritory: d = 0.7, theta = 20 degrees -> beta = 39.1 degrees; and tan(theta/2) = e^-d tan(beta/2) holds
const th = (20 * Math.PI) / 180, be = wedgeAngleForTerritory(th, 0.7);
assert.ok(Math.abs((be * 180) / Math.PI - 39.0978) < 1e-3, 'wedge angle example: about 39.1 degrees');
close(Math.tan(th / 2), Math.exp(-0.7) * Math.tan(be / 2), 'wedge angle inverse');
