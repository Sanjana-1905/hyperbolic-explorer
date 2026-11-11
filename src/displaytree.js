// displaytree.js - the DISPLAY TREE: the real tree plus alphabetical navigation groups where a parent has too many children.
// No drawing, no DOM. Shared by the 2D and the 3D viewer: both lay out the SAME display tree, so both show the same hierarchy.
//
// WHY. A parent with hundreds of children cannot show them all at once: 486 diseases under "syndrome", 1,048 under "autosomal recessive
// disease". Putting that many siblings on one circle leaves them closer than a pixel. So a wide parent gets an intermediate level of GROUPS:
//     parent  ->  a short list of groups ("A–F", "G–M", ...)  ->  its members (a short list each)
// A group is a navigation aid, NOT an ontology category: it is an alphabetical run of the real names, labelled with the first and last
// initial of the run. It is never a disease, has no DOID, and nothing about the ontology changes: the real tree, disease_edges.json and
// all 12,419 terms are untouched. A group is a display node (type "folder", isGroup = true) that lists its members.
//
// WHEN. Only where needed ("adaptive", strategy S5 in PROGRESS.md): while the layout runs, a parent with n children
//   1. keeps them as they are if n <= cap and they end up >= ACCEPT (0.04) apart;
//   2. otherwise tries group sizes G = 60, 40, 36, 30, 24, 18, 12, 8 (only G < n and G <= cap), largest first, and takes the first G for
//      which EVERY list it creates (the groups, and the members inside each group) reaches that spacing;
//   3. if none does, it takes the best candidate and the parent is flagged (see LIST-ONLY below).
//   cap = 36 on desktop, 24 on a phone: at most that many siblings are ever shown at once. A parent with fewer than 6 children is never grouped.
// HOW a list is made for a given G (deterministic, case-insensitive by name, ties by id):
//   - children WITH subtypes stay individual if there are <= G of them, otherwise they are cut into balanced alphabetical runs of <= G;
//   - childless children are cut into balanced alphabetical runs of <= G (up to 3 stay individual);
//   - if the list is still longer than G, the groups are cut again (groups of groups).
// LIST-ONLY. After the layout, any node whose children are still closer than ACCEPT is marked `listOnly`: the viewers draw it as a "+N"
// aggregate with a searchable member list instead of drawing its children (they stay selectable, searchable and reachable through
// the list, the search and hyperbolic focus). Display limits are not access limits.
import { buildTree, computeLayout, treeDepth, EDGE_LENGTH, S5 } from './layout.js';
import { complex, hyperbolicDistanceExact } from './mobius.js';

export const CAP_DESKTOP = 36;     // most siblings shown at once on a desktop
export const CAP_PHONE = 24;       // ... on a phone
const GROUP_SIZES = [60, 40, 36, 30, 24, 18, 12, 8];
const LABEL_MAX_LETTERS = 12;

const weightOf = (c) => c.w ?? c.weight;
const lower = (s) => s.toLowerCase();
const byName = (a, b) => (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : a.id - b.id);
const nameOf = (e) => (e.isGroup ? e.firstName : e.name);
const lastOf = (e) => (e.isGroup ? e.lastName : e.name);

// ---------------------------------------------------------------------------
// Groups and their labels
// ---------------------------------------------------------------------------
// First k characters of a name, written "Ab"; a name that does not start with a letter is "#".
function prefix(name, k) {
  const t = name.trim();
  if (!/^[A-Za-z]/.test(t)) return '#';
  const p = t.slice(0, k);
  return p[0].toUpperCase() + p.slice(1).toLowerCase();
}
// The label of a run: first and last initial, with more letters only if the two ends cannot be told apart.
// Examples: "abdominal ..." to "cystic ..." -> "A–C";  two names both starting "Ab" -> "Aba–Abd" (k grows until the ends differ).
// Runs whose names all share a long start ("autosomal recessive ...") get more letters, up to 12, then "Autosomal re…" (names starting so).
export function runLabel(first, last) {
  for (let k = 1; k <= LABEL_MAX_LETTERS; k++) {
    const a = prefix(first, k), b = prefix(last, k);
    if (a !== b) return `${a}–${b}`;
    if (k === LABEL_MAX_LETTERS) return k < Math.min(first.length, last.length) ? `${a}…` : a;   // both ends start alike: "Autosomal re…"
  }
  return '';
}

// The text shown on a group's orb: its alphabetical range, how many members, and (only where it matters) what kind of members. Subtypes and
// childless diseases are separate alphabetical lists, so two groups can both run "A–F" and the label must say which is which.
//   "A–F · 24"               24 diseases without subtypes, names from A to F
//   "A–F · 12 with subtypes" 12 diseases that have subtypes of their own
//   "A–F · 5 groups"         a run of groups (and subtypes) of a very wide parent
export function groupLabel(g) {
  return g.kind === 'subtypes' ? `${g.name} · ${g.members} with subtypes` : g.kind === 'groups' ? `${g.name} · ${g.members} groups` : `${g.name} · ${g.members}`;
}

// A group's range is the smallest and the largest name among ALL its members (so the label is true even for a mixed run).
function makeGroup(members, kind) {
  let firstName = nameOf(members[0]), lastName = lastOf(members[0]);
  for (const m of members) {
    if (lower(nameOf(m)) < lower(firstName)) firstName = nameOf(m);
    if (lower(lastOf(m)) > lower(lastName)) lastName = lastOf(m);
  }
  const w = members.reduce((s, m) => s + weightOf(m), 0);
  return {
    id: -1, name: runLabel(firstName, lastName), type: 'folder', size: members.reduce((s, m) => s + (m.size || 0), 0),
    ext: undefined, loc: undefined, hasSymbols: false, fileId: undefined, commits: undefined, modified: undefined,
    parent: null, children: members, depth: 0, weight: 1, z: complex(0, 0),
    isGroup: true, kind, members: members.length, firstName, lastName,
    w, realWeight: w,                       // real diseases inside (a group is not one)
  };
}
// Balanced consecutive runs of at most G.
function chunk(list, G, kind) {
  const c = Math.ceil(list.length / G), out = [];
  let at = 0;
  for (let i = 0; i < c; i++) {
    const size = Math.floor(list.length / c) + (i < list.length % c ? 1 : 0);
    out.push(makeGroup(list.slice(at, at + size), kind));
    at += size;
  }
  return out;
}
// The list a parent would show for group size G:
//   - children WITH subtypes stay individual if there are <= G of them, otherwise they are cut into balanced alphabetical runs ("subtypes");
//   - childless children are cut into balanced alphabetical runs ("diseases"; up to 3 stay individual);
//   - if the list is still longer than G, it is cut again (groups of groups, kind "groups").
// Why not one pure alphabetical run over everything? Measured: it squeezes big subtrees into a group's narrow wedge, exhausts the radius budget
// and leaves 17 nodes list-only instead of 3 (PROGRESS.md). Keeping the subtypes individual keeps their full territory.
function itemsFor(kids, G) {
  const internal = kids.filter((k) => k.children.length > 0).sort(byName);
  const leaves = kids.filter((k) => k.children.length === 0).sort(byName);
  let list = [...(internal.length <= G ? internal : chunk(internal, G, 'subtypes')), ...(leaves.length <= 3 ? leaves : chunk(leaves, G, 'diseases'))];
  while (list.length > G) {
    // a list that mixes individual subtypes with groups is put in order of where each entry STARTS, so the runs (and their labels) are ranges
    list = chunk([...list].sort((a, b) => (lower(nameOf(a)) < lower(nameOf(b)) ? -1 : lower(nameOf(a)) > lower(nameOf(b)) ? 1 : 0)), G, 'groups');
  }
  return list;
}

// ---------------------------------------------------------------------------
// The adaptive trial, run inside the layout (computeLayout's `refine` hook)
// ---------------------------------------------------------------------------
function pairMin(nodes) {
  let m = Infinity;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) m = Math.min(m, hyperbolicDistanceExact(nodes[i].z, nodes[j].z));
  return m;
}
// Smallest sibling distance over the list and, recursively, over the members of every group in it.
function trialSeparation(node, list, api, center, fan) {
  const pl = api.plan(node, list, center, fan);
  const placed = list.map((_, i) => api.spawn(node, pl, i));
  let m = pairMin(list);
  list.forEach((c, i) => { if (c.isGroup) m = Math.min(m, trialSeparation(c, c.children, api, placed[i].away, placed[i].fan)); });
  return m;
}
function makeRefine(cap) {
  return (node, api) => {
    const kids = node.children, n = kids.length;
    if (n < 6 && n <= cap) return kids;
    const tried = [];
    const sizes = [Infinity, ...GROUP_SIZES].filter((G) => (G === Infinity ? n <= cap : G < n && G <= cap));
    for (const G of sizes) {
      const list = G === Infinity ? kids : itemsFor(kids, G);
      const sep = trialSeparation(node, list, api, api.centerAngle, api.fan);
      if (sep >= S5.ACCEPT) return list;
      tried.push({ list, sep });
    }
    tried.sort((a, b) => b.sep - a.sep);               // nothing reaches it: take the best (the viewer will mark it list-only)
    return tried.length ? tried[0].list : kids;
  };
}

// ---------------------------------------------------------------------------
// Building the display tree
// ---------------------------------------------------------------------------
// json: the parsed tree file. opts: { cap } (default desktop), plus any computeLayout option (tests use mix / capF).
// Returns { root, nodes, info } where nodes are in pre-order like buildTree's, with ids, depth, `weight` (= nodes in the display subtree,
// groups included, so "id .. id + weight" is still a subtree), `w` and `realWeight` (real diseases below, groups not counted), `edgeLength`
// and the 2D position `z` already set. Groups have isGroup, kind, members, firstName, lastName. listOnly nodes have `listOnly = true`.
export function makeDisplayTree(json, opts = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { cap = CAP_DESKTOP, ...layoutOpts } = opts;
  let M = treeDepth(buildTree(json).root);
  let root;
  for (let attempt = 0; attempt < 8; attempt++) {
    root = buildTree(json).root;
    (function mark(n) { n.w = n.weight; n.realWeight = n.weight; n.realId = n.id; n.children.forEach(mark); })(root);   // realId = id in the real tree
    const used = computeLayout(root, EDGE_LENGTH, { ...layoutOpts, M, refine: makeRefine(cap) });
    const depth = treeDepth(root);
    if (depth <= used.M) break;                         // groups made the tree deeper than assumed: lay it out again with the true depth
    M = depth;
  }
  const nodes = [];
  (function number(n) {
    n.id = nodes.length; nodes.push(n);
    n.weight = 1;
    for (const c of n.children) { number(c); n.weight += c.weight; }
  })(root);
  // List-only: a node whose children are still closer than ACCEPT after everything above.
  const listOnly = [];
  for (const n of nodes) {
    if (n.children.length < 2) continue;
    let m = Infinity;
    for (let i = 0; i < n.children.length; i++) for (let j = i + 1; j < n.children.length; j++) m = Math.min(m, hyperbolicDistanceExact(n.children[i].z, n.children[j].z));
    if (m < S5.ACCEPT) { n.listOnly = true; n.minChildSeparation = m; listOnly.push(n); }
  }
  const groups = nodes.filter((n) => n.isGroup);
  const info = {
    cap, M, groups: groups.length, groupedParents: new Set(groups.filter((g) => !g.parent.isGroup).map((g) => g.parent)).size,
    listOnly, realCount: nodes.length - groups.length, ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
  return { root, nodes, info };
}

// The real diseases directly below a node, looking through navigation groups (what a list-only node's member list shows).
export function realMembers(node) {
  const out = [];
  const walk = (n) => { for (const c of n.children) { if (c.isGroup) walk(c); else out.push(c); } };
  walk(node);
  return out;
}
