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
    #tools { position: fixed; left: 12px; bottom: calc(76px + var(--sheet-h, 0px)); z-index: 6; display: flex; flex-wrap: wrap;
      gap: 6px; max-width: calc(100vw - var(--panel-w, 0px) - 24px); font-family: system-ui, sans-serif; }
    #tools button { height: ${px}px; min-width: ${px}px; padding: 0 14px; border-radius: ${px / 2}px; cursor: pointer;
      font: 600 ${THEME.CRUMB_FONT_PX}px system-ui, sans-serif; color: ${cssRgb(THEME.CRUMB_COLOR)};
      background: ${cssRgb(THEME.CRUMB_BG, THEME.CRUMB_BG_ALPHA)}; border: 1px solid ${cssRgb(THEME.CRUMB_SEP_COLOR)};
      display: inline-flex; align-items: center; gap: 7px; }
    #tools button.on { background: ${cssRgb(THEME.UI_ACTIVE_BG, THEME.UI_ACTIVE_ALPHA)}; color: ${cssRgb(THEME.CRUMB_LAST_COLOR)};
      border-color: ${cssRgb(THEME.CRUMB_COLOR)}; }
    #tools button:disabled { opacity: 0.35; cursor: default; }
    /* Compact layout (phone held sideways): a slim column of icon-only buttons down the left side. */
    @media (max-height: ${THEME.COMPACT_HEIGHT_PX}px) {
      #tools { left: 6px; top: 58px; bottom: auto; flex-direction: column; flex-wrap: nowrap; gap: 5px; }
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
  const home = make(`⌂${lbl(' Home')}`, 'Go to the top of the tree', actions.onHome);
  const up = make(`↑${lbl(' Up')}`, 'Go to the parent folder (Shift+Backspace)', actions.onUp);
  const back = make('‹', 'Return to where you were before following a link (Backspace)', actions.onBack);
  const imports = make(`${dot(THEME.LINK_IMPORT_COLOR)}${lbl('Imports')}`, 'Show or hide import arcs (I)', actions.onImports);
  const calls = make(`${dot(THEME.LINK_CALL_COLOR)}${lbl('Calls')}`, 'Show or hide call arcs (K)', actions.onCalls);
  const deps = make(`${dot(THEME.LINK_IMPORT_COLOR)}${lbl('Dependencies')}`, 'Show which parts of this folder import each other (D)', actions.onFolderDeps);
  const helpBtn = make('?', 'How to explore', () => showIntro());
  document.body.appendChild(bar);

  // Intro card -----------------------------------------------------------------------------------
  const card = document.createElement('div');
  card.id = 'intro';
  card.hidden = true;
  card.innerHTML = `
    <h2>How to explore</h2>
    <ol>
      <li>This is a whole code repository as <b>one picture</b>. Folders are glowing stars, files are small dots. The big bright one in the middle is <b>where you are</b>.</li>
      <li><b>Click any node to fly into it.</b> Click a file to open its classes and functions and read the code. <b>+N</b> is a group of N hidden items: click it to open.</li>
      <li><b>↑ Up</b> goes to the parent folder, <b>⌂ Home</b> to the top. Drag to look around, scroll or pinch to move closer.</li>
      <li>Arcs between nodes are connections: ${dot(THEME.LINK_IMPORT_COLOR)}<b>imports</b> (this file uses that file) and ${dot(THEME.LINK_CALL_COLOR)}<b>calls</b> (this function uses that one). Click an arc to follow it; <b>‹ Back</b> returns.</li>
    </ol>
    <button type="button">Start exploring</button>`;
  card.querySelector('button').addEventListener('click', () => { card.hidden = true; remember(); });
  document.body.appendChild(card);
  function showIntro() { card.hidden = false; }
  const mode = new URLSearchParams(location.search).get('intro');
  if (mode === '1' || (mode !== '0' && !remembered())) showIntro();

  const setOn = (btn, on) => { btn.classList.toggle('on', on); btn.classList.toggle('off', !on); btn.setAttribute('aria-pressed', String(on)); };

  return {
    // state: { backDepth, isRoot, focusKind: 'folder'|'file'|'symbol', showImports, showCalls, showFolderDeps }
    update(s) {
      up.disabled = s.isRoot;
      home.disabled = s.isRoot;
      back.style.display = s.backDepth > 0 ? '' : 'none';
      back.innerHTML = `‹${lbl(' Back')} (${s.backDepth})`;
      const folder = s.focusKind === 'folder';
      deps.style.display = folder ? '' : 'none';
      imports.style.display = calls.style.display = folder ? 'none' : '';
      setOn(imports, s.showImports); setOn(calls, s.showCalls); setOn(deps, s.showFolderDeps);
    },
    showIntro,
    get introVisible() { return !card.hidden; },
  };
}
