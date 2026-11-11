# PROGRESS — Hyperbolic Disease Atlas

Project pivoted (Nov 2026, branch `atlas`) from Hyperbolic Code Explorer to the **Hyperbolic Disease Atlas**: exploring the
Disease Ontology in the Poincaré ball. Principles are in CLAUDE.md. One phase at a time, only when the user says "go".

## Roadmap  (revised Nov 2026 after the experience review; decisions are listed in CLAUDE.md "Approved design decisions")

**Core deliverables**
| Phase | Title | Status |
|---|---|---|
| 0 | Freeze and prepare existing engine | done (commit 1e52269) |
| 1 | Disease Ontology data ingestion (full DAG, provenance, primary hierarchy) + radius-clamp fix + default dataset | done (data, taper fix, default launch) |
| 2 | **Atlas redesign: from "glowing graph" to a disease atlas** (steps 2.1-2.8 below) | **step 2.3a (S5 layout, groups, caps, list-only nodes) implemented and validated; waiting for approval to continue with 2.1** |
| 3 | Interactive exploration lenses | folded into Phase 2 (steps 2.4-2.7) |
| 4 | Comparative navigation study (tree vs 2D vs 3D), run and report | instruments built in step 2.8; the study itself later |

**Optional extensions** (only if time allows; none is needed for the course deliverable)
| Phase | Title | Status |
|---|---|---|
| 5 | Anatomical visualization | optional, not started |
| 6 | Gene and protein integration (every association with source provenance) | optional, not started |
| 7 | Biological pathway animation | optional, not started |
| 8 | AR / VR (tabletop AR, Cardboard VR, Lorentz camera) | optional, not started |

### Phase 2 steps (each waits for the user's "go"; every step delivers BOTH 2D and 3D through the shared core)
| Step | Title | Depends on | Main risk |
|---|---|---|---|
| 2.1 | **Disease data layer**: `diseaseData.js` lazy-loads `disease_terms.json` + `disease_edges.json`, indexes by DOID / name / synonym / xref, parents and children in the full DAG, primary and DAG counts | none | 5 MB terms file on a phone: load on first panel open or first search |
| 2.2 | **Disease information panel**: ontology facts vs external identifiers; primary-tree count vs full-DAG descendant count vs additional parents, with the counting explanation; bottom sheet on phones | 2.1 | missing data must read "not in the ontology", never blank or invented |
| 2.3a | **2D layout correction and validation**: DONE (S5 adopted and implemented, see below) | none (pure maths) | done |
| 2.3b | **2D viewer on the shared core + 2D/3D parity**: labels, picking, back stack, breadcrumbs, Up / Home / Back, panel hook, drag-to-pan as Möbius translation, 2D minimap, capabilities; 3D keeps working and adopts the same core | 2.3a, 2.2 | largest hidden item (`main2d.js` is a 359-line viewer with none of these); `navigation.js` and `minimap.js` are 3D-specific |
| 2.4 | **Family overview + progressive expansion**: `atlasState.js` (overview / explore), `lod.js` (pure representation policy with a node budget), named folded groups; **2D becomes the normal default at the end of this step**, `mode=3d` explicit | 2.3a, 2.3b, 2.1 | tuning on the S26; budget (~800 drawn nodes) |
| 2.5 | **Primary vs additional relationships**: dashed neutral arcs for the selected / hovered disease, "also a kind of" list, via the existing link-arc machinery | 2.1, 2.4 | arc clutter |
| 2.6 | **Visual restyle**: calm near-black theme for ALL datasets, flat discs, family hues, no galaxy decorations; all through `theme.js` | 2.4 | shaders, `theme.js` dead-constant test, sample / WordNet regressions |
| 2.7 | **Search upgrade**: name, synonym, DOID, ICD / MeSH code; jump to deeply nested diseases with the path lit | 2.1 | ranking |
| 2.8 | **Tree baseline parity + study**: same data, search, panel and logging in the collapsible tree; disease task file; every study URL names `mode=` explicitly | 2.2, 2.4, 2.7 | fairness between the three conditions |

Dependency order: 2.1 -> 2.2 ; 2.3a -> 2.3b ; (2.2, 2.3a, 2.3b, 2.1) -> 2.4 -> 2.5, 2.6 ; 2.1 -> 2.7 ; (2.2, 2.4, 2.7) -> 2.8. Steps 2.1/2.2 and 2.3a are independent and could run in either order.
Regression rule for every step: `npm test`, `npm run build`, `npm run test:phone` (172), `npm run test:disease`, and the sample and WordNet datasets keep working in all three modes.

### Counting rule (decided)
Overview and category sizes use PRIMARY-TREE counts (mutually exclusive, sum to 12,419 incl. the root): anatomical entity 5,284 · genetic disease 3,384 · cellular proliferation 1,179 · syndrome 1,058 · physical disorder 521 · mental health 492 · infectious agent 443 · metabolism 57.
The panel additionally shows the full DAG descendant count (overlapping between categories, e.g. metabolism 904) and the additional parents, each labelled, with an explanation.

## Step 2.3a — 2D layout prototypes  (done: RESULTS REPORTED, WAITING FOR THE USER'S DECISION; production layout NOT changed)

Scripts (pure Node, they import only helpers from `src/`, nothing in `src/` was edited): `tools/proto/layout2d_proto.mjs` (layouts + metrics; `--sweep` = parameter sensitivity; `--dump` = positions),
`tools/proto/render_svg.mjs` (SVG disks) -> `screenshots/layout2d-prototypes.png`. Run: `node tools/proto/layout2d_proto.mjs`.

**Correction of my earlier diagnosis:** I said "autosomal recessive disease" has 1,048 *descendants*; it has **1,048 direct children** in the primary tree (the widest parent). "syndrome" has 486 children (depth 1). Both are tested explicitly below.

### Strategies (all share the same machinery)
- **base** = the production 2D layout, unchanged (`computeLayout`: slices proportional to subtree size, each child's fan = 2x its slice, one fixed edge length).
- **W** (control) = half-equal/half-weight shares like 3D + the exact **wedge rule** (2D twin of the 3D cone rule: a child's whole subtree stays inside its angular territory, so sibling subtrees cannot overlap), fixed edge length. Shows what the wedge rule alone costs.
- **A** = W + **adaptive edge length**: a wide parent gets the smallest longer edge length (same for all its children) that reaches the target spacing, within the radius budget.
- **B** = W + **staggered rings**: children keep the scheduled length plus a sawtooth radial offset `(i mod R) * 0.045`, with the smallest ring count R that reaches the target; neighbours differ in radius, same-ring nodes are R slices apart.
- A and B both keep the radius budget rigorous: every root-to-node path sums to <= 2*atanh(0.994) = 5.806; if a wide parent uses more than its scheduled length, the levels below are scaled by f = (budget − P)/(budget − S), capped so they keep >= 35 % of their schedule. If the cap binds, the target is missed and reported.
- Target sibling distance used by A and B: 0.045 (requirement: >= 0.04).

### Results on the Disease Ontology (12,419 nodes, 1,520 parents with >= 2 children)
| | production (base) | W control | A adaptive | **B rings** | target |
|---|---|---|---|---|---|
| min sibling distance (any parent) | 0.0007 | 0.0002 | 0.0002 | 0.0002 | >= 0.04 |
| parents below 0.04 / below 0.02 | 209 / 112 | 1500 / 1470 | 1330 / 1214 | **28 / 26** | none below 0.02 |
| closest pair of ANY two nodes | 0.0005 | 0.0002 | 0.0002 | 0.0002 | (info) |
| clamped edges | 0 | 0 | 0 | 0 | 0 |
| max radius | 0.9894 | 0.9939 | 0.9936 | 0.9939 | <= 0.994 |
| subtree overlap (sibling pairs / parents) | **17,565 / 192** | 0 | 0 | 0 | none |
| longest edge used | 0.60 | 0.60 | 3.59 | 2.81 | |
| **"syndrome" (486 children)**: min nearest-sibling | 0.0007 | 0.0010 | 0.0291 (edge 3.59, cap binds) | **0.0450** (median 0.0452, edges 0.60–2.49, 43 rings, farthest child radius 0.913) | >= 0.04 |
| "autosomal recessive disease" (1,048 children): min nearest-sibling | 0.0028 | 0.0003 | 0.0015 | 0.0119 (cap binds) | >= 0.04 |
| min sibling by depth band <=3 / 4-6 / 7-9 / 10-12 | 0.0007 / 0.0016 / 0.018 / 0.153 | 0.0006 / 0.0002 / 0.0002 / 0.0003 | 0.004 / 0.0003 / 0.0002 / 0.0002 | 0.0450 / 0.0009 / 0.0011 / 0.0002 | |

Sample (5,000) and WordNet (3,000), same metrics: **B passes every target on both** (min sibling 0.0450 / 0.0451, 0 parents below 0.04, 0 overlaps, closest pair 0.0135 / 0.0175, max radius 0.990). Production there already overlaps (477 pairs in 126 parents / 710 in 74); A and W fail the spacing target on both.

### What this means
- **Neither A nor B meets every target on the Disease Ontology. B is far closer; A is not viable** (a uniform longer edge cannot fix a leaf squeezed next to a big sibling, and 3.6 sends all 486 children to the rim).
- B meets: zero clamped edges, max radius <= 0.994, **zero subtree overlap** (production has 192 overlapping parents), the explicit 486-child test (0.0450), and the whole sample and WordNet.
- B misses: 28 of 1,520 parents stay below 0.04 (26 below 0.02), and the global minimum is 0.0002. It is **worse than production's 0.0007**, because the strict wedge rule gives a thin angular room to a deep two-child parent (depth 10) whose ancestors have used the radius budget.
- **Why (the real constraint):** a node's angular room is roughly (its weight share) x e^(path length). The path length is capped by the radius limit, and wide ancestors spend it. The failing parents are wide (10–1,048 children) at depths 3–7 whose ancestors already used 4.7–5.6 of the 5.8 budget (examples: d5, 29 kids, path 4.66; d4–d6 groups of 10–100). Ring tricks cannot create room that the budget does not have.
- Sensitivity of B (`--sweep`): the failing-parent count moves 44 -> 8 with the parameters (`capF` = share of its schedule the deeper levels must keep, `mix` = weight share), at the price of crushing the deepest levels: default (capF 0.35, mix 0.5): 28 / 26 · (0.2, 0.7): 14 / 7 · (0.1, 0.7): 13 / 7 · (0.05, 0.7): 8 / 3, where the deepest levels keep only 5 % of their schedule. None reaches zero.
- *Information only* (the 0.995 clamp rule would have to change; not proposed): the same B with radius limit 0.996 / 0.998 / 0.999 leaves 18 / 12 / 8 parents below 0.04. Even a 31 % larger budget does not remove them, so the budget is not the only cause.
- **Visual coherence** (`screenshots/layout2d-prototypes.png`, rows: whole tree and "syndrome" focused): production is a tangle of overlapping arcs. A gives the cleanest picture (colour wedges per family, no overlap) but crowds nodes along the rim. B keeps the wedges and separates siblings by staggered length, which gives a ragged "bar" outline in wide families (readable, less elegant than A); at depths 7–12 it is tight in both.
- Not assessed: the 3D layout, the real viewer (no pixels, labels or picking), phone performance. All numbers are hyperbolic distances; a distance of 0.04 is 1-2 px on a 1000 px disk at the centre, so the viewer's zoom and level-of-detail (step 2.4) still matter.

### Decision needed before any production change (nothing has been applied)
1. **Adopt B** (wedge rule + staggered rings + budget-aware lengths) knowing 28 deep/wide parents (1.8 %) stay below 0.04? The exception list could be shown in the tests rather than hidden. Parameters would be fixed first (default 0.35/0.5, or 0.2/0.7 for 14).
2. Or **change the targets**: e.g. require 0.04 only for parents above a depth or above a child count, and require 0.02 elsewhere.
3. Or **explore a hybrid / different rule** (e.g. A+B jointly choosing the base length and ring count per parent, or letting deep leaf-only subtrees relax the wedge). Relaxing the wedge compromises the no-overlap target, so I will not do that without your decision.
If B is adopted, the 2D layout fixed-edge-length rule in CLAUDE.md will be amended with the exact formula (it currently says the assumption is under review).

## Step 2.1 — Disease data layer  (complete; waiting for the user's approval before step 2.2)

### What was built
| File | Change |
|---|---|
| `src/diseasedata.js` (new) | the data layer: lazy `loadMetadata()` / `loadTerms()` / `loadEdges()` / `loadAll()` (each file fetched once, concurrent asks share one fetch, a failed load rejects with the file name and can be retried); `attachTree(nodes)` (primary tree from the display tree: primary parent / children / count per DOID, available before anything is loaded; `nodeFor(doid)`, `doidOf(node)`, groups map to nothing); `term(doid)` / `getTerm(doid)` (full read-only record); `parentsOf`, `childrenOf`, `ancestors`, `dagCount`; `resolve(text)`; `searchRecords()`; `provenance()`; `obsoleteReplacements()`; `parseReference`, `doidCandidates`; `dataLayerFor(json, loadJson)` (null for datasets without a data layer) |
| `tools/make_disease_tree.py` | the tree file now declares `dataLayer` (kind, metadata, terms, edges) and the metadata lists all five files. Regenerated: the terms, edges and licence files are byte-identical (the generator is deterministic); only the tree file's `dataLayer` line and the metadata `files` list changed |
| `src/main2d.js`, `src/main3d.js` | create the layer for datasets that declare one and attach the display tree; `__explorer.data` (null for the sample and WordNet). Nothing is loaded at start-up; no UI uses it yet (the panel is step 2.2) |
| tests | `tests/diseasedata.test.js` (new, in `npm test`), `tests/phone/data_audit.mjs` (new, `npm run test:data`) |

### A disease record
`doid, name, definition (null if missing), definitionReferences, synonyms [{text, scope}], alternativeIds, externalReferences [{raw, prefix, id, source, kind, external: true}], parents [{doid, name, primary}], children [{doid, name, primary}], primaryParent, additionalParents, counts {primaryCount, primaryDescendants, dagCount, dagDescendants, primaryChildren, dagChildren, parentCount, additionalParents}, missing {definition, synonyms, externalReferences}, source {ontology, version, releaseTag, license}`. Records are deeply frozen; accessors return copies.
Two counts, never mixed: **primaryCount** (the primary subtree incl. itself; the 8 families sum to 12,418 + the root = 12,419: anatomical 5,284, genetic 3,384, cellular proliferation 1,179, syndrome 1,058, physical disorder 521, mental health 492, infectious agent 443, metabolism 57) and **dagCount** (every disease reachable through any `is_a` path incl. itself; overlaps; metabolism 904). Without an attached tree the primary fields are `null`, never guessed.
Source labels for identifiers (ICD-10-CM, ICD-9-CM, ICD-11, ICD-O, MeSH, OMIM, UMLS, NCI Thesaurus, Orphanet, SNOMED CT (US), MedDRA, GARD, EFO, KEGG) are labels only; unknown prefixes keep their own name. No URLs are generated and nothing is fetched or interpreted.

### Results (all executed)
- **`node tests/diseasedata.test.js`** (strict, real files, call-logging loader), all pass:
  - *Lazy loading:* creating the layer and the sample / WordNet fetch nothing; asking before loading is a clear error; metadata alone fetches only its 8 KB; five concurrent asks fetch each of the 3 files exactly once; no refetch; a failed load is retried.
  - *Integrity:* 12,419 active terms, every one named, no duplicate DOIDs, the term DOIDs equal the tree DOIDs exactly; 17,635 edges (= metadata), both ends exist, no self loops or duplicates, the root has no parent and every other disease has one, acyclic and every term reachable; 4,880 multi-parent diseases; 5,217 additional parent links (= edges − (terms − 1)).
  - *Hierarchies kept apart:* (both display caps) the primary parent of every disease is one of its `is_a` parents and exactly one parent is flagged primary; primary children are DAG children; additional parent links total 5,217 and none is lost; primary children total 12,418; the DAG count is never smaller than the primary count; **the DAG count equals the independently generated `size` of the tree file for all 12,419 diseases**; metabolism 57 / 904; the families' primary counts sum to 12,419 and their DAG counts overlap (sum > 12,419); returned arrays are copies and records are read-only.
  - *Missing fields:* 2,270 without definition, 3,822 without synonyms, 687 without cross-references (= the generator statistics): `null` / `[]` plus a `missing` flag; every field of all 12,419 records equals the file exactly (19,985 synonyms with scope, 39,556 references, 1,475 alternative ids; 4,430 diseases with an ICD reference, 4,014 with MeSH); synonym scopes are valid; unknown DOID -> `null`.
  - *Relationship resolution:* all 17,635 edges symmetric (parents <-> children), names resolved, every disease descends from the root, every primary ancestor is a DAG ancestor, a disease with 6 parents lists all 6 (1 primary + 5 additional).
  - *Lookup:* DOID in 3 spellings (`DOID:4`, `doid:4`, `4`; padded and unpadded numbers), all 1,475 alternative ids, the 35 obsolete ids that have a replacement -> their replacement (2 more only name "consider" suggestions), 677 sampled references (exact, lower case and without the dated SNOMED suffix), 400 names (case-insensitive), 450 synonyms; nonsense / empty / unknown id -> no result.
  - *Search metadata:* 12,419 records ordered by DOID with normalised keys; synonym, reference and alternative-id counts equal the files; 3,822 / 687 records without synonyms / references; 4,430 / 4,014 with ICD / MeSH references.
  - *Provenance:* Human Disease Ontology 2026-10-29 (v2026-10-29), source URL, SHA-256, CC0 1.0 and its text file, download date, disclaimer; every record carries source + version + licence.
  - *Display tree, 2D and 3D:* every DOID maps to its real node at cap 36 and cap 24, groups map to nothing, list-only members have records, the data layer's primary parent is the one the tree draws through groups.
- **`npm run test:data`** (new, real headless Chrome, 34 checks, all pass): in 3D and 2D, desktop and phone emulation: the layer exists, nothing fetched at start-up, the primary tree answers before loading, loading fetches the 3 files exactly once (90–333 ms locally), 12,419 terms / 17,635 edges / version 2026-10-29, metabolism 57 / 904, ICD and alternative-id lookup, tree node and record agree, groups are not diseases; **the 3D and 2D viewers return identical records**; the sample and WordNet (2D and 3D) have no layer, fetch nothing of it and log no errors.
- **Regression:** `npm test` (20 steps incl. the new test) passes; `npm run build` succeeds (the five disease files are in `dist/data`); `npm run test:phone` 172 / 172; `npm run test:disease` 19; `npm run test:groups` 109; the 13 launch URLs (default, explicit sample / WordNet / disease, study) load the right data without errors.

### Known limitations (this step)
1. Nothing in the interface uses the layer yet (panel step 2.2, search step 2.7); `resolve()` is exact matching, not substring or fuzzy search.
2. The 5.3 MB terms file is fetched whole on first use: measured only against the local dev server, not over a real mobile network; no gzip / chunking and no memory measurement yet (a phone check belongs to the carried-forward real-device pass).
3. `dagCount` / `ancestors` are computed on demand by traversal (memoised); fast enough for one record at a time, not tuned for computing all counts at once in the viewer.
4. Only what the ontology file contains is exposed: no gene, protein, anatomical or other associations exist or were invented. Any future one needs its own source and version in the same way.
5. The carried-forward limitations above (2D labels / toolbar, Up through groups, phone member list, per-list caps, no physical-device test) are unchanged.

## Known limitations carried forward (recorded by the user after the S5 milestone; each must be resolved in the step named)
1. **2D viewer lacks labels and a toolbar.** 2D / 3D feature parity is NOT complete until the 2D viewer has labels, a toolbar (Home / Up / Back, search, info) and the other shared pieces. -> step 2.3b.
2. **Up passes through the intermediate display group.** From a member, Up goes to its navigation group first, then to the real parent. Reassess whether that is the most intuitive interaction (alternative: Up skips groups and goes to the real parent, with the group shown only as a way to open lists). -> decide in step 2.3b / 2.4 with the user.
3. **The phone member list overlaps part of the visualization.** Needs a responsive redesign (e.g. a bottom sheet that does not cover the focus) and physical-device testing. -> step 2.2 (disease panel) / 2.4.
4. **Display caps are per list, not a global visible-node budget.** Several lists can be on screen at once (the path to the focus) and 3D keeps its distance-based collapse. -> family overview and level-of-detail, step 2.4.
5. **Phone testing so far is browser emulation, not a physical device** (Chrome headless, touch + phone user agent). A real-device pass (Galaxy S26) is still owed for layout, member list, taps, performance. -> before step 2.4 is called done.

## Step 2.3a — S5 layout IMPLEMENTED in the shared architecture  (complete; waiting for the user's approval before step 2.1)

Decisions applied (user, after the prototypes): S5 with capF 0.2 and mix 0.7; alphabetical groups with transparent labels; display caps 36 desktop / 24 phone (display limits, not access limits; groups never all open by default); the 3 list-only parents as "+N" aggregates with a searchable member list; the global-depth radius schedule kept; exact hyperbolic distances and geodesic edges kept. The exact formula, parameters, grouping rules and known limitations are in CLAUDE.md ("Fixed edge length is relaxed for wide parents", "Navigation groups and display caps", "List-only parents", "Known limitations of S5").

### What was built
| File | Change |
|---|---|
| `src/mobius.js` | new exact helpers with plain-English comments and numeric examples: `mobiusAddFree` (no clamp), `hyperbolicDistanceExact` (acosh form; `hyperbolicDistance` clamps near the rim), `coshDistancePolar`, `wedgeAngleForTerritory` |
| `src/layout.js` | `computeLayout` is now S5: shares (mix 0.7), staggered rings (target 0.045, ring count by search), wedge rule, radius budget with `capF`; every node gets `edgeLength`; `S5` constants; optional `refine(node, api)` hook and `M` override; `nodePath` skips groups; `buildTree` keeps `doid` |
| `src/displaytree.js` (new) | shared display tree: adaptive alphabetical groups (`makeDisplayTree`, cap 36 / 24), labels (`runLabel`, `groupLabel`), list-only detection, `realMembers`. The real tree and all data files are never modified |
| `src/disclosure.js` (new) | the one rule both viewers use: a group is closed unless on the focus path; a list-only node is an aggregate unless on the path (then only the path member is drawn) |
| `src/memberlist.js` (new) | searchable member list of a list-only node; click = hyperbolic focus (2D and 3D); `theme.js` gets `MEMBERLIST_WIDTH_PX`, `MEMBERLIST_MAX_HEIGHT_VH` |
| `src/layout3d.js` | only `w ?? weight` for the angle shares (identical for plain trees). The 3D cone rule, schedule, picking and shaders are untouched |
| `src/main3d.js`, `src/main2d.js` | both load the display tree (`?cap=N` override; phone tier = 24); groups / list-only follow disclosure.js; group and "+N" orb labels (3D), info card for groups ("Navigation group ... not an ontology category"), real counts instead of display counts, groups are never search results; 2D hides nodes inside closed groups (scale 0, no edge, not pickable) and draws aggregates bigger and violet |
| tests | `tests/displaytree.test.js` (new, strict), `tests/layout.test.js` and `tests/disease_layout.test.js` updated, `tests/mobius.test.js` extended, `tests/phone/groups_audit.mjs` (new, `npm run test:groups`), `tests/phone/disease_audit.mjs` adapted to the display-tree node counts |

### Results (Disease Ontology; all measured by the tests below)
| | desktop (cap 36) | phone (cap 24) |
|---|---|---|
| display nodes | 12,584 = 12,419 diseases + 165 groups in 34 parents | 12,645 = 12,419 + 226 in 55 parents |
| display depth / max radius / clamped edges / overlapping subtrees | 12 / 0.9937 / 0 / 0 | 12 / 0.9937 / 0 / 0 |
| widest list of siblings (every node) | 36 | 24 |
| list-only nodes (children) | 3 (10 + 2 + 5 = 17): testicular yolk sac tumor, extrahepatic bile duct adenocarcinoma, intrahepatic cholangiocarcinoma | 5 (adds retinitis pigmentosa (23), iridocyclitis (5)) |
| "syndrome" (486) / "autosomal recessive disease" (1,048) | 15 / 30 groups or fewer, siblings >= 0.04 apart, every real child a member | 21 / more groups, same |
| 3D (same display tree): max radius / clamped / min sibling distance | 0.9911 / 0 / 0.0411 | 0.9911 / 0 / 0.0411 |
Sample (5,000 nodes): 0 groups at both caps (widest list 16), layout identical in 3D (`test:phone` 172/172 unchanged). WordNet: 4 groups at cap 36, 9 at cap 24; 0 list-only. The collapsible tree (`?mode=tree`) still shows the real, ungrouped tree (the study baseline is unchanged).
**Difference from the prototype:** 165 groups, not 166, at cap 36 (a mixed run of subtypes and groups is now ordered by where its entries start so that its label is true). The same 3 list-only parents. The "pure alphabetical over everything" variant that would have given the neatest labels was built and rejected: 17 list-only nodes (some groups) and display depth 13.

### Validation (all executed)
- **`npm test`**: all 19 steps pass, including the new strict `displaytree.test.js`, which checks on the Disease Ontology (both caps), the sample and WordNet: zero clamped edges (exact distance = stored edge length), zero subtree overlap, max radius <= 0.994, ids pre-order and `weight` = display subtree size, every real node present once, under its real parent (looking through groups), with its real data (name, DOID, real subtree size), every sibling set >= 0.04 apart except exactly the flagged list-only nodes, widest list <= cap, group integrity (alphabetical, complete, no DOID, labels true: every member inside the range and each label end the start of that end's name, paths made of real names), all 17,635 `is_a` edges still have both ends, the input JSON never modified, **disclosure** (groups open only on the focus path, never all open, <= cap siblings drawn, list-only members each individually reachable, 400 random nodes reachable), **stability** (see below), the **same display tree in 3D** (4 datasets/caps), and **still hyperbolic** (refocusing preserves pair distances to 2e-12; the siblings of a depth-7 parent look x32 bigger when it is focused than from the root; a radial chart gives x1).
- **Stability:** in 6 random expand/collapse states the largest displacement of any visible node is 0 in 2D and 0 in 3D when the layout uses the global depth; deriving the depth from what is visible would move nodes by up to 1.11.
- **`npm run test:groups`** (new, real headless Chrome, **109 checks, all pass**): in 3D and 2D, on desktop and on a phone emulation (touch, 412 x 915, taps instead of clicks): display tree loaded with the right cap (36 / 24) and all 12,419 diseases; at the root no group is open and no member is drawn; "syndrome" shows its groups as aggregate orbs; (3D) orbs carry their label and member count within the 25-label cap; a real click or tap on an orb focuses it and opens exactly that group (<= cap members drawn, the others stay closed); a member can be pointed at and focused (its group stays open, centred to r = 0); Up twice returns to "syndrome" and the group closes again; (3D) searching a disease inside a closed group jumps to it and opens only its group; every list-only node is an aggregate away from it, shows a member list of the right size when focused, the filter narrows and restores it, and **every one of its members can be focused from the list** (member drawn, siblings not, list stays); 150 random nodes reachable in the viewer; at no focus more than cap siblings drawn; `?cap=24` override; no console errors.
- **`npm run test:disease`** (19 checks) and **`npm run test:phone`** (172 / 172, the sample) pass; `npm run build` succeeds; the 13 launch URLs (default, explicit sample / WordNet / disease, study) still load the right data without errors.
- Screenshots inspected: `screenshots/groups-3D-desktop-syndrome-closed.png` (labelled orbs "A–I · 36"), `groups-3D-desktop-list-only.png` (member list), `groups-2D-desktop-group-open.png`, `groups-3D-phone-group-open.png`.

### Known limitations (honest)
1. Only 3 (desktop) / 5 (phone) parents are list-only; their members sit < 0.04 apart in 2D (3D has room: min 0.0411). The member list is a plain overlay; the real disease panel is step 2.2.
2. Group labels are alphabetical, not semantic. Subtypes and childless diseases are separate lists, hence the "with subtypes" wording, and two orbs can show overlapping ranges.
3. Display caps are per list. Several lists can be on screen at once (the path to the focus), and distance-based collapsing in 3D is unchanged; a global node budget and the family overview are step 2.4.
4. The 2D viewer is still the minimal one: no labels, no toolbar or search, orbs described only in the title line; "Up" (Backspace) goes to the DISPLAY parent, so from a member it first goes to its group. 2D / 3D parity is step 2.3b.
5. The calm visual theme is not applied yet (step 2.6): the galaxy look and the code-explorer wording remain.
6. The member list on a phone covers part of the picture; the layout of overlays on phones was not tuned. No real-phone check was made (headless Chrome emulation only).
7. WordNet 2D / 3D now show a few groups (study conditions with `?mode=2d|3d` on WordNet differ from before); `?mode=tree` and the sample are unchanged.

## Step 2.3a, round 2 — hybrid: B's wedge territories + aggregated groups / progressive disclosure  (RESULTS REPORTED, WAITING FOR THE USER'S DECISION; production code NOT changed)

Scripts (pure Node; `src/` untouched): `tools/proto/hybrid.mjs` (display-tree builder, strategies, states, stability, reachability, screen space; `--sweep`, `--export`, `--export-parents`), `tools/proto/layout2d_proto.mjs` (B itself, now factored into plan / spawn so a parent can TRY a candidate list; the earlier numbers are reproduced exactly), `tools/proto/render_hybrid.mjs`.
Images / coordinates: `screenshots/hybrid-prototypes.png` (rows: the 486- and the 1,048-child parent; columns: all children visible, groups closed, one group open with the focus on it, every group open), `screenshots/hybrid-two-parents.json` (disk coordinates of both parents and everything below them, for B-all and for the hybrid).

### What was tested
- **Groups are display-only.** A group is an index into real names: children WITH subtypes stay individual (or are cut into alphabetical runs of <= G if there are more than G), childless children ("diseases") are cut into alphabetical runs of <= G, a list longer than G is cut again. Label = first and last name of the run + member count. The real tree, `disease_edges.json` and all 12,419 terms are never modified. Checked on every layout: all 12,419 diseases reached, 0 duplicates, the nearest real ancestor of every disease in the display tree is its real primary parent (0 wrong).
- **S1** B, all children visible. **S2** B + static groups for every parent with more than K children (K = 36 and 24). **S3** = S2/S4 geometry seen through disclosure states (groups closed until opened): positions never depend on what is open. **S4a** hybrid adaptive: a parent tries "no groups" first and groups only as much as needed (largest group size G in {60..8} for which EVERY level it creates reaches the target spacing within the radius budget). **S4b** = S4a + angular shares that also follow the room a subtree needs (its widest level). **S5** = S4a + no parent may show more than `cap` siblings at once (cap 36 / 24), however well spaced.
- All use B's wedge territories and the rigorous 0.994 radius budget; the extra group level spends budget, so the layout is run again with the true display depth (it converges in 1-2 passes).

### Geometry (every node incl. groups; worst case: everything visible at once) — Disease Ontology
| | S1 B all | S2 K=36 | S2 K=24 | S4a adaptive | S4b +demand | **S5 cap 36** | S5 cap 24 |
|---|---|---|---|---|---|---|---|
| max radius / clamped edges / subtree overlap | 0.9939 / 0 / 0 | same | same | same | same | **0.9939 / 0 / 0** | same |
| aggregated groups (parents grouped) | 0 | 129 (33) | 223 (55) | 148 (16) | 149 (17) | **220 (40)** | 268 (56) |
| parents with siblings < 0.04 / < 0.02 | 28 / 26 | **78 / 76** | **76 / 76** | 9 / 9 | 9 / 9 | **9 / 9** | 8 / 8 |
| real children in those parents | 2,562 | | | | | **50** | |
| parents where no grouping could reach the target ("unresolved") | n/a | | | 4 (118 children) | 4 (144) | **3 (28)** | 4 (51) |
| longest edge | 2.81 | 2.14 | 1.64 | 2.49 | 2.45 | 2.14 | 1.64 |
- **Grouping everything (S2) is worse than B alone** (78 vs 28 parents below 0.04): it adds a level (radius budget) even where B already fit. The adaptive rule is what helps (28 -> 9).
- **Demand-aware shares (S4b) did not help** (same 9 parents, minimum 0.0001): not worth the complexity.
- The 9 remaining parents (S5) are all at depth 5-10, small (2-76 children, 50 children in all, 0.4 % of the diseases), and their ancestors have already spent 4-5.6 of the 5.8 budget: the angular room there is simply too thin ("angle starvation": room ~ weight share x e^path-length). Grouping cannot create room the budget does not have. Global minimum and closest pair stay 0.0002.
- Sensitivity of S5 cap 36 (`node tools/proto/hybrid.mjs --sweep`): `capF` = share of its schedule the deeper levels must keep, `mix` = weight share of the angle.
  | capF | mix | parents < 0.04 | unresolved (children) | groups | nodes with deeper levels shrunk below 50 % | min edge length |
  |---|---|---|---|---|---|---|
  | 0.35 | 0.5 (default) | 9 | 3 (28) | 220 | 3.3 % | 0.106 |
  | 0.35 | 0.7 | 5 | 2 (20) | 211 | 1.7 % | 0.106 |
  | **0.2** | **0.7** | **3 (17 children, closest pair 0.0039)** | 1 (10) | 166 | 5.5 % | 0.061 |
  | 0.1 | 0.7 | 1 | 1 (10) | 133 | 8.4 % | 0.061 |
  max radius stays 0.9937-0.9939, overlap 0 and clamped 0 in all rows (checked for 0.35/0.5 and 0.2/0.7). No edge is shorter than 0.06.
- **Sample and WordNet** (same S5 code, both parameter sets): 0 parents below 0.04, 0 overlaps, closest pair 0.0135-0.0204, max radius 0.990 / 0.988; sample gets 0 groups, WordNet 4. Unaffected for practical purposes.

### Disclosure states and the screen (Disease Ontology; nodes visible at once)
| state | S1 B all visible | S2 K=24 | **S5 cap 36** |
|---|---|---|---|
| overview (root + families + their children) | 630 visible, 44 % of nodes >= 6 px apart (min 2.0 px) | 77 visible, 100 % (min 8.5 px) | **68 visible (17 groups), 100 % (min 9.1 px)** |
| "syndrome" (486) opened | 630, 57 % >= 6 px (min 3.3 px) | 77 | **68, children shown as 17 groups: 100 % (12.9 px)** |
| ... + largest group opened and focused | same 486 on screen | 101 visible; region min 6.3 px, 100 % | **102; region min 5.8 px, 91 %** |
| "autosomal recessive disease" (1,048) opened | **1,779 visible**, 15 % >= 6 px, siblings only 0.0119 apart | 119 | **111 (24 groups): 100 % (16.1 px)** |
| ... + largest group opened and focused | same 1,048 on screen | 140; min 9.6 px, 100 % | **127; min 9.5 px, 100 %** |
| everything opened | | 1,210 visible, 6 % >= 6 px | 1,217 visible, **7 %** |
(screen = desktop disk of radius 500 px, zoom 1, focused region = visible descendants of the focus; at zoom 2 every state above reaches 100 % >= 6 px except the 1,048 parent's "everything open"; phone disk of radius 190 px: 11-12 px min at zoom 2 for the group views, 1-6 px at zoom 1.)
- **Minimum sibling separation among simultaneously visible sibling sets:** S5 cap 36 = 0.0450-0.0510 in every state (0.0450 target 0.045); S1 = 0.0450 (486) and 0.0119 (1,048).
- **Cross-group caveat:** with everything open, members of neighbouring groups can be closer than siblings: closest visible pair 0.0327 (486) and 0.0198 (1,048), against sibling distance 0.045. Opening all groups at once must be avoided by the level-of-detail rule (it would show 500-1,200 nodes at 1-3 px).
- **Reachability** (every real disease; visible nodes when only its ancestors are open): S1 mean 295, p99 1,207, max 1,265; **S5 cap 36 mean 66, p99 99, max 110** (S4a without cap: max 537). Deepest disease needs 11 expansions in all variants. Search can jump to any disease and open exactly its ancestors.
- **Layout stability:** expanding and collapsing never moves anything: in 6 random expand/collapse states per strategy the largest displacement of any visible node is **0** (the layout of a node depends only on its ancestors and siblings). It holds only if the schedule uses the GLOBAL depth; a layout that re-derived the depth from what is visible would move nodes by up to 0.5-1.3 hyperbolic units (median 0). Unrelated branches do not jump.

### Still hyperbolic, not a radial chart?
Yes. The same sibling pair looks (focus on its parent / focus on the root): x1.3-1.5 at 0.6 from the root, x7-8 at 2.4-2.5, x31-42 at 4.2-4.7, x65 at 5.4; a radial chart gives 1.0 everywhere. 76 % of all nodes lie beyond radius 0.9 when the root is focused (the rim compression of the Poincaré disk), distances are exactly the hyperbolic metric, edges are geodesics, positions come from the same Möbius machinery. What changes is only that a wide parent's children are reached through an intermediate level, like a sub-menu.

### Visual evaluation (`screenshots/hybrid-prototypes.png`)
All 486 or 1,048 children at once is a solid wedge. With groups closed the same parent is 17-26 or 24 rings with member counts; opening a group and refocusing on it spreads its members as a staggered radial line (readable, but a narrow "list-like" band, not an even fan: the price of keeping subtree territories disjoint).

### Remaining limitations
1. 3 parents (17 children, S5 with capF 0.2 / mix 0.7; 9 parents / 50 children with the defaults) stay below 0.04 hyperbolic separation (down to 0.0039). They would have to be shown as one list-only aggregate (members reachable by search, panel list and by focusing a member, which stays positioned); this must be reported in the UI, it is not a pass.
2. The groups are alphabetical runs of real names: they are navigable and honest but not semantic. No semantic grouping is available without outside knowledge, which the project rules forbid inventing.
3. For grouped parents the angular order is alphabetical (internal subcategories first), not DOID order, so those parents look different from ungrouped ones.
4. Zoom 1 on a phone (disk radius 190 px) still crowds even the group lists (20-63 % of nodes >= 6 px); zoom 2 or a cap of 16-24 is needed there.
5. The screen model is a simple scale of the disk (px = Euclidean distance x radius x zoom), not the real camera; labels, node sizes and picking were not simulated.
6. The aggregation is a layout/representation idea only: the level-of-detail rule, the group UI and the list-only fallback are step 2.4 work.

### Recommendation (for the user to decide)
**S5: B's wedge territories + adaptive aggregated groups + a cap of 36 simultaneous siblings (24 on phones), progressive disclosure through a pure LOD module, parameters capF 0.2 and mix 0.7.** Evidence: zero clamped edges, max radius 0.9937, zero subtree overlap, the 486 and 1,048 parents resolved (0.045 minimum sibling), overview 68 nodes instead of 630, worst-case disclosure 110 visible nodes instead of 1,265, stable under expansion, still strongly hyperbolic, and only 3 parents / 17 children (0.1 %) unresolved. Not recommended: S2 (worse than B), S4b (no gain), the default parameters (9 parents unresolved for no benefit).
Decision needed: (1) adopt S5 with capF 0.2 / mix 0.7? (2) alphabetical groups acceptable? (3) cap 36 desktop / 24 phone? (4) how to present the 3 list-only parents (a "+N" aggregate with a member list)? If adopted, the 2D layout rule in CLAUDE.md will be amended with the exact formula, then implemented in `layout.js` with tests (step 2.3a implementation); nothing in production has changed yet.

## Phase 0 — Freeze and prepare existing engine  (done)

### Inspection (read before changing anything)
| Engine area | Where |
|---|---|
| Möbius maths 2D / 3D | `src/mobius.js`, `src/mobius3d.js` |
| Layout 2D / 3D (+ symbol galaxies) | `src/layout.js`, `src/layout3d.js` |
| GPU refocus, impostor nodes, edges, fog | `src/glsl.js` (uniform `_Focus`), built in `src/main3d.js` |
| Labels, search, minimap, study logging | `src/labels.js`, `src/search.js` + `searchui.js`, `src/minimap.js`, `src/study.js` + `studylog.js` |
| Camera / navigation, back stack, path highlight | `src/navigation.js`, `markPath` in `main3d.js` |
| "+N" collapsed groups | semantic-zoom code in `main3d.js` (`collapsedNodes`) |
| Code-specific | `src/symbols.js`, `codepanel.js`, `codecontext.js`, `links.js`, `heat.js`, info-card code rows, Imports/Calls/Dependencies chips |

Before this phase the code features were gated by `hasCode = symbolFiles.length > 0` (a code-repo guess inside `main3d.js`) and heat
by whether git data happened to exist; the H/I/K/D keys worked regardless.

### Done
- [x] CLAUDE.md rewritten for the Atlas (goal, 9 principles, capability rule); all engine rules kept.
- [x] This roadmap.
- [x] `src/capabilities.js`: `deriveCapabilities(json)` -> `{ symbols, codePanel, gitHeat, dependencies, source, warnings }`.
      A tree JSON may declare `"capabilities": [...]`; legacy files (sample repo, WordNet) are inferred from fields they already
      have, so no data file changed. Declared-but-unbacked capabilities switch off with a warning; unknown names are ignored with a warning.
- [x] `main3d.js` / `toolbar.js` read `caps` instead of `hasCode`: Imports/Calls/Dependencies chips, arcs help card, link loading and I/K/D keys
      need `dependencies`; Heat button, heat computation and H key need `gitHeat`; code panel needs `codePanel`; symbol files, search of
      symbols and code rows in the info card need `symbols`. Nothing deleted; `window.__explorer.capabilities` exposes the result.
- [x] `tests/capabilities.test.js` (added to `npm test`).

### Acceptance checks (actual results)
- `npm test`: **passes** (all 16 steps incl. the new capabilities test and 46,670 scanner checks).
- `npm run test:phone` (real headless Chrome, sample dataset): **172 / 172 passed**, no console errors.
- Ad-hoc headless Chrome probe (desktop 1200x800, results not saved as a test): WordNet (3,000 nodes) loads, caps all false, toolbar shows no
  Imports/Calls/Dependencies/Heat buttons, help line has no code keys, pressing H/I/K/D does nothing, no console errors. Sample (5,000 nodes)
  loads, all four caps true, Dependencies + Heat buttons shown, H works.
- Not done: the probe is not part of the repo test suite (WordNet is covered in the browser only by that probe); no real-phone check. `npm run build` succeeds.

## Phase 1 — Disease Ontology data ingestion  (data done; clamp fixed; LOD issue open)

### Source and provenance
- Human Disease Ontology (DOID), OBO Foundry, release **2026-10-29** (GitHub tag `v2026-10-29`, file date 29:10:2026 18:39).
  URL: `https://raw.githubusercontent.com/DiseaseOntology/HumanDiseaseOntology/v2026-10-29/src/ontology/doid.obo`
  (the OBO Foundry PURL `http://purl.obolibrary.org/obo/doid.obo` redirects to the newest file of this repository; the versioned tag is used so the result is reproducible).
- Downloaded 2026-11-11, 7,313,592 bytes, sha256 `b208a1bc910ba681...` (full hash in `disease_metadata.json`). Licence: **CC0 1.0 Universal**; text saved as `public/data/disease_LICENSE.txt`.
- The raw OBO is cached in `tools/cache/` (git-ignored, not committed). Re-run: `python3 tools/make_disease_tree.py` (`--tag latest` for the newest release).

### Generated files (`public/data/`)
| File | Size | Content |
|---|---|---|
| `disease_tree.json` | 1.2 MB | primary hierarchy (name, type, size, doid, children), `"capabilities": []`, intro words "Disease group / Disease" |
| `disease_edges.json` | 0.5 MB | ALL 17,635 `is_a` edges of the active ontology as `[child, parent]` DOID pairs |
| `disease_terms.json` | 5.3 MB | per disease: name, definition (+ its source refs), synonyms with scope, cross-references, alt ids. Not read by the viewer yet |
| `disease_metadata.json` | 8 KB | source, version, licence, download date, counts, parsing statistics, validation, obsolete -> replacement map, the primary-parent rule |
| `disease_LICENSE.txt` | 7 KB | CC0 1.0 legal code + provenance header |

**Primary-parent rule** (deterministic, documented in the script and the metadata): shortest `is_a` distance of each parent to the root DOID:4 (breadth-first search);
the parent with the smallest distance wins; ties go to the smaller numeric DOID. So a disease's tree depth equals its shortest distance to the root. Every other parent link stays in `disease_edges.json`.
`size` of a node = distinct diseases below it in the FULL graph + itself. Nothing is invented: a missing definition/synonym/xref stays missing.

### Ontology statistics (actual)
| | |
|---|---|
| `[Term]` stanzas in the file | 14,939 |
| obsolete terms removed | 2,520 |
| **active terms (all kept, none dropped)** | **12,419** |
| obsolete terms that name a `replaced_by` | 35 (all 35 point at an active term: "replacements resolved") |
| `is_a` edges that pointed at an obsolete term | **0** (so no edge needed redirecting, and none was lost) |
| `is_a` edges preserved | 17,635 (0 duplicates merged) |
| diseases with 1 / 2 / 3 / 4+ parents | 7,538 / 4,595 / 247 / 38; **4,880 multi-parent diseases** (up to 7 parents) |
| maximum depth, primary tree (shortest path) / longest path in the DAG | **12** / 13 |
| nodes per depth 0..12 | 1, 8, 621, 1089, 2021, 4309, 2513, 1171, 493, 134, 55, 3, 1 |
| top-level branches (children of `disease`) | 8: anatomical entity 9,295 · genetic disease 5,314 · cellular proliferation 2,857 · syndrome 1,083 · metabolism 903 · mental health 632 · physical disorder 629 · infectious agent 546 (descendant counts, overlapping because of multi-parent terms) |
| missing definition / synonyms / cross-references | 2,270 / 3,822 / 687 |
| terms with an ICD xref / MeSH xref / alt ids | 4,430 / 4,014 / 803 |

### Validation (script + independent `tests/disease_data.test.js`, both pass)
Duplicate ids 0 · missing parent references 0 · cycles 0 · disconnected terms 0 · terms without a parent besides the root 0 · wrong primary parents 0 ·
tree contains every active term (12,419 = 12,419) · every tree edge is a real `is_a` edge · primary parents re-derived independently in JS · depths equal shortest distances.

### Compatibility with the existing viewer (hyperbolic layout and rendering NOT modified)
Measured in headless Chrome on the M-series laptop GPU (not the S26), `?tree=disease_tree.json`:
| | desktop 1280x800 | phone emulation 412x915 |
|---|---|---|
| nodes loaded / max depth | 12,419 / 12 | 12,419 / 12 |
| capabilities | all four **off** (declared `[]`), no Imports/Calls/Deps/Heat buttons, H/I/K/D do nothing | same |
| visible at the root (nodes drawn) | **8,488** (target ~3,000) | 8,488 |
| collapsed "+N" orbs at the root | 234 | 234 |
| draw calls | 7-9 (limit 30) | 7-9 |
| frame rate | 60 (vsync cap; 120-frame average 60.1-60.3) at root, a branch, depth 9 and depth 12 | 60.2-60.3 |
| JS heap | 36-57 MB | 36-57 MB |
| console errors | none | none |
Visible nodes elsewhere: top branch (anatomical entity) 7,972 / 302 orbs; deep node at depth 9: 85 / 28; at depth 12: 188 / 40. Memory is `performance.memory` (Chrome only, coarse).

### ISSUE 1 (FIXED, see "Phase 1 fix" below): the 0.995 radius clamp was triggered
- With edge length 0.7 a depth-12 tree does not fit: radius along a straight line is tanh(12*0.7/2) = 0.9996 > 0.995. Layout result (`tests/disease_layout.test.js`):
  max radius 0.9950; **93 nodes (0.75 %) sit exactly on the rim, their edges are shortened** (depth 9: 38, depth 10: 51, depth 11: 3, depth 12: 1). Max radius per depth: 0.34, 0.60, 0.78, 0.88, 0.94, 0.967, 0.984, 0.992, 0.995 (depth 9 onwards).
  Those nodes are pinned at the rim, so some of them overlap/are hard to tell apart. No node is lost; positions stay finite.
- The shallow-parent rule already minimises depth (the longest DAG path would be 13).
- Evidence for the fix options (layout run with the existing `edgeLength` option, nothing in the source changed):
  | edge length | max radius | clamped edges | min sibling distance |
  |---|---|---|---|
  | 0.70 (now) | 0.9950 | 93 | 0.0464 |
  | 0.55 | 0.9950 | 1 | 0.0279 |
  | 0.50 | 0.9940 | 0 | 0.0219 |
  | 0.45 | 0.9895 | 0 | 0.0166 |
- **Proposal** (not implemented): (A) simplest: for this dataset use edge length 0.5 (a per-dataset option read from the tree JSON, default 0.7 so the other datasets are untouched). It fixes the clamp but halves the room between siblings (0.046 -> 0.022), which the existing fit-to-neighbours sizing absorbs but crowds the rim.
  (B) better: a depth-tapered edge length, e.g. L(d) = 0.7 for the first levels shrinking geometrically so the sum over 12 levels stays under atanh(0.995) = 2.99 (the shallow, crowded levels keep their room; only the thin deep tail gets shorter). This changes `layout3d.js` and the matching CPU/GPU picking assumptions, so it needs your OK.
  (C) do nothing: 0.75 % of nodes stay on the rim. I recommend B, with A as the quick fallback.
- (The strict check mentioned here is now always on, see below.)

### ISSUE 2 (measurements, no change made): too many nodes drawn at the root
8,488 nodes are drawn at the root, 2.8x the ~3,000 target, because the semantic-zoom collapse only folds 234 groups. Frame rate is still a locked 60 with 9 draw calls on a laptop GPU, but that says little about the S26.
Labels stay capped at 25. Proposal for a later phase (not done, no term is deleted): collapse by hyperbolic distance and importance at the root (e.g. folding depth >= 5 groups beyond a distance threshold into "+N") so ~3,000 are drawn, expand progressively on approach. Needs a measurement on the phone first.

### Other notes
- The viewer's "Search files, folders and functions" tooltip, "Back", info-card labels etc. still use code wording (UI redesign is not part of this phase). Search only indexes names (no synonyms or DOIDs yet: Phase 2/3).
- `size` in the tree is the DAG descendant count; the sizing code uses node counts of the primary tree, so multi-parent terms are not double counted in the layout.
- The Disease Ontology shows in the viewer via `?tree=disease_tree.json` (the default dataset is still the sample, the switch is a later step).

### Tests run (Phase 1)
- `npm test`: all steps pass, incl. new `disease_data.test.js` (12,419 terms, 17,635 edges, 4,880 multi-parent, depth 12) and `disease_layout.test.js` (reports the clamp, see above), 46,670 scanner checks.
- `npm run build`: succeeds, the five disease files are copied to `dist/data`.
- `npm run test:phone` (real headless Chrome, sample dataset): **172 / 172**.
- Headless Chrome probes (ad hoc, not saved as tests): WordNet 3,000 nodes loads, caps all off, no errors; sample 5,000 nodes loads, all four caps on; Disease Ontology as in the table above.
- Not done: real phone, search/navigation on the disease tree beyond refocusing through `__explorer.focusOn`, no screenshots reviewed by eye.

## Phase 1 fix — depth-tapered edge length  (done)

**Rule** (`edgeLengthSchedule` in `src/layout.js`, used by BOTH `computeLayout` (2D, base 0.6) and `computeLayout3d` (3D, base 0.7)):
a node is never further from the root than the sum of the edge lengths on its path, and a point at hyperbolic distance D has Euclidean radius tanh(D/2). So if the sum over the deepest path stays below
BUDGET = 2·atanh(0.994) = 5.806, no node can reach the 0.995 clamp, for any tree. The schedule, from depth `k` and the tree's maximum depth `M` only (no per-disease numbers):
- If `base × M <= BUDGET` every edge keeps `base`. This holds for the sample repo and WordNet (depth 8: 5.6), so **they are laid out exactly as before** (all their existing tests are unchanged and pass).
- Otherwise edges into depth `k <= K0` keep `base` and deeper edges are `base · ρ^(k−K0)`, with `K0 = min(floor(M/2), floor(BUDGET/base) − 1)` and ρ found by 60-step bisection so that the total is exactly BUDGET (deterministic).
- Disease Ontology, 3D (M = 12): K0 = 6, ρ = 0.73: edge lengths by depth 1..12 = 0.700 ×6, then 0.511, 0.373, 0.272, 0.199, 0.145, 0.106.

**What changed in the code** (the Möbius/hyperbolic formulas themselves are untouched):
- `layout.js`: `edgeLengthSchedule`, `treeDepth`, `EDGE_RADIUS_LIMIT`; `computeLayout` uses a per-depth length and stores `node.edgeLength` (new optional 3rd parameter `lengths`, used only by tests to reproduce the old layout).
- `layout3d.js`: `placeChildren` uses each child's own edge length for its position AND for the cone rule (`coneAngleForTerritory(territory, child.edgeLength)`, which needs the child's real distance from its parent to keep a subtree inside its territory); `layoutSymbols` uses the file's own edge length (code datasets: identical to before).
- **Nothing else needed changing, by design:** drawing (instance buffers, GPU `mobiusAdd3` refocus, edge shader geodesics), picking (`projectNode`), hit-testing, the minimap, the "fit" sizes and navigation all read the node positions (`node.pos` / `node.z`) and never assumed an edge length (grep: no use of `EDGE_LENGTH` outside the layout files). This is verified, not assumed, by the browser audit below.

**Results on the full tree (12,419 nodes, nothing removed; all 17,635 `is_a` edges untouched in `disease_edges.json`)** — `node tests/disease_layout.test.js`:
| 3D layout | max radius | clamped edges | min sibling distance | closest pair of any two nodes | min sibling at depth <=6 / 7-9 / 10-12 |
|---|---|---|---|---|---|
| uniform 0.7 (old) | 0.9950 | **93** | 0.0464 | 0.0277 | 0.0464 / 0.1242 / 0.3080 |
| uniform 0.5 | 0.9940 | 0 | 0.0219 | 0.0110 | 0.0219 / 0.0366 / 0.1082 |
| **taper (new)** | **0.9912** | **0** | **0.0464** | **0.0277** | 0.0464 / 0.0704 / 0.0661 |
| 2D uniform 0.6 (old) | 0.9950 | 2 | 0.0007 | | |
| **2D taper (new)** | **0.9894** | **0** | 0.0007 | | |
- The global minimum sibling distance and closest pair are **identical to the old 0.7** (they sit on the crowded upper levels, which keep 0.7) and about twice as good as uniform 0.5.
- **Loss of separation:** only at the deep end. Siblings at depths 7-9 are 1.8x closer than before (0.070 vs 0.124) but still 1.9x better than uniform 0.5; at depths 10-12 they are 4.7x closer than uniform 0.7 (0.066 vs 0.308) and slightly closer than uniform 0.5 (0.066 vs 0.108, because those edges are only 0.11-0.27 long). Only 193 of 12,419 nodes (1.6 %) are at depth >= 9, and node sizes already follow the nearest-neighbour distance ("fit"), so cores do not overlap.
- 2D: its minimum sibling distance of 0.0007 exists with and without the taper (the 2D layout has no cone rule; it is unrelated to depth and unchanged). 2D shares the schedule shape: taper starts at the same depth (K0 = 6) with its own base 0.6.

**Tests added / changed**
- `tests/disease_layout.test.js` (in `npm test`, now always strict; `STRICT=1 node tests/disease_layout.test.js` passes): schedule properties for bases 0.7/0.6/0.5 and every depth 1-40 (sum <= budget, tanh(sum/2) < 0.995, never grows with depth, full length on the top level, exact budget use, uniform when it fits, deterministic); sample and WordNet keep the uniform lengths; 3D and 2D disease layouts: 0 clamped edges, radius < 0.995, every edge equals its scheduled length, upper levels exactly 0.7, maximum-depth node inside the ball; 2D and 3D have the same parents and the same taper depth; comparison table above. A sanity check asserts the old uniform layout really did clamp (93 / 2 edges).
- `tests/phone/disease_audit.mjs` (`npm run test:disease`, real headless Chrome, desktop 1280x800, full disease tree): **17 / 17 passed.** 3D: layout numbers read from the live nodes (max radius 0.99125, 0 bad edges, 1,857 edges on tapered levels); GPU-vs-CPU positions out to radius 0.994 (max position error 1.4e-6); picking at the root, a big depth-2 branch, a depth-9 node, the parent of the deepest node and the deepest node (every on-screen neighbour picks itself or the front sphere that truly covers it: 0 wrong picks; the focus is centred to r = 0); drawn edges = predicted edges at the root, depth 9 and depth 12 (0 stray pixels, 0 missing); a real mouse click on the depth-12 node focuses and centres it exactly; 12 clicks on Up walk the 12 ancestors in order to the root. 2D: same layout numbers (max 0.98942, 0 bad), 10 of 10 real mouse clicks on shallow and deep nodes refocus exactly that node. No console errors in either mode.
  (While writing it I loosened one rule: the "focus node picks itself" check was dropped because at the root a nearer child sphere correctly covers the centre; the focus is instead part of the general "picks itself or the covering front sphere" check, and its exact centring is checked separately.)
- Also run: `npm test` (all pass), `npm run build`, `npm run test:phone` **172 / 172** on the sample, WordNet (3,000 nodes, caps off) and sample (5,000, caps on) load without errors.

**Remaining limitations**
- Depth-12 branches are visibly more compact than the upper levels (the taper is geometric); the Disease Ontology's deepest edges are 0.106 long (vs 0.7). A node's label may overlap more there. Judged on one screenshot of the deepest node only (looks fine), not studied.
- A deeper future ontology would taper more strongly (the budget is fixed); a tree deeper than about 30 levels would get very short edges. Not an issue for DOID (12).
- ISSUE 2 (8,488 nodes drawn at the root vs ~3,000) is unchanged and still open. No test on the real phone.

## Phase 1 — default launch switched to the Disease Ontology  (done)
Why: opening the dev server showed the old code explorer, because `'sample_tree.json'` was the hardcoded fallback in four files.
- New `src/dataset.js`: `treeFileFromUrl(params)`, the ONE place that decides which tree file a page loads, used by `main3d.js`, `main2d.js`, `maintree.js` and `study.js` (so they cannot disagree).
  - `?tree=name.json` always wins (`sample_tree.json`, `wordnet_tree.json`, `disease_tree.json`, anything in `public/data/`).
  - No `?tree=` -> **`disease_tree.json`** (3D, 2D `?mode=2d` and collapsible tree `?mode=tree`).
  - No `?tree=` but `?study=1` -> **`sample_tree.json`**, deliberately: the study tasks are `public/study/tasks_sample.json` / `tasks_wordnet.json` (picked from the tree name) and there is no task file for the disease data, so an existing study link keeps loading exactly the dataset it always did. A study on the disease data needs its own task file and an explicit `&tree=disease_tree.json`.
- `index.html` title: "Hyperbolic Disease Atlas". (Not changed, not asked: `public/manifest.webmanifest` still says "Hyperbolic Data Explorer" / "HyperExplorer", and the intro card still has the code-repository wording of the first-visit text.)
- `tests/phone/audit.mjs`: the four page loads that relied on the default now say `&tree=sample_tree.json` explicitly (the fifth already named `zz_cut_tree.json`). No other test or script relied on the default.
- No change to the layout mathematics, the disease data or any visualization code.
- Tests: `npm test` pass; `npm run build` ok (title in `dist/index.html` is the new one); `npm run test:phone` **172 / 172**; `npm run test:disease` **all pass**.
- Browser check (headless Chrome, resource list + `__explorer` node count, 13 URLs, no console errors in any): default 3D / 2D / tree -> `disease_tree.json` (12,419 nodes); explicit `?tree=sample_tree.json` in 3D, 2D and tree -> 5,000 nodes; `?tree=wordnet_tree.json` in all three -> 3,000 nodes; explicit `?tree=disease_tree.json` -> 12,419; `?study=1` (3D and tree, no `tree`) -> sample + `tasks_sample.json`; `?study=1&tree=wordnet_tree.json` -> WordNet + `tasks_wordnet.json`. Page title was the new one in all of them.
- Open the Atlas: `http://localhost:5173/hyperbolic-explorer/` (the `/hyperbolic-explorer/` base path is required).

---

# History: Hyperbolic Code Explorer (engine phases, all before the pivot)

## Phase 1 — Python scanner + 2D Poincaré disk viewer  ✅ done

- [x] Branch renamed `master` → `main`
- [x] Vite + three.js project; `vite.config.js` base `/hyperbolic-explorer/`; `npm run deploy` (build + gh-pages)
- [x] `tools/scan_folder.py` — folder → JSON (ignores `.git`, `node_modules`, hidden files, symlinks)
- [x] `tools/make_sample_tree.py` — seeded fake tree, 5,000 nodes → `public/data/sample_tree.json`
- [x] `src/mobius.js` — Möbius addition, hyperbolic distance, geodesic interpolation, clamp (+ `distanceToRadius`, `mobiusScale`)
- [x] `src/layout.js` — root at centre, fixed edge length, angular slices ∝ subtree node count
- [x] `src/main.js` — orthographic three.js render, instanced circles (1 draw call), geodesic edges (1 draw call),
      click-to-refocus (0.5 s, ease-in-out, along the geodesic), Backspace = parent, name + path overlay
- [x] Tests: `npm test` (mobius numeric checks, layout checks on the 5,000-node tree)
- [x] Checked in headless Chrome: click focuses a node and centres it exactly; Backspace walks up to the root; no console errors

### Known limitations (deliberate for Phase 1)
- Files in a crowded fan overlap and look like smears; no labels on the disk yet (Phase 3).
- All geometry is recomputed on the CPU each animation frame (GPU transform comes in a later phase).
- Not yet tested on the phone.
- No fps counter yet.

## Phase 2 — 3D Poincaré ball layout + geodesic animation  ✅ done

- [x] `src/mobius3d.js` — vector Möbius addition, distance (closed arcosh form), `distanceToRadius`,
      `mobiusScale3`, `geodesicLerp3`, `clampToBall`, `conformalFactor3`, `coneAngleForTerritory`
- [x] `src/layout3d.js` — root at centre, fixed edge length 0.7, children on a Fibonacci spiral over a cap that
      faces away from the parent (root: whole sphere). Each child's territory = ½ equal share + ½ weight share;
      its own cap is sized with tan(θ/2) = e^−d·tan(β/2) so whole subtrees stay inside their territory
- [x] `src/main3d.js` — perspective camera + OrbitControls around the centre, instanced spheres (1 draw call),
      geodesic edges (1 draw call), faint ball shell; click (screen-space pick, front-most wins) refocuses along
      the geodesic in 0.5 s ease-in-out; Backspace = parent; size ∝ (1 − r²)/2; name + path overlay
- [x] `src/main.js` is now a router: 3D by default, `?mode=2d` loads the unchanged Phase 1 viewer (`main2d.js`)
- [x] `src/fps.js` — fps counter in both modes (F to toggle, `?fps=1` to show at start)
- [x] Tests (`npm test`): 3D math (undo, isometry, geodesic midpoint/quarter point, matches 2D in the plane,
      cone rule checked geometrically), 3D layout on the 5,000-node tree
- [x] Headless Chrome (M4 laptop, ANGLE/Metal): no console errors; click centres the node exactly; Backspace
      walks up to the root; dragging rotates without refocusing; 3 draw calls; 3D 60 fps idle and 60 fps while
      animating nonstop (vsync cap); 2D still works at `?mode=2d`. Per-frame CPU work while animating ≈ 1.8 ms

Layout numbers on the sample tree: max radius 0.9912 (limit 0.995), 0 edges clamped,
min sibling distance 0.172, min distance between ANY two nodes 0.130 (was 0.005 before the cone rule).

### Known limitations (deliberate for Phase 2)
- Refocusing between two off-centre nodes can turn the scene slightly as it moves (Möbius additions in 3D
  combine into a translation plus a small rotation). Fine on a desktop; must be fixed for VR ("never rotate
  the user's view"), e.g. with the Lorentz camera matrix planned for free flight.
- Deeper trees (depth > ~9) would start reaching the 0.995 clamp with edge length 0.7.
- Not yet tested on the phone. Plain spheres/lines, no labels (Phase 3).

## Phase 3 — Visual polish, "galaxy" theme  (in progress)

### 3a — Nodes, GPU refocus, atmosphere  ✅ done (waiting for phone/laptop check)
- [x] `src/glsl.js` — all shaders: GLSL `mobiusAdd3`, node vertex/fragment (impostor quads), nebula + starfield, shell rim
- [x] Nodes: ONE instanced mesh of camera-facing quads (`InstancedBufferGeometry`, custom `ShaderMaterial`, additive
      blending, no depth). Folders = star (bright core, soft halo, Fresnel rim, tiny specular); files = tiny twinkling
      points (~7 % bright). Pixels outside the quad's circle are `discard`ed
- [x] GPU refocus: `_Focus` uniform + `mobiusAdd3` in the vertex shader; size factor (1−r²)/2 and hyperbolic-distance
      fog (brightness e^(−d/2), colour cools toward blue) also in the vertex shader. Animation is still 0.5 s ease-in-out
      on the geodesic (the CPU still steps the focus point; the GPU applies it)
- [x] CPU maths kept (picking, edges, tests). `await __explorer.gpuCheck()` renders 2,048 random point pairs through the
      shader and compares with the CPU: max position error 7e-7, max distance error 3e-5 (float32 vs double) ✔
- [x] Data hooks: per-instance `aHue`, `aEnergy`, `aFlag` (+ `aKind`, `aSeed`, `aId`). Phase 3 fills hue from the top-level
      "arm", energy = ln(subtree size)/ln(tree size), flag = 0. `aFlag = 1` already draws a magenta ring, so Phase 6
      only changes numbers
- [x] Arms: each child of the root gets a hue evenly spaced on the colour wheel, inherited by its whole subtree;
      far nodes rotate their hue toward blue and dim; the focus is a gold-white "sun"
- [x] Fake bloom: one extra instanced mesh of big soft additive quads behind the focus + its heaviest children
      (max 64, 16 in low quality). No post-processing
- [x] Procedural nebula (2 fbm noise fields in violet/teal/indigo) + 2-layer starfield on a big sphere that follows the
      camera; the ball's shell is now only a faint Fresnel rim (no solid disc)
- [x] `?quality=low`: 16 halos, 2 noise octaves, 1 star layer, pixel ratio capped at 1 (dust count is in the config,
      used in 3b)
- [x] `?mode=2d` untouched

Numbers (headless Chrome, M4 laptop GPU via ANGLE/Metal, 1000×800, 5,000 nodes):
| | high | low |
|---|---|---|
| draw calls | 5 (nodes, halos, edges, nebula, shell) | 5 |
| vsync fps (idle and animating) | 60 | 60 |
| uncapped fps, idle | ≈ 550 (≈ 1.8 ms/frame) | ≈ 640 (≈ 1.6 ms/frame) |
| uncapped fps, animating | ≈ 175–225 (≈ 5 ms/frame) | ≈ 190–210 |
The M4 is far faster than the phone, so the low/high gap here is small; the phone is the real test.
While animating, the extra ≈ 3 ms is the CPU rebuilding the edges, which moves to the GPU in 3b.

Interim in 3a: edges are still the CPU polylines from Phase 2 (faint additive blue), so they are not yet tinted by arm.

### 3a-tweaks — look pass before 3b  ✅ done (waiting for phone/laptop check)
- [x] Shell removed. Replaced by a haze billboard whose brightness is (1 − q)² (q = 0 centre, 1 boundary), so it
      fades to nothing with no edge
- [x] Palette: arm hues only teal 0.47 → indigo 0.67 → magenta 0.87 (shared out over the FOLDER arms only; loose
      root files are violet). Saturation 0.9 → 0.78, cooling toward blue reduced. Warm gold only on the focus
- [x] Sun: its own billboard (`SUN_*` shaders): hot white core, gold inner glow, large faint corona, 6 + 4 soft rays
      from cos(3a), cos(2a), slow rotation, ±8 % pulse. The focus node's solid ball is also whiter (95 %)
- [x] Size variety: folder energy = ln(weight) rescaled 0..1 over all folders; radius × (1 + 2·energy), so the biggest
      folder is 3× the smallest. ~10 % of folders (seed ≥ 0.9) are "heroes": 25 % bigger, ≈ 2× brighter
- [x] Edges pulled forward from 3b because thick lines need quads: ONE instance per edge, the vertex shader builds the
      geodesic (10 segments, 6 in low) from both endpoints and `_Focus`, pushes the vertices sideways in screen
      space for width (1.8 px base, 0.55×–1.45× with fog), tint = arm colour, brightness 0.05 + 0.75·e^(−0.45 d).
      The CPU edge polylines are gone; the CPU copy of the transform now runs lazily, only for picking
- [x] Dust: 450 faint specks (200 low) at fixed places inside the ball, moved by the same `_Focus`, so they slide
      with parallax on refocus. (Slow drift is still 3b.)
- [x] `gpuCheck()` now also tests the GLSL geodesic against `geodesicLerp3`: max error 3.8e-6 (positions 7e-7)
- Numbers (M4 laptop, headless): 7 draw calls (nodes, halos, sun, edges, dust, haze, nebula), 112 k triangles.
  vsync fps 60 idle and animating. Uncapped: ≈ 540 idle, ≈ 500 animating (was ≈ 200 animating in 3a: the per-frame
  CPU edge rebuild is gone). Low quality is not measurably faster on the M4 (noisy 400–550): the phone is the test

### Theme refactor  ✅ done
- [x] `src/theme.js`: ONE flat table of every look constant (130), each with a comment: arm hues, palette, sizes, fog
      distances, node/sun/edge/nebula/haze/dust strengths, tone gain. `THEME_DEFINES` turns it into GLSL `#define`s that
      every material receives; shaders contain no tuning numbers, the CPU (picking, hue assignment) reads the same table.
      (The old shell no longer exists; its opacity became `HAZE_STRENGTH`.)
- [x] Verified byte-identical screenshots (high and low quality, start and refocused) before vs after, using the new
      `?time=12.5` debug parameter that freezes the shader clock
- [x] `tests/theme.test.js` (in `npm test`): values valid, no dead constants, no colour literals creeping back into glsl.js
- [x] RULE (also in CLAUDE.md): every later visual constant goes in theme.js, so the final restyle is one-file work

### 3b — Ambience  ✅ done (waiting for phone/laptop check)
- [x] Travelling light pulse along every edge: comet from parent to child, random phase per edge (`aSeed`), one lap =
      2.2 edge lengths so each edge rests between pulses, tail e^(−9·distance behind head), tinted toward white,
      strength 0.9 of the edge's own brightness (subtle). Constants `EDGE_PULSE_*` in theme.js
- [x] Dust drifts: each speck wanders ±0.03 around its home on three sine waves (`DUST_DRIFT*`); still refocused by `_Focus`
- [x] Optional ambient rotation: `?spin=1` or R key (OrbitControls auto-rotate, `AMBIENT_SPIN_SPEED`). Desktop only
      (`pointer: fine`), off by default; `ambientSpinAllowed` must stay false in VR (Phase 4)
- [x] Geodesic edges in the vertex shader (10 segments, 6 in low), tint, fog and width were already done in 3a-tweaks
- Numbers (M4 laptop, headless, 5,000 nodes): 7 draw calls, 112 k triangles (71 k low). vsync: 60 fps idle and animating.
  Uncapped high: ≈ 555 idle, ≈ 480 animating. Uncapped low: ≈ 700 idle, ≈ 590 animating. The phone is the real test.

### 3c — Labels, semantic zoom, breadcrumb  ✅ done (waiting for phone/laptop check)
- [x] Labels: `troika-three-text` (free, npm) SDF text with a bundled local font (`public/fonts/Inter-SemiBold.woff`, OFL
      licence included), so it works offline except for rare non-Latin fallback glyphs. `src/labels.js` draws them in a
      flat screen-space pass (1 unit = 1 CSS pixel): always facing the viewer and a constant readable size, white with a dark
      outline. `BatchedText` packs every label into ONE draw call (two passes: fill + outline)
- [x] Which labels: the focus, its children (bigger subtrees first), the node under the pointer (mouse only), and the
      "+N" orbs. At most 25 (`MAX_LABELS`); only the best 40 candidates are even tried per frame
- [x] Never overlapping: candidates are sorted by priority; each tries 12 spots around its node (right, left, rows up/down,
      above, below), preferring the spot it had last frame; the first free spot wins, otherwise the label is dropped
- [x] Semantic zoom: a folder further than `COLLAPSE_DIST` (2.4) hyperbolic distance from the focus becomes a "+N" orb (bigger,
      brighter, with a ring); everything below it is hidden (not drawn, not pickable, edges not drawn). Hysteresis ±0.3 stops
      flicker; the focus and its ancestors never collapse; folders with fewer than 4 nodes inside are never collapsed.
      Decided on the CPU (only when the focus moves), passed to the shaders as `aState` / `aHide`. Folders expand live as
      the refocus animation approaches them
- [x] Clicking a "+N" orb focuses that folder (then it expands). Hover over an orb shows "name +N"
- [x] Breadcrumb "sample-repo / api / events / …" at the bottom centre (each segment clickable; long paths keep the first
      segment and the last four). Info line now shows item counts only (the path moved to the breadcrumb)
- [x] fps overlay (F or `?fps=1`) also shows label count and drawn-node count
- [x] All new look constants (label sizes/colours/outline, orb size/ring, breadcrumb colours, collapse distances) are in theme.js
- Checked in headless Chrome: hidden nodes never picked (300 tested, 0 hits); orb click focuses the folder; Backspace
  walks up and the breadcrumb follows; hover label "io +49" on an orb; no console errors; CPU/GPU check still passes
- Numbers (M4 laptop, headless, 5,000 nodes, root focus): 9 draw calls (7 scene + 2 text passes, limit 30), 25 labels,
  1,356 of 4,999 nodes drawn (201 orbs). vsync: 60 fps idle and animating, high and low. Uncapped high: ≈ 520 idle,
  ≈ 370 animating; low: ≈ 630 idle, ≈ 300–500 animating (noisy). The phone is the real test
- Known quirk: right after page load the batch is repacked while the first texts are typeset and strings could draw on top
  of each other for a moment, so labels stay hidden for the first ~2.5 s (`WARMUP_FRAMES`) or until all tried labels are
  typeset. If it ever shows on the phone, tell me.

## Phase 3 complete (3a, 3a-tweaks, theme, 3b, 3c).

### Known limitations (3a)
- Nodes use no depth test (pure additive glow), so nothing occludes anything: intended for this look.
- Refocus-between-off-centre-nodes rotation (Phase 2 limitation) still applies; needed for VR later.

## Plan change (Nov 2026)
VR Cardboard (old Phase 4) moves to the very end together with the final visual theme pass: no headset yet.
New order: **4** code expansion · **5** cross-file links · **6** search / info panel / git heat / second dataset ·
**7** AR tabletop · **8** user study + report · **9** VR + final visual polish.
Rule: camera/navigation code lives in ONE module so the Phase 9 Lorentz-matrix VR camera can replace it. Every new look
constant goes into theme.js first.

## Phase 4 — Code expansion  (4a, 4b, 4c done; waiting for your check)
Goal: clicking a file opens its own space (classes/functions bloom as a local galaxy); imports/calls drawn as glowing arcs.

### 4a — Scanner v2 (symbols, imports, calls, git)  ✅ done (waiting for your check)
- [x] `tools/scan_folder.py` rewritten, old tree fields unchanged. New per-file fields: `ext`, `loc`, `hasSymbols` + `id`,
      git `commits` + `modified`; root gets `symbolsDir`. Run: `python3 tools/scan_folder.py REPO --out-dir public/data/NAME`
      (writes `tree.json` + `symbols/<id>.json`; view with `/?tree=NAME/tree.json`). `--no-git`, `--no-symbols`, or plain `-o` = tree only
- [x] Python: stdlib `ast`. JS/TS (`.js .jsx .mjs .cjs .ts .tsx .mts .cts`): `tools/parse_js.mjs` with `@babel/parser`
      (new devDependency, free; one Node call for all files). Chosen because it parses modern JS, JSX and TypeScript in one parser
- [x] Symbol file = nested symbols (`kind` class | function | method, `name`, `startLine`, `endLine`, `signature`, optional `calls`,
      optional `children`), raw `imports` (`from` exactly as written, `names`), module-level `calls`. Format documented at the top of
      `scan_folder.py`. Class also covers TS interface / enum / namespace
- [x] Git: ONE `git log --name-only` pass for all files (not one per file); optional, skipped outside a git repo
- [x] `make_sample_tree.py` extended: same tree structure as before (checked identical), fake symbols/imports/calls/git from a second
      random generator. Imports point at real files of the sample, calls use names of the imported files' symbols
- [x] `tests/scanner_test.py` (in `npm test`): Python + TS extraction, whole-folder scan, and on the sample data: line ranges nested
      correctly, ids unique, every import resolves to a real file (40 k checks)
- Numbers: three.js `dev` (blobless clone, scanned into the scratchpad, NOT committed): 6,449 nodes, git info for 6,072 files,
  1,573 files / 16,296 symbols, 7.8 s total, tree.json 849 KB, symbols 4.0 MB raw. Sample (committed): tree 584 KB,
  1,475 symbol files / 16,413 symbols, 2.5 MB raw (≈ 0.6 MB compressed in git; the web server gzips each file it sends)
- Known approximations (matter for 4c): call names are only names (`foo`, `obj.foo`), `this.foo()` / `a.b.foo()` lose the receiver;
  computed calls, IIFEs, `super()` are ignored; object-literal methods and anonymous callbacks are not symbols (their calls count for
  the enclosing symbol); Python files that are not valid Python 3 are skipped; minified files (average line > 300 chars) and files
  > 1 MB are not parsed; git does not follow renames and a shallow clone gives short history

### 4b — Expansion in the viewer  ✅ done (waiting for your phone check)
- [x] **Files open into galaxies.** A file with symbols opens when the focus comes within 0.45 hyperbolic distance (focusing it,
      or gliding onto it) and closes beyond 0.7. Focusing a *folder* does not open its files (they sit 0.7 away). At most 6 files
      open at once (nearest first); the focused file / the file around a focused symbol never closes. Symbols are fetched lazily
      from `symbols/<id>.json` (cached) and laid out by `layoutSymbols` in `layout3d.js`
- [x] **Layout = same cap/territory rules.** Every folder-layout child now remembers its territory θ and "away" axis. A file's symbol
      cone is `β = 2·atan(e^d · tan(θ·0.8 / 2))` (d = 0.7, the file's distance from its parent; 0.8 = `SYMBOL_CAP_FIT`, because
      children at the rim of a cap own territory that spills slightly over it). Symbols sit `SYMBOL_EDGE_LENGTH` = 0.5 apart on
      Fibonacci spirals, each with a share of the cone for its own children. Positions are **not** clamped to 0.995 (new
      `mobiusAdd3Free`, `geodesicLerp3Free`): a file at r = 0.991 has symbols out to r = 0.9967
- [x] **Runtime add/remove.** Instance buffers have 3,000 spare slots after the base tree (nodes and edges, parallel slots);
      a free list reuses them; a removed node is hidden with `aState = 1` / `aHide = 1`. Still one draw call for nodes, one for edges.
      New nodes **bloom** out of their parent (`aOrigin`, `aBorn`, `uBloom`, `BLOOM_SECONDS` 0.45 s)
- [x] **Look.** `aKind` 2 class (sphere + permanent ring), 3 function (sphere), 4 method (diamond), 5 block (rounded square: one
      "(top level)" node covering the whole file, only when the file has module-level calls). Hue by extension (js amber, ts azure,
      py mint, other violet), size and brightness by lines of code (log scale per file). All new constants are in `theme.js`
- [x] **Semantic zoom for symbols.** A class/function with ≥ 4 nodes inside collapses into a "+N" orb beyond `SYMBOL_COLLAPSE_DIST`
      (1.0, hysteresis ±0.3), exactly like folders
- [x] **Code panel** (`src/codepanel.js`): HTML overlay, monospace, line numbers, light colouring, the focused symbol's lines (file focus:
      the whole file, first 400 lines). Wide screen: docked right and the 3D view slides so the focus stays in the visible part.
      Phone (narrow or portrait): bottom sheet 40 % high, 48 px tap targets, tap the header or – to fold it, × to close, C key
      toggles; the breadcrumb moves above the sheet. Source comes from `source/<id>.txt` (scanner now copies each parsed file; `--no-source`
      skips). The sample's fake source is generated by `make_sample_tree.py` (line numbers match the symbol ranges)
- [x] **Navigation in ONE module**: `src/navigation.js` now holds the camera, OrbitControls, ambient spin, focus point + geodesic
      glide, and the view inset. `main3d.js` only calls it, so the Phase 9 Lorentz/VR camera replaces that file. Base-scene screenshots
      (`?time=12.5`, refocused view, high and low quality) are byte-identical to before the refactor
- [x] Info line: files show lines, symbol count, git commits + last date; symbols show kind, signature, line range. The breadcrumb
      includes `file / Class / method`
- [x] Tests (`npm test`): `symbols.test.js` opens EVERY sample file with symbols (1,475 files, 16.9 k symbols): all inside the file's
      territory (worst overshoot −0.018 rad, i.e. inside), min distance between symbols of sibling files 0.15, min sibling distance 0.041;
      `codepanel.test.js` (colouring); free Möbius/geodesic checks; source/loc consistency of the sample
- Checked in headless Chrome (M4 laptop, ANGLE/Metal): GPU vs CPU Möbius max position error 7e-7 (radius ≤ 0.99) and 4e-7
  (radius ≤ 0.9995, the range symbols use); real mouse click on a symbol focuses it, Backspace goes up to the file; going to the
  root closes every galaxy (0 symbol nodes); visiting 40 files in a row kept ≤ 71 live symbol nodes (slots are reused);
  touch-tap on a phone-sized screen (412×915) works, sheet folds; no console errors; `?mode=2d` untouched
- Numbers (headless, vsync 60 fps idle in every case, **9 draw calls** = 7 scene + 2 text passes, limit 30):
  | scene | nodes drawn | symbol nodes | 
  |---|---|---|
  | sample, root | 750 | 0 |
  | sample, `parser.py` focused (48 symbols) | 639 | 52 (two neighbouring files opened too) |
  | three.js, `WebGLRenderer.js` focused (3,803 lines) | 2,552 | 81 |
  Not measured: uncapped fps (use the phone). Sample data size: tree 0.6 MB, symbols 2.5 MB, **fake source 5.7 MB** raw (1.5 MB gzipped
  for the whole `public/data/sample`); the three.js scan (18 MB of source) is NOT committed
- Panel readability fix (after the first phone check): the panel is now solid (`CODE_BG_ALPHA` 1), lighter than the scene, with a bright edge line
  (`CODE_EDGE`) and a shadow; labels are not placed under it; the breadcrumb is centred in the visible part
- Known limitations: a galaxy's nodes vanish instantly when a file closes (only opening animates); a file with more than 400 symbols
  keeps the first 400 breadth-first; the crowded corner case (file with a tiny territory and a big class) puts siblings 0.04 apart,
  readable only after you glide in; syntax colouring starts "cold" at the first shown line; the `block` kind exists only as the
  top-level-code node; clicking where several nodes overlap picks the front-most

### 4c — Links: imports and calls as bundled arcs  ✅ done (waiting for your check)
- [x] **Resolution in the scanner** (`tools/links.py`, shared by `scan_folder.py` and `make_sample_tree.py`; also
      `python3 tools/links.py OUT_DIR` for an existing scan). Writes `links.json` next to `symbols/`, the tree root gets
      `linksFile`. One row per link `[fromFile, fromSym, toFile, toSym, type, conf%]`; symbol index = position in a
      depth-first **pre-order** walk of the file's nested symbols (-1 = the file itself); `symbols.js` now gives every node
      the same number (`symIndex`), independent of its breadth-first build order and the 400-symbol cut (tested on all
      15 k sample symbols). Also a names table (methods as `Class.method`) so lists can name symbols of closed files
- [x] **Imports → files**: relative paths, extension guessing (`.js .jsx .mjs .cjs .ts .tsx .mts .cts`), `dir/index.*`, `./x.js`
      meaning `x.ts`, "prefer the candidate that defines the imported names" when `x.js` and `x.ts` both exist; Python
      `.mod`, `..pkg.mod`, `from . import mod` (submodules), absolute dotted modules that match exactly one file of the repo
      by path suffix. Bare package names (`three`, `react`, `os`) are external: no link
- [x] **Calls → symbols**, first rule that applies wins:
      | how the call was matched | confidence |
      |---|---|
      | name bound by an import (`import {f}` / alias / default import), followed through re-exports up to 3 hops; `ns.f()` with `import * as ns` | 80 % |
      | `C.m()` where C is an imported or local class → its member m | 70 % |
      | `this.m()` / `self.m()` / plain `m()` that is a member of the caller's own class; unique top-level name in the same file | 70 % |
      | unique name elsewhere in the same file | 60 % |
      | **guess**: receiver unknown (`obj.f()`, `this.a.f()`), unique name in this file or a file it imports | 40 % |
      | **guess**: top-level class/function anywhere in the repo, 1 or 2 candidates | 25 % / 12 % each |
      | more candidates, or a standard-library name (`map`, `push`, `join`, `len`, …: list `BUILTIN_NAMES`) | no link |
      Import links: 100 % (relative found on disk), 95 % re-export, 90 % dynamic import / Python absolute (70 % one-segment)
- [x] **Drawing** (`src/links.js` + `LINK_VERT/LINK_FRAG` in `glsl.js`): ONE instanced mesh (1 draw call → **10 in total**).
      Hierarchical edge bundling: tree path a → LCA → b, 5 control points (ends, LCA, half way up each side), each pulled
      toward the straight geodesic by `LINK_TENSION` = 0.8 (`straightenToward` in `mobius3d.js`), then the vertex shader
      refocuses them with `_Focus` and evaluates a **hyperbolic Bézier curve** (de Casteljau with geodesic steps,
      `geodesicBezier3` / GLSL `geodesicBezier5`; 16 segments, 10 in low quality). Cyan = import, coral = call; confidence
      → brightness and width; brighter toward the target + a comet running source → target; fog by hyperbolic distance;
      merged arcs wider; fade-in 0.35 s; exposure `sqrt(LINK_CROWD / arcs)` so dense bundles do not burn white. All 23
      new look constants are `LINK_*` in theme.js. `gpuCheck()` now also compares the GLSL Bézier with the CPU: max error 1.4e-6
- [x] **Which links**: the focus's links in and out (= the links to its direct neighbours), then the hovered node's
      (desktop), sorted by confidence, at most **300** arcs (`MAX_VISIBLE_LINKS`). A focused file shows its imports and all
      its symbols' calls; a symbol its own calls/callers; the "(top level)" block the file's imports and module-level calls.
      A focused **folder** shows only the file→file imports that cross between its parts, merged per sub-folder two levels
      down (one thicker arc per pair), drawn dimmer (`LINK_FOLDER_BRIGHT`); calls are left out there (tens of thousands).
      Link ends: a symbol of a closed file attaches to the file node; anything hidden in a collapsed folder/class attaches
      to the "+N" orb; links that end up inside one orb are dropped; arcs between the same two nodes are merged.
      Recomputed only when focus, hover, open files, orbs or filters change. **I** = imports on/off, **K** = calls on/off
      (shown in the help line); `?links=0` starts with both off. R, F, C, Backspace unchanged
- [x] **Following links**: clicking an arc (its far half, CPU copy of the curve, 10 px) or the node at its far end, or an
      entry of the panel lists, glides there and pushes the old place on a **back stack** (in `navigation.js`). A symbol of
      a closed file: glide to the file, it opens first in line, and the glide continues to the symbol as soon as it exists
      (reads as one ≈ 0.5–0.55 s movement). **Backspace = back** while the stack is not empty, otherwise parent;
      **Shift+Backspace = parent** always; the breadcrumb works as before (no push). A "‹ Back (n)" button (44 px) appears
      for touch screens
- [x] **Panel lists**: tabs under the header "Code · Imports n · Imported by n · Calls n · Called by n" (empty ones hidden),
      48 px rows with name ×count, path and 1–3 confidence dots in the type colour, 30 at a time + "Show more". A file's
      lists leave out calls inside the file (each symbol lists those). The far ends of the focus's arcs get labels
- [x] Tests: `tests/links.test.js` (data/index, pre-order numbering of every sample file, subjects, selection order /
      filters / cap, merging, orb ends, tree path + LCA, tension 0 = chord / 1 = tree, curve ends, panel lists),
      `mobius3d.test.js` (Bézier worked example, ends, collinear = geodesic, **curve commutes with refocusing**, tension
      example), `scanner_test.py` (resolver unit cases: extensions, index, `.js`→`.ts`, external, non-code, every call rule,
      ambiguity cap, built-ins, Python relative/absolute/re-export; sample links up to date; precision on the sample)

Numbers
| | sample (committed) | three.js `dev` (scratchpad only) |
|---|---|---|
| links | 16,144 (1,802 import, 14,342 call) | 27,755 (4,623 import, 23,132 call) |
| imports resolved | 1,802 / 1,802 | 4,624 / 5,827 (791 external, 403 non-code e.g. `.css`/`.glsl`, 9 missing) |
| calls: total / unresolved / ambiguous | 25,710 / 11,196 (built-ins) / 172 | 66,572 / 38,890 / 2,846 (+1,265 recursive, dropped) |
| resolved calls by rule | import 6,497 · same file 5,605 · own class 2,240 | same file 7,015 · repo-wide guess 6,096 · own class 3,965 · import 3,402 · nearby guess 3,337 · class member 83 · namespace 50 |
| links.json | 684 KB (132 KB gzipped) | 956 KB (183 KB gzipped) |
- Sample precision (the generator draws every call from same-file names, imported names or built-ins, so the true targets
  are known): **precision 100 % (14,342 / 14,342), recall 98.8 %** (misses = the 172 ambiguous calls, e.g. `constructor`
  of another class in the same file). Naive name-only matching would be right only **11 %** of the time (a name is
  unique in the repo for just 71 of 14,514 calls) — that is why name-only links are low confidence and capped
- three.js has no ground truth. My manual spot check of 25 random links per group: same-file (60–70 %) ≈ 24/25 right;
  nearby guess (40 %) ≈ 20/25; repo-wide guess (12–25 %) ≈ 16/25 (wrong ones: TSL methods like `sub`/`select` matched to
  an unrelated function, the `build/three.module.js` bundle duplicating `src/`)
- Visible arcs: sample root 449 crossing imports → 124 merged arcs; `format.ts` 25 links → 18 arcs; three.js root 607 → 27;
  `WebGLRenderer.js` 220 → 174; `initGLContext` 25 → 25. Never more than 300
- Headless Chrome, M4 laptop (ANGLE/Metal), 1000×800: **10 draw calls** with links (9 without); vsync 60 fps idle and
  animating in every scene. Uncapped (idle / animating): sample root 447 / 323 (links off: 506 / 431), `format.ts` 553 / 469,
  three.js `WebGLRenderer.js` 504 / 354 (links off 512 / 398), low quality 539 / 496. The animating drop at the root is the CPU
  rebuilding arcs when folders collapse/expand during the glide. Phone not measured (please check)
- Checked: no console errors; `?mode=2d` loads; with `?links=0` the base-scene screenshots (high + low, root + refocused
  folder, `?time=12.5`) are **byte-identical** to before 4c; I/K/F/C/R keys; Backspace back / parent / Shift+Backspace; breadcrumb;
  arc click away from nodes; following into a closed three.js file opens it and lands on the symbol; phone 412×915 touch:
  tabs 44 px, rows 48 px, tapping a "Called by" entry glides there, "‹ Back" returns

**Where call resolution is approximate (honest list)**
- Calls are only names: `this.a.f()` / `a.b.f()` keep only `f`, `obj.f()` keeps `obj.f` with no idea of obj's type.
  Those go to the 40 % / 25 % guesses, which can be wrong (e.g. `v.sub()` linked to some other `sub` function), and are
  dropped when ambiguous: a correct link may be missing just as a wrong one may be shown
- No type inference, no scopes: a local variable or parameter that shadows a function name still links to the function;
  a function passed as a value (callbacks) is not a call
- Default imports guess the target symbol (same name, `default`, or the file's only top-level class/function)
- Bare package imports are always external — even three.js importing itself as `three` (so examples → `src/` calls only
  appear as repo-wide guesses). No `tsconfig` paths/aliases, no `package.json` exports map, no CommonJS destructuring
  (`const {a} = require('./x')` gives a file link; calls of `a` become guesses)
- Python: relative imports and dotted modules matching exactly one file; no `sys.path` tricks; `from m import *` passes
  names through but is not checked
- Generated/bundled copies (`build/`) attract repo-wide guesses; no folders are excluded
- The sample's 100 % precision only shows the deterministic rules work; the sample has no guessed calls by construction

Known limitations / decisions to review
- "Direct neighbours" = links in and out of the focus (one hop); the neighbours' own links to third nodes are not shown
- A folder shows imports only, merged per sub-folder; calls appear when you focus a file or symbol
- Symbols beyond the 400-per-file cut can be linked but not opened: following such a link stops at the file
- Arcs disappear instantly (only appearing fades); arcs attach to a symbol's final place while it is still blooming out
- Strong bundling makes links to siblings in one folder share one line until near the end (that is the point of HEB, but
  in three.js the 25 calls of `initGLContext` look like one beam until they fan out at the `webgl/` folder)

### 4d — Newcomer navigation  ✅ done (after your screenshot of the `api` folder: "intimidating")
- [x] **Calmer default.** A focused *folder* no longer draws its import arcs (that was the hairball); the new **Dependencies** chip / **D** key
      switches them on. Files and symbols still show their arcs, and hovering a file previews its arcs
- [x] **On-screen toolbar** (`src/toolbar.js`, 44 px targets, works on the phone): ⌂ Home, ↑ Up (parent), ‹ Back (n) (only while the back stack is
      not empty), and the link chips, which double as the colour legend (cyan dot = imports, pink = calls). Chips shown: folder → Dependencies;
      file/symbol → Imports, Calls
- [x] **"How to explore" card** on the first visit (remembered in localStorage; `?intro=0` never, `?intro=1` always; the **?** button reopens it).
      Four plain-language steps: what the picture is, click to fly in / +N, Up/Home, arcs and Back
- [x] Shorter key line (hidden on touch screens); folder info line says "click one to fly in"
- Screenshot tests and my headless scripts must now pass `?intro=0`
- **Phone held sideways (your S26 screenshots):** the layout is now chosen by orientation, not width. Portrait = bottom sheet; landscape
  (laptop or sideways phone) = code panel docked on the RIGHT, scrolling, at most 50 % of the width. Windows ≤ 520 px tall
  (`COMPACT_HEIGHT_PX`) get a compact layout: icon-only toolbar in a column down the left, smaller title / breadcrumb / code text, 3D labels
  scaled by 0.75, panel uses the full height with a slimmer header. The title no longer runs under the panel

## Phase 5 — Cross-file links: delivered inside 4c (see above)

## Phase 6 — Usability for the user study  (in progress)
Sub-steps 6a search · 6b info card + git heat · 6c minimap + second dataset · 6d study mode. One at a time, stop after each.

### 6a — Search  ✅ done (waiting for your phone check)
- [x] `src/search.js` (no DOM): name index in parallel arrays; every folder and file at once, symbol names added in the background
      (`indexSymbolsInBackground`: 4 files at a time, a pause every 25 files, started 0.6 s after load, `getDoc(file, {cache:false})` so nothing is kept in memory).
      Results appear for symbols as soon as their file has been read; the box says "Reading function names… 40 %" until then
- [x] **Fuzzy ranking** (`scoreName`): exact 1000 > starts with 900 > starts a word (camelCase / `_` `-` `.`) 700 > inside 500 > letters in order with gaps ≤ 300;
      minus position and half the unused letters. Example: "node" in `getNode` = 700 − 3 − 1.5 = 695.5. A 32-bit letter fingerprint rejects most names in one
      operation. Several words: the first matches the name, the others must appear in the name or the path ("api client"). Ties: files/classes before folders/methods
- [x] **Search box** (`src/searchui.js`): magnifier button first on the toolbar, `/` on a desktop keyboard, Esc closes, ↑↓ Enter on the keyboard. Top 10 results, each
      with a kind icon (shapes echo the 3D ones), name and path. At the TOP of the screen so the phone keyboard cannot cover it; the list is shortened to
      `visualViewport` height; Enter picks the first result; touching/scrolling the list hides the keyboard. Rows 48 px (40 px compact); typing never triggers I/K/D/C/F/R
- [x] **Choosing a result** glides there along the geodesic (pushes the back stack: ‹ Back returns), fills the breadcrumb, and **lights the path root → result** for
      4 s then fades 1.5 s: path nodes swell, get a gold ring and brighter; path edges get thick and gold (new `aMark` attribute on nodes and edges, one `uMark`
      uniform, `PATH_*` constants in theme.js). A symbol in a closed file is lit up to the file at once and the last step when it opens
- [x] Landscape compact toolbar now wraps into a second column so the extra button fits
- Numbers (headless, M4): sample 21,412 entries (4,999 tree in 1.9 ms; 16,413 symbols from 1,475 files in 0.58 s, in the background); **0.4–0.8 ms per search**.
  three.js: 22,744 entries (1,573 files in 0.52 s), **1.4 ms average, 2.6 ms worst** over 8 queries. Checked: `/` opens, Enter picks, a symbol result of a closed
  file lands on its file with the path lit, marks clear after fade, Backspace returns; phone portrait (rows 48 px) and landscape (rows 40 px) tap-select works
- Not measured: index time on the phone itself (on a real network the 1,475 small requests take longer than on localhost)

### Clutter fixes at code level (before 6b)
- [x] The focus "sun" is smaller when a FILE or SYMBOL is focused (`SYMBOL_FOCUS_SCALE` 0.4: core and billboard; `uFocusScale` uniform, 1 for folders so the
      folder views are unchanged)
- [x] Class/function orbs are labelled with their NAME ("Parser +12"), not a bare "+N"; at code level only the 4 biggest orbs are labelled
- [x] Clicking the "(top level)" block focuses the FILE (the block stands for the whole file's loose code)

### 6b — Info card and git heat  ✅ done (waiting for your phone check)
- [x] **Info card** (`src/infocard.js`, Info button on the toolbar): kind, path, lines of code, symbols, git commits, last modified, imports in/out, calls in/out.
      Folders add up their files (commits, lines, newest date) and count imports that cross the folder's boundary; a symbol shows its signature, its own lines
      and calls in/out. Open by default only on a roomy screen (≥ 900×600); on a phone it starts closed. It stops before the code panel, starts right of the
      toolbar columns in landscape, scrolls if too tall; the search box and intro card sit above it
- [x] **Git heat** (`src/heat.js`, Heat button / **H**: off → commits → recency → off). Numbers only: each node's heat goes into the existing `aFlag` hook as
      2 + heat (0 = none, 1 = the reserved ring, 2..3 = heat); the shader decodes it, tints by a 3-stop ramp (blue → magenta → orange, `HEAT_*` in theme.js),
      makes hot nodes bigger and brighter, and (heat on) dims nodes WITHOUT git data to half so they stay neutral. Symbols take their file's heat
- [x] **Heat formulas.** commits: `heat = ln(1 + commits) / ln(1 + most)` (most = 99: 9 commits → 0.5, 1 commit → 0.15). recency: `(time − oldest) / (newest − oldest)`.
      A folder = the average of its files that have data, then **ranked** among all folders (0..1): plain averages bunch in the middle and the maximum made every big folder
      hot (tried both, see the screenshots in the log)
- [x] **Legend** (top right, left of the code panel): title, a cold→hot colour bar, the numbers under its ends (1 … max commits, or oldest … newest date); the
      node title makes room for it (`--legend-w`); tooltip says grey = no git data
- [x] **Sample git data is FAKE and says so**: `make_sample_tree.py` now generates a patterned history from its own random generator (seed + 3): ~25 % of the
      folders two levels down are "hot" (median ≈ 14 commits, changed within weeks), the rest calm (median ≈ 3, anywhere in 4 years), ~10 % of files have none.
      The tree root carries `"fakeGit": true`; the legend title says "(FAKE data)" and the card says "Sample data: the git numbers are FAKE". Only `sample_tree.json`
      changed (symbols/links/source are byte-identical)
- [x] Phone fixes found while testing: toolbar is icon-only on narrow screens (one row of 44 px buttons); landscape toolbar can use 2 columns and the card moves right
      of them; the node title is one line with an ellipsis
- Tests: `heat.test.js` (formulas, neutral files, folder ranking, sample is flagged fake, link counts)
- Numbers (headless, M4, 1000×800): 9 draw calls at the root (10 when link arcs are drawn), the same with heat on or off; 60 fps vsync in all three cases tried (root heat off, root heat on, file focused with recency heat). Uncapped fps not measured

### Dynamic sizing and link glides (after your zoom screenshot)
- [x] **Nodes make room for each other.** Overlap was not a zoom problem: sizes are fixed hyperbolic lengths, siblings can sit 0.04 apart, and zooming magnifies
      sizes and distances equally. Now every node has a size LIMIT `fit = 0.4 × (hyperbolic distance to its nearest sibling)` (`assignFitAll` in layout3d.js,
      new `aFit` attribute, `NODE_FIT_FRACTION`): the solid core is `min(normal size, fit)`, so neighbours can take at most 80 % of the gap, from any viewpoint
      (the Poincaré shrink scales sizes and distances alike). Symbol galaxies get their fit when they open. Picking uses the same limits. A node alone uses its
      distance to its parent
- [x] **Sizes also adapt to the zoom.** Closer than the default camera distance the cores shrink: `factor = (distance / default)^0.7`, never below 0.25
      (`ZOOM_SIZE_*`). Example: half the distance → 0.62, so on screen the gaps between nodes open up ×3.2; at a quarter → 0.38. The focus is exempt
- [x] **Following a link flies THROUGH the link.** The glide now travels along the arc's own hyperbolic Bézier curve (20 samples) instead of the straight
      geodesic: `nav.flyTo(to, animate, via)` joins [here, ...via, target] with geodesics and moves at even speed along the whole route (ease-in-out, still 0.5 s).
      Used when you click an arc or its far end and the arc really ends at the target; panel-list entries, search and the breadcrumb still glide straight.
      Checked headless: on the most curved arc of the sample the glide bends 0.23 ball units off the straight chord and lands on the target
- Side effect: the base scene looks different from before (crowded siblings are smaller), so old byte-identical screenshot comparisons no longer apply
- Tests: `symbols.test.js` checks fit on 20,679 sample nodes plus the worked example (gaps 0.06 / 0.10 → fits 0.024, 0.024, 0.04)

### 6c — Minimap and second dataset  ✅ done (waiting for your phone check)
- [x] **Minimap** (`src/minimap.js`, canvas 2D, bottom-right corner, collapses to one 44 px button; starts collapsed on a phone held upright, open otherwise).
      The tree as laid out in the ball is flattened onto a disk (`x = cx + p.x·R`, `y = cy − p.y·R`; depth only dims dots): dim dots = folders (and files in a
      small tree), bright dots and lines = the focused subtree (for a file or symbol: its folder), a gold line = path from the root to the focus, a ring = the
      focus node, a cross = the point at the centre of the screen right now (it glides while you fly). Fixed picture, it does not turn with the camera.
      **Tap = fly to the nearest node** within 22 px (pushes the back stack): distance is divided by `1 + 0.15·ln(weight)`, so a folder of 100 nodes 16 px away
      beats a lone leaf 12 px away (9.5 vs 12). The background picture is cached and only rebuilt when the focus node changes, the cross is redrawn per frame.
      Position: above the toolbar on a narrow screen, left of the code panel on a wide one, 100 px in the compact landscape layout. `MINIMAP_*` in theme.js
- [x] **Second dataset: WordNet nouns** (`tools/make_wordnet_tree.py`, run with `nltk` + its free WordNet data → `public/data/wordnet_tree.json`, 180 KB,
      licence in `public/data/wordnet_LICENSE.txt`). "X is a kind of Y": entity → physical entity → object → whole → living thing → organism → animal → … .
      Recipe: WordNet is a DAG, so each noun keeps only its first hypernym (sorted by name, deterministic); count each noun's descendants in the full tree; start
      at `entity` and repeatedly add the not-yet-included child (of an included node) with the MOST descendants until 3,000 nodes, depth ≤ 8 (the ball runs out of
      room beyond ~9). Nodes with children in the subset are "folders", the rest "files"; `size` = descendants in the full WordNet (82,116 nouns total).
      Root fields: `about` (intro sentence), `words` (Category / Word for the info card), `license`. View: `?tree=wordnet_tree.json`
- [x] The viewer adapts to a non-code dataset: no Imports/Calls/Dependencies chips, no Heat button (no git data), info card without code rows (shows depth and
      sizes), "Category / Word" wording, intro text and key line without code parts
- Tests (`minimap.test.js`): flatten and pick examples, and the WordNet file (3,000 nodes, depth ≤ 8, valid folders/leaves, layout max radius 0.9912, licence shipped)
- Numbers (headless, 1000×800, map open, refocusing every ~0.3 s for 2.5 s): sample 60 fps, 9 draw calls; WordNet 59.6 fps, 8 draw calls (the minimap is a 2D
  canvas, not a WebGL draw call). Phone portrait/landscape: taps on the map refocus, no console errors

### 6d — Study mode and collapsible-tree baseline  ✅ done (waiting for your phone check)
**How to run it** (add `&p=P07` to prefill the participant id; the three conditions use the same data and the same logger):
| condition | URL |
|---|---|
| collapsible tree | `/?mode=tree&study=1` |
| 2D hyperbolic disk | `/?mode=2d&study=1` |
| 3D hyperbolic ball | `/?study=1` |
Other options: `&tree=wordnet_tree.json` (other dataset; tasks come from `study/tasks_wordnet.json`), `&tasks=study/x.json`, `&search=0` (no search in 3D, no filter box in the list).
- [x] **Flow** (`src/study.js`, loaded by `main.js` on `?study=1`): welcome card (participant id, condition shown, Resume if a session was saved) → for each task a bar at the top
      with the task text → **Start** (the view is reset to the root / tree collapsed, the clock starts) → **Found it** or **Skip** → next task. One practice task (it tells you
      right or wrong; scored tasks never do), then 6 scored tasks, shallow to deep. The final card shows a summary and the export buttons
- [x] **Logged** (`src/studylog.js`, no DOM, tested): per task: elapsed ms, result (found/skipped), correct (does the selected node's path equal the target? a symbol of the
      target file counts), the path selected at "Found it", **navigation actions** (= focus/selection changes the participant made; changes the viewer makes by itself, e.g. the
      second step of a link glide, are logged as `auto` and not counted), backtracks (focus moved to a shallower node), max depth, plus the raw events with timestamps:
      `focus` {path, source: canvas / search (+query) / map / toolbar:… / panel / breadcrumb / key:… / tree}, `click`, `drag`, `wheel`, `key`, `ui`
- [x] **Observed from outside**: study.js only watches `window.__explorer` (focused node every frame) and DOM events, so **`main2d.js` is untouched** (verified: no diff) and
      all three conditions are logged identically. The tree page exposes the same interface ("focus" = selected row)
- [x] **Export**: JSON (everything), tasks CSV (one row per task: the table to analyse), events CSV (one row per event). Buttons use a download link; "Copy JSON" falls back to a
      text box. The session is autosaved to localStorage after every task (a reload offers Resume)
- [x] **Developer text hidden** in study mode (fps counter, key-help line); the 3D intro card is skipped (the study briefs people itself); the viewer's panels, search box and
      info card move down by the height of the study bar (`--study-h`); on a sideways phone the bar is one slim row
- [x] **Collapsible-tree baseline** (`src/maintree.js`, `?mode=tree`): a plain file-explorer list from the same JSON and the same `buildTree` (identical paths): click a folder
      to open/close, click a file to select (mouse/touch only, no arrow keys, like the other conditions), a filter box, 44 px rows on touch. No map, heat, links or 3D
- [x] **Tasks** (`tools/make_study_tasks.py`): "Find the file "X" inside the folder "Y"", only (folder, file) pairs that occur exactly once, seeded, same list for everyone;
      `public/study/tasks_sample.json` and `tasks_wordnet.json` are committed (tests check every target exists once, is a leaf, and the pair is unique)
- Caveats for the analysis: the sample's folder names repeat a lot (e.g. several folders called `io`), so the tasks are harder than "find main.css"; the 3D viewer also has
  search, info card, heat and map, the tree only a filter box (use `&search=0` for a no-search comparison); the 3D info card shows the FAKE git numbers; headless runs only,
  no real participant yet
- Tests: `study.test.js` (depth, correctness, action/backtrack counting incl. `auto`, CSV escaping, task files). Checked headless in all three modes: a task logged with
  the right events (`click`, `focus:canvas`, `key`, `focus:key:Backspace`; a search selection logged `source: search, query: main`), seven tasks finished and the three
  files downloaded, phone portrait and landscape run without errors

## Phone polish (before AR): 4 steps
1 look and immersion · 2 test navigation and links · 3 code panel interconnections · 4 smooth scrolling. Stop after each step for the S26 test.

### Step 1: Phone look and immersion  ✅ done (waiting for your S26 check)
- [x] **Full-bleed.** `viewport-fit=cover`, `interactive-widget=resizes-content`, `100dvh` fixed body, `overscroll-behavior: none`, canvas `touch-action: none` (index.html and navigation.js),
      no tap highlight or long-press menu on the canvas, `theme-color` #03040c. Safe-area insets are CSS variables `--sai-t/r/b/l` (index.html); toolbar, breadcrumb, title, legend,
      info card, minimap, search box and the code panel/sheet all add them (top edges use `max(--study-h, --sai-t)` because the study bar already covers the notch)
- [x] **Fullscreen.** Toolbar button (expand/shrink icon, only where `document.fullscreenEnabled`, follows `fullscreenchange`, `navigationUI: 'hide'`). Chrome cannot hide the address bar of a
      non-scrolling page any other way. `public/manifest.webmanifest` (display fullscreen) + `icon.svg` make "Add to Home screen" open with no bar at all (not tested: needs HTTPS / the phone)
- [x] **Phone tier** (`src/quality.js`, numbers `PHONE_*` in theme.js): automatic when the pointer is coarse AND the short side is <= 600 px; `?quality=high|phone|low` overrides. Pixel ratio cap 1.5
      (the S26 has ~3, full resolution would be 4x the pixels), dust 200, halos 24, nebula 3 octaves, 1 star layer, 8 / 12 segments per edge / arc. The old inline QUALITY table moved here; `?quality=low` is unchanged
- [x] **Adaptive step**: on phones, if fps stays under 50 for 2 s the pixel ratio is multiplied by 0.8 (floor 0.75), then a 3 s pause; it never goes back up; ignored for the first 5 s after load and while the tab is hidden.
      Only the pixel ratio changes live (the other settings are baked into geometry and shader defines at start). `?adapt=0/1` forces it off/on; `__explorer.adaptiveSteps` reports it.
      It was seen working by accident on software GL (2 fps): 1.5 -> 1.2 -> 0.96
- [x] **Touch in navigation.js**: one-finger orbit with inertia (`ORBIT_DAMPING` 0.07), two-finger pinch zoom only (pan stays off, the focus stays centred), tap detection (`nav.onTap`: under 10 px and 350 ms,
      a pinch never counts), touch **double-tap = go up** (300 ms, 40 px). The first tap of a pair already focused something, so main3d takes "up" from where you were BEFORE the pair.
      Mouse behaviour is as before (click = tap, no double-click). Light haptic (`navigator.vibrate(8)`, rate-limited, only after a first touch) on every animated focus change, called from `nav.flyTo`
- [x] **Auto-fade** (`src/idlefade.js`, `UI_FADE_*`): after 4 s without touch, key or focus change the toolbar, title, breadcrumb, map, info card, legend and the 3D labels fade out over 0.6 s; any touch brings them
      back in 0.2 s. Faded things get `pointer-events: none` (the touch goes to the picture). Not faded: code panel, search box, intro and study cards; nothing fades while search, intro or the study card is open.
      Touch screens only; **off in study mode** (so the three conditions look alike); `?fade=1/0` forces it
- Study mode: nothing in this step changes focus by scrolling. The `scroll` event source (logged, not counted as a user action) is still to do in Step 4
- Tests: `tests/quality.test.js` (tier choice, adaptive step incl. warm-up, cool-down, floor and dips, fade maths; part of `npm test`). Headless Chrome with touch emulation (CDP, Intel Iris Xe, 2.625 dpr,
      Galaxy-like user agent), both viewports, 17 of 17 checks pass in each: phone tier, ratio, canvas size, touch-action, buttons >= 44 px (40 compact), tap focuses, double-tap goes up (also when it lands on a node),
      orbit, inertia, stop, pinch, pinch is not a tap, fade out, fade back. Screenshots in `screenshots/step1/`
- Numbers (412x915 and 915x412, sample tree, refocusing every 0.35 s for 4 s): 60 fps in landscape (worst frame 25 ms), 57 fps in portrait (one 169 ms hitch when the first labels/orbs changed),
  **9 draw calls** (7 scene + 2 text, limit 30), no adaptive step triggered, console clean. This is a laptop GPU, NOT the S26: please read the real fps on the phone (`?fps=1`)
- Not verified here: real vibration, real address-bar hiding, real notch insets (headless reports 0), installed-app mode
- Dev note: `python3` is not on this PC's PATH, so `npm test` stops at the last command (`scanner_test.py`); all JS tests pass

### Step 2: Test navigation and links, especially edges  ✅ done (waiting for your S26 check)
**How to run:** `npm run test:phone` (starts its own Vite server and a headless Chrome/Edge with the GPU on; ~4 min; writes `screenshots/step2/report.md` + `report.json`; exit code 1 on any failure).
`AUDIT_ONLY=portrait|landscape|desktop|shots` runs one part. Files: `tests/phone/cdp.mjs` (tiny DevTools-protocol driver, no packages), `page-helpers.js` (injected into the page), `audit.mjs`.
Input is real touch (CDP `Input.dispatchTouchEvent`) at 412x915 and 915x412 (2.625 dpr, Galaxy-like user agent); hover uses a real mouse on a 1000x800 desktop window.
- [x] **Edges: drawn vs predicted.** The edge layer is drawn ALONE (nodes, halos, sun, dust, nebula, haze, links hidden), the pixels are read back, and compared with the CPU prediction of every
      visible edge (same Möbius/geodesic maths as the vertex shader, via `__explorer.edgePolylines()`). *Stray* = lit pixels farther than 7 px from any predicted edge; *missing* = a predicted edge
      near the focus (< 1.4 hyperbolic distance) whose interior pixels are not lit. Scenarios: root, folder, file with its galaxy open, a focused symbol, mid-glide, two files open, after 20 files opened and
      closed, and the 400-symbol galaxy. Result: **0 stray pixels, 0 missing edges in every scenario** (e.g. 1,355 edges at the root = 47,001 lit pixels, 0 stray); no galaxy left open after leaving
- [x] **Arcs.** On every audited focus (file, class, method, function, root folder and a depth-2 folder with Dependencies on) each arc is checked against the raw `links.json` rows with an independent
      re-implementation of "which node stands for this end" (symbol node if its file is open, else the file, else the +N orb; folder focus lifts ends two levels): every link of an arc resolves to the arc's
      source -> target, the GPU buffers (`aP0`, `aP4`) hold the source and target node positions, the drawn curve starts/ends within 1.5 px of those nodes on screen, arc count <= 300, no self arc (both
      ends on one node), no duplicate arc (merged), counts add up. Pulse direction: the comet moves toward vT = 1 (the target end) and the source end is dimmer (checked from the shader maths + `LINK_PULSE_SPEED > 0`,
      `LINK_SOURCE_DIM < 1`; not a pixel-level motion test). Hover preview with a real mouse: 6 extra arcs appear on a hovered file, total <= 300, audit clean, gone when the mouse leaves
- [x] **Following links, by touch.** Tap an arc's far-end node; tap the arc ITSELF near its far end (both for arcs that leave the focus and arcs that arrive at it); tap a panel list row (>= 44 px);
      tap a search result (rows >= 40 px); tap the minimap. Each: lands exactly on the target (`focusId` is the expected node, focus radius = 0), pushes the back stack by 1, and the toolbar's Back button returns
      to the exact start. Chain of 6 follows (arc taps, panel rows where the sheet covers the arcs) backs out step by step through the same 6 places to an empty stack; Backspace then goes to the parent
- [x] **Edge cases.** Links into closed files (4 cases: file opens during the glide, lands on the symbol, nothing left pending); into a collapsed +N orb (2 cases: lands on the target file, which expands);
      a symbol past the 400-symbol cut (synthetic dataset written and removed by the test: 450 functions; symbol 420 has no node -> lands exactly on the FILE, nothing pending, Back returns; symbol 10 -> lands on it);
      self links and duplicates (checked on every focus above)
- **Result: 162 / 162 checks pass** (portrait 77, landscape 77, desktop 3, shots 4, console 1; the first run had 15 failures: 3 from the pickArc bug below, 12 test mistakes: panel names with dots, orbs searched at the wrong
  focus, glide screenshots timed too late, a chain that gave up when the sheet hid the arcs, and tap targets that depend on the layout)
- **Bugs found and fixed:**
  1. `pickArc` only tested the second half (t >= 0.5) of every arc. For an arc that ARRIVES at the focus ("Called by", far end at t = 0) tapping near the far end did nothing, or followed a different arc.
     Fixed in main3d.js: the far half is t in [0.5, 1] when the far end is b, [0, 0.5] when it is a. Proven: with the old line the audit fails 3 checks in portrait, with the fix it passes
  2. Tap timing used `performance.now()` when our handler ran. A page stall (symbols loading) between touch-down and touch-up made a quick tap look like a long press (> 350 ms) and it was ignored: seen once in the
     test (an arc-end tap did nothing). navigation.js now uses the events' own `timeStamp` for tap length and double-tap interval
- **Not bugs, but worth knowing:** while gliding along an arc the arcs are those of the NEW focus (the followed arc stays, because it is also the new focus's link); other arcs of the old focus vanish at once.
  A symbol of a file past the 400 cut cannot be reached: following such a link ends on the file (by design, tested). In portrait the code sheet hides the lower half of the picture, so fewer arc ends are tappable there
  (the panel list is the way in)
- Test hooks added to `__explorer` (debug only): `arcDetails`, `edgePolylines`, `setLayers`, `readFrame`, `fileNode`, `symNode`, `setFolderDeps`, `setGlideScale`, `pendingSymbol`; `minimap.pointOf`; `nav.setGlideScale`
  (makes glides k times slower, used for the screenshots; 1 = normal)
- Screenshots of 3 arcs mid-glide: `screenshots/step2/glide-1.png .. glide-3.png` (portrait, glide slowed 20x, shots at 30 %, 50 % and 70 % of the way along three call arcs of one file)
- Left: the pulse direction is verified from the shader maths, not by watching the comet move; the headless GPU is a laptop Intel Iris Xe, not the S26; no check of arcs under motion (orbit damping) while a glide runs

### Step 2b — real-mouse arc clicking fixed (found by you on desktop; same on the phone)
Reported: clicking an arc end or body did not focus the other node, though the Imports/Calls list rows did. Reproduced with a real mouse (move, press, release). Causes and fixes:
1. **The toolbar covered the arc ends.** After the first follow the Back button appeared, the row wrapped to two rows and rose onto the lower rim, where most arc ends are. The click hit Home (focus went to the root) instead of the canvas. Fix: the toolbar is always ONE row (`flex-wrap: nowrap`); it drops its words (icons only) when it does not fit; Back is the last button and keeps its slot (invisible at depth 0), so showing it moves nothing. On phones under 520 px wide the one row scrolls sideways and Back comes FIRST (no room taken at depth 0). The picture is also centred above a bottom strip (`TOOLBAR_BAND_PX` 130, added to the code panel's bottom inset; not in the compact landscape layout, where the toolbar is a column on the left).
2. **Arcs were only pickable on their far half, and nodes always beat arcs.** Now `pickArc` measures the WHOLE arc (40 pieces, distance to each piece) and a click within 5 px of an arc line (9 px for a finger) follows the nearest arc even if a node is under the pointer. Exceptions: right around the focus (its arcs all start there: radius + 14 px means the focus), and hover-preview arcs never steal a click (only the focus's own arcs count). With no arc that close, the old rules apply (node first, then arcs within 10 px of empty space).
- **New test** (`AUDIT_ONLY=mouse`, 10 checks, desktop 1280x800, Back showing, real CDP mouse clicks): one row with and without Back, Back moves no other button, no arc point under a toolbar button, 14 clicks along arc ends/bodies each follow the nearest arc (independent dense-sampling expectation), 6 clicks on arc lines that are also over another node follow the arc, clicking the focus follows nothing.
- **Result: 172 / 172 checks pass** (`npm run test:phone`). The chain-of-6 test was adjusted, not weakened: it now accepts the nearest arc line (the new rule), resolves a link into a closed file after the file has opened, and compares places by file + symbol index (a symbol node gets a new id when its file is closed and reopened).
- **Still ambiguous (fix 2, not done):** arcs that end on the same 1-3 px blob (20 "Called by" arcs into collapsed folders) cannot be told apart by a click; the nearest wins. Arc ends are also small; no hover highlight yet (fix 4, not done).
- Not tested: the real S26 (finger reach, the sideways-scrolling toolbar, Back first); landscape still has the toolbar as a left column with no inset.

### Step 3 — code panel interconnections and visual tuning (headless verified)
- [x] Code context resolves JS/TS and Python import specs, maps matching imports, builds call targets from link data, and includes nested symbol descendants and definition lines. `tests/codecontext.test.js` passes without weakened import assertions.
- [x] The panel retains actual source line numbers after trimming leading blank lines. A regression test verifies a file with two leading blank lines still displays the first visible source row as line 3.
- [x] If `links.json` finishes loading after a file is already focused, the panel rebuilds its code tokens so calls become tappable without refocusing.
- [x] Focus flare softened: sun ray gain 0.08, pulse variation 3%, focus halo size 2.0 and lower halo strength; the core remains visible. Generated `public/data/zz_scroll` is ignored and absent from both `public` and `dist`; the phone audit removes its temporary fixture.
- Verification: `npm test` passes, including 46,670 scanner checks; `npm run build` succeeds; `npm run test:phone` passes **172 / 172** checks with no console errors.

### Step 4 — smooth code scrolling (pending in current working tree)
- Native panel overflow remains, but eased focus-line scrolling and its dedicated scroll-performance audit are not currently present. Do not report those interactions as complete until reimplemented and checked on the target phone.

## Later
5 Cross-file links (done early, in 4c) · 6 Search/info/git heat/2nd dataset · 7 AR tabletop · 8 User study + report · 9 VR Cardboard + final visual polish
