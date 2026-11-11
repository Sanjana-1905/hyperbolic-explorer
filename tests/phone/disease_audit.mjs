// disease_audit.mjs - browser check that the depth-tapered layout is used CONSISTENTLY by drawing, picking and navigation (3D and 2D).
//   node tests/phone/disease_audit.mjs [outDir]
// Starts the Vite dev server and opens the full Disease Ontology (?tree=disease_tree.json) in headless Chrome, desktop 1280x800.
// 3D: layout numbers read from the live nodes, CPU-vs-GPU positions, edges drawn = edges predicted, picking returns the node you
//     point at (focus, children, siblings, parent) at shallow AND maximum depth, a real mouse click on a depth-12 node focuses it exactly,
//     12 clicks on Up walk the chain from the deepest node to the root.
// 2D: same layout numbers, real mouse clicks on shallow and deep nodes refocus them exactly.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { launch } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'screenshots', 'disease');
mkdirSync(OUT, { recursive: true });
const PORT = 5192;
const BASE = `http://localhost:${PORT}/hyperbolic-explorer/`;
const HELPERS = readFileSync(join(ROOT, 'tests', 'phone', 'page-helpers.js'), 'utf8');
let fails = 0;
const rec = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`); };

const vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }
const b = await launch();
const { ev, sleep } = b;
try {
  await b.desktop(1280, 800);

  // =============================== 3D ===============================================================
  await b.goto(`${BASE}?tree=disease_tree.json&intro=0&time=3`, 5000);
  await ev(HELPERS);
  rec('3D: disease tree loaded, no code capabilities', await ev('__explorer.nodes.length') === 12419 && await ev('Object.values(__explorer.capabilities).slice(0, 4).every((v) => v === false)'), `${await ev('__explorer.nodes.length')} nodes`);
  const lay = await ev(`(() => { const E = __explorer;
    const dist = (u, v) => { const d2 = (u.x - v.x) ** 2 + (u.y - v.y) ** 2 + (u.z - v.z) ** 2; return Math.acosh(1 + 2 * d2 / ((1 - (u.x ** 2 + u.y ** 2 + u.z ** 2)) * (1 - (v.x ** 2 + v.y ** 2 + v.z ** 2)))); };
    let maxR = 0, bad = 0, maxD = 0, short = 0;
    for (const n of E.nodes) { maxR = Math.max(maxR, Math.hypot(n.pos.x, n.pos.y, n.pos.z)); maxD = Math.max(maxD, n.depth);
      if (n.parent) { if (Math.abs(dist(n.parent.pos, n.pos) - n.edgeLength) > 1e-6) bad++; if (n.edgeLength < 0.7 - 1e-9) short++; } }
    return { maxR, bad, maxD, short }; })()`);
  rec('3D: max radius below 0.995', lay.maxR < 0.995, `max ${lay.maxR.toFixed(5)}, depth ${lay.maxD}`);
  rec('3D: no edge shortened by the clamp (live nodes)', lay.bad === 0, `${lay.bad} bad, ${lay.short} edges on the tapered levels`);
  const gpu = await ev('__explorer.gpuCheck(2048, 0.994)');
  rec('3D: GPU positions match the CPU maths out to radius 0.994', gpu.ok !== false && gpu.maxPosErr < 1e-4, JSON.stringify(gpu).slice(0, 150));

  const deep = JSON.parse(await ev(`(() => { const E = __explorer; const d = E.nodes.filter((n) => n.depth === 12)[0]; const chain = []; for (let n = d; n; n = n.parent) chain.push(n.id);
    const mid = E.nodes.filter((n) => n.depth === 9)[3]; const shallow = E.nodes.filter((n) => n.depth === 2).sort((a, b) => b.weight - a.weight)[0];
    return JSON.stringify({ deep: d.id, chain, mid: mid.id, shallow: shallow.id }); })()`));
  const settle = async () => { for (let i = 0; i < 40; i++) { await sleep(100); if (!(await ev('__explorer.animating'))) break; } await sleep(300); };

  // Picking at several places: for every node of the neighbourhood that is on screen, pointing at its centre must pick it
  // (or, where drawn spheres overlap, the front-most sphere that really covers the point).
  const pickAudit = async (id, label) => {
    await ev(`__explorer.focusOn(__explorer.nodeById(${id}), false)`); await settle();
    const r = await ev(`(() => { const E = __explorer; const f = E.nodeById(${id});
      const around = [f, f.parent, ...(f.parent ? f.parent.children : []), ...f.children].filter(Boolean);
      let total = 0, exact = 0, covered = 0, wrong = [];
      for (const n of new Set(around)) { if (E.nodeState(n.id) === 1) continue; const s = E.screenPos(n.id); if (!s || s.x < 5 || s.y < 5 || s.x > innerWidth - 5 || s.y > innerHeight - 5) continue;
        total++; const got = E.pick(s.x, s.y); if (got === n.id) { exact++; continue; }
        const g = got === null ? null : E.screenPos(got); if (g && Math.hypot(g.x - s.x, g.y - s.y) <= g.r) covered++; else wrong.push([n.id, got]); }
      const self = E.screenPos(f.id); return { total, exact, covered, wrong: wrong.slice(0, 4), self: E.pick(self.x, self.y) === f.id, shownR: E.shownR(f.id) }; })()`);
    rec(`3D picking, focus on ${label} (depth ${await ev(`__explorer.nodeById(${id}).depth`)})`, r.wrong.length === 0 && r.exact + r.covered === r.total && r.shownR < 1e-6,
      `${r.exact} exact + ${r.covered} behind a front sphere of ${r.total}; focus centred (r=${r.shownR.toExponential(1)})${r.wrong.length ? ' WRONG ' + JSON.stringify(r.wrong) : ''}`);
    return r;
  };
  await pickAudit(0, 'the root');
  await pickAudit(deep.shallow, 'a big depth-2 branch');
  await pickAudit(deep.mid, 'a depth-9 node');
  await pickAudit(deep.chain[1], 'the parent of the deepest node');
  await pickAudit(deep.deep, 'the deepest node');
  await b.shot(join(OUT, 'deepest-3d.png'));

  // Drawn edges equal predicted edges (the same maths as the edge shader), at shallow and deep places.
  const edgeCheck = async (id, label) => {
    await ev(`__explorer.focusOn(__explorer.nodeById(${id}), false)`); await settle();
    const r = await ev('__T.edgeAudit(1.4)');
    rec(`3D edges drawn = predicted, focus on ${label}`, r.strayFraction < 0.02 && r.missingCount === 0, `${r.edges} edges, ${r.strayPixels}/${r.litPixels} stray px, ${r.missingCount} missing of ${r.near} near`);
  };
  await edgeCheck(0, 'the root'); await edgeCheck(deep.mid, 'a depth-9 node'); await edgeCheck(deep.deep, 'the deepest node');

  // Navigation: a real mouse click on a deep node, then Up x12.
  await ev(`__explorer.focusOn(__explorer.nodeById(${deep.chain[1]}), false)`); await settle();
  const p = await ev(`__explorer.screenPos(${deep.deep})`);
  await b.click(p.x, p.y); await settle();
  rec('3D: mouse click on the depth-12 node flies to it and centres it exactly', await ev('__explorer.focusId()') === deep.deep && await ev(`__explorer.shownR(${deep.deep})`) < 1e-6, `focus ${await ev('__explorer.focusId()')} expected ${deep.deep}`);
  const upIdx = await ev(`[...document.querySelectorAll('#tools button')].findIndex((x) => x.title.startsWith('Go to the parent'))`);
  const trail = [];
  for (let k = 0; k < 12; k++) { await ev(`document.querySelectorAll('#tools button')[${upIdx}].click()`); await settle(); trail.push(await ev('__explorer.focusId()')); }
  rec('3D: the Up button walks the 12 ancestors in order to the root', JSON.stringify(trail) === JSON.stringify(deep.chain.slice(1)), `reached ${trail[trail.length - 1]}`);
  rec('3D: no console errors', !b.logs.some((l) => /error|exception/i.test(l)), b.logs.filter((l) => /error|exception/i.test(l)).slice(0, 2).join(' | '));

  // =============================== 2D ===============================================================
  b.logs.length = 0;
  await b.goto(`${BASE}?mode=2d&tree=disease_tree.json`, 5000);
  const lay2 = await ev(`(() => { const E = __explorer;
    const d = (a, c) => { const n = (a.x - c.x) ** 2 + (a.y - c.y) ** 2; return Math.acosh(1 + 2 * n / ((1 - (a.x ** 2 + a.y ** 2)) * (1 - (c.x ** 2 + c.y ** 2)))); };
    let maxR = 0, bad = 0, maxD = 0;
    for (const n of E.nodes) { maxR = Math.max(maxR, Math.hypot(n.z.x, n.z.y)); maxD = Math.max(maxD, n.depth); if (n.parent && Math.abs(d(n.parent.z, n.z) - n.edgeLength) > 1e-6) bad++; }
    const deep = E.nodes.filter((n) => n.depth === 12)[0]; const chain = []; for (let n = deep; n; n = n.parent) chain.push(n.id);
    return { count: E.nodes.length, maxR, bad, maxD, deep: deep.id, chain }; })()`);
  rec('2D: same tree loaded', lay2.count === 12419 && lay2.maxD === 12, `${lay2.count} nodes, depth ${lay2.maxD}`);
  rec('2D: max radius below 0.995 and no clamped edge', lay2.maxR < 0.995 && lay2.bad === 0, `max ${lay2.maxR.toFixed(5)}, ${lay2.bad} bad`);
  let hits = 0, tried = 0; const missed = [];
  for (const id of [lay2.chain[4], lay2.chain[2], lay2.chain[1], lay2.deep]) {          // refocus near the deep end, click children / the node itself
    await ev(`__explorer.focusOn(__explorer.nodes[${id}], false)`); await sleep(500);
    const kids = JSON.parse(await ev(`JSON.stringify(__explorer.nodes[${id}].children.slice(0, 3).map((c) => c.id))`));
    for (const t of [id, ...kids]) {
      const s = await ev(`__explorer.screenPos(${t})`); tried++;
      await b.click(s.x, s.y); await sleep(1100);
      if (await ev('__explorer.focusId()') === t) hits++; else missed.push(t);
      await ev(`__explorer.focusOn(__explorer.nodes[${id}], false)`); await sleep(400);
    }
  }
  rec('2D: real mouse clicks on shallow and deep nodes refocus exactly that node', hits === tried, `${hits}/${tried}${missed.length ? ' missed ' + missed : ''}`);
  await ev(`__explorer.focusOn(__explorer.nodes[${lay2.deep}], false)`); await sleep(500);
  await b.shot(join(OUT, 'deepest-2d.png'));
  rec('2D: no console errors', !b.logs.some((l) => /error|exception/i.test(l)), b.logs.filter((l) => /error|exception/i.test(l)).slice(0, 2).join(' | '));
} finally {
  await b.close(); vite.kill();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall disease browser checks passed');
process.exit(fails ? 1 : 0);
