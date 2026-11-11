// disclosure.js - which nodes are drawn as themselves, as a "+N" aggregate, or not at all, because of NAVIGATION GROUPS and LIST-ONLY nodes
// (displaytree.js). No drawing, no DOM: both viewers ask the same question here, so 2D and 3D agree.
//
// The rule (display limits are not access limits):
//   - A navigation group is CLOSED (drawn as one aggregate orb, its members hidden) unless it is on the focus path (the focus itself, or
//     one of its ancestors). So groups open one at a time, when you fly into them or into one of their members, and close again when
//     you leave; they are never all open at once by default.
//   - A list-only node is drawn as an aggregate orb unless it is on the focus path. When it is on the path (you focused it or one of its
//     members) its other children stay hidden: they are too close together to draw (see the member list, memberlist.js), only the member on
//     the path is shown.
//   - Everything else is untouched here (the 3D viewer adds its own distance-based collapse on top).
// Hidden nodes are still in the tree: searchable, selectable and reachable (focusing one puts it, and its groups, on the path).

const OPEN = { orb: false, kids: 'all' };
const CLOSED = { orb: true, kids: 'none' };
const PATH_ONLY = { orb: false, kids: 'path' };

// The rule for a node (its `onPath` flag must be up to date), or null for an ordinary node.
export function aggregateRule(node) {
  if (node.isGroup) return node.onPath ? OPEN : CLOSED;
  if (node.listOnly) return node.onPath ? PATH_ONLY : CLOSED;
  return null;
}

// May this child of a node with that rule be drawn?
export function childAllowed(rule, child) {
  if (!rule || rule.kids === 'all') return true;
  if (rule.kids === 'none') return false;
  return !!child.onPath;
}

// Set `onPath` on every node (true for the focus and its ancestors).
export function markPath(nodes, focus) {
  for (const n of nodes) n.onPath = false;
  for (let n = focus; n; n = n.parent) n.onPath = true;
}

// States for every node, indexed by id: 0 = drawn normally, 1 = hidden, 2 = aggregate orb ("+N" / group).
export function disclosureStates(nodes, root, focus) {
  markPath(nodes, focus);
  const out = new Uint8Array(nodes.length);
  const walk = (n, hidden) => {
    const rule = aggregateRule(n);
    const state = hidden ? 1 : rule && rule.orb ? 2 : 0;
    out[n.id] = state;
    for (const c of n.children) walk(c, hidden || state === 2 || !childAllowed(rule, c));
  };
  walk(root, false);
  return out;
}

// The list-only node whose member list should be shown for this focus (the focus itself, or the node whose child -- possibly through groups --
// the focus is), or null.
export function listFor(focus) {
  if (focus.listOnly) return focus;
  let p = focus.parent;
  while (p && p.isGroup) p = p.parent;
  return p && p.listOnly ? p : null;
}

// The REAL parent in the ontology: the nearest ancestor that is not a navigation group (null for the top). Navigation groups are display aids,
// not ontology relationships, so "Up" goes to this node, never to a group. (Focusing a group, e.g. by clicking its orb, is still possible; Up from a
// group also goes to its real parent.)
export function realParent(node) {
  let p = node.parent;
  while (p && p.isGroup) p = p.parent;
  return p || null;
}

// The full "what is shown" rule shared by the viewers: groups and list-only nodes as above, PLUS the distance rule (semantic zoom): a folder that
// is further than collapseDist (hyperbolic distance from the focus point) becomes a "+N" aggregate, with hysteresis so a folder near the limit does not
// flicker (it collapses beyond collapseDist + hyst and expands again inside collapseDist - hyst). The focus path is never collapsed.
// distanceOf(node) = hyperbolic distance from the focus point to the node (2D and 3D each measure in their own geometry).
// p = { collapseDist, hyst, minNodes }: folders with fewer than minNodes nodes below them never collapse ("+2" is pointless).
// Returns states by id: 0 drawn, 1 hidden, 2 aggregate. Sets `onPath` and `collapsed` on the nodes.
export function semanticStates(nodes, root, focus, distanceOf, p) {
  markPath(nodes, focus);
  const out = new Uint8Array(nodes.length);
  const walk = (n, hidden) => {
    const rule = aggregateRule(n);
    let state;
    if (hidden) state = 1;
    else if (rule) { n.collapsed = rule.orb; state = rule.orb ? 2 : 0; }
    else if (n.type === 'folder' && n.weight - 1 >= p.minNodes && !n.onPath) {
      const limit = n.collapsed ? p.collapseDist - p.hyst : p.collapseDist + p.hyst;
      n.collapsed = distanceOf(n) > limit;
      state = n.collapsed ? 2 : 0;
    } else { n.collapsed = false; state = 0; }
    out[n.id] = state;
    const childrenHidden = hidden || n.collapsed;
    for (const c of n.children) walk(c, childrenHidden || !childAllowed(rule, c));
  };
  walk(root, false);
  return out;
}
