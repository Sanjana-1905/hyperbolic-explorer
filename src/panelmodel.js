// panelmodel.js - WHAT the disease panel says, as plain data (no DOM). diseasepanel.js draws it, tests/panelmodel.test.js checks every word of it.
// Rules (CLAUDE.md "Approved design decisions" 4-5): ontology facts and external identifiers are kept apart; the two hierarchies and the two counts
// are labelled and never mixed; a missing definition / synonym / reference says so and nothing is invented; every model names its ontology version.

export const MESSAGES = {
  noDefinition: 'No definition in the ontology.',
  noSynonyms: 'No synonyms listed in the ontology.',
  noReferences: 'No cross-references listed in the ontology.',
  noParent: 'Top of the ontology: it has no parent.',
  noSubtypes: 'No subtypes: nothing is below it in the ontology.',
  loading: 'Loading the ontology data...',
  primaryParentNote: 'The primary parent is the one this atlas places the disease under: the shortest route to the top (ties go to the lower DOID). The picture and the primary counts use it.',
  additionalNote: 'The ontology also lists these parents. They are real relationships; they are shown here but are not used to place the disease.',
  primaryCountNote: 'Every disease is counted once, under its primary parent, so the top-level categories add up to all 12,419 diseases.',
  dagCountNote: 'A disease with several parents is counted under each of them, so these counts overlap between categories. Do not add them up.',
  referencesNotice: 'Identifiers the ontology lists for this disease. They belong to other resources: this atlas shows them as written and does not fetch or interpret them.',
  factsNotice: 'Name, definition, synonyms and relationships come from the Disease Ontology release below.',
  groupNote: 'An alphabetical run of disease names, made only to keep long lists readable. It is not an ontology category and has no DOID.',
  listOnlyNote: 'Its subtypes are too close together to draw one by one: pick one from this list to focus it.',
};

const SCOPE_LABELS = { EXACT: 'Exact', NARROW: 'Narrower', BROAD: 'Broader', RELATED: 'Related' };
const SCOPE_ORDER = ['EXACT', 'NARROW', 'BROAD', 'RELATED'];
const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const brief = (x) => ({ doid: x.doid, name: x.name });

// The provenance block (identical for every disease): which release every fact comes from.
export function provenanceModel(p) {
  return {
    title: `${p.title} ${p.version}`,
    lines: [
      `Release ${p.releaseTag} · file dated ${p.fileDate} · downloaded ${p.downloaded}`,
      `Licence: ${p.license}`,
      `File SHA-256 ${p.sha256.slice(0, 16)}...`,
    ],
    url: p.url,
    version: p.version, license: p.license, disclaimer: p.disclaimer,
  };
}

// path: the primary path from the top to the disease, [{doid, name}] (navigation groups already left out).
// record: a record from diseasedata.js (term()). prov: provenance(). Returns the model of a DISEASE.
export function diseaseModel(record, path, prov) {
  const r = record;
  const hasChildren = r.counts.primaryChildren > 0 || r.counts.dagChildren > 0;
  const extraChildren = r.children.filter((c) => c.primary === false);
  const primaryChildren = r.children.filter((c) => c.primary === true);
  // synonyms grouped by scope, in a fixed order, then any scope the ontology uses that we do not know
  const known = new Set(SCOPE_ORDER);
  const scopes = [...SCOPE_ORDER, ...[...new Set(r.synonyms.map((s) => s.scope))].filter((x) => !known.has(x))];
  const synonymGroups = scopes.map((scope) => ({ scope, label: SCOPE_LABELS[scope] || scope, items: r.synonyms.filter((s) => s.scope === scope).map((s) => s.text) })).filter((g) => g.items.length);
  // identifiers grouped by source, ICD / MeSH first (the ones people look for), then the rest alphabetically
  const bySource = new Map();
  for (const x of r.externalReferences) {
    if (!bySource.has(x.source)) bySource.set(x.source, { source: x.source, kind: x.kind, items: [] });
    bySource.get(x.source).items.push({ raw: x.raw, id: x.id });
  }
  const rank = (g) => (g.kind === 'ICD' ? 0 : g.kind === 'MeSH' ? 1 : 2);
  const referenceGroups = [...bySource.values()].sort((a, b) => rank(a) - rank(b) || a.source.localeCompare(b.source));
  const primaryKnown = r.primaryParent !== null || r.doid === prov.root;
  return {
    kind: 'disease',
    title: r.name, doid: r.doid,
    badges: [
      hasChildren ? `${plural(r.counts.dagChildren, 'subtype', 'subtypes')} listed` : 'no subtypes',
      ...(r.counts.parentCount > 1 ? [`${r.counts.parentCount} parents`] : []),
    ],
    path: path.map((p, i) => ({ ...brief(p), current: i === path.length - 1 })),
    definition: { text: r.definition, references: r.definitionReferences, missing: r.missing.definition, message: r.missing.definition ? MESSAGES.noDefinition : null },
    synonyms: { groups: synonymGroups, total: r.synonyms.length, missing: r.missing.synonyms, message: r.missing.synonyms ? MESSAGES.noSynonyms : null },
    hierarchy: {
      primaryParent: r.parents.filter((p) => p.primary === true).map(brief)[0] || null,
      primaryParentMessage: r.doid === prov.root ? MESSAGES.noParent : null,
      primaryNote: MESSAGES.primaryParentNote,
      additionalParents: r.parents.filter((p) => p.primary === false).map(brief),
      additionalNote: MESSAGES.additionalNote,
      primaryKnown,
      subtypes: primaryChildren.map(brief),
      alsoChildren: extraChildren.map((c) => ({ ...brief(c) })),   // listed below it in the ontology, but placed under another primary parent
      subtypesMessage: hasChildren ? null : MESSAGES.noSubtypes,
    },
    counts: {
      primary: r.counts.primaryCount === null ? null : { value: r.counts.primaryCount, text: r.counts.primaryCount === 1 ? 'only itself' : `${plural(r.counts.primaryCount, 'disease', 'diseases')} (itself included)`, note: MESSAGES.primaryCountNote },
      dag: { value: r.counts.dagCount, text: r.counts.dagCount === 1 ? 'only itself' : `${plural(r.counts.dagCount, 'disease', 'diseases')} (itself included)`, note: MESSAGES.dagCountNote },
    },
    identifiers: { groups: referenceGroups, total: r.externalReferences.length, missing: r.missing.externalReferences, message: r.missing.externalReferences ? MESSAGES.noReferences : null, notice: MESSAGES.referencesNotice },
    alternativeIds: r.alternativeIds,
    factsNotice: MESSAGES.factsNotice,
    provenance: provenanceModel(prov),
  };
}

// A navigation group (not a disease). members: [{doid?, name, isGroup, members?}] of its direct entries.
export function groupModel(group, path, members, prov) {
  return {
    kind: 'group', title: group.name, subtitle: 'Navigation group', doid: null,
    path: path.map((p, i) => ({ ...brief(p), current: false })),
    note: MESSAGES.groupNote,
    summary: `${plural(group.members, group.kind === 'groups' ? 'group' : 'disease', group.kind === 'groups' ? 'groups' : 'diseases')}${group.kind === 'subtypes' ? ', each with subtypes' : group.kind === 'diseases' ? ', none with subtypes' : ''} · names from ${group.firstName} to ${group.lastName}`,
    members,
    provenance: prov ? provenanceModel(prov) : null,   // null until the (8 KB) metadata file has loaded
  };
}

// While the ontology files load (or if they cannot): what the tree alone knows.
export function loadingModel(node, path, error) {
  return { kind: error ? 'error' : 'loading', title: node.name, doid: node.doid || null, path: path.map((p, i) => ({ ...brief(p), current: i === path.length - 1 })),
    message: error ? `The ontology data could not be loaded (${error}). Only the name and position are shown.` : MESSAGES.loading, error: !!error };
}
