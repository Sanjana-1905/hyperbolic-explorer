// layout2d_proto.mjs - PROTOTYPES for the 2D layout correction (step 2.3a). Pure Node, no browser, NO production code is changed:
// it only imports helpers from src/ (buildTree, edgeLengthSchedule) and lays the tree out with its own copy of the maths.
//
//   node tools/proto/layout2d_proto.mjs [tree.json ...]        (default: the Disease Ontology, then the sample and WordNet)
//   node tools/proto/layout2d_proto.mjs --dump out.json        (positions of all variants, for tools/proto/render_svg.mjs)
//
// THE PROBLEM. All children of a node sit at ONE distance L, so n children share a circle of hyperbolic circumference 2π·sinh(L)
// (3.9 for L = 0.6). 486 children (under "syndrome") need >= 0.04 each = 19 units of circle, and the 2D layout gives a leaf
// next to a big sibling only a sliver of angle. Measured on the real tree: minimum sibling distance 0.0007.
//
// VARIANTS (all share the same machinery, only how the children's distances are chosen differs):
//   base  the PRODUCTION 2D layout (src/layout.js computeLayout, unchanged): slices proportional to subtree size, fan = 2x slice
//   W     control: equal/weight mixed shares + the exact WEDGE rule (no subtree overlap by construction), fixed edge length
//   A     W + ADAPTIVE LENGTH: a parent with many children gets the shortest longer edge length L (same for all its children) that
//         reaches the target sibling distance, within the radius budget
//   B     W + STAGGERED RINGS: the children keep the base length L0 plus a sawtooth offset (i mod R)*step, with the smallest number
//         of rings R that reaches the target; neighbours differ in radius, same-ring nodes are R slices apart
//
// SHARED RULES (W, A, B)
//  * share of child i = (1-mix)/n + mix*weight_i/total  (mix 0.5 like the 3D layout); slice_i = fan * share_i, centred at its angle.
//  * WEDGE RULE (the 2D twin of the 3D cone rule): the child's territory seen from its parent is theta = packing*slice/2 either side of
//    its direction; the child may fan out over half-angle beta = 2*atan(e^L * tan(theta/2)) (L = ITS edge length), so its whole subtree
//    stays inside that territory and sibling subtrees can never overlap. Fan = min(MAX_FAN, 2*beta). Not a compromise: it is exact.
//  * RADIUS BUDGET (rigorous, from the Phase 1 fix): a node's hyperbolic distance from the root is at most the sum of the edge lengths
//    on its path, and radius = tanh(D/2), so every path must sum to <= BUDGET = 2*atanh(0.994) = 5.81. The depth schedule
//    (edgeLengthSchedule) gives each depth its length; if a wide parent uses MORE than its scheduled length, the deeper levels below
//    it are scaled down by f = (BUDGET - P)/(BUDGET - S)  (P = path length used so far, S = what the schedule would have used),
//    which equals 1 when nothing was widened. A widened length is capped so that f stays >= 0.35 (deeper levels keep a third of
//    their schedule at least). If the cap binds, the target is NOT reached and that is reported, not hidden.
import fs from 'node:fs';
import { buildTree, computeLayout, edgeLengthSchedule, treeDepth, EDGE_LENGTH, EDGE_RADIUS_LIMIT } from '../../src/layout.js';

const BASE = EDGE_LENGTH;                       // 0.6, the 2D edge length
const BUDGET = 2 * Math.atanh(EDGE_RADIUS_LIMIT);
const MAX_FAN = 1.8 * Math.PI;                  // as in production
const TWO_PI = 2 * Math.PI;

// ---- tiny disk maths (no clamping: we WANT to see what the geometry does) -------------------------------------------------
const addC = (a, z) => {                        // Möbius addition a ⊕ z = (a + z) / (1 + conj(a) z)
  const nr = a.x + z.x, ni = a.y + z.y;
  const dr = 1 + a.x * z.x + a.y * z.y, di = a.x * z.y - a.y * z.x;
  const k = dr * dr + di * di;
  return { x: (nr * dr + ni * di) / k, y: (ni * dr - nr * di) / k };
};
const neg = (a) => ({ x: -a.x, y: -a.y });
const toR = (L) => Math.tanh(L / 2);            // hyperbolic distance from the centre -> Euclidean radius
const dist = (u, v) => {                        // hyperbolic distance in the disk
  const d2 = (u.x - v.x) ** 2 + (u.y - v.y) ** 2;
  return Math.acosh(1 + (2 * d2) / ((1 - u.x * u.x - u.y * u.y) * (1 - v.x * v.x - v.y * v.y)));
};
const coshD = (L1, L2, dTheta) => Math.cosh(L1) * Math.cosh(L2) - Math.sinh(L1) * Math.sinh(L2) * Math.cos(dTheta);
const wrap = (a) => { a = (a + Math.PI) % TWO_PI; if (a < 0) a += TWO_PI; return a - Math.PI; };   // -> (-π, π]

// Same rule as edgeLengthSchedule in src/layout.js but with a chosen budget (only used by the --sweep sensitivity run).
function scheduleFor(maxDepth, base, budget) {
  const lengths = new Array(maxDepth + 1).fill(base);
  if (base * maxDepth <= budget) return lengths;
  const k0 = Math.min(Math.floor(maxDepth / 2), Math.floor(budget / base) - 1);
  const sumFor = (rho) => { let t = k0 * base; for (let k = k0 + 1; k <= maxDepth; k++) t += base * Math.pow(rho, k - k0); return t; };
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (sumFor(mid) <= budget) lo = mid; else hi = mid; }
  for (let k = k0 + 1; k <= maxDepth; k++) lengths[k] = base * Math.pow(lo, k - k0);
  return lengths;
}

// ---- the prototype layout ------------------------------------------------------------------------------------------------
// Works on ANY tree of objects { children, depth, weight | w }. Options (all optional):
//   mix, packing, sMin, capF  as described above      M       depth to use for the radius schedule (default: the tree's own depth)
//   limit                     other radius limit (information only)
//   shareOf(kids)             custom angular shares (sum 1) instead of the equal/weight mix
//   refine(node, api)         called BEFORE a node's children are placed; may return a different children list (used by the
//                             hybrid to insert aggregated groups). api = { plan, spawn, P } lets it TRY a candidate list.
export function layoutProto(root, variant, o = {}) {
  const P = { mix: 0.5, packing: 0.9, sMin: 0.045, capF: 0.35, ...o };
  const wt = (c) => c.w ?? c.weight;
  const M = P.M ?? treeDepth(root);
  const BUDGET = 2 * Math.atanh(P.limit ?? EDGE_RADIUS_LIMIT);
  const sched = P.limit ? scheduleFor(M, BASE, BUDGET) : edgeLengthSchedule(M, BASE);
  root.depth = 0;
  root.z = { x: 0, y: 0 }; root.L = 0; root.P = 0; root.S = 0; root.f = 1; root.R = 1;
  place(root, 0, TWO_PI);
  return { M, BUDGET };

  // Decide, for a list of children, their angles, lengths and ring count (no side effects on the children).
  function plan(node, kids, centerAngle, fan) {
    const n = kids.length;
    const d = node.depth + 1;
    const total = kids.reduce((s, c) => s + wt(c), 0);
    const shares = P.shareOf ? P.shareOf(kids) : kids.map((c) => (1 - P.mix) / n + (P.mix * wt(c)) / total);
    const slice = shares.map((sh) => fan * sh);
    const ang = []; let cursor = centerAngle - fan / 2;
    for (let i = 0; i < n; i++) { ang.push(cursor + slice[i] / 2); cursor += slice[i]; }
    const L0 = node.f * sched[d];                                     // this level's length after any shrink from wider ancestors
    const sNext = node.S + sched[d];
    const Lmax = Math.max(L0, BUDGET - node.P - P.capF * (BUDGET - sNext));   // the cap that keeps deeper levels alive
    const cyclic = fan >= TWO_PI - 1e-9;
    const gapAfter = (i) => (i + 1 < n ? ang[i + 1] - ang[i] : (cyclic ? ang[0] + TWO_PI - ang[n - 1] : Infinity));
    let L = new Array(n).fill(L0), R = 1;

    if (variant === 'A' && n > 1) {
      const ok = (len) => { for (let i = 0; i < n; i++) { const g = gapAfter(i); if (g !== Infinity && Math.acosh(Math.max(1, coshD(len, len, g))) < P.sMin) return false; } return true; };
      if (!ok(L0)) {
        let lo = L0, hi = Lmax;
        if (!ok(hi)) lo = hi;                                         // cap binds: use the cap, the target is missed (reported)
        else for (let it = 0; it < 50; it++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
        L = new Array(n).fill(ok(lo) ? lo : hi);
      }
    } else if (variant === 'B' && n > 1) {
      const step = P.sMin;                                            // radial step between rings = the target distance
      const Rmax = Math.max(1, Math.floor((Lmax - L0) / step) + 1);
      const lens = (r) => kids.map((_, i) => L0 + (i % r) * step);
      const okR = (r) => {
        const Li = lens(r), w = Math.min(n - 1, 3 * r + 3);
        for (let i = 0; i < n; i++) for (let k = 1; k <= w; k++) {
          const j = i + k;
          let dTh;
          if (j < n) dTh = ang[j] - ang[i]; else if (cyclic) dTh = ang[j - n] + TWO_PI - ang[i]; else break;
          if (dTh > Math.PI) dTh = TWO_PI - dTh;
          if (Math.acosh(Math.max(1, coshD(Li[i], Li[j % n], dTh))) < P.sMin) return false;
        }
        return true;
      };
      R = Rmax;
      for (let r = 1; r <= Rmax; r++) if (okR(r)) { R = r; break; }
      L = lens(R);
    }
    return { kids, slice, ang, L, R, d };
  }

  // Put child i of `node` in place (sets z, lengths, budget state) and say where ITS children fan out.
  function spawn(node, pl, i) {
    const c = pl.kids[i], d = pl.d;
    c.depth = d;
    c.parent = node;
    c.L = pl.L[i];
    c.z = addC(node.z, { x: toR(c.L) * Math.cos(pl.ang[i]), y: toR(c.L) * Math.sin(pl.ang[i]) });
    c.P = node.P + c.L; c.S = node.S + sched[d];
    c.f = BUDGET - c.S > 1e-9 ? (BUDGET - c.P) / (BUDGET - c.S) : 1;
    const parentSeen = addC(neg(c.z), node.z);                        // where the parent is, seen from the child
    const away = Math.atan2(parentSeen.y, parentSeen.x) + Math.PI;
    const theta = (pl.slice[i] * P.packing) / 2;                      // territory half-angle seen from the parent
    const beta = 2 * Math.atan(Math.exp(c.L) * Math.tan(theta / 2));
    c.alpha = pl.ang[i]; c.theta = theta;
    return { away, fan: Math.min(MAX_FAN, 2 * beta) };
  }

  function place(node, centerAngle, fan) {
    if (P.refine && node.children.length) node.children = P.refine(node, { plan, spawn, P, centerAngle, fan });
    const kids = node.children;
    if (!kids.length) return;
    const pl = plan(node, kids, centerAngle, fan);
    node.R = pl.R;
    for (let i = 0; i < kids.length; i++) { const sp = spawn(node, pl, i); place(kids[i], sp.away, sp.fan); }
  }
}

// ---- metrics -------------------------------------------------------------------------------------------------------------
export function measure(root, nodes, name) {
  const out = { name, nodes: nodes.length, maxDepth: Math.max(...nodes.map((n) => n.depth)) };
  let maxR = 0, over994 = 0, over995 = 0, badLen = 0;
  for (const n of nodes) {
    const r = Math.hypot(n.z.x, n.z.y);
    maxR = Math.max(maxR, r); if (r > 0.994) over994++; if (r >= 0.995 - 1e-12) over995++;
    const intended = n.L ?? n.edgeLength;
    if (n.parent && Math.abs(dist(n.parent.z, n.z) - intended) > 1e-6) badLen++;
  }
  out.maxRadius = maxR; out.over994 = over994; out.clampedEdges = badLen;
  // sibling distances
  let minSib = Infinity, minSibParent = '', below04 = 0, below02 = 0, parents = 0;
  const bands = { '<=3': Infinity, '4-6': Infinity, '7-9': Infinity, '10-12': Infinity };
  const worst = [];
  for (const p of nodes) {
    const k = p.children;
    if (k.length < 2) continue;
    parents++;
    let m = Infinity;
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) m = Math.min(m, dist(k[i].z, k[j].z));
    if (m < minSib) { minSib = m; minSibParent = `${p.name} (${k.length} children)`; }
    if (m < 0.04) below04++; if (m < 0.02) below02++;
    const dd = k[0].depth, b = dd <= 3 ? '<=3' : dd <= 6 ? '4-6' : dd <= 9 ? '7-9' : '10-12';
    bands[b] = Math.min(bands[b], m);
    worst.push([m, p.name, k.length, p.depth]);
  }
  worst.sort((a, b) => a[0] - b[0]);
  Object.assign(out, { minSibling: minSib, minSiblingParent: minSibParent, parentsBelow04: below04, parentsBelow02: below02, parents, bands, worst: worst.slice(0, 5) });
  // closest pair of ANY two nodes (compare 2*d2/((1-|u|^2)(1-|v|^2)), monotone in the distance)
  const N = nodes.length, X = new Float64Array(N), Y = new Float64Array(N), W = new Float64Array(N);
  nodes.forEach((n, i) => { X[i] = n.z.x; Y[i] = n.z.y; W[i] = 1 - n.z.x * n.z.x - n.z.y * n.z.y; });
  let best = Infinity;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const q = ((X[i] - X[j]) ** 2 + (Y[i] - Y[j]) ** 2) / (W[i] * W[j]);
    if (q < best) best = q;
  }
  out.closestPair = Math.acosh(1 + 2 * best);
  // SUBTREE OVERLAP: seen from a parent, the angular extent of each child's whole subtree; two siblings overlap if the extents intersect
  let overlapPairs = 0, overlapParents = 0;
  for (const p of nodes) {
    const k = p.children;
    if (k.length < 2) continue;
    const iv = k.map((c) => {
      const a0 = Math.atan2(addC(neg(p.z), c.z).y, addC(neg(p.z), c.z).x);
      let lo = 0, hi = 0;
      for (let id = c.id; id < c.id + (c.span ?? c.weight); id++) {
        const w = addC(neg(p.z), nodes[id].z);
        const dlt = wrap(Math.atan2(w.y, w.x) - a0);
        if (dlt < lo) lo = dlt; if (dlt > hi) hi = dlt;
      }
      return { start: a0 + lo, len: hi - lo };
    });
    let bad = 0;
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
      const dj = ((iv[j].start - iv[i].start) % TWO_PI + TWO_PI) % TWO_PI;
      if (dj < iv[i].len - 1e-9 || TWO_PI - dj < iv[j].len - 1e-9) bad++;
    }
    if (bad) { overlapPairs += bad; overlapParents++; }
  }
  out.overlapPairs = overlapPairs; out.overlapParents = overlapParents;
  // widened parents / extra length / path budget
  let widened = 0, maxEdge = 0, maxPath = 0, ringParents = 0, maxRings = 1;
  for (const n of nodes) {
    maxPath = Math.max(maxPath, n.P ?? 0);
    if (n.R > 1) { ringParents++; maxRings = Math.max(maxRings, n.R); }
    if (n.L) maxEdge = Math.max(maxEdge, n.L);
  }
  out.maxEdge = maxEdge; out.ringParents = ringParents; out.maxRings = maxRings; out.maxPath = maxPath;
  return out;
}

// the 486-child parent (or the widest parent of any tree) examined explicitly
export function widestParent(nodes, name) {
  const p = name ? nodes.find((x) => x.name === name) : nodes.reduce((a, b) => (b.children.length > a.children.length ? b : a));
  const k = p.children, n = k.length;
  const nn = k.map((c, i) => { let m = Infinity; for (let j = 0; j < n; j++) if (j !== i) m = Math.min(m, dist(c.z, k[j].z)); return m; });
  const s = [...nn].sort((a, b) => a - b), q = (f) => s[Math.min(n - 1, Math.floor(f * n))];
  const dists = k.map((c) => dist(p.z, c.z));
  const radii = k.map((c) => Math.hypot(c.z.x, c.z.y));
  const angs = k.map((c) => Math.atan2(addC(neg(p.z), c.z).y, addC(neg(p.z), c.z).x));
  const span = Math.max(...angs.map((a) => wrap(a - angs[0]))) - Math.min(...angs.map((a) => wrap(a - angs[0])));
  return { name: p.name, children: n, minNN: s[0], p5NN: q(0.05), medNN: q(0.5), p95NN: q(0.95), minEdge: Math.min(...dists), maxEdge: Math.max(...dists), maxChildRadius: Math.max(...radii), angularSpan: span, rings: p.R ?? 1 };
}

// ---- driver --------------------------------------------------------------------------------------------------------------
export function build(json, variant, o) {
  const { root, nodes } = buildTree(json);
  if (variant === 'base') computeLayout(root, BASE);              // the production 2D layout, unchanged
  else layoutProto(root, variant, o);
  return { root, nodes };
}
const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : String(x));

import { pathToFileURL } from 'node:url';
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
function main() {
const args = process.argv.slice(2);
if (args[0] === '--sweep') { sweep(); return; }
const dumpAt = args.indexOf('--dump');
const dumpFile = dumpAt >= 0 ? args.splice(dumpAt, 2)[1] : null;
const files = args.length ? args : ['public/data/disease_tree.json', 'public/data/sample_tree.json', 'public/data/wordnet_tree.json'];
const configs = [
  ['base (production)', 'base', {}],
  ['W   wedge control', 'W', {}],
  ['A   adaptive length', 'A', {}],
  ['B   staggered rings', 'B', {}],
  ['A   mix 0.25', 'A', { mix: 0.25 }],
  ['B   mix 0.25', 'B', { mix: 0.25 }],
];
const dump = {};
for (const file of files) {
  const json = JSON.parse(fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
  console.log(`\n===== ${file}  (budget ${BUDGET.toFixed(3)}, target sibling distance 0.045, minimum required 0.04) =====`);
  console.log('variant              maxR    r>0.994  clamped  minSib   <0.04  <0.02  closest  overlap(pairs/parents)  maxEdge  maxPath  rings(parents/max)');
  for (const [label, variant, o] of configs) {
    const { root, nodes } = build(json, variant, o);
    const m = measure(root, nodes, label);
    console.log(`${label.padEnd(20)} ${f4(m.maxRadius)}  ${String(m.over994).padStart(6)}  ${String(m.clampedEdges).padStart(7)}  ${f4(m.minSibling)} ${String(m.parentsBelow04).padStart(6)} ${String(m.parentsBelow02).padStart(5)}  ${f4(m.closestPair)}  ${String(m.overlapPairs).padStart(10)}/${String(m.overlapParents).padEnd(10)}  ${f4(m.maxEdge)}  ${f4(m.maxPath)}  ${m.ringParents}/${m.maxRings}`);
    if (file.includes('disease') && !o.mix) {
      console.log(`      min sibling by depth band ${Object.entries(m.bands).map(([k, v]) => `${k}: ${f4(v)}`).join('  ')} | worst parents: ${m.worst.slice(0, 3).map((w) => `${w[1]} (${w[2]} kids) ${f4(w[0])}`).join('; ')}`);
      for (const nm of ['syndrome', null]) {                              // the 486-child parent, then the widest parent (1,048 children)
        const w = widestParent(nodes, nm);
        console.log(`      ${nm ? '486-child' : 'widest'} parent "${w.name}" (${w.children} children): min nearest-sibling ${f4(w.minNN)}, 5th pct ${f4(w.p5NN)}, median ${f4(w.medNN)}, 95th ${f4(w.p95NN)}; edge ${f4(w.minEdge)}..${f4(w.maxEdge)}; farthest child radius ${f4(w.maxChildRadius)}; angular span ${f4(w.angularSpan)} rad; rings ${w.rings}`);
      }
    }
    if (dumpFile && file.includes('disease') && !o.mix) dump[variant] = nodes.map((n) => [n.z.x, n.z.y, n.parent ? n.parent.id : -1, n.depth, n.name]);
  }
}
if (dumpFile) { fs.writeFileSync(dumpFile, JSON.stringify(dump)); console.log(`\npositions written to ${dumpFile}`); }
}

// Sensitivity of strategy B to the two free parameters (capF = how much of its schedule the deeper levels must keep, mix = equal vs weight share).
function sweep() {
  const json = JSON.parse(fs.readFileSync(new URL('../../public/data/disease_tree.json', import.meta.url), 'utf8'));
  console.log('Strategy B on the Disease Ontology: parameter sweep (target sibling distance 0.045)');
  console.log('capF  mix   minSib   parents<0.04  <0.02  closest  overlap  maxR    maxEdge  minDeepShrink(f)');
  for (const capF of [0.35, 0.2, 0.1, 0.05]) for (const mix of [0.3, 0.5, 0.7]) {
    const { root, nodes } = build(json, 'B', { capF, mix });
    const m = measure(root, nodes, 'B');
    const minF = Math.min(...nodes.map((n) => n.f ?? 1));
    console.log(`${String(capF).padEnd(5)} ${String(mix).padEnd(4)}  ${f4(m.minSibling)}  ${String(m.parentsBelow04).padStart(10)} ${String(m.parentsBelow02).padStart(6)}  ${f4(m.closestPair)}  ${String(m.overlapPairs).padStart(6)}  ${f4(m.maxRadius)}  ${f4(m.maxEdge)}  ${f4(minF)}`);
  }
  console.log('\nINFORMATION ONLY (the 0.995 clamp rule would have to change): strategy B, default parameters, other radius limits');
  console.log('limit   budget   minSib   parents<0.04  <0.02  closest  overlap  maxR');
  for (const limit of [0.994, 0.996, 0.998, 0.999]) {
    const { root, nodes } = build(json, 'B', { limit });
    const m = measure(root, nodes, 'B');
    console.log(`${String(limit).padEnd(7)} ${(2 * Math.atanh(limit)).toFixed(2).padStart(6)}   ${f4(m.minSibling)}  ${String(m.parentsBelow04).padStart(10)} ${String(m.parentsBelow02).padStart(6)}  ${f4(m.closestPair)}  ${String(m.overlapPairs).padStart(6)}  ${f4(m.maxRadius)}`);
  }
}
