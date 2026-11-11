// hybrid.mjs - PROTOTYPE (step 2.3a, round 2): B's wedge territories + progressive disclosure. Pure Node, NO production code is changed.
//   node tools/proto/hybrid.mjs [--export out.json]
//
// QUESTION: is the 2D layout problem partly caused by showing too many children at once?
// IDEA: for a wide parent, insert AGGREGATED GROUPS between the parent and its children. A group is a display-only node that stands for a
// real, named set of the parent's children (the ontology is never touched: the real tree, `disease_edges.json` and all 12,419 terms stay as
// they are; a group is just a navigable bucket with a member list). The layout is still B (wedge territories + budget-aware lengths):
//   parent -> groups (a short list) -> members (a short list each), so no node ever has to place hundreds of siblings on one circle,
//   and the extra level also spends a little of the radius budget (reported).
// HOW GROUPS ARE MADE (deterministic, from real properties only):
//   children WITH their own subtypes ("subcategories") are kept individually if there are <= G of them, else cut into runs of <= G in
//   alphabetical order; childless children ("diseases") are cut into alphabetical runs of <= G; a list longer than G is cut again (groups of
//   groups). Labels are the first and last name of the run ("diseases: ab.. - ch.. (26)"), so a group is an index into real names.
// STRATEGIES
//   S1  B, all children visible                      (the previous prototype)
//   S2  B + static groups: every parent with more than K children is grouped (K = 24, 36)
//   S3  B + progressive expansion = S2's geometry measured under disclosure states (groups closed until opened). Positions do not depend on
//       what is open, so expanding never moves anything (checked in the stability test)
//   S4  hybrid adaptive: while laying out, a parent tries "no groups" first and groups only as much as needed (largest G that reaches the
//       target spacing at every level it creates). S4b also lets the angular shares follow the room a subtree NEEDS (its widest level)
//       as well as its size.
import fs from 'node:fs';
import { buildTree, treeDepth } from '../../src/layout.js';
import { layoutProto, measure } from './layout2d_proto.mjs';

// ---------- small maths ------------------------------------------------------------------------------------------------------
const addC = (a, z) => { const nr = a.x + z.x, ni = a.y + z.y, dr = 1 + a.x * z.x + a.y * z.y, di = a.x * z.y - a.y * z.x, k = dr * dr + di * di; return { x: (nr * dr + ni * di) / k, y: (ni * dr - nr * di) / k }; };
const neg = (a) => ({ x: -a.x, y: -a.y });
const hdist = (u, v) => { const d2 = (u.x - v.x) ** 2 + (u.y - v.y) ** 2; return Math.acosh(1 + (2 * d2) / ((1 - u.x * u.x - u.y * u.y) * (1 - v.x * v.x - v.y * v.y))); };
const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : String(x));
const pairMin = (nodes) => { let m = Infinity; for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) m = Math.min(m, hdist(nodes[i].z, nodes[j].z)); return m; };

// ---------- the display tree and its groups -----------------------------------------------------------------------------------
// One display node per real disease (w = number of real diseases in its primary subtree, dem = size of its widest level = the room it needs).
function levelCounts(r) {
  const own = [1];
  for (const c of r.children) { const lc = levelCounts(c); for (let k = 0; k < lc.length; k++) own[k + 1] = (own[k + 1] || 0) + lc[k]; }
  r.levels = own;
  return own;
}
function mirror(realRoot) {
  levelCounts(realRoot);
  const mk = (r, parent, depth) => {
    const d = { name: r.name, real: r, w: r.weight, dem: Math.max(...r.levels), parent, children: [], isGroup: false, depth };
    d.children = r.children.map((c) => mk(c, d, depth + 1));
    return d;
  };
  return mk(realRoot, null, 0);
}
const nameOf = (e) => (e.isGroup ? e.firstName : e.name);
const lastOf = (e) => (e.isGroup ? e.lastName : e.name);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.real?.id ?? 0) - (b.real?.id ?? 0));
function makeGroup(members, kind) {
  const firstName = nameOf(members[0]), lastName = lastOf(members[members.length - 1]);
  const total = members.reduce((s, m) => s + m.w, 0);
  return { isGroup: true, kind, name: `${kind}: ${firstName.slice(0, 14)}.. - ${lastName.slice(0, 14)}.. (${members.length})`, firstName, lastName,
    w: total, dem: members.reduce((s, m) => s + m.dem, 0), members: members.length, children: members, parent: null, real: null, depth: 0 };
}
function chunk(list, G, kind) {                       // balanced consecutive runs of at most G
  const c = Math.ceil(list.length / G), out = [];
  let at = 0;
  for (let i = 0; i < c; i++) { const size = Math.floor(list.length / c) + (i < list.length % c ? 1 : 0); out.push(makeGroup(list.slice(at, at + size), kind)); at += size; }
  return out;
}
function itemsFor(kids, G) {
  const internal = kids.filter((k) => k.children.length > 0).sort(byName);
  const leaves = kids.filter((k) => k.children.length === 0).sort(byName);
  let list = [...(internal.length <= G ? internal : chunk(internal, G, 'subcategories')), ...(leaves.length <= 3 ? leaves : chunk(leaves, G, 'diseases'))];
  while (list.length > G) list = chunk(list, G, 'groups');
  return list;
}
function assignDepth(root) { (function walk(n, d) { n.depth = d; n.children.forEach((c) => { c.parent = n; walk(c, d + 1); }); })(root, 0); }
function finalize(root) {
  const nodes = [];
  (function walk(n) { n.id = nodes.length; nodes.push(n); n.span = 1; for (const c of n.children) { walk(c); n.span += c.span; } })(root);
  return nodes;
}
function staticGroups(root, K) {                      // S2: group every parent with more than K children
  (function walk(n) { if (n.children.length > K) n.children = itemsFor(n.children, K); n.children.forEach(walk); })(root);
  assignDepth(root);
}

// ---------- layouts ----------------------------------------------------------------------------------------------------------
const ACCEPT = 0.04;                                    // a level is "good" if its siblings are >= this far apart
const TARGET = 0.045;
const shareDemand = (kids) => {                         // S4b: equal share + size share + room-needed share
  const n = kids.length, W = kids.reduce((s, c) => s + c.w, 0), D = kids.reduce((s, c) => s + c.dem, 0);
  return kids.map((c) => 0.5 / n + 0.25 * (c.w / W) + 0.25 * (c.dem / D));
};
// S4: the least grouping that reaches the target spacing at every level it creates.
// S5 (cap): the same, but no parent may show more than `cap` siblings at once, however well they are spaced (screen-space limit).
const makeAdaptive = (cap) => (node, api) => adaptiveRefine(node, api, cap);
function adaptiveRefine(node, api, cap = Infinity) {
  const kids = node.children, n = kids.length;
  if (n < 6 && n <= cap) return kids;
  const tried = [];
  const cands = [Infinity, 60, 40, 36, 30, 24, 18, 12, 8].filter((G) => (G === Infinity ? n <= cap : G < n && G <= cap));
  for (const G of cands) {
    const top = G === Infinity ? kids : itemsFor(kids, G);
    const sep = trialSep(node, top, api, api.centerAngle, api.fan);
    tried.push({ G, top, sep });
    if (sep >= ACCEPT) return top;
  }
  tried.sort((a, b) => b.sep - a.sep);                  // none reaches it: take the best we can do and flag it
  node.unresolved = true; node.unresolvedSep = tried[0].sep;
  return tried[0].top;
}
function trialSep(node, list, api, center, fan) {       // smallest sibling distance over the level(s) a candidate list creates
  const pl = api.plan(node, list, center, fan);
  let m = Infinity;
  const sps = list.map((_, i) => api.spawn(node, pl, i));
  m = pairMin(list);
  list.forEach((c, i) => { if (c.isGroup) m = Math.min(m, trialSep(c, c.children, api, sps[i].away, sps[i].fan)); });
  return m;
}

function runLayout(json, strategy) {
  const real = buildTree(json).root;
  const base = { mix: 0.5, packing: 0.9, sMin: TARGET, capF: 0.35, ...(strategy.opts || {}) };
  let M = treeDepth(real), result;
  for (let attempt = 0; attempt < 6; attempt++) {
    const root = mirror(buildTree(json).root);
    const o = { ...base, M };
    if (strategy.K) staticGroups(root, strategy.K);
    if (strategy.adaptive) o.refine = makeAdaptive(strategy.cap ?? Infinity);
    if (strategy.demand) o.shareOf = shareDemand;
    if (!strategy.adaptive) o.M = treeDepth(root);
    layoutProto(root, 'B', o);
    const used = treeDepth(root);
    if (!strategy.adaptive || used <= M) { result = { root, opts: o, M: o.M }; break; }
    M = used;                                           // groups made the tree deeper than assumed: lay out again with the right depth
  }
  result.nodes = finalize(result.root);
  return result;
}

// ---------- disclosure states and screen-space metrics -----------------------------------------------------------------------
const find = (nodes, name) => nodes.find((n) => n.name === name && !n.isGroup);
const pathTo = (n) => { const p = []; for (let a = n; a; a = a.parent) p.unshift(a); return p; };
function visibleFrom(root, expanded) {
  const vis = [root], expandedParents = [];
  const walk = (n) => { if (!expanded.has(n) || !n.children.length) return; expandedParents.push(n); for (const c of n.children) { vis.push(c); walk(c); } };
  walk(root);
  return { vis, expandedParents };
}
function overviewSet(root) { const e = new Set([root, ...root.children]); return e; }
function stateFocus(root, node, mode) {                 // mode: 'children' | 'oneGroup' | 'allGroups'
  const e = overviewSet(root);
  pathTo(node).forEach((a) => e.add(a));
  e.add(node);
  const groups = node.children.filter((c) => c.isGroup);
  if (mode === 'oneGroup' && groups.length) { const g = groups.reduce((a, b) => (b.members > a.members ? b : a)); e.add(g); }
  if (mode === 'allGroups') (function open(n) { for (const c of n.children) if (c.isGroup) { e.add(c); open(c); } })(node);
  return e;
}
function nnPx(points) {                                 // nearest-neighbour distance (pixels) of each point
  const out = new Array(points.length).fill(Infinity);
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
    if (d < out[i]) out[i] = d; if (d < out[j]) out[j] = d;
  }
  return out;
}
function stateMetrics(root, expanded, focus, label) {
  const { vis, expandedParents } = visibleFrom(root, expanded);
  let sib = Infinity;
  for (const p of expandedParents) sib = Math.min(sib, pairMin(p.children));
  let closest = Infinity;
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) closest = Math.min(closest, hdist(vis[i].z, vis[j].z));
  const mf = neg(focus.z);
  const U = vis.map((n) => addC(mf, n.z));
  const screen = {};
  for (const [name, R, Z] of [['desktop z1', 500, 1], ['desktop z2', 500, 2], ['phone z1', 190, 1], ['phone z2', 190, 2]]) {
    const pts = U.filter((u) => Math.hypot(u.x, u.y) * Z <= 1).map((u) => [u.x * R * Z, u.y * R * Z]);
    const nn = nnPx(pts).sort((a, b) => a - b);
    screen[name] = { inView: pts.length, minPx: nn[0] ?? Infinity, sharpOK: nn.filter((d) => d >= 6).length / Math.max(1, nn.length) };
  }
  // The FOCUSED REGION: visible descendants of the focus (what the user is looking at and acting on). The context (other families, deep
  // nodes near the rim) is compressed by the hyperbolic metric by nature, so it is reported separately above.
  const isBelow = (n) => { for (let a = n.parent; a; a = a.parent) if (a === focus) return true; return false; };
  const region = {};
  for (const [name, R, Z] of [['desktop z1', 500, 1], ['desktop z2', 500, 2], ['phone z1', 190, 1], ['phone z2', 190, 2]]) {
    const pts = vis.filter(isBelow).map((n) => addC(mf, n.z)).filter((u) => Math.hypot(u.x, u.y) * Z <= 1).map((u) => [u.x * R * Z, u.y * R * Z]);
    const nn = nnPx(pts).sort((a, b) => a - b);
    region[name] = { inView: pts.length, minPx: nn[0] ?? Infinity, sharpOK: nn.length ? nn.filter((d) => d >= 6).length / nn.length : 1 };
  }
  return { label, visible: vis.length, groups: vis.filter((n) => n.isGroup).length, siblingMin: sib, closest, screen, region };
}

// ---------- stability: expand / collapse must not move anything ----------------------------------------------------------------
function pruned(root, vis) {                            // a copy holding only the visible nodes, keeping every node's real weight
  const keep = new Set(vis);
  const mk = (n, parent) => { const c = { name: n.name, w: n.w, dem: n.dem, isGroup: n.isGroup, children: [], parent, orig: n }; c.children = n.children.filter((k) => keep.has(k)).map((k) => mk(k, c)); return c; };
  return mk(root, null);
}
function stability(res, rng) {
  let worstFixedM = 0, worstFreeM = 0, medianFree = [];
  for (let t = 0; t < 6; t++) {
    const exp = new Set([res.root]);
    const open = res.nodes.filter((n) => n.children.length);
    for (let k = 0; k < 30 + 40 * t; k++) { const n = open[Math.floor(rng() * open.length)]; pathTo(n).forEach((a) => exp.add(a)); exp.add(n); }
    const { vis } = visibleFrom(res.root, exp);
    for (const free of [false, true]) {
      const pr = pruned(res.root, vis);
      assignDepth(pr);
      const o = { ...res.opts }; delete o.refine;
      if (!free) o.M = res.M; else delete o.M;           // free: what a layout that re-derives the schedule from the VISIBLE depth would do
      layoutProto(pr, 'B', o);
      let worst = 0;
      (function walk(n) { worst = Math.max(worst, hdist(n.z, n.orig.z)); if (free) medianFree.push(hdist(n.z, n.orig.z)); n.children.forEach(walk); })(pr);
      if (free) worstFreeM = Math.max(worstFreeM, worst); else worstFixedM = Math.max(worstFixedM, worst);
    }
  }
  medianFree.sort((a, b) => a - b);
  return { worstFixedM, worstFreeM, medianFree: medianFree[Math.floor(medianFree.length / 2)] };
}

// ---------- reachability -------------------------------------------------------------------------------------------------------
function reachability(res, realCount) {
  const seen = new Map();
  let dup = 0, wrongParent = 0;
  for (const n of res.nodes) if (n.real) { if (seen.has(n.real.id)) dup++; seen.set(n.real.id, n); }
  for (const n of seen.values()) if (n.real.parent) { let a = n.parent; while (a && a.isGroup) a = a.parent; if (a.real !== n.real.parent) wrongParent++; }
  const costs = [], clicks = [];
  for (const n of seen.values()) {
    const path = pathTo(n).slice(0, -1);                // everything that has to be open to see n
    costs.push(1 + path.reduce((s, a) => s + a.children.length, 0));
    clicks.push(path.length - 1);
  }
  costs.sort((a, b) => a - b); clicks.sort((a, b) => a - b);
  return { reached: seen.size, of: realCount, dup, wrongParent, maxVisible: costs[costs.length - 1], p99Visible: costs[Math.floor(costs.length * 0.99)], meanVisible: costs.reduce((s, x) => s + x, 0) / costs.length, maxExpansions: clicks[clicks.length - 1] };
}

// ---------- is it still hyperbolic? --------------------------------------------------------------------------------------------
function hyperbolicness(res) {
  // For parents at growing depth: how much bigger do their children look when the focus moves from the root to the parent?
  // (a radial chart has a fixed picture: factor 1.0 everywhere)
  const root = res.root, out = [];
  const px = (focus, a, b) => { const mf = neg(focus.z), ua = addC(mf, a.z), ub = addC(mf, b.z); return Math.hypot(ua.x - ub.x, ua.y - ub.y) * 500; };
  for (const depth of [1, 4, 7, 10]) {
    const cands = res.nodes.filter((n) => !n.isGroup && n.depth === depth && n.children.length >= 3);
    if (!cands.length) continue;
    const p = cands.reduce((a, b) => (b.children.length > a.children.length ? b : a));
    const kids = p.children, ratios = [];
    for (let i = 0; i + 1 < kids.length; i++) { const a = px(root, kids[i], kids[i + 1]), b = px(p, kids[i], kids[i + 1]); if (a > 0) ratios.push(b / a); }
    ratios.sort((a, b) => a - b);
    out.push({ name: p.name, depth, distFromRoot: hdist(root.z, p.z), kids: kids.length, median: ratios[Math.floor(ratios.length / 2)], p90: ratios[Math.floor(ratios.length * 0.9)] });
  }
  return { rows: out, rimShare: res.nodes.filter((n) => Math.hypot(n.z.x, n.z.y) > 0.9).length / res.nodes.length };
}

// Coordinates of the two widest parents' neighbourhoods (the parent, its groups, members and all descendants) for inspection.
function exportParents(json, file) {
  const out = {};
  for (const [label, strat] of [['S1 B, all children visible', {}], ['S5 hybrid, list cap 36', { adaptive: true, cap: 36 }]]) {
    const res = runLayout(json, strat);
    out[label] = {};
    for (const name of ['syndrome', 'autosomal recessive disease']) {
      const p = find(res.nodes, name), list = [];
      (function walk(n, parentIdx) { const idx = list.length; list.push({ name: n.name, x: +n.z.x.toFixed(6), y: +n.z.y.toFixed(6), depth: n.depth, parent: parentIdx, group: n.isGroup ? n.members : 0 }); n.children.forEach((c) => walk(c, idx)); })(p, -1);
      out[label][name] = { description: 'Poincare disk coordinates (root at 0,0) of the parent and everything below it; group > 0 = aggregated group with that many members', nodes: list };
    }
  }
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`coordinates of the two widest parents written to ${file}`);
}

function sweep() {
  const json = JSON.parse(fs.readFileSync(new URL('../../public/data/disease_tree.json', import.meta.url), 'utf8'));
  console.log('S5 (list cap 36) sensitivity: capF = share of its schedule the deeper levels must keep, mix = weight share of the angle');
  console.log('capF  mix   parents<0.04  <0.02  unresolved parents(children)  groups  maxR    min f  nodes with f<0.5  min edge  edges<0.05');
  for (const capF of [0.35, 0.2, 0.1]) for (const mix of [0.5, 0.7]) {
    const res = runLayout(json, { adaptive: true, cap: 36, opts: { capF, mix } });
    const m = measure(res.root, res.nodes, 'S5');
    const un = res.nodes.filter((n) => n.unresolved);
    const real = res.nodes.filter((n) => n.depth > 0);
    console.log(`${String(capF).padEnd(5)} ${String(mix).padEnd(4)}  ${String(m.parentsBelow04).padStart(10)} ${String(m.parentsBelow02).padStart(6)}  ${String(un.length).padStart(10)}(${un.reduce((s, n) => s + n.children.length, 0)})${' '.repeat(10)}  ${String(res.nodes.filter((n) => n.isGroup).length).padStart(6)}  ${f4(m.maxRadius)}  ${f4(Math.min(...res.nodes.map((n) => n.f ?? 1)))}  ${(100 * res.nodes.filter((n) => (n.f ?? 1) < 0.5).length / res.nodes.length).toFixed(1).padStart(14)}%  ${f4(Math.min(...real.map((n) => n.L)))}  ${(100 * real.filter((n) => n.L < 0.05).length / real.length).toFixed(1).padStart(8)}%`);
  }
}

// ---------- driver -------------------------------------------------------------------------------------------------------------
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const STRATS = [
  ['S1 B, all children visible', {}],
  ['S2 B + static groups K=36', { K: 36 }],
  ['S2 B + static groups K=24', { K: 24 }],
  ['S4a hybrid adaptive groups', { adaptive: true }],
  ['S4b hybrid + demand shares', { adaptive: true, demand: true }],
  ['S5 hybrid, list cap 36', { adaptive: true, cap: 36 }],
  ['S5 hybrid, list cap 24', { adaptive: true, cap: 24 }],
];

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--sweep') { sweep(); return; }
  const exportFile = args[args.indexOf('--export') + 1];
  const json = JSON.parse(fs.readFileSync(new URL('../../public/data/disease_tree.json', import.meta.url), 'utf8'));
  const realCount = buildTree(json).nodes.length;
  const dump = {};
  const rows = [];
  for (const [label, strat] of STRATS) {
    const t0 = Date.now();
    const res = runLayout(json, strat);
    const m = measure(res.root, res.nodes, label);
    const groups = res.nodes.filter((n) => n.isGroup);
    const groupedParents = new Set(groups.filter((g) => !g.parent.isGroup).map((g) => g.parent)).size;
    const unresolved = res.nodes.filter((n) => n.unresolved);
    const unresolvedKids = unresolved.reduce((s, n) => s + n.children.length, 0);
    const syn = find(res.nodes, 'syndrome'), arr = find(res.nodes, 'autosomal recessive disease');
    const states = [];
    const O = (e, f, l) => states.push(stateMetrics(res.root, e, f, l));
    O(overviewSet(res.root), res.root, 'overview (families + their children)');
    for (const [pn, p] of [['syndrome (486)', syn], ['autosomal recessive disease (1048)', arr]]) {
      O(stateFocus(res.root, p, 'children'), p, `${pn}: open parent`);
      const gs = p.children.filter((c) => c.isGroup);
      const big = gs.length ? gs.reduce((a, b) => (b.members > a.members ? b : a)) : p;
      O(stateFocus(res.root, p, 'oneGroup'), big, `${pn}: + largest group open, focus ON the group`);   // opening a group refocuses on it
      O(stateFocus(res.root, p, 'allGroups'), p, `${pn}: everything open`);
    }
    const stab = stability(res, mulberry(7));
    const reach = reachability(res, realCount);
    rows.push({ label, m, groups: groups.length, groupedParents, unresolved: unresolved.length, unresolvedKids, states, stab, reach, secs: (Date.now() - t0) / 1000, M: res.M, hyp: hyperbolicness(res) });
    if (exportFile) dump[label] = res.nodes.map((n) => [n.z.x, n.z.y, n.parent ? n.parent.id : -1, n.depth, n.name, n.isGroup ? n.members : 0, n.span]);
  }

  console.log('===== LAYOUT GEOMETRY of every node (groups included) — worst case: everything visible at once =====');
  console.log('strategy                       display depth  maxR    clamped  r>.994  overlap(pairs/parents)  groups  grouped parents  parents<0.04  <0.02  min sibling  closest pair  max edge  unresolved parents(children)');
  for (const r of rows) console.log(`${r.label.padEnd(30)} ${String(r.M).padStart(6)}       ${f4(r.m.maxRadius)}  ${String(r.m.clampedEdges).padStart(6)}  ${String(r.m.over994).padStart(6)}  ${String(r.m.overlapPairs).padStart(8)}/${String(r.m.overlapParents).padEnd(8)}  ${String(r.groups).padStart(6)}  ${String(r.groupedParents).padStart(14)}  ${String(r.m.parentsBelow04).padStart(12)} ${String(r.m.parentsBelow02).padStart(6)}  ${f4(r.m.minSibling)}  ${f4(r.m.closestPair)}  ${f4(r.m.maxEdge)}  ${r.unresolved}(${r.unresolvedKids})`);

  console.log('\n===== DISCLOSURE STATES (what is on screen at once) =====');
  for (const r of rows) {
    console.log(`\n--- ${r.label} ---`);
    console.log('state                                                   visible  groups  min sibling (visible sets)  closest visible pair  | focused region: desktop z1 min px / %>=6px (nodes) | desktop z2 | phone z1 | phone z2');
    for (const s of r.states) {
      const fmt = (x) => (x.inView < 2 ? `   n/a (${x.inView} in view)`.padEnd(15) : `${x.minPx.toFixed(1).padStart(6)} / ${(100 * x.sharpOK).toFixed(0).padStart(3)}%`);
      const g = s.region;
      console.log(`${s.label.padEnd(54)} ${String(s.visible).padStart(7)} ${String(s.groups).padStart(7)}  ${f4(s.siblingMin).padStart(26)}  ${f4(s.closest).padStart(19)}  | ${fmt(g['desktop z1'])} (${g['desktop z1'].inView}) | ${fmt(g['desktop z2'])} | ${fmt(g['phone z1'])} | ${fmt(g['phone z2'])}`);
    }
  }
  console.log('\n===== STABILITY (6 random expand/collapse states per strategy; worst displacement of any visible node, hyperbolic units) =====');
  for (const r of rows) console.log(`${r.label.padEnd(30)} layout with the global depth: ${r.stab.worstFixedM.toExponential(2)}   if the depth were re-derived from what is visible: worst ${f4(r.stab.worstFreeM)}, median ${f4(r.stab.medianFree)}`);
  console.log('\n===== REACHABILITY (every real disease; what must be open to see it) =====');
  for (const r of rows) console.log(`${r.label.padEnd(30)} reached ${r.reach.reached}/${r.reach.of}, duplicates ${r.reach.dup}, wrong real parent ${r.reach.wrongParent}; visible nodes when only its ancestors are open: mean ${r.reach.meanVisible.toFixed(0)}, p99 ${r.reach.p99Visible}, max ${r.reach.maxVisible}; deepest needs ${r.reach.maxExpansions} expansions`);
  console.log('\n===== STILL HYPERBOLIC? (the same sibling pairs: screen separation with the focus ON their parent divided by with the focus at the root; a radial chart would give 1.0) =====');
  for (const r of rows.filter((x, k) => k === 0 || k === 5)) {
    console.log(`${r.label}  (${(100 * r.hyp.rimShare).toFixed(0)}% of all nodes sit beyond radius 0.9 when the root is focused)`);
    for (const h of r.hyp.rows) console.log(`    parent depth ${String(h.depth).padStart(2)}, ${h.distFromRoot.toFixed(2)} from the root, ${String(h.kids).padStart(3)} children ("${h.name.slice(0, 40)}"): median x${h.median.toFixed(1)}, 90th pct x${h.p90.toFixed(1)}`);
  }
  if (args.includes('--export-parents')) exportParents(json, args[args.indexOf('--export-parents') + 1]);
  if (exportFile) { fs.writeFileSync(exportFile, JSON.stringify(dump)); console.log(`\npositions written to ${exportFile}`); }
}
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
export { runLayout, find, pathTo, visibleFrom, overviewSet, stateFocus, hdist, addC, neg, mirror, STRATS };
