# HANDOFF — Hyperbolic Disease Atlas

Written for a teammate who continues development on their own computer. It describes the state of the repository **as it was when this file was written**,
including what is unfinished and what is broken. Read it together with `CLAUDE.md` (project rules and approved design decisions) and `PROGRESS.md` (the detailed
log of every step, with measurements). Nothing here is a new feature: it is documentation only.

> **Read this first: the work is NOT all on GitHub yet.**
> - `origin/atlas` still points at the original base commit (`5865404`). The nine atlas commits listed in section 6 exist only on the author's computer.
> - On top of those commits there are **uncommitted changes** (step 2.3b, unfinished, section 5).
> - Until the author commits and runs `git push -u origin atlas`, a clone of the repository cannot see any of the Disease Atlas work.

---

## 1. What the project is

**Hyperbolic Disease Atlas**: a hyperbolic visualization and navigation system for exploring the **Disease Ontology** (DOID, 12,419 active diseases).
It is a solo student project for a Computer Graphics and AR/VR course, built with **zero budget** (free tools, libraries and hosting only).

**Research question:** does hyperbolic geometry (the Poincaré disk and ball) improve the exploration of large hierarchical biomedical ontologies?
The planned user study compares three conditions on the same data: (a) a conventional collapsible tree (`?mode=tree`), (b) the 2D hyperbolic disk (`?mode=2d`),
(c) the 3D hyperbolic ball (default). The whole tree is visible at once: the focused node is large in the centre, everything else shrinks toward the rim but stays visible
(focus + context). Clicking a node glides the view to it along a geodesic (a Möbius translation, 0.5 s).

**Project principles (CLAUDE.md):** the Poincaré model is the navigation environment; the ontology's DAG is preserved (no `is_a` relationship is ever discarded; a simplified
primary hierarchy is only a layout device); every visual encoding must carry meaning; **never invent** disease, gene, protein, phenotype or anatomical relationships; every
biomedical association needs traceable provenance; the application is educational and exploratory, **not** a diagnostic or medical-advice system; load the complete ontology
(use progressive expansion and level of detail, never arbitrary deletion).

History: the engine began as "Hyperbolic Data Explorer" (a code-repository explorer, with symbols, import/call arcs, git heat). It was pivoted to the Disease Atlas in Nov 2026
on branch `atlas`. The code-explorer features still exist and are switched on only for datasets that declare them (the **sample** dataset), see "capabilities" below.

## 2. Architecture and technology

- **three.js + Vite**, vanilla JavaScript (**no React**), custom GLSL shaders (3D), SDF text via `troika-three-text`, plain DOM for panels and toolbars.
- **Python 3** (standard library) scripts generate the data files (`tools/`). **Node 22** is required (the browser tests use Node's built-in `WebSocket` and `fetch`).
- Hosting target: GitHub Pages (HTTPS, needed for WebXR later). Target device: Samsung Galaxy S26, Chrome for Android. A desktop browser must work for everything.
- The site is served under the base path **`/hyperbolic-explorer/`** (`vite.config.js`), also in development.

**How the pieces fit (shared core, two renderers):**

1. **Data**: `public/data/disease_tree.json` is the *primary hierarchy* (one parent per disease, used for layout). `disease_edges.json` holds *every* `is_a` edge (the full DAG).
   `disease_terms.json` holds names, definitions, synonyms, cross-references. `disease_metadata.json` holds provenance and statistics.
2. **Display tree** (`src/displaytree.js`): the real tree plus *alphabetical navigation groups* under very wide parents (a parent with 486 or 1,048 children cannot show them all).
   Groups are display aids, **not** ontology categories (no DOID, never searchable results). Built once per page load; **2D and 3D lay out the same display tree**.
   A parent whose children stay too close together even when grouped becomes **list-only** (a "+N" aggregate with a searchable member list).
3. **Layout**: `src/layout.js` is the 2D "S5" layout (wedge territories so sibling subtrees never overlap, staggered rings for wide parents, a rigorous radius budget so no node
   reaches the 0.995 clamp). `src/layout3d.js` is the 3D layout (cone rule on a sphere). The exact S5 formula and parameters (capF 0.2, mix 0.7, caps 36 desktop / 24 phone)
   are written out in `CLAUDE.md`. **Do not change them without the owner's approval.**
4. **Shared interaction rules** (`src/disclosure.js`): which nodes are drawn, collapsed to a "+N" aggregate, or hidden (groups open only on the focus path; far categories collapse by
   hyperbolic distance with hysteresis; list-only nodes), and `realParent()` (Up goes to the real ontology parent, never a group).
5. **Data layer** (`src/diseasedata.js`): lazy, cached loading of terms / edges / metadata; one record per disease carrying both hierarchies and both counts
   (primary-tree count vs full-DAG count, never mixed); lookup by DOID / alternative id / obsolete id / cross-reference / name / synonym; provenance.
6. **Disease panel** (`src/diseasepanel.js`, content as data in `src/panelmodel.js`): docked column (desktop) or bottom sheet (portrait phone), shared by 2D and 3D.
7. **Viewers**: `src/main3d.js` (3D ball, GPU refocus in the vertex shader), `src/main2d.js` (2D disk, CPU transform), `src/maintree.js` (collapsible tree baseline). `src/main.js` picks one
   from the URL. 3D camera/navigation code is in `src/navigation.js`; 2D in `src/navigation2d.js`.
8. **Capabilities** (`src/capabilities.js`): a dataset declares which optional features it supports (`symbols`, `codePanel`, `gitHeat`, `dependencies`). The Disease Ontology declares `[]`
   (no code features). The sample dataset is inferred from its fields.
9. **Theme rule**: every visual constant (colour, size, brightness, effect speed...) lives in `src/theme.js` with a comment; shaders read them through `#define`s. `npm test` fails on dead
   constants. (Note: `main2d.js` still has a few hard-coded colours, see section 8.)

**Mathematics**: all hyperbolic math lives in `src/mobius.js` (2D) and `src/mobius3d.js` (3D), each formula with a plain-English comment and a numeric example.
Double precision on the CPU; the 3D GPU path uses float32 (checked against the CPU by `__explorer.gpuCheck()`).

## 3. Repository structure

| Path | What it is |
|---|---|
| `index.html`, `vite.config.js`, `package.json` | entry page, Vite config (base path), scripts |
| `CLAUDE.md` | project rules, approved design decisions, the exact S5 specification. Written for the author's AI assistant, but it is the authoritative rule set for everyone |
| `PROGRESS.md` | the detailed log: roadmap, every step with results, known limitations |
| `HANDOFF.md`, `README.md` | this file; basic setup |
| `src/` | all application code (see below) |
| `src/mobius.js`, `mobius3d.js` | hyperbolic math (2D, 3D) |
| `src/layout.js`, `layout3d.js` | layouts (2D S5, 3D cone rule); `buildTree` and the radius-budget schedule are in `layout.js` |
| `src/displaytree.js`, `disclosure.js`, `families.js`, `dataset.js`, `capabilities.js` | display tree + groups, show/hide rules + real parent, family colours, which tree file a page loads, dataset capabilities |
| `src/diseasedata.js`, `panelmodel.js`, `diseasepanel.js`, `memberlist.js` | data layer, panel content, panel UI, searchable member list |
| `src/main.js`, `main2d.js`, `main3d.js`, `maintree.js` | entry router and the three viewers |
| `src/navigation.js`, `navigation2d.js` | 3D camera/input; 2D zoom, drag, tap |
| `src/labels.js`, `toolbar.js`, `breadcrumb.js`, `searchui.js`, `search.js`, `minimap.js`, `infocard.js`, `fps.js`, `idlefade.js`, `quality.js` | shared UI pieces |
| `src/glsl.js`, `gpucheck.js`, `theme.js` | 3D shaders, CPU/GPU check, all visual constants |
| `src/symbols.js`, `links.js`, `codepanel.js`, `codecontext.js`, `heat.js`, `study.js`, `studylog.js` | code-explorer features (sample dataset) and the user-study mode |
| `public/data/` | datasets: `disease_*.json` + `disease_LICENSE.txt` (generated), `sample_tree.json` + `sample/` (fake repository), `wordnet_tree.json` + licence |
| `public/study/` | study task files (sample and WordNet only; no disease tasks yet) |
| `public/fonts/` | Inter (SIL OFL) for labels, with its licence |
| `tools/` | data generators and scanners (`make_disease_tree.py`, `make_wordnet_tree.py`, `make_sample_tree.py`, `scan_folder.py`, `links.py`, `parse_js.mjs`, `make_study_tasks.py`) |
| `tools/proto/` | the pure-Node 2D layout prototypes that led to S5 (kept for reference; not used by the app) |
| `tools/cache/` | downloaded ontology file (git-ignored, recreated by the generator) |
| `tests/` | Node unit tests (`*.test.js`, `scanner_test.py`) |
| `tests/phone/` | real-browser audits driven over the Chrome DevTools Protocol (`cdp.mjs` is the tiny driver) |
| `screenshots/` | images that document the implementation (layout prototypes, group and panel views, earlier phone polish). **Keep them** |
| `dist/`, `node_modules/` | build output and dependencies (git-ignored) |

## 4. Quick start

Requirements: **Node 22 or newer**, npm, Python 3 (only for `npm test` and the data generators), and **Chrome or Edge** for the browser tests
(set `CHROME_PATH` if it is not in a standard location; see `tests/phone/cdp.mjs`).

```bash
git clone https://github.com/Sanjana-1905/hyperbolic-explorer.git
cd hyperbolic-explorer
git fetch origin
git checkout atlas        # only works once the author has pushed the atlas branch (see the box at the top)
npm install
npm run dev               # Vite dev server on port 5173, also on the LAN (so a phone can open it)
```

Open **`http://localhost:5173/hyperbolic-explorer/`** (the `/hyperbolic-explorer/` part is required; `/` redirects to it).

### URLs (all relative to `http://localhost:5173/hyperbolic-explorer/`)

| What | URL |
|---|---|
| **Disease Atlas, default view (3D ball today)** | `?` or just the base URL |
| 3D ball, explicit | `?tree=disease_tree.json` (any `mode` other than `2d` / `tree` is 3D) |
| **2D Poincaré disk** | `?mode=2d` |
| Collapsible tree baseline | `?mode=tree` |
| Sample dataset (fake code repository, all code features) | `?tree=sample_tree.json` (also `&mode=2d`, `&mode=tree`) |
| WordNet (3,000 nouns) | `?tree=wordnet_tree.json` (also `&mode=2d`, `&mode=tree`) |
| User-study mode | add `&study=1` (a study URL without `tree=` loads the **sample**, because only sample / WordNet have task files) |

Useful parameters: `intro=0` (no "How to explore" card; **2D tests need it, the card blocks clicks**), `panel=0` (old info card instead of the disease panel; the older
audits use it), `cap=N` (override how many siblings may show at once; 36 desktop, 24 phone), `quality=low|phone|high`, `adapt=0`, `fade=0`, `time=12.5` (freeze the shader clock
for repeatable screenshots), `search=0`, `fps=1`.
**Today the default mode is still 3D.** The approved plan is to make 2D the default at the end of step 2.4 and to require an explicit `mode=2d|3d|tree` in every study link; that is **not done yet**.

### npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (port 5173, LAN-visible) |
| `npm run build` | production build into `dist/` |
| `npm run preview` | serve the built `dist/` |
| `npm run deploy` | build and publish `dist/` to the `gh-pages` branch. **Do not run for the atlas branch without the owner's approval** (it would replace the live site) |
| `npm test` | 22 Node unit-test steps (math, layouts, display tree, data layer, panel model, shared rules, theme, scanner...) |
| `npm run test:phone` | browser audit of the **sample** dataset in 3D: tree edges, link arcs, link following, real-mouse arc clicking (172 checks) |
| `npm run test:disease` | browser audit of the full Disease Ontology: layout numbers, GPU vs CPU positions, picking, edges, navigation, 2D clicks (19 checks) |
| `npm run test:groups` | navigation groups, caps, list-only nodes, search into a closed group, reachability, desktop + phone, 2D + 3D (109 checks) |
| `npm run test:data` | the disease data layer in the real viewers: lazy loading, identical records in 2D and 3D, sample / WordNet untouched (34 checks) |
| `npm run test:panel` | the disease panel: selection, switching, missing data, additional parents, layout, 2D/3D parity (140 checks) |
| `npm run test:parity` | **step 2.3b**: 2D/3D feature parity: toolbar, labels at several zoom levels, picking, hover, Up, groups, search, zoom, drag, pinch, responsive layouts. **Currently 6 checks fail, see section 5** |

Browser audits start their own Vite server on a fixed port (5188 phone, 5192 disease, 5194 groups, 5195 data, 5197 panel, 5201 parity), launch headless Chrome, and exit non-zero on any
failure. Run them **one at a time** (they share nothing but the ports). Use `ONLY="2D phone,3D landscape" npm run test:parity` to run chosen modes only (comma list, case-insensitive substring).
Screenshots go to `screenshots/<audit name>/` unless you pass an output folder as the first argument.

### Regenerating the data

`python3 tools/make_disease_tree.py` downloads the official Disease Ontology release (default tag `v2026-10-29`; `--tag latest` for the newest; `--obo file` for a local copy), validates it
(duplicates, missing parents, cycles, disconnected terms, primary-parent correctness) and rewrites the five `public/data/disease_*` files. It is deterministic: re-running with the same tag
reproduced the terms, edges and licence files byte-for-byte. `make_wordnet_tree.py` needs `nltk` and its WordNet data; `make_sample_tree.py` needs nothing.

## 5. Current work: step 2.3b (2D feature parity), UNFINISHED and UNCOMMITTED

**Goal (approved by the owner):** bring the 2D viewer to parity with 3D and make Up go to the real ontology parent. The visual style is deliberately unchanged in this step.

**Implemented in the working tree (not committed):**
- 2D: zoom (wheel, pinch, + / - buttons), drag-to-pan (Möbius translation of the view), contextual labels (selected disease, hover, nearest 3 real ancestors, children, "+N" aggregates, any node drawn
  big enough; more labels as you zoom), the shared toolbar (search, Home, Up, zoom, Info, help, fullscreen), search, breadcrumb, category and group expansion by the same rule as 3D, family colours
  identical to 3D, hover label, double-tap = Up, Backspace = Up.
- Up / Backspace / double-tap go to the **real parent** in both 2D and 3D (never an alphabetical group). The breadcrumb leaves groups out. 3D also labels the nearest real ancestors now.
- Defects found and fixed along the way: labels could extend under the disease panel (now confined to the free part of the screen); the selected disease's label is always placed (it slides inside the
  free area if no spot fits); the toolbar scrolls instead of clipping on narrow windows; Home is enabled whenever the zoom or the view differs from the start; the panel is narrower on a landscape phone.

**Files and modules changed in this work (all uncommitted):**

| File | Change |
|---|---|
| `src/main2d.js` | rewritten around the shared pieces: nav2d, labels, toolbar, search, breadcrumb, semantic collapse, family colours, hover, Up = real parent, test hooks |
| `src/navigation2d.js` (new) | 2D zoom, drag, pinch, tap, double-tap, hover |
| `src/breadcrumb.js` (new) | breadcrumb extracted from `main3d.js`, shared |
| `src/families.js` (new) | family hues shared by 2D and 3D |
| `src/disclosure.js` | added `realParent()` and `semanticStates()` (groups + list-only + distance collapse with hysteresis) |
| `src/main3d.js` | uses the breadcrumb module, Up / Backspace / double-tap via `realParent`, ancestor labels, label inset |
| `src/labels.js` | `setInset()` (labels stay out of panels / toolbar strip), always place the selected / hovered label |
| `src/toolbar.js` | optional zoom buttons, `hasInfo`, `homeDisabled`, horizontal scrolling at every width |
| `src/diseasepanel.js` | width `min(392px, 100vw, max(280px, 46vw))`; layout variables from the measured width |
| `src/theme.js` | `ZOOM2D_MAX`, `ZOOM2D_STEP`, `ZOOM2D_WHEEL`, `LABEL2D_MIN_RADIUS_PX` |
| `package.json` | scripts only: added `test:parity`; `npm test` now also runs `tests/semanticzoom.test.js`. **No dependency changed** |
| `tests/semanticzoom.test.js` (new) | real parent, collapse rule with hysteresis, family colours |
| `tests/phone/parity_audit.mjs` (new) | the parity audit |
| `tests/phone/{data,disease,groups,panel}_audit.mjs` | adapted: `intro=0` for 2D URLs; Up now goes to the real parent (one Up from a group member returns to its real parent); 2D panel reopens via the toolbar Info button |

**The six failing checks (all in the landscape-phone emulation, 844 x 390):**
`3D landscape phone` and `2D landscape phone`: "a real tap on X selects it", "a double-tap goes up to the real parent", "tapping group #–A opens exactly that group".
- Everything else in those two modes passes (43 checks when the landscape modes run alone, including all of these three).
- The failures appear only when the landscape modes run **after the `2D phone` mode**. With `ONLY="2D phone,3D landscape"` they reproduce; with `ONLY="3D phone,3D landscape"` they do not.
- Observed in the failing case: after `2D phone`, a touch tap on the next page produces **no pointer event at all** (a listener on `document` sees nothing), so the failure is in input delivery,
  not in the app's tap logic. The `2D phone` mode is the only one that performs a two-finger pinch.
- Investigation status: **not resolved**. Small reproductions (pinch, then a tap on a new page; double-tap then pinch then tap) all worked, so the cause is not isolated. The page scale factor is 1.
  Resetting the touch emulation (`desktop()` before `phone()`) did **not** fix it. The last experiment (skipping only the pinch) was interrupted before it finished.
  Hypotheses, none verified: the DevTools touch emulation keeps stale multi-touch state after the pinch sequence; or something in 2D phone leaves the emulated touch device in a state the next run cannot recover from.
  It is **not proven** to be only a test-harness problem. If skipping the pinch removes the failures, treat it as an automation issue and run the pinch check last or in its own run; if not, look for an app bug.

**Tests and their status:**

| Suite | Status |
|---|---|
| Last fully green run: commit `9a322ab` (before the 2.3b edits): `npm test` (21 steps), `npm run build`, `test:phone` 172/172, `test:disease` 19, `test:groups` 109, `test:data` 34, `test:panel` 140, plus 13 launch URLs | **passed, but on the code before 2.3b** |
| `node tests/semanticzoom.test.js` (new) | passed with the 2.3b code |
| `npm run test:parity` (new), last full run | 185 checks passed, **6 failed** (landscape phone, above) |
| `npm test` (full, now 22 steps), `npm run build`, `test:phone`, `test:disease`, `test:groups`, `test:data`, `test:panel` | **NOT rerun after the 2.3b changes** (some audits were edited and are untested) |

**Remaining for step 2.3b:** resolve or explain the six failures; rerun every suite above and fix any fallout (the 3D viewer, labels, toolbar and panel files changed); write the step's report in
`PROGRESS.md` and `CLAUDE.md`; commit it as its own step; **wait for the owner's approval** before step 2.4.

## 6. Git state and workflow

- Remote: `origin` = `https://github.com/Sanjana-1905/hyperbolic-explorer.git`. Branches: `main` (the original Code Explorer), `atlas` (this work), `gh-pages` (deployed site).
- `atlas` was created from the last pushed `main` (`5865404`). **`origin/atlas` is still at `5865404`.** Local `atlas` is 9 commits ahead, then has uncommitted changes:

| Commit | Milestone |
|---|---|
| `1e52269` | Phase 0: pivot docs, dataset capability detection |
| `3179de9` | Phase 1: Disease Ontology ingestion (DOID 2026-10-29), full DAG, validation |
| `c3a2336` | Phase 1 fix: depth-tapered edge length (no node reaches the radius clamp) |
| `b474775` | Disease Ontology is the default dataset, page title; `?study=1` keeps the sample |
| `4d1fbc2`, `ff65dd2` | docs and the two rounds of 2D layout prototypes (`tools/proto/`, no production change) |
| `ff4c518` | S5 layout implemented: wedges, staggered rings, navigation groups, caps, list-only nodes |
| `ae1c341` | Step 2.1: disease data layer |
| `9a322ab` | Step 2.2: disease information panel (2D + 3D) |

- The author's local `main` (checked out in a second worktree on the author's machine) is **17 commits ahead of `origin/main`** with unrelated, unpushed Code-Explorer work. `atlas` does not contain it.
  Do not merge `atlas` into `main`; the owner decides when.
- **To publish for a teammate (author, once):** commit the working tree (a work-in-progress commit is fine, e.g. `WIP step 2.3b: 2D parity, 6 landscape-phone failures open (see HANDOFF.md)`), then
  `git push -u origin atlas` (a plain fast-forward; no force is needed).
- **To continue (teammate):** `git fetch origin && git checkout atlas`, `npm install`, run `npm test`, then the browser audits. Work on `atlas` (or a branch from it); keep commits small, **one step per commit**,
  with a message that says what changed and the test results. Run `npm test` and the relevant `test:*` before committing. Keep `PROGRESS.md` and `CLAUDE.md` in step with the code.
- Working rules from the owner (see `CLAUDE.md`, "How to work with the user"): one phase / step at a time, only when the owner says go; the owner must be able to defend every line (simple, readable, commented code
  with a numeric example for each formula); **ask instead of guessing**; do not start a step, change the layout mathematics, the S5 parameters or the ontology data without approval; do not push to `main` or deploy.

## 7. Data sources, versions and licences

| Data | Source | Version | Licence |
|---|---|---|---|
| **Disease Ontology** (`public/data/disease_*`) | official Human Disease Ontology, OBO Foundry: `https://raw.githubusercontent.com/DiseaseOntology/HumanDiseaseOntology/v2026-10-29/src/ontology/doid.obo` (the PURL `http://purl.obolibrary.org/obo/doid.obo` redirects to the newest file of the same repository) | release **2026-10-29**, tag `v2026-10-29`, 7,313,592 bytes, SHA-256 `b208a1bc910ba681...` (full hash in `disease_metadata.json`), downloaded 2026-11-11 | **CC0 1.0 Universal**; text in `public/data/disease_LICENSE.txt` |
| WordNet noun hierarchy (`wordnet_tree.json`) | Princeton WordNet 3.0 (3,000 most important nodes) | 3.0 | WordNet licence, `public/data/wordnet_LICENSE.txt` |
| Sample repository (`sample_tree.json`, `sample/`) | generated by `tools/make_sample_tree.py` (fake files, **fake git history**, flagged as such in the UI) | n/a | n/a |
| Inter font | `public/fonts/` | SemiBold | SIL OFL, `public/fonts/Inter-LICENSE.txt` |
| Libraries | three.js, troika-three-text (runtime); Vite, gh-pages, @babel/parser (development) | see `package.json` / lockfile | MIT-style |

The ontology's own cross-references (ICD, MeSH, OMIM, UMLS...) are shown as identifiers only and labelled as belonging to other resources; nothing is fetched or interpreted.
Counts: 14,939 term stanzas, 2,520 obsolete (removed), **12,419 active**, **17,635 `is_a` edges**, 4,880 multi-parent diseases, maximum depth 12, 8 top-level families
(primary-tree counts 5,284 / 3,384 / 1,179 / 1,058 / 521 / 492 / 443 / 57; full-DAG counts overlap, e.g. metabolism 904).
The application states that it is educational and exploratory and not a medical-advice system.

## 8. Outstanding issues and open decisions

**The visual redesign has NOT been started.** The owner is not satisfied with the inherited "galaxy" look and asked for it to be brought forward from step 2.6, as a **visual redesign, not a geometry redesign**:
- Preserve: the Poincaré mathematics, the S5 layout and coordinates, hyperbolic distances and geodesic edges, picking and hit-testing, progressive disclosure and groups, relationships and selection logic, all data and navigation, the disease panel.
- Change: background (remove nebula, starfield, dust, particles, decorative gradients; restrained near-black); node treatments (distinct for major categories, subcategories, diseases, aggregated groups, selected and hovered; solid controlled
  colours, meaningful size/shape, no luminous glow); edges (thin, understated primary edges; a distinct dashed style for additional relationships; geodesic rendering kept); labels (fewer overlaps; priority: selected, ancestors, children, important categories;
  zoom-dependent visibility; consistent typography; group labels that say what they contain); colour system (restrained, **colours must correspond to actual ontology branches**, not decorative assignments; selection by outline, not a big white glow);
  minimap and toolbar restyled consistently in 2D and 3D.
- **Required process:** first identify the exact shaders, theme rules and rendering components responsible for the current look and which effects can be removed without touching geometry or picking; propose a concrete visual system
  (colour tokens, node, edge, label and selection styles); **show the proposal to the owner and wait for approval before changing any rendering code.** No proposal has been written yet.
  Starting points (not yet audited): `src/glsl.js` (node impostors, edges, nebula, starfield, shell rim), `src/theme.js`, the dust / halo / sun meshes and `assignVisuals` in `src/main3d.js`, the colour constants in `src/main2d.js`, `src/minimap.js`.

**Other open items:**
1. Step 2.3b unfinished (section 5); the six landscape-phone failures are unexplained.
2. Steps 2.4 to 2.8 not started: family overview + a global node budget (display caps are per list today; several lists can be on screen), making 2D the default, step 2.5 dashed arcs for additional parents (the colours are already fixed
   in `theme.js`: `REL_PRIMARY_COLOR`, `REL_EXTRA_COLOR`), step 2.6 restyle (now the visual redesign above), step 2.7 search by synonym / DOID / ICD / MeSH (the data is ready: `searchRecords()`), step 2.8 tree-baseline parity and the study (disease task file; explicit `mode=` in every study link).
3. **No physical-device testing has ever been done.** All "phone" results are Chrome headless emulation (touch + phone user agent). A real-device pass (Galaxy S26: layout, taps, member list, panel sheet, performance) is outstanding and must stay explicit.
4. Known 2.3b limitations: toolbar tooltips still use code-explorer wording ("Search files, folders and functions"); the family colour rule is the old index-based one (evenly spread hues by order), not yet tied to meaningful ontology branches; `main2d.js` still has hard-coded colours (the theme rule is
   not met there); on a portrait phone with the panel sheet open only the top third of the screen is picture; the panel and toolbar were checked only at 1280x800, 412x915, 844x390 and 800x600 (emulation).
5. Data/performance: the 5.3 MB terms file is fetched whole when the panel is first shown (desktop: at start-up; phone: when the sheet is unfolded), measured only on the local dev server; no memory measurement.
6. Layout limits (documented in `CLAUDE.md`): 3 (desktop) / 5 (phone) list-only parents; the closest pair of nodes can be about 0.004 hyperbolic units; members of neighbouring groups can be closer than siblings if every group is open at once (never done by default).
7. `?study=1` defaults to the sample dataset; there are no disease study tasks yet.
8. The older code-explorer features (symbols, import/call arcs, git heat, code panel) are intact for the sample dataset and covered by `test:phone`; they are out of scope for the atlas.

## 9. Repository hygiene check (done when this file was written)

- No secrets, API keys, tokens, `.env` files or private keys in any tracked or untracked-but-not-ignored file (searched case-insensitively; the only hits for "token" are ordinary code identifiers).
- No local machine paths and no personal data in source, tests, tools, data files or docs. Git commit metadata contains the author's name and e-mail address, as usual.
- `node_modules/`, `dist/`, `tools/cache/`, `tools/__pycache__/`, `.DS_Store` are git-ignored and not tracked. `.gitignore` also ignores `.env*`, `*.log`, `.idea/` and `.vscode/` now.
- Large tracked files are intentional: the generated ontology data (`public/data/disease_terms.json`, 5.3 MB) and the screenshots (about 17 MB, needed to understand the implementation). Nothing was deleted.
