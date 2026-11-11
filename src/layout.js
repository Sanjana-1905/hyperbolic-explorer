// layout.js - place every tree node on the Poincaré disk ("S5": wedge territories + staggered rings + radius budget).
//
// THE IDEA
// - The root sits at the centre of the disk.
// - A parent hands out its available angle ("fan") to its children in slices: part equal, part proportional to subtree size (S5.MIX).
// - Each child sits at its own hyperbolic distance from the parent: normally the length scheduled for its depth (EDGE_LENGTH, shrinking
//   at great depth, see edgeLengthSchedule), but a parent with MANY children staggers them on RINGS (a sawtooth of longer lengths), because
//   one circle is too small: its circumference is only 2π·sinh(L). The exact rule is in CLAUDE.md ("Fixed edge length is relaxed...").
// - The WEDGE RULE keeps every subtree inside the angular territory of its own slice, so sibling subtrees never overlap.
// - The RADIUS BUDGET keeps every root-to-node path at most 2·atanh(0.994), so nothing can reach the 0.995 clamp.
// - A node's position depends only on its ancestors and siblings (and the tree's global depth M), never on what is shown or hidden.
//
// This file has no drawing code, so it can be tested from the command line. displaytree.js uses its `refine` hook to insert the
// alphabetical navigation groups.

import { complex, mobiusAddFree, cNeg, distanceToRadius, coshDistancePolar, wedgeAngleForTerritory } from './mobius.js';

// Normal hyperbolic length of a parent->child edge (before rings and the depth taper). Smaller values keep deep
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

// A non-root node spreads its children over a fan of at most this many radians. MAX_FAN < 2π leaves a gap that points back at the
// parent, so children never fall on top of their own parent.
export const MAX_FAN = 1.8 * Math.PI;

// The S5 parameters (decided by the user after prototyping, see PROGRESS.md "Step 2.3a").
export const S5 = {
  MIX: 0.7,        // share of a child's angle that follows its subtree size (the rest is equal): s_i = (1-MIX)/n + MIX*w_i/sum(w)
  CAP_F: 0.2,      // a wide parent may spend radius budget on rings, but the levels below keep at least this fraction of their schedule
  PACKING: 0.9,    // a child's territory is 90 % of its slice, leaving a gap to the neighbours
  TARGET: 0.045,   // spacing the rings aim for (also the radial step between rings)
  ACCEPT: 0.04,    // a level counts as well spaced if its siblings are at least this far apart
};

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
      doid: raw.doid,                 // Disease Ontology id (disease_tree.json), undefined for other datasets
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
// Navigation groups (displaytree.js) are skipped: a path is made of real names only.
export function nodePath(node) {
  const names = [];
  for (let n = node; n; n = n.parent) if (!n.isGroup) names.push(n.name);
  return names.reverse().join('/');
}

// ---------------------------------------------------------------------------
// The layout itself
// ---------------------------------------------------------------------------

// A node's weight for sharing out angle: the number of REAL diseases below it (`w`), which a navigation group sets to the sum of its
// members', or else the subtree size.
const weightOf = (c) => c.w ?? c.weight;

const TWO_PI = 2 * Math.PI;
const EDGE_BUDGET = 2 * Math.atanh(EDGE_RADIUS_LIMIT);   // every path from the root sums to at most this: 5.81

// Fill in `node.z` (a point on the disk) and `node.edgeLength` (the hyperbolic length of the edge from its parent) for every node under
// `root`. Options (all optional): edgeLength (base length), mix, packing, target, capF (see S5), M (the depth that fixes the schedule; default
// = the tree's own depth, tests pass the full depth when laying out a pruned copy), refine(node, api) (called before a node's children are
// placed; may return another children list: displaytree.js inserts navigation groups there; api = { plan, spawn, ... } lets it TRY a list).
// Returns { M }.
export function computeLayout(root, edgeLength = EDGE_LENGTH, opts = {}) {
  const P = { mix: S5.MIX, packing: S5.PACKING, target: S5.TARGET, capF: S5.CAP_F, ...opts };
  const M = P.M ?? treeDepth(root);
  const sched = edgeLengthSchedule(M, edgeLength);      // sched[d] = length scheduled for an edge into depth d

  // Per-node state: pathLen = length of the path from the root so far, schedLen = what the schedule alone would have used,
  // shrink = (BUDGET − pathLen) / (BUDGET − schedLen): 1 while nothing was widened, smaller when rings used extra budget.
  root.depth = 0;
  root.z = complex(0, 0); root.edgeLength = 0; root.pathLen = 0; root.schedLen = 0; root.shrink = 1; root.rings = 1;
  place(root, 0, TWO_PI);
  return { M };

  // Decide, for a list of children, their angles, lengths and ring count (no side effects on the children).
  function plan(node, kids, centerAngle, fan) {
    const n = kids.length;
    const d = node.depth + 1;
    const total = kids.reduce((sum, c) => sum + weightOf(c), 0);
    // Share of the fan for child i:  (1 − mix)/n + mix · w_i / total.  Example: mix 0.7, 4 children with w = 1, 1, 1, 7:
    // the big one gets 0.075 + 0.7·0.7 = 0.565 of the fan, each small one 0.075 + 0.07 = 0.145.
    const slice = kids.map((c) => fan * ((1 - P.mix) / n + (P.mix * weightOf(c)) / total));
    const ang = [];
    let cursor = centerAngle - fan / 2;
    for (let i = 0; i < n; i++) { ang.push(cursor + slice[i] / 2); cursor += slice[i]; }

    // Base length of this level, and the longest length the radius budget lets us use here (the levels below keep capF of their schedule).
    const L0 = node.shrink * sched[d];
    const Lmax = Math.max(L0, EDGE_BUDGET - node.pathLen - P.capF * (EDGE_BUDGET - (node.schedLen + sched[d])));
    let L = new Array(n).fill(L0), rings = 1;
    if (n > 1) {
      // Staggered rings: child i sits at L0 + (i mod R) · step. Find the smallest R at which every pair of nearby siblings is >= target apart.
      const step = P.target;
      const Rmax = Math.max(1, Math.floor((Lmax - L0) / step) + 1);
      const cyclic = fan >= TWO_PI - 1e-9;              // the root's children go all the way round
      const lens = (r) => kids.map((_, i) => L0 + (i % r) * step);
      const wellSpaced = (r) => {
        const Li = lens(r), reach = Math.min(n - 1, 3 * r + 3);   // same-ring neighbours are r apart, so 3r+3 neighbours is plenty
        for (let i = 0; i < n; i++) {
          for (let k = 1; k <= reach; k++) {
            const j = i + k;
            let dTheta;
            if (j < n) dTheta = ang[j] - ang[i];
            else if (cyclic) dTheta = ang[j - n] + TWO_PI - ang[i];
            else break;
            if (dTheta > Math.PI) dTheta = TWO_PI - dTheta;
            if (Math.acosh(Math.max(1, coshDistancePolar(Li[i], Li[j % n], dTheta))) < P.target) return false;
          }
        }
        return true;
      };
      rings = Rmax;                                      // if nothing reaches the target, use the most rings the budget allows
      for (let r = 1; r <= Rmax; r++) if (wellSpaced(r)) { rings = r; break; }
      L = lens(rings);
    }
    return { kids, slice, ang, L, rings, d };
  }

  // Put child i of `node` in place and say where ITS children fan out (centre direction and width).
  function spawn(node, pl, i) {
    const c = pl.kids[i], d = pl.d;
    c.depth = d;
    c.parent = node;
    c.edgeLength = pl.L[i];
    // Position: from the parent walk edgeLength along angle ang[i], i.e. parent ⊕ (tanh(L/2) · direction).
    const r = distanceToRadius(c.edgeLength);
    c.z = mobiusAddFree(node.z, { x: r * Math.cos(pl.ang[i]), y: r * Math.sin(pl.ang[i]) });
    c.pathLen = node.pathLen + c.edgeLength;
    c.schedLen = node.schedLen + sched[d];
    c.shrink = EDGE_BUDGET - c.schedLen > 1e-9 ? (EDGE_BUDGET - c.pathLen) / (EDGE_BUDGET - c.schedLen) : 1;
    // Which way is the parent, seen from the child? Its fan points the opposite way (away from the parent).
    const parentSeen = mobiusAddFree(cNeg(c.z), node.z);
    const away = Math.atan2(parentSeen.y, parentSeen.x) + Math.PI;
    // Territory seen from the parent: half-angle 0.9 · slice / 2; the child may fan out over twice its wedge half-angle.
    const theta = (pl.slice[i] * P.packing) / 2;
    c.slice = pl.slice[i]; c.territory = theta;
    const beta = wedgeAngleForTerritory(theta, c.edgeLength);
    return { away, fan: Math.min(MAX_FAN, 2 * beta) };
  }

  function place(node, centerAngle, fan) {
    if (P.refine && node.children.length) node.children = P.refine(node, { plan, spawn, centerAngle, fan });
    const kids = node.children;
    if (!kids.length) return;
    const pl = plan(node, kids, centerAngle, fan);
    node.rings = pl.rings;
    for (let i = 0; i < kids.length; i++) { const sp = spawn(node, pl, i); place(kids[i], sp.away, sp.fan); }
  }
}
