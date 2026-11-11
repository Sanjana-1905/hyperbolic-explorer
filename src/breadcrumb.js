// breadcrumb.js - the path of the focused node at the bottom centre ("disease / disease of anatomical entity / heart disease"), shared by 2D and 3D.
// Every segment except the last is clickable and focuses that ancestor. Navigation groups are display aids, not ontology relationships, so they are
// left out of the path unless one of them IS the focus. A very long path keeps the first segment and the last four, with "…" in between.
// It sits clear of the disease panel (--panel-w) and the bottom sheet (--sheet-h), like the toolbar and the map.
import { THEME, cssRgb } from './theme.js';

export function createBreadcrumb({ onPick }) {
  const crumbs = document.createElement('div');
  crumbs.id = 'crumbs';
  Object.assign(crumbs.style, {
    position: 'fixed', left: 'calc((100vw + var(--sai-l) - var(--sai-r) - var(--panel-w, 0px)) / 2)', bottom: 'calc(34px + max(var(--sheet-h, 0px), var(--sai-b)))', transform: 'translateX(-50%)',
    maxWidth: 'calc(100vw - var(--panel-w, 0px) - 24px - var(--sai-l) - var(--sai-r))', padding: '4px 12px', borderRadius: '14px',
    font: `600 ${THEME.CRUMB_FONT_PX}px system-ui, sans-serif`,
    background: cssRgb(THEME.CRUMB_BG, THEME.CRUMB_BG_ALPHA), color: cssRgb(THEME.CRUMB_COLOR),
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 0 4px #000',
  });
  document.body.appendChild(crumbs);
  return {
    element: crumbs,
    update(focusNode) {
      const chain = [];
      for (let n = focusNode; n; n = n.parent) if (!n.isGroup || n === focusNode) chain.unshift(n);
      const shown = chain.length > 6 ? [chain[0], null, ...chain.slice(-4)] : chain;   // null = "…"
      crumbs.textContent = '';
      shown.forEach((n, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.textContent = ' / ';
          sep.style.color = cssRgb(THEME.CRUMB_SEP_COLOR);
          crumbs.appendChild(sep);
        }
        const span = document.createElement('span');
        span.textContent = n ? n.name : '…';
        if (n === focusNode) span.style.color = cssRgb(THEME.CRUMB_LAST_COLOR);
        if (n && n !== focusNode) { span.style.cursor = 'pointer'; span.addEventListener('click', () => onPick(n)); }
        crumbs.appendChild(span);
      });
    },
  };
}
