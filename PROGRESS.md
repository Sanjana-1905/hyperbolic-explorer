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

## Next: Phase 2 — 3D Poincaré ball layout + geodesic animation (waiting for "go")

## Later
3 Visual polish · 4 VR Cardboard · 5 AR tabletop · 6 Search/info/minimap/2nd dataset · 7 User study + report
