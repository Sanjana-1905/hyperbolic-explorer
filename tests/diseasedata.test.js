// diseasedata.test.js - strict checks of the disease data layer (src/diseasedata.js, step 2.1). Run: node tests/diseasedata.test.js
//   integrity, the two hierarchies kept apart (primary tree vs the full DAG), missing fields, relationship resolution, lookup by id / alias /
//   obsolete id / cross-reference / name / synonym, search metadata, provenance, lazy loading, 2D/3D display-tree integration, other datasets.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createDiseaseData, dataLayerFor, parseReference, doidCandidates } from '../src/diseasedata.js';
import { makeDisplayTree } from '../src/displaytree.js';

const path = (f) => new URL(`../public/data/${f}`, import.meta.url);
const read = (f) => JSON.parse(readFileSync(path(f), 'utf8'));
const note = (s) => console.log(s);
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const treeJson = read('disease_tree.json'), metaRaw = read('disease_metadata.json'), termsRaw = read('disease_terms.json').terms, edgesRaw = read('disease_edges.json').edges;
const stats = metaRaw.parsing_statistics;
const calls = [];
const loadJson = async (file) => { calls.push(file); return read(file); };
const spec = treeJson.dataLayer;

// ---- 0. the dataset declares its data layer, the others do not --------------------------------------------------------------------
assert.deepEqual(spec, { kind: 'disease-ontology', metadata: 'disease_metadata.json', terms: 'disease_terms.json', edges: 'disease_edges.json' });
assert.deepEqual(treeJson.capabilities, [], 'still no code capabilities');
for (const f of Object.values(spec).slice(1)) assert.ok(existsSync(path(f)), `${f} exists`);
assert.equal(metaRaw.files.metadata, 'disease_metadata.json'); assert.equal(metaRaw.files.license, 'disease_LICENSE.txt');
assert.equal(dataLayerFor(read('sample_tree.json'), loadJson), null, 'the sample has no data layer');
assert.equal(dataLayerFor(read('wordnet_tree.json'), loadJson), null, 'WordNet has no data layer');
assert.equal(dataLayerFor({ dataLayer: { kind: 'something-else' } }, loadJson), null);
assert.equal(calls.length, 0, 'other datasets never fetch anything');

// ---- 1. LAZY LOADING -------------------------------------------------------------------------------------------------------------
{
  calls.length = 0;
  const d = dataLayerFor(treeJson, loadJson);
  assert.ok(d); assert.equal(calls.length, 0, 'creating the layer fetches nothing');
  assert.deepEqual(d.loaded, { metadata: false, terms: false, edges: false });
  assert.throws(() => d.term('DOID:4'), /not loaded/, 'asking before loading is a clear error, not a wrong answer');
  assert.throws(() => d.provenance(), /not loaded/);
  await d.loadMetadata();
  assert.deepEqual(calls, ['disease_metadata.json'], 'metadata alone is 8 KB: terms and edges stay unfetched');
  await Promise.all([d.loadTerms(), d.loadTerms(), d.loadEdges(), d.loadEdges(), d.loadMetadata()]);
  assert.deepEqual([...calls].sort(), ['disease_edges.json', 'disease_metadata.json', 'disease_terms.json'], 'each file fetched exactly once, even when asked for at the same time');
  await d.loadAll(); await d.getTerm('DOID:4');
  assert.equal(calls.length, 3, 'no refetch');
  // a failed load rejects with the file name and can be retried
  let fail = true, attempts = 0;
  const flaky = createDiseaseData({ files: spec, loadJson: async (f) => { attempts++; if (f === 'disease_edges.json' && fail) throw new Error('offline'); return read(f); } });
  await assert.rejects(flaky.loadEdges(), /could not load disease_edges.json: offline/);
  fail = false;
  await flaky.loadEdges();
  assert.equal(flaky.edgeCount, edgesRaw.length, 'the retry worked');
  note('lazy loading: nothing fetched at creation, each file once, clear errors before loading, failed load retried');
}

// ---- the loaded layer used by everything below -----------------------------------------------------------------------------------------
const D = dataLayerFor(treeJson, loadJson);
await D.loadAll();
const trees = { 36: makeDisplayTree(treeJson, { cap: 36 }), 24: makeDisplayTree(treeJson, { cap: 24 }) };
D.attachTree(trees[36].nodes);
const ids = Object.keys(termsRaw);

// ---- 2. INTEGRITY: all 12,419 active terms, all relationships -------------------------------------------------------------------------------------
assert.equal(D.size, 12419); assert.equal(D.size, metaRaw.counts.active_terms); assert.equal(ids.length, 12419);
assert.equal(D.edgeCount, 17635); assert.equal(D.edgeCount, metaRaw.counts.is_a_edges);
for (const id of ids) { assert.match(id, /^DOID:\d+$/); assert.ok(D.has(id)); assert.equal(typeof termsRaw[id].n, 'string'); assert.ok(termsRaw[id].n.length > 0, `${id} has a name`); }
assert.equal(new Set(ids).size, ids.length, 'no duplicate DOIDs');
// the tree and the terms describe exactly the same set of diseases
const treeDoids = new Set(trees[36].nodes.filter((n) => !n.isGroup).map((n) => n.doid));
assert.equal(treeDoids.size, 12419); assert.deepEqual([...treeDoids].sort(), [...ids].sort(), 'tree DOIDs = term DOIDs');
// edges: both ends exist, no self loops, no duplicates, the root has no parent and everything else has one, acyclic
const edgeKeys = new Set();
for (const [c, p] of edgesRaw) { assert.ok(D.has(c) && D.has(p), `edge ${c}->${p} has both ends`); assert.notEqual(c, p); const k = `${c}|${p}`; assert.ok(!edgeKeys.has(k), `duplicate edge ${k}`); edgeKeys.add(k); }
assert.deepEqual(D.parentsOf('DOID:4'), [], 'the root has no parent');
let multi = 0, extra = 0;
for (const id of ids) { const n = D.parentsOf(id).length; if (id !== 'DOID:4') { assert.ok(n >= 1, `${id} has a parent`); if (n > 1) multi++; extra += n - 1; } }
assert.equal(multi, stats.multi_parent_diseases); assert.equal(multi, 4880); assert.equal(extra, 17635 - 12418, 'additional parent links = edges - (terms - 1) = 5,217'); assert.equal(extra, 5217);
{ // Kahn: no cycle
  const indeg = new Map(ids.map((id) => [id, D.parentsOf(id).length])), q = ids.filter((id) => indeg.get(id) === 0); let seen = 0;
  while (q.length) { const x = q.pop(); seen++; for (const c of D.childrenOf(x)) { indeg.set(c, indeg.get(c) - 1); if (indeg.get(c) === 0) q.push(c); } }
  assert.equal(seen, 12419, 'acyclic and every term reachable from the root');
}
note(`integrity: 12,419 terms, 17,635 is_a edges, ${multi} multi-parent diseases, ${extra} additional parent links, acyclic, tree = terms`);

// ---- 3. THE TWO HIERARCHIES, KEPT APART ----------------------------------------------------------------------------------------------------------
for (const cap of [36, 24]) {
  const { nodes } = trees[cap];
  const d = createDiseaseData({ files: spec, loadJson }); await d.loadAll(); d.attachTree(nodes);
  let additional = 0, prim = 0;
  for (const id of ids) {
    const pi = d.primaryInfo(id), rec = d.term(id), dag = d.parentsOf(id);
    prim += pi.children.length;
    if (id === 'DOID:4') { assert.equal(pi.parent, null); assert.equal(rec.primaryParent, null); continue; }
    assert.ok(dag.includes(pi.parent), `${id}: the primary parent is one of its is_a parents`);
    assert.equal(rec.parents.filter((p) => p.primary).length, 1, `${id}: exactly one parent is flagged primary`);
    assert.equal(rec.parents.find((p) => p.primary).doid, pi.parent);
    assert.deepEqual(rec.additionalParents, dag.filter((p) => p !== pi.parent));
    assert.equal(rec.counts.additionalParents, dag.length - 1);
    additional += dag.length - 1;
    // the primary tree is a sub-structure of the DAG: primary children are DAG children, and the flags agree
    for (const c of pi.children) assert.ok(d.childrenOf(id).includes(c), `${id}: primary child ${c} is a DAG child`);
    assert.equal(rec.children.filter((c) => c.primary).length, pi.children.length);
    assert.ok(rec.counts.dagCount >= rec.counts.primaryCount, `${id}: the DAG count can never be smaller than the primary count`);
  }
  assert.equal(additional, 5217, 'additional parent links are reported separately and none is lost');
  assert.equal(prim, 12418, 'primary children = every disease but the root, once');
}
{
  const root = D.term('DOID:4');
  assert.equal(root.counts.primaryCount, 12419); assert.equal(root.counts.dagCount, 12419);
  // category counts: primary counts of the 8 families add up (+ the root) to the active terms; DAG counts overlap and add up to more
  const fam = D.primaryInfo('DOID:4').children.map((id) => D.term(id));
  assert.equal(fam.length, 8);
  assert.equal(fam.reduce((s, f) => s + f.counts.primaryCount, 0) + 1, 12419, 'primary-tree counts of the families are mutually exclusive and sum to 12,419');
  assert.ok(fam.reduce((s, f) => s + f.counts.dagCount, 0) + 1 > 12419, 'DAG counts overlap between families');
  const metab = fam.find((f) => f.name === 'disease of metabolism');
  assert.equal(metab.counts.primaryCount, 57, 'metabolism: 57 by the primary tree'); assert.equal(metab.counts.dagCount, 904, '... and 904 by the full DAG');
  assert.deepEqual(fam.map((f) => [f.name, f.counts.primaryCount]).sort((a, b) => b[1] - a[1]).map((x) => x[1]), [5284, 3384, 1179, 1058, 521, 492, 443, 57]);
  // the DAG count is an independent check of the generator: it equals the `size` stored in the tree file for EVERY disease
  const sizeOf = new Map(); (function walk(n) { sizeOf.set(n.doid, n.size); n.children.forEach(walk); })(treeJson);
  for (const id of ids) assert.equal(D.dagCount(id), sizeOf.get(id), `${id}: DAG count matches the generator's size`);
  // and the primary count is the size of the primary subtree
  const pc = (function count(id) { return 1 + D.primaryInfo(id).children.reduce((s, c) => s + count(c), 0); })('DOID:4');
  assert.equal(pc, 12419);
  // returned data cannot corrupt the index
  const before = D.parentsOf('DOID:0050004'); before.push('DOID:X'); assert.ok(!D.parentsOf('DOID:0050004').includes('DOID:X'), 'parentsOf returns a copy');
  const rec = D.term('DOID:0050004'); assert.ok(Object.isFrozen(rec) && Object.isFrozen(rec.parents) && Object.isFrozen(rec.counts));
  assert.throws(() => { rec.name = 'x'; }, TypeError, 'records are read-only');
  assert.throws(() => { rec.parents.push({}); }, TypeError);
  note('hierarchies kept apart: primary counts sum to 12,419 (families 5284/3384/1179/1058/521/492/443/57), DAG counts overlap (metabolism 904), DAG count = generator size for all 12,419');
}

// ---- 4. MISSING FIELDS: reported, never filled in ---------------------------------------------------------------------------------------------------
{
  let noDef = 0, noSyn = 0, noRef = 0, nSyn = 0, nRef = 0, nAlt = 0, icd = 0, mesh = 0;
  const scopes = new Set(['EXACT', 'RELATED', 'BROAD', 'NARROW']);
  for (const id of ids) {
    const rec = D.term(id), raw = termsRaw[id];
    // types: never undefined
    assert.equal(typeof rec.name, 'string'); assert.ok(rec.definition === null || typeof rec.definition === 'string');
    assert.ok(Array.isArray(rec.definitionReferences) && Array.isArray(rec.synonyms) && Array.isArray(rec.externalReferences) && Array.isArray(rec.alternativeIds));
    // exactly what the file says
    assert.equal(rec.name, raw.n); assert.equal(rec.definition, raw.def ?? null);
    assert.deepEqual(rec.definitionReferences, raw.defRefs || []);
    assert.deepEqual(rec.synonyms.map((s) => [s.text, s.scope]), raw.syn || []);
    assert.deepEqual(rec.externalReferences.map((r) => r.raw), raw.xref || []);
    assert.deepEqual(rec.alternativeIds, raw.alt || []);
    for (const s of rec.synonyms) assert.ok(scopes.has(s.scope), `${id}: synonym scope ${s.scope}`);
    // the missing flags say exactly what is missing
    assert.equal(rec.missing.definition, raw.def == null); assert.equal(rec.missing.synonyms, !(raw.syn && raw.syn.length)); assert.equal(rec.missing.externalReferences, !(raw.xref && raw.xref.length));
    if (rec.missing.definition) { noDef++; assert.equal(rec.definition, null); assert.deepEqual(rec.definitionReferences, []); }
    if (rec.missing.synonyms) { noSyn++; assert.deepEqual(rec.synonyms, []); }
    if (rec.missing.externalReferences) { noRef++; assert.deepEqual(rec.externalReferences, []); }
    nSyn += rec.synonyms.length; nRef += rec.externalReferences.length; nAlt += rec.alternativeIds.length;
    for (const r of rec.externalReferences) { assert.equal(r.external, true); assert.ok(r.raw.startsWith(r.prefix) && r.raw.endsWith(r.id)); }
    if (rec.externalReferences.some((r) => r.kind === 'ICD')) icd++;
    if (rec.externalReferences.some((r) => r.kind === 'MeSH')) mesh++;
  }
  assert.equal(noDef, stats.missing_definition); assert.equal(noDef, 2270);
  assert.equal(noSyn, stats.missing_synonyms); assert.equal(noSyn, 3822);
  assert.equal(noRef, stats.missing_xrefs); assert.equal(noRef, 687);
  assert.equal(icd, stats.terms_with_ICD_xref); assert.equal(mesh, stats.terms_with_MeSH_xref);
  assert.equal(ids.filter((id) => termsRaw[id].alt && termsRaw[id].alt.length).length, stats.terms_with_alt_ids);
  assert.equal(D.term('DOID:99999999'), null, 'an unknown DOID is null, not an empty record');
  const a = parseReference('ICD10CM:A00'), b = parseReference('SNOMEDCT_US_2025_09_01:301990003'), c = parseReference('MESH:D002277'), e = parseReference('WEIRD:1');
  assert.deepEqual([a.source, a.kind, a.prefix, a.id], ['ICD-10-CM', 'ICD', 'ICD10CM', 'A00']);
  assert.deepEqual([b.source, b.kind, b.prefix, b.raw], ['SNOMED CT (US)', null, 'SNOMEDCT_US', 'SNOMEDCT_US_2025_09_01:301990003']);
  assert.deepEqual([c.source, c.kind], ['MeSH', 'MeSH']); assert.equal(e.source, 'WEIRD'); assert.equal(e.external, true);
  note(`missing fields: ${noDef} without definition, ${noSyn} without synonyms, ${noRef} without cross-references, reported as null / empty, every field equals the file (${nSyn} synonyms, ${nRef} references, ${nAlt} alternative ids, ${icd} with ICD, ${mesh} with MeSH)`);
}

// ---- 5. RELATIONSHIP RESOLUTION -------------------------------------------------------------------------------------------------------------------------
{
  for (const [c, p] of edgesRaw) { assert.ok(D.parentsOf(c).includes(p)); assert.ok(D.childrenOf(p).includes(c)); }
  const rng = mulberry(21);
  for (let t = 0; t < 600; t++) {
    const id = ids[Math.floor(rng() * ids.length)], rec = D.term(id);
    for (const x of [...rec.parents, ...rec.children]) { assert.equal(typeof x.name, 'string', 'names are resolved'); assert.equal(x.name, termsRaw[x.doid].n); }
    if (id !== 'DOID:4') assert.ok(D.ancestors(id).includes('DOID:4'), 'every disease descends from the root');
    assert.ok(!D.ancestors(id).includes(id));
    // every ancestor along the primary path is an ancestor in the DAG
    const node = D.nodeFor(id); const chain = []; for (let a = node.parent; a; a = a.parent) if (!a.isGroup) chain.push(a.doid);
    for (const a of chain) assert.ok(D.ancestors(id).includes(a), `${id}: primary ancestor ${a} is a DAG ancestor`);
    // a DAG count is at least the number of DAG children + itself
    assert.ok(rec.counts.dagCount >= 1 + rec.children.length);
  }
  assert.deepEqual(D.ancestors('DOID:4'), []);
  // a disease with several parents shows every one of them
  const multiId = ids.find((id) => D.parentsOf(id).length >= 4), mr = D.term(multiId);
  assert.ok(mr.parents.length >= 4 && mr.counts.additionalParents === mr.parents.length - 1);
  note(`relationships: symmetric for all 17,635 edges, names resolved, every disease descends from the root, "${mr.name}" lists its ${mr.parents.length} parents (1 primary + ${mr.counts.additionalParents} additional)`);
}

// ---- 6. LOOKUP: DOIDs, aliases, obsolete ids, references, names, synonyms ---------------------------------------------------------------------------------------
{
  assert.deepEqual(doidCandidates('doid:50001'), ['DOID:50001', 'DOID:0050001']); assert.equal(doidCandidates('hello'), null); assert.equal(doidCandidates(''), null);
  const via = (q) => D.resolve(q).map((r) => `${r.doid}:${r.via}`);
  assert.deepEqual(via('DOID:4'), ['DOID:4:doid']); assert.deepEqual(via('doid:4'), ['DOID:4:doid']); assert.deepEqual(via('4'), ['DOID:4:doid']);
  assert.deepEqual(via('DOID:0050004'), ['DOID:0050004:doid']); assert.deepEqual(via('50004'), ['DOID:0050004:doid'], 'unpadded number finds the padded id');
  assert.deepEqual(via(' disease '), ['DOID:4:name'], 'names are matched case-insensitively');
  assert.deepEqual(D.resolve(''), []); assert.deepEqual(D.resolve('no such disease'), []); assert.deepEqual(D.resolve('DOID:12345678'), []);
  // alternative ids resolve to their (active) disease
  let alts = 0;
  for (const id of ids) for (const alt of termsRaw[id].alt || []) { alts++; const r = D.resolve(alt); assert.ok(r.some((x) => x.doid === id && x.via === 'alt_id'), `${alt} -> ${id}`); }
  // obsolete ids resolve to their replacement when the ontology names one, else to the ones it suggests considering
  const obs = D.obsoleteReplacements(); let withRep = 0, withConsider = 0;
  for (const [old, o] of Object.entries(obs)) {
    const r = D.resolve(old);
    const active = (o.replacedBy || []).filter((d) => D.has(d));
    if (active.length) { withRep++; assert.deepEqual(r.map((x) => x.doid).sort(), [...active].sort()); assert.ok(r.every((x) => (x.via === 'obsolete' && /obsolete/.test(x.note)) || (x.via === 'alt_id' && /alternative id/.test(x.note))), 'the way an old id was resolved is said'); }   // (an old id can also be a listed alternative id of its replacement)
    else { const cons = (o.consider || []).filter((d) => D.has(d)); if (cons.length) { withConsider++; assert.deepEqual(r.map((x) => x.doid).sort(), [...cons].sort()); } }
  }
  assert.equal(withRep, stats.replacements_resolved); assert.equal(withRep, 35);
  assert.ok(!D.has(Object.keys(obs)[0]), 'obsolete terms are not in the active set');
  // references: exact, in lower case, and without the dated SNOMED suffix
  const rng = mulberry(8); let refs = 0, names = 0, syns = 0;
  for (let t = 0; t < 400; t++) {
    const id = ids[Math.floor(rng() * ids.length)], raw = termsRaw[id];
    for (const x of (raw.xref || []).slice(0, 2)) { refs++; assert.ok(D.resolve(x).some((r) => r.doid === id && r.via === 'xref'), `${x} -> ${id}`); assert.ok(D.resolve(x.toLowerCase()).some((r) => r.doid === id)); const p = parseReference(x); assert.ok(D.resolve(`${p.prefix}:${p.id}`).some((r) => r.doid === id)); }
    names++; assert.ok(D.resolve(raw.n).some((r) => r.doid === id && r.via === 'name')); assert.ok(D.resolve(raw.n.toUpperCase()).some((r) => r.doid === id));
    for (const [text] of (raw.syn || []).slice(0, 2)) { syns++; assert.ok(D.resolve(text).some((r) => r.doid === id), `synonym "${text}" -> ${id}`); }
  }
  const icd = D.resolve('ICD10CM:A00'); assert.ok(icd.length >= 1 && icd.every((r) => r.via === 'xref') && D.term(icd[0].doid).externalReferences.some((r) => r.raw === 'ICD10CM:A00'));
  // a name shared by several diseases returns all of them
  note(`lookup: ids in 3 spellings, ${alts} alternative ids, ${withRep} obsolete ids -> replacement (+${withConsider} "consider"), ${refs} references, ${names} names, ${syns} synonyms, unknown -> []`);
}

// ---- 7. SEARCH METADATA ------------------------------------------------------------------------------------------------------------------------------------------
{
  const recs = D.searchRecords();
  assert.equal(recs.length, 12419);
  assert.deepEqual(recs.map((r) => r.doid), [...ids].sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))), 'one record per disease, ordered by DOID');
  let nSyn = 0, nRef = 0, nAlt = 0;
  for (const r of recs) {
    const raw = termsRaw[r.doid];
    assert.equal(r.name, raw.n); assert.equal(r.nameKey, raw.n.toLowerCase());
    assert.deepEqual(r.synonyms.map((s) => s.text), (raw.syn || []).map((s) => s[0]));
    for (const s of r.synonyms) { assert.equal(s.key, s.text.trim().toLowerCase()); assert.ok(s.scope); }
    assert.deepEqual(r.referenceKeys, (raw.xref || []).map((x) => x.trim().toLowerCase())); assert.deepEqual(r.alternativeIds, raw.alt || []);
    nSyn += r.synonyms.length; nRef += r.referenceKeys.length; nAlt += r.alternativeIds.length;
  }
  const totalSyn = ids.reduce((s, id) => s + (termsRaw[id].syn || []).length, 0), totalRef = ids.reduce((s, id) => s + (termsRaw[id].xref || []).length, 0);
  assert.equal(nSyn, totalSyn); assert.equal(nRef, totalRef);
  assert.equal(recs.filter((r) => r.synonyms.length === 0).length, 3822); assert.equal(recs.filter((r) => r.referenceKeys.length === 0).length, 687);
  assert.equal(recs.filter((r) => r.referenceKeys.some((k) => k.startsWith('icd'))).length, stats.terms_with_ICD_xref);
  assert.equal(recs.filter((r) => r.referenceKeys.some((k) => k.startsWith('mesh:'))).length, stats.terms_with_MeSH_xref);
  note(`search metadata: ${recs.length} records, ${nSyn} synonyms with scope, ${nRef} reference keys, ${nAlt} alternative ids, all equal to the files`);
}

// ---- 8. PROVENANCE ---------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const p = D.provenance();
  assert.equal(p.version, '2026-10-29'); assert.equal(p.releaseTag, 'v2026-10-29'); assert.match(p.sha256, /^[0-9a-f]{64}$/); assert.match(p.url, /^https:\/\/raw\.githubusercontent\.com\/DiseaseOntology\/HumanDiseaseOntology\/v2026-10-29\/src\/ontology\/doid\.obo$/);
  assert.equal(p.license, 'Creative Commons Zero v1.0 Universal (CC0 1.0)'); assert.match(p.licenseUrl, /creativecommons\.org\/publicdomain\/zero\/1\.0/);
  assert.equal(p.downloaded.length, 10); assert.equal(p.counts.active_terms, 12419); assert.equal(p.root, 'DOID:4'); assert.match(p.disclaimer, /not a diagnostic/);
  assert.ok(Object.isFrozen(p));
  assert.match(readFileSync(path(p.licenseFile), 'utf8'), /CC0 1\.0 Universal/);
  for (const id of ids.slice(0, 500)) { const s = D.term(id).source; assert.deepEqual(s, { ontology: 'Disease Ontology (DOID)', version: '2026-10-29', releaseTag: 'v2026-10-29', license: p.license }); }
  note(`provenance: ${p.title} ${p.version} (${p.releaseTag}), sha256 ${p.sha256.slice(0, 12)}..., ${p.license}, downloaded ${p.downloaded}; every record carries source + version + licence`);
}

// ---- 9. THE DISPLAY TREE, 2D AND 3D --------------------------------------------------------------------------------------------------------------------------------------
for (const cap of [36, 24]) {
  const { nodes, info } = trees[cap];
  const d = createDiseaseData({ files: spec, loadJson }); await d.loadAll(); d.attachTree(nodes);
  let real = 0;
  for (const id of ids) { const n = d.nodeFor(id); assert.ok(n && !n.isGroup && n.doid === id, `${id} maps to a real node`); assert.equal(d.doidOf(n), id); real++; }
  assert.equal(real, 12419);
  for (const g of nodes.filter((n) => n.isGroup)) { assert.equal(d.doidOf(g), null, 'a navigation group is not a disease'); assert.equal(d.nodeFor(g.name), null); }
  for (const L of info.listOnly) for (const m of L.children) { assert.ok(d.term(m.doid), 'list-only members have records'); assert.equal(d.nodeFor(m.doid), m); }
  assert.equal(d.nodeFor('DOID:99999999'), null); assert.equal(d.doidOf(null), null);
  // the primary parent seen by the data layer is the one the display tree draws, through groups
  for (const n of nodes) if (!n.isGroup && n.parent) { let a = n.parent; while (a.isGroup) a = a.parent; assert.equal(d.term(n.doid).primaryParent, a.doid); }
}
{ // without a tree attached the primary fields are null, not guessed
  const d = createDiseaseData({ files: spec, loadJson }); await d.loadAll();
  const r = d.term('DOID:0050004');
  assert.equal(r.primaryParent, null); assert.equal(r.additionalParents, null); assert.equal(r.counts.primaryCount, null); assert.ok(r.parents.every((p) => p.primary === null)); assert.ok(r.counts.dagCount >= 1);
}
note('display tree: every DOID maps to its real node at both caps, groups map to nothing, list-only members have records, primary parent = the one the tree draws');

console.log('diseasedata.test.js: all checks passed');
