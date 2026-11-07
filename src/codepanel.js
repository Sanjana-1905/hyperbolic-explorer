// codepanel.js - the code panel: an HTML overlay showing the source lines of the focused symbol.
//
// Look: dark, monospace, line numbers, light syntax colouring (keywords, strings, comments, numbers).
// Layout: on a wide screen it docks to the right edge; on a narrow screen (a phone) it is a bottom sheet.
// Phone use: the header is a big tap target; tapping it (or "–") folds the sheet down to just its header,
// "×" closes it until the next focus change; the body scrolls with one finger (the 3D canvas is a separate
// element, so scrolling code never rotates the view). On the keyboard: C toggles it.
// Every colour and size is a theme constant (CODE_* in theme.js).
//
// Links (Phase 4c): a row of tabs under the header, "Code · Imports n · Imported by n · Calls n · Called by n" (only the
// non-empty ones). A link tab replaces the code with a list; every entry is a 48 px tap target showing the name, its
// file and the confidence as 1-3 dots, in the link type's colour. Tapping an entry calls `onPick(entry)` (the viewer
// glides there and remembers where it came from). Lists show 30 entries, then a "show more" button.
//
// Syntax colouring is deliberately simple: one regular expression finds comments, strings, numbers and
// keywords in the shown snippet. It starts "cold" at the first shown line, so a snippet that begins inside
// a block comment is coloured wrongly for a moment. That is fine for a reading aid.

import { THEME, cssRgb } from './theme.js';

const MAX_LINES = 400; // longer snippets are cut (a whole big file would make a phone sluggish)
const LIST_PAGE = 30;  // link list entries shown at first (and added by each "show more")

const JS_KEYWORDS = 'abstract async await break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface let namespace new null of private protected public readonly return set static super switch this throw true try type typeof undefined var void while with yield';
const PY_KEYWORDS = 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self';

// One regex per language. Alternatives are tried in order at each position; the named groups tell which matched:
// c = comment, s = string, n = number, k = keyword.
function makeTokenizer(lang) {
  const words = (lang === 'py' ? PY_KEYWORDS : JS_KEYWORDS).split(' ').join('|');
  const comment = lang === 'py' ? '#[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)';
  const string = lang === 'py'
    ? '"""[\\s\\S]*?(?:"""|$)|\'\'\'[\\s\\S]*?(?:\'\'\'|$)|"(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?'
    : '`(?:\\\\[\\s\\S]|[^`\\\\])*`?|"(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?';
  return new RegExp(`(?<c>${comment})|(?<s>${string})|(?<n>\\b\\d[\\d_.]*\\b)|(?<k>\\b(?:${words})\\b)`, 'g');
}
const TOKENIZERS = { js: makeTokenizer('js'), py: makeTokenizer('py') };

const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Turn source text into one HTML string per line, with <span class="cp-.."> around coloured tokens.
// A token that spans several lines (a block comment) is cut at the line breaks so every line stays balanced.
export function highlightLines(text, lang) {
  const re = TOKENIZERS[lang === 'py' ? 'py' : 'js'];
  re.lastIndex = 0;
  const pieces = []; // { text, cls }
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    if (m.index > last) pieces.push({ text: text.slice(last, m.index), cls: '' });
    const g = m.groups;
    pieces.push({ text: m[0], cls: g.c ? 'cp-c' : g.s ? 'cp-s' : g.n ? 'cp-n' : 'cp-k' });
    last = m.index + m[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), cls: '' });

  const lines = [''];
  for (const { text: t, cls } of pieces) {
    t.split('\n').forEach((part, i) => {
      if (i > 0) lines.push('');
      if (part) lines[lines.length - 1] += cls ? `<span class="${cls}">${escapeHtml(part)}</span>` : escapeHtml(part);
    });
  }
  return lines;
}

const NARROW = '(max-width: 700px), (max-aspect-ratio: 1/1)';

// `onInset(rightPx, bottomPx)` is told how much of the screen the panel covers, so the 3D view can slide
// the focus into the visible part (navigation.js).
export function createCodePanel({ onInset } = {}) {
  const css = document.createElement('style');
  css.textContent = `
    #code { position: fixed; z-index: 5; display: none; flex-direction: column; box-sizing: border-box;
      top: 56px; right: 0; bottom: 56px; width: min(${THEME.CODE_PANEL_WIDTH_PX}px, 92vw);
      background: ${cssRgb(THEME.CODE_BG, THEME.CODE_BG_ALPHA)}; color: ${cssRgb(THEME.CODE_TEXT)};
      border-left: 2px solid ${cssRgb(THEME.CODE_EDGE, 0.7)}; border-radius: 10px 0 0 10px;
      box-shadow: -8px 0 24px rgba(0, 0, 0, 0.6);
      font: ${THEME.CODE_FONT_PX}px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    #code.open { display: flex; }
    body.code-open #help { display: none; } /* the help line would show through the sheet */
    #code .cp-head { display: flex; align-items: center; gap: 8px; padding: 0 0 0 12px; min-height: 48px;
      box-sizing: border-box; border-bottom: 1px solid ${cssRgb(THEME.CODE_LINENO, 0.3)}; color: ${cssRgb(THEME.CODE_HEADER)};
      font-family: system-ui, sans-serif; cursor: pointer; user-select: none; }
    #code .cp-title { flex: 1; min-width: 0; }
    #code .cp-name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #code .cp-sub { font-size: 11px; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #code button { width: 48px; height: 48px; flex: none; border: 0; background: transparent; cursor: pointer;
      color: ${cssRgb(THEME.CODE_HEADER)}; font-size: 22px; line-height: 1; }
    #code .cp-body { flex: 1; overflow: auto; overscroll-behavior: contain; touch-action: pan-x pan-y; padding: 6px 0 12px;
      -webkit-overflow-scrolling: touch; }
    #code.folded .cp-body { display: none; }
    #code .cp-row { display: flex; white-space: pre; }
    #code .cp-ln { flex: none; text-align: right; padding: 0 10px 0 8px; color: ${cssRgb(THEME.CODE_LINENO)};
      user-select: none; position: sticky; left: 0; background: ${cssRgb(THEME.CODE_BG)}; }
    #code .cp-c { color: ${cssRgb(THEME.CODE_COMMENT)}; font-style: italic; }
    #code .cp-s { color: ${cssRgb(THEME.CODE_STRING)}; }
    #code .cp-n { color: ${cssRgb(THEME.CODE_NUMBER)}; }
    #code .cp-k { color: ${cssRgb(THEME.CODE_KEYWORD)}; }
    #code .cp-note { padding: 8px 12px; opacity: 0.65; font-family: system-ui, sans-serif; white-space: normal; }
    #code .cp-tabs { display: flex; flex: none; overflow-x: auto; gap: 2px; padding: 0 6px; scrollbar-width: none;
      border-bottom: 1px solid ${cssRgb(THEME.CODE_LINENO, 0.3)}; font-family: system-ui, sans-serif; }
    #code .cp-tabs:empty { display: none; }
    #code .cp-tabs button { width: auto; height: 44px; padding: 0 10px; font-size: 13px; white-space: nowrap;
      color: ${cssRgb(THEME.CODE_LINENO)}; border-bottom: 2px solid transparent; }
    #code .cp-tabs button.on { color: ${cssRgb(THEME.CODE_HEADER)}; border-bottom-color: ${cssRgb(THEME.CODE_EDGE)}; }
    #code .cp-list { flex: 1; overflow: auto; overscroll-behavior: contain; display: none; padding: 4px 0 12px;
      font-family: system-ui, sans-serif; }
    #code.listing .cp-list { display: block; }
    #code.listing .cp-body { display: none; }
    #code.folded .cp-list, #code.folded .cp-tabs { display: none; }
    #code .cp-list button { display: flex; align-items: center; gap: 10px; width: 100%; height: auto; min-height: 48px;
      padding: 4px 12px; text-align: left; font-size: 13px; color: ${cssRgb(THEME.CODE_TEXT)};
      border-left: 3px solid var(--link-color); }
    #code .cp-list button:hover { background: ${cssRgb(THEME.CODE_LINENO, 0.15)}; }
    #code .cp-ent { flex: 1; min-width: 0; }
    #code .cp-ent b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #code .cp-ent i { display: block; font-style: normal; font-size: 11px; opacity: 0.6; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    #code .cp-dots { flex: none; letter-spacing: 1px; color: var(--link-color); font-size: 11px; }
    #code .cp-more { justify-content: center; color: ${cssRgb(THEME.CODE_HEADER)}; }
    /* Narrow screens (phones): a bottom sheet instead of a side panel. */
    @media ${NARROW} {
      #code { top: auto; left: 0; right: 0; bottom: 0; width: auto; height: ${THEME.CODE_SHEET_HEIGHT_VH}vh;
        border-left: 0; border-top: 2px solid ${cssRgb(THEME.CODE_EDGE, 0.7)}; border-radius: 12px 12px 0 0;
        box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.6);
        padding-bottom: env(safe-area-inset-bottom, 0px); }
      #code.folded { height: auto; }
    }`;
  document.head.appendChild(css);

  const el = document.createElement('div');
  el.id = 'code';
  el.innerHTML = `<div class="cp-head"><div class="cp-title"><div class="cp-name"></div><div class="cp-sub"></div></div>
    <button class="cp-fold" aria-label="Fold or unfold the code panel">–</button>
    <button class="cp-close" aria-label="Close the code panel">×</button></div><div class="cp-tabs"></div>
    <div class="cp-body"></div><div class="cp-list"></div>`;
  document.body.appendChild(el);
  const nameEl = el.querySelector('.cp-name');
  const subEl = el.querySelector('.cp-sub');
  const bodyEl = el.querySelector('.cp-body');
  const tabsEl = el.querySelector('.cp-tabs');
  const listEl = el.querySelector('.cp-list');

  let hasContent = false;   // something to show for the current focus
  let closedByUser = false; // the user pressed ×: stay hidden until the focus changes
  let folded = false;
  let groups = [];          // link lists: [{ title, color: [r, g, b], entries: [{ name, sub, dots, ... }] }]
  let onPick = null;
  let active = -1;          // -1 = code, else the index of the open link group

  // Tabs: "Code" plus one per non-empty link group.
  function renderTabs() {
    tabsEl.textContent = '';
    if (!groups.some((g) => g.entries.length)) { active = -1; el.classList.remove('listing'); return; }
    const tab = (label, index) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = index === active ? 'on' : '';
      b.addEventListener('click', () => { active = index; renderTabs(); renderList(); });
      tabsEl.appendChild(b);
    };
    tab('Code', -1);
    groups.forEach((g, i) => { if (g.entries.length) tab(`${g.title} ${g.entries.length}`, i); });
    el.classList.toggle('listing', active >= 0);
  }

  // The open group's entries, LIST_PAGE at a time.
  function renderList(limit = LIST_PAGE) {
    listEl.textContent = '';
    if (active < 0) return;
    const g = groups[active];
    listEl.style.setProperty('--link-color', cssRgb(g.color));
    for (const entry of g.entries.slice(0, limit)) {
      const b = document.createElement('button');
      const ent = document.createElement('span');
      ent.className = 'cp-ent';
      const name = document.createElement('b');
      name.textContent = entry.name + (entry.count > 1 ? `  ×${entry.count}` : '');
      const sub = document.createElement('i');
      sub.textContent = entry.sub;
      ent.append(name, sub);
      const dots = document.createElement('span');
      dots.className = 'cp-dots';
      dots.textContent = '●'.repeat(entry.dots) + '○'.repeat(3 - entry.dots);
      dots.title = `confidence ${Math.round(entry.conf * 100)} %`;
      b.append(ent, dots);
      b.addEventListener('click', () => { if (onPick) onPick(entry); });
      listEl.appendChild(b);
    }
    if (g.entries.length > limit) {
      const more = document.createElement('button');
      more.className = 'cp-more';
      more.textContent = `Show more (${g.entries.length - limit} left)`;
      more.addEventListener('click', () => { const top = listEl.scrollTop; renderList(limit + LIST_PAGE); listEl.scrollTop = top; });
      listEl.appendChild(more);
    }
  }

  function applyVisibility() {
    const open = hasContent && !closedByUser;
    el.classList.toggle('open', open);
    el.classList.toggle('folded', folded);
    document.body.classList.toggle('code-open', open);
    // Tell the page how much of the bottom the sheet covers, so the breadcrumb can sit above it.
    const narrow = window.matchMedia(NARROW).matches;
    const sheet = open && narrow ? (folded ? '48px' : `${THEME.CODE_SHEET_HEIGHT_VH}vh`) : '0px';
    document.documentElement.style.setProperty('--sheet-h', sheet);
    document.documentElement.style.setProperty('--panel-w', open && !narrow ? `${Math.min(THEME.CODE_PANEL_WIDTH_PX, 0.92 * window.innerWidth)}px` : '0px');
    if (onInset) {
      if (!open) onInset(0, 0);
      else if (narrow) onInset(0, folded ? 48 : (THEME.CODE_SHEET_HEIGHT_VH / 100) * window.innerHeight);
      else onInset(Math.min(THEME.CODE_PANEL_WIDTH_PX, 0.92 * window.innerWidth), 0);
    }
  }

  el.querySelector('.cp-head').addEventListener('click', (e) => {
    if (e.target.closest('.cp-close')) closedByUser = true;
    else folded = !folded; // tapping the header (or –) folds/unfolds
    applyVisibility();
  });
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && hasContent) {
      closedByUser = !closedByUser;
      applyVisibility();
    }
  });
  window.addEventListener('resize', applyVisibility);

  return {
    get visible() { return el.classList.contains('open'); },
    get element() { return el; },

    // Show a snippet. `lines` = array of source lines for the whole file (or null if there is no source);
    // `from`..`to` are 1-based and inclusive.
    show({ title, subtitle, lines, from, to, lang }) {
      closedByUser = false;
      hasContent = true;
      nameEl.textContent = title;
      subEl.textContent = subtitle;
      bodyEl.textContent = '';
      if (!lines) {
        const note = document.createElement('div');
        note.className = 'cp-note';
        note.textContent = 'No source available for this dataset (only the structure was scanned).';
        bodyEl.appendChild(note);
      } else {
        const last = Math.min(to, lines.length, from + MAX_LINES - 1);
        const html = highlightLines(lines.slice(from - 1, last).join('\n'), lang);
        const width = String(last).length; // gutter wide enough for the biggest number
        const rows = html.map((h, i) =>
          `<div class="cp-row"><span class="cp-ln" style="min-width:${width}ch">${from + i}</span><span>${h || ' '}</span></div>`);
        if (last < to) rows.push(`<div class="cp-note">… ${to - last} more lines not shown</div>`);
        bodyEl.innerHTML = rows.join('');
      }
      bodyEl.scrollTop = 0;
      applyVisibility();
    },

    // Link lists for the focus (Phase 4c). `list` = [{ title, color, entries }]; `pick(entry)` is called on a tap.
    // Opens on the code tab again (a new focus starts with its code).
    setLinks(list, pick) {
      groups = list || [];
      onPick = pick;
      active = -1;
      renderTabs();
      renderList();
    },
    get linkTabs() { return [...tabsEl.querySelectorAll('button')].map((b) => b.textContent); },
    openTab(index) { active = index; renderTabs(); renderList(); },

    // The focus has nothing to show (a folder): hide.
    hide() {
      hasContent = false;
      applyVisibility();
    },
  };
}
