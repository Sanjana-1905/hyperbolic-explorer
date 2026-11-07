// main.js - entry point. Picks which viewer to load from the URL:
//   ?mode=2d  -> the Phase 1 Poincaré DISK viewer (kept as the user-study baseline)
//   otherwise -> the 3D Poincaré BALL viewer (the default from Phase 2 on)
// `import()` loads only the chosen file, so the other viewer's code never runs.

const mode = new URLSearchParams(location.search).get('mode');

if (mode === '2d') {
  import('./main2d.js');
} else {
  import('./main3d.js');
}
