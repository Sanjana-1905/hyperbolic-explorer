// diseasepanel.js - the DISEASE PANEL: what the atlas knows about the selected disease, next to the hyperbolic picture (step 2.2).
// Plain HTML on top of the canvas, shared by the 2D and the 3D viewer. It replaces the generic info card for the Disease Ontology.
//
// It shows (all from the disease data layer, nothing made up; wording and structure come from panelmodel.js):
//   name + DOID, "where it sits" (the primary path from the top, every step clickable), definition, synonyms by scope,
//   the PLACE IN THE ONTOLOGY: the primary parent (solid, teal) and the additional is_a parents (dashed, violet) kept visibly apart,
//   subtypes (and diseases listed below it that are placed under another primary parent), the two counts (primary hierarchy / full ontology)
//   with their explanation, external identifiers (clearly marked as belonging to other resources), and the ontology release it all comes from.
// A navigation group (displaytree.js) is shown as what it is: an alphabetical list, not a category. A list-only node shows its searchable member list.
//
// Layout: desktop / landscape: a column docked on the right; portrait phone: a bottom sheet (folded: a 66 px strip with name and DOID).
// It reports how much of the screen it covers (onLayout, and the CSS variables --panel-w / --sheet-h that the toolbar, breadcrumb and map already
// respect), so the viewer keeps the selected disease centred in the part of the screen the panel does NOT cover: the picture stays visible.
// Clicking anything in the panel focuses that disease in the picture (hyperbolic focus), exactly like clicking it there.
import { THEME, cssRgb } from './theme.js';
import { diseaseModel, groupModel, loadingModel } from './panelmodel.js';
import { createMemberList } from './memberlist.js';
import { groupLabel, realMembers } from './displaytree.js';
import { listFor } from './disclosure.js';

const NARROW = '(orientation: portrait)';

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

// options: data (diseasedata layer), nodeById(id), onNavigate(node), onLayout(rightPx, bottomPx), launcher (show a round button when closed)
export function createDiseasePanel({ data, nodeById, onNavigate, onLayout = () => {}, launcher = false }) {
  const css = document.createElement('style');
  css.textContent = `
    #dpanel { position: fixed; z-index: 5; top: 0; right: 0; bottom: 0; width: min(${THEME.PANEL_WIDTH_PX}px, 100vw, max(280px, 46vw)); box-sizing: border-box; display: none; flex-direction: column;
      background: ${cssRgb(THEME.PANEL_BG)}; color: ${cssRgb(THEME.PANEL_TEXT)}; border-left: 1px solid ${cssRgb(THEME.PANEL_BORDER)};
      font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; padding-right: var(--sai-r, 0px); }
    #dpanel.open { display: flex; }
    #dpanel .dp-head { flex: none; padding: 14px 16px 10px; border-bottom: 1px solid ${cssRgb(THEME.PANEL_BORDER)}; padding-top: calc(14px + var(--sai-t, 0px)); }
    #dpanel .dp-titlerow { display: flex; align-items: flex-start; gap: 8px; }
    #dpanel .dp-name { flex: 1; margin: 0; font-size: 20px; line-height: 1.25; font-weight: 600; overflow-wrap: anywhere; }
    #dpanel .dp-sub { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    #dpanel .dp-doid { font: 600 12px ui-monospace, Menlo, monospace; color: ${cssRgb(THEME.PANEL_HEADING)}; background: ${cssRgb(THEME.PANEL_CHIP_BG)}; border: 1px solid ${cssRgb(THEME.PANEL_BORDER)}; border-radius: 6px; padding: 2px 7px; }
    #dpanel .dp-badge { font-size: 12px; color: ${cssRgb(THEME.PANEL_MUTED)}; }
    #dpanel .dp-badge + .dp-badge::before { content: '·'; margin-right: 6px; }
    #dpanel .dp-icon { flex: none; width: 36px; height: 36px; border-radius: 18px; border: 1px solid ${cssRgb(THEME.PANEL_BORDER)}; background: ${cssRgb(THEME.PANEL_CHIP_BG)}; color: ${cssRgb(THEME.PANEL_TEXT)}; font-size: 18px; cursor: pointer; line-height: 1; }
    #dpanel .dp-fold { display: none; }
    #dpanel .dp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px calc(18px + var(--sai-b, 0px)); overscroll-behavior: contain; }
    #dpanel section { padding: 12px 0 4px; border-bottom: 1px solid ${cssRgb(THEME.PANEL_BORDER, 0.55)}; }
    #dpanel section:last-child { border-bottom: 0; }
    #dpanel h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; color: ${cssRgb(THEME.PANEL_HEADING)}; }
    #dpanel p { margin: 0 0 8px; }
    #dpanel .dp-muted { color: ${cssRgb(THEME.PANEL_MUTED)}; }
    #dpanel .dp-note { color: ${cssRgb(THEME.PANEL_MUTED)}; font-size: 12px; }
    #dpanel .dp-missing { color: ${cssRgb(THEME.PANEL_MUTED)}; font-style: italic; }
    #dpanel .dp-path { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 0 2px; }
    #dpanel .dp-path .dp-sep { color: ${cssRgb(THEME.PANEL_MUTED)}; align-self: center; font-size: 12px; }
    #dpanel button.dp-link, #dpanel .dp-chip { font: inherit; text-align: left; color: ${cssRgb(THEME.PANEL_TEXT)}; background: ${cssRgb(THEME.PANEL_CHIP_BG)}; border: 1px solid ${cssRgb(THEME.PANEL_BORDER)};
      border-radius: 8px; padding: 4px 9px; cursor: pointer; overflow-wrap: anywhere; }
    #dpanel button.dp-link:hover { border-color: ${cssRgb(THEME.PANEL_HEADING)}; }
    #dpanel button.dp-link:focus-visible, #dpanel .dp-icon:focus-visible, #dpanel .dp-more:focus-visible { outline: 2px solid ${cssRgb(THEME.PANEL_HEADING)}; outline-offset: 1px; }
    #dpanel .dp-path button.dp-link { font-size: 12px; padding: 3px 7px; }
    #dpanel .dp-path .dp-current { font-size: 12px; font-weight: 600; padding: 3px 7px; border-radius: 8px; background: ${cssRgb(THEME.PANEL_CHIP_BG)}; border: 1px solid ${cssRgb(THEME.PANEL_HEADING)}; }
    #dpanel .dp-link small { font: 11px ui-monospace, Menlo, monospace; color: ${cssRgb(THEME.PANEL_MUTED)}; margin-left: 6px; }
    #dpanel .dp-rel { margin: 0 0 10px; padding: 8px 10px; border-radius: 10px; border: 1px solid; }
    #dpanel .dp-rel-primary { border-color: ${cssRgb(THEME.REL_PRIMARY_COLOR, 0.7)}; border-left-width: 4px; border-style: solid; }
    #dpanel .dp-rel-extra { border-color: ${cssRgb(THEME.REL_EXTRA_COLOR, 0.7)}; border-left-width: 4px; border-style: dashed; }
    #dpanel .dp-reltag { display: block; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; margin-bottom: 5px; }
    #dpanel .dp-rel-primary .dp-reltag { color: ${cssRgb(THEME.REL_PRIMARY_COLOR)}; }
    #dpanel .dp-rel-extra .dp-reltag { color: ${cssRgb(THEME.REL_EXTRA_COLOR)}; }
    #dpanel .dp-list { display: flex; flex-direction: column; gap: 4px; }
    #dpanel .dp-more { margin-top: 6px; font: inherit; font-size: 12px; color: ${cssRgb(THEME.PANEL_HEADING)}; background: none; border: 0; padding: 4px 0; cursor: pointer; text-align: left; }
    #dpanel .dp-scope { margin: 0 0 6px; }
    #dpanel .dp-scope b { font-weight: 600; color: ${cssRgb(THEME.PANEL_MUTED)}; font-size: 12px; margin-right: 6px; }
    #dpanel .dp-count { display: flex; gap: 10px; margin: 0 0 8px; align-items: baseline; }
    #dpanel .dp-swatch { flex: none; width: 22px; height: 0; border-top: 3px solid; align-self: center; }
    #dpanel .dp-swatch.primary { border-color: ${cssRgb(THEME.REL_PRIMARY_COLOR)}; }
    #dpanel .dp-swatch.extra { border-color: ${cssRgb(THEME.REL_EXTRA_COLOR)}; border-top-style: dashed; }
    #dpanel .dp-num { font-weight: 600; font-variant-numeric: tabular-nums; }
    #dpanel .dp-ext { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 6px; border: 1px solid ${cssRgb(THEME.PANEL_BORDER)}; color: ${cssRgb(THEME.PANEL_MUTED)}; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; vertical-align: 1px; }
    #dpanel .dp-idgroup { margin: 0 0 8px; }
    #dpanel .dp-idgroup b { display: block; font-size: 12px; font-weight: 600; color: ${cssRgb(THEME.PANEL_MUTED)}; margin-bottom: 3px; }
    #dpanel .dp-ids { display: flex; flex-wrap: wrap; gap: 4px; }
    #dpanel .dp-chip { cursor: default; font: 12px ui-monospace, Menlo, monospace; padding: 2px 7px; user-select: all; }
    #dpanel .dp-prov { font-size: 12px; color: ${cssRgb(THEME.PANEL_MUTED)}; padding-top: 12px; }
    #dpanel .dp-prov b { color: ${cssRgb(THEME.PANEL_TEXT)}; font-weight: 600; }
    #dpanel .dp-prov a, #dpanel .dp-prov .dp-url { color: ${cssRgb(THEME.PANEL_HEADING)}; overflow-wrap: anywhere; }
    #dpanel .dp-glist { display: flex; flex-direction: column; gap: 4px; }
    #dpanelOpen { position: fixed; z-index: 5; right: calc(12px + var(--sai-r, 0px)); bottom: calc(72px + max(var(--sheet-h, 0px), var(--sai-b, 0px))); width: 44px; height: 44px; border-radius: 22px; display: none; font-size: 20px; cursor: pointer;
      color: ${cssRgb(THEME.PANEL_TEXT)}; background: ${cssRgb(THEME.PANEL_BG)}; border: 1px solid ${cssRgb(THEME.PANEL_BORDER)}; }
    #dpanelOpen.show { display: block; }
    @media ${NARROW} {
      #dpanel { top: auto; left: 0; right: 0; bottom: 0; width: auto; height: ${THEME.PANEL_SHEET_HEIGHT_VH}vh; border-left: 0; border-top: 1px solid ${cssRgb(THEME.PANEL_BORDER)}; border-radius: 16px 16px 0 0; padding-right: 0; }
      #dpanel.folded { height: calc(${THEME.PANEL_PEEK_PX}px + var(--sai-b, 0px)); }
      #dpanel.folded .dp-body { display: none; }
      #dpanel .dp-head { padding-top: 10px; cursor: pointer; }
      #dpanel .dp-name { font-size: 17px; }
      #dpanel.folded .dp-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #dpanel.folded .dp-sub { display: none; }
      #dpanel .dp-fold { display: block; }
      #dpanel button.dp-link { min-height: 40px; }
    }
  `;
  document.head.appendChild(css);

  const root = h('aside');
  root.id = 'dpanel';
  root.setAttribute('aria-label', 'Disease information');
  const head = h('header', 'dp-head');
  const titleRow = h('div', 'dp-titlerow');
  const nameEl = h('h2', 'dp-name');
  const foldBtn = h('button', 'dp-icon dp-fold', '⌃'); foldBtn.type = 'button'; foldBtn.setAttribute('aria-label', 'Fold or unfold the panel');
  const closeBtn = h('button', 'dp-icon dp-close', '×'); closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close the panel');
  titleRow.append(nameEl, foldBtn, closeBtn);
  const subEl = h('div', 'dp-sub');
  head.append(titleRow, subEl);
  const body = h('div', 'dp-body');
  root.append(head, body);
  document.body.appendChild(root);

  const opener = h('button', null, 'ⓘ'); opener.id = 'dpanelOpen'; opener.type = 'button'; opener.setAttribute('aria-label', 'Show disease information');
  document.body.appendChild(opener);

  // ---- open / fold state and the space it covers ------------------------------------------------------------------------------------
  const narrow = () => window.matchMedia(NARROW).matches;
  let open = true, folded = narrow(), seq = 0, current = null, lastModel = null, idle = Promise.resolve(), deferred = false;
  const listHost = h('div', 'dp-members');                 // where the member list of a list-only node lives (inside the panel)
  const members = createMemberList({ onPick: (n) => onNavigate(n), host: listHost });

  function layout() {
    root.classList.toggle('open', open);
    root.classList.toggle('folded', folded && narrow());
    opener.classList.toggle('show', launcher && !open);
    const isNarrow = narrow();
    const width = open && !isNarrow ? Math.round(root.getBoundingClientRect().width) || Math.min(THEME.PANEL_WIDTH_PX, window.innerWidth) : 0;
    const sheet = open && isNarrow ? (folded ? THEME.PANEL_PEEK_PX : (THEME.PANEL_SHEET_HEIGHT_VH / 100) * window.innerHeight) : 0;
    document.documentElement.style.setProperty('--panel-w', `${width}px`);
    document.documentElement.style.setProperty('--sheet-h', `${Math.round(sheet)}px`);
    onLayout(Math.round(width), Math.round(sheet));
    // On a phone the 5 MB ontology file is not fetched while the sheet is folded (only the name is shown): load it when the panel is really shown.
    if (deferred && open && !(isNarrow && folded) && current) { deferred = false; api.select(current); }
  }
  function setOpen(v) { open = !!v; layout(); }
  head.addEventListener('click', (e) => { if (e.target.closest('.dp-close')) { setOpen(false); return; } if (narrow()) { folded = !folded; layout(); } });
  opener.addEventListener('click', () => { open = true; if (narrow()) folded = false; layout(); });
  window.addEventListener('resize', layout);

  // ---- drawing a model ------------------------------------------------------------------------------------------------------------
  const link = (item, extra, showDoid = true) => {
    const b = h('button', 'dp-link'); b.type = 'button';
    b.append(document.createTextNode(item.name));
    if (item.doid && showDoid) { const s = h('small', null, item.doid); b.append(s); }
    if (item.doid && !showDoid) b.title = item.doid;
    if (extra) b.append(document.createTextNode(` ${extra}`));
    if (item.nodeId !== undefined) b.dataset.nodeId = String(item.nodeId); else b.dataset.doid = item.doid;
    return b;
  };
  // A list that shows the first few entries and a "Show all N" button.
  const longList = (items, make, label = 'Show all') => {
    const wrap = h('div'), list = h('div', 'dp-list');
    const shown = THEME.PANEL_LIST_SHOWN;
    items.slice(0, shown).forEach((x) => list.append(make(x)));
    wrap.append(list);
    if (items.length > shown) {
      const more = h('button', 'dp-more', `${label} ${items.length.toLocaleString('en-US')}`); more.type = 'button';
      more.addEventListener('click', () => { list.textContent = ''; items.forEach((x) => list.append(make(x))); more.remove(); });
      wrap.append(more);
    }
    return wrap;
  };
  const section = (title, ...kids) => { const s = h('section'); if (title) s.append(h('h3', null, title)); s.append(...kids); return s; };
  const pathNav = (path) => {
    const nav = h('nav', 'dp-path'); nav.setAttribute('aria-label', 'Where it sits in the primary hierarchy');
    path.forEach((p, i) => {
      if (i) nav.append(h('span', 'dp-sep', '›'));
      if (p.current) nav.append(h('span', 'dp-current', p.name));
      else nav.append(link({ doid: p.doid, name: p.name }, null, false));
    });
    return nav;
  };
  const provenance = (pv) => {
    const f = h('footer', 'dp-prov');
    const t = h('p'); t.append(h('b', null, pv.title)); f.append(t);
    for (const l of pv.lines) f.append(h('div', null, l));
    const u = h('div', 'dp-url', `Source: ${pv.url}`); f.append(u);
    f.append(h('p', 'dp-note', pv.disclaimer));
    return f;
  };

  function render(model) {
    lastModel = model;
    nameEl.textContent = model.title;
    subEl.textContent = '';
    if (model.doid) subEl.append(h('span', 'dp-doid', model.doid));
    if (model.subtitle) subEl.append(h('span', 'dp-badge', model.subtitle));
    for (const b of model.badges || []) subEl.append(h('span', 'dp-badge', b));
    body.textContent = '';
    if (model.path && model.path.length) body.append(pathNav(model.path));

    if (model.kind === 'loading' || model.kind === 'error') {
      const p = h('p', model.error ? 'dp-note' : 'dp-muted', model.message);
      const s = section(null, p);
      if (model.error) { const r = h('button', 'dp-link', 'Try again'); r.type = 'button'; r.addEventListener('click', () => api.select(current)); s.append(r); }
      body.append(s);
      layout();
      return;
    }
    if (model.kind === 'group') {
      body.append(section(null, h('p', null, model.summary), h('p', 'dp-note', model.note)));
      const list = h('div', 'dp-glist');
      for (const m of model.members) list.append(link(m, m.isGroup ? `(${m.members})` : m.hasSubtypes ? '(has subtypes)' : ''));
      body.append(section('Members', list));
      if (model.provenance) body.append(section(null, provenance(model.provenance)));
      layout();
      return;
    }

    // ---- a disease ----
    const defSec = section('Definition');
    if (model.definition.missing) defSec.append(h('p', 'dp-missing', model.definition.message));
    else {
      defSec.append(h('p', null, model.definition.text));
      if (model.definition.references.length) defSec.append(h('p', 'dp-note', `Definition sources: ${model.definition.references.join(', ')}`));
    }
    body.append(defSec);

    const synSec = section(`Synonyms${model.synonyms.total ? ` (${model.synonyms.total})` : ''}`);
    if (model.synonyms.missing) synSec.append(h('p', 'dp-missing', model.synonyms.message));
    else {
      const wrap = h('div');
      const drawSyn = (limit) => {                           // first `limit` synonyms in scope order, then "Show all"
        wrap.textContent = '';
        let left = limit;
        for (const g of model.synonyms.groups) {
          if (left <= 0) break;
          const items = g.items.slice(0, left); left -= items.length;
          const row = h('p', 'dp-scope'); row.append(h('b', null, `${g.label}:`), document.createTextNode(items.join('; '))); wrap.append(row);
        }
        if (limit < model.synonyms.total) { const more = h('button', 'dp-more', `Show all ${model.synonyms.total}`); more.type = 'button'; more.addEventListener('click', () => drawSyn(Infinity)); wrap.append(more); }
      };
      drawSyn(THEME.PANEL_LIST_SHOWN);
      synSec.append(wrap);
    }
    body.append(synSec);

    // the place in the ontology: the primary relationship (solid, teal) and the additional ones (dashed, violet) kept visibly apart
    const hi = model.hierarchy;
    const place = section('Place in the ontology');
    const prim = h('div', 'dp-rel dp-rel-primary');
    prim.append(h('span', 'dp-reltag', 'Primary parent'));
    if (hi.primaryParent) prim.append(link(hi.primaryParent));
    else prim.append(h('p', 'dp-missing', hi.primaryParentMessage || 'Not placed (no hierarchy attached).'));
    prim.append(h('div', 'dp-note', hi.primaryNote));
    place.append(prim);
    if (hi.additionalParents.length) {
      const extra = h('div', 'dp-rel dp-rel-extra');
      extra.append(h('span', 'dp-reltag', `Additional parents (${hi.additionalParents.length})`));
      const list = h('div', 'dp-list'); hi.additionalParents.forEach((x) => list.append(link(x)));
      extra.append(list, h('div', 'dp-note', hi.additionalNote));
      place.append(extra);
    }
    const sub = h('div');
    if (hi.subtypesMessage) sub.append(h('p', 'dp-missing', hi.subtypesMessage));
    else {
      sub.append(h('h3', null, `Subtypes (${hi.subtypes.length.toLocaleString('en-US')} in the primary hierarchy)`));
      if (hi.subtypes.length) sub.append(longList(hi.subtypes, (x) => link(x), 'Show all'));
      else sub.append(h('p', 'dp-missing', 'All its subtypes are placed under another primary parent (see below).'));
      sub.append(listHost);                                   // the searchable member list of a list-only node
      if (hi.alsoChildren.length) {
        const also = h('div', 'dp-rel dp-rel-extra');
        also.append(h('span', 'dp-reltag', `Also listed below it (${hi.alsoChildren.length})`));
        also.append(longList(hi.alsoChildren, (x) => link(x), 'Show all'), h('div', 'dp-note', 'The ontology lists these as its subtypes too, but their primary parent is elsewhere.'));
        sub.append(also);
      }
    }
    place.append(sub);
    body.append(place);

    const cnt = section('Size');
    const row = (cls, label, c) => { const r = h('div', 'dp-count'); r.append(h('span', `dp-swatch ${cls}`), (() => { const d = h('div'); const l = h('div'); l.append(h('span', 'dp-muted', `${label}: `), h('span', 'dp-num', c.text)); d.append(l, h('div', 'dp-note', c.note)); return d; })()); return r; };
    if (model.counts.primary) cnt.append(row('primary', 'Primary hierarchy', model.counts.primary));
    cnt.append(row('extra', 'Full ontology', model.counts.dag));
    body.append(cnt);

    const idSec = section('External identifiers');
    idSec.firstChild.append(h('span', 'dp-ext', 'other resources'));
    idSec.append(h('p', 'dp-note', model.identifiers.notice));
    if (model.identifiers.missing) idSec.append(h('p', 'dp-missing', model.identifiers.message));
    else {
      const groups = model.identifiers.groups.map((g) => ({ ...g }));
      const wrap = h('div');
      const draw = (list) => { wrap.textContent = ''; for (const g of list) { const d = h('div', 'dp-idgroup'); d.append(h('b', null, `${g.source} (${g.items.length})`)); const ids = h('div', 'dp-ids'); g.items.forEach((x) => ids.append(h('span', 'dp-chip', x.id))); d.append(ids); wrap.append(d); } };
      draw(groups.slice(0, 4));
      idSec.append(wrap);
      if (groups.length > 4) { const more = h('button', 'dp-more', `Show all ${groups.length} sources`); more.type = 'button'; more.addEventListener('click', () => { draw(groups); more.remove(); }); idSec.append(more); }
    }
    if (model.alternativeIds.length) idSec.append(h('p', 'dp-note', `Alternative ontology ids of this disease: ${model.alternativeIds.join(', ')}`));
    body.append(idSec);

    body.append(section(null, h('p', 'dp-note', model.factsNotice), provenance(model.provenance)));
    layout();
  }

  // ---- selection ----------------------------------------------------------------------------------------------------------------------
  // The primary path of real ancestors from the top to `node` (navigation groups skipped). For a group: the real ancestors above it.
  function pathOf(node) {
    const chain = [];
    for (let n = node; n; n = n.parent) if (!n.isGroup && n.doid) chain.unshift({ doid: n.doid, name: n.name });
    return chain;
  }
  const entryOf = (c) => (c.isGroup ? { doid: null, nodeId: c.id, name: groupLabel(c), isGroup: true, members: c.members } : { doid: c.doid, nodeId: c.id, name: c.name, isGroup: false, hasSubtypes: c.children.length > 0 });

  const api = {
    get open() { return open; },
    get folded() { return folded; },
    get element() { return root; },
    get model() { return lastModel; },
    get memberList() { return members; },
    get text() { return root.innerText; },
    toggle() { open = !open; if (open && narrow()) folded = false; layout(); return open; },
    setOpen,
    // Show the selected node. Returns a promise that settles when the panel shows it (the ontology files load on first use).
    select(node) {
      const token = ++seq;
      deferred = false;
      current = node;
      members.update(node);                                   // needs only the tree, so it is instant
      const lp = listFor(node);
      if (lp && narrow() && folded) folded = false;           // a list-only node's members must be visible: unfold the sheet
      if (node.isGroup) {
        render(groupModel(node, pathOf(node), node.children.map(entryOf), data.loaded.metadata ? data.provenance() : null));
        idle = data.loaded.metadata ? Promise.resolve() : data.loadMetadata().then(() => { if (token === seq) api.select(node); }).catch(() => {});
        return idle;
      }
      const path = pathOf(node);
      const ready = data.loaded.metadata && data.loaded.terms && data.loaded.edges;
      if (ready) { render(diseaseModel(data.term(node.doid), path, data.provenance())); idle = Promise.resolve(); return idle; }
      if (!(open && !(narrow() && folded))) { deferred = true; render(loadingModel(node, path)); idle = Promise.resolve(); return idle; }   // folded / closed: wait
      render(loadingModel(node, path));
      idle = data.loadAll().then(() => { if (token === seq) render(diseaseModel(data.term(node.doid), path, data.provenance())); })
        .catch((err) => { if (token === seq) render(loadingModel(node, path, String(err.message || err))); });
      return idle;
    },
    whenIdle() { return idle; },
  };

  // clicks on any item of the panel focus that disease / group in the picture
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button.dp-link');
    if (!b) return;
    let node = null;
    if (b.dataset.nodeId !== undefined) node = nodeById(Number(b.dataset.nodeId));
    else if (b.dataset.doid) node = data.nodeFor(b.dataset.doid);
    if (node) onNavigate(node);
  });
  layout();
  return api;
}
