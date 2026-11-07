// searchui.js - the search box: an HTML overlay with a text field and the top 10 results (search.js does the matching).
//
// Opened by the magnifier button on the toolbar or by "/" on a desktop keyboard. Closed with Esc, the x, or by choosing a result.
//
// Phone details:
//   - The box sits at the TOP of the screen and the results hang below it, so the on-screen keyboard (which rises from the
//     bottom) does not cover them. When the keyboard shrinks the visible area, the result list is shortened to fit
//     (window.visualViewport tells us the visible height).
//   - The keyboard's Enter ("search") key picks the first result. Scrolling the result list or touching it hides the
//     keyboard (blurs the field) while the list stays, so a long list can be read in full.
//   - Rows are SEARCH_ROW_PX (48 px) tall: thumb-sized.
//
// Look constants (row height, width, icon colours) are in theme.js.

import { THEME, cssRgb } from './theme.js';
import { KIND } from './search.js';

const ICON_COLORS = [THEME.SEARCH_ICON_FOLDER, THEME.SEARCH_ICON_FILE, THEME.SEARCH_ICON_CLASS,
  THEME.SEARCH_ICON_FUNCTION, THEME.SEARCH_ICON_METHOD];
const KIND_LABEL = ['folder', 'file', 'class', 'function', 'method'];

// Small inline icons that echo the shapes in the 3D view: folder = glowing disc, file = page, class = disc with ring,
// function = small disc, method = diamond.
function icon(kind) {
  const c = cssRgb(ICON_COLORS[kind]);
  const shape = [
    `<circle cx="12" cy="12" r="6" fill="${c}"/><circle cx="12" cy="12" r="10" fill="none" stroke="${c}" stroke-opacity="0.35"/>`,
    `<path d="M7 3h7l4 4v14H7z" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`,
    `<circle cx="12" cy="12" r="5" fill="${c}"/><circle cx="12" cy="12" r="9.5" fill="none" stroke="${c}" stroke-width="1.8"/>`,
    `<circle cx="12" cy="12" r="5.5" fill="${c}"/>`,
    `<path d="M12 4l7 8-7 8-7-8z" fill="${c}"/>`,
  ][kind];
  return `<svg width="22" height="22" viewBox="0 0 24 24" aria-label="${KIND_LABEL[kind]}">${shape}</svg>`;
}

const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Long paths keep their END (the part that tells places apart): "…/auth/io/plugins/models".
function shortPath(path, max = 60) {
  return path.length <= max ? path : `…${path.slice(path.length - max + 1)}`;
}

export function createSearchUI({ index, onSelect }) {
  const row = THEME.SEARCH_ROW_PX;
  const css = document.createElement('style');
  css.textContent = `
    #search { position: fixed; z-index: 9; left: 50%; top: 8px; transform: translateX(-50%); box-sizing: border-box;
      width: min(${THEME.SEARCH_WIDTH_PX}px, calc(100vw - 16px)); display: none; flex-direction: column;
      border-radius: 14px; overflow: hidden; background: ${cssRgb(THEME.CODE_BG)}; color: ${cssRgb(THEME.CODE_TEXT)};
      border: 2px solid ${cssRgb(THEME.CODE_EDGE, 0.7)}; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7);
      font-family: system-ui, sans-serif; }
    #search.open { display: flex; }
    #search .s-top { display: flex; align-items: center; height: ${row}px; flex: none; }
    #search input { flex: 1; min-width: 0; height: 100%; box-sizing: border-box; padding: 0 8px 0 14px; border: 0; outline: 0;
      background: transparent; color: inherit; font: 17px system-ui, sans-serif; }
    #search input::-webkit-search-cancel-button { display: none; }   /* we have our own x */
    #search input::placeholder { color: ${cssRgb(THEME.CODE_LINENO)}; }
    #search .s-x { width: ${row}px; height: ${row}px; flex: none; border: 0; background: transparent; cursor: pointer;
      color: ${cssRgb(THEME.CODE_HEADER)}; font-size: 24px; }
    #search .s-status { flex: none; padding: 2px 14px 4px; font-size: 11px; color: ${cssRgb(THEME.CODE_LINENO)}; }
    #search .s-status:empty { display: none; }
    #search ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; overscroll-behavior: contain;
      border-top: 1px solid ${cssRgb(THEME.CODE_LINENO, 0.3)}; }
    #search ul:empty { display: none; }
    #search li button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: ${row}px; padding: 4px 14px;
      box-sizing: border-box; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    #search li button.active { background: ${cssRgb(THEME.UI_ACTIVE_BG, THEME.UI_ACTIVE_ALPHA)}; }
    #search svg { flex: none; }
    #search .s-text { min-width: 0; flex: 1; }
    #search .s-name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #search .s-path { font-size: 11.5px; color: ${cssRgb(THEME.CODE_LINENO)}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #search .s-empty { padding: 12px 14px; font-size: 13px; color: ${cssRgb(THEME.CODE_LINENO)}; }
    @media (max-height: ${THEME.COMPACT_HEIGHT_PX}px) {
      #search { top: 4px; } #search li button { min-height: 40px; padding: 2px 12px; }
      #search .s-top { height: 42px; } #search .s-x { width: 42px; height: 42px; } #search input { font-size: 16px; }
    }`;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.id = 'search';
  box.setAttribute('role', 'search');
  box.innerHTML = `<div class="s-top"><input type="search" placeholder="Search files, folders, functions…" autocomplete="off"
      autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Search"><button class="s-x" aria-label="Close search">×</button></div>
    <div class="s-status"></div><ul></ul>`;
  document.body.appendChild(box);
  const input = box.querySelector('input');
  const list = box.querySelector('ul');
  const status = box.querySelector('.s-status');

  let results = [];
  let active = 0;
  let progress = 1;           // symbol indexing progress 0..1
  let lastMs = 0;             // how long the last search took (reported in PROGRESS.md / __explorer)

  function setActive(i) {
    active = Math.max(0, Math.min(results.length - 1, i));
    [...list.children].forEach((li, k) => { if (li.firstChild.classList) li.firstChild.classList.toggle('active', k === active); });
    const el = list.children[active];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    list.textContent = '';
    if (!input.value.trim()) { results = []; }
    else {
      const t0 = performance.now();
      results = index.search(input.value, 10);
      lastMs = performance.now() - t0;
    }
    if (!results.length && input.value.trim()) {
      list.innerHTML = `<li class="s-empty">No match${progress < 1 ? ' yet (still reading function names)' : ''}</li>`;
    }
    results.forEach((r, k) => {
      const li = document.createElement('li');
      li.innerHTML = `<button type="button">${icon(r.kind)}<span class="s-text"><div class="s-name">${escapeHtml(r.name)}</div>` +
        `<div class="s-path">${escapeHtml(shortPath(r.path))}</div></span></button>`;
      li.firstChild.addEventListener('click', () => choose(k));
      list.appendChild(li);
    });
    active = 0;
    setActive(0);
    layout();
  }

  function choose(k) {
    const r = results[k];
    if (!r) return;
    close();
    onSelect(r);
  }

  function updateStatus() {
    status.textContent = progress < 1 ? `Reading function names… ${Math.round(progress * 100)} %` : '';
  }

  // Keep the box inside the part of the screen the keyboard has not covered.
  function layout() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    const studyH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--study-h')) || 0;   // leave room for the study bar
    box.style.top = `${(vv ? vv.offsetTop : 0) + (h <= THEME.COMPACT_HEIGHT_PX ? 4 : 8) + studyH}px`;
    const used = (h <= THEME.COMPACT_HEIGHT_PX ? 42 : row) + (status.textContent ? 24 : 0) + 20;
    list.style.maxHeight = `${Math.max(80, h - used)}px`;
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', layout);
    window.visualViewport.addEventListener('scroll', layout);
  }
  window.addEventListener('resize', layout);

  function open() {
    box.classList.add('open');
    updateStatus();
    layout();
    input.focus();
    input.select();
    if (input.value.trim()) render();
  }
  function close() {
    box.classList.remove('open');
    input.blur();
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();   // typing must not trigger the viewer's shortcuts (I, K, D, C, R, F, Backspace ...)
  });
  box.querySelector('.s-x').addEventListener('click', close);
  // Touching or scrolling the list hides the keyboard so the whole list can be read.
  list.addEventListener('touchstart', () => input.blur(), { passive: true });
  list.addEventListener('scroll', () => { if (document.activeElement === input) input.blur(); }, { passive: true });

  window.addEventListener('keydown', (e) => {
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
    if (new URLSearchParams(location.search).get('search') === '0') return;   // &search=0: no search in this condition
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); open(); }
  });

  return {
    open, close,
    get isOpen() { return box.classList.contains('open'); },
    get lastMs() { return lastMs; },
    get resultCount() { return results.length; },
    setQuery(text) { open(); input.value = text; render(); },   // for tests
    choose,
    // Called while the symbol names are read in the background.
    setProgress(p) {
      progress = p;
      updateStatus();
      if (box.classList.contains('open') && input.value.trim()) render();   // new names may have arrived
    },
  };
}
