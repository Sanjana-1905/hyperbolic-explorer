// mobius3d.js - all hyperbolic geometry for the 3D Poincaré ball model.
//
// THE MODEL IN ONE PARAGRAPH
// This is the 3D version of mobius.js. The whole infinite hyperbolic space is
// drawn inside a unit ball (radius 1). Each point is a vector {x, y, z} with
// length < 1. Near the centre the picture is almost undistorted; toward the
// surface of the ball distances are squeezed more and more, so the surface
// itself is infinitely far away. That squeezing gives "focus + context" in 3D.
//
// RELATION TO THE 2D VERSION
// In 2D we used complex numbers, which made Möbius addition a short fraction
// (a + z) / (1 + conj(a) z). There are no "complex numbers" in 3D, so we use
// the vector formula instead. If you put both points in the z = 0 plane, the
// vector formula gives exactly the same answer as the 2D one (tested).
//
// CONVENTIONS
// - A point / vector is a plain object { x, y, z }.
// - Curvature is -1. A point at Euclidean radius r is at hyperbolic distance
//   2 * artanh(r) from the centre (same as 2D).
// - Every function is pure: it returns a new object and changes nothing.

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

// Make a 3D vector. Missing components default to 0.
export function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

// Add two vectors component by component.
export function vAdd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

// Subtract b from a, component by component.
export function vSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

// Multiply every component by the real number s (stretches the arrow by s).
export function vScale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

// Negate: the point directly opposite through the centre.
export function vNeg(a) {
  return { x: -a.x, y: -a.y, z: -a.z };
}

// Dot product <a, b> = ax*bx + ay*by + az*bz.
// It is |a| |b| cos(angle between them): positive if they point the same way,
// zero if they are at right angles, negative if they point apart.
export function vDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// Length |a| = Euclidean distance from the origin (3D Pythagoras).
export function vLength(a) {
  return Math.hypot(a.x, a.y, a.z);
}

// ---------------------------------------------------------------------------
// Hyperbolic operations
// ---------------------------------------------------------------------------

// The largest Euclidean radius we ever allow (same value as 2D). Points closer
// to the surface than this are pulled back to it, so rounding errors can never
// put a point on or outside the ball.
export const MAX_RADIUS = 0.995;

// Clamp: if v is too close to the surface, slide it straight back toward the
// centre (keeping its direction) until its radius is maxR. Points already
// inside are returned unchanged (as a copy).
export function clampToBall(v, maxR = MAX_RADIUS) {
  const r = vLength(v);
  if (r <= maxR) return { x: v.x, y: v.y, z: v.z };
  return vScale(v, maxR / r);
}

// Möbius addition in the ball:
//
//            (1 + 2<u,v> + |v|²) u  +  (1 − |u|²) v
//   u ⊕ v = ---------------------------------------
//                 1 + 2<u,v> + |u|² |v|²
//
// In plain words, this is how you "move" in hyperbolic space. It is a rigid
// motion of the ball: the point that was at the centre (0) ends up at u, and
// every other point v moves along with it, keeping all hyperbolic distances.
// Using -u undoes it: (-u) ⊕ (u ⊕ v) = v. That is how we refocus: to bring
// node f to the centre, map every point p to (-f) ⊕ p.
// The answer is always some mix of u and v, so it stays in the plane through
// the origin that contains them. Order matters: u ⊕ v is not v ⊕ u in general.
export function mobiusAdd3(u, v) {
  return clampToBall(mobiusAdd3Free(u, v));
}

// The same formula WITHOUT the 0.995 clamp. Only the symbol layout uses it: a file near the rim has its
// functions placed even closer to the rim, and clamping would squash them onto one shell. The result is
// still a true point of the ball (radius < 1), and double precision keeps it exact out to about 0.9999.
export function mobiusAdd3Free(u, v) {
  const uv = vDot(u, v);
  const uu = vDot(u, u);
  const vv = vDot(v, v);
  const coefU = 1 + 2 * uv + vv;   // how much of u goes into the answer
  const coefV = 1 - uu;            // how much of v goes into the answer
  const bottom = 1 + 2 * uv + uu * vv;
  const top = vAdd(vScale(u, coefU), vScale(v, coefV));
  return vScale(top, 1 / bottom);
}

// Hyperbolic distance between two points in the ball:
//
//   d(u, v) = arcosh( 1 + 2 |u − v|² / ((1 − |u|²)(1 − |v|²)) )
//
// The top, |u − v|², is the ordinary straight-line distance squared. The
// bottom terms (1 − |u|²) and (1 − |v|²) shrink toward 0 near the surface, so
// the same Euclidean gap counts as a much larger hyperbolic distance out there.
// This gives the same number as 2 * artanh(|(-u) ⊕ v|) ("move u to the centre,
// then measure from the centre"), which the tests check, but it does not need
// the clamp, so it stays accurate even for points very near the surface.
export function hyperbolicDistance3(u, v) {
  const diff = vSub(u, v);
  const gap2 = vDot(diff, diff);
  const fu = 1 - vDot(u, u);
  const fv = 1 - vDot(v, v);
  return Math.acosh(1 + (2 * gap2) / (fu * fv));
}

// Convert a hyperbolic distance from the centre into a Euclidean radius in the
// ball. It is the reverse of "distance = 2 * artanh(r)", so r = tanh(d / 2).
// The layout uses it to answer "how far from the centre do I draw something
// that is d away?". Identical to the 2D version.
export function distanceToRadius(d) {
  return Math.tanh(d / 2);
}

// Möbius scalar multiplication  t ⊗ v.
// Keep v's direction but multiply its hyperbolic distance from the centre by t.
// Steps: hyperbolic size of v is 2 * artanh(|v|); times t; turn it back into a
// radius. The factors of 2 cancel, so the new radius is tanh(t * artanh(|v|)).
export function mobiusScale3(t, v) {
  const r = vLength(v);
  if (r < 1e-12) return vec3(0, 0, 0); // the centre stays at the centre
  const newR = Math.tanh(t * Math.atanh(Math.min(r, MAX_RADIUS)));
  return vScale(v, newR / r);
}

// Geodesic interpolation from a to b, with t from 0 to 1.
// A geodesic is the shortest path between two points. In the Poincaré ball it
// is a circular arc that meets the surface at right angles (or a straight line
// through the centre). Recipe, the same as 2D:
//   1. Move a to the centre. b goes to w = (-a) ⊕ b.
//   2. From the centre, geodesics are straight lines, so go the fraction t of
//      the way toward w: t ⊗ w.
//   3. Move back so the centre returns to a: a ⊕ (t ⊗ w).
// Equal steps in t are equal hyperbolic distances, so animations look smooth.
// Used for the refocus animation and to sample curved edges.
export function geodesicLerp3(a, b, t) {
  const w = mobiusAdd3(vNeg(a), b);
  return mobiusAdd3(a, mobiusScale3(t, w));
}

// The same geodesic WITHOUT any 0.995 clamping. The refocus animation uses it: a symbol deep inside a file
// near the rim can sit at radius 0.997, and a clamped path would stop at 0.995 and then pop to the target.
// Example (1D): a = 0, b = 0.9966: w = b, t = 0.5 -> tanh(0.5·artanh(0.9966)) = 0.921, no clamp needed.
export function geodesicLerp3Free(a, b, t) {
  const w = mobiusAdd3Free(vNeg(a), b);
  const r = vLength(w);
  if (r < 1e-12) return { x: a.x, y: a.y, z: a.z };
  const scaled = vScale(w, Math.tanh(t * Math.atanh(Math.min(r, 1 - 1e-12))) / r);
  return mobiusAdd3Free(a, scaled);
}

// How wide a cone must be, seen from a child, to fill a given angle seen from
// its parent "all the way out to infinity":
//
//   β = 2 · atan( e^d · tan(θ / 2) )
//
// Picture a child at hyperbolic distance d from its parent. Shine a cone of
// half-angle β from the child, pointing straight away from the parent. Looking
// from the parent, the far end of that cone (where it meets the surface of the
// ball) covers only a smaller half-angle θ, because moving d away shrinks all
// angles toward the direction of travel:  tan(θ/2) = e^(−d) · tan(β/2).
// This function solves that for β. The layout uses it so that if a child's
// subtree stays inside its cone of half-angle β, then (seen from the parent)
// the WHOLE subtree, however deep, stays inside the child's θ "territory".
// Example: d = 0.7, θ = 20° -> tan(10°) = 0.176, × e^0.7 (2.014) = 0.355,
// atan = 19.5°, × 2 -> β ≈ 39°. The child may fan out twice as wide.
export function coneAngleForTerritory(theta, d) {
  return 2 * Math.atan(Math.exp(d) * Math.tan(theta / 2));
}

// Conformal size factor  (1 − |v|²) / 2.
// The Poincaré ball is "conformal": small shapes keep their shape, only their
// size changes. Something of hyperbolic size s drawn at point v appears with
// Euclidean size about s * (1 − |v|²) / 2. At the centre the factor is 1/2,
// and it falls to 0 at the surface. The viewer multiplies node sizes by this
// so nodes shrink smoothly as they move away from the focus.
export function conformalFactor3(v) {
  return (1 - vDot(v, v)) / 2;
}
