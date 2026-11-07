// Numeric checks for mobius3d.js. Run with:  npm test
// The first few checks use the same small examples as the explanation.
import assert from 'node:assert/strict';
import {
  vec3, vLength, vNeg, mobiusAdd3, hyperbolicDistance3, distanceToRadius,
  mobiusScale3, geodesicLerp3, geodesicLerp3Free, mobiusAdd3Free, clampToBall, conformalFactor3, coneAngleForTerritory,
  geodesicBezier3, straightenToward,
} from '../src/mobius3d.js';
import { complex, mobiusAdd } from '../src/mobius.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const closeVec = (a, b, msg) => {
  close(a.x, b.x, `${msg} x`); close(a.y, b.y, `${msg} y`); close(a.z, b.z, `${msg} z`);
};

// --- Möbius addition: worked examples ---------------------------------------

// Along one axis it is the "relativistic" addition (a + b) / (1 + ab):
// 0.5 ⊕ 0.5 = 1 / 1.25 = 0.8
closeVec(mobiusAdd3(vec3(0.5), vec3(0.5)), vec3(0.8), '0.5 ⊕ 0.5');

// Two perpendicular vectors, u = (0.5,0,0), v = (0,0.5,0):
// <u,v> = 0, |u|² = |v|² = 0.25
// top = (1 + 0 + 0.25) u + (1 − 0.25) v = (0.625, 0.375, 0)
// bottom = 1 + 0 + 0.0625 = 1.0625
const u = vec3(0.5, 0, 0), v = vec3(0, 0.5, 0);
const uv = mobiusAdd3(u, v), vu = mobiusAdd3(v, u);
closeVec(uv, vec3(0.625 / 1.0625, 0.375 / 1.0625, 0), 'u ⊕ v');
closeVec(vu, vec3(0.375 / 1.0625, 0.625 / 1.0625, 0), 'v ⊕ u (order matters)');

// Same answer as the 2D complex formula when both points lie in the z = 0 plane
const a2 = complex(0.3, -0.4), z2 = complex(-0.2, 0.6);
const r2 = mobiusAdd(a2, z2);
closeVec(mobiusAdd3(vec3(a2.x, a2.y, 0), vec3(z2.x, z2.y, 0)), vec3(r2.x, r2.y, 0), 'matches 2D');

// --- Undo property: (-a) ⊕ (a ⊕ p) = p --------------------------------------
// Several genuinely 3D pairs, including points fairly near the surface.
const pairs = [
  [vec3(0.3, -0.4, 0.2), vec3(-0.2, 0.6, 0.1)],
  [vec3(0.1, 0.2, 0.7), vec3(0.5, -0.5, -0.5)],
  [vec3(-0.6, 0.0, 0.6), vec3(0.0, 0.9, 0.0)],
];
for (const [a, p] of pairs) {
  closeVec(mobiusAdd3(vNeg(a), mobiusAdd3(a, p)), p, 'undo');
}

// Moving the centre: a ⊕ 0 = a, and (-a) ⊕ a = 0 (this is what refocusing does)
const A = pairs[0][0];
closeVec(mobiusAdd3(A, vec3()), A, 'a ⊕ 0');
closeVec(mobiusAdd3(vNeg(A), A), vec3(), '(-a) ⊕ a');

// --- Distance ----------------------------------------------------------------
// From the centre: d(0, 0.5) = 2 artanh(0.5) = ln 3 ≈ 1.0986
close(hyperbolicDistance3(vec3(), vec3(0.5)), Math.log(3), 'd(0, 0.5)');
// 0.8 is exactly twice as far as 0.5 (because 0.5 ⊕ 0.5 = 0.8)
close(hyperbolicDistance3(vec3(), vec3(0.8)), 2 * Math.log(3), 'd(0, 0.8)');
// Direction does not matter from the centre
close(hyperbolicDistance3(vec3(), vec3(0, 0, -0.5)), Math.log(3), 'd(0, -0.5 z)');

// Closed form agrees with "move u to the centre, then measure"
for (const [a, p] of pairs) {
  close(hyperbolicDistance3(a, p), 2 * Math.atanh(vLength(mobiusAdd3(vNeg(a), p))), 'two formulas agree');
}

// Distance preserved: d(m ⊕ a, m ⊕ p) = d(a, p) for any move m
const m = vec3(0.4, 0.1, -0.3);
for (const [a, p] of pairs) {
  close(hyperbolicDistance3(mobiusAdd3(m, a), mobiusAdd3(m, p)), hyperbolicDistance3(a, p), 'isometry');
}

// --- distanceToRadius / mobiusScale3 -----------------------------------------
close(distanceToRadius(Math.log(3)), 0.5, 'distanceToRadius(ln 3)');
// Halving the distance of 0.8 gives 0.5, in any direction
closeVec(mobiusScale3(0.5, vec3(0, 0, 0.8)), vec3(0, 0, 0.5), 'mobiusScale3');
closeVec(mobiusScale3(0.5, vec3()), vec3(), 'scale of centre');

// --- Geodesic interpolation ---------------------------------------------------
// Midpoint of 0 and 0.8 is 0.5
closeVec(geodesicLerp3(vec3(), vec3(0.8), 0.5), vec3(0.5), 'midpoint on axis');
for (const [a, p] of pairs) {
  closeVec(geodesicLerp3(a, p, 0), a, 'lerp t=0');
  closeVec(geodesicLerp3(a, p, 1), p, 'lerp t=1');
  const mid = geodesicLerp3(a, p, 0.5);
  // Midpoint is equidistant and lies ON the shortest path (d(a,mid)+d(mid,p) = d(a,p))
  close(hyperbolicDistance3(a, mid), hyperbolicDistance3(mid, p), 'midpoint equidistant');
  close(hyperbolicDistance3(a, mid) * 2, hyperbolicDistance3(a, p), 'midpoint is halfway');
  // A quarter of the way along is a quarter of the distance
  close(hyperbolicDistance3(a, geodesicLerp3(a, p, 0.25)) * 4, hyperbolicDistance3(a, p), 'quarter point');
}

// --- Clamp ---------------------------------------------------------------------
const s = 0.999 / Math.sqrt(3);
const c = clampToBall(vec3(s, s, s));
close(vLength(c), 0.995, 'clamp radius'); close(c.x, c.y, 'clamp direction'); close(c.y, c.z, 'clamp direction');
closeVec(clampToBall(vec3(0.1, 0.2, 0.3)), vec3(0.1, 0.2, 0.3), 'inside unchanged');
// Möbius addition never returns anything beyond the clamp
assert.ok(vLength(mobiusAdd3(vec3(0.99), vec3(0.99))) <= 0.995 + 1e-12, 'mobiusAdd3 clamps');

// --- Cone angle for a territory ---------------------------------------------------
// Worked example from the comment: d = 0.7, θ = 20° gives β ≈ 39.0°
const deg = Math.PI / 180;
const beta = coneAngleForTerritory(20 * deg, 0.7);
assert.ok(Math.abs(beta / deg - 39.0) < 0.1, `β should be about 39°, got ${beta / deg}`);
// Geometric check: put the child at distance d along +x. Walk very far from the
// child at angle β off the "away" direction. Seen from the parent (the origin),
// that far point should be at angle θ off the x axis.
{
  const d = 0.7, theta = 20 * deg;
  const child = vec3(distanceToRadius(d), 0, 0);
  const b = coneAngleForTerritory(theta, d);
  const far = mobiusAdd3(child, vec3(0.9999999 * Math.cos(b), 0.9999999 * Math.sin(b), 0));
  const seen = Math.atan2(far.y, far.x);
  assert.ok(Math.abs(seen - theta) < 1e-3, `far point seen at ${seen / deg}°, expected 20°`);
}

// --- Unclamped versions (used for symbols deep inside files near the rim) ---------
{
  // Inside the normal range they agree with the clamped versions.
  const a = vec3(0.3, 0.2, -0.1), b = vec3(-0.4, 0.5, 0.2);
  closeVec(mobiusAdd3Free(a, b), mobiusAdd3(a, b), 'free add = clamped add inside the ball');
  closeVec(geodesicLerp3Free(a, b, 0.37), geodesicLerp3(a, b, 0.37), 'free geodesic = clamped geodesic');
  // Near the rim they do NOT clamp: 0.99 ⊕ 0.99 on one axis is (1.98)/(1.9801) = 0.99995.
  assert.ok(mobiusAdd3Free(vec3(0.99), vec3(0.99)).x > 0.9999, 'free add may pass 0.995');
  assert.ok(mobiusAdd3(vec3(0.99), vec3(0.99)).x <= 0.995 + 1e-12, 'clamped add stops at 0.995');
  // Endpoints and midpoint of a geodesic that ends beyond 0.995: the midpoint is half the distance away.
  const p = vec3(0.9966, 0, 0), o = vec3();
  closeVec(geodesicLerp3Free(o, p, 1), p, 'free geodesic reaches a point at 0.9966');
  const mid = geodesicLerp3Free(o, p, 0.5);
  close(hyperbolicDistance3(o, mid) * 2, hyperbolicDistance3(o, p), 'midpoint is half way');
}

// --- Link curves (Phase 4c) ------------------------------------------------------
{
  // The worked example in mobius3d.js: 3 control points, t = 0.5 -> (0, 0.2087, 0).
  const b = geodesicBezier3([vec3(-0.5, 0, 0), vec3(0, 0.5, 0), vec3(0.5, 0, 0)], 0.5);
  close(b.x, 0, 'bezier example x'); assert.ok(Math.abs(b.y - 0.20871) < 1e-5, `bezier example y ${b.y}`);
  // Ends: t = 0 and t = 1 are the first and last control points.
  const pts = [vec3(0.1, 0.2, 0.3), vec3(-0.4, 0.5, 0.1), vec3(0.6, -0.2, 0.2), vec3(0.2, 0.7, -0.3), vec3(-0.5, -0.5, 0.4)];
  closeVec(geodesicBezier3(pts, 0), pts[0], 'bezier starts at p0');
  closeVec(geodesicBezier3(pts, 1), pts[4], 'bezier ends at p4');
  // Points on one geodesic give that geodesic: every curve point is on the geodesic a -> b.
  const a = vec3(-0.3, 0.1, 0.2), c = vec3(0.5, 0.4, -0.3);
  const onLine = [0, 0.2, 0.5, 0.7, 1].map((t) => geodesicLerp3(a, c, t));
  const q = geodesicBezier3(onLine, 0.37);
  close(hyperbolicDistance3(a, q) + hyperbolicDistance3(q, c), hyperbolicDistance3(a, c), 'collinear control points: curve on the geodesic');
  // Refocus first, curve after == curve first, refocus after (a Möbius move is an isometry). This is what the GPU relies on.
  const f = vec3(0.4, -0.3, 0.5);
  for (const t of [0.1, 0.37, 0.8]) {
    const moved = geodesicBezier3(pts.map((p) => mobiusAdd3(vNeg(f), p)), t);
    closeVec(moved, mobiusAdd3(vNeg(f), geodesicBezier3(pts, t)), `bezier commutes with refocus, t = ${t}`);
  }
  // Tension step: the worked example (0.207, 0.432, 0); tension 0 = on the chord, 1 = the tree point itself.
  const A = vec3(), B = vec3(0.6), P = vec3(0.2, 0.5, 0);
  const s = straightenToward(A, B, P, 0.5, 0.85);
  assert.ok(Math.abs(s.x - 0.20726) < 1e-5 && Math.abs(s.y - 0.43237) < 1e-5, `tension example ${JSON.stringify(s)}`);
  closeVec(straightenToward(A, B, P, 0.5, 0), vec3(1 / 3), 'tension 0: on the chord, halfway = 1/3');
  closeVec(straightenToward(A, B, P, 0.5, 1), P, 'tension 1: the tree point');
}

// --- Conformal factor ----------------------------------------------------------
close(conformalFactor3(vec3()), 0.5, 'factor at centre');
close(conformalFactor3(vec3(0.5)), 0.375, 'factor at r = 0.5');
close(conformalFactor3(vec3(0, 0.9, 0)), 0.095, 'factor at r = 0.9');

console.log('mobius3d.js: all checks passed');
console.log('u ⊕ v =', uv);
console.log('v ⊕ u =', vu);
