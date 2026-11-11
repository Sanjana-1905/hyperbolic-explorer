// panel_audit.mjs - browser check of the DISEASE PANEL (src/diseasepanel.js) in the real 2D and 3D viewers, desktop and phone emulation.
//   node tests/phone/panel_audit.mjs [outDir]          (npm run test:panel)
// Real selection (clicks / taps on the picture, clicks in the panel), switching between diseases (also very fast), missing metadata, additional
// parents, groups and list-only nodes, the picture staying visible, the selected disease prominent, the context (path), 2D / 3D parity, the sample and
// WordNet unchanged, a failed load and its retry.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { launch } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'screenshots', 'panel');
mkdirSync(OUT, { recursive: true });
const PORT = 5197;
const BASE = `http://localhost:${PORT}/hyperbolic-explorer/`;
let fails = 0;
const rec = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`); };
const vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }
const b = await launch();
const { ev, sleep } = b;

const PAGE = `(() => {
  const E = () => window.__explorer;
  window.__P = {
    node: (name) => E().nodes.find((n) => n.name === name && !n.isGroup),
    sel: async (n, animate = false) => { E().focusOn(n, animate); await E().panel.whenIdle(); },
    title: () => document.querySelector('#dpanel .dp-name').textContent,
    doid: () => { const d = document.querySelector('#dpanel .dp-doid'); return d ? d.textContent : null; },
    missing: () => [...document.querySelectorAll('#dpanel .dp-missing')].map((e) => e.textContent),
    pathNames: () => [...document.querySelectorAll('#dpanel .dp-path button, #dpanel .dp-path .dp-current')].map((e) => e.firstChild.textContent),
    relExtra: () => [...document.querySelectorAll('#dpanel .dp-rel-extra')].find((e) => /^Additional parents/.test(e.querySelector('.dp-reltag').textContent)),
    fetched: () => performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).filter((n) => /^disease_(terms|edges|metadata)\\.json/.test(n)),
    rect: (sel) => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; },
    st: (n) => (E().nodeState ? E().nodeState(n.id) : E().state(n.id)),
  };
})()`;
const settle3d = async () => { for (let i = 0; i < 40; i++) { await sleep(100); if (!(await ev('__explorer.animating'))) break; } await sleep(600); };
const settle = (mode3d) => (mode3d ? settle3d() : sleep(1300));
const bad = (t) => /undefined|NaN|\[object|null/.test(t);

const parity = {};

async function audit(label, { mode3d, phone }) {
  const tapOrClick = (x, y) => (phone ? b.tap(x, y) : b.click(x, y));
  if (phone) await b.phone(412, 915); else await b.desktop(1280, 800);
  b.logs.length = 0;
  const url = `${BASE}?${mode3d ? '' : 'mode=2d&'}tree=disease_tree.json&intro=0&time=3${phone ? '&adapt=0' : ''}`;
  await b.goto(url, 6500);
  await ev(PAGE);
  const slug = label.replace(/\W+/g, '-');

  // ---- layout and lazy loading -------------------------------------------------------------------------------------------------------------
  const lay = JSON.parse(await ev(`JSON.stringify({ open: __explorer.panel.open, folded: __explorer.panel.folded, display: getComputedStyle(document.getElementById('dpanel')).display, rect: __P.rect('#dpanel'), pw: getComputedStyle(document.documentElement).getPropertyValue('--panel-w'), sh: getComputedStyle(document.documentElement).getPropertyValue('--sheet-h'), oldCard: !!document.getElementById('card'), fetched: __P.fetched(), w: innerWidth, h: innerHeight })`));
  if (!phone) {
    rec(`${label}: the panel is docked on the right (${Math.round(lay.rect.w)} px) and replaces the old info card`, lay.open && lay.display === 'flex' && Math.abs(lay.rect.w - 392) < 2 && lay.rect.right >= lay.w - 1 && lay.pw.trim() === '392px' && !lay.oldCard, `--panel-w ${lay.pw.trim()}`);
    rec(`${label}: the ontology data loads on first use (3 files, once each)`, JSON.stringify([...lay.fetched].sort()) === JSON.stringify(['disease_edges.json', 'disease_metadata.json', 'disease_terms.json']));
  } else {
    rec(`${label}: the panel is a bottom sheet, folded to a strip (${Math.round(lay.rect.h)} px) and replaces the old info card`, lay.open && lay.folded && Math.abs(lay.rect.h - 66) < 3 && lay.rect.bottom >= lay.h - 1 && lay.sh.trim() === '66px' && !lay.oldCard);
    rec(`${label}: while the sheet is folded the 5 MB ontology file is not fetched`, lay.fetched.length === 0, JSON.stringify(lay.fetched));
    await ev(`document.querySelector('#dpanel .dp-head').click()`); await sleep(1200);
    const f2 = JSON.parse(await ev(`JSON.stringify({ folded: __explorer.panel.folded, fetched: __P.fetched(), h: __P.rect('#dpanel').h })`));
    rec(`${label}: tapping the header unfolds the sheet and loads the data once`, !f2.folded && JSON.stringify([...f2.fetched].sort()) === JSON.stringify(['disease_edges.json', 'disease_metadata.json', 'disease_terms.json']) && f2.h > 300, `${Math.round(f2.h)} px tall`);
  }

  // ---- a rich disease: every section, nothing invented ------------------------------------------------------------------------------------------------
  await ev(`__P.sel(__P.node('cystic echinococcosis'))`); await settle(mode3d);
  const d = JSON.parse(await ev(`(() => { const rec = __explorer.data.term(__P.node('cystic echinococcosis').doid), root = document.getElementById('dpanel');
    const primary = root.querySelector('.dp-rel-primary'), extra = __P.relExtra();
    return JSON.stringify({ title: __P.title(), doid: __P.doid(), recDoid: rec.doid, def: root.querySelector('section p').textContent.length, recDef: rec.definition,
      defText: [...root.querySelectorAll('section')].find((s) => s.querySelector('h3') && s.querySelector('h3').textContent === 'Definition').querySelector('p').textContent,
      synHead: [...root.querySelectorAll('h3')].map((e) => e.textContent), primaryText: primary.querySelector('.dp-link').textContent, extraItems: [...extra.querySelectorAll('.dp-list .dp-link')].map((e) => e.firstChild.textContent), recExtra: rec.additionalParents.map((x) => rec.parents.find((p) => p.doid === x).name),
      primaryStyle: getComputedStyle(primary).borderLeftStyle, extraStyle: getComputedStyle(extra).borderLeftStyle, primaryColor: getComputedStyle(primary).borderLeftColor, extraColor: getComputedStyle(extra).borderLeftColor,
      extTag: !!root.querySelector('.dp-ext'), chips: root.querySelectorAll('.dp-chip').length, text: root.innerText, prov: __explorer.data.provenance() }); })()`));
  rec(`${label}: name and DOID shown; the definition is exactly the ontology's text`, d.title === 'cystic echinococcosis' && d.doid === d.recDoid && d.defText === d.recDef);
  rec(`${label}: synonyms (12), place in the ontology, size, external identifiers and provenance sections are all there`, ['Definition', 'Synonyms (12)', 'Place in the ontology', 'Size', 'External identifiers'].every((h) => d.synHead.some((x) => x.startsWith(h))));
  rec(`${label}: primary parent "heart disease" and the 5 additional parents are separate, and drawn differently (solid teal vs dashed violet)`, d.primaryText.startsWith('heart disease') && JSON.stringify(d.extraItems.slice().sort()) === JSON.stringify(d.recExtra.slice().sort()) && d.extraItems.length === 5 && d.primaryStyle === 'solid' && d.extraStyle === 'dashed' && d.primaryColor !== d.extraColor, `${d.primaryStyle}/${d.extraStyle}`);
  rec(`${label}: identifiers are marked as belonging to other resources and shown as chips, one group per source`, d.extTag && d.chips >= 3 && /belong to other resources/.test(d.text) && /does not fetch or interpret/.test(d.text));
  rec(`${label}: provenance and version on the panel (${d.prov.version}, ${d.prov.license})`, d.text.includes('Human Disease Ontology 2026-10-29') && d.text.includes('Creative Commons Zero v1.0 Universal') && d.text.includes(`downloaded ${d.prov.downloaded}`) && d.text.includes('v2026-10-29') && /not a diagnostic/.test(d.text));
  rec(`${label}: nothing like "undefined" / "null" on the panel`, !bad(d.text.replace(/\bnull\b/gi, '')) || !/undefined|NaN|\[object/.test(d.text));
  await b.shot(join(OUT, `${slug}-disease.png`));

  // ---- counts: two kinds, labelled ------------------------------------------------------------------------------------------------------------------------
  await ev(`__P.sel(__P.node('disease of metabolism'))`); await settle(mode3d);
  const c = await ev(`document.getElementById('dpanel').innerText`);
  rec(`${label}: metabolism: 57 by the primary hierarchy, 904 by the full ontology, both explained`, c.includes('57 diseases (itself included)') && c.includes('904 diseases (itself included)') && /add up to all 12,419/.test(c) && /overlap between categories/.test(c));

  // ---- missing information is said, never invented ---------------------------------------------------------------------------------------------------------
  const miss = JSON.parse(await ev(`(() => { const D = __explorer.data, real = __explorer.nodes.filter((n) => !n.isGroup);
    const pick = (f) => real.find((n) => f(D.term(n.doid))); const noDef = pick((r) => r.missing.definition), noSyn = pick((r) => r.missing.synonyms), noRef = pick((r) => r.missing.externalReferences), all3 = pick((r) => r.missing.definition && r.missing.synonyms && r.missing.externalReferences);
    return JSON.stringify({ noDef: noDef.name, noSyn: noSyn.name, noRef: noRef.name, all3: all3 && all3.name }); })()`));
  for (const [what, name, message] of [['definition', miss.noDef, 'No definition in the ontology.'], ['synonyms', miss.noSyn, 'No synonyms listed in the ontology.'], ['cross-references', miss.noRef, 'No cross-references listed in the ontology.']]) {
    await ev(`__P.sel(__explorer.nodes.find((n) => n.name === ${JSON.stringify(name)} && !n.isGroup))`);
    const r = JSON.parse(await ev(`JSON.stringify({ missing: __P.missing(), text: document.getElementById('dpanel').innerText })`));
    rec(`${label}: a disease without ${what} ("${name.slice(0, 30)}") says "${message}"`, r.missing.includes(message) && !/undefined|NaN|\[object/.test(r.text));
  }
  if (miss.all3) { await ev(`__P.sel(__explorer.nodes.find((n) => n.name === ${JSON.stringify(miss.all3)} && !n.isGroup))`); const m3 = JSON.parse(await ev(`JSON.stringify(__P.missing())`)); rec(`${label}: a disease missing all three ("${miss.all3.slice(0, 30)}") says so three times and invents nothing`, m3.filter((x) => /^No (definition|synonyms|cross-references)/.test(x)).length === 3); }
  await ev(`__P.sel(__explorer.nodes[0])`);
  const rt = JSON.parse(await ev(`JSON.stringify({ missing: __P.missing(), title: __P.title(), path: __P.pathNames() })`));
  rec(`${label}: the top ("disease") says it has no parent; its path is just itself`, rt.missing.includes('Top of the ontology: it has no parent.') && rt.path.length === 1);

  // ---- real selection on the picture, switching ------------------------------------------------------------------------------------------------------------
  await ev(`__P.sel(__P.node('heart disease'))`); await settle(mode3d);
  const cand = JSON.parse(await ev(`(() => { const E = __explorer, left = __P.rect('#dpanel'); const pl = ${phone ? 'innerWidth' : 'left.left'}, pt = ${phone ? 'left.top' : 'innerHeight'};
    for (const n of E.nodes) { if (n === E.focusNode || n.isGroup || __P.st(n) === 1) continue; const p = E.screenPos(n.id); if (!p || p.x < 30 || p.x > pl - 30 || p.y < 110 || p.y > pt - 110) continue; if (E.pick(p.x, p.y) === n.id) return JSON.stringify({ id: n.id, name: n.name, x: p.x, y: p.y }); } return 'null'; })()`));
  rec(`${label}: a disease can be pointed at in the picture next to the open panel`, !!cand);
  if (cand) {
    await tapOrClick(cand.x, cand.y); await settle(mode3d); await ev('__explorer.panel.whenIdle()');
    const s = JSON.parse(await ev(`JSON.stringify({ title: __P.title(), focus: __explorer.focusNode.name, doid: __P.doid(), fd: __explorer.focusNode.doid })`));
    rec(`${label}: a real ${phone ? 'tap' : 'click'} on "${cand.name.slice(0, 30)}" selects it and the panel shows it`, s.title === cand.name && s.focus === cand.name && s.doid === s.fd);
  }
  // switching through many diseases: the panel always shows the focused one
  const seq = JSON.parse(await ev(`(() => { let s = 77; const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; const real = __explorer.nodes.filter((n) => !n.isGroup); return JSON.stringify(Array.from({ length: 14 }, () => real[Math.floor(rnd() * real.length)].id)); })()`));
  let switchOk = true, why = '';
  for (const id of seq) {
    const r = JSON.parse(await ev(`(async () => { const n = __explorer.nodes[${id}]; await __P.sel(n); return JSON.stringify({ title: __P.title(), doid: __P.doid(), want: n.name, wantDoid: n.doid, path: __P.pathNames().at(-1), model: __explorer.panel.model.doid }); })()`));
    if (r.title !== r.want || r.doid !== r.wantDoid || r.path !== r.want || r.model !== r.wantDoid) { switchOk = false; why = JSON.stringify(r); break; }
  }
  rec(`${label}: switching between 14 random diseases always shows the focused one (name, DOID, path)`, switchOk, why);
  const race = JSON.parse(await ev(`(async () => { const A = __P.node('syndrome'), B = __P.node('physical disorder'); __explorer.focusOn(A, false); __explorer.focusOn(B, false); await __explorer.panel.whenIdle(); return JSON.stringify({ title: __P.title(), focus: __explorer.focusNode.name }); })()`));
  rec(`${label}: two selections in a row: the panel ends on the second`, race.title === 'physical disorder' && race.focus === 'physical disorder');

  // ---- relationships are clickable: primary parent, additional parents, path ----------------------------------------------------------------------------------
  await ev(`__P.sel(__P.node('cystic echinococcosis'))`);
  await ev(`document.querySelector('#dpanel .dp-rel-primary .dp-link').click()`); await sleep(400); await ev('__explorer.panel.whenIdle()');
  const up = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusNode.name, title: __P.title(), listsChild: [...document.querySelectorAll('#dpanel .dp-link')].some((e) => e.firstChild.textContent === 'cystic echinococcosis') })`));
  rec(`${label}: clicking the primary parent focuses it; the panel lists the disease among its subtypes`, up.focus === 'heart disease' && up.title === 'heart disease' && up.listsChild);
  await ev(`__P.sel(__P.node('cystic echinococcosis'))`);
  const extraName = await ev(`__P.relExtra().querySelector('.dp-link').firstChild.textContent`);
  await ev(`__P.relExtra().querySelector('.dp-link').click()`); await sleep(400); await ev('__explorer.panel.whenIdle()');
  const ex = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusNode.name, title: __P.title() })`));
  rec(`${label}: clicking an additional parent ("${extraName.slice(0, 30)}") focuses it and the panel shows it`, ex.focus === extraName && ex.title === extraName);
  const pathNames = JSON.parse(await ev(`(async () => { await __P.sel(__P.node('cystic echinococcosis')); return JSON.stringify(__P.pathNames()); })()`));
  rec(`${label}: the path shows where it sits: disease > ... > heart disease > cystic echinococcosis`, JSON.stringify(pathNames) === JSON.stringify(['disease', 'disease of anatomical entity', 'cardiovascular system disease', 'heart disease', 'cystic echinococcosis']));
  await ev(`document.querySelectorAll('#dpanel .dp-path button')[1].click()`); await sleep(400); await ev('__explorer.panel.whenIdle()');
  rec(`${label}: clicking a step of the path focuses that ancestor`, (await ev('__explorer.focusNode.name')) === 'disease of anatomical entity' && (await ev('__P.title()')) === 'disease of anatomical entity');

  // ---- a disease that has subtypes listed under it AND subtypes placed elsewhere ----------------------------------------------------------------------------------------
  const alsoName = await ev(`(() => { const D = __explorer.data; const n = __explorer.nodes.find((x) => !x.isGroup && D.term(x.doid).children.some((c) => c.primary === false) && D.term(x.doid).children.some((c) => c.primary === true)); return n.name; })()`);
  await ev(`__P.sel(__explorer.nodes.find((n) => n.name === ${JSON.stringify(alsoName)} && !n.isGroup))`);
  const al = JSON.parse(await ev(`JSON.stringify({ tags: [...document.querySelectorAll('#dpanel .dp-reltag')].map((e) => e.textContent), subs: [...document.querySelectorAll('#dpanel h3')].map((e) => e.textContent).filter((t) => /^Subtypes/.test(t)) })`));
  rec(`${label}: "${alsoName.slice(0, 30)}": subtypes of the primary hierarchy and "also listed below it" are shown apart`, al.subs.length === 1 && al.tags.some((t) => /^Also listed below it/.test(t)));

  // ---- navigation groups and list-only nodes ------------------------------------------------------------------------------------------------------------------------------
  const grp = JSON.parse(await ev(`(() => { const g = __explorer.nodes.find((n) => n.isGroup && n.children.every((c) => !c.isGroup) && n.members > 10); return JSON.stringify({ id: g.id, members: g.members, name: g.name, firstMember: g.children[0].name }); })()`));
  await ev(`__P.sel(__explorer.nodes[${grp.id}])`);
  const g = JSON.parse(await ev(`JSON.stringify({ title: __P.title(), doid: __P.doid(), text: document.getElementById('dpanel').innerText, buttons: document.querySelectorAll('#dpanel .dp-glist .dp-link').length, sub: document.querySelector('#dpanel .dp-badge') && document.querySelector('#dpanel .dp-badge').textContent })`));
  rec(`${label}: a navigation group ("${grp.name}") is shown as a group: no DOID, "not an ontology category", all ${grp.members} members listed`, g.title === grp.name && g.doid === null && g.sub === 'Navigation group' && /not an ontology category/.test(g.text) && g.buttons === grp.members);
  await ev(`document.querySelector('#dpanel .dp-glist .dp-link').click()`); await sleep(500); await ev('__explorer.panel.whenIdle()');
  rec(`${label}: clicking a member of the group focuses that disease and the panel shows it`, (await ev('__P.title()')) === grp.firstMember && (await ev('__explorer.focusNode.name')) === grp.firstMember);
  const crumbs = mode3d ? await ev(`document.getElementById('crumbs').textContent`) : '';
  const chips = JSON.parse(await ev(`JSON.stringify(__P.pathNames())`));
  rec(`${label}: the path (and the breadcrumb) of a member leave the navigation group out`, !chips.includes(grp.name) && (!mode3d || !crumbs.includes(` ${grp.name} `)) && chips.at(-1) === grp.firstMember, `path: ${chips.join(' > ').slice(0, 90)}`);

  const lo = JSON.parse(await ev(`(() => { const L = __explorer.displayInfo.listOnly[0]; return JSON.stringify({ id: L.id, name: L.name, kids: L.children.length, first: L.children[0].name }); })()`));
  await ev(`__P.sel(__explorer.nodes[${lo.id}])`); await sleep(300);
  const l = JSON.parse(await ev(`JSON.stringify({ inside: !!document.getElementById('members').closest('#dpanel'), visible: __explorer.memberList.visible, count: __explorer.memberList.count, text: document.getElementById('dpanel').innerText, folded: __explorer.panel.folded, listRect: __P.rect('#members'), panel: __P.rect('#dpanel') })`));
  rec(`${label}: the list-only node "${lo.name}": its ${lo.kids} members are a searchable list INSIDE the panel (nothing floats over the picture)`, l.inside && l.visible && l.count === lo.kids && !l.folded && l.listRect.left >= l.panel.left - 1 && l.listRect.right <= l.panel.right + 1);
  const firstInList = await ev(`document.querySelector('#members li button').textContent`);
  await ev(`document.querySelector('#members li button').click()`); await sleep(500); await ev('__explorer.panel.whenIdle()');
  rec(`${label}: choosing a member ("${firstInList.slice(0, 30)}") from that list focuses it; the list stays for the next one`, (await ev('__explorer.focusNode.name')) === firstInList && (await ev('__P.title()')) === firstInList && (await ev('__explorer.memberList.visible')));

  // ---- the picture stays visible and the selected disease prominent ---------------------------------------------------------------------------------------------------------
  await ev(`__P.sel(__P.node('cystic echinococcosis'))`); await settle(mode3d);
  const vis = JSON.parse(await ev(`(() => { const E = __explorer, p = E.screenPos(E.focusNode.id), pr = __P.rect('#dpanel'); const others = ['#crumbs', '#map', '#tools'].map((s) => [s, __P.rect(s)]).filter((x) => x[1] && x[1].w > 0);
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return JSON.stringify({ x: p.x, y: p.y, panel: pr, w: innerWidth, h: innerHeight, overlaps: others.filter((x) => hit(x[1], pr)).map((x) => x[0]) }); })()`));
  if (!phone) rec(`${label}: with the panel open the selected disease is in the free part of the screen (x ${Math.round(vis.x)} < panel ${Math.round(vis.panel.left)}), ${Math.round(100 * vis.panel.left / vis.w)}% of the width is picture`, vis.x > 20 && vis.x < vis.panel.left - 20 && vis.y > 0 && vis.y < vis.h && vis.panel.left > 0.6 * vis.w && vis.overlaps.length === 0, `overlaps: ${vis.overlaps.join(',') || 'none'}`);
  else {
    await ev(`__explorer.panel.setOpen(true)`);
    const f = await ev(`__explorer.panel.folded`);
    if (!f) await ev(`document.querySelector('#dpanel .dp-head').click()`);   // fold it
    await sleep(1500);
    const v2 = JSON.parse(await ev(`(() => { const p = __explorer.screenPos(__explorer.focusNode.id), r = __P.rect('#dpanel'); return JSON.stringify({ y: p.y, top: r.top, folded: __explorer.panel.folded }); })()`));
    rec(`${label}: with the sheet folded the selected disease is above it (y ${Math.round(v2.y)} < ${Math.round(v2.top)})`, v2.folded && v2.y < v2.top - 20);
    await ev(`document.querySelector('#dpanel .dp-head').click()`); await sleep(1800);
    const v3 = JSON.parse(await ev(`(() => { const p = __explorer.screenPos(__explorer.focusNode.id), r = __P.rect('#dpanel'); return JSON.stringify({ y: p.y, top: r.top, folded: __explorer.panel.folded }); })()`));
    rec(`${label}: with the sheet open the selected disease is still above it (y ${Math.round(v3.y)} < ${Math.round(v3.top)})`, !v3.folded && v3.y > 40 && v3.y < v3.top - 20);
  }
  if (mode3d) rec(`${label}: the selected disease is the bright centre with its name written next to it`, (await ev('__explorer.labelDebug().vis.join("|")')).includes('cystic echinococcosis'));
  else { const ring = JSON.parse(await ev(`JSON.stringify({ on: __explorer.ringVisible, at: __explorer.ringAt })`)); rec(`${label}: the selected disease is drawn larger with a white ring around it`, ring.on && Math.abs(ring.at.x) < 1e-3 && Math.abs(ring.at.y) < 1e-3 && ring.at.scale > 0); }
  await b.shot(join(OUT, `${slug}-visible.png`));

  // ---- close / reopen ------------------------------------------------------------------------------------------------------------------------------------------------------------
  if (!phone) {
    const x0 = (await ev('__explorer.screenPos(__explorer.focusNode.id)')).x;
    await ev(`document.querySelector('#dpanel .dp-close').click()`); await settle(mode3d);
    const cl = JSON.parse(await ev(`JSON.stringify({ open: __explorer.panel.open, display: getComputedStyle(document.getElementById('dpanel')).display, pw: getComputedStyle(document.documentElement).getPropertyValue('--panel-w').trim(), x: __explorer.screenPos(__explorer.focusNode.id).x, launcher: ${mode3d ? 'false' : `getComputedStyle(document.getElementById('dpanelOpen')).display !== 'none'`} })`));
    rec(`${label}: the close button hides the panel, frees the width (--panel-w ${cl.pw}) and re-centres the picture (x ${Math.round(x0)} -> ${Math.round(cl.x)})`, !cl.open && cl.display === 'none' && cl.pw === '0px' && cl.x > x0 + 100 && (mode3d || cl.launcher));
    if (mode3d) await ev(`[...document.querySelectorAll('#tools button')].find((x) => x.title === 'Show or hide the info card').click()`);
    else await ev(`document.getElementById('dpanelOpen').click()`);
    await settle(mode3d);
    rec(`${label}: the ${mode3d ? 'toolbar Info button' : 'round info button'} reopens it, still showing the selected disease`, (await ev('__explorer.panel.open')) && (await ev('__P.title()')) === 'cystic echinococcosis');
  }
  rec(`${label}: no console errors`, !b.logs.some((l2) => /error|exception/i.test(l2)), b.logs.filter((l2) => /error|exception/i.test(l2)).slice(0, 2).join(' | '));

  // ---- text for the 2D / 3D parity comparison ----------------------------------------------------------------------------------------------------------------------------
  if (!phone) {
    const names = ['disease', 'disease of metabolism', 'cystic echinococcosis', 'heart disease', 'syndrome', 'retinitis pigmentosa', 'tetraamelia syndrome', 'solid pattern testicular yolk sac tumor'];
    const texts = [];
    for (const nm of names) texts.push(await ev(`(async () => { const n = __P.node(${JSON.stringify(nm)}); await __P.sel(n); return document.getElementById('dpanel').innerText; })()`));
    parity[label] = texts;
  }
}

try {
  await audit('3D desktop', { mode3d: true, phone: false });
  await audit('2D desktop', { mode3d: false, phone: false });
  await audit('3D phone', { mode3d: true, phone: true });
  await audit('2D phone', { mode3d: false, phone: true });
  rec('2D and 3D show exactly the same panel text for 8 diseases (top, category, leaf, multi-parent, group parent, list-only member)', JSON.stringify(parity['3D desktop']) === JSON.stringify(parity['2D desktop']) && parity['3D desktop'].length === 8 && parity['3D desktop'].every((t) => t.length > 200));

  // ---- a failed load: the error is said, the name stays, retry works ----------------------------------------------------------------------------------------------------
  await b.phone(412, 915); b.logs.length = 0;
  await b.goto(`${BASE}?tree=disease_tree.json&intro=0&adapt=0`, 5000);
  await ev(PAGE);
  await ev(`(() => { window.__realFetch = window.fetch; window.fetch = (u, ...r) => (String(u).includes('disease_terms') ? Promise.resolve(new Response('no', { status: 503 })) : window.__realFetch(u, ...r)); })()`);
  await ev(`document.querySelector('#dpanel .dp-head').click()`); await sleep(1500);
  const er = JSON.parse(await ev(`JSON.stringify({ text: document.getElementById('dpanel').innerText, title: __P.title(), retry: !!document.querySelector('#dpanel button.dp-link') })`));
  rec('a failed load shows "could not be loaded (...)", keeps the name, offers "Try again"', /could not be loaded/.test(er.text) && /Only the name and position are shown/.test(er.text) && er.retry && er.title === 'disease');
  await ev(`window.fetch = window.__realFetch; document.querySelector('#dpanel button.dp-link').click()`); await sleep(1500);
  rec('"Try again" loads the data and shows the disease', (await ev('__P.missing().length >= 0')) && /Definition/.test(await ev(`document.getElementById('dpanel').innerText`)) && !/could not be loaded/.test(await ev(`document.getElementById('dpanel').innerText`)));

  // ---- the sample and WordNet keep their own info card ---------------------------------------------------------------------------------------------------------------------
  await b.desktop(1280, 800);
  for (const [label, url, is3d] of [['3D sample', '?tree=sample_tree.json&intro=0', true], ['2D sample', '?mode=2d&tree=sample_tree.json', false], ['3D WordNet', '?tree=wordnet_tree.json&intro=0', true], ['2D WordNet', '?mode=2d&tree=wordnet_tree.json', false]]) {
    b.logs.length = 0;
    await b.goto(BASE + url, 5000);
    const r = JSON.parse(await ev(`JSON.stringify({ panel: __explorer.panel === null, el: !!document.getElementById('dpanel'), card: !!document.getElementById('card'), cardOpen: document.getElementById('card') && document.getElementById('card').classList.contains('open'), pw: getComputedStyle(document.documentElement).getPropertyValue('--panel-w').trim() })`));
    rec(`${label}: no disease panel; ${is3d ? 'the info card is still there' : 'unchanged'}; no errors`, r.panel && !r.el && (!is3d || r.card) && !b.logs.some((l2) => /error|exception/i.test(l2)));
  }
  rec('?panel=0 gives the disease dataset the old info card back (3D)', await (async () => { b.logs.length = 0; await b.goto(`${BASE}?tree=disease_tree.json&intro=0&panel=0`, 5000); return (await ev('__explorer.panel === null')) && (await ev('!!document.getElementById("card")')) && !b.logs.some((l2) => /error|exception/i.test(l2)); })());
} finally {
  await b.close(); vite.kill();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall disease panel browser checks passed');
process.exit(fails ? 1 : 0);
