# CLAUDE.md — Hyperbolic Data Explorer

Solo student project for a Computer Graphics and AR/VR course. **Zero budget**: use only free tools, libraries, and hosting.

## Project summary
"Hyperbolic Data Explorer" shows huge hierarchies using hyperbolic geometry so the **whole tree is visible at once**. The first dataset is the folder tree of a code repository with thousands of files. The focus node sits at the center and is drawn large. Everything else shrinks toward the edge but stays visible (focus + context).

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
- **Layout:** root at the origin. Children sit at a fixed hyperbolic distance from their parent. Each child gets angular space proportional to its subtree size.
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

## Phases (one at a time, and only when the user says "go")
1. Python scanner + 2D Poincaré disk viewer with click-to-refocus
2. 3D Poincaré ball layout + geodesic animation
3. Visual polish (impostor shaders, geodesic edge shader, fog, starfield, labels)
4. VR Cardboard mode with gaze/dwell and free flight
5. AR tabletop mode
6. Search, info panel, minimap, second dataset
7. User study support, polish, report

## How to work with the user
- **Viva-ready:** the user must be able to defend every line. After finishing any file, explain in simple language what it does and why, and walk through each formula with a small numeric example.
- **One phase at a time.** Make sure each phase runs before moving on, and keep a working demo at every stage.
- **Simple, readable, commented code** over clever code.
- **Git:** commit at the end of each working step with a clear message.
- **Ambiguity:** ask one short question instead of guessing.
- **PROGRESS.md:** keep it current with what is done and what is next.
- Don't start a phase or write application code until the user says to.
