# CLAUDE.md — Hyperbolic Disease Atlas

**Hyperbolic Disease Atlas — A hyperbolic visualization and navigation system for exploring the Disease Ontology.**

Objective: explore the Disease Ontology through hyperbolic geometry in the Poincaré ball, enabling intuitive navigation of large hierarchical biomedical knowledge structures.

Solo student project for a Computer Graphics and AR/VR course. **Zero budget**: use only free tools, libraries, and hosting.

> **Pivot (Nov 2026, branch `atlas`).** The project started as "Hyperbolic Data Explorer" (first dataset: a code repository). The
> hyperbolic engine built for it is kept intact and is now the foundation of the Atlas. Everything below that mentions code
> repositories, symbols, git heat or import/call links describes **existing engine features that stay available for datasets that
> declare them** (see "Dataset capabilities"). The roadmap is in PROGRESS.md.

## Project principles (Disease Atlas)
1. The Poincaré ball is the primary navigation environment.
2. The system must preserve the original ontology's directed acyclic graph (DAG) relationships.
3. A simplified primary hierarchy (a spanning tree) may be used for layout, but no original ontology relationships may be discarded.
4. Every visual encoding must communicate meaningful information.
5. Never invent disease, gene, protein, phenotype or anatomical relationships.
6. Every biomedical association must have traceable source provenance.
7. The application is educational and exploratory, not a diagnostic or medical-advice system.
8. Preserve the existing hyperbolic engine wherever possible.
9. Load the complete active ontology. Use progressive expansion and level-of-detail rendering instead of arbitrarily deleting diseases.

## Dataset capabilities (engine vs. dataset)
- The engine (Möbius maths, layout, rendering, search, minimap, "+N" groups, study logging) is dataset-independent. **Do not
  hardcode dataset-specific assumptions (code, disease, ...) into it.**
- Optional features are switched on by **capabilities**, decided once per dataset in `src/capabilities.js`
  (`deriveCapabilities(json)`): `symbols`, `codePanel`, `gitHeat`, `dependencies`. UI and logic ask `caps.<name>`, never "is this a code repo?".
- A dataset declares them with an optional `"capabilities": [...]` list in its tree JSON (the list is the whole truth; declared
  features without backing data are switched off with a warning). Datasets without the field (sample repo, WordNet) are inferred
  from the fields they already have. A new dataset adds a capability by extending `CAPABILITY_NAMES` + its test.

## Project summary (original engine)
The engine shows huge hierarchies using hyperbolic geometry so the **whole tree is visible at once**. The first dataset was the folder tree of a code repository with thousands of files. The focus node sits at the center and is drawn large. Everything else shrinks toward the edge but stays visible (focus + context).

**Prior work to cite:** Lamping & Rao, Hyperbolic Browser (Xerox PARC); Munzner, H3 viewer; Poincaré embeddings (Nickel & Kiela) in machine learning.

**Users:** a new developer exploring an unfamiliar repo, or an analyst browsing a large taxonomy or org chart. Flat collapsible trees need endless scrolling and lose context.

**Evaluation:** a small user study comparing (a) a normal collapsible tree, (b) the 2D hyperbolic view, and (c) the VR/AR view, on tasks like "find file X".

## Tech stack
- **three.js + Vite**, vanilla JavaScript (**no React**), custom GLSL shaders.
- **WebXR**:
  - VR: stereo Google Cardboard-style headset. Inputs are head rotation, one tap, and gaze dwell.
  - AR: tabletop mode with plane detection and touch gestures.
- **Python 3** script that scans a folder and exports JSON.
- **Hosting:** GitHub Pages (free, and it gives the HTTPS that WebXR needs).
- **Target device:** Samsung Galaxy S26 running Chrome for Android.
- **Desktop fallback (required):** everything must also run in a desktop browser for debugging, with mouse look standing in for the head.

## Math and architecture rules
- Display uses the **Poincaré ball/disk model**.
- **All hyperbolic math lives in `mobius.js`.** Every formula gets a comment above it explaining it in plain English.
- **Layout:** root at the origin. Children sit at a fixed hyperbolic distance from their parent. (A tree too deep for the ball gets shorter edges on its deepest levels: `edgeLengthSchedule` in `layout.js`, from depth only. Trees that already fit keep the uniform length.) Each child gets angular space proportional to its subtree size.
- Use double-precision JS numbers. **Clamp the Euclidean radius below 0.995.**
- **Refocusing:** apply a Möbius translation to all nodes, animated along the geodesic over ~0.5 s with ease-in-out.
- **Later phases:**
  - Move the transform to the GPU (a uniform in the vertex shader).
  - For free flight, store the camera as a **hyperboloid-model (Lorentz) matrix** so rotations don't drift.

## Theme rule (keep the look restylable at the end)
- **Every visual constant** (colour, size, brightness, glow/fog distance, effect speed, edge width...) lives in `src/theme.js` with a comment, and shaders read it through `#define`s (`THEME_DEFINES`). Do not put tuning numbers in shaders or `main3d.js`. `npm test` fails if theme.js has dead constants or glsl.js grows colour literals.
- Debug: `?time=12.5` freezes the shader clock for repeatable screenshots.

## Visual goals (VR must look excellent)
- Dark "data galaxy" look: near-black background, glowing orbs for folders, small particles for files, light pulses along edges, a procedural starfield, and floating dust for parallax.
- Nodes are **camera-facing impostor quads** with a fake-sphere fragment shader (rim glow, highlight), drawn with **instancing**.
- Edges are **curved geodesics**.
- **Fog** fades by hyperbolic distance. Colors are warm near the focus and cool and dim far away.
- **No heavy post-processing.** Fake bloom uses additive halo quads, only on the focus node and its children.
- **Labels:** SDF text, about 25 visible at most, high contrast, no overlaps.

## Interaction goals
- Zoom in means gliding toward a node. Zoom out goes to the parent. Free flight means holding to drift where you look.
- **Semantic zoom:** far folders collapse into one orb with a "+N" count. Near folders expand into their children.
- **VR:** gaze reticle with **1.2 s dwell** to select, and tap as a shortcut.
  - Comfort rules: transitions **under 0.6 s**, **never rotate the user's view**, and keep a stable reference such as the skybox.
- **AR:** tap to place, drag to pan, tap a node to refocus, double-tap to go to the parent, pinch to scale.

## Performance targets
- **60 fps** on the phone.
- Up to **~3,000 visible nodes**.
- **Under 30 draw calls.**
- No post-processing.
- On-screen **fps counter** that can be toggled.

## Phases
The Disease Atlas roadmap (Phase 0-8) is in **PROGRESS.md** and supersedes the list below, which is the history of the original engine.
Work one phase at a time, and only when the user says "go".

### Engine history (Hyperbolic Code Explorer phases)
1. Python scanner + 2D Poincaré disk viewer with click-to-refocus  ✅
2. 3D Poincaré ball layout + geodesic animation  ✅
3. Visual polish (impostor shaders, geodesic edge shader, fog, starfield, labels)  ✅
4. **Code expansion**: files open into their own galaxy of classes/functions (4a scanner v2, 4b expansion + code panel, 4c links)
5. Cross-file links  ✅ (delivered inside 4c: scanner link resolution, bundled geodesic arcs, back stack, panel lists)
6. Usability for the user study: 6a search, 6b info card + git heat, 6c minimap + second dataset, 6d study mode (logging, export, collapsible-tree baseline)
7. AR tabletop mode
8. User study support + report
9. **VR Cardboard** (gaze/dwell, free flight, Lorentz camera) + final visual theme pass

Plan change (Nov 2026): VR moved from Phase 4 to the very end, together with the final look pass, because there is no
headset yet. **Keep ALL camera/navigation code in ONE module** so the VR camera (Lorentz matrix, which also fixes the
Phase 2 rotation drift) can replace it later without touching the rest.

## How to work with the user
- **Viva-ready:** the user must be able to defend every line. After finishing any file, explain in simple language what it does and why, and walk through each formula with a small numeric example.
- **One phase at a time.** Make sure each phase runs before moving on, and keep a working demo at every stage.
- **Simple, readable, commented code** over clever code.
- **Git:** commit at the end of each working step with a clear message.
- **Ambiguity:** ask one short question instead of guessing.
- **PROGRESS.md:** keep it current with what is done and what is next.
- Don't start a phase or write application code until the user says to.
