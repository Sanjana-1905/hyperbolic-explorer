// minimap.js - a small 2D map of the whole tree (a Poincaré disk), in a corner of the screen.
//
// What it shows: the tree laid out in the ball is flattened onto a disk (x, y of every node; depth z only dims the dots
// that are further back), so you see where everything sits and where YOU are:
//   - dim dots           every folder (and every file when the tree is small)
//   - bright dots + lines the focused subtree (for a file or symbol: the folder around it)
//   - a gold line        the path from the root to the focus
//   - a gold cross       the point at the centre of the screen right now (it glides while you fly)
//   - a gold ring        the focus node
// Tapping the map flies to the node nearest to the tap (bigger subtrees are slightly easier to hit).
// The map is a fixed picture (it does not turn with the camera), so people can learn where things are.
// It collapses to a single 44 px button. Colours and sizes: MINIMAP_* in theme.js.
//
// The geometry (flattening and picking) is exported as plain functions so it can be tested without a browser.

import { THEME, cssRgb } from './theme.js';

// Flatten a ball point onto the disk. The ball has radius 1; the disk has radius R pixels around (cx, cy).
// Example: R = 70, centre (75, 75): the ball point (0.5, -0.2, 0.8) lands at x = 75 + 0.5·70 = 110, y = 75 − (−0.2)·70 = 89
// (screen y points down), and its depth 0.8 says it is in front.
export function flatten(p, cx, cy, R) {
  return { x: cx + p.x * R, y: cy - p.y * R, z: p.z };
}

// Which node does a tap at (x, y) mean? The nearest candidate within `hitPx`, where distance is divided by
// (1 + 0.15·ln(weight)): a folder with 1,000 nodes inside counts as 2.0x closer than a lone file.
// Example: tap 12 px from a leaf and 16 px from a folder of 100 nodes: 12 / 1 = 12 vs 16 / (1 + 0.15·4.6) = 9.5: the folder wins.
// `pts` = [{x, y}] per node id, `nodes` = the tree nodes, `visible(node)` says whether the node is drawn on the map.
export function pickNearest(nodes, pts, x, y, hitPx, visible) {
  let best = null, bestScore = Infinity;
  for (const node of nodes) {
    if (!visible(node)) continue;
    const d = Math.hypot(pts[node.id].x - x, pts[node.id].y - y);
    if (d > hitPx) continue;
    const score = d / (1 + 0.15 * Math.log(node.weight));
    if (score < bestScore) { bestScore = score; best = node; }
  }
  return best;
}

const BIG_TREE = 8000;   // above this many nodes only folders (and the focused subtree) are drawn

export function createMinimap({ nodes, onPick }) {
  const css = document.createElement('style');
  css.textContent = `
    #map { position: fixed; z-index: 4; right: calc(12px + var(--sai-r) + var(--panel-w, 0px)); bottom: calc(72px + max(var(--sheet-h, 0px), var(--sai-b)));
      font: 11px system-ui, sans-serif; color: ${cssRgb(THEME.CRUMB_COLOR)}; }
    #map .m-box { border-radius: 12px; overflow: hidden; background: ${cssRgb(THEME.MINIMAP_BG, THEME.MINIMAP_BG_ALPHA)};
      border: 1px solid ${cssRgb(THEME.CRUMB_SEP_COLOR)}; }
    #map .m-head { display: flex; align-items: center; justify-content: space-between; padding-left: 10px; height: 44px; font-weight: 600; }
    #map canvas { display: block; touch-action: none; cursor: pointer; }
    #map button { width: 44px; height: 44px; border: 0; background: transparent; cursor: pointer; color: inherit; font-size: 20px; }
    #map .m-open { display: none; border-radius: 22px; border: 1px solid ${cssRgb(THEME.CRUMB_SEP_COLOR)};
      background: ${cssRgb(THEME.CRUMB_BG, THEME.CRUMB_BG_ALPHA)}; }
    #map.collapsed .m-box { display: none; } #map.collapsed .m-open { display: block; }
    @media (max-width: 520px) { #map { bottom: calc(130px + max(var(--sheet-h, 0px), var(--sai-b))); } }
    @media (max-height: ${THEME.COMPACT_HEIGHT_PX}px) {
      #map { bottom: calc(40px + var(--sai-b)); } #map .m-head { height: 36px; } #map button { width: 40px; height: 36px; } #map .m-open { height: 40px; width: 40px; }
    }`;
  document.head.appendChild(css);

  const el = document.createElement('div');
  el.id = 'map';
  el.innerHTML = `<div class="m-box"><div class="m-head"><span>Map</span><button class="m-close" aria-label="Collapse the map">–</button></div><canvas></canvas></div>
    <button class="m-open" aria-label="Show the map"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/></svg></button>`;
  document.body.appendChild(el);
  const canvas = el.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const rgba = (c, a) => cssRgb(c, a);

  let size = 0, R = 0, cx = 0, cy = 0, dpr = 1;
  let pts = [];                     // flattened position of every node
  let base = null;                  // cached picture of everything that only changes with the focus node
  let focus = null;                 // the focused node (a folder/file of the base tree)
  let focusPoint = null;            // ball point at the centre of the screen (gliding)
  let collapsed = window.innerWidth < 600;   // a phone held upright starts collapsed
  const bigTree = nodes.length > BIG_TREE;

  function layoutSize() {
    const compact = window.innerHeight <= THEME.COMPACT_HEIGHT_PX;
    size = compact ? THEME.MINIMAP_COMPACT_PX : THEME.MINIMAP_SIZE_PX;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = Math.round(size * dpr);
    canvas.style.width = canvas.style.height = `${size}px`;
    R = size / 2 - 4; cx = cy = size / 2;
    pts = nodes.map((n) => flatten(n.pos, cx, cy, R));
    base = null;
  }

  // The subtree to highlight: the focus folder's, or for a file/symbol the folder it lives in.
  const regionOf = (node) => (node.type === 'folder' || !node.parent ? node : node.parent);
  const inRegion = (region, n) => n.id >= region.id && n.id < region.id + region.weight;

  function buildBase() {
    base = document.createElement('canvas');
    base.width = base.height = canvas.width;
    const g = base.getContext('2d');
    g.scale(dpr, dpr);
    // the disk
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fillStyle = rgba(THEME.MINIMAP_BG, 0.5); g.fill();
    g.lineWidth = 1.5; g.strokeStyle = rgba(THEME.MINIMAP_RIM, 0.6); g.stroke();
    const region = focus ? regionOf(focus) : null;
    const drawn = (n) => n.type === 'folder' || !bigTree || (region && inRegion(region, n));
    // dim dots, three depth shades (front = brighter). Dots in the highlighted region are drawn later, brighter.
    for (let shade = 0; shade < 3; shade++) {
      g.fillStyle = rgba(THEME.MINIMAP_DOT, 0.22 + 0.2 * shade);
      for (const n of nodes) {
        if (!drawn(n) || (region && inRegion(region, n))) continue;
        const s = Math.min(2, Math.max(0, Math.floor(((n.pos.z + 1) / 2) * 3)));
        if (s !== shade) continue;
        const w = n.type === 'folder' ? 2 : 1;
        g.fillRect(pts[n.id].x - w / 2, pts[n.id].y - w / 2, w, w);
      }
    }
    if (region) {
      // the highlighted subtree: lines to parents (if not huge), then bright dots
      if (region.weight <= 2500) {
        g.strokeStyle = rgba(THEME.MINIMAP_SUBTREE, 0.3); g.lineWidth = 0.7; g.beginPath();
        for (let i = region.id + 1; i < region.id + region.weight; i++) {
          const n = nodes[i];
          g.moveTo(pts[n.parent.id].x, pts[n.parent.id].y); g.lineTo(pts[n.id].x, pts[n.id].y);
        }
        g.stroke();
      }
      g.fillStyle = rgba(THEME.MINIMAP_SUBTREE, 0.9);
      for (let i = region.id; i < region.id + region.weight; i++) {
        const n = nodes[i]; const w = n.type === 'folder' ? 2.6 : 1.6;
        g.fillRect(pts[n.id].x - w / 2, pts[n.id].y - w / 2, w, w);
      }
    }
    // the path from the root to the focus
    if (focus) {
      g.strokeStyle = rgba(THEME.PATH_COLOR, 0.9); g.lineWidth = 1.6; g.beginPath();
      const chain = [];
      for (let n = focus; n; n = n.parent) chain.push(n);
      chain.reverse().forEach((n, i) => { const p = pts[n.id] || pts[n.file ? n.file.id : 0]; i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
      g.stroke();
    }
  }

  function draw() {
    if (collapsed) return;
    if (!base) buildBase();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = rgba(THEME.MINIMAP_FOCUS, 1);
    if (focus) {                                         // ring on the focus node
      const p = pts[(focus.type === 'symbol' ? focus.file : focus).id];
      ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); ctx.stroke();
    }
    if (focusPoint) {                                    // cross at the centre of the screen
      const p = flatten(focusPoint, cx, cy, R);
      ctx.lineWidth = 1.4; ctx.beginPath();
      ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6); ctx.stroke();
    }
  }

  function setCollapsed(c) {
    collapsed = c;
    el.classList.toggle('collapsed', c);
    if (!c) { layoutSize(); draw(); }
  }

  el.querySelector('.m-close').addEventListener('click', () => setCollapsed(true));
  el.querySelector('.m-open').addEventListener('click', () => setCollapsed(false));
  canvas.addEventListener('pointerup', (e) => {
    const r = canvas.getBoundingClientRect();
    const region = focus ? regionOf(focus) : null;
    const hit = pickNearest(nodes, pts, e.clientX - r.left, e.clientY - r.top, THEME.MINIMAP_HIT_PX,
      (n) => n.type === 'folder' || !bigTree || (region && inRegion(region, n)));
    if (hit) onPick(hit);
  });
  window.addEventListener('resize', () => { layoutSize(); draw(); });

  layoutSize();
  el.classList.toggle('collapsed', collapsed);

  return {
    get collapsed() { return collapsed; },
    toggle() { setCollapsed(!collapsed); },
    // The focused node changed: rebuild the cached picture.
    setFocus(node) { focus = node; base = null; draw(); },
    // The centre of the screen moved (every frame while gliding).
    setFocusPoint(p) { focusPoint = p; draw(); },
    // Node the map would pick for a tap at (x, y) in canvas pixels (tests).
    pickAt(x, y) { return pickNearest(nodes, pts, x, y, THEME.MINIMAP_HIT_PX, () => true); },
    get size() { return size; },
  };
}
