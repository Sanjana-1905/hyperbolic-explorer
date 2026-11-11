// parity_audit.mjs - 2D / 3D FEATURE PARITY in the real browser (step 2.3b).
//   node tests/phone/parity_audit.mjs [outDir]          (npm run test:parity)
// The same essential interactions in both viewers: selection and picking, hover, contextual labels at several zoom levels, search, zoom, drag (2D),
// Up = the REAL parent (never an alphabetical group), group and category expansion / collapse, breadcrumb, the disease panel, the toolbar, the same colours;
// on a desktop, a portrait phone, a landscape phone and a narrow window (EMULATION: this is not a physical-device test); the sample and WordNet in both.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { launch } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'screenshots', 'parity');
mkdirSync(OUT, { recursive: true });
const PORT = 5201;
const BASE = `http://localhost:${PORT}/hyperbolic-explorer/`;
let fails = 0;
const rec = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`); };
const vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }
const b = await launch();
const { ev, sleep } = b;

const PAGE = `(() => {
  const E = () => window.__explorer;
  const canvas = () => document.querySelector('canvas');
  window.__Q = {
    node: (name) => E().nodes.find((n) => n.name === name && !n.isGroup),
    sel: async (n) => { E().focusOn(n, false); if (E().panel) await E().panel.whenIdle(); },
    st: (n) => (E().nodeState ? E().nodeState(n.id) : E().state(n.id)),
    texts: () => E().labelDebug().vis.map((t) => t.slice(0, t.lastIndexOf('@'))),
    rects: () => E().labelDebug().placed.map((p) => { const i = p.lastIndexOf('@'), m = /^(-?\\d+),(-?\\d+) (\\d+)x(\\d+)$/.exec(p.slice(i + 1)); return { text: p.slice(p.indexOf(':') + 1, i), x: +m[1], y: +m[2], w: +m[3], h: +m[4] }; }),
    overlaps: () => { const r = window.__Q.rects(); let c = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (r[i].x < r[j].x + r[j].w - 1.5 && r[i].x + r[i].w > r[j].x + 1.5 && r[i].y < r[j].y + r[j].h - 1.5 && r[i].y + r[i].h > r[j].y + 1.5) c++; /* the debug text rounds to whole pixels */ return c; },
    wheel: (dy) => canvas().dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true })),
    rect: (sel) => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; },
    btn: (start) => [...document.querySelectorAll('#tools button')].find((x) => x.title.startsWith(start)),
    free: () => { const p = document.getElementById('dpanel'); const pr = p && getComputedStyle(p).display !== 'none' ? p.getBoundingClientRect() : null; const portrait = matchMedia('(orientation: portrait)').matches; const tr = window.__Q.rect('#tools'); return { right: pr && !portrait ? pr.left : innerWidth, bottom: pr && portrait ? pr.top : innerHeight, toolbarTop: tr && tr.w > tr.h ? tr.top : innerHeight, left: innerHeight <= 520 ? 110 : 40 }; },
    // a node that can be pointed at in the free part of the screen, away from the focus
    candidate: (skip) => { const e = E(), f = window.__Q.free(); for (const n of e.nodes) { if (n === e.focusNode || n.isGroup || window.__Q.st(n) !== 0 || (skip && skip(n))) continue; const p = e.screenPos(n.id); if (!p || p.x < f.left || p.x > f.right - 40 || p.y < 110 || p.y > Math.min(f.bottom, f.toolbarTop) - 60) continue; if (e.pick(p.x, p.y) === n.id) return { id: n.id, name: n.name, x: p.x, y: p.y }; } return null; },
  };
})()`;
const settle = async () => { for (let i = 0; i < 40; i++) { await sleep(100); if (!(await ev('__explorer.animating'))) break; } await sleep(900); };
const J = async (expr) => JSON.parse(await ev(`JSON.stringify(${expr})`));

const toolbars = {}, hues = {}, styles = {};
const VIEWS = {
  desktop: { w: 1280, h: 800, phone: false }, phone: { w: 412, h: 915, phone: true }, landscape: { w: 844, h: 390, phone: true }, narrow: { w: 800, h: 600, phone: false },
};

async function audit(label, mode3d, view, { full = true } = {}) {
  const V = VIEWS[view], touch = V.phone;
  await b.desktop(V.w, V.h);                          // (reset the browser's touch emulation first: after a multi-finger gesture the automation protocol can keep stale touch points)
  if (touch) await b.phone(V.w, V.h);
  b.logs.length = 0;
  await b.goto(`${BASE}?${mode3d ? '' : 'mode=2d&'}tree=disease_tree.json&intro=0&time=3${touch ? '&adapt=0' : ''}`, 7000);
  await ev(PAGE);
  const slug = label.replace(/\W+/g, '-');
  const portrait = V.h > V.w;
  if (portrait) { await ev(`document.querySelector('#dpanel .dp-head').click()`); await sleep(600); }          // unfold the bottom sheet
  await ev(`__Q.sel(__Q.node('heart disease'))`); await settle();

  // ---- the toolbar: the same essential buttons, the same look ----------------------------------------------------------------------------------------
  const tb = await J(`[...document.querySelectorAll('#tools button')].filter((x) => getComputedStyle(x).display !== 'none' && getComputedStyle(x).visibility !== 'hidden').map((x) => x.title)`);
  toolbars[label] = tb;
  const essentials = ['Search', 'Go to the top', 'Go to the parent', 'Show or hide the info card', 'How to explore'];
  rec(`${label}: the toolbar has the essential buttons (search, home, up, info, help)${mode3d ? '' : ' + zoom in / out'}`, essentials.every((e) => tb.some((t) => t.startsWith(e))) && (mode3d || (tb.some((t) => t.startsWith('Zoom in')) && tb.some((t) => t.startsWith('Zoom out')))), tb.length + ' buttons');
  if (view === 'desktop') styles[label] = await J(`(() => { const s = getComputedStyle(__Q.btn('Go to the top')); return [s.height, s.borderRadius, s.fontSize, s.backgroundColor, s.color, s.borderTopColor]; })()`);

  // ---- layout: nothing overlaps the panel, the picture stays visible ---------------------------------------------------------------------------------------
  const lay = await J(`(() => { const p = __Q.rect('#dpanel'), f = __Q.free(), hit = (a, b2) => a && b2 && a.left < b2.right && a.right > b2.left && a.top < b2.bottom && a.bottom > b2.top;
    const fp = __explorer.screenPos(__explorer.focusNode.id); return { panel: p, tools: __Q.rect('#tools'), crumbs: __Q.rect('#crumbs'), free: f, fp: { x: fp.x, y: fp.y }, w: innerWidth, h: innerHeight,
      toolsHit: hit(__Q.rect('#tools'), p), crumbsHit: hit(__Q.rect('#crumbs'), p), toolsScroll: [document.getElementById('tools').scrollWidth, document.getElementById('tools').clientWidth], overflowX: getComputedStyle(document.getElementById('tools')).overflowX, panelOpen: __explorer.panel.open }; })()`);
  rec(`${label}: toolbar and breadcrumb do not overlap the panel`, !lay.toolsHit && !lay.crumbsHit && lay.panelOpen);
  const freeFrac = portrait ? lay.free.bottom / lay.h : lay.free.right / lay.w;
  rec(`${label}: the selected disease is in the free part of the screen (${Math.round(100 * freeFrac)} % of the ${portrait ? 'height' : 'width'} is picture)`, portrait ? lay.fp.y > 40 && lay.fp.y < lay.free.bottom - 10 && freeFrac > 0.4 : lay.fp.x > 20 && lay.fp.x < lay.free.right - 10 && freeFrac > 0.4, `focus at ${Math.round(lay.fp.x)},${Math.round(lay.fp.y)}`);
  rec(`${label}: all toolbar buttons can be reached (${lay.toolsScroll[0] > lay.toolsScroll[1] ? 'the row scrolls sideways' : 'all fit'})`, lay.tools && lay.tools.left >= 0 && lay.tools.right <= lay.w + 1 && (lay.toolsScroll[0] <= lay.toolsScroll[1] || lay.overflowX === 'auto'));
  await b.shot(join(OUT, `${slug}.png`));

  // ---- labels ------------------------------------------------------------------------------------------------------------------------------------------------------------
  const lab = await J(`({ texts: __Q.texts(), n: __explorer.labelCount, overlaps: __Q.overlaps(), rects: __Q.rects(), free: __Q.free() })`);
  const underPanel = lab.rects.filter((r) => r.x + r.w > lab.free.right + 4 || r.y + r.h > lab.free.bottom + 4).length;
  rec(`${label}: labels for the selected disease, its parent and its children; at most 25; none overlapping; none under the panel`, lab.texts.includes('heart disease') && lab.texts.includes('cardiovascular system disease') && lab.n >= 3 && lab.n <= 25 && lab.overlaps === 0 && underPanel === 0, `${lab.n} labels, ${lab.overlaps} overlaps, ${underPanel} under the panel`);

  // ---- selection and picking ---------------------------------------------------------------------------------------------------------------------------------------
  const cand = await J(`__Q.candidate()`);
  rec(`${label}: a disease can be pointed at in the free part of the screen`, !!cand);
  if (cand) {
    if (touch) await b.tap(cand.x, cand.y); else await b.click(cand.x, cand.y);
    await settle();
    rec(`${label}: a real ${touch ? 'tap' : 'click'} on "${cand.name.slice(0, 28)}" selects it (focus, label, panel)`, (await ev('__explorer.focusNode.name')) === cand.name && (await J('__Q.texts()')).includes(cand.name) && (await ev(`document.querySelector('#dpanel .dp-name').textContent`)) === cand.name);
  }
  const pk = await J(`(() => { const e = __explorer, f = __Q.free(); let tried = 0, wrong = 0; for (const n of e.nodes) { if (n.isGroup && false) continue; if (__Q.st(n) === 1) continue; const p = e.screenPos(n.id); if (!p || p.x < 5 || p.x > f.right - 5 || p.y < 5 || p.y > f.bottom - 5) continue; if (++tried > 400) break; const g = e.pick(p.x, p.y); if (g === n.id) continue; const q = g === null ? null : e.screenPos(g); if (!(q && Math.hypot(q.x - p.x, q.y - p.y) <= (q.r || 0) + 12)) wrong++; } return { tried, wrong }; })()`);
  rec(`${label}: picking is consistent: ${pk.tried} visible nodes, each picks itself or the sphere covering it`, pk.tried > 30 && pk.wrong === 0, `${pk.wrong} wrong`);
  if (!touch) {                                                              // hover label (mouse only)
    const hv = await J(`__Q.candidate((n) => n === __explorer.focusNode.parent || __explorer.focusNode.children.includes(n) || n.depth < 3)`);
    if (hv) { await b.mouseMove(hv.x, hv.y); await sleep(500); rec(`${label}: hovering a disease writes its name`, (await J('__Q.texts()')).includes(hv.name)); await b.mouseMove(2, 2); }
  }

  // ---- Up = the real parent ----------------------------------------------------------------------------------------------------------------------------------------------
  const upBtn = await ev(`__Q.btn('Go to the parent') ? true : false`);
  const g = await J(`(() => { const s = __Q.node('syndrome'), grp = s.children.find((c) => c.isGroup && c.children.every((m) => !m.isGroup)); return { s: s.id, g: grp.id, m: grp.children[2].id, mName: grp.children[2].name }; })()`);
  const clickUp = async () => { await ev(`__Q.btn('Go to the parent').click()`); await settle(); };
  await ev(`__explorer.focusOn(__explorer.nodes[${g.m}], false)`); await settle();
  const open1 = await J(`({ grp: __Q.st(__explorer.nodes[${g.g}]), crumbs: document.getElementById('crumbs').textContent })`);
  rec(`${label}: a member of a group: its group is open and the breadcrumb leaves the group out`, open1.grp === 0 && open1.crumbs.includes('syndrome') && !open1.crumbs.includes(await ev(`__explorer.nodes[${g.g}].name`) + ' /') && open1.crumbs.trim().endsWith(g.mName));
  await clickUp();
  const up1 = await J(`({ focus: __explorer.focusNode.name, grp: __Q.st(__explorer.nodes[${g.g}]) })`);
  rec(`${label}: Up from a group member goes straight to the real parent "syndrome" (not the group); the group closes`, up1.focus === 'syndrome' && up1.grp === 2 && !!upBtn, `focus ${up1.focus}`);
  await ev(`__explorer.focusOn(__explorer.nodes[${g.g}], false)`); await settle(); await clickUp();
  rec(`${label}: Up from a group goes to its real parent`, (await ev('__explorer.focusNode.name')) === 'syndrome');
  await ev(`__explorer.focusOn(__explorer.nodes[0], false)`); await settle();
  rec(`${label}: at the top Up and Home are disabled`, await ev(`__Q.btn('Go to the parent').disabled && __Q.btn('Go to the top').disabled`));
  await ev(`__explorer.focusOn(__explorer.nodes[${g.m}], false)`); await settle();
  if (!touch) { await b.key('Backspace'); await settle(); rec(`${label}: Backspace does the same as Up`, (await ev('__explorer.focusNode.name')) === 'syndrome'); }
  else {                                                                      // touch: a double-tap on empty ground goes up
    await ev(`__explorer.focusOn(__explorer.nodes[${g.m}], false)`); await settle();
    const empty = await J(`(() => { const e = __explorer, f = __Q.free(); for (let y = 130; y < Math.min(f.bottom, f.toolbarTop) - 60; y += 23) for (let x = f.left; x < f.right - 40; x += 29) if (e.pick(x, y) === null) return { x, y }; return null; })()`);
    if (empty) { await b.tap(empty.x, empty.y); await sleep(90); await b.tap(empty.x, empty.y); await settle(); rec(`${label}: a double-tap goes up to the real parent`, (await ev('__explorer.focusNode.name')) === 'syndrome'); }
  }
  await ev(`__Q.btn('Go to the top').click()`); await settle();
  rec(`${label}: Home returns to the top ("disease")`, (await ev('__explorer.focusNode.name')) === 'disease');

  // ---- group and category expansion / collapse ----------------------------------------------------------------------------------------------------------------------------
  await ev(`__explorer.focusOn(__explorer.nodes[${g.s}], false)`); await settle();
  const ex = await J(`({ open: __explorer.nodes.filter((n) => n.isGroup && __Q.st(n) === 0).length, orbs: __explorer.nodes[${g.s}].children.filter((c) => __Q.st(c) === 2).length, kids: __explorer.nodes[${g.s}].children.length, cats: __explorer.orbCount })`);
  rec(`${label}: "syndrome": its ${ex.kids} groups are closed aggregates; far categories are collapsed ("+N", ${ex.cats} aggregates in view)`, ex.open === 0 && ex.orbs === ex.kids && ex.cats > 50);
  const orb = await J(`(() => { const e = __explorer, f = __Q.free(); for (const gr of e.nodes[${g.s}].children.slice().sort((a, b2) => b2.members - a.members)) { const p = e.screenPos(gr.id); if (p && p.x > f.left && p.x < f.right - 40 && p.y > 110 && p.y < Math.min(f.bottom, f.toolbarTop) - 60 && e.pick(p.x, p.y) === gr.id) return { id: gr.id, name: gr.name, members: gr.members, x: p.x, y: p.y }; } return null; })()`);
  rec(`${label}: a group orb can be pointed at`, !!orb);
  if (orb) {
    if (touch) await b.tap(orb.x, orb.y); else await b.click(orb.x, orb.y);
    await settle();
    const op = await J(`({ focus: __explorer.focusNode.id, open: __explorer.nodes.filter((n) => n.isGroup && __Q.st(n) === 0).map((n) => n.id), drawn: __explorer.nodes[${orb.id}].children.filter((c) => __Q.st(c) !== 1).length })`);
    rec(`${label}: ${touch ? 'tapping' : 'clicking'} group "${orb.name}" opens exactly that group (${op.drawn} members) and focuses it`, op.focus === orb.id && op.open.length === 1 && op.open[0] === orb.id && op.drawn === orb.members);
    await ev(`__Q.btn('Go to the parent').click()`); await settle();
    rec(`${label}: Up closes it again`, (await J(`__explorer.nodes.filter((n) => n.isGroup && __Q.st(n) === 0).length`)) === 0);
  }

  // ---- the disease panel is reachable --------------------------------------------------------------------------------------------------------------------------------------------
  const info = async () => { await ev(`__Q.btn('Show or hide the info card').click()`); await sleep(500); return ev('__explorer.panel.open'); };
  const wasOpen = await ev('__explorer.panel.open'), now = await info(), back = await info();
  rec(`${label}: the toolbar Info button closes and reopens the disease panel`, wasOpen === true && now === false && back === true);

  // ---- search ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const target = await J(`(() => { const grp = __explorer.nodes.find((n) => n.isGroup && n.members >= 20 && n.children.every((c) => !c.isGroup)); const m = grp.children[Math.floor(grp.children.length / 3)]; return { name: m.name, id: m.id, group: grp.id }; })()`);
  await ev(`__explorer.focusOn(__explorer.nodes[0], false)`); await settle();
  await ev(`__Q.btn('Search').click()`); await sleep(400);
  await ev(`(() => { const inp = document.querySelector('#search input'); inp.value = ${JSON.stringify(target.name)}; inp.dispatchEvent(new Event('input')); })()`); await sleep(500);
  await ev(`document.querySelector('#search li').firstChild.click()`); await settle();
  const sr = await J(`({ focus: __explorer.focusNode.name, grp: __Q.st(__explorer.nodes[${target.group}]), shown: __Q.st(__explorer.focusNode) })`);
  rec(`${label}: search finds "${target.name.slice(0, 30)}" inside a closed group and opens it`, sr.focus === target.name && sr.grp === 0 && sr.shown === 0);

  if (full) {
    // ---- zoom and labels at several zoom levels (wheel; 2D also the + / - buttons and pinch) --------------------------------------------------------------------------------
    if (!touch) {
      await ev(`__explorer.focusOn(__explorer.nodes[0], false)`); await settle();
      const z0 = await J(`({ texts: __Q.texts(), z: ${mode3d ? '1' : '__explorer.zoom'} })`);
      const levels = [];
      for (let step = 0; step < 3; step++) {
        await ev('__Q.wheel(-300)');
        await sleep(1500);
        const s = await J(`({ texts: __Q.texts(), n: __explorer.labelCount, overlaps: __Q.overlaps(), z: ${mode3d ? '0' : '__explorer.zoom'}, rects: __Q.rects(), free: __Q.free() })`);
        levels.push(s);
      }
      rec(`${label}: at three zoom levels: at most 25 labels, none overlapping, none under the panel, the selected disease always labelled`, levels.every((s) => s.n <= 25 && s.overlaps === 0 && s.texts.includes('disease') && s.rects.every((r) => r.x + r.w <= s.free.right + 4)), levels.map((s) => `${s.n}`).join('/') + ' labels');
      if (!mode3d) {
        rec(`${label}: wheel zoom magnifies (zoom ${levels.map((s) => s.z.toFixed(2)).join(' → ')}), up to the limit of 8`, levels[0].z > 1.05 && levels[1].z > levels[0].z && levels[2].z >= levels[1].z && levels[2].z <= 8 + 1e-9);
        const fresh = levels.flatMap((l) => l.texts).filter((t, i, a) => !z0.texts.includes(t) && a.indexOf(t) === i);
        rec(`${label}: zooming in shows more labels (${fresh.length} new ones appear over the three levels, e.g. "${(fresh[0] || '').slice(0, 28)}")`, fresh.length >= 1);
        for (let k = 0; k < 30; k++) await ev('__Q.wheel(300)');
        rec(`${label}: zooming out returns to 1x (never smaller than the whole disk)`, Math.abs((await ev('__explorer.zoom')) - 1) < 1e-9);
        await ev(`__Q.btn('Zoom in').click()`); const zi = await ev('__explorer.zoom'); await ev(`__Q.btn('Zoom in').click()`); const zi2 = await ev('__explorer.zoom');
        await ev(`__Q.btn('Zoom out').click()`);
        rec(`${label}: the + and - buttons zoom by steps, "-" is disabled at 1x`, Math.abs(zi - 1.6) < 1e-9 && Math.abs(zi2 - 2.56) < 1e-9 && Math.abs((await ev('__explorer.zoom')) - 1.6) < 1e-9);
        await ev(`__Q.btn('Go to the top').click()`); await settle();
        rec(`${label}: Home resets the zoom`, Math.abs((await ev('__explorer.zoom')) - 1) < 1e-9 && (await ev(`__Q.btn('Zoom out').disabled`)));
        // drag moves the view through the disk, not the selection
        await ev(`__Q.sel(__Q.node('heart disease'))`); await settle();
        const before = await J(`({ fp: __explorer.focusPoint, name: __explorer.focusNode.name, sp: __explorer.screenPos(__Q.node('heart disease').id) })`);
        const cx = 400, cy = 380;
        await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 });
        await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
        for (let k = 1; k <= 10; k++) await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + 15 * k, y: cy + 4 * k, button: 'left', buttons: 1 });
        await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 150, y: cy + 40, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(400);
        const after = await J(`({ fp: __explorer.focusPoint, name: __explorer.focusNode.name, sp: __explorer.screenPos(__Q.node('heart disease').id), anim: __explorer.animating })`);
        rec(`${label}: dragging moves the view (the content follows the pointer: ${Math.round(after.sp.x - before.sp.x)},${Math.round(after.sp.y - before.sp.y)} px) and does not change the selection`, after.name === before.name && Math.hypot(after.fp.x - before.fp.x, after.fp.y - before.fp.y) > 0.01 && after.sp.x - before.sp.x > 100 && !after.anim);
        const pk2 = await J(`(() => { const e = __explorer, f = __Q.free(); let tried = 0, wrong = 0; for (const n of e.nodes) { if (__Q.st(n) === 1) continue; const p = e.screenPos(n.id); if (!p || p.x < 5 || p.x > f.right - 5 || p.y < 5 || p.y > f.bottom - 5) continue; if (++tried > 400) break; const g2 = e.pick(p.x, p.y); if (g2 === n.id) continue; const q = g2 === null ? null : e.screenPos(g2); if (!(q && Math.hypot(q.x - p.x, q.y - p.y) <= (q.r || 0) + 12)) wrong++; } return { tried, wrong }; })()`);
        rec(`${label}: after dragging, picking is still exact (${pk2.tried} nodes)`, pk2.tried > 30 && pk2.wrong === 0);
        await ev(`__Q.btn('Go to the top').click()`); await settle();
      }
    } else if (!mode3d) {
      // pinch with two fingers
      await ev(`__Q.sel(__Q.node('heart disease'))`); await settle();
      const cx = V.w / 2, cy = 160;                                  // (above the toolbar, which sits at about y = 300 with the sheet open)
      await b.touch('touchStart', [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }]);
      for (let k = 1; k <= 8; k++) { await b.touch('touchMove', [{ x: cx - 40 - 12 * k, y: cy }, { x: cx + 40 + 12 * k, y: cy }]); await sleep(30); }
      await b.touch('touchEnd', []); await sleep(500);
      const z = await ev('__explorer.zoom');
      rec(`${label}: a two-finger pinch zooms in (zoom ${z.toFixed(2)}) without changing the selection`, z > 1.5 && (await ev('__explorer.focusNode.name')) === 'heart disease');
      await ev(`__Q.btn('Go to the top').click()`); await settle();
    }
  }
  rec(`${label}: no console errors`, !b.logs.some((l) => /error|exception/i.test(l)), b.logs.filter((l) => /error|exception/i.test(l)).slice(0, 2).join(' | '));
  // colours: the family hue of a fixed set of nodes
  hues[label] = await J(`(() => { const out = []; for (let i = 0; i < __explorer.nodes.length; i += 97) out.push([i, Math.round(__explorer.nodes[i].hue * 1e6) / 1e6]); return out; })()`);
}

try {
  const only = process.env.ONLY;                                         // e.g. ONLY=landscape while developing
  for (const [label, is3d, view, full] of [['3D desktop', true, 'desktop', true], ['2D desktop', false, 'desktop', true], ['3D phone', true, 'phone', true], ['2D phone', false, 'phone', true], ['3D landscape phone', true, 'landscape', false], ['2D landscape phone', false, 'landscape', false], ['3D narrow window', true, 'narrow', false], ['2D narrow window', false, 'narrow', false]])
    if (!only || only.split(',').some((x) => label.toLowerCase().includes(x.trim().toLowerCase()))) await audit(label, is3d, view, { full });

  // ---- cross-mode parity ---------------------------------------------------------------------------------------------------------------------------------------------------------
  const strip = (t) => t.filter((x) => !/^(Zoom in|Zoom out)/.test(x));
  if (!process.env.ONLY) rec('every toolbar button of 3D that makes sense in 2D is in 2D (2D adds zoom, has no link / heat / back buttons for this dataset)', ['Search', 'Go to the top', 'Go to the parent', 'Show or hide the info card', 'How to explore'].every((e) => toolbars['2D desktop'].some((t) => t.startsWith(e))) && strip(toolbars['2D desktop']).length <= toolbars['3D desktop'].length);
  if (!process.env.ONLY) rec('the 2D and 3D toolbar buttons look the same (height, radius, font, colours)', JSON.stringify(styles['2D desktop']) === JSON.stringify(styles['3D desktop']), JSON.stringify(styles['3D desktop']));
  if (!process.env.ONLY) rec('a disease has the same family colour (hue) in 2D and 3D (checked on 130 nodes)', JSON.stringify(hues['2D desktop']) === JSON.stringify(hues['3D desktop']) && hues['3D desktop'].length > 100);

  // ---- the sample and WordNet in both viewers -------------------------------------------------------------------------------------------------------------------------------------
  await b.desktop(1280, 800);
  for (const [label, url, is3d] of [['3D sample', '?tree=sample_tree.json&intro=0', true], ['2D sample', '?mode=2d&tree=sample_tree.json&intro=0', false], ['3D WordNet', '?tree=wordnet_tree.json&intro=0', true], ['2D WordNet', '?mode=2d&tree=wordnet_tree.json&intro=0', false]]) {
    b.logs.length = 0;
    await b.goto(BASE + url, 6500); await ev(PAGE); await sleep(2500);
    const r = await J(`(() => { const e = __explorer, kids = e.nodes[0].children; const p = e.screenPos(kids[0].id); return { n: e.labelCount, tools: [...document.querySelectorAll('#tools button')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.title), panel: e.panel === null, infoHidden: __Q.btn('Show or hide the info card') ? getComputedStyle(__Q.btn('Show or hide the info card')).display === 'none' : true, rootName: e.nodes[0].name, kid: kids[0].name, hasHue: Number.isFinite(e.nodes[5].hue) }; })()`);
    await ev(`__explorer.focusOn(__explorer.nodes[0].children[0], false)`); await settle();
    const up = await ev(`(async () => { __Q.btn('Go to the parent').click(); await new Promise((r) => setTimeout(r, 1200)); return __explorer.focusNode.name; })()`);
    const cand = await J(`__Q.candidate()`);
    let clicked = null;
    if (cand) { await b.click(cand.x, cand.y); await settle(); clicked = await ev('__explorer.focusNode.name'); }
    rec(`${label}: toolbar (${r.tools.length} buttons), labels (${r.n}), Up, picking and ${is3d ? 'the info card' : 'no stray panel / info button'} work; no errors`, r.n > 0 && r.tools.some((t) => t.startsWith('Search')) && r.tools.some((t) => t.startsWith('Go to the parent')) && r.panel && (is3d || r.infoHidden) && up === r.rootName && cand && clicked === cand.name && !b.logs.some((l) => /error|exception/i.test(l)), `Up -> ${up}, clicked ${clicked}`);
    if (!is3d) { await ev('__Q.wheel(-300)'); await sleep(400); rec(`${label}: zoom works`, (await ev('__explorer.zoom')) > 1); }
  }
} finally {
  await b.close(); vite.kill();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall parity browser checks passed');
process.exit(fails ? 1 : 0);
