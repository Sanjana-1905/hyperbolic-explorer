// data_audit.mjs - browser check of the disease data layer (src/diseasedata.js) in the real 2D and 3D viewers.
//   node tests/phone/data_audit.mjs          (npm run test:data)
// Lazy (nothing fetched at start-up), loaded once, the same records in 2D and 3D, on a phone emulation too, and the sample / WordNet never touch it.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { launch } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 5195;
const BASE = `http://localhost:${PORT}/hyperbolic-explorer/`;
let fails = 0;
const rec = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`); };
const vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }
const b = await launch();
const { ev } = b;
const fetched = async () => JSON.parse(await ev(`JSON.stringify(performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).filter((n) => /^disease_(terms|edges|metadata)\\.json/.test(n)))`));

// the same questions in every mode: a digest of what the layer says about a fixed set of diseases
const DIGEST = `(async () => {
  const d = __explorer.data; await d.loadAll();
  const pick = ['DOID:4', 'DOID:0050004', 'DOID:14566', 'DOID:3070', 'DOID:162', 'DOID:1612'].filter((x) => d.has(x));
  const metab = d.resolve('disease of metabolism')[0].doid;
  const list = __explorer.displayInfo.listOnly[0];
  const out = [];
  for (const id of [...pick, metab, list.children[0].doid]) { const r = d.term(id); out.push([id, r.name, r.parents.length, r.primaryParent, r.counts.primaryCount, r.counts.dagCount, r.counts.additionalParents, r.missing.definition]); }
  return JSON.stringify({ out, size: d.size, edges: d.edgeCount, version: d.provenance().version, metabolism: d.term(metab).counts, icd: d.resolve('ICD10CM:A00').length > 0, alt: d.resolve('DOID:0001816').length, node: d.nodeFor('DOID:4') === __explorer.nodes[0], group: d.doidOf(__explorer.nodes.find((n) => n.isGroup)) });
})()`;

const digests = {};
try {
  for (const [label, url, phone] of [['3D desktop', '?tree=disease_tree.json&intro=0&panel=0', false], ['2D desktop', '?mode=2d&tree=disease_tree.json&panel=0', false], ['3D phone', '?tree=disease_tree.json&intro=0&adapt=0&panel=0', true], ['2D phone', '?mode=2d&tree=disease_tree.json&panel=0', true]]) {
    if (phone) await b.phone(412, 915); else await b.desktop(1280, 800);
    b.logs.length = 0;
    await b.goto(BASE + url, 6000);
    rec(`${label}: the layer exists and nothing is fetched at start-up`, (await ev('!!__explorer.data')) && (await fetched()).length === 0 && (await ev('JSON.stringify(__explorer.data.loaded)')) === '{"metadata":false,"terms":false,"edges":false}', `fetched: ${JSON.stringify(await fetched())}`);
    // the primary tree is available before anything is loaded
    rec(`${label}: the primary tree answers before anything is loaded`, (await ev(`JSON.stringify(__explorer.data.primaryInfo('DOID:4').count)`)) === '12419' && (await ev(`__explorer.data.primaryInfo('DOID:4').children.length`)) === 8);
    const t0 = Date.now();
    const raw = await ev(DIGEST);
    const ms = Date.now() - t0;
    const dg = JSON.parse(raw);
    digests[label] = raw;
    const got = (await fetched()).sort();
    rec(`${label}: loading fetched each of the 3 files exactly once (${ms} ms)`, JSON.stringify(got) === JSON.stringify(['disease_edges.json', 'disease_metadata.json', 'disease_terms.json']), JSON.stringify(got));
    rec(`${label}: 12,419 terms, 17,635 edges, ontology ${dg.version}`, dg.size === 12419 && dg.edges === 17635 && dg.version === '2026-10-29');
    rec(`${label}: metabolism is 57 by the primary tree and 904 by the full DAG`, dg.metabolism.primaryCount === 57 && dg.metabolism.dagCount === 904);
    rec(`${label}: lookup works (ICD code, alternative id), the tree node and the record agree, a group is not a disease`, dg.icd && dg.alt >= 1 && dg.node && dg.group === null);
    rec(`${label}: no console errors`, !b.logs.some((l) => /error|exception/i.test(l)), b.logs.filter((l) => /error|exception/i.test(l)).slice(0, 2).join(' | '));
  }
  const ref = digests['3D desktop'];
  rec('the 3D and the 2D viewer give identical records (desktop)', digests['2D desktop'] === ref);
  rec('phone emulation gives identical records too (cap 24: the list-only member differs, the rest is identical)', (() => {
    const a = JSON.parse(ref), c = JSON.parse(digests['3D phone']), d2 = JSON.parse(digests['2D phone']);
    return JSON.stringify(a.out.slice(0, -1)) === JSON.stringify(c.out.slice(0, -1)) && JSON.stringify(c) === JSON.stringify(d2);
  })());

  // other datasets: no layer, nothing fetched
  await b.desktop(1280, 800);
  for (const [label, url] of [['3D sample', '?tree=sample_tree.json&intro=0'], ['2D sample', '?mode=2d&tree=sample_tree.json'], ['3D WordNet', '?tree=wordnet_tree.json&intro=0'], ['2D WordNet', '?mode=2d&tree=wordnet_tree.json']]) {
    b.logs.length = 0;
    await b.goto(BASE + url, 5000);
    rec(`${label}: no disease data layer, nothing of it fetched, no errors`, (await ev('__explorer.data === null')) && (await fetched()).length === 0 && !b.logs.some((l) => /error|exception/i.test(l)));
  }
} finally {
  await b.close(); vite.kill();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall data-layer browser checks passed');
process.exit(fails ? 1 : 0);
