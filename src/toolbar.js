// toolbar.js - on-screen navigation for first-time users (and for phones, which have no keyboard).
//
// Two things, both plain HTML on top of the canvas:
//   1. A toolbar: [⌂ Home] [↑ Up] [‹ Back (n)] and link chips. Everything the keys do (Backspace, I, K) is
//      reachable by tapping, with 44 px targets. The chips double as the legend of the arc colours:
//      the coloured dot is the colour of that kind of arc. Chips shown depend on what is focused:
//        folder           -> [Dependencies] (off by default: a whole folder's imports are a hairball)
//        file / symbol    -> [Imports] [Calls]
//   2. A "How to explore" card, shown on the first visit (remembered in localStorage) and by the [?] button.
//      ?intro=0 never shows it (used by the screenshot tests), ?intro=1 always shows it.
//
// This module only builds buttons and reports clicks; what they do lives in main3d.js.

import { THEME, cssRgb } from './theme.js';

const STORAGE_KEY = 'hyperbolic-explorer-intro-seen';

function remembered() { try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; } }
function remember() { try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* private mode: just show it again next time */ } }

export function createToolbar(actions) {
  const px = THEME.TOOLBAR_BTN_PX;
  const css = document.createElement('style');
  css.textContent = `
    #tools { position: fixed; left: calc(12px + var(--sai-l)); bottom: calc(76px + max(var(--sheet-h, 0px), var(--sai-b))); z-index: 6; display: flex; flex-wrap: nowrap;
      gap: 6px; max-width: calc(100vw - var(--panel-w, 0px) - 24px - var(--sai-l) - var(--sai-r)); font-family: system-ui, sans-serif; }
    #tools button { height: ${px}px; min-width: ${px}px; padding: 0 14px; border-radius: ${px / 2}px; cursor: pointer;
      font: 600 ${THEME.CRUMB_FONT_PX}px system-ui, sans-serif; color: ${cssRgb(THEME.CRUMB_COLOR)};
      background: ${cssRgb(THEME.CRUMB_BG, THEME.CRUMB_BG_ALPHA)}; border: 1px solid ${cssRgb(THEME.CRUMB_SEP_COLOR)};
      display: inline-flex; align-items: center; gap: 7px; }
    #tools button.on { background: ${cssRgb(THEME.UI_ACTIVE_BG, THEME.UI_ACTIVE_ALPHA)}; color: ${cssRgb(THEME.CRUMB_LAST_COLOR)};
      border-color: ${cssRgb(THEME.CRUMB_COLOR)}; }
    #tools button:disabled { opacity: 0.35; cursor: default; }
    #tools button { flex: none; }
    /* Not enough room for words (a panel is open, or a narrow window): icons only, so the toolbar stays ONE row. Set by fit(). */
    #tools.icons { gap: 4px; }
    #tools.icons button { padding: 0 10px; justify-content: center; }
    #tools.icons .lbl { display: none; }
    /* Back is always in the row (last), just invisible when there is nothing to go back to: showing it must never change the row. */
    #tools button.hidden { visibility: hidden; pointer-events: none; }
    /* Narrow screens (a phone held upright): icon-only buttons, so all of them fit in one row. */
    @media (max-width: 520px) {
      /* Ten icon buttons are wider than a phone held upright: the ONE row scrolls sideways (never wraps), and Back comes FIRST
         (and takes no room at all while there is nothing to go back to) so it is always in reach. */
      #tools { gap: 4px; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; }
      #tools::-webkit-scrollbar { display: none; }
      #tools button.back { order: -1; }
      #tools button.back.hidden { display: none; }
      #tools button { padding: 0 10px; justify-content: center; }
      #tools .lbl { display: none; }
    }
    /* Compact layout (phone held sideways): a slim column of icon-only buttons down the left side. */
    @media (max-height: ${THEME.COMPACT_HEIGHT_PX}px) {
      #tools { left: calc(6px + var(--sai-l)); top: calc(58px + max(var(--study-h, 0px), var(--sai-t))); bottom: auto; flex-direction: column; flex-wrap: wrap; align-content: flex-start; gap: 5px;
        max-height: calc(100vh - 66px - max(var(--study-h, 0px), var(--sai-t))); }
      #tools button { height: 40px; min-width: 40px; padding: 0 10px; justify-content: center; font-size: 16px; }
      #tools .lbl { display: none; }
      #tools .dot { width: 14px; height: 14px; }
      #intro { font-size: 12.5px; padding: 12px 14px 10px; } #intro h2 { font-size: 15px; margin-bottom: 4px; }
      #intro li { margin-bottom: 4px; } #intro button { height: 38px; }
    }
    #tools .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    #tools .off .dot { opacity: 0.35; }
    #intro { position: fixed; z-index: 8; left: 50%; top: 50%; transform: translate(-50%, -50%); box-sizing: border-box;
      width: min(${THEME.INTRO_CARD_WIDTH_PX}px, 92vw); max-height: 86vh; overflow: auto; padding: 18px 18px 14px;
      border-radius: 14px; background: ${cssRgb(THEME.CODE_BG)}; color: ${cssRgb(THEME.CODE_TEXT)};
      border: 2px solid ${cssRgb(THEME.CODE_EDGE, 0.7)}; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7);
      font: 14px/1.45 system-ui, sans-serif; }
    #intro h2 { margin: 0 0 8px; font-size: 18px; color: ${cssRgb(THEME.CRUMB_LAST_COLOR)}; }
    #intro ol { margin: 0 0 10px; padding-left: 20px; } #intro li { margin: 0 0 7px; }
    #intro b { color: ${cssRgb(THEME.CRUMB_LAST_COLOR)}; }
    #intro .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; }
    #intro button { width: 100%; height: ${px}px; border-radius: ${px / 2}px; cursor: pointer; font: 600 15px system-ui, sans-serif;
      color: ${cssRgb(THEME.CRUMB_LAST_COLOR)}; background: ${cssRgb(THEME.UI_ACTIVE_BG, 1)}; border: 1px solid ${cssRgb(THEME.CRUMB_COLOR)}; }
  `;
  document.head.appendChild(css);

  const bar = document.createElement('div');
  bar.id = 'tools';
  const make = (label, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.innerHTML = label;
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };
  const lbl = (t) => `<span class="lbl">${t}</span>`;
  const dot = (color) => `<span class="dot" style="background:${cssRgb(color)}"></span>`;
  const magnifier = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="10" cy="10" r="6.5"/><path d="M15 15l6 6"/></svg>';
  // &search=0 (study conditions without search) leaves the search button out.
  if (new URLSearchParams(location.search).get('search') !== '0') make(`${magnifier}${lbl('Search')}`, 'Search files, folders and functions (/)', actions.onSearch);
  const home = make(`⌂${lbl(' Home')}`, 'Go to the top of the tree', actions.onHome);
  const up = make(`↑${lbl(' Up')}`, 'Go to the parent folder (Shift+Backspace)', actions.onUp);
  const back = make('‹', 'Return to where you were before following a link (Backspace)', actions.onBack);
  const imports = make(`${dot(THEME.LINK_IMPORT_COLOR)}${lbl('Imports')}`, 'Show or hide import arcs (I)', actions.onImports);
  const calls = make(`${dot(THEME.LINK_CALL_COLOR)}${lbl('Calls')}`, 'Show or hide call arcs (K)', actions.onCalls);
  const deps = make(`${dot(THEME.LINK_IMPORT_COLOR)}${lbl('Dependencies')}`, 'Show which parts of this folder import each other (D)', actions.onFolderDeps);
  const infoBtn = make(`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>${lbl('Info')}`, 'Show or hide the info card', actions.onInfo);
  const heatBtn = make('', 'Git heat: colour files by commits or by recency (H)', actions.onHeat);
  const helpBtn = make('?', 'How to explore', () => showIntro());
  // Fullscreen (hides the browser's address bar and buttons) where the browser allows it (Android Chrome, desktop; not iPhone Safari).
  // The icon shows "expand" or "shrink" and follows the real state (the user can also leave with the system back gesture).
  if (document.fullscreenEnabled && actions.onFullscreen) {
    const expand = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    const shrink = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
    const fsBtn = make(expand, 'Fullscreen', actions.onFullscreen);
    fsBtn.id = 'fsbtn';
    const sync = () => { const on = !!document.fullscreenElement; fsBtn.innerHTML = on ? shrink : expand; fsBtn.title = on ? 'Leave fullscreen' : 'Fullscreen'; fsBtn.setAttribute('aria-label', fsBtn.title); setOn(fsBtn, on); };
    document.addEventListener('fullscreenchange', sync);
    queueMicrotask(sync);
  }
  back.classList.add('back');
  bar.appendChild(back);   // Back is the LAST button: its (invisible) slot at the end never moves the others
  document.body.appendChild(bar);
  // Keep the toolbar to ONE row: if the buttons do not fit in the width available (the screen minus an open side panel),
  // drop the words and keep the icons. Called whenever something that changes the width may have changed.
  function fit() {
    bar.classList.remove('icons');
    if (bar.scrollWidth > bar.clientWidth + 1) bar.classList.add('icons');
  }
  window.addEventListener('resize', fit);
  // The code panel sets --panel-w on <html> when it opens or closes; that changes the bar's max-width, so re-fit.
  new MutationObserver(fit).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  const setOn = (btn, on) => { btn.classList.toggle('on', on); btn.classList.toggle('off', !on); btn.setAttribute('aria-pressed', String(on)); };

  // Intro card -----------------------------------------------------------------------------------
  const card = document.createElement('div');
  card.id = 'intro';
  card.hidden = true;
  card.innerHTML = `
    <h2>How to explore</h2>
    <ol>
      <li>This is a whole <span class="i-about">code repository</span> as <b>one picture</b>. <span class="i-folders">Folders</span> are glowing stars, <span class="i-files">files</span> are small dots. The big bright one in the middle is <b>where you are</b>. The little <b>Map</b> in the corner shows where that is in the whole; tap it to jump.</li>
      <li><b>Click any node to fly into it.</b> Click a file to open its classes and functions and read the code. <b>+N</b> is a group of N hidden items: click it to open.</li>
      <li><b>↑ Up</b> goes to the parent folder, <b>⌂ Home</b> to the top. Drag to look around, scroll or pinch to move closer.</li>
      <li class="i-arcs">Arcs between nodes are connections: ${dot(THEME.LINK_IMPORT_COLOR)}<b>imports</b> (this file uses that file) and ${dot(THEME.LINK_CALL_COLOR)}<b>calls</b> (this function uses that one). Click an arc to follow it; <b>‹ Back</b> returns.</li>
    </ol>
    <button type="button">Start exploring</button>`;
  card.querySelector('button').addEventListener('click', () => { card.hidden = true; remember(); });
  document.body.appendChild(card);
  function showIntro() { card.hidden = false; }
  const mode = new URLSearchParams(location.search).get('intro');
  // In study mode the intro card stays away: the study gives its own briefing.
  const studying = new URLSearchParams(location.search).get('study') === '1';
  if (mode === '1' || (mode !== '0' && !studying && !remembered())) showIntro();

  return {
    // state: { backDepth, isRoot, focusKind: 'folder'|'file'|'symbol', showImports, showCalls, showFolderDeps }
    update(s) {
      setOn(infoBtn, s.infoOpen);
      const names = ['Heat', 'Heat: commits', 'Heat: recency'];
      heatBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z"/></svg>${lbl(' ' + names[s.heatMode])}`;
      setOn(heatBtn, s.heatMode > 0);
      up.disabled = s.isRoot;
      home.disabled = s.isRoot;
      back.classList.toggle('hidden', s.backDepth === 0);
      back.innerHTML = `‹${lbl(` Back (${s.backDepth})`)}`;
      const folder = s.focusKind === 'folder';
      // Link chips only make sense for a code dataset (one that has symbols); heat only if the data has git history.
      deps.style.display = folder && s.hasCode ? '' : 'none';
      imports.style.display = calls.style.display = folder || !s.hasCode ? 'none' : '';
      heatBtn.style.display = s.hasGit ? '' : 'none';
      setOn(imports, s.showImports); setOn(calls, s.showCalls); setOn(deps, s.showFolderDeps);
      fit();
    },
    // Wording of the intro card for the dataset (a code repository by default, or e.g. WordNet).
    setDataset({ about, words, hasCode }) {
      if (about) card.querySelector('.i-about').textContent = about;
      if (words) {
        card.querySelector('.i-folders').textContent = `${words.folder}s`;
        card.querySelector('.i-files').textContent = `${words.file.toLowerCase()}s`;
      }
      card.querySelector('.i-arcs').style.display = hasCode ? '' : 'none';
    },
    showIntro,
    get introVisible() { return !card.hidden; },
  };
}
