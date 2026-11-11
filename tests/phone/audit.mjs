// audit.mjs - headless phone audit of tree edges, link arcs and link following (Step 2).
//
//   node tests/phone/audit.mjs [outDir]
//
// Starts the Vite dev server, opens the viewer in Chrome with a Galaxy-S-like phone emulation (touch input, 2.625 dpr) in portrait
// 412x915 and landscape 915x412, and a desktop pass for the hover preview. Every check is recorded as PASS / FAIL in a table
// (written to <outDir>/report.md and report.json) and the process exits with 1 if anything failed.
//
//   EDGES   the edge layer is drawn alone and compared, pixel by pixel, with the CPU prediction (same maths as the shader):
//           no stray edges, no missing edges, at the root, a folder, an open file, a symbol, mid-glide, after files open/close
//   ARCS    every arc starts and ends on the right node (or its +N orb), source -> target, GPU buffers match, <= 300, merged
//   FOLLOW  tap an arc end, tap the arc itself, panel list entry, search result, minimap tap: each lands exactly (focus radius 0),
//           pushes the back stack, and Back returns; a chain of 6 follows backs out fully
//   CASES   link into a closed file, into a collapsed +N orb, a symbol past the 400-symbol cut, self links, merged duplicates

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { launch } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'screenshots', 'step2');
mkdirSync(OUT, { recursive: true });
const PORT = 5188;
const BASE = `http://localhost:${PORT}/hyperbolic-explorer/`;
const HELPERS = readFileSync(join(ROOT, 'tests', 'phone', 'page-helpers.js'), 'utf8');

const results = [];
let group = '';
function rec(name, ok, detail = '') {
  results.push({ viewport: group, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail ? '   ' + detail : ''}`);
}

// ---- dev server -------------------------------------------------------------------------------
async function startServer() {
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const proc = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE)).ok) return proc; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('dev server did not start');
}

// ---- synthetic dataset for the 400-symbol cut (the sample has no file that big) ------------------
const CUT_FILES = [];
function writeCutDataset() {
  const d = join(ROOT, 'public', 'data');
  const w = (rel, text) => { const p = join(d, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); CUT_FILES.push(p); };
  const big = Array.from({ length: 450 }, (_, i) => ({ kind: 'function', name: `f${i}`, startLine: i + 1, endLine: i + 1, signature: `function f${i}(): void` }));
  w('zz_cut/symbols/0.json', JSON.stringify({ file: 'src/big.js', lang: 'js', loc: 450, symbols: big, imports: [], calls: [] }));
  w('zz_cut/symbols/1.json', JSON.stringify({ file: 'src/small.js', lang: 'js', loc: 3, symbols: [{ kind: 'function', name: 'g', startLine: 1, endLine: 3, signature: 'function g(): void' }], imports: [], calls: [] }));
  w('zz_cut/source/0.txt', big.map((s) => `function ${s.name}() {}`).join('\n') + '\n');
  w('zz_cut/source/1.txt', 'function g() {\n  f420();\n}\n');
  // links: g -> f420 (past the cut), g -> f10 (inside the cut), f5 -> g
  w('zz_cut/links.json', JSON.stringify({ version: 1, links: [[1, 0, 0, 420, 1, 80], [1, 0, 0, 10, 1, 80], [0, 5, 1, 0, 1, 80]], names: { 0: big.map((s) => s.name), 1: ['g'] }, stats: {} }));
  w('zz_cut_tree.json', JSON.stringify({
    name: 'cut-repo', type: 'folder', size: 5000, symbolsDir: 'zz_cut/symbols', sourceDir: 'zz_cut/source', linksFile: 'zz_cut/links.json',
    children: [{ name: 'src', type: 'folder', size: 5000, children: [
      { name: 'big.js', type: 'file', size: 4000, children: [], ext: 'js', loc: 450, hasSymbols: true, id: 0 },
      { name: 'small.js', type: 'file', size: 1000, children: [], ext: 'js', loc: 3, hasSymbols: true, id: 1 },
    ] }],
  }));
}
function removeCutDataset() {
  for (const p of CUT_FILES) { try { rmSync(p, { force: true }); } catch { /* ignore */ } }
  try { rmSync(join(ROOT, 'public', 'data', 'zz_cut'), { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---- one phone viewport ----------------------------------------------------------------------------
async function runPhone(c, label, w, h) {
  group = label;
  const ev = c.ev;
  const sleep = c.sleep;
  await c.phone(w, h);
  await c.goto(`${BASE}?intro=0&adapt=0&fade=0&tree=sample_tree.json`, 6500);
  await ev(HELPERS);
  const settle = async (ms = 4500) => {
    const t0 = Date.now();
    await sleep(80);
    while (Date.now() - t0 < ms) {
      if (await ev('!__explorer.animating && !__explorer.pendingSymbol')) { await sleep(150); if (await ev('!__explorer.animating && !__explorer.pendingSymbol')) return true; }
      await sleep(60);
    }
    return false;
  };
  const jump = async (js, wait = 900) => { await ev(js); await sleep(wait); };
  const pctl = (x) => `${(x * 100).toFixed(2)} %`;

  // ===== 1. EDGES ======================================================================================
  const pick = JSON.parse(await ev(`(() => {
    const E = __explorer;
    const folder = E.nodes.find((n) => n.type === 'folder' && n.depth === 2 && n.children.some((c) => c.hasSymbols));
    const files = E.symbolFileIds.map((id) => E.nodeById(id));
    const f1 = folder.children.find((c) => c.hasSymbols);
    const f2 = files.find((f) => f !== f1 && f.parent === f1.parent) || files.find((f) => f !== f1);
    return JSON.stringify({ folder: folder.id, f1: f1.id, f2: f2.id });
  })()`));
  const edgeCheck = async (name, near = 1.4) => {
    const r = await ev('__T.edgeAudit(' + near + ')');
    rec(`edges: ${name}: no stray edges`, r.strayFraction < 0.02, `${r.edges} edges, ${r.strayPixels}/${r.litPixels} stray px (${pctl(r.strayFraction)})${r.strayCells.length && r.strayFraction >= 0.02 ? ' at ' + JSON.stringify(r.strayCells) : ''}`);
    rec(`edges: ${name}: no missing edges`, r.missingCount === 0, `${r.near} near edges checked${r.missingCount ? ', missing ' + JSON.stringify(r.missing) : ''}`);
    return r;
  };
  await edgeCheck('root');
  await jump(`__explorer.focusOn(__explorer.nodeById(${pick.folder}), false)`);
  await edgeCheck('a folder');
  await jump(`__explorer.focusOn(__explorer.nodeById(${pick.f1}), false)`, 1300);
  const open1 = await ev('__explorer.dynamicCount');
  rec('edges: file opened its galaxy (setup)', open1 > 0, `${open1} symbol nodes`);
  await edgeCheck('file open (symbols)');
  const sym = await ev(`(() => { const f = __explorer.nodeById(${pick.f1}); const s = [...f.symByIndex.values()].find((n) => n.kind !== 'block' && n.parent !== f) || [...f.symByIndex.values()][0]; return s.id; })()`);
  await jump(`__explorer.focusOn(__explorer.nodeById(${sym}), false)`, 600);
  await edgeCheck('a symbol focused');
  // mid-glide to the neighbouring file: sample while moving
  await ev(`__explorer.focusOn(__explorer.nodeById(${pick.f2}), true)`);
  await sleep(150);
  const mid = await ev('__explorer.animating');
  const rMid = await ev('__T.edgeAudit(1.4)');
  rec('edges: mid-glide (was animating: ' + mid + ')', rMid.strayFraction < 0.02 && rMid.missingCount === 0, `${pctl(rMid.strayFraction)} stray, ${rMid.missingCount} missing`);
  await settle(); await sleep(900);
  await edgeCheck('after the glide, two files open');
  // churn: visit many files so galaxies open and close, then come home
  await ev(`(async () => { const ids = __explorer.symbolFileIds.slice(40, 60); for (const id of ids) { __explorer.focusOn(__explorer.nodeById(id), false); await new Promise((r) => setTimeout(r, 120)); } })()`);
  await jump('__explorer.focusOn(__explorer.nodeById(0), false)', 1200);
  const leftOpen = await ev('JSON.stringify({ open: __explorer.openFiles.length, dyn: __explorer.dynamicCount })');
  const lo = JSON.parse(leftOpen);
  rec('edges: files closed again after leaving (no leftover galaxies)', lo.open === 0 && lo.dyn === 0, leftOpen);
  await edgeCheck('after 20 files opened and closed, back at root');

  // ===== 2. ARCS =======================================================================================
  const foci = JSON.parse(await ev(`(async () => {
    const E = __explorer, out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const fid of E.symbolFileIds.slice(0, 120)) {
      const f = E.nodeById(fid);
      E.focusOn(f, false); await wait(260);
      if (!out.file && E.arcDetails().length >= 6) out.file = [f.fileId, -2];
      if (!f.symByIndex) continue;
      for (const s of f.symByIndex.values()) {
        if (s.kind === 'block' || (out.cls && out.method && out.func)) continue;
        const slot = s.kind === 'class' ? 'cls' : s.kind === 'method' ? 'method' : s.kind === 'function' ? 'func' : null;
        if (!slot || out[slot]) continue;
        E.focusOn(s, false); await wait(80);
        if (E.arcDetails().length >= 2) out[slot] = [f.fileId, s.symIndex];
      }
      if (out.file && out.cls && out.method && out.func) break;
    }
    return JSON.stringify(out);
  })()`));
  rec('arcs: found sample foci (file, class, method, function)', foci.file && foci.cls && foci.method && foci.func, JSON.stringify(foci));
  const focusPlace = async ([fileId, sym]) => {
    await ev(`(async () => { const f = __explorer.fileNode(${fileId}); __explorer.focusOn(f, false);
      for (let i = 0; i < 40 && ${sym} >= 0 && !__explorer.symNode(${fileId}, ${sym}); i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      if (${sym} >= 0) { const s = __explorer.symNode(${fileId}, ${sym}); if (s) __explorer.focusOn(s, false); } })()`);
    await sleep(500);
  };
  const arcCheck = async (name) => {
    const r = await ev('__T.arcAudit()');
    rec(`arcs: ${name}`, r.problems.length === 0 && r.arcs > 0, `${r.arcs} arcs for ${r.links}/${r.selected} links${r.merged ? `, ${r.merged} merged` : ''}${r.problems.length ? ' PROBLEMS: ' + r.problems.slice(0, 3).join(' | ') : ''}`);
    return r;
  };
  for (const [k, p] of Object.entries(foci)) {
    if (!p) continue;
    await focusPlace(p);
    await arcCheck(`focus = ${k}`);
  }
  // a folder with Dependencies on (root and a mid-level folder)
  await ev(`__explorer.setFolderDeps(true); __explorer.focusOn(__explorer.nodeById(0), false)`); await sleep(700);
  const rootArcs = await arcCheck('focus = root folder, Dependencies on');
  rec('arcs: root folder merges many imports into thicker arcs', rootArcs.merged > 0 && rootArcs.arcs <= 300, `${rootArcs.merged} merged arcs, ${rootArcs.arcs} total`);
  await jump(`__explorer.focusOn(__explorer.nodeById(${pick.folder}), false)`, 700);
  await arcCheck('focus = a depth-2 folder, Dependencies on');
  // direction: the pulse must run source -> target (the shader draws the comet toward vT = 1, the arc's end point b)
  const dir = await ev(`(async () => { const t = await import('/hyperbolic-explorer/src/theme.js'); return JSON.stringify({ speed: t.THEME.LINK_PULSE_SPEED, dim: t.THEME.LINK_SOURCE_DIM }); })()`);
  const dj = JSON.parse(dir);
  rec('arcs: pulse runs source -> target (comet speed > 0 toward vT=1, source end dimmer)', dj.speed > 0 && dj.dim < 1, dir);
  await ev('__explorer.setFolderDeps(false)');

  // ===== 3. FOLLOWING ==================================================================================
  const landed = async (expectId, label2, depth0, start) => {
    const ok = await settle();
    const st = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusId(), r: __explorer.shownR(__explorer.focusId()), depth: __explorer.backDepth, pending: !!__explorer.pendingSymbol, anim: __explorer.animating })`));
    const e = typeof expectId === 'function' ? await expectId() : expectId;
    rec(`follow: ${label2}: lands on the target`, ok && st.focus === e && st.r < 1e-6, `focus ${st.focus} expected ${e}, radius ${st.r.toExponential(1)}`);
    rec(`follow: ${label2}: pushes the back stack`, st.depth === depth0 + 1, `depth ${depth0} -> ${st.depth}`);
    return st;
  };
  const backTo = async (label2, startFocus, depth0) => {
    const btn = await ev(`(() => { const b = [...document.querySelectorAll('#tools button')].find((x) => x.textContent.startsWith('‹') && x.style.display !== 'none'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
    if (!btn) { rec(`follow: ${label2}: Back button shown`, false); return; }
    const p = JSON.parse(btn);
    await c.tap(p.x, p.y);
    await settle();
    const st = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusId(), depth: __explorer.backDepth, r: __explorer.shownR(__explorer.focusId()) })`));
    rec(`follow: ${label2}: Back returns to the start`, st.focus === startFocus && st.depth === depth0 && st.r < 1e-6, `focus ${st.focus} expected ${startFocus}, depth ${st.depth}`);
  };

  // 3a. tap the far END of an arc (the node)
  await focusPlace(foci.file); await ev('__explorer.setLinkFilter(true, true)'); await sleep(400);
  const arcTargets = JSON.parse(await ev('JSON.stringify(__T.tappableArcs().map((t) => ({ i: t.i, x: t.x, y: t.y, far: t.far })))'));
  rec('follow: arc end taps available on screen', arcTargets.length > 0, `${arcTargets.length} tappable arcs`);
  if (arcTargets.length) {
    const t = arcTargets[0];
    const start = await ev('__explorer.focusId()');
    const depth0 = await ev('__explorer.backDepth');
    const exp = await ev(`__T.expectedTarget(__explorer.arcDetails()[${t.i}])`);
    await c.tap(t.x, t.y);
    await landed(async () => exp, 'tap the end of an arc', depth0, start);
    await backTo('tap the end of an arc', start, depth0);
  }
  // 3b. tap the arc ITSELF near its far end, for both directions: arcs that leave the focus (far end = b) and arcs that arrive at it
  //     (far end = a). Search the files for a focus where such a tap point is free of nodes and interface.
  const bodyFoci = JSON.parse(await ev(`(async () => {
    const E = __explorer, out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const fid of E.symbolFileIds.slice(0, 200)) {
      if (out.leaves !== undefined && out.arrives !== undefined) break;
      const f = E.nodeById(fid);
      E.focusOn(f, false); await wait(220);
      for (const p of __T.arcBodyPoints()) {
        if (p.farIsB && out.leaves === undefined) out.leaves = f.fileId;
        if (!p.farIsB && out.arrives === undefined) out.arrives = f.fileId;
      }
    }
    return JSON.stringify(out);
  })()`));
  for (const [dir, farIsB] of [['leaves the focus', true], ['arrives at the focus', false]]) {
    const fid = farIsB ? bodyFoci.leaves : bodyFoci.arrives;
    rec(`follow: a focus with a tappable arc body that ${dir} exists`, fid !== undefined, JSON.stringify(bodyFoci));
    if (fid === undefined) continue;
    await ev(`__explorer.focusOn(__explorer.fileNode(${fid}), false)`); await sleep(700);
    const bodies = JSON.parse(await ev('JSON.stringify(__T.arcBodyPoints().map((t) => ({ i: t.i, x: t.x, y: t.y, farIsB: t.farIsB })))'));
    const cand = bodies.find((x) => x.farIsB === farIsB);
    const start = await ev('__explorer.focusId()');
    const depth0 = await ev('__explorer.backDepth');
    const exp = await ev(`__T.expectedTarget(__explorer.arcDetails()[${cand.i}])`);
    await c.tap(cand.x, cand.y);
    await landed(async () => exp, `tap the body of an arc that ${dir}`, depth0, start);
    await backTo(`arc body (${dir})`, start, depth0);
  }
  // 3c. panel list entry
  await focusPlace(foci.file); await sleep(500);
  const tabs = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#code .cp-tabs button')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 }; }))`));
  const linkTab = tabs.find((t) => /^(Imports|Imported by|Calls|Called by)/.test(t.t));
  rec('follow: panel has link tabs', !!linkTab, tabs.map((t) => t.t).join(' | '));
  if (linkTab) {
    await c.tap(linkTab.x, linkTab.y); await sleep(300);
    const ent = JSON.parse(await ev(`(() => { const b = document.querySelector('#code .cp-list button:not(.cp-more)'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, name: b.querySelector('b').textContent, h: r.height }); })()`));
    rec('follow: panel list rows are >= 44 px tall', ent.h >= 44, `${ent.h.toFixed(0)} px`);
    const start = await ev('__explorer.focusId()');
    const depth0 = await ev('__explorer.backDepth');
    await sleep(200);
    const pos = JSON.parse(await ev(`(() => { const b = document.querySelector('#code .cp-list button:not(.cp-more)'); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
    await c.tap(pos.x, pos.y);
    await settle();
    const st = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusId(), name: __explorer.focusNode.name, r: __explorer.shownR(__explorer.focusId()), depth: __explorer.backDepth })`));
    const full = ent.name.replace(/\s+×\d+$/, '');
    const want = [full, full.split('.').pop()];
    rec('follow: panel list entry lands on the entry', want.includes(st.name) && st.r < 1e-6, `focus "${st.name}" expected "${full}", radius ${st.r.toExponential(1)}`);
    rec('follow: panel list entry pushes the back stack', st.depth === depth0 + 1, `depth ${depth0} -> ${st.depth}`);
    await backTo('panel list entry', start, depth0);
  }
  // 3d. search result (touch on the toolbar button, type, tap the first row)
  await ev('__explorer.focusOn(__explorer.nodeById(0), false)'); await sleep(600);
  {
    const sb = JSON.parse(await ev(`(() => { const b = document.querySelector('#tools button[aria-label^="Search"]'); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
    await c.tap(sb.x, sb.y); await sleep(300);
    await ev(`document.querySelector('#search input').focus()`);
    await c.send('Input.insertText', { text: 'client' }); await sleep(400);
    const exp = JSON.parse(await ev(`JSON.stringify(__explorer.search('client', 1).results[0])`));
    const row = JSON.parse(await ev(`(() => { const b = document.querySelector('#search li button'); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }); })()`));
    rec('follow: search rows are >= 40 px tall', row.h >= 40, `${row.h.toFixed(0)} px`);
    const start = await ev('__explorer.focusId()');
    const depth0 = await ev('__explorer.backDepth');
    await c.tap(row.x, row.y);
    const expId = exp.baseId >= 0 ? exp.baseId : null;
    await settle();
    const st = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusId(), r: __explorer.shownR(__explorer.focusId()), depth: __explorer.backDepth })`));
    const want = expId !== null ? expId : await ev(`(() => { const s = __explorer.symNode(${exp.fileId}, ${exp.sym}); return (s || __explorer.fileNode(${exp.fileId})).id; })()`);
    rec('follow: search result lands on the result', st.focus === want && st.r < 1e-6, `focus ${st.focus} expected ${want} (${exp.name}), radius ${st.r.toExponential(1)}`);
    rec('follow: search result pushes the back stack', st.depth === depth0 + 1, `depth ${depth0} -> ${st.depth}`);
    await backTo('search result', start, depth0);
  }
  // 3e. minimap tap
  {
    const open = await ev(`(() => { const m = document.querySelector('#map'); if (m.classList.contains('collapsed')) { const r = m.querySelector('.m-open').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); } return null; })()`);
    if (open) { const p = JSON.parse(open); await c.tap(p.x, p.y); await sleep(500); }
    const tgt = JSON.parse(await ev(`(() => { const E = __explorer; const m = E.minimap(); const f = E.nodes.find((n) => n.type === 'folder' && n.depth === 3); const p = m.pointOf(f.id); const r = m.canvas.getBoundingClientRect(); const x = p.x, y = p.y; const hit = m.pickAt(x, y); return JSON.stringify({ x: r.left + x, y: r.top + y, hit: hit.id }); })()`));
    const start = await ev('__explorer.focusId()');
    const depth0 = await ev('__explorer.backDepth');
    await c.tap(tgt.x, tgt.y);
    await landed(async () => tgt.hit, 'minimap tap', depth0, start);
    await backTo('minimap tap', start, depth0);
  }
  // 3f. chain of 6 follows by tapping arc ends (or panel entries when no arc end is tappable), then back out fully
  {
    await focusPlace(foci.file); await ev('__explorer.setLinkFilter(true, true)'); await sleep(500);
    const startFocus = await ev('__explorer.focusId()');
    const visited = [startFocus];
    // A symbol node gets a NEW id each time its file is closed and reopened (at most 6 files stay open), so places are compared by
    // what they are (file + symbol index), not by node id.
    const placeKey = () => ev("(() => { const n = __explorer.nodeById(__explorer.focusId()); return n.type === 'symbol' ? 's' + n.file.fileId + ':' + n.symIndex : 'n' + n.id; })()");
    const visitedKey = [await placeKey()];
    const trail = [];
    for (let step = 0; step < 6; step++) {
      // Wait until the arc list has stopped changing (a file that just opened rebuilds its arcs a moment after the glide ends).
      let sig = '', same = 0;
      for (let k = 0; k < 30 && same < 3; k++) {
        const now2 = await ev('__explorer.arcDetails().map((a) => a.key).join("|") + "/" + __explorer.focusId()');
        same = now2 === sig ? same + 1 : 0; sig = now2; await sleep(150);
      }
      // Where the previous step really ended (a file that was opening carries on to its symbol after the glide): this is the place
      // the Back stack holds, so it is what backing out must return to.
      if (step > 0) { visited[step] = await ev('__explorer.focusId()'); visitedKey[step] = await placeKey(); }
      const targets = JSON.parse(await ev('JSON.stringify(__T.tappableArcs().map((t) => ({ i: t.i, x: t.x, y: t.y, far: t.far })))'));
      const fresh = targets.find((t) => !visited.includes(t.far)) || targets[0];
      const before = await ev('__explorer.focusId()');
      if (fresh) {
        // The arc's link target, kept as data: a symbol of a CLOSED file does not exist as a node yet, and the file opens on the way,
        // so what the glide must end on is looked up AFTER settling.
        const tspec = await ev(`JSON.stringify(__explorer.arcDetails()[${fresh.i}].target)`).then(JSON.parse);
        // The rule being tested: an arc line within 9 px of a touch (5 px of a mouse) wins over a node, and the NEAREST arc line wins.
        // Arcs bundled onto the same line tie, so any arc within 1.5 px of the best is a fair answer. If no arc line is that close the
        // answer is the tapped node's own arc (exp).
        const accept = JSON.parse(await ev(`JSON.stringify((() => { const E = __explorer, out = [];
          const seg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
          E.arcDetails().forEach((a, i) => { if (a.role !== 'focus') return; let d = 1e9, prev = null;
            for (let k = 0; k <= 160; k++) { const p = E.arcScreenPos(i, k / 160); if (p && prev) d = Math.min(d, seg(${fresh.x}, ${fresh.y}, prev.x, prev.y, p.x, p.y)); prev = p; }
            out.push({ d, target: a.target }); });
          out.sort((p, q) => p.d - q.d); const best = out[0];
          return best && best.d <= 9 ? out.filter((o) => o.d <= best.d + 1.5).map((o) => o.target) : []; })())`));
        const nodeUnder = await ev(`__explorer.pick(${fresh.x}, ${fresh.y})`);
        await c.tap(fresh.x, fresh.y);
        await settle();
        const now = await ev('__explorer.focusId()');
        const rr = await ev('__explorer.shownR(__explorer.focusId())');
        const exp = tspec.node !== undefined ? tspec.node
          : await ev(`(() => { const E = __explorer; const s = ${tspec.sym} >= 0 ? E.symNode(${tspec.fileId}, ${tspec.sym}) : null; return (s || E.fileNode(${tspec.fileId})).id; })()`);
        // (when no arc line is near, the node under the finger is the other fair answer: an open file's symbol can sit over its own dot)
        const acceptIds = [];
        for (const sp of accept) {
          acceptIds.push(sp.node !== undefined ? sp.node : await ev(`(() => { const E = __explorer; const s = ${sp.sym} >= 0 ? E.symNode(${sp.fileId}, ${sp.sym}) : null; return (s || E.fileNode(${sp.fileId})).id; })()`));
        }
        trail.push({ step, via: 'arc', exp: acceptIds.includes(now) || (accept.length === 0 && now === nodeUnder) ? now : exp, now, rr, dbg: JSON.stringify({ accept: acceptIds, nodeUnder, tspec, x: Math.round(fresh.x), y: Math.round(fresh.y), farOfFresh: fresh.far }) });
      } else {
        // no arc end is tappable in this layout (portrait: the sheet covers half the picture): use a panel list row instead
        const tab = JSON.parse(await ev(`(() => { const b = [...document.querySelectorAll('#code .cp-tabs button')].find((x) => /^(Imports|Imported by|Calls|Called by)/.test(x.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
        if (!tab) { trail.push({ step, via: 'none', now: before, exp: -1, rr: 0 }); break; }
        await c.tap(tab.x, tab.y); await sleep(250);
        const row = JSON.parse(await ev(`(() => { const bs = [...document.querySelectorAll('#code .cp-list button:not(.cp-more)')]; const b = bs[${step} % bs.length]; b.scrollIntoView({ block: 'center' }); return JSON.stringify({ name: b.querySelector('b').textContent }); })()`));
        await sleep(150);
        const row2 = JSON.parse(await ev(`(() => { const bs = [...document.querySelectorAll('#code .cp-list button:not(.cp-more)')]; const b = bs[${step} % bs.length]; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
        await c.tap(row2.x, row2.y);
        await settle();
        const now = await ev('__explorer.focusId()');
        const nm = await ev('__explorer.focusNode.name');
        const full = row.name.replace(/\s+×\d+$/, '');
        trail.push({ step, via: 'panel', exp: [full, full.split('.').pop()].includes(nm) ? now : -1, now, rr: await ev('__explorer.shownR(__explorer.focusId())') });
      }
    }
    const allLanded = trail.every((t) => t.now === t.exp && t.rr < 1e-6);
    rec(`follow: chain of ${trail.length} follows lands exactly each time`, trail.length >= 5 && allLanded, trail.map((t) => `${t.via}:${t.now}${t.now === t.exp ? '' : '!=' + t.exp + ' ' + (t.dbg || '')}`).join(' > '));
    const depthAfter = await ev('__explorer.backDepth');
    rec('follow: back stack depth equals number of follows', depthAfter === trail.length, `${depthAfter} vs ${trail.length}`);
    // back out with the Back button, checking each stop against the way in
    let okBack = true, seq = [];
    for (let k = trail.length - 1; k >= 0; k--) {
      const bp = await ev(`(() => { const b = [...document.querySelectorAll('#tools button')].find((x) => x.textContent.startsWith('‹') && x.style.display !== 'none'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      if (!bp) { okBack = false; seq.push('no-back-button'); break; }
      const p = JSON.parse(bp);
      await c.tap(p.x, p.y); await settle();
      const f = await placeKey();
      const want = visitedKey[k];
      seq.push(f === want ? f : `${f}!=${want}`);
      if (f !== want) okBack = false;
    }
    const endState = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusId(), depth: __explorer.backDepth, r: __explorer.shownR(__explorer.focusId()) })`));
    rec('follow: backing out retraces the chain and ends at the start with an empty stack', okBack && endState.focus === startFocus && endState.depth === 0 && endState.r < 1e-6, `${seq.join(' < ')}; end ${JSON.stringify(endState)}`);
    // Backspace with nothing to go back to = parent
    const parentOfStart = await ev('__explorer.focusNode.parent ? __explorer.focusNode.parent.id : -1');
    await c.key('Backspace'); await settle();
    rec('follow: Backspace on an empty stack goes to the parent', (await ev('__explorer.focusId()')) === parentOfStart);
  }

  // ===== 4. EDGE CASES (sample data) ===================================================================
  // 4a. link into a CLOSED file (symbol of a file that is not open): glide opens it and ends exactly on the symbol
  {
    const picks = JSON.parse(await ev(`(async () => {
      const E = __explorer, out = [];
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (const fid of E.symbolFileIds.slice(0, 200)) {
        if (out.length >= 4) break;
        const f = E.nodeById(fid);
        E.focusOn(f, false); await wait(260);
        const a = E.arcDetails().find((x) => x.role === 'focus' && x.type === 1 && x.target.sym !== undefined && x.target.sym >= 0 && !E.fileNode(x.target.fileId).symState);
        if (a) out.push({ from: f.fileId, to: a.target.fileId, sym: a.target.sym });
      }
      return JSON.stringify(out);
    })()`));
    rec('cases: found links into closed files', picks.length >= 3, `${picks.length} cases`);
    for (const p of picks) {
      await ev(`__explorer.focusOn(__explorer.fileNode(${p.from}), false)`); await sleep(500);
      const start = await ev('__explorer.focusId()');
      const depth0 = await ev('__explorer.backDepth');
      const wasClosed = await ev(`!__explorer.fileNode(${p.to}).symState`);
      await ev(`__explorer.goToPlace(${p.to}, ${p.sym})`);
      await settle(6000);
      const st = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusId(), want: (__explorer.symNode(${p.to}, ${p.sym}) || {}).id, r: __explorer.shownR(__explorer.focusId()), depth: __explorer.backDepth, pend: !!__explorer.pendingSymbol })`));
      rec(`cases: closed file ${p.to} (was closed: ${wasClosed}) -> symbol ${p.sym}: lands exactly on the symbol`, st.want !== undefined && st.focus === st.want && st.r < 1e-6 && !st.pend && st.depth === depth0 + 1, JSON.stringify(st));
      await backTo(`closed file ${p.to}`, start, depth0);
    }
  }
  // 4b. link INTO a collapsed "+N" orb: follow an arc whose far end is an orb
  {
    // a file whose links lead into folders that are collapsed into +N orbs (far from the focus)
    const orbFiles = JSON.parse(await ev(`(async () => {
      const E = __explorer, out = [];
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (const fid of E.symbolFileIds.slice(0, 250)) {
        if (out.length >= 2) break;
        const f = E.nodeById(fid);
        E.focusOn(f, false); await wait(200);
        const i = E.arcDetails().findIndex((a) => a.role === 'focus' && E.nodeState(a.far) === 2);
        if (i >= 0) out.push({ fileId: f.fileId, far: E.arcDetails()[i].far, count: E.arcDetails()[i].count });
      }
      return JSON.stringify(out);
    })()`));
    rec('cases: arcs ending at a collapsed +N orb exist (from a focused file)', orbFiles.length > 0, `${orbFiles.length} found`);
    const orbArcs = orbFiles.map((o) => ({ ...o, i: 0 }));
    for (const oa of orbArcs.slice(0, 2)) {
      await ev(`__explorer.focusOn(__explorer.fileNode(${oa.fileId}), false)`); await sleep(900);
      oa.i = await ev(`__explorer.arcDetails().findIndex((a) => a.role === 'focus' && __explorer.nodeState(a.far) === 2)`);
      const start = await ev('__explorer.focusId()');
      const depth0 = await ev('__explorer.backDepth');
      const exp = await ev(`__T.expectedTarget(__explorer.arcDetails()[${oa.i}])`);
      await ev(`__explorer.followArc(${oa.i})`);
      await settle(6000);
      const st = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusId(), r: __explorer.shownR(__explorer.focusId()), depth: __explorer.backDepth, state: __explorer.nodeState(__explorer.focusId()) })`));
      rec(`cases: follow an arc into orb ${oa.far} (merges ${oa.count} links)`, st.focus === exp && st.r < 1e-6 && st.state === 0, JSON.stringify({ ...st, expected: exp }));
      rec(`cases: orb follow pushes the back stack`, st.depth === depth0 + 1);
      await backTo(`orb ${oa.far}`, start, depth0);
    }
  }
  // 4c. dropped / merged links across every audited focus were already checked in arcAudit (no a===b, no duplicate keys, counts add up)
  rec('cases: self links dropped and duplicates merged (checked on every focus above)', !results.some((r) => r.viewport === label && /^arcs:/.test(r.name) && !r.ok));
}

// ---- 400-symbol cut on the synthetic dataset -----------------------------------------------------------
async function runCut(c, label, w, h) {
  group = label + ' (400-symbol cut)';
  const ev = c.ev, sleep = c.sleep;
  await c.phone(w, h);
  await c.goto(`${BASE}?intro=0&adapt=0&fade=0&tree=zz_cut_tree.json`, 5000);
  await ev(HELPERS);
  const settle = async () => { const t0 = Date.now(); await sleep(100); while (Date.now() - t0 < 5000) { if (await ev('!__explorer.animating && !__explorer.pendingSymbol')) { await sleep(200); if (await ev('!__explorer.animating && !__explorer.pendingSymbol')) return true; } await sleep(60); } return false; };
  const nSyms = await ev('(async () => { const f = __explorer.fileNode(0); __explorer.focusOn(f, false); await new Promise((r) => setTimeout(r, 900)); return f.symByIndex ? f.symByIndex.size : -1; })()');
  rec('cut: big file opens with at most 400 symbols (+ top-level block)', nSyms > 100 && nSyms <= 401, `${nSyms} symbol nodes`);
  const has420 = await ev('!!__explorer.symNode(0, 420)');
  const has10 = await ev('!!__explorer.symNode(0, 10)');
  rec('cut: symbol 420 has no node, symbol 10 has', !has420 && has10, `420: ${has420}, 10: ${has10}`);
  await ev('__explorer.focusOn(__explorer.fileNode(1), false)'); await sleep(900);
  const arcs = JSON.parse(await ev('JSON.stringify(__explorer.arcDetails().map((a) => ({ b: a.b, t: a.target, links: a.links })))'));
  rec('cut: arcs from small.js to big.js exist', arcs.length > 0, JSON.stringify(arcs).slice(0, 700));
  const start = await ev('__explorer.focusId()');
  // follow g -> f420: the symbol has no node: must land on the FILE exactly, with nothing left pending
  await ev('__explorer.goToPlace(0, 420)');
  await settle();
  const st = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusId(), file: __explorer.fileNode(0).id, r: __explorer.shownR(__explorer.focusId()), pend: !!__explorer.pendingSymbol, depth: __explorer.backDepth })`));
  rec('cut: following a link to symbol 420 (past the cut) lands exactly on the file, nothing pending', st.focus === st.file && st.r < 1e-6 && !st.pend && st.depth === 1, JSON.stringify(st));
  await ev('__explorer.goBack()'); await settle();
  rec('cut: Back returns to small.js', (await ev('__explorer.focusId()')) === start && (await ev('__explorer.backDepth')) === 0);
  // inside the cut: lands on the symbol
  await ev('__explorer.goToPlace(0, 10)'); await settle();
  const st2 = JSON.parse(await ev(`JSON.stringify({ focus: __explorer.focusId(), want: (__explorer.symNode(0, 10) || {}).id, r: __explorer.shownR(__explorer.focusId()) })`));
  rec('cut: a link to symbol 10 (inside the cut) lands exactly on it', st2.want !== undefined && st2.focus === st2.want && st2.r < 1e-6, JSON.stringify(st2));
  // the arc from the big file's galaxy: focus big file, arc back to g exists and the audit is clean
  await ev('__explorer.focusOn(__explorer.fileNode(0), false)'); await sleep(900);
  const au = await ev('__T.arcAudit()');
  rec('cut: arc audit on the big file is clean', au.problems.length === 0, `${au.arcs} arcs ${au.problems.slice(0, 2).join(' | ')}`);
  const eg = await ev('__T.edgeAudit(1.4)');
  rec('cut: edges of the 400-symbol galaxy match the prediction', eg.strayFraction < 0.02 && eg.missingCount === 0, `${eg.edges} edges, ${(eg.strayFraction * 100).toFixed(2)} % stray, ${eg.missingCount} missing`);
}

// ---- desktop pass: hover preview with a real mouse ----------------------------------------------------------
async function runDesktop(c) {
  group = 'desktop 1000x800';
  const ev = c.ev, sleep = c.sleep;
  await c.desktop(1000, 800);
  await c.goto(`${BASE}?intro=0&adapt=0&tree=sample_tree.json`, 6000);
  await ev(HELPERS);
  // focus the folder that holds symbol files, so files are nearby; hover a file that is not the focus and has links
  const t = JSON.parse(await ev(`(async () => {
    const E = __explorer;
    const f0 = E.nodeById(E.symbolFileIds[0]);
    E.focusOn(f0.parent, false); await new Promise((r) => setTimeout(r, 700));
    for (const fid of E.symbolFileIds.slice(0, 60)) {
      const f = E.nodeById(fid);
      const p = E.screenPos(f.id);
      if (!p || !__T.tappable(p) || E.pick(p.x, p.y) !== f.id) continue;
      E.setHover(f.id); await new Promise((r) => setTimeout(r, 120)); const n = E.arcDetails().filter((a) => a.role === 'hover').length; E.setHover(null);
      if (n > 0) return JSON.stringify({ id: f.id, x: p.x, y: p.y, n });
    }
    return 'null';
  })()`));
  rec('hover: a hoverable file with links is on screen', !!t, JSON.stringify(t));
  if (t) {
    await c.mouseMove(t.x, t.y); await sleep(500);
    const au = await ev('JSON.stringify({ hover: __explorer.arcDetails().filter((a) => a.role === "hover").length, all: __explorer.arcDetails().length, audit: __T.arcAudit() })');
    const r = JSON.parse(au);
    rec('hover: real mouse hover previews the file\'s arcs (<= 300 total, audit clean)', r.hover > 0 && r.all <= 300 && r.audit.problems.length === 0, `${r.hover} hover arcs of ${r.all}${r.audit.problems.length ? ' ' + r.audit.problems[0] : ''}`);
    await c.mouseMove(5, 400); await sleep(400);
    const gone = await ev('__explorer.arcDetails().filter((a) => a.role === "hover").length');
    rec('hover: moving the mouse away removes the preview', gone === 0, `${gone} hover arcs left`);
  }
}

// ---- desktop pass 2: REAL mouse clicks on arcs, with the Back button showing ----------------------------------------------
// Regression for: "clicking an arc does nothing". Causes were (1) the toolbar wrapping to two rows when Back appeared and
// covering the arc ends, (2) arcs only pickable on their far half, (3) nodes always beating arcs.
async function runMouse(c) {
  group = 'desktop mouse 1280x800';
  const ev = c.ev, sleep = c.sleep;
  await c.desktop(1280, 800);
  await c.goto(`${BASE}?intro=0&adapt=0&fade=0&tree=sample_tree.json`, 6500);
  await ev(HELPERS);
  const FILE = await ev('__explorer.nodeById(__explorer.symbolFileIds[0]).fileId');
  const refocus = async () => { await ev(`__explorer.focusOn(__explorer.fileNode(${FILE}), false)`); await sleep(1300); };
  const layout = async () => JSON.parse(await ev(`JSON.stringify((() => {
    const bar = document.getElementById('tools'); const r = bar.getBoundingClientRect();
    const btns = [...bar.querySelectorAll('button')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => { const q = b.getBoundingClientRect(); return { t: b.title, x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height), vis: getComputedStyle(b).visibility }; });
    return { top: Math.round(r.top), height: Math.round(r.height), btns };
  })())`));

  // ---- layout: one row, and Back appearing must not move or grow anything ----
  await refocus();
  const L0 = await layout();
  rec('toolbar: one row (all buttons share one top) with no Back', new Set(L0.btns.map((b) => b.y)).size === 1 && L0.height <= 50, JSON.stringify({ top: L0.top, height: L0.height }));
  await ev('__explorer.followArc(0)'); await sleep(1300); await refocus();
  const depth = await ev('__explorer.backDepth');
  const L1 = await layout();
  const back = L1.btns.find((b) => b.t.startsWith('Return to where'));
  rec('toolbar: Back is showing (depth >= 1)', depth >= 1 && back && back.vis === 'visible', `depth ${depth}`);
  rec('toolbar: still one row with Back showing, same top and height', new Set(L1.btns.map((b) => b.y)).size === 1 && L1.top === L0.top && L1.height === L0.height, JSON.stringify({ before: [L0.top, L0.height], after: [L1.top, L1.height] }));
  const moved = L0.btns.filter((b0) => { const b1 = L1.btns.find((b) => b.t === b0.t); return !b1 || b1.x !== b0.x || b1.w !== b0.w; }).map((b) => b.t);
  rec('toolbar: Back appearing moves no other button', moved.length === 0, moved.join(','));

  // ---- the arcs must not run under the toolbar ----
  const under = JSON.parse(await ev(`JSON.stringify((() => { const E = __explorer, hits = []; E.arcDetails().forEach((a, i) => { if (a.role !== 'focus') return;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) { const p = E.arcScreenPos(i, t); if (!p) continue; const e = document.elementFromPoint(p.x, p.y); if (e && e.closest('#tools')) hits.push([i, t, Math.round(p.x), Math.round(p.y)]); } }); return hits; })())`));
  rec('toolbar: no focus-arc end or body point lies under a toolbar button (Back showing)', under.length === 0, JSON.stringify(under.slice(0, 4)));

  // ---- real mouse clicks. Expected target = the arc whose drawn line passes closest to the click (computed here, independently
  //      of main3d: dense samples of arcScreenPos). Arcs that bundle onto the same line tie: any of them is accepted. ----
  const nearest = async (x, y) => JSON.parse(await ev(`JSON.stringify((() => { const E = __explorer, out = [];
    const seg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
    E.arcDetails().forEach((a, i) => { if (a.role !== 'focus') return; let d = 1e9, prev = null;
      for (let k = 0; k <= 160; k++) { const p = E.arcScreenPos(i, k / 160); if (p && prev) d = Math.min(d, seg(${x}, ${y}, prev.x, prev.y, p.x, p.y)); prev = p; }
      out.push({ d, target: __T.expectedTarget(a) }); });
    out.sort((p, q) => p.d - q.d); const best = out[0]; return { d: best ? best.d : 1e9, accept: best ? out.filter((o) => o.d <= best.d + 1.5).map((o) => o.target) : [] }; })())`));
  const spots = JSON.parse(await ev(`JSON.stringify((() => { const E = __explorer, out = []; const fp = E.screenPos(E.focusId());
    E.arcDetails().forEach((a, i) => { if (a.role !== 'focus') return;
      for (const t of [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1]) { const p = E.arcScreenPos(i, t); if (!p) continue;
        const e = document.elementFromPoint(p.x, p.y); if (!e || e.tagName !== 'CANVAS') continue;                      // only points a click really reaches the canvas at
        if (fp && Math.hypot(p.x - fp.x, p.y - fp.y) < fp.r + 40) continue;                                           // next to the focus the click means the focus
        out.push({ arc: i, t, x: p.x, y: p.y }); } });
    return out; })())`));
  rec('mouse: arc points to click exist on screen', spots.length >= 10, `${spots.length} points`);
  // spread the clicks over arcs and over the length: every 3rd spot, at most 28
  const chosen = spots.filter((_, k) => k % 3 === 0).slice(0, 28);
  let ok = 0, skipped = 0; const bad = [];
  for (const s of chosen) {
    await refocus();
    const want = await nearest(s.x, s.y);
    if (want.d > 5) { skipped++; continue; }                                        // the arc moved (hover arcs): not a fair test point
    const start = await ev('__explorer.focusId()');
    await c.click(s.x, s.y); await sleep(1100);
    const f = await ev('__explorer.focusId()');
    if (want.accept.includes(f)) ok++;
    else bad.push(`arc ${s.arc} t=${s.t} (${Math.round(s.x)},${Math.round(s.y)}) wanted ${want.accept.join('/')} got ${f}${f === start ? ' (nothing happened)' : ''}`);
  }
  rec(`mouse: ${chosen.length} real clicks on arc ends and bodies (whole length) each follow the nearest arc, Back showing`, bad.length === 0 && ok >= 10, `${ok} ok, ${skipped} skipped${bad.length ? '; fails: ' + bad.slice(0, 3).join(' || ') : ''}`);

  // ---- an arc beats a node: a click on an arc line that is ALSO over a different node follows the arc.
  //      Look through several files for a focus whose arcs run over other nodes (away from the focus itself). ----
  const overJs = `JSON.stringify((() => { const E = __explorer; const fp = E.screenPos(E.focusId()); const out = [];
    E.arcDetails().forEach((a, i) => { if (a.role !== 'focus') return; for (const t of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) { const p = E.arcScreenPos(i, t); if (!p) continue;
      const e = document.elementFromPoint(p.x, p.y); if (!e || e.tagName !== 'CANVAS') continue;
      if (fp && Math.hypot(p.x - fp.x, p.y - fp.y) < fp.r + 40) continue;
      const n = E.pick(p.x, p.y); if (n !== null && n !== a.far) out.push({ arc: i, x: p.x, y: p.y, node: n }); } }); return out; })())`;
  let overFile = FILE, over = [];
  const fileIds = JSON.parse(await ev('JSON.stringify(__explorer.symbolFileIds.slice(0, 60).map((id) => __explorer.nodeById(id).fileId))'));
  for (const fid of fileIds) {
    await ev(`__explorer.focusOn(__explorer.fileNode(${fid}), false)`); await sleep(1100);
    over = JSON.parse(await ev(overJs));
    if (over.length > 0) { overFile = fid; break; }
  }
  rec('mouse: some focus has arc points that are also over a different node', over.length > 0, `file ${overFile}: ${over.length} points`);
  let wins = 0; const lost = [];
  for (const s of over.slice(0, 6)) {
    await ev(`__explorer.focusOn(__explorer.fileNode(${overFile}), false)`); await sleep(1100);
    const want = await nearest(s.x, s.y);
    await c.click(s.x, s.y); await sleep(1100);
    const f = await ev('__explorer.focusId()');
    if (want.accept.includes(f)) wins++; else lost.push(`over node ${s.node} wanted ${want.accept.join('/')} got ${f}`);
  }
  rec('mouse: a click on an arc line over another node follows the arc, not the node', over.length > 0 && lost.length === 0, `${wins} ok${lost.length ? '; first fail: ' + lost[0] : ''}`);

  // ---- a click right on the focus is still the focus (arcs all start there) ----
  await refocus();
  const fp = JSON.parse(await ev('JSON.stringify(__explorer.screenPos(__explorer.focusId()))'));
  const focus0 = await ev('__explorer.focusId()');
  const d0 = await ev('__explorer.backDepth');
  await c.click(fp.x, fp.y); await sleep(900);
  rec('mouse: clicking the focus itself follows no arc', (await ev('__explorer.backDepth')) === d0 && (await ev('__explorer.focusId()')) === focus0, '');
}

// ---- screenshots of 3 arcs mid-glide ----------------------------------------------------------------------------
async function runGlideShots(c) {
  group = 'shots';
  const ev = c.ev, sleep = c.sleep;
  await c.phone(412, 915);
  await c.goto(`${BASE}?intro=0&adapt=0&fade=0&tree=sample_tree.json`, 6500);
  await ev(HELPERS);
  const settle = async () => { const t0 = Date.now(); await sleep(100); while (Date.now() - t0 < 5000) { if (await ev('!__explorer.animating && !__explorer.pendingSymbol')) { await sleep(200); return; } await sleep(60); } };
  // choose a file with three arcs whose far ends are on screen and well away from the centre (so the glide is long enough to see)
  const pick = JSON.parse(await ev(`(async () => {
    const E = __explorer; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let best = null;
    for (const fid of E.symbolFileIds.slice(0, 120)) {
      const f = E.fileNode(E.nodeById(fid).fileId); E.focusOn(f, false); await wait(260);
      const cx = innerWidth / 2, cy = innerHeight * 0.4;
      const list = __T.tappableArcs().filter((t) => Math.hypot(t.x - cx, t.y - cy) > 110 && E.arcDetails()[t.i].type !== undefined);
      const seen = new Set(), idx = [];
      for (const t of list.sort((p, q) => Math.hypot(q.x - cx, q.y - cy) - Math.hypot(p.x - cx, p.y - cy))) { if (!seen.has(t.far)) { seen.add(t.far); idx.push(t.i); } if (idx.length === 3) break; }
      if (idx.length === 3) { best = { fileId: f.fileId, idx }; break; }
    }
    return JSON.stringify(best);
  })()`));
  rec('shots: found a file with three followable arcs on screen', !!pick, JSON.stringify(pick));
  if (!pick) return;
  await ev('__explorer.setGlideScale(20)');          // every glide takes 10 s, so a screenshot can catch it half way
  const times = [3000, 5000, 7000];
  for (let k = 0; k < 3; k++) {
    await ev(`__explorer.focusOn(__explorer.fileNode(${pick.fileId}), false)`); await sleep(700);
    const info = JSON.parse(await ev(`JSON.stringify(__explorer.arcDetails()[${pick.idx[k]}])`));
    await ev(`__explorer.followArc(${pick.idx[k]})`);
    await sleep(times[k]);
    const prog = await ev(`JSON.stringify({ animating: __explorer.animating, fp: __explorer.focusPoint })`);
    await c.shot(join(OUT, `glide-${k + 1}.png`));
    await ev('__explorer.setGlideScale(1)');
    await settle();
    await ev('__explorer.setGlideScale(20)');
    rec(`shots: arc ${k + 1} captured mid-glide`, JSON.parse(prog).animating, `file ${pick.fileId} arc ${pick.idx[k]} (${info.type === 1 ? 'call' : 'import'}, conf ${info.conf}) at ~${times[k]} ms of a 10 s slowed glide`);
    await ev('__explorer.setGlideScale(1)'); await ev('__explorer.goBack()'); await settle(); await ev('__explorer.setGlideScale(20)');
  }
}

// ---- main -----------------------------------------------------------------------------------------------------------
let server, c;
try {
  server = await startServer();
  writeCutDataset();
  c = await launch();
  const only = process.env.AUDIT_ONLY || '';          // e.g. AUDIT_ONLY=portrait to run just one part while debugging
  const want = (name) => !only || only.split(',').includes(name);
  if (want('portrait')) { await runPhone(c, 'portrait 412x915', 412, 915); await runCut(c, 'portrait 412x915', 412, 915); }
  if (want('landscape')) { await runPhone(c, 'landscape 915x412', 915, 412); await runCut(c, 'landscape 915x412', 915, 412); }
  if (want('desktop')) await runDesktop(c);
  if (want('mouse')) await runMouse(c);
  if (want('shots')) await runGlideShots(c);
  const errs = c.logs.filter((l) => /EXCEPTION|error/i.test(l) && !/GSUB|Failed to load resource.*zz_cut|favicon/i.test(l));
  group = 'console';
  rec('no console errors or exceptions during the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (err) {
  group = 'run';
  rec('audit ran to the end', false, String(err && err.stack || err));
} finally {
  if (c) c.close();
  removeCutDataset();
  if (server) server.kill();
}

const failed = results.filter((r) => !r.ok);
const md = ['| viewport | check | result | detail |', '|---|---|---|---|',
  ...results.map((r) => `| ${r.viewport} | ${r.name} | ${r.ok ? 'PASS' : '**FAIL**'} | ${String(r.detail).replace(/\|/g, '/').slice(0, 700)} |`),
  '', `${results.length - failed.length} / ${results.length} checks passed`].join('\n');
writeFileSync(join(OUT, 'report.md'), md);
writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length - failed.length} / ${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}`);
process.exit(failed.length ? 1 : 0);
