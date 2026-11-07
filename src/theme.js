// theme.js - EVERY visual constant of the 3D "galaxy" look, in one place.
//
// HOW IT WORKS
//   - This file is a flat table of names -> numbers (or [r,g,b] colours / [a,b] ranges).
//   - themeDefines() turns the table into GLSL `#define`s, and main3d.js hands those to
//     every material. So a shader just writes `ARM_SATURATION` instead of `0.78`, and the
//     CPU code (picking, hue assignment) imports the very same numbers from here.
//   - To restyle the whole app, edit only this file. Nothing else needs to change.
//
// RULE FOR ALL LATER PHASES (labels, VR, AR, search highlights, minimap, ...):
//   Any new number that affects how something LOOKS (colour, size, brightness, speed of a
//   visual effect, distance at which something fades) goes in this table with a comment,
//   not into a shader or into main3d.js. Colours are [r, g, b] in 0..1; two-number lists
//   are ranges (low, high). Things that are not "look" (layout maths, the 0.995 clamp,
//   animation length, quality switches) stay where they are.
//
// Every value is a float in the shader. Integers are written as 3.0 automatically.

export const THEME = {
  // ---- Scene -------------------------------------------------------------------
  AMBIENT_SPIN_SPEED: 0.3,     // optional slow auto-rotation of the view (OrbitControls units; 2 = one turn per 30 s). Desktop only, off by default
  CLEAR_COLOR: 0x03040c,       // colour behind everything (deep navy-black); hex, JS only

  // ---- Arm palette (each top-level folder is an "arm" with its own hue) ----------
  // Hues are positions on the colour wheel: 0 red, 0.17 yellow, 0.33 green, 0.5 cyan,
  // 0.67 blue, 0.83 purple, 1 red again.
  ARM_HUE_FIRST: 0.47,         // first folder arm: teal
  ARM_HUE_LAST: 0.87,          // last folder arm: magenta (arms in between are spread evenly)
  ROOT_HUE: 0.6,               // the root folder when it is not the focus
  LOOSE_FILE_HUE: 0.77,        // files sitting directly in the root (not an arm): violet
  ARM_SATURATION: 0.78,        // colour richness of arms, 0 = grey .. 1 = fully saturated
  ARM_LIGHTNESS: 0.52,         // 0 = black .. 0.5 = pure colour .. 1 = white
  COOL_HUE: 0.62,              // far nodes rotate their hue toward this (blue-indigo)
  COOL_AMOUNT: 0.12,           // how far toward COOL_HUE the farthest nodes go (0 none .. 1 all the way)

  // ---- Node sizes (hyperbolic units, before the Poincare shrink (1 - r^2)/2) -----
  FOLDER_R: 0.04,              // smallest folder core radius
  SIZE_SPREAD: 2.0,            // folder radius x (1 + SIZE_SPREAD * energy): 2 -> biggest = 3x smallest
  FILE_R: 0.02,                // file core radius
  FOCUS_R: 0.11,               // the focus sun's core radius (fixed, bigger than any folder)
  HERO_AT: 0.9,                // folders with random seed >= this are "hero" stars (~10 %)
  HERO_SIZE: 1.25,             // hero stars are this much bigger
  HERO_BRIGHT: 0.9,            // hero stars are this much brighter (+90 %)
  MIN_R: 0.0025,               // no core is ever drawn smaller than this (keeps far nodes visible)
  GLOW_SCALE: 3.0,             // node quad = this many core radii wide (room for the glow)
  CHILD_HALO: 5.0,             // halo quad size behind children of the focus (x core radius)
  FOCUS_HALO: 9.0,             // halo quad size behind the focus (x core radius)
  BREATHE_AMOUNT: 0.06,        // folders swell and shrink by this fraction (0.06 = +-6 %)
  BREATHE_SPEED: 0.8,          // breathing speed (radians per second)

  // ---- Fog: how nodes fade and cool with hyperbolic distance d from the focus -----
  NODE_FOG_RATE: 0.5,          // fog = e^(-d * rate): bigger = nodes fade out sooner
  NODE_FOG_FLOOR: 0.12,        // brightness never falls below this fraction (context stays visible)
  WARM_RATE: 1.5,              // warm tint near the focus fades as e^(-d * rate)
  WARM_AMOUNT: 0.10,           // how much warm tint the nearest nodes get (0..1)

  // ---- Node brightness -----------------------------------------------------------
  FILE_BRIGHT: 0.35,           // base brightness of a file point
  FILE_STAR_AT: 0.93,          // files with random seed >= this are bright stars (~7 %)
  FILE_STAR_BRIGHT: 1.6,       // extra brightness of those bright file stars
  FILE_TWINKLE: 0.45,          // twinkle depth of files: brightness swings by +-this around (1 - this)
  FOLDER_PULSE: 0.15,          // folders pulse by +-this (0.15 = +-15 %)
  FOLDER_BRIGHT_BASE: 0.7,     // folder brightness = BASE + PER_ENERGY * energy
  FOLDER_BRIGHT_PER_ENERGY: 0.6,
  FOCUS_BRIGHT: 1.2,           // brightness of the focus node's own ball
  FILE_PALE: 0.6,              // files are this much blended toward FILE_TINT (pale)
  TONE_GAIN: 1.5,              // soft limiter 1 - e^(-gain * x) used by every shader; bigger = brighter, more clipping

  // ---- Node colours --------------------------------------------------------------
  WARM_TINT: [1.0, 0.85, 0.55],    // warm light near the focus
  FILE_TINT: [0.88, 0.92, 1.0],    // pale colour files lean toward
  FOCUS_COLOR: [1.0, 0.78, 0.38],  // the focus: gold
  FLAG_COLOR: [1.0, 0.2, 0.8],     // status-marker ring (aFlag = 1)

  // ---- Node shading (the fake star / sphere) -----------------------------------------
  BALL_EDGE: 0.9,              // the solid ball's soft edge starts at this fraction of its radius
  LIGHT_DIR: [-0.4, 0.6, 0.7], // direction toward the fake light (normalised in the shader)
  DIFFUSE_GAIN: 0.2,           // how much the lit side of a ball is brighter
  FRESNEL_POWER: 3.0,          // rim glow sharpness: bigger = thinner rim
  RIM_GAIN: 1.1,               // rim glow strength
  SPEC_POWER: 40.0,            // highlight sharpness: bigger = tinier spot
  SPEC_GAIN: 0.35,             // highlight strength
  SPHERE_BASE: 0.40,           // ball brightness at its edge ...
  SPHERE_CENTRE: 0.45,         // ... plus this much more at its centre
  CORE_WHITE_FOLDER: 0.4,      // folder centre blends this far toward white (hot core)
  CORE_WHITE_FOCUS: 0.95,      // the focus centre blends this far toward white
  GLOW_POWER: 2.5,             // folder halo falloff (1 - q)^power: bigger = tighter glow
  GLOW_GAIN: 0.6,              // folder halo strength
  FILE_POINT_POWER: 4.0,       // file point falloff: bigger = smaller point
  FILE_CORE_GAIN: 0.8,         // brightness of a file's tiny core
  HALO_CHILD_STRENGTH: 0.30,   // halo glow strength behind children of the focus
  HALO_FOCUS_STRENGTH: 0.55,   // halo glow strength behind the focus
  FLAG_RING_AT: 0.85,          // radius of the status ring (0..1 across the quad)
  FLAG_RING_WIDTH: 0.06,       // thickness of the status ring

  // ---- Sun (billboard at the focus) ------------------------------------------------
  SUN_SCALE: 14.0,             // sun billboard = this many core radii wide (corona and rays)
  SUN_PULSE: 0.08,             // sun pulses +-this (0.08 = +-8 %)
  SUN_PULSE_SPEED: 1.3,        // pulse speed (radians per second)
  SUN_CORE_W: 0.055,           // white core width (0..1 across the billboard)
  SUN_INNER_W: 0.15,           // gold inner glow width
  SUN_CORONA_POWER: 4.0,       // corona falloff: bigger = tighter
  SUN_CORE_GAIN: 1.2,          // white core strength
  SUN_INNER_GAIN: 0.9,         // gold glow strength
  SUN_CORONA_GAIN: 0.30,       // corona strength
  SUN_RAY_GAIN: 0.9,           // rays strength
  SUN_RAY_SHARP_A: 30.0,       // long (6) rays: bigger = thinner
  SUN_RAY_SHARP_B: 40.0,       // short (4) rays: bigger = thinner
  SUN_RAY_B_GAIN: 0.5,         // strength of the short rays relative to the long ones
  SUN_RAY_SPIN_A: 0.05,        // rotation speed of the long rays (radians per second)
  SUN_RAY_SPIN_B: 0.04,        // rotation speed of the short rays (opposite direction)
  SUN_CORE_COLOR: [1.0, 0.97, 0.9],  // hot white
  SUN_GOLD: [1.0, 0.72, 0.30],       // warm gold inner glow
  SUN_CORONA_COLOR: [1.0, 0.6, 0.25],// amber corona
  SUN_RAY_COLOR: [1.0, 0.85, 0.55],  // pale gold rays

  // ---- Edges -----------------------------------------------------------------------
  EDGE_WIDTH_PX: 1.8,          // base edge width in CSS pixels (JS: scaled by the pixel ratio)
  EDGE_WIDTH_FAR: 0.55,        // width factor far away (x base) ...
  EDGE_WIDTH_NEAR: 0.9,        // ... plus this much more near the focus (so 1.45x there)
  EDGE_WIDTH_ENERGY_BASE: 0.8, // big subtrees get a thicker edge: x (BASE + PER_ENERGY * energy)
  EDGE_WIDTH_PER_ENERGY: 0.5,
  EDGE_FOG_RATE: 0.45,         // edge fog = e^(-d * rate): bigger = edges fade out sooner
  EDGE_BRIGHT_FLOOR: 0.05,     // edges never fade below this brightness
  EDGE_BRIGHT_NEAR: 0.75,      // extra brightness of edges next to the focus
  EDGE_PULSE_SPEED: 0.35,      // light pulses travelling along edges: laps per second (0.35 = one every ~2.9 s)
  EDGE_PULSE_GAP: 2.2,         // lap length in edge lengths: > 1 leaves a rest between pulses (2.2 -> pulse visible ~45 % of the time)
  EDGE_PULSE_TAIL: 9.0,        // comet tail: bigger = shorter tail (tail brightness = e^(-tail * distance behind the head))
  EDGE_PULSE_GAIN: 0.9,        // pulse strength relative to the edge's own brightness (keep below ~1.2 so it stays subtle)
  EDGE_PULSE_WHITE: 0.5,       // how much the pulse is blended toward white (0 = arm colour, 1 = white)

  // ---- Nebula background and starfield ---------------------------------------------
  SPACE_COLOR: [0.004, 0.006, 0.020],   // deep navy-black base of the sky
  NEBULA_VIOLET: [0.34, 0.12, 0.52],    // cloud colours
  NEBULA_TEAL: [0.04, 0.42, 0.48],
  NEBULA_INDIGO: [0.10, 0.14, 0.55],
  NEBULA_VIOLET_RANGE: [0.42, 0.88],    // noise values below the first are clear sky, above the second full colour
  NEBULA_TEAL_RANGE: [0.48, 0.88],
  NEBULA_INDIGO_RANGE: [0.35, 0.80],
  NEBULA_VIOLET_GAIN: 0.40,    // cloud strengths
  NEBULA_TEAL_GAIN: 0.32,
  NEBULA_INDIGO_GAIN: 0.25,
  NEBULA_SCALE_A: 1.6,         // cloud size: bigger = smaller, busier clouds (violet/indigo field)
  NEBULA_SCALE_B: 2.6,         // same for the teal field
  NEBULA_DRIFT_A: 0.004,       // how fast the clouds drift
  NEBULA_DRIFT_B: 0.003,
  STAR_COLOR: [0.85, 0.9, 1.0],// colour of the background stars
  STAR_DENSITY: 0.97,          // a sky cell holds a star if its random number >= this (0.97 -> 3 %)
  STAR_SIZE: 0.10,             // star radius inside its cell
  STAR_SCALE_1: 60.0,          // cells per unit, first star layer (bigger = more, smaller stars)
  STAR_SCALE_2: 130.0,         // second star layer
  STAR_LAYER2_GAIN: 0.7,       // brightness of the second layer
  STAR_TWINKLE: 0.3,           // star twinkle depth

  // ---- Semantic zoom (far folders collapse into one "+N" orb) ------------------------
  COLLAPSE_DIST: 2.4,          // a folder further than this (hyperbolic distance from the focus) collapses into an orb
  COLLAPSE_HYST: 0.3,          // hysteresis: collapses beyond DIST + this, re-expands inside DIST - this (stops flicker)
  COLLAPSED_SIZE: 1.5,         // a collapsed orb is this much bigger than the folder it replaces
  COLLAPSED_BRIGHT: 1.25,      // ... and this much brighter
  COLLAPSED_RING_AT: 0.62,     // radius of the faint ring that marks an orb as "contains more" (0..1 across the quad)
  COLLAPSED_RING_WIDTH: 0.05,  // ring thickness
  COLLAPSED_RING_GAIN: 0.6,    // ring brightness

  // ---- Labels (SDF text drawn in a screen-space pass) ----------------------------------
  LABEL_FONT_PX: 14,           // size of a label next to a child of the focus (CSS pixels)
  LABEL_FOCUS_PX: 20,          // the focus's label
  LABEL_HOVER_PX: 16,          // the label of the node under the pointer
  LABEL_ORB_PX: 13,            // the "+N" label of a collapsed orb
  LABEL_COLOR: [1.0, 1.0, 1.0],            // text fill: white for contrast
  LABEL_ORB_COLOR: [0.80, 0.90, 1.0],      // "+N" text fill: slightly cool
  LABEL_OUTLINE_COLOR: [0.01, 0.015, 0.05],// dark outline that keeps text readable on any glow
  LABEL_OUTLINE_WIDTH: 0.16,   // outline thickness as a fraction of the font size
  LABEL_GAP_PX: 6,             // gap between a node and its label
  LABEL_PAD_PX: 4,             // empty margin kept around every label so neighbours never touch

  // ---- Symbols: a file opens into a galaxy of classes, functions and methods -----------------
  // Shapes: class = sphere + permanent ring, function = sphere, method = diamond, block = rounded square.
  EXT_HUE_JS: 0.12,            // symbols of .js/.jsx/.mjs/.cjs files: amber
  EXT_HUE_TS: 0.56,            // .ts/.tsx files: azure
  EXT_HUE_PY: 0.40,            // .py files: mint
  EXT_HUE_OTHER: 0.77,         // anything else: violet
  CLASS_R: 0.035,              // core radius of a class (hyperbolic units, before the (1 - r^2)/2 shrink)
  FUNCTION_R: 0.026,           // ... of a function
  METHOD_R: 0.020,             // ... of a method
  BLOCK_R: 0.030,              // ... of the top-level-code block
  SYMBOL_SIZE_SPREAD: 1.5,     // symbol radius x (1 + SPREAD * energy); energy = log of its line count: 1.5 -> longest = 2.5x shortest
  BLOCK_ENERGY: 0.3,           // energy (size/brightness) of the top-level-code block
  CLASS_BRIGHT: 1.0,           // brightness factor per kind ...
  FUNCTION_BRIGHT: 0.9,
  METHOD_BRIGHT: 0.75,
  BLOCK_BRIGHT: 0.6,
  SYMBOL_BRIGHT_BASE: 0.7,     // symbol brightness = kind factor x (BASE + PER_ENERGY * energy)
  SYMBOL_BRIGHT_PER_ENERGY: 0.5,
  CLASS_RING_AT: 0.55,         // radius of a class's permanent ring (0..1 across the quad)
  CLASS_RING_WIDTH: 0.045,     // ring thickness
  CLASS_RING_GAIN: 0.55,       // ring brightness
  SYMBOL_COLLAPSE_DIST: 1.0,   // a class/function with children further than this from the focus collapses into a "+N" orb
  BLOOM_SECONDS: 0.45,         // new symbols grow out of their parent over this long (effect speed; comfort rule: under 0.6 s)

  // ---- Links (Phase 4c): imports and calls as bundled glowing arcs ------------------------------
  LINK_IMPORT_COLOR: [0.35, 0.80, 1.0],   // import arcs (file -> file): cyan
  LINK_CALL_COLOR: [1.0, 0.48, 0.62],     // call arcs (symbol -> symbol): coral pink
  LINK_TENSION: 0.8,          // bundling strength (Holten's beta): 0 = straight geodesic, 1 = follow the tree path exactly
  LINK_WIDTH_PX: 2.4,          // base arc width in CSS pixels (JS: scaled by the pixel ratio)
  LINK_WIDTH_FAR: 0.5,         // width factor far from the focus (x base) ...
  LINK_WIDTH_NEAR: 0.8,        // ... plus this much more near the focus
  LINK_WIDTH_LOW_CONF: 0.5,    // width of a confidence-0 arc relative to a sure one (confidence 1)
  LINK_COUNT_WIDTH: 0.15,       // an arc standing for n merged links is wider: x (1 + this * ln n), at most x LINK_COUNT_MAX
  LINK_COUNT_MAX: 1.6,
  LINK_FOG_RATE: 0.25,         // link fog = e^(-d * rate) with d = hyperbolic distance from the focus
  LINK_BRIGHT_FLOOR: 0.12,     // far parts of an arc never fade below this brightness ...
  LINK_BRIGHT_NEAR: 0.7,      // ... plus this much more next to the focus
  LINK_CONF_FLOOR: 0.3,        // brightness of a confidence-0 arc relative to a sure one (guessed calls are faint)
  LINK_SOURCE_DIM: 0.55,        // direction cue: the source end is drawn at this fraction of the target end's brightness
  LINK_PULSE_SPEED: 0.45,      // light pulses running source -> target: laps per second
  LINK_PULSE_GAP: 1.7,         // lap length in arc lengths (> 1 leaves a rest between pulses)
  LINK_PULSE_TAIL: 7.0,        // comet tail: bigger = shorter (brightness e^(-tail * distance behind the head))
  LINK_PULSE_GAIN: 1.3,        // pulse strength relative to the arc's own brightness
  LINK_PULSE_WHITE: 0.55,      // how much the pulse is blended toward white
  LINK_FADE_SECONDS: 0.35,     // new arcs fade in over this long (effect speed; comfort rule: under 0.6 s)
  LINK_HOVER_BRIGHT: 0.7,      // arcs of the hovered node (not the focus) are drawn at this brightness
  LINK_CROWD: 20,              // exposure: with more arcs than this on screen each one is dimmed by sqrt(LINK_CROWD / count), so
                               // a dense bundle does not burn out to white (80 arcs -> x 0.5, 320 arcs -> x 0.25)
  LINK_FOLDER_BRIGHT: 0.6,     // a focused FOLDER's overview arcs (imports between its parts) are drawn at this brightness

  // ---- Code panel (HTML overlay with the source of the focused symbol) --------------------------
  CODE_FONT_PX: 13,            // monospace text size (CSS pixels)
  CODE_PANEL_WIDTH_PX: 480,    // panel width on a wide screen (it docks to the right edge)
  CODE_SHEET_HEIGHT_VH: 40,    // on a narrow screen (phone) the panel is a bottom sheet this tall (% of screen height)
  CODE_BG: [0.045, 0.055, 0.12], // panel background colour (a little lighter than the scene so the edge is obvious)
  CODE_BG_ALPHA: 1.0,          // panel background opacity: 1 = solid, nothing of the galaxy or its labels shows through
  CODE_EDGE: [0.45, 0.55, 1.0],// bright thin line along the panel's edge, separating it from the 3D view
  CODE_TEXT: [0.86, 0.90, 1.0],        // ordinary code
  CODE_LINENO: [0.40, 0.46, 0.66],     // line numbers
  CODE_KEYWORD: [0.78, 0.62, 1.0],     // keywords (function, class, def, return ...)
  CODE_STRING: [0.55, 0.90, 0.70],     // string literals
  CODE_COMMENT: [0.46, 0.53, 0.68],    // comments
  CODE_NUMBER: [1.0, 0.76, 0.46],      // numbers
  CODE_HEADER: [0.72, 0.80, 1.0],      // title bar text

  // ---- Toolbar and intro card (on-screen navigation for first-time users) ------------------------
  TOOLBAR_BTN_PX: 44,          // height / minimum width of toolbar buttons (44 px = comfortable thumb target)
  UI_ACTIVE_BG: [0.10, 0.22, 0.50],   // background of a switched-on chip (Imports, Calls, Dependencies)
  UI_ACTIVE_ALPHA: 0.92,       // ... and its opacity
  INTRO_CARD_WIDTH_PX: 380,    // width of the "How to explore" card

  SYMBOL_FOCUS_SCALE: 0.4,     // when a FILE or SYMBOL is focused its "sun" (core and billboard) is this fraction of a folder sun's size:
                               // at code level you are zoomed in, and a full-size sun would swallow the small shapes around it

  // ---- Git heat (H key / Heat button): files coloured by commit count or recency -----------------------
  HEAT_COLD: [0.20, 0.42, 1.0],    // coldest (few commits / oldest change): blue
  HEAT_MID: [0.95, 0.32, 0.70],    // middle: magenta
  HEAT_HOT: [1.0, 0.66, 0.16],     // hottest (many commits / newest change): orange
  HEAT_TINT: 0.88,                 // how far heat replaces a node's own colour (0 = none, 1 = fully the ramp colour)
  HEAT_BRIGHT: 1.1,                // hottest nodes get this much extra brightness (x (1 + this))
  HEAT_SIZE: 1.0,                  // hottest nodes are this much bigger (1.0 = 2x)
  HEAT_NEUTRAL_DIM: 0.5,           // with heat on, nodes without git data keep their colour but are dimmed to this fraction
  HEAT_LEGEND_WIDTH_PX: 120,       // width of the legend's colour bar

  // ---- Info card -------------------------------------------------------------------------------
  INFO_CARD_WIDTH_PX: 300,         // width of the info card (it shrinks on a narrow screen)

  // ---- Search result: the path from the root to the chosen node lights up for a few seconds ---------
  PATH_COLOR: [1.0, 0.92, 0.55],   // colour of the highlighted path: warm light gold
  PATH_TINT: 0.8,              // how far path nodes/edges lean toward PATH_COLOR (0 = own colour, 1 = fully gold)
  PATH_NODE_SIZE: 0.45,        // path nodes swell by this fraction (0.7 = 1.7x)
  PATH_NODE_BRIGHT: 1.2,       // path nodes get this much extra brightness (x (1 + this))
  PATH_EDGE_BRIGHT: 4.0,       // path edges: extra brightness (edges are faint, so this is large)
  PATH_EDGE_WIDTH: 1.6,        // path edges are this much wider (1.6 = 2.6x)
  PATH_RING_AT: 0.72,          // radius of the ring around path nodes (0..1 across the quad)
  PATH_RING_WIDTH: 0.05,       // ring thickness
  PATH_RING_GAIN: 1.0,         // ring brightness
  PATH_HOLD_SECONDS: 4.0,      // the highlight stays at full strength this long ...
  PATH_FADE_SECONDS: 1.5,      // ... then fades out over this long

  // ---- Search box ---------------------------------------------------------------------------
  SEARCH_ROW_PX: 48,           // height of one result row (48 px = comfortable thumb target)
  SEARCH_WIDTH_PX: 560,        // widest the search box gets (it is full width on a phone)
  SEARCH_ICON_FOLDER: [0.55, 0.80, 1.0],   // result icon colours by kind ...
  SEARCH_ICON_FILE: [0.88, 0.92, 1.0],
  SEARCH_ICON_CLASS: [1.0, 0.76, 0.46],
  SEARCH_ICON_FUNCTION: [0.55, 0.90, 0.70],
  SEARCH_ICON_METHOD: [0.78, 0.62, 1.0],

  // ---- Dynamic sizing: nodes make room for each other and for the zoom -------------------------------
  NODE_FIT_FRACTION: 0.4,      // a node's solid core is at most this fraction of the distance to its nearest sibling (0.5 = touching)
  ZOOM_SIZE_EXPONENT: 0.7,     // zoomed in, cores shrink as (camera distance / default distance)^this, so crowds spread out (0 = off, 1 = no relative growth)
  ZOOM_SIZE_MIN: 0.25,         // ... but never below this fraction of their normal size

  // ---- Minimap (small 2D disk map in a corner) ---------------------------------------------------------
  MINIMAP_SIZE_PX: 150,        // width and height of the map
  MINIMAP_COMPACT_PX: 100,     // ... in the compact layout (phone held sideways)
  MINIMAP_HIT_PX: 22,          // a tap picks the nearest node within this many pixels
  MINIMAP_BG: [0.02, 0.03, 0.08],      // map background
  MINIMAP_BG_ALPHA: 0.82,
  MINIMAP_RIM: [0.45, 0.55, 1.0],      // the circle that is the edge of the ball
  MINIMAP_DOT: [0.55, 0.65, 1.0],      // ordinary nodes
  MINIMAP_SUBTREE: [0.45, 0.95, 0.90], // the focused subtree
  MINIMAP_FOCUS: [1.0, 0.85, 0.45],    // the focus ring and the crosshair

  // ---- Collapsible-tree baseline page (?mode=tree) ---------------------------------------------------
  TREE_ROW_PX: 32,             // height of a row (mouse)
  TREE_ROW_TOUCH_PX: 44,       // ... on touch screens (thumb target)
  TREE_INDENT_PX: 18,          // indent per tree level

  // ---- Compact layout (phone held sideways: very little height) ----------------------------------
  COMPACT_HEIGHT_PX: 520,      // a window at most this tall uses the compact layout: icon-only toolbar down the left side,
                               // smaller title/breadcrumb/code, labels scaled by COMPACT_LABEL_SCALE
  COMPACT_LABEL_SCALE: 0.75,   // 3D label sizes are multiplied by this in the compact layout

  // ---- Breadcrumb (HTML line at the bottom of the screen) -------------------------------
  CRUMB_FONT_PX: 13,           // text size
  CRUMB_COLOR: [0.72, 0.80, 1.0],      // ancestors
  CRUMB_LAST_COLOR: [1.0, 1.0, 1.0],   // the current folder (last segment)
  CRUMB_SEP_COLOR: [0.42, 0.48, 0.70], // the "/" separators
  CRUMB_BG: [0.02, 0.03, 0.08],        // background pill colour
  CRUMB_BG_ALPHA: 0.55,        // background pill opacity

  // ---- Haze (replaces the old shell: fades to nothing at the ball's boundary) --------
  HAZE_R: 1.0,                 // world radius where the haze reaches zero (= the ball's boundary)
  HAZE_STRENGTH: 0.45,         // haze brightness at the centre
  HAZE_POWER: 2.0,             // haze falloff (1 - q)^power: 2 is smooth with no visible edge
  HAZE_INNER: [0.10, 0.14, 0.42],  // indigo in the middle ...
  HAZE_OUTER: [0.26, 0.12, 0.42],  // ... violet further out

  // ---- Background dust (faint specks inside the ball) --------------------------------
  DUST_RADIUS: 0.95,           // dust fills the ball out to this radius (JS)
  DUST_SIZE: 0.006,            // speck core radius (hyperbolic units)
  DUST_BRIGHT: 0.16,           // base brightness
  DUST_STAR_AT: 0.85,          // specks with seed >= this are brighter (~15 %)
  DUST_STAR_BRIGHT: 0.45,      // extra brightness of those
  DUST_TWINKLE: 0.7,           // twinkle depth: brightness swings between (1 - depth) and 1
  DUST_FOG_RATE: 0.3,          // dust fades with distance as e^(-d * rate)
  DUST_FOG_FLOOR: 0.35,        // dust never fades below this fraction
  DUST_DRIFT: 0.03,            // how far each speck wanders from its home (ball units; 0 = still)
  DUST_DRIFT_SPEED: 0.15,      // wander speed (radians per second; each speck differs by up to x1.6)
  DUST_TINT_A: [0.55, 0.75, 1.0],  // pale blue ...
  DUST_TINT_B: [0.85, 0.65, 1.0],  // ... to pale violet
};

// ---------------------------------------------------------------------------
// Turning the table into GLSL
// ---------------------------------------------------------------------------

// GLSL is strict: "3" is an int but we need the float "3.0" (otherwise mix(5, 9, t)
// fails to compile). Arrays become vec2 / vec3.
function glslValue(v) {
  const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
  if (Array.isArray(v)) return `vec${v.length}(${v.map(f).join(', ')})`;
  return f(v);
}

// Turn any { NAME: number | [numbers] } object into three.js `defines`.
export function glslDefines(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = glslValue(v);
  return out;
}

// CSS colour string from an [r, g, b] theme colour (for the HTML parts: breadcrumb).
export function cssRgb(c, alpha = 1) {
  return `rgba(${c.map((x) => Math.round(x * 255)).join(', ')}, ${alpha})`;
}

// Every theme value as a #define. Handed to every material, so any shader can use any name.
export const THEME_DEFINES = glslDefines(THEME);
