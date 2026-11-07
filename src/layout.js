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
export function computeLayout(root, edgeLength = EDGE_LENGTH) {
  // Euclidean radius on the disk that corresponds to one edge length,
  // measured from the centre of a node's own frame: r = tanh(d / 2).
  const localRadius = distanceToRadius(edgeLength);

  root.z = complex(0, 0);
  // The root has no parent, so it may use the whole circle.
  placeChildren(root, 0, 2 * Math.PI, localRadius);
}

// Place the children of `node`, then recurse into each child.
//   centerAngle - direction (radians) at the middle of the fan, measured in
//                 the node's own frame.
//   fanWidth    - total angle available for the children.
//
// A node's "own frame" is the disk after a Möbius move that brings the node to
// the centre. In that frame a child at angle θ is at local = r·(cos θ, sin θ),
// and we get its real position by moving back: child.z = node.z ⊕ local.
function placeChildren(node, centerAngle, fanWidth, localRadius) {
  if (node.children.length === 0) return;

  const totalWeight = node.weight - 1; // everything below the node
  let cursor = centerAngle - fanWidth / 2; // left edge of the next slice

  for (const child of node.children) {
    // This child's slice is proportional to its subtree size.
    const slice = (fanWidth * child.weight) / totalWeight;
    const angle = cursor + slice / 2; // aim at the middle of the slice
    cursor += slice;

    const local = complex(localRadius * Math.cos(angle), localRadius * Math.sin(angle));
    child.z = mobiusAdd(node.z, local);

    // Which way is the parent, as seen from the child's own frame? Move the
    // child to the centre and see where the parent lands. The child's fan is
    // centred on the OPPOSITE direction (+π), so it points away from the parent.
    const parentSeenFromChild = mobiusAdd(cNeg(child.z), node.z);
    const awayAngle = Math.atan2(parentSeenFromChild.y, parentSeenFromChild.x) + Math.PI;

    const childFan = Math.min(MAX_FAN, Math.max(MIN_FAN, slice * FAN_SPREAD));
    placeChildren(child, awayAngle, childFan, localRadius);
  }
}
