// maintree.js - the BASELINE for the user study (Phase 6d): a plain collapsible tree, like a file explorer. Open with ?mode=tree.
//
// Same data as the two hyperbolic viewers (the same ?tree= JSON, built by the same buildTree, so paths are identical), no
// geometry at all: folders open and close, you scroll. It deliberately has none of the hyperbolic viewers' extras (no map,
// no heat, no links). It has the one thing every file explorer has: a filter box (hide it with &search=0, which also hides
// the 3D viewer's search button, so the conditions can be compared with or without search).
//
// It exposes the same small debugging interface as the other viewers (window.__explorer: nodes, focusId(), focusOn(), focusNode)
// so study mode logs it exactly like the others: "focus" here means "the selected row".
//
// Mouse/touch only (no arrow keys), like the other conditions. Rows are TREE_ROW_PX tall (TREE_ROW_TOUCH_PX on touch screens: 44 px thumb targets). Look constants: TREE_* and CODE_* in theme.js.

import { buildTree, nodePath } from './layout.js';
import { THEME, cssRgb } from './theme.js';
import { treeFileFromUrl } from './dataset.js';

const params = new URLSearchParams(location.search);
const withSearch = params.get('search') !== '0';

document.getElementById('help').textContent = 'Click a folder to open or close it · click a file to select it';
const infoName = document.querySelector('#info .name');
const infoPath = document.querySelector('#info .path');

const css = document.createElement('style');
css.textContent = `
  #tree { position: fixed; z-index: 1; left: 0; right: 0; bottom: 0; top: calc(64px + var(--study-h, 0px)); overflow: auto;
    background: ${cssRgb(THEME.CODE_BG)}; color: ${cssRgb(THEME.CODE_TEXT)}; font: 14px system-ui, sans-serif;
    -webkit-overflow-scrolling: touch; }
  #tree .t-filter { position: sticky; top: 0; z-index: 2; padding: 8px 12px; background: ${cssRgb(THEME.CODE_BG)};
    border-bottom: 1px solid ${cssRgb(THEME.CODE_LINENO, 0.3)}; }
  #tree input { width: 100%; box-sizing: border-box; height: 40px; border-radius: 8px; padding: 0 12px; font: 15px system-ui, sans-serif;
    color: inherit; background: ${cssRgb(THEME.CRUMB_BG, 1)}; border: 1px solid ${cssRgb(THEME.CRUMB_SEP_COLOR)}; outline: 0; }
  #tree .row { display: flex; align-items: center; height: ${THEME.TREE_ROW_PX}px; cursor: pointer; white-space: nowrap;
    padding-right: 12px; border-bottom: 1px solid ${cssRgb(THEME.CODE_LINENO, 0.08)}; }
  #tree .row.sel { background: ${cssRgb(THEME.UI_ACTIVE_BG, THEME.UI_ACTIVE_ALPHA)}; color: ${cssRgb(THEME.CRUMB_LAST_COLOR)}; }
  #tree .arrow { width: 28px; text-align: center; flex: none; color: ${cssRgb(THEME.CODE_HEADER)}; }
  #tree .count { margin-left: 8px; font-size: 12px; color: ${cssRgb(THEME.CODE_LINENO)}; }
  #tree .folder { font-weight: 600; }
  @media (pointer: coarse) { #tree .row { height: ${THEME.TREE_ROW_TOUCH_PX}px; } #tree .arrow { width: 40px; } }
  @media (max-height: ${THEME.COMPACT_HEIGHT_PX}px) { #tree { top: calc(44px + var(--study-h, 0px)); } }
`;
document.head.appendChild(css);

const box = document.createElement('div');
box.id = 'tree';
document.body.appendChild(box);

let nodes = [], root = null, selected = null;
const expanded = new Set();     // ids of open folders
let query = '';

// The rows to show: open folders' children (depth first); with a filter, the nodes whose name matches plus their ancestors.
function visibleNodes() {
  const out = [];
  if (query) {
    const q = query.toLowerCase();
    const keep = new Set();
    for (const n of nodes) {
      if (n.name.toLowerCase().includes(q)) for (let a = n; a; a = a.parent) keep.add(a.id);
    }
    const walk = (n) => { if (!keep.has(n.id)) return; out.push(n); n.children.forEach(walk); };
    walk(root);
    return out;
  }
  const walk = (n) => { out.push(n); if (expanded.has(n.id)) n.children.forEach(walk); };
  walk(root);
  return out;
}

function render() {
  const rows = visibleNodes().map((n) => {
    const folder = n.type === 'folder' && n.children.length > 0;
    const open = query ? true : expanded.has(n.id);
    return `<div class="row${n === selected ? ' sel' : ''}" data-id="${n.id}" style="padding-left:${8 + n.depth * THEME.TREE_INDENT_PX}px">` +
      `<span class="arrow">${folder ? (open ? '▾' : '▸') : ''}</span>` +
      `<span class="${folder ? 'folder' : ''}">${n.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>` +
      (folder ? `<span class="count">${n.children.length}</span>` : '') + '</div>';
  });
  const keepScroll = box.scrollTop;
  box.innerHTML = (withSearch ? '<div class="t-filter"><input type="search" placeholder="Filter by name…" autocomplete="off" spellcheck="false" aria-label="Filter"></div>' : '') + rows.join('');
  if (withSearch) {
    const input = box.querySelector('input');
    input.value = query;
    input.addEventListener('input', () => { query = input.value; renderKeepFocus(); });
  }
  box.scrollTop = keepScroll;
}
function renderKeepFocus() {          // re-render while the user types without losing the caret
  const had = withSearch && document.activeElement === box.querySelector('input');
  const pos = had ? box.querySelector('input').selectionStart : 0;
  render();
  if (had) { const i = box.querySelector('input'); i.focus(); i.setSelectionRange(pos, pos); }
}

function select(node) {
  selected = node;
  infoName.textContent = node.name + (node.type === 'folder' ? '/' : '');
  infoPath.textContent = nodePath(node);
}

// Open every ancestor so `node` is visible.
function reveal(node) { for (let a = node.parent; a; a = a.parent) expanded.add(a.id); }

box.addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const node = nodes[Number(row.dataset.id)];
  if (node.type === 'folder' && node.children.length) {
    if (expanded.has(node.id)) expanded.delete(node.id); else expanded.add(node.id);
  }
  select(node);
  render();
});

// No keyboard navigation on purpose: the hyperbolic viewers are mouse/touch only, so the baseline is too (a fair comparison,
// and the study also runs on phones).

async function start() {
  const file = treeFileFromUrl(params);
  const url = `${import.meta.env.BASE_URL}data/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  const tree = buildTree(await response.json());
  root = tree.root; nodes = tree.nodes;
  select(root);
  render();
}
start().catch((err) => { infoName.textContent = 'Error'; infoPath.textContent = String(err); console.error(err); });

// Same debugging interface as the other viewers (study mode reads it).
window.__explorer = {
  get nodes() { return nodes; },
  get focusNode() { return selected; },
  focusId: () => selected.id,
  focusOn(node) { reveal(node); select(node); render(); const r = box.querySelector('.row.sel'); if (r) r.scrollIntoView({ block: 'nearest' }); },
  reset() { expanded.clear(); query = ''; select(root); render(); box.scrollTop = 0; },
};
