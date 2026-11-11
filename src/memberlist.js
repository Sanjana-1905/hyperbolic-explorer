// memberlist.js - the MEMBER LIST of a list-only node (displaytree.js): a small searchable list of the diseases that are too close together
// to draw one by one. Every member stays individually selectable: clicking one focuses it (hyperbolic focus), exactly like clicking it on the
// canvas would. Plain HTML on top of the canvas, shared by the 2D and the 3D viewer.
//
// This module only builds the list and reports clicks; what a click does lives in the viewer (onPick).
import { THEME, cssRgb } from './theme.js';
import { realMembers } from './displaytree.js';
import { listFor } from './disclosure.js';

// host (optional): an element to put the list INTO (the disease panel does this: the list then sits inside the panel and covers nothing);
// without it the list is a floating card at the top right.
export function createMemberList({ onPick, host = null }) {
  const css = document.createElement('style');
  css.textContent = `
    #members { position: fixed; z-index: 7; right: calc(12px + var(--sai-r, 0px)); top: calc(64px + var(--sai-t, 0px)); box-sizing: border-box;
      width: min(${THEME.MEMBERLIST_WIDTH_PX}px, 92vw); max-height: ${THEME.MEMBERLIST_MAX_HEIGHT_VH}vh; display: none; flex-direction: column;
      padding: 10px 10px 8px; border-radius: 12px; background: ${cssRgb(THEME.CODE_BG)}; color: ${cssRgb(THEME.CODE_TEXT)};
      border: 1px solid ${cssRgb(THEME.CODE_EDGE, 0.7)}; font: 13px/1.35 system-ui, sans-serif; }
    #members.open { display: flex; }
    #members.inline { position: static; width: auto; max-height: none; padding: 0; border: 0; border-radius: 0; background: transparent; }
    #members.inline h3, #members.inline p { display: none; }
    #members.inline ul { max-height: 240px; }
    #members h3 { margin: 0 0 4px; font-size: 14px; color: ${cssRgb(THEME.CRUMB_LAST_COLOR)}; }
    #members p { margin: 0 0 6px; opacity: 0.8; font-size: 12px; }
    #members input { width: 100%; box-sizing: border-box; height: 34px; margin-bottom: 6px; padding: 0 10px; border-radius: 8px; font: 14px system-ui, sans-serif;
      color: inherit; background: ${cssRgb(THEME.CRUMB_BG)}; border: 1px solid ${cssRgb(THEME.CRUMB_SEP_COLOR)}; }
    #members ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
    #members li button { display: block; width: 100%; text-align: left; padding: 7px 8px; border: 0; border-radius: 6px; cursor: pointer; font: inherit;
      color: inherit; background: transparent; }
    #members li button:hover { background: ${cssRgb(THEME.UI_ACTIVE_BG)}; }
    #members li button.current { background: ${cssRgb(THEME.UI_ACTIVE_BG)}; color: ${cssRgb(THEME.CRUMB_LAST_COLOR)}; }
  `;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.id = 'members';
  box.innerHTML = '<h3></h3><p></p><input type="search" placeholder="Filter this list" aria-label="Filter members"><ul></ul>';
  if (host) { box.classList.add('inline'); host.appendChild(box); } else document.body.appendChild(box);
  const title = box.querySelector('h3'), note = box.querySelector('p'), input = box.querySelector('input'), list = box.querySelector('ul');

  let owner = null, members = [], current = null;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = '';
    for (const m of members) {
      if (q && !m.name.toLowerCase().includes(q)) continue;
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.textContent = m.name; b.dataset.id = String(m.id);
      if (m === current) b.classList.add('current');
      b.addEventListener('click', () => onPick(m));
      li.appendChild(b); list.appendChild(li);
    }
  };
  input.addEventListener('input', render);

  return {
    // Call whenever the focus changes: shows the list for a list-only node (or one of its members), hides it otherwise.
    update(focus) {
      const node = focus ? listFor(focus) : null;
      current = focus;
      if (!node) { owner = null; box.classList.remove('open'); return; }
      if (node !== owner) {
        owner = node;
        members = realMembers(node).sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
        title.textContent = `${node.name}: ${members.length} diseases`;
        note.textContent = 'Too close together to draw one by one. Pick one to focus it.';
        input.value = '';
      }
      box.classList.add('open');
      render();
    },
    get visible() { return box.classList.contains('open'); },
    get count() { return list.children.length; },
    get ownerName() { return owner ? owner.name : null; },
    element: box,
  };
}
