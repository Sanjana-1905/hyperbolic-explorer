// main.js - entry point. Picks which viewer to load from the URL:
//   ?mode=2d  -> the Phase 1 Poincaré DISK viewer (kept as the user-study baseline)
//   otherwise -> the 3D Poincaré BALL viewer (the default from Phase 2 on)
// `import()` loads only the chosen file, so the other viewer's code never runs.

const params = new URLSearchParams(location.search);
const mode = params.get('mode');

//   ?mode=tree -> a plain collapsible tree (the user-study baseline, Phase 6d)
//   ?study=1   -> study mode on top of whichever viewer is chosen (tasks, timer, event log, export; see study.js)
if (mode === '2d') {
  import('./main2d.js');
} else if (mode === 'tree') {
  import('./maintree.js');
} else {
  import('./main3d.js');
}
if (params.get('study') === '1') import('./study.js');
