# PROGRESS — Hyperbolic Disease Atlas

Project pivoted (Nov 2026, branch `atlas`) from Hyperbolic Code Explorer to the **Hyperbolic Disease Atlas**: exploring the
Disease Ontology in the Poincaré ball. Principles are in CLAUDE.md. One phase at a time, only when the user says "go".

## Roadmap

**Core deliverables**
| Phase | Title | Status |
|---|---|---|
| 0 | Freeze and prepare existing engine | **in progress** (acceptance checks below) |
| 1 | Disease Ontology data ingestion (full DAG, provenance, primary hierarchy for layout) | not started |
| 2 | Meaningful disease visualization (every encoding carries information) | not started |
| 3 | Interactive exploration lenses | not started |
| 4 | Comparative navigation study (collapsible tree vs 2D vs 3D hyperbolic) | not started |

**Optional extensions** (only if time allows; none is needed for the course deliverable)
| Phase | Title | Status |
|---|---|---|
| 5 | Anatomical visualization | optional, not started |
| 6 | Gene and protein integration (every association with source provenance) | optional, not started |
| 7 | Biological pathway animation | optional, not started |
| 8 | AR / VR (tabletop AR, Cardboard VR, Lorentz camera) | optional, not started |

## Phase 0 — Freeze and prepare existing engine  (in progress)

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
