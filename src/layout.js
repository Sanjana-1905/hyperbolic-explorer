// layout.js - place every tree node on the Poincaré disk.
//
// THE IDEA
// - The root sits at the centre of the disk.
// - Every child sits at the same fixed hyperbolic distance (EDGE_LENGTH) from
//   its parent.
// - A parent hands out its available angle ("fan") to its children in slices
//   proportional to each child's subtree size, so big subtrees get more room.
//
// This file has no drawing code, so it can be tested from the command line.

import { complex, mobiusAdd, cNeg, distanceToRadius } from './mobius.js';

// Hyperbolic length of every parent->child edge. Smaller values keep deep
// levels away from the rim (where points get clamped at radius 0.995).
export const EDGE_LENGTH = 0.6;

// ---------------------------------------------------------------------------
// Depth-tapered edge length (shared by the 2D and the 3D layout)
// ---------------------------------------------------------------------------
// A point at hyperbolic distance D from the centre has Euclidean radius tanh(D / 2). A node can never be further from the root
// than the SUM of the edge lengths on its path (triangle inequality), so if the sum over the deepest path is at most
//     BUDGET = 2 · atanh(EDGE_RADIUS_LIMIT)
// then NO node can ever reach the 0.995 clamp, whatever the tree looks like. Example: limit 0.994 -> BUDGET = 2·atanh(0.994) = 5.81.
// With the usual edge length 0.7 that holds up to depth 8 (8 × 0.7 = 5.6; depth 9 would be 6.3): such trees (the sample repo, WordNet) are laid out
// exactly as before. A deeper tree (the Disease Ontology: depth 12, 12 × 0.7 = 8.4) would overflow, so its deep levels get shorter edges:
//   edge into depth k:   L(k) = base                      for k <= K0   (the upper hierarchy keeps the full length)
//                        L(k) = base · ρ^(k − K0)         for k  > K0   (geometric shrink)
//   K0 = min( floor(M / 2), floor(BUDGET / base) − 1 )     M = depth of the deepest node
//   ρ  = the ratio (found by bisection, 60 steps, so it is deterministic) that makes the sum of all M edge lengths equal BUDGET.
// Example (base 0.7, M = 12): K0 = 6, ρ = 0.73, lengths 0.70 ×6, then 0.51, 0.37, 0.27, 0.20, 0.15, 0.11; sum = 5.81.
// Nothing here depends on which disease a node is: only on its depth and on M.
export const EDGE_RADIUS_LIMIT = 0.994;   // a hair under the 0.995 clamp, so rounding can never touch it

// Returns an array `lengths` where lengths[k] is the edge length from depth k-1 to depth k (lengths[0] is unused = base).
export function edgeLengthSchedule(maxDepth, base) {
  const lengths = new Array(maxDepth + 1).fill(base);
  const budget = 2 * Math.atanh(EDGE_RADIUS_LIMIT);
  if (base * maxDepth <= budget) return lengths;               // fits: every edge keeps the full length
  const k0 = Math.min(Math.floor(maxDepth / 2), Math.floor(budget / base) - 1);
  const sumFor = (rho) => { let t = k0 * base; for (let k = k0 + 1; k <= maxDepth; k++) t += base * Math.pow(rho, k - k0); return t; };
  let lo = 0, hi = 1;                                          // sumFor grows with rho: find the largest rho that still fits
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (sumFor(mid) <= budget) lo = mid; else hi = mid; }
  for (let k = k0 + 1; k <= maxDepth; k++) lengths[k] = base * Math.pow(lo, k - k0);
  return lengths;
}

// Depth of the deepest node below `root` (the root itself is depth 0).
export function treeDepth(root) {
  let max = 0;
  const stack = [root];
  while (stack.length) { const n = stack.pop(); max = Math.max(max, n.depth); for (const c of n.children) stack.push(c); }
  return max;
}

// A non-root folder spreads its children over a fan of this many radians,
// chosen between MIN_FAN and MAX_FAN. MAX_FAN < 2π leaves a gap that points
// back at the parent, so children never fall on top of their own parent.
export const MIN_FAN = 0.35 * Math.PI;
export const MAX_FAN = 1.8 * Math.PI;

// How much wider than its own slice a folder's fan is. A folder that got a
// slice of s radians at its parent lays out its children over s * FAN_SPREAD
// radians (then clamped to the range above).
export const FAN_SPREAD = 2.0;

// ---------------------------------------------------------------------------
// Turning the JSON into a tree of node objects
// ---------------------------------------------------------------------------

// Walk the raw JSON (from scan_folder.py) and create one node object per entry.
// Each node gets: id (index in `nodes`), parent, depth, and `weight` = number of
// nodes in its subtree including itself (a file has weight 1).
// We use node COUNT for weight, not bytes, because a few huge files would
// otherwise take all the angle and make most nodes vanishingly thin.
// Returns { root, nodes } where `nodes` lists every node (root first).
export function buildTree(json) {
  const nodes = [];

  function visit(raw, parent, depth) {
    const node = {
      id: nodes.length,
      name: raw.name,
      type: raw.type,
      size: raw.size,
      // scanner-v2 fields (all optional): extension, lines of code, symbols-file id, git info
      ext: raw.ext, loc: raw.loc, hasSymbols: !!raw.hasSymbols, fileId: raw.id,
      commits: raw.commits, modified: raw.modified,
      parent,
      children: [],
      depth,
      weight: 1,
      z: complex(0, 0), // filled in by computeLayout
    };
    nodes.push(node);
    for (const rawChild of raw.children || []) {
      const child = visit(rawChild, node, depth + 1);
      node.children.push(child);
      node.weight += child.weight;
    }
    return node;
  }

  const root = visit(json, null, 0);
  return { root, nodes };
}

// Path of a node as text, e.g. "sample-repo/src/utils". Built by walking up
// to the root and reversing.
export function nodePath(node) {
  const names = [];
  for (let n = node; n; n = n.parent) names.push(n.name);
  return names.reverse().join('/');
}

// ---------------------------------------------------------------------------
// The layout itself
// ---------------------------------------------------------------------------

// Fill in `node.z` (a point on the disk) for every node under `root`.
// `lengths` (optional, used by tests to compare layouts) overrides the per-depth schedule.
export function computeLayout(root, edgeLength = EDGE_LENGTH, lengths = edgeLengthSchedule(treeDepth(root), edgeLength)) {
  // Euclidean radius on the disk that corresponds to one edge length,
  // measured from the centre of a node's own frame: r = tanh(d / 2).
  // (Every edge has `edgeLength`, except in a tree too deep for the disk: then the deep levels are shorter, see edgeLengthSchedule.)

  root.z = complex(0, 0);
  // The root has no parent, so it may use the whole circle.
  placeChildren(root, 0, 2 * Math.PI, lengths);
}

// Place the children of `node`, then recurse into each child.
//   centerAngle - direction (radians) at the middle of the fan, measured in
//                 the node's own frame.
//   fanWidth    - total angle available for the children.
//
// A node's "own frame" is the disk after a Möbius move that brings the node to
// the centre. In that frame a child at angle θ is at local = r·(cos θ, sin θ),
// and we get its real position by moving back: child.z = node.z ⊕ local.
function placeChildren(node, centerAngle, fanWidth, lengths) {
  if (node.children.length === 0) return;

  const totalWeight = node.weight - 1; // everything below the node
  let cursor = centerAngle - fanWidth / 2; // left edge of the next slice

  for (const child of node.children) {
    // This child's slice is proportional to its subtree size.
    const slice = (fanWidth * child.weight) / totalWeight;
    const angle = cursor + slice / 2; // aim at the middle of the slice
    cursor += slice;

    child.edgeLength = lengths[child.depth];                 // hyperbolic length of the edge parent -> child
    const localRadius = distanceToRadius(child.edgeLength);
    const local = complex(localRadius * Math.cos(angle), localRadius * Math.sin(angle));
    child.z = mobiusAdd(node.z, local);

    // Which way is the parent, as seen from the child's own frame? Move the
    // child to the centre and see where the parent lands. The child's fan is
    // centred on the OPPOSITE direction (+π), so it points away from the parent.
    const parentSeenFromChild = mobiusAdd(cNeg(child.z), node.z);
    const awayAngle = Math.atan2(parentSeenFromChild.y, parentSeenFromChild.x) + Math.PI;

    const childFan = Math.min(MAX_FAN, Math.max(MIN_FAN, slice * FAN_SPREAD));
    placeChildren(child, awayAngle, childFan, lengths);
  }
}
