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

## Next: Phase 3 — Visual polish (waiting for "go")

## Later
3 Visual polish · 4 VR Cardboard · 5 AR tabletop · 6 Search/info/minimap/2nd dataset · 7 User study + report
