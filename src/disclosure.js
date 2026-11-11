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
