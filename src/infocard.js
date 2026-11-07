// infocard.js - two small HTML overlays: the INFO CARD (facts about the focused node) and the HEAT LEGEND.
//
// Info card: top-left under the title. Open by default only on a roomy screen (a phone starts with it closed; the
// toolbar's Info button opens it). It never covers the other panels:
//   - it stops before the code panel (its right edge is `--panel-w` away from the screen edge),
//   - in the compact landscape layout it starts to the right of the toolbar column and scrolls if it is too tall,
//   - the search box (z-index 9) and the intro card (8) are above it.
// Heat legend: top-right (left of the code panel): a colour bar from cold to hot with the numbers behind the ends.
// Colours and sizes come from theme.js.

import { THEME, cssRgb } from './theme.js';

const escapeHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createInfoCard() {
  const css = document.createElement('style');
  css.textContent = `
    #card { position: fixed; z-index: 4; top: 64px; left: 12px; box-sizing: border-box; display: none;
      width: min(${THEME.INFO_CARD_WIDTH_PX}px, calc(100vw - 24px - var(--panel-w, 0px))); max-height: calc(100vh - 150px); overflow: auto;
      padding: 8px 12px 10px; border-radius: 12px; background: ${cssRgb(THEME.CODE_BG, 0.94)}; color: ${cssRgb(THEME.CODE_TEXT)};
      border: 1px solid ${cssRgb(THEME.CODE_EDGE, 0.45)}; font: 13px/1.4 system-ui, sans-serif; }
    #card.open { display: block; }
    #card .c-kind { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: ${cssRgb(THEME.CODE_HEADER)}; margin-bottom: 4px; }
    #card dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; }
    #card dt { color: ${cssRgb(THEME.CODE_LINENO)}; }
    #card dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    #card .c-note { margin-top: 6px; font-size: 11px; color: ${cssRgb(THEME.LINK_CALL_COLOR)}; }
    @media (max-height: ${THEME.COMPACT_HEIGHT_PX}px) {
      #card { top: 44px; left: 104px; max-height: calc(100vh - 54px); width: min(${THEME.INFO_CARD_WIDTH_PX - 40}px, calc(100vw - 116px - var(--panel-w, 0px))); font-size: 12px; }
    }
    #legend { position: fixed; z-index: 4; top: 12px; right: calc(12px + var(--panel-w, 0px)); display: none; box-sizing: border-box;
      padding: 6px 10px 7px; border-radius: 10px; background: ${cssRgb(THEME.CRUMB_BG, THEME.CRUMB_BG_ALPHA)};
      border: 1px solid ${cssRgb(THEME.CRUMB_SEP_COLOR)}; color: ${cssRgb(THEME.CRUMB_COLOR)}; font: 11px/1.3 system-ui, sans-serif; }
    #legend.open { display: block; }
    #legend .l-title { font-weight: 600; margin-bottom: 3px; }
    #legend .l-bar { width: ${THEME.HEAT_LEGEND_WIDTH_PX}px; max-width: 34vw; height: 10px; border-radius: 5px;
      background: linear-gradient(90deg, ${cssRgb(THEME.HEAT_COLD)}, ${cssRgb(THEME.HEAT_MID)}, ${cssRgb(THEME.HEAT_HOT)}); }
    #legend .l-ends { display: flex; justify-content: space-between; margin-top: 2px; gap: 8px; }
    #legend .l-note { margin-top: 3px; opacity: 0.75; }
  `;
  document.head.appendChild(css);

  const card = document.createElement('div');
  card.id = 'card';
  document.body.appendChild(card);
  const legend = document.createElement('div');
  legend.id = 'legend';
  document.body.appendChild(legend);

  const roomy = window.innerWidth >= 900 && window.innerHeight >= 600;
  let open = roomy;
  card.classList.toggle('open', open);

  return {
    get open() { return open; },
    toggle() { open = !open; card.classList.toggle('open', open); return open; },

    // kind: heading ("File · py"); rows: [[label, value], ...]; note: optional warning line (e.g. fake data).
    setCard(kind, rows, note) {
      card.innerHTML = `<div class="c-kind">${escapeHtml(kind)}</div><dl>` +
        rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('') + '</dl>' +
        (note ? `<div class="c-note">${escapeHtml(note)}</div>` : '');
    },

    // title: "Git heat: commits"; low/high: text under the two ends of the bar; note: optional extra line.
    setLegend(title, low, high, note) {
      if (!title) { legend.classList.remove('open'); document.documentElement.style.setProperty('--legend-w', '0px'); return; }
      legend.title = note || '';
      legend.innerHTML = `<div class="l-title">${escapeHtml(title)}</div><div class="l-bar"></div>` +
        `<div class="l-ends"><span>${escapeHtml(low)}</span><span>${escapeHtml(high)}</span></div>`;
      legend.classList.add('open');
      // Tell the title line how much room the legend takes (index.html reserves it), so they never overlap.
      document.documentElement.style.setProperty('--legend-w', `${legend.offsetWidth + 12}px`);
    },
  };
}
