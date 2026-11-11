// panelmodel.test.js - strict checks of WHAT the disease panel says (src/panelmodel.js), for every one of the 12,419 diseases. Run: node tests/panelmodel.test.js
//   nothing fabricated (every fact equals the data layer), missing fields say so in fixed words, the two hierarchies and the two counts are labelled and
//   kept apart, external identifiers are marked external, provenance and version are always present, groups are described as navigation aids.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDiseaseData } from '../src/diseasedata.js';
import { makeDisplayTree, groupLabel } from '../src/displaytree.js';
import { diseaseModel, groupModel, loadingModel, provenanceModel, MESSAGES } from '../src/panelmodel.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const treeJson = read('disease_tree.json');
const D = createDiseaseData({ files: treeJson.dataLayer, loadJson: async (f) => read(f) });
await D.loadAll();
const { nodes, info } = makeDisplayTree(treeJson, { cap: 36 });
D.attachTree(nodes);
const prov = D.provenance();
const pathOf = (node) => { const c = []; for (let n = node; n; n = n.parent) if (!n.isGroup && n.doid) c.unshift({ doid: n.doid, name: n.name }); return c; };
const real = nodes.filter((n) => !n.isGroup);

// ---- the fixed words ------------------------------------------------------------------------------------------------------------------
assert.equal(MESSAGES.noDefinition, 'No definition in the ontology.');
assert.equal(MESSAGES.noSynonyms, 'No synonyms listed in the ontology.');
assert.equal(MESSAGES.noReferences, 'No cross-references listed in the ontology.');
assert.match(MESSAGES.primaryCountNote, /add up to all 12,419/); assert.match(MESSAGES.dagCountNote, /overlap/); assert.match(MESSAGES.dagCountNote, /Do not add them up/);
assert.match(MESSAGES.referencesNotice, /belong to other resources/); assert.match(MESSAGES.referencesNotice, /does not fetch or interpret/);
assert.match(MESSAGES.groupNote, /not an ontology category/);

// ---- every disease ----------------------------------------------------------------------------------------------------------------------------
let missDef = 0, missSyn = 0, missRef = 0, multi = 0, leaves = 0, withAlso = 0;
const t0 = Date.now();
for (const node of real) {
  const rec = D.term(node.doid), path = pathOf(node), m = diseaseModel(rec, path, prov);
  const raw = JSON.stringify(m);
  assert.ok(!/undefined|NaN|\[object/.test(raw), `${node.doid}: no undefined / NaN in the model`);
  assert.equal(m.kind, 'disease'); assert.equal(m.title, rec.name); assert.equal(m.doid, rec.doid);

  // definition: exactly the ontology's words, or the fixed message; never anything else
  if (rec.definition === null) { missDef++; assert.equal(m.definition.text, null); assert.equal(m.definition.missing, true); assert.equal(m.definition.message, MESSAGES.noDefinition); assert.deepEqual(m.definition.references, []); }
  else { assert.equal(m.definition.text, rec.definition); assert.equal(m.definition.missing, false); assert.equal(m.definition.message, null); assert.deepEqual(m.definition.references, rec.definitionReferences); }

  // synonyms: every synonym once, grouped by its own scope
  assert.equal(m.synonyms.total, rec.synonyms.length);
  if (rec.synonyms.length === 0) { missSyn++; assert.deepEqual(m.synonyms.groups, []); assert.equal(m.synonyms.message, MESSAGES.noSynonyms); }
  else {
    assert.equal(m.synonyms.message, null);
    const flat = m.synonyms.groups.flatMap((g) => g.items.map((t) => `${g.scope}|${t}`)).sort();
    assert.deepEqual(flat, rec.synonyms.map((s) => `${s.scope}|${s.text}`).sort());
    for (const g of m.synonyms.groups) assert.ok(g.items.length > 0 && g.label);
  }

  // external identifiers: all of them, grouped by source, marked as a separate block, ICD / MeSH first
  assert.equal(m.identifiers.total, rec.externalReferences.length);
  assert.equal(m.identifiers.notice, MESSAGES.referencesNotice);
  if (rec.externalReferences.length === 0) { missRef++; assert.deepEqual(m.identifiers.groups, []); assert.equal(m.identifiers.message, MESSAGES.noReferences); }
  else {
    assert.equal(m.identifiers.message, null);
    assert.equal(m.identifiers.groups.reduce((s, g) => s + g.items.length, 0), rec.externalReferences.length);
    const flat = m.identifiers.groups.flatMap((g) => g.items.map((x) => x.raw)).sort();
    assert.deepEqual(flat, rec.externalReferences.map((x) => x.raw).sort());
    const kinds = m.identifiers.groups.map((g) => (g.kind === 'ICD' ? 0 : g.kind === 'MeSH' ? 1 : 2));
    assert.deepEqual([...kinds].sort(), kinds, 'ICD sources first, then MeSH, then the rest');
  }

  // the two hierarchies, kept apart
  const hi = m.hierarchy;
  if (rec.doid === prov.root) { assert.equal(hi.primaryParent, null); assert.equal(hi.primaryParentMessage, MESSAGES.noParent); assert.deepEqual(hi.additionalParents, []); }
  else {
    assert.equal(hi.primaryParent.doid, rec.primaryParent); assert.equal(hi.primaryParent.name, rec.parents.find((p) => p.primary).name);
    assert.deepEqual(hi.additionalParents.map((p) => p.doid), rec.additionalParents);
    assert.ok(!hi.additionalParents.some((p) => p.doid === hi.primaryParent.doid), 'the primary parent is never listed as additional');
    assert.equal(hi.additionalParents.length + 1, rec.parents.length, 'primary + additional = all parents');
  }
  assert.equal(hi.primaryNote, MESSAGES.primaryParentNote); assert.equal(hi.additionalNote, MESSAGES.additionalNote);
  assert.equal(hi.subtypes.length + hi.alsoChildren.length, rec.children.length, 'subtypes + "also listed below it" = all DAG children');
  assert.ok(hi.subtypes.every((c) => rec.children.find((x) => x.doid === c.doid).primary === true));
  assert.ok(hi.alsoChildren.every((c) => rec.children.find((x) => x.doid === c.doid).primary === false));
  if (rec.children.length === 0) { leaves++; assert.equal(hi.subtypesMessage, MESSAGES.noSubtypes); assert.deepEqual(m.badges, rec.parents.length > 1 ? ['no subtypes', `${rec.parents.length} parents`] : ['no subtypes']); }
  else { assert.equal(hi.subtypesMessage, null); assert.match(m.badges[0], /subtypes? listed$/); }
  if (hi.alsoChildren.length) withAlso++;
  if (rec.parents.length > 1) { multi++; assert.ok(m.badges.includes(`${rec.parents.length} parents`)); } else assert.ok(!m.badges.some((b) => /parents$/.test(b)));

  // the two counts, labelled, never mixed
  assert.equal(m.counts.primary.value, rec.counts.primaryCount); assert.equal(m.counts.dag.value, rec.counts.dagCount);
  assert.equal(m.counts.primary.note, MESSAGES.primaryCountNote); assert.equal(m.counts.dag.note, MESSAGES.dagCountNote);
  for (const c of [m.counts.primary, m.counts.dag]) assert.ok(c.value === 1 ? c.text === 'only itself' : c.text === `${c.value.toLocaleString('en-US')} diseases (itself included)`);

  // where it sits: the primary path from the top, real names only, ending at the disease
  assert.equal(m.path[0].doid, prov.root); assert.equal(m.path.at(-1).doid, rec.doid); assert.equal(m.path.filter((p) => p.current).length, 1); assert.ok(m.path.at(-1).current);
  for (let i = 1; i < m.path.length; i++) assert.equal(D.primaryInfo(m.path[i].doid).parent, m.path[i - 1].doid, 'each path step is the primary parent of the next');
  assert.equal(m.path.length, pathOf(node).length);

  // provenance on every panel
  assert.equal(m.provenance.version, '2026-10-29'); assert.match(m.provenance.title, /Human Disease Ontology 2026-10-29/); assert.match(m.provenance.license, /CC0/);
  assert.ok(m.provenance.lines.length === 3 && m.provenance.lines[0].includes('v2026-10-29') && m.provenance.url.startsWith('https://')); assert.match(m.provenance.disclaimer, /not a diagnostic/);
  assert.equal(m.factsNotice, MESSAGES.factsNotice);
  assert.deepEqual(m.alternativeIds, rec.alternativeIds);
}
const ms = Date.now() - t0;
assert.equal(missDef, 2270); assert.equal(missSyn, 3822); assert.equal(missRef, 687); assert.equal(multi, 4880);
console.log(`panelmodel: ${real.length} disease models in ${ms} ms; ${missDef} without definition, ${missSyn} without synonyms, ${missRef} without references (fixed messages), ${multi} with additional parents, ${leaves} leaves, ${withAlso} with subtypes placed elsewhere`);

// ---- named examples ----------------------------------------------------------------------------------------------------------------------------
{
  const root = diseaseModel(D.term('DOID:4'), pathOf(D.nodeFor('DOID:4')), prov);
  assert.equal(root.path.length, 1); assert.equal(root.hierarchy.primaryParentMessage, MESSAGES.noParent); assert.equal(root.counts.primary.text, '12,419 diseases (itself included)'); assert.equal(root.counts.dag.text, '12,419 diseases (itself included)');
  const metab = real.find((n) => n.name === 'disease of metabolism');
  const mm = diseaseModel(D.term(metab.doid), pathOf(metab), prov);
  assert.equal(mm.counts.primary.text, '57 diseases (itself included)'); assert.equal(mm.counts.dag.text, '904 diseases (itself included)');
  assert.deepEqual(mm.path.map((p) => p.name), ['disease', 'disease of metabolism']);
  const cyst = real.find((n) => n.name === 'cystic echinococcosis');
  const cm = diseaseModel(D.term(cyst.doid), pathOf(cyst), prov);
  assert.equal(cm.hierarchy.additionalParents.length, 5); assert.equal(cm.hierarchy.primaryParent.name, 'heart disease'); assert.deepEqual(cm.badges, ['no subtypes', '6 parents']);
  assert.deepEqual(cm.path.map((p) => p.name), ['disease', 'disease of anatomical entity', 'cardiovascular system disease', 'heart disease', 'cystic echinococcosis']);
  assert.equal(cm.synonyms.total, 12); assert.equal(cm.synonyms.groups[0].scope, 'EXACT');
  // a disease with subtypes placed under another primary parent is described as such, not as an ordinary child
  const alsoNode = real.find((n) => D.term(n.doid).children.some((c) => c.primary === false));
  const am = diseaseModel(D.term(alsoNode.doid), pathOf(alsoNode), prov);
  assert.ok(am.hierarchy.alsoChildren.length >= 1);
  const pm = provenanceModel(prov); assert.deepEqual(Object.keys(pm).sort(), ['disclaimer', 'license', 'lines', 'title', 'url', 'version']);
}

// ---- navigation groups, loading and error states ---------------------------------------------------------------------------------------------------
{
  const groups = nodes.filter((n) => n.isGroup);
  assert.equal(groups.length, info.groups);
  for (const g of groups) {
    const members = g.children.map((c) => ({ name: c.isGroup ? groupLabel(c) : c.name, doid: c.doid || null, nodeId: c.id, isGroup: !!c.isGroup }));
    const m = groupModel(g, pathOf(g), members, prov);
    assert.equal(m.kind, 'group'); assert.equal(m.doid, null, 'a group has no DOID'); assert.equal(m.subtitle, 'Navigation group'); assert.equal(m.note, MESSAGES.groupNote);
    assert.equal(m.title, g.name); assert.ok(m.summary.includes(`names from ${g.firstName} to ${g.lastName}`)); assert.equal(m.members.length, g.members);
    assert.ok(m.path.every((p) => p.doid && !p.current), 'the path of a group is made of real diseases only');
    assert.ok(!JSON.stringify(m).includes('undefined'));
    assert.ok(m.provenance.version === '2026-10-29');
  }
  assert.equal(groupModel(groups[0], [], [], null).provenance, null, 'before the metadata has loaded a group panel has no provenance block yet');
  const l = loadingModel(real[5], pathOf(real[5]));
  assert.equal(l.kind, 'loading'); assert.equal(l.message, MESSAGES.loading); assert.equal(l.title, real[5].name); assert.equal(l.error, false);
  const e = loadingModel(real[5], pathOf(real[5]), 'HTTP 404');
  assert.equal(e.kind, 'error'); assert.match(e.message, /could not be loaded \(HTTP 404\)/); assert.match(e.message, /Only the name and position are shown/); assert.equal(e.error, true);
  console.log(`panelmodel: ${groups.length} navigation-group models (no DOID, "not an ontology category"), loading and error states`);
}
console.log('panelmodel.test.js: all checks passed');
