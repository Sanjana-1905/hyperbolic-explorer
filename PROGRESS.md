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

### 3b — Ambience (next; edges and GPU geodesics already done above)
- Still to do: travelling light pulse along edges (random phase per edge; `vT` and `vSeed` are already passed to the
  fragment shader), slow dust drift, optional desktop-only ambient rotation, fps report
### 3c — Labels, semantic zoom, breadcrumb

### Known limitations (3a)
- Nodes use no depth test (pure additive glow), so nothing occludes anything: intended for this look.
- Refocus-between-off-centre-nodes rotation (Phase 2 limitation) still applies; needed for VR later.

## Later
4 VR Cardboard · 5 AR tabletop · 6 Search/info/minimap/2nd dataset (plug real numbers into aHue/aEnergy/aFlag) · 7 User study + report
