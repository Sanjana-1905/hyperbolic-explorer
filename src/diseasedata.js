// diseasedata.js - the DISEASE DATA LAYER (step 2.1): everything the interface needs to know about a disease and its place in the ontology.
// No drawing, no DOM, no fetch of its own: the caller passes `loadJson(file)`, so the same code runs in the 2D viewer, the 3D viewer and Node tests.
//
// WHAT IT HOLDS (all read from the generated files, nothing is made up; see tools/make_disease_tree.py):
//   metadata   disease_metadata.json  provenance: source URL, release, version, SHA-256, licence, download date, counts, obsolete -> replacement
//   terms      disease_terms.json     per active disease: name, definition (+ its source references), synonyms with scope, cross-references, alternative ids
//   edges      disease_edges.json     EVERY is_a edge of the active ontology [child, parent] (the full DAG, multiple parents included)
//   tree       the display tree       the PRIMARY hierarchy used for the layout (one parent per disease), attached with attachTree(nodes)
// TWO HIERARCHIES, KEPT APART. The primary tree is a layout device (each disease under one primary parent). The DAG is the ontology. A disease
// record therefore says both: `parents` (all of them, the primary one flagged) and the counts of BOTH kinds, never mixed:
//   primaryCount  diseases in its primary subtree, itself included (what the overview shows; categories add up to the active term count)
//   dagCount      distinct diseases reachable below it through ANY is_a path, itself included (can overlap between categories)
//   Example: "disease of metabolism": primaryCount 57, dagCount 904.
// LAZY. Nothing is fetched until asked. loadMetadata() is 8 KB, loadTerms() 5 MB, loadEdges() 0.5 MB; each is fetched once even if asked for
// twice or at the same time, and a failed load can be retried. getTerm() / resolve() load what they need.
// ONTOLOGY FACTS vs EXTERNAL REFERENCES. name, definition, synonyms, parents and children are ontology facts. Cross-references (ICD, MeSH, OMIM,
// UMLS, ...) are identifiers that the ontology lists for a disease; they are returned as identifiers only (never fetched, never interpreted) and are
// labelled `external`. A missing definition / synonym / reference is reported as missing (null / empty list + a `missing` flag), never filled in.

const DOID = /^DOID:\d+$/;
const num = (doid) => Number(doid.slice(5));
const byDoid = (a, b) => num(a) - num(b);

// Human-readable names of the identifier sources the ontology uses (labels only; no meaning is added). Unknown prefixes keep their own name.
const SOURCE_LABELS = {
  ICD10CM: 'ICD-10-CM', ICD9CM: 'ICD-9-CM', ICD11: 'ICD-11', ICDO: 'ICD-O', MEDDRA: 'MedDRA', MESH: 'MeSH', MIM: 'OMIM', UMLS_CUI: 'UMLS', NCI: 'NCI Thesaurus', ORDO: 'Orphanet',
  GARD: 'GARD', EFO: 'EFO', KEGG: 'KEGG', SNOMEDCT_US: 'SNOMED CT (US)', SNOMEDCT: 'SNOMED CT',
};
const KIND_OF = { ICD10CM: 'ICD', ICD9CM: 'ICD', ICD11: 'ICD', ICDO: 'ICD', MESH: 'MeSH', MIM: 'OMIM', UMLS_CUI: 'UMLS' };

// "SNOMEDCT_US_2025_09_01:301990003" -> prefix "SNOMEDCT_US" (the date of the release is dropped from the source name only; the raw string is kept).
export function parseReference(raw) {
  const at = raw.indexOf(':');
  const rawPrefix = at < 0 ? '' : raw.slice(0, at);
  const id = at < 0 ? raw : raw.slice(at + 1);
  const prefix = rawPrefix.replace(/_\d{4}_\d{2}_\d{2}$/, '');
  return { raw, prefix, id, source: SOURCE_LABELS[prefix] || prefix || 'unknown', kind: KIND_OF[prefix] || null, external: true };
}

// The ids a typed DOID can stand for. The ontology writes low numbers plain and the rest zero-padded to 7 digits ("DOID:4", "DOID:0050001"), so
// "doid:50001", "DOID:50001" and "50001" all give ["DOID:50001", "DOID:0050001"]; the caller keeps the ones that exist. Not a DOID -> null.
export function doidCandidates(text) {
  const m = /^\s*(?:doid:)?\s*(\d+)\s*$/i.exec(text);
  if (!m) return null;
  const digits = m[1];
  return [...new Set([`DOID:${digits}`, `DOID:${Number(digits)}`, `DOID:${String(Number(digits)).padStart(7, '0')}`])];
}
const keyOf = (text) => text.trim().toLowerCase();

// Create the layer. files: { metadata, terms, edges } (names relative to whatever loadJson understands).
export function createDiseaseData({ loadJson, files = { metadata: 'disease_metadata.json', terms: 'disease_terms.json', edges: 'disease_edges.json' } }) {
  const once = {};                                       // name -> promise: each file is fetched once, retried only after a failure
  const fetchOnce = (name) => {
    if (!once[name]) {
      once[name] = Promise.resolve().then(() => loadJson(files[name])).catch((err) => { delete once[name]; throw new Error(`could not load ${files[name]}: ${err.message || err}`); });
    }
    return once[name];
  };

  let meta = null, termDocs = null, edgeDoc = null;
  let terms = null;                                      // doid -> raw term {n, def, defRefs, syn, xref, alt}
  let parentsOf = null, childrenOf = null;               // the full DAG: doid -> sorted doids
  let altIndex = null, xrefIndex = null, nameIndex = null, synIndex = null;
  let nodeByDoid = null;                                 // doid -> display-tree node (real nodes only)
  const primary = new Map();                             // doid -> { parent, children[], count } from the primary tree
  const dagMemo = new Map();

  // ---- loading --------------------------------------------------------------------------------------------------------------------
  const api = {
    async loadMetadata() { if (!meta) meta = await fetchOnce('metadata'); return meta; },
    async loadTerms() {
      if (!terms) {
        termDocs = await fetchOnce('terms');
        terms = termDocs.terms;
        altIndex = new Map(); xrefIndex = new Map(); nameIndex = new Map(); synIndex = new Map();
        const add = (map, key, doid) => { const l = map.get(key); if (l) { if (!l.includes(doid)) l.push(doid); } else map.set(key, [doid]); };
        for (const doid of Object.keys(terms)) {
          const t = terms[doid];
          add(nameIndex, keyOf(t.n), doid);
          for (const [text] of t.syn || []) add(synIndex, keyOf(text), doid);
          for (const a of t.alt || []) add(altIndex, a.toUpperCase(), doid);
          for (const x of t.xref || []) { const p = parseReference(x); add(xrefIndex, keyOf(x), doid); if (p.prefix) add(xrefIndex, keyOf(`${p.prefix}:${p.id}`), doid); }
        }
      }
      return terms;
    },
    async loadEdges() {
      if (!parentsOf) {
        edgeDoc = await fetchOnce('edges');
        const P = new Map(), C = new Map();
        for (const [child, parent] of edgeDoc.edges) {
          (P.get(child) ?? P.set(child, []).get(child)).push(parent);
          (C.get(parent) ?? C.set(parent, []).get(parent)).push(child);
        }
        for (const l of P.values()) l.sort(byDoid);
        for (const l of C.values()) l.sort(byDoid);
        parentsOf = P; childrenOf = C;
      }
      return parentsOf;
    },
    async loadAll() { await Promise.all([api.loadMetadata(), api.loadTerms(), api.loadEdges()]); return api; },
    get loaded() { return { metadata: !!meta, terms: !!terms, edges: !!parentsOf }; },

    // ---- the primary tree (from the display tree; available without loading anything) ---------------------------------------------------
    // nodes: display-tree nodes (groups are skipped). Needs only the tree: primary parent, primary children and primaryCount per DOID.
    attachTree(nodes) {
      nodeByDoid = new Map();
      primary.clear();
      for (const n of nodes) {
        if (n.isGroup || !n.doid) continue;
        nodeByDoid.set(n.doid, n);
      }
      for (const n of nodes) {
        if (n.isGroup || !n.doid) continue;
        let a = n.parent;
        while (a && a.isGroup) a = a.parent;
        primary.set(n.doid, { parent: a ? a.doid : null, children: [], count: n.realWeight ?? n.weight });
      }
      for (const [doid, p] of primary) if (p.parent) primary.get(p.parent).children.push(doid);
      for (const p of primary.values()) p.children.sort(byDoid);
      return api;
    },
    // The display-tree node of a DOID (null if unknown or the tree is not attached) and the DOID of a node (null for navigation groups).
    nodeFor(doid) { return nodeByDoid ? nodeByDoid.get(doid) || null : null; },
    doidOf(node) { return node && !node.isGroup && node.doid ? node.doid : null; },
    primaryInfo(doid) { const p = primary.get(doid); return p ? { parent: p.parent, children: [...p.children], count: p.count } : null; },

    // ---- provenance -------------------------------------------------------------------------------------------------------------------
    provenance() {
      need(meta, 'metadata', 'loadMetadata');
      return Object.freeze({
        dataset: meta.dataset, title: meta.ontology_title, version: meta.source.ontology_version, dataVersion: meta.source.data_version,
        releaseTag: meta.source.release_tag, url: meta.source.url, repository: meta.source.repository, sha256: meta.source.sha256, bytes: meta.source.bytes,
        fileDate: meta.source.file_date, downloaded: meta.download_date, license: meta.license.name, licenseUrl: meta.license.url, licenseFile: meta.license.text_file,
        primaryParentRule: meta.primary_parent_rule, root: meta.root, counts: { ...meta.counts }, disclaimer: meta.disclaimer,
      });
    },

    // ---- the DAG ----------------------------------------------------------------------------------------------------------------------
    has(doid) { need(terms, 'terms', 'loadTerms'); return Object.prototype.hasOwnProperty.call(terms, doid); },
    get size() { need(terms, 'terms', 'loadTerms'); return Object.keys(terms).length; },
    get edgeCount() { need(parentsOf, 'edges', 'loadEdges'); return edgeDoc.edges.length; },
    parentsOf(doid) { need(parentsOf, 'edges', 'loadEdges'); return [...(parentsOf.get(doid) || [])]; },
    childrenOf(doid) { need(childrenOf, 'edges', 'loadEdges'); return [...(childrenOf.get(doid) || [])]; },
    // All ancestors through any is_a path (the root included), sorted by DOID.
    ancestors(doid) {
      need(parentsOf, 'edges', 'loadEdges');
      const seen = new Set(), stack = [...(parentsOf.get(doid) || [])];
      while (stack.length) { const d = stack.pop(); if (seen.has(d)) continue; seen.add(d); for (const p of parentsOf.get(d) || []) stack.push(p); }
      return [...seen].sort(byDoid);
    },
    // Distinct diseases below `doid` through any is_a path, itself included (memoised).
    dagCount(doid) {
      need(childrenOf, 'edges', 'loadEdges');
      if (dagMemo.has(doid)) return dagMemo.get(doid);
      const seen = new Set([doid]), stack = [doid];
      while (stack.length) { const d = stack.pop(); for (const c of childrenOf.get(d) || []) if (!seen.has(c)) { seen.add(c); stack.push(c); } }
      dagMemo.set(doid, seen.size);
      return seen.size;
    },

    // ---- one disease ------------------------------------------------------------------------------------------------------------------
    // The full record (see the header). Needs terms, edges and metadata loaded (use getTerm to load them). null for an unknown DOID.
    term(doid) {
      need(terms, 'terms', 'loadTerms'); need(parentsOf, 'edges', 'loadEdges'); need(meta, 'metadata', 'loadMetadata');
      const t = terms[doid];
      if (!t) return null;
      const name = (d) => (terms[d] ? terms[d].n : null);
      const prim = primary.get(doid) || null;
      const parents = (parentsOf.get(doid) || []);
      const dagKids = (childrenOf.get(doid) || []);
      const primaryParent = prim ? prim.parent : null;
      // `primaryChildOf(c)`: is `doid` the primary parent of c? (from the primary tree when attached)
      const isPrimaryChild = (c) => (primary.has(c) ? primary.get(c).parent === doid : null);
      const dagCount = api.dagCount(doid);
      const primaryCount = prim ? prim.count : null;
      const synonyms = (t.syn || []).map(([text, scope]) => ({ text, scope }));
      const references = (t.xref || []).map(parseReference);
      const rec = {
        doid, name: t.n,
        definition: t.def ?? null, definitionReferences: [...(t.defRefs || [])],
        synonyms, alternativeIds: [...(t.alt || [])],
        externalReferences: references,
        parents: parents.map((d) => ({ doid: d, name: name(d), primary: primaryParent === null ? null : d === primaryParent })),
        children: dagKids.map((d) => ({ doid: d, name: name(d), primary: isPrimaryChild(d) })),
        primaryParent,
        additionalParents: primaryParent === null ? null : parents.filter((d) => d !== primaryParent),
        counts: {
          primaryCount, primaryDescendants: primaryCount === null ? null : primaryCount - 1,
          dagCount, dagDescendants: dagCount - 1,
          primaryChildren: prim ? prim.children.length : null, dagChildren: dagKids.length, parentCount: parents.length,
          additionalParents: primaryParent === null ? null : parents.length - (parents.includes(primaryParent) ? 1 : 0),
        },
        missing: { definition: t.def == null, synonyms: synonyms.length === 0, externalReferences: references.length === 0 },
        source: { ontology: meta.dataset, version: meta.source.ontology_version, releaseTag: meta.source.release_tag, license: meta.license.name },
      };
      return deepFreeze(rec);
    },
    async getTerm(doid) { await api.loadAll(); return api.term(doid); },

    // ---- finding a disease from text (what the search will use, step 2.7) -------------------------------------------------------------------
    // A DOID ("DOID:50001", "doid:50001", "50001"), an alternative id, an obsolete id (-> its replacement, if the ontology names one), a
    // cross-reference ("ICD10CM:A00", "MESH:D002...", case does not matter), an exact name or an exact synonym.
    // Returns [{ doid, via, note }] ('via': doid | alt_id | obsolete | xref | name | synonym), [] if nothing matches.
    resolve(query) {
      need(terms, 'terms', 'loadTerms'); need(meta, 'metadata', 'loadMetadata');
      const out = [], seen = new Set();
      const push = (doid, via, note) => { if (!seen.has(doid)) { seen.add(doid); out.push(note ? { doid, via, note } : { doid, via }); } };
      const q = String(query).trim();
      if (!q) return out;
      const candidates = doidCandidates(q);
      if (candidates) {
        for (const doid of candidates) {
          if (terms[doid]) push(doid, 'doid');
          for (const d of altIndex.get(doid) || []) push(d, 'alt_id', `${doid} is an alternative id of ${d}`);
          const old = meta.obsolete_replacements[doid];
          if (old) {
            const active = (old.replacedBy || []).filter((d) => terms[d]);
            for (const d of active) push(d, 'obsolete', `${doid} is obsolete, replaced by ${d}`);
            if (!active.length) for (const d of (old.consider || []).filter((x) => terms[x])) push(d, 'obsolete', `${doid} is obsolete, the ontology suggests considering ${d}`);
          }
        }
        return out;
      }
      const k = keyOf(q);
      for (const d of altIndex.get(q.toUpperCase()) || []) push(d, 'alt_id', `${q} is an alternative id of ${d}`);
      if (q.includes(':')) for (const d of xrefIndex.get(k) || []) push(d, 'xref');
      for (const d of nameIndex.get(k) || []) push(d, 'name');
      for (const d of synIndex.get(k) || []) push(d, 'synonym');
      return out;
    },
    // What obsolete ids resolve to (from the metadata): { 'DOID:...': { replacedBy: [...], consider: [...] } }
    obsoleteReplacements() { need(meta, 'metadata', 'loadMetadata'); return meta.obsolete_replacements; },

    // One record per disease with everything the search needs, already normalised (lower-case keys), so a search index can be built without
    // touching the raw files: { doid, name, nameKey, synonyms: [{text, scope, key}], referenceKeys: ['icd10cm:a00', ...], alternativeIds }.
    searchRecords() {
      need(terms, 'terms', 'loadTerms');
      return Object.keys(terms).sort(byDoid).map((doid) => {
        const t = terms[doid];
        return {
          doid, name: t.n, nameKey: keyOf(t.n),
          synonyms: (t.syn || []).map(([text, scope]) => ({ text, scope, key: keyOf(text) })),
          referenceKeys: (t.xref || []).map((x) => keyOf(x)), alternativeIds: [...(t.alt || [])],
        };
      });
    },
  };

  function need(value, what, how) { if (!value) throw new Error(`disease data: ${what} not loaded yet, call ${how}() (or loadAll()) first`); }
  return api;
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
}

// The data layer of a dataset, or null if the dataset has none (the sample and WordNet declare no `dataLayer`).
// json: the parsed tree file; loadJson(file): resolves a file name next to the tree file.
export function dataLayerFor(json, loadJson) {
  const spec = json && json.dataLayer;
  if (!spec || spec.kind !== 'disease-ontology') return null;
  return createDiseaseData({ loadJson, files: { metadata: spec.metadata, terms: spec.terms, edges: spec.edges } });
}
