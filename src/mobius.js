// mobius.js - all hyperbolic geometry for the Poincaré disk model.
//
// THE MODEL IN ONE PARAGRAPH
// The whole infinite hyperbolic plane is drawn inside a unit disk (radius 1).
// Each point is a complex number z = x + i*y with |z| < 1. Near the centre the
// picture is almost undistorted. Toward the rim, distances are squeezed more
// and more, so the rim itself is infinitely far away. That squeezing is what
// gives us "focus + context": whatever sits at the centre looks big, and
// everything else gets smaller toward the edge but never disappears.
//
// CONVENTIONS
// - A point / complex number is a plain object { x, y } meaning x + i*y.
// - Curvature is -1 (the standard choice). With it, a point at Euclidean
//   radius r is at hyperbolic distance 2 * artanh(r) from the centre.
// - Every function is pure: it returns a new object and changes nothing.

// ---------------------------------------------------------------------------
// Small complex-number helpers
// ---------------------------------------------------------------------------

// Make a complex number x + i*y.
export function complex(x, y = 0) {
  return { x, y };
}

// Add two complex numbers: add the real parts and the imaginary parts separately.
export function cAdd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

// Subtract b from a, part by part.
export function cSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

// Multiply: (a.x + i a.y)(b.x + i b.y). Expand it and use i*i = -1:
//   real part      = a.x*b.x - a.y*b.y
//   imaginary part = a.x*b.y + a.y*b.x
export function cMul(a, b) {
  return { x: a.x * b.x - a.y * b.y, y: a.x * b.y + a.y * b.x };
}

// Divide a / b: multiply the top and bottom by conj(b). The bottom then becomes
// the real number |b|^2, so we just divide each part of a*conj(b) by it.
export function cDiv(a, b) {
  const d = b.x * b.x + b.y * b.y;
  return {
    x: (a.x * b.x + a.y * b.y) / d,
    y: (a.y * b.x - a.x * b.y) / d,
  };
}

// Complex conjugate: mirror across the real axis (flip the sign of y).
export function cConj(a) {
  return { x: a.x, y: -a.y };
}

// Negate: the point directly opposite through the centre.
export function cNeg(a) {
  return { x: -a.x, y: -a.y };
}

// Scale by a real number s (stretches the arrow from the origin by s).
export function cScale(a, s) {
  return { x: a.x * s, y: a.y * s };
}

// Length |a| = Euclidean distance from the origin (Pythagoras).
export function cAbs(a) {
  return Math.hypot(a.x, a.y);
}

// ---------------------------------------------------------------------------
// Hyperbolic operations
// ---------------------------------------------------------------------------

// The largest Euclidean radius we ever allow. Points closer to the rim than
// this are pushed back to it, which stops rounding errors from putting a point
// on or outside the circle (that would mean "infinitely far away" or invalid).
export const MAX_RADIUS = 0.995;

// Clamp: if z is too close to the rim, slide it straight back toward the
// centre (keeping its direction) until its radius is maxR. Points that are
// already inside are returned unchanged.
export function clampToDisk(z, maxR = MAX_RADIUS) {
  const r = cAbs(z);
  if (r <= maxR) return { x: z.x, y: z.y };
  return cScale(z, maxR / r);
}

// Möbius addition  a ⊕ z = (a + z) / (1 + conj(a) * z).
// In plain words, this is how you "move" in hyperbolic space. It is a rigid
// motion of the disk: the point that used to be at the centre (0) ends up at a,
// and every other point moves along with it, with all hyperbolic distances
// preserved. Calling it with -a undoes that: (-a) ⊕ a = 0. That is exactly how
// we refocus: to put node f at the centre, map every point z to (-f) ⊕ z.
// Note that the order matters: in general a ⊕ z is not the same as z ⊕ a.
export function mobiusAdd(a, z) {
  const top = cAdd(a, z);
  const bottom = cAdd(complex(1, 0), cMul(cConj(a), z));
  return clampToDisk(cDiv(top, bottom));
}

// Hyperbolic distance  d(z, w) = 2 * artanh( |z - w| / |1 - conj(z) * w| ).
// The fraction inside is how far w is from the centre after we move z to the
// centre (it is |(-z) ⊕ w|). From the centre, distance is simply 2 * artanh(r).
// Because artanh(r) grows without bound as r -> 1, the rim is infinitely far.
export function hyperbolicDistance(z, w) {
  const top = cAbs(cSub(z, w));
  const bottom = cAbs(cSub(complex(1, 0), cMul(cConj(z), w)));
  const r = Math.min(top / bottom, MAX_RADIUS); // guard against rounding to >= 1
  return 2 * Math.atanh(r);
}

// Convert a hyperbolic distance from the centre into a Euclidean radius on the
// disk. It is the reverse of "distance = 2 * artanh(r)", so r = tanh(d / 2).
// The layout uses it to answer "where do I draw something that is d away?".
export function distanceToRadius(d) {
  return Math.tanh(d / 2);
}

// Möbius scalar multiplication  t ⊗ v.
// Keep v's direction but multiply its hyperbolic distance from the centre by t.
// Steps: hyperbolic size of v = 2 * artanh(|v|); times t; back to a radius.
// (The factors of 2 cancel, so the radius is tanh(t * artanh(|v|)).)
export function mobiusScale(t, v) {
  const r = cAbs(v);
  if (r < 1e-12) return complex(0, 0); // the centre stays at the centre
  const newR = Math.tanh(t * Math.atanh(Math.min(r, MAX_RADIUS)));
  return cScale(v, newR / r);
}

// Geodesic interpolation from a to b, with t from 0 to 1.
// A geodesic is the shortest path between two points. In the Poincaré disk it
// looks like a circular arc that meets the rim at right angles (or a straight
// line through the centre). Recipe:
//   1. Move a to the centre. b goes to v = (-a) ⊕ b.
//   2. From the centre, geodesics are straight lines, so walk the fraction t of
//      the way toward v: t ⊗ v.
//   3. Move everything back so the centre returns to a: a ⊕ (t ⊗ v).
// Equal steps in t are equal hyperbolic distances, so animations look smooth.
// We use this both to animate refocusing and to sample curved edge arcs.
export function geodesicLerp(a, b, t) {
  const v = mobiusAdd(cNeg(a), b);
  return mobiusAdd(a, mobiusScale(t, v));
}

// ---------------------------------------------------------------------------
// Exact helpers used by the 2D layout (layout.js) and its tests
// ---------------------------------------------------------------------------

// Möbius addition WITHOUT the clamp. Same formula as mobiusAdd, but it never pulls a point back from the rim. The layout uses it because its
// radius budget (every path sums to at most 2·atanh(0.994)) already keeps every point inside radius 0.994; a silent clamp would only hide a
// bug, and a clamped edge is exactly what the tests must be able to detect.
// Example: 0.99 ⊕ 0.99 = 1.98 / 1.9801 = 0.99995 (mobiusAdd would return 0.995).
export function mobiusAddFree(a, z) {
  const top = cAdd(a, z);
  const bottom = cAdd(complex(1, 0), cMul(cConj(a), z));
  return cDiv(top, bottom);
}

// Exact hyperbolic distance  cosh d = 1 + 2·|z − w|² / ((1 − |z|²)(1 − |w|²)).
// hyperbolicDistance above clamps its answer for points near the rim, so two points close to the rim all look "at most 5.99 apart".
// This version has no clamp: it is what the layout tests use to check that an edge has exactly the length it was given.
// Example: z = 0, w = 0.5: cosh d = 1 + 2·0.25 / (1·0.75) = 1.6667, d = 1.0986 = 2·artanh(0.5), the same as hyperbolicDistance.
export function hyperbolicDistanceExact(z, w) {
  const d2 = (z.x - w.x) ** 2 + (z.y - w.y) ** 2;
  return Math.acosh(1 + (2 * d2) / ((1 - z.x * z.x - z.y * z.y) * (1 - w.x * w.x - w.y * w.y)));
}

// Distance between two points that are L1 and L2 away from a common centre, with an angle dTheta between their directions
// (hyperbolic law of cosines):  cosh d = cosh L1 · cosh L2 − sinh L1 · sinh L2 · cos dTheta.
// The layout uses it to ask "how far apart are two siblings?" before placing them. It returns cosh d, so callers take acosh themselves
// (acosh(max(1, x)) guards rounding).
// Example: L1 = L2 = 1, dTheta = π (opposite sides): cosh d = cosh²1 + sinh²1 = cosh 2, so d = 2 (they are on a straight line through the centre).
//          dTheta = 0: cosh d = cosh²1 − sinh²1 = 1, so d = 0 (same point).
export function coshDistancePolar(L1, L2, dTheta) {
  return Math.cosh(L1) * Math.cosh(L2) - Math.sinh(L1) * Math.sinh(L2) * Math.cos(dTheta);
}

// Wedge rule (the 2D twin of coneAngleForTerritory in mobius3d.js):  β = 2 · atan( e^d · tan(θ / 2) ).
// A child at hyperbolic distance d from its parent owns a "territory" seen from the parent of half-angle θ. Shine a wedge of half-angle β
// from the child, pointing straight away from the parent: from the parent's point of view the far end of that wedge covers only half-angle
// θ, with tan(θ/2) = e^(−d) · tan(β/2). Solving for β says how wide the child may fan out so that its whole subtree, however deep, stays
// inside its territory and never touches a sibling's.
// Example: d = 0.7, θ = 20° -> tan 10° = 0.1763, × e^0.7 (2.0138) = 0.3551, atan = 19.54°, × 2 -> β = 39.1°.
export function wedgeAngleForTerritory(theta, d) {
  return 2 * Math.atan(Math.exp(d) * Math.tan(theta / 2));
}
