// layout3d.js - place every tree node inside the 3D Poincaré ball.
//
// THE IDEA (the 3D version of layout.js)
// - The root sits at the centre of the ball.
// - Every child sits at the same fixed hyperbolic distance (EDGE_LENGTH) from
//   its parent.
// - In 2D a parent shared out an ANGLE (a fan). In 3D it shares out a CAP: the
//   patch of a sphere around the parent within some angle of a central
//   direction. The cap faces AWAY from the parent's own parent, so a subtree
//   grows outward and never folds back. The root uses the whole sphere.
// - Each child gets a share of the cap's area (its "territory"). Half of the
//   share is equal for every child, half is proportional to subtree weight,
//   so big subtrees get more room but small ones are not squeezed to nothing.
// - The children sit along a Fibonacci spiral, which spreads points evenly.
// - Each child's own cap (for ITS children) is made as wide as possible while
//   its whole subtree, out to infinity, still stays inside its territory
//   (see coneAngleForTerritory in mobius3d.js). That is what stops different
//   subtrees from running into each other.
//
// LOCAL FRAMES
// All of the placing is done in the parent's "own frame": the ball after a
// Möbius move that brings the parent to the centre. There, distances from the
// parent are measured from the origin and directions are simple unit vectors.
// A point `local` in that frame really sits at  parent.pos ⊕ local.
//
// This file has no drawing code, so it can be tested from the command line.

import {
  vec3, vScale, vAdd, vNeg, vLength, mobiusAdd3, mobiusAdd3Free, distanceToRadius, hyperbolicDistance3,
  coneAngleForTerritory,
} from './mobius3d.js';

// Reuse the JSON -> tree code from the 2D layout (it does no geometry).
export { buildTree, nodePath, edgeLengthSchedule, treeDepth } from './layout.js';
import { edgeLengthSchedule, treeDepth } from './layout.js';

// Hyperbolic length of every parent->child edge. A bit longer than 2D's 0.6:
// longer edges give each subtree more room (the cone rule multiplies by
// e^EDGE_LENGTH), but the deepest nodes move closer to the 0.995 limit.
// 0.7 keeps the 5,000-node sample tree (depth 8) at max radius ≈ 0.991.
export const EDGE_LENGTH = 0.7;

// Hyperbolic length of every edge INSIDE a file (file -> class -> method ...). Shorter than a folder edge
// because a file's whole galaxy has to fit in the one territory the file owns among its siblings.
export const SYMBOL_EDGE_LENGTH = 0.5;

// Fraction of a file's territory its symbol cone may use (see layoutSymbols).
export const SYMBOL_CAP_FIT = 0.8;

// How a child's share of its parent's cap is decided:
//   share = (1 − WEIGHT_MIX) · (1 / number of children)
//         +      WEIGHT_MIX  · (child's weight / total weight of the children)
// 0 would mean "everyone equal", 1 "purely by subtree size".
export const WEIGHT_MIX = 0.5;

// Circles never tile a sphere perfectly, so each territory only claims this
// fraction of its share of the area. The rest is the gap between neighbours.
export const PACKING = 0.9;

// The widest cap any node may use for its children (a hemisphere). Wider caps
// would start pointing sideways or back toward the node's own parent.
export const MAX_CAP = 0.5 * Math.PI;

// The golden angle, about 137.5°. Turning by this much between consecutive
// points never lines points up in rows, which is why Fibonacci spirals look
// evenly spread (sunflower seeds use the same trick).
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// ---------------------------------------------------------------------------
// Small direction helpers (ordinary Euclidean geometry of directions)
// ---------------------------------------------------------------------------

// Make a vector length 1 while keeping its direction.
function normalize(v) {
  return vScale(v, 1 / vLength(v));
}

// Cross product a × b: a vector at right angles to both a and b.
function cross(a, b) {
  return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

// Given a unit direction `axis`, return two more unit vectors e1, e2 so that
// (e1, e2, axis) are all at right angles to each other, like the x, y, z axes
// of a room whose "up" is `axis`. We cross with whichever world axis is least
// parallel to `axis`, so the cross product never comes out (nearly) zero.
function basisAround(axis) {
  const helper = Math.abs(axis.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0);
  const e1 = normalize(cross(axis, helper));
  const e2 = cross(axis, e1); // already length 1, because axis ⟂ e1
  return { e1, e2 };
}

// Area (solid angle) on a unit sphere of a cap with half-angle α:
//   area = 2π (1 − cos α)
// A hemisphere (α = π/2) gives 2π; the whole sphere (α = π) gives 4π.
export function capArea(alpha) {
  return 2 * Math.PI * (1 - Math.cos(alpha));
}

// The reverse: the half-angle of a cap with the given area,
//   α = arccos(1 − area / 2π)
// (clamped to the valid range so rounding can't break acos).
export function capAngleFromArea(area) {
  return Math.acos(Math.max(-1, Math.min(1, 1 - area / (2 * Math.PI))));
}

// ---------------------------------------------------------------------------
// Fibonacci points on a cap
// ---------------------------------------------------------------------------

// Return one unit direction per entry of `shares` (fractions adding up to 1),
// spread over the cap of half-angle `alpha` around the unit direction `axis`.
//
// Recipe (a Fibonacci spiral restricted to the cap):
//   - Equal steps in height along the axis cut a cap into rings of EQUAL AREA
//     (Archimedes' hat-box theorem). So if point i should own the fraction
//     shares[i] of the area, we give it the height in the middle of its slice:
//       h_i = 1 − (1 − cos α) · (sum of earlier shares + shares[i] / 2)
//     With all shares equal (1/n) this is the classic Fibonacci spiral.
//   - Its angle around the axis is  φ_i = i · golden angle.
//   - Its distance from the axis is  sqrt(1 − h_i²)  (so the vector has length 1).
// One point is a special case: put it straight along the axis.
export function fibonacciCap(shares, axis, alpha) {
  if (shares.length === 1) return [vec3(axis.x, axis.y, axis.z)];
  const { e1, e2 } = basisAround(axis);
  const capHeight = 1 - Math.cos(alpha);
  const dirs = [];
  let before = 0; // sum of the shares of earlier points
  shares.forEach((share, i) => {
    const h = 1 - capHeight * (before + share / 2);
    before += share;
    const side = Math.sqrt(Math.max(0, 1 - h * h));
    const phi = i * GOLDEN_ANGLE;
    // direction = h·axis + side·(cos φ · e1 + sin φ · e2)
    const around = vAdd(vScale(e1, Math.cos(phi)), vScale(e2, Math.sin(phi)));
    dirs.push(vAdd(vScale(axis, h), vScale(around, side)));
  });
  return dirs;
}

// ---------------------------------------------------------------------------
// The layout itself
// ---------------------------------------------------------------------------

// Fill in `node.pos` (a point in the ball) for every node under `root`.
// `options` can override the constants above (used for tuning and tests).
export function computeLayout3d(root, options = {}) {
  const opts = {
    edgeLength: EDGE_LENGTH, weightMix: WEIGHT_MIX, packing: PACKING, maxCap: MAX_CAP,
    ...options,
  };
  // Euclidean radius, in a node's own frame, of something one edge away:
  // r = tanh(d / 2). With d = 0.7 that is r ≈ 0.336.
  // Edge length per depth: all equal to opts.edgeLength, except in a tree too deep for the ball (see edgeLengthSchedule in layout.js).
  opts.edgeLengths = opts.edgeLengths || edgeLengthSchedule(treeDepth(root), opts.edgeLength);

  root.pos = vec3(0, 0, 0);
  // The root has no parent, so it uses the whole sphere (half-angle π).
  // Any axis works for a full sphere; +z is just a choice.
  placeChildren(root, vec3(0, 0, 1), Math.PI, opts);
}

// Place the children of `node` on the cap (axis, alpha), which is given in the
// node's own frame, then recurse into each child.
function placeChildren(node, axis, alpha, opts) {
  const n = node.children.length;
  if (n === 0) return;

  // Heaviest children first. The spiral starts at the middle of the cap and
  // winds outward, so big subtrees get the central spots, and the territory
  // sizes change gradually along the spiral (which keeps the spacing even).
  const kids = [...node.children].sort((a, b) => b.weight - a.weight);
  // Sum of the children's weights (= number of nodes below this node, for a folder).
  const totalWeight = kids.reduce((sum, child) => sum + child.weight, 0);
  const add = opts.add || mobiusAdd3;
  const shares = kids.map((child) =>
    (1 - opts.weightMix) / n + opts.weightMix * (child.weight / totalWeight));

  const dirs = fibonacciCap(shares, axis, alpha);
  const myArea = capArea(alpha);

  kids.forEach((child, i) => {
    // In the node's own frame the child is simply distanceToRadius(its edge length) along dirs[i];
    // moving back with ⊕ gives its real position.
    // This child's own edge length (the same for every child of one depth; symbols have no schedule and use opts.edgeLength).
    child.edgeLength = opts.edgeLengths ? opts.edgeLengths[child.depth] ?? opts.edgeLength : opts.edgeLength;
    child.pos = add(node.pos, vScale(dirs[i], distanceToRadius(child.edgeLength)));

    // Which way is our node, as seen from the child's own frame? Move the
    // child to the centre and see where the node lands. The child's cap points
    // the OPPOSITE way, i.e. away from its parent.
    const parentSeenFromChild = add(vNeg(child.pos), node.pos);
    const away = normalize(vNeg(parentSeenFromChild));

    // The child's territory, seen from our node: a cap with its share of our
    // area (minus the packing gap). Then the widest cone the child can use so
    // its whole subtree stays inside that territory.
    const territory = capAngleFromArea(myArea * shares[i] * opts.packing);
    const childCap = Math.min(opts.maxCap, coneAngleForTerritory(territory, child.edgeLength));
    // Remember where this node's own cap points and how much room it owns, so a FILE can later
    // open into a galaxy of symbols inside exactly that room (layoutSymbols below).
    child.away = away;
    child.territory = territory;

    placeChildren(child, away, childCap, opts);
  });
}

// Euclidean distance from the centre of the ball, handy for tests and drawing.
export function radiusOf(node) {
  return vLength(node.pos);
}

// ---------------------------------------------------------------------------
// Symbols: a file opens into its own little galaxy
// ---------------------------------------------------------------------------

// Place the symbol nodes already attached to `file` (file.children, each with a `weight`).
// A file got a TERRITORY (a cap seen from its parent) when the folder tree was laid out, and the
// cone rule guarantees that anything inside the file's cone, out to infinity, stays inside that
// territory, so a file's galaxy can never run into a neighbouring file's. This is the same rule that
// keeps folders apart, now applied one level further down:
//   1. the file's own cone: half-angle  β = 2·atan(e^d · tan(θ/2))  with d = EDGE_LENGTH (the file's
//      distance from its parent) and θ = the file's territory;
//   2. its children sit SYMBOL_EDGE_LENGTH away on a Fibonacci spiral over that cone, and each of
//      them gets a share of the cone for ITS children, exactly like folders.
// Children near the rim of a cap own territories that spill a little over the rim, so the cone is first
// shrunk to SYMBOL_CAP_FIT of the file's territory; the spill then still ends up inside it.
// Positions are not clamped to 0.995 (mobiusAdd3Free): the file may already be near the rim.
export function layoutSymbols(file, options = {}) {
  const opts = {
    edgeLength: SYMBOL_EDGE_LENGTH, weightMix: WEIGHT_MIX, packing: PACKING, maxCap: MAX_CAP,
    add: mobiusAdd3Free, ...options,
  };
  const cap = Math.min(opts.maxCap, coneAngleForTerritory(file.territory * SYMBOL_CAP_FIT, file.edgeLength ?? EDGE_LENGTH));
  placeChildren(file, file.away, cap, opts);
}

// ---------------------------------------------------------------------------
// Crowding-aware node size: "fit"
// ---------------------------------------------------------------------------
// Node sizes are fixed hyperbolic lengths, but siblings can sit very close together (a class with 80 methods on a
// small cap). Zooming does not help: sizes and distances grow together, so crowded balls stay overlapped. Hyperbolic
// space is meant to make room where you look, so every node gets a size LIMIT from its surroundings:
//     fit = fraction × (hyperbolic distance to its nearest sibling)
// and the shader draws its solid core with radius min(normal size, fit). With fraction 0.4 two neighbouring cores can
// at most take 80 % of the gap between them, so they never overlap, at any zoom level and from any viewpoint (the
// Poincaré shrink (1 − r²)/2 scales sizes and distances alike, so the comparison holds wherever the node is drawn).
// A node with no sibling is limited by its distance to its parent instead.
// Example: three siblings at distances 0.06, 0.10 and 0.17 from each other, fraction 0.4:
//   the first two have nearest-sibling distance 0.06 -> fit 0.024; the third 0.10 -> fit 0.04.
// Sets child.fit for every child below `node` (the node's own fit is left alone).
export function assignFitAll(node, fraction) {
  const kids = node.children;
  for (const c of kids) {
    let nearest = hyperbolicDistance3(c.pos, node.pos);          // alone: the parent is the neighbour
    if (kids.length > 1) {
      nearest = Infinity;
      for (const o of kids) if (o !== c) nearest = Math.min(nearest, hyperbolicDistance3(c.pos, o.pos));
    }
    c.fit = fraction * nearest;
  }
  for (const c of kids) if (c.children.length) assignFitAll(c, fraction);
}
