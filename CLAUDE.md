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

## Approved design decisions (Nov 2026: redesign of the experience)
The first look at the Disease Ontology in the inherited code-explorer viewer was a dense glowing graph, not an atlas. Decisions, in force until changed by the user:
1. **Default surface = the 2D Poincaré disk.** The 3D Poincaré ball stays fully functional as an alternative mode. 2D and 3D show the SAME hierarchy and support equivalent navigation; every implementation step delivers both, through a shared (renderer-independent) core.
   The normal default switches to 2D at the end of step 2.4. From then on `mode=3d` must be explicit.
2. **Study links never depend on the default.** Every study URL names its condition explicitly: `mode=tree`, `mode=2d` or `mode=3d` (and `tree=` for the dataset, see `dataset.js`).
3. **Initial screen = a disease-family overview**, a distinct navigation state (not the graph zoomed out). The 12,419 diseases are NOT all drawn at start; categories are shown with names and counts, and expansion is progressive. Expansion never moves anything: positions come from the one fixed hyperbolic layout, only the representation changes.
4. **Two counting methods, never mixed.**
   - *Primary-tree count* (overview and category sizes): every disease is counted once, under its primary parent (rule below), so categories are mutually exclusive and sum to the active term count (12,418 + the root = 12,419). Example: "disease of metabolism" shows 57.
   - *Full DAG descendant count* (information panel only, where calculated): counts every disease reachable through any `is_a` path; it can overlap between categories (metabolism: 904). Additional parent relationships are listed separately (5,217 extra `is_a` edges, 4,880 diseases with more than one parent).
   - The interface must say which count it shows and explain that DAG counts overlap. The deterministic primary-parent rule (shortest path to DOID:4, ties to the smaller DOID) is kept unchanged.
5. **Information panel** separates ontology facts (name, DOID, definition and its source references, synonyms with scope, parents, children, counts, alternative IDs) from external references (ICD, MeSH, OMIM, UMLS... shown as identifiers only, nothing fetched, nothing inferred). Missing data is shown as missing. Nothing anatomical, genetic or clinical is ever invented.
6. **Visual theme = calm, near-black scientific interface**, applied to ALL datasets (Disease Ontology, sample, WordNet). The galaxy look is removed, not kept as an option. See "Visual goals".
7. **Search** reaches any disease directly (name, synonym, DOID, ICD / MeSH code) and lights the path to it.
8. **Shared core.** Pure, renderer-independent modules (state machine for overview / explore, level-of-detail policy, disease data and indexes, disease panel) are used by the 2D and the 3D view. 3D code is not weakened.
9. **2D layout correction = strategy "S5" (adopted Nov 2026, specification below).** Chosen by the user after prototyping (PROGRESS.md, step 2.3a): wedge territories + budget-aware staggered rings + adaptive alphabetical navigation groups + display caps, with the parameters fixed here. No target may be met by compromising the geometry; the known exceptions are listed under "Known limitations".
10. **Display limits are not access limits.** At most 36 (desktop) or 24 (phone) siblings are ever shown at once as individual members. Groups stay expandable, every disease stays searchable, selectable and reachable (info panel and hyperbolic focus). Groups are never all expanded at once by default (a group is open only while it is on the focus path).
11. **Groups are navigation aids, not categories.** They are alphabetical runs of real names with transparent labels ("A-F", "Ab-Ag"); never present them as semantic or biological categories, and never let them replace or alter an ontology relationship.

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

**Evaluation:** a small user study comparing (a) a normal collapsible tree, (b) the 2D hyperbolic view, and (c) the 3D hyperbolic view (VR/AR remain optional), on tasks like "find disease X" and "which family does X belong to". Research question: does hyperbolic geometry improve exploration of large hierarchical biomedical ontologies?

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
  - **Fixed edge length is relaxed for wide parents (2D, "S5", exact rule).** A ring of n children at one distance L only has circumference 2π·sinh(L), too little for hundreds of children. The 2D layout (`layout.js` `computeLayout`, display tree from `displaytree.js`) therefore works as follows. Symbols: BASE = 0.6 (2D edge length), BUDGET = 2·atanh(0.994) = 5.806, sched[d] = `edgeLengthSchedule(M, BASE)` with **M = depth of the whole DISPLAY tree (global, never the visible depth)**.
    - *State per node:* P = path length used so far, S = sum of sched over its depth, f = (BUDGET − P)/(BUDGET − S) (1 when nothing was widened; 1 at the last level).
    - *Angles:* child i of a node with fan F gets share s_i = (1−mix)/n + mix·w_i/Σw (**mix = 0.7**, w = number of real diseases in the subtree; a group's w is the sum of its members'), slice_i = F·s_i centred on its angle; the root's fan is 2π, any other fan is min(1.8π, 2β) of its parent's wedge.
    - *Lengths (staggered rings):* L0 = f·sched[d]; Lmax = max(L0, BUDGET − P − **capF**·(BUDGET − S − sched[d])) with **capF = 0.2** (deeper levels keep at least 20 % of their schedule). Ring step = target spacing 0.045. R = the smallest ring count in 1..floor((Lmax−L0)/0.045)+1 for which every pair of siblings (checked within 3R+3 neighbours, cyclic at the root) is at least 0.045 apart; child i sits at L_i = L0 + (i mod R)·0.045 (sawtooth). If no R works, R = the maximum and the parent is **unresolved**.
    - *Position:* z_i = z_parent ⊕ tanh(L_i/2)·(cos α_i, sin α_i), exact Möbius addition; pair distances use cosh d = cosh L_i·cosh L_j − sinh L_i·sinh L_j·cos Δ.
    - *Wedge rule (no subtree overlap):* territory half-angle θ_i = 0.9·slice_i/2 seen from the parent; the child's fan is 2β_i, β_i = 2·atan(e^{L_i}·tan(θ_i/2)) (L_i = ITS edge length), capped at 1.8π. A child's whole subtree stays inside its wedge, so sibling subtrees never overlap.
    - *Radius budget:* every root-to-node path sums to ≤ BUDGET, so no node can exceed radius 0.994.
    - *Stability:* a node's position depends only on its ancestors and siblings (and the global M), never on what is open. Expanding or collapsing moves nothing.
  - **Navigation groups and display caps (adaptive grouping, shared by 2D and 3D).** `displaytree.js` builds the display tree once per page load from the real tree; 2D and 3D lay out the SAME display tree. A parent with n children first tries to keep them as they are (allowed only if n ≤ cap). Otherwise it tries group sizes G in {60, 40, 36, 30, 24, 18, 12, 8} with G < n and G ≤ cap (**cap = 36 desktop, 24 phone**), largest first, and takes the first G for which every level it creates reaches the target spacing 0.04; if none does, it takes the candidate with the best minimum spacing and flags the parent. Parents with fewer than 6 children are never grouped. How a candidate list is made: children WITH their own subtypes stay individual if there are ≤ G of them, else they are cut into balanced alphabetical runs of ≤ G ("Subtypes"); childless children are cut into balanced alphabetical runs of ≤ G ("Diseases", up to 3 stay individual); a list still longer than G is cut again. Sorting is case-insensitive by name, then by id. A group is a display node (type folder, `isGroup`, no DOID) that carries its full member list. Its label is the smallest and the largest name of its members, as initials ("A–F"; more letters, up to 12, only to tell the ends apart: "Aba–Abd"; "Autosomal re…" when all names start alike; "#" for names that do not start with a letter). A list that mixes individual subtypes with groups is ordered by where each entry starts before it is cut again. The orb text says what the members are, because subtypes and childless diseases are separate alphabetical lists and two groups can both run "A–F": "A–F · 24" (diseases without subtypes), "A–F · 12 with subtypes", "A–F · 5 groups". One pure alphabetical list over all children was measured and rejected (it squeezes big subtrees into narrow wedges: 17 list-only nodes instead of 3). **The real tree, `disease_edges.json` and all 12,419 terms are never changed.**
  - **List-only parents.** A parent that is flagged unresolved (its children are < 0.04 apart even when grouped) is shown as a "+N" aggregate with a searchable member list; its children are not drawn individually (except the one on the focus path), but each stays selectable through the list, search, the info panel and hyperbolic focus.
  - **Known limitations of S5** (measured, see PROGRESS.md): (1) a few deep parents are list-only (3 parents with 17 children at cap 36, 5 parents at cap 24); (2) the closest pair of any two nodes can still be ~0.004 hyperbolic units; (3) with every group of a parent open at once, members of neighbouring groups can be closer than siblings (never opened all at once by default); (4) a phone disk at zoom 1 is tight (zoom 2 or the cap of 24); (5) grouped parents show alphabetical, not DOID, angular order; (6) 3D uses the same display tree but its own cone rule geometry.
- Use double-precision JS numbers. **Clamp the Euclidean radius below 0.995.**
- **Refocusing:** apply a Möbius translation to all nodes, animated along the geodesic over ~0.5 s with ease-in-out.
- **Later phases:**
  - Move the transform to the GPU (a uniform in the vertex shader).
  - For free flight, store the camera as a **hyperboloid-model (Lorentz) matrix** so rotations don't drift.

## Theme rule (keep the look restylable at the end)
- **Every visual constant** (colour, size, brightness, glow/fog distance, effect speed, edge width...) lives in `src/theme.js` with a comment, and shaders read it through `#define`s (`THEME_DEFINES`). Do not put tuning numbers in shaders or `main3d.js`. `npm test` fails if theme.js has dead constants or glsl.js grows colour literals.
- Debug: `?time=12.5` freezes the shader clock for repeatable screenshots.

## Visual goals (calm scientific theme: approved, implemented in step 2.6)
- **Near-black, calm, professional.** No starfield, nebula, dust, bloom, twinkle, light pulses, random "hero" nodes or decorative particles. This replaces the old "data galaxy" look for every dataset.
- **Every visual encoding means something** (principle 4). Hue = top-level family (restrained purple / blue / teal and other muted, colour-blind-safe hues, fixed by the ontology branch, never by index order or randomness). Lightness = depth. Size = log of the primary-tree count. Ring = "has subtypes", filled dot = leaf. Brightness is never random.
- Nodes are flat discs with a thin outline, drawn as **camera-facing instanced quads** with a simple fragment shader (no fake sphere, no halos).
- Edges are **thin curved geodesics**: primary hierarchy edges solid and family-tinted; additional `is_a` relationships dashed and neutral, shown for the selected or hovered disease only.
- **Labels:** SDF text, contextual (focus, its children, the hovered node, the largest visible groups), about 25 at most, high contrast, no overlaps. Leaves never label themselves in the overview. Folded groups are named ("syndrome · 486 more").
- All look constants stay in `src/theme.js` (theme rule below). Fog by hyperbolic distance may stay, subtle.
- Until step 2.6 lands, the viewer still renders the inherited galaxy look. That is known and intended to go.

## Interaction goals
- **Overview state:** a distinct, camera-locked state showing the families; an always-visible Overview button returns to it. Opening a family enters the explore state (same 0.5 s geodesic glide).
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
The Disease Atlas roadmap (Phase 0-8, with the redesign steps 2.1-2.8 and their dependencies) is in **PROGRESS.md** and supersedes the list below, which is the history of the original engine.
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
