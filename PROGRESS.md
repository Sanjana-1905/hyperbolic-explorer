# PROGRESS

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

## Phase 4 — Code expansion  (in progress)
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

## Later
5 Cross-file links (started in 4c) · 6 Search/info/git heat/2nd dataset · 7 AR tabletop · 8 User study + report · 9 VR Cardboard + final visual polish
