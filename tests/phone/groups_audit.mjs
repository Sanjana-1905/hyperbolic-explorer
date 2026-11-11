// groups_audit.mjs - browser check of the navigation groups, the display caps and the list-only member list, in the real viewers (3D and 2D).
//   node tests/phone/groups_audit.mjs [outDir]          (npm run test:groups)
// Starts the Vite dev server and opens the full Disease Ontology in headless Chrome:
//   3D desktop (cap 36): groups closed at the root, labelled orbs, a REAL mouse click opens exactly one group, a member can be clicked, Up closes the
//        group again, search jumps to a member inside a closed group, the 3 list-only nodes (orb, member list, filter, every member selectable),
//        never more than 36 siblings drawn, 150 random diseases reachable.
//   2D desktop: the same on the 2D viewer (it has no labels, so that part is 3D only).
//   3D and 2D on a phone emulation (touch, 412x915): cap 24, taps instead of clicks, never more than 24 siblings.
//   ?cap=N override.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { launch } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'screenshots', 'groups');
mkdirSync(OUT, { recursive: true });
const PORT = 5194;
const BASE = `http://localhost:${PORT}/hyperbolic-explorer/`;
let fails = 0;
const rec = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`); };

const vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }
const b = await launch();
const { ev, sleep } = b;

// ---- page helpers (run inside the page) ---------------------------------------------------------------------------------------------
const PAGE = `(() => {
  const E = () => window.__explorer;
  window.__G = {
    node: (name) => E().nodes.find((n) => n.name === name && !n.isGroup),
    st: (n) => (E().nodeState ? E().nodeState(n.id) : E().state(n.id)),
    // the most siblings drawn at once under any drawn parent
    widest: () => { let w = 0; for (const n of E().nodes) { if (window.__G.st(n) !== 0) continue; const c = n.children.filter((k) => window.__G.st(k) !== 1).length; if (c > w) w = c; } return w; },
    openGroups: () => E().nodes.filter((n) => n.isGroup && window.__G.st(n) === 0).map((n) => n.id),
    focusName: () => E().focusNode.name,
    focusId: () => E().focusId(),
  };
})()`;
const settle3d = async () => { for (let i = 0; i < 40; i++) { await sleep(100); if (!(await ev('__explorer.animating'))) break; } await sleep(350); };
const settle2d = async () => { await sleep(900); };

async function modeAudit(label, { mode3d, phone }) {
  const tapOrClick = (x, y) => (phone ? b.tap(x, y) : b.click(x, y));
  const settle = mode3d ? settle3d : settle2d;
  const url = `${BASE}?${mode3d ? '' : 'mode=2d&'}tree=disease_tree.json&intro=0&time=3&panel=0${phone ? '&adapt=0' : ''}`;
  if (phone) await b.phone(412, 915); else await b.desktop(1280, 800);
  b.logs.length = 0;
  await b.goto(url, 6000);
  await ev(PAGE);
  const capWanted = phone ? 24 : 36;
  const info = JSON.parse(await ev(`JSON.stringify({ cap: __explorer.displayInfo.cap, groups: __explorer.displayInfo.groups, real: __explorer.displayInfo.realCount, nodes: __explorer.nodes.length,
    listOnly: __explorer.displayInfo.listOnly.map((n) => ({ id: n.id, name: n.name, kids: n.children.length })) })`));
  rec(`${label}: display tree loaded (cap ${capWanted}), all 12,419 diseases present`, info.cap === capWanted && info.real === 12419 && info.nodes === 12419 + info.groups, `${info.nodes} display nodes = 12419 + ${info.groups} groups, ${info.listOnly.length} list-only`);
  rec(`${label}: group count as designed`, phone ? info.groups === 226 && info.listOnly.length === 5 : info.groups === 165 && info.listOnly.length === 3, `${info.groups} groups`);

  // root: every group closed, no member of a group drawn
  const root = JSON.parse(await ev(`JSON.stringify({ open: __G.openGroups().length, membersDrawn: __explorer.nodes.filter((n) => n.parent && n.parent.isGroup && __G.st(n) !== 1).length,
    drawn: __explorer.visibleCount, widest: __G.widest() })`));
  rec(`${label}: at the root no group is open and no group member is drawn`, root.open === 0 && root.membersDrawn === 0, `${root.drawn} nodes drawn, widest sibling list ${root.widest}`);
  rec(`${label}: never more than ${capWanted} siblings drawn under one parent (root)`, root.widest <= capWanted);

  // syndrome: its 486 children are shown as groups (orbs)
  const syn = JSON.parse(await ev(`(() => { const s = __G.node('syndrome'); __explorer.focusOn(s, false); return JSON.stringify({ id: s.id, kids: s.children.length, groups: s.children.filter((c) => c.isGroup).length }); })()`));
  await settle();
  const view = JSON.parse(await ev(`JSON.stringify({ orbs: __explorer.orbIds().length, open: __G.openGroups().length, widest: __G.widest(), childState: [...new Set(__explorer.nodes[${syn.id}].children.map((c) => __G.st(c)))] })`));
  rec(`${label}: "syndrome" (486 children) shows ${syn.kids} groups as aggregate orbs, none open`, syn.kids === syn.groups && syn.kids <= capWanted && view.open === 0 && view.childState.join() === '2', `${syn.kids} orbs`);
  rec(`${label}: widest sibling list drawn while focused on "syndrome" is <= ${capWanted}`, view.widest <= capWanted, `widest ${view.widest}`);
  if (mode3d) {
    const lab = await ev('__explorer.labelDebug().vis.join("|")');
    const groupLabels = lab.split('|').filter((t) => /·\s*\d+@/.test(t));
    const expected = JSON.parse(await ev(`JSON.stringify(__explorer.nodes.filter((g) => g.isGroup).map((g) => g.name + ' · ' + g.members + (g.kind === 'subtypes' ? ' with subtypes' : g.kind === 'groups' ? ' groups' : '')))`));   // any group in view (other wide parents have orbs too)
    const shown = groupLabels.filter((t) => expected.includes(t.replace(/@.*$/, '')));
    rec(`${label}: orbs carry their alphabetical label and member count (e.g. "${(shown[0] || '').replace(/@.*$/, '')}")`, shown.length >= 5 && shown.length === groupLabels.length && (await ev('__explorer.labelCount')) <= 25, `${shown.length} group labels visible of ${expected.length}, labels total ${await ev('__explorer.labelCount')} <= 25`);
  }
  await b.shot(join(OUT, `${label.replace(/\W+/g, '-')}-syndrome-closed.png`));

  // REAL click / tap on an orb: that group opens (and only that one); its members are drawn, at most cap
  const orb = JSON.parse(await ev(`(() => { const E = __explorer; for (const g of E.nodes[${syn.id}].children.slice().sort((a, b) => b.members - a.members)) { const p = E.screenPos(g.id); if (p && p.x > 40 && p.y > 90 && p.x < innerWidth - 40 && p.y < innerHeight - 140 && E.pick(p.x, p.y) === g.id) return JSON.stringify({ id: g.id, name: g.name, members: g.members, x: p.x, y: p.y }); } return 'null'; })()`));
  rec(`${label}: an orb can be pointed at`, !!orb);
  if (orb) {
    await tapOrClick(orb.x, orb.y); await settle();
    const after = JSON.parse(await ev(`JSON.stringify({ focus: __G.focusId(), open: __G.openGroups(), drawn: __explorer.nodes[${orb.id}].children.filter((m) => __G.st(m) !== 1).length, widest: __G.widest(), others: __explorer.nodes[${syn.id}].children.filter((g) => g.id !== ${orb.id} && __G.st(g) === 2).length })`));
    rec(`${label}: ${phone ? 'tap' : 'click'} on group "${orb.name}" focuses it and opens exactly that group, ${after.drawn} members drawn`, after.focus === orb.id && after.open.length === 1 && after.open[0] === orb.id && after.drawn === orb.members && after.drawn <= capWanted && after.widest <= capWanted, `others still closed: ${after.others}`);
    await b.shot(join(OUT, `${label.replace(/\W+/g, '-')}-group-open.png`));
    // a member is selectable by pointing at it
    const mem = JSON.parse(await ev(`(() => { const E = __explorer; for (const m of E.nodes[${orb.id}].children) { const p = E.screenPos(m.id); if (p && p.x > 20 && p.y > 20 && p.x < innerWidth - 20 && p.y < innerHeight - 20 && E.pick(p.x, p.y) === m.id) return JSON.stringify({ id: m.id, name: m.name, x: p.x, y: p.y }); } return 'null'; })()`));
    rec(`${label}: a member of the open group can be pointed at`, !!mem);
    if (mem) {
      await tapOrClick(mem.x, mem.y); await settle();
      const f = JSON.parse(await ev(`JSON.stringify({ focus: __G.focusId(), groupOpen: __G.st(__explorer.nodes[${orb.id}]), centred: ${mode3d ? `__explorer.shownR(${mem.id})` : '0'} })`));
      rec(`${label}: clicking the member "${mem.name}" focuses it (its group stays open)`, f.focus === mem.id && f.groupOpen === 0 && f.centred < 1e-6);
      // Up twice: member -> group -> syndrome, and the group closes again
      const upBtn = mode3d || true ? await ev(`[...document.querySelectorAll('#tools button')].findIndex((x) => x.title.startsWith('Go to the parent'))`) : -1;
      { if (mode3d) await ev(`document.querySelectorAll('#tools button')[${upBtn}].click()`); else await b.key('Backspace'); await settle(); }   // ONE Up: member -> its real parent (the group is skipped)
      const up = JSON.parse(await ev(`JSON.stringify({ focus: __G.focusId(), groupState: __G.st(__explorer.nodes[${orb.id}]), open: __G.openGroups().length })`));
      rec(`${label}: one Up from the member goes straight to "syndrome" (the real parent, not the group) and the group closes`, up.focus === syn.id && up.groupState === 2 && up.open === 0, `group state ${up.groupState}`);
    }
  }

  // list-only nodes: aggregate, member list, filter, every member selectable
  for (const L of info.listOnly) {
    await ev(`__explorer.focusOn(__explorer.nodes[0], false)`); await settle();
    await ev(`__explorer.focusOn(__explorer.nodes[${L.id}], false)`); await settle();
    const s = JSON.parse(await ev(`(() => { const L = __explorer.nodes[${L.id}], ml = __explorer.memberList; return JSON.stringify({ own: __G.st(L), kidsHidden: L.children.every((c) => __G.st(c) === 1), vis: ml.visible, count: ml.count, name: ml.ownerName, first: L.children[0].name }); })()`));
    rec(`${label}: list-only "${L.name}" focused: drawn as itself, its ${L.kids} children not drawn, member list shows ${s.count}`, s.own === 0 && s.kidsHidden && s.vis && s.count === L.kids && s.name === L.name);
    // filter
    const filt = JSON.parse(await ev(`(() => { const inp = document.querySelector('#members input'); inp.value = ${JSON.stringify('')}; inp.value = __explorer.nodes[${L.id}].children[0].name.slice(0, 4); inp.dispatchEvent(new Event('input')); const n = __explorer.memberList.count; inp.value = 'zzzzqq'; inp.dispatchEvent(new Event('input')); const none = __explorer.memberList.count; inp.value = ''; inp.dispatchEvent(new Event('input')); return JSON.stringify({ n, none, back: __explorer.memberList.count }); })()`));
    rec(`${label}: member list of "${L.name}" is searchable (filter narrows it, clearing restores it)`, filt.n >= 1 && filt.n <= L.kids && filt.none === 0 && filt.back === L.kids, `${filt.n} match, ${filt.none} for nonsense, ${filt.back} restored`);
    // every member selectable from the list
    let ok = true, why = '';
    for (let i = 0; i < L.kids; i++) {
      await ev(`document.querySelectorAll('#members li button')[${i}].click()`); await sleep(mode3d ? 120 : 80);
      const r = JSON.parse(await ev(`(() => { const L = __explorer.nodes[${L.id}], f = __explorer.focusNode; return JSON.stringify({ ok: L.children.includes(f) || f.parent === L, drawn: __G.st(f), sib: L.children.filter((c) => c !== f && __G.st(c) !== 1).length, list: __explorer.memberList.visible, cur: !!document.querySelector('#members button.current') }); })()`));
      if (!r.ok || r.drawn !== 0 || r.sib !== 0 || !r.list) { ok = false; why = JSON.stringify(r); break; }
    }
    rec(`${label}: all ${L.kids} members of "${L.name}" can be focused from the list (focused member drawn, its siblings not, list stays)`, ok, why);
    if (L === info.listOnly[0]) await b.shot(join(OUT, `${label.replace(/\W+/g, '-')}-list-only.png`));
  }

  // search jumps into a closed group (3D has the search box)
  if (mode3d) {
    await ev(`__explorer.focusOn(__explorer.nodes[0], false)`); await settle();
    const target = JSON.parse(await ev(`(() => { const g = __explorer.nodes.find((n) => n.isGroup && n.members >= 20 && n.children.every((c) => !c.isGroup)); const m = g.children[Math.floor(g.children.length / 2)]; return JSON.stringify({ id: m.id, name: m.name, group: g.id }); })()`));
    await ev(`document.querySelector('#tools button').click()`); await sleep(300);          // the Search button is the first one
    await ev(`(() => { const inp = document.querySelector('#search input'); inp.value = ${JSON.stringify(target.name)}; inp.dispatchEvent(new Event('input')); })()`); await sleep(400);
    const results = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#search li')].map((li) => li.textContent.slice(0, 60)))`));
    await ev(`document.querySelector('#search li').firstChild.click()`); await settle();
    const j = JSON.parse(await ev(`(() => { const n = __explorer.focusNode, g = __explorer.nodes[${target.group}]; return JSON.stringify({ name: n.name, groupOpen: __G.st(g), shown: __G.st(n), inGroup: n.parent === g || __explorer.nodes.some((x) => x === n && g.children.includes(x)) }); })()`));
    rec(`${label}: searching "${target.name.slice(0, 40)}" (inside a closed group) jumps to it and opens only its group`, results.length >= 1 && j.name === target.name && j.shown === 0 && j.groupOpen === 0, `${results.length} results, group state ${j.groupOpen}`);
  }

  // reachability in the viewer: 150 random display nodes, each focusable, and drawn with its whole path
  let unreachable = 0, sample = 0;
  const ids = JSON.parse(await ev(`(() => { let s = 12345; const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; const out = []; for (let i = 0; i < 150; i++) out.push(Math.floor(rnd() * __explorer.nodes.length)); return JSON.stringify(out); })()`));
  let maxWide = 0;
  for (const id of ids) {
    await ev(`__explorer.focusOn(__explorer.nodes[${id}], false)`); await sleep(mode3d ? 70 : 40); sample++;
    const r = JSON.parse(await ev(`(() => { const n = __explorer.nodes[${id}]; let bad = __G.st(n) === 1; for (let a = n.parent; a; a = a.parent) if (__G.st(a) === 1) bad = true; return JSON.stringify({ bad, wide: __G.widest() }); })()`));
    if (r.bad) unreachable++; maxWide = Math.max(maxWide, r.wide);
  }
  rec(`${label}: ${sample} random diseases/groups all reachable by focusing (drawn with their whole path)`, unreachable === 0, `${unreachable} unreachable`);
  rec(`${label}: at no focus more than ${capWanted} siblings drawn under one parent`, maxWide <= capWanted, `widest seen ${maxWide}`);
  rec(`${label}: no console errors`, !b.logs.some((l) => /error|exception/i.test(l)), b.logs.filter((l) => /error|exception/i.test(l)).slice(0, 2).join(' | '));
}

try {
  await modeAudit('3D desktop', { mode3d: true, phone: false });
  await modeAudit('2D desktop', { mode3d: false, phone: false });
  await modeAudit('3D phone', { mode3d: true, phone: true });
  await modeAudit('2D phone', { mode3d: false, phone: true });
  // ?cap=N override
  await b.desktop(1280, 800);
  await b.goto(`${BASE}?tree=disease_tree.json&intro=0&cap=24&panel=0`, 5000);
  rec('?cap=24 overrides the desktop cap', (await ev('__explorer.displayInfo.cap')) === 24 && (await ev('Math.max(...__explorer.nodes.map((n) => n.children.length))')) <= 24);
} finally {
  await b.close(); vite.kill();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall group browser checks passed');
process.exit(fails ? 1 : 0);
