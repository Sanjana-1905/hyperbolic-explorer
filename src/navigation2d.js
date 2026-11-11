// navigation2d.js - the camera and the input of the 2D disk viewer. ALL 2D navigation code lives here (the 3D viewer's lives in navigation.js).
//
//   zoom        wheel, pinch (two fingers) and the + / - buttons magnify the disk about the centre of the free part of the screen, 1x .. ZOOM2D_MAX.
//   drag        one finger / the mouse moves the VIEW through the hyperbolic disk (a Möbius translation of the focus point), so the picture follows the
//               pointer near the centre and the periphery slides the way hyperbolic space does. The selected node does not change; Home / Up / a click
//               on a node glide from wherever the view is.
//   tap         a press that did not drag (mouse: moved <= 5 px; touch: < TAP_MAX_MOVE_PX and < TAP_MAX_MS).
//   double-tap  two touch taps close together = "go up" (same as the 3D viewer); reported as { double: true }.
//   hover       the mouse moving over the disk (no button down), for the hover label.
// This module only reports; main2d.js decides what a tap or a double-tap means.
import { mobiusAdd } from './mobius.js';
import { THEME } from './theme.js';

export function createNav2d({ element, getFocusPoint, setFocusPoint, getPixelsPerUnit, onZoom, onMove, onTap, onHover }) {
  let zoom = 1;
  element.style.touchAction = 'none';
  element.style.userSelect = 'none';
  element.style.webkitTapHighlightColor = 'transparent';
  element.addEventListener('contextmenu', (e) => e.preventDefault());

  const clampZoom = (z) => Math.min(THEME.ZOOM2D_MAX, Math.max(1, z));
  function setZoom(z) { const c = clampZoom(z); if (c !== zoom) { zoom = c; onZoom(zoom); } return zoom; }

  const active = new Map();                 // pointerId -> { x, y, sx, sy, t } (current position, press position, press time)
  let maxPointers = 0, moved = false, pinchDist = 0, lastTap = null;

  element.addEventListener('pointerdown', (e) => {
    if (active.size === 0) { maxPointers = 0; moved = false; }
    active.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: e.timeStamp });
    maxPointers = Math.max(maxPointers, active.size);
    if (active.size === 2) { const [a, b] = [...active.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
    try { element.setPointerCapture(e.pointerId); } catch { /* not capturable (synthetic event): fine */ }
  });

  element.addEventListener('pointermove', (e) => {
    const p = active.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse' && onHover) onHover(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (active.size === 1) {
      if (!moved && Math.hypot(p.x - p.sx, p.y - p.sy) > (e.pointerType === 'mouse' ? 5 : THEME.TAP_MAX_MOVE_PX)) moved = true;
      if (moved) {
        // content follows the pointer: view point f -> f (+) (-dx, +dy) in disk units (screen y points down, disk y up)
        const ppu = getPixelsPerUnit();
        setFocusPoint(mobiusAdd(getFocusPoint(), { x: -dx / ppu, y: dy / ppu }));
        onMove();
      }
    } else if (active.size === 2) {
      moved = true;
      const [a, b] = [...active.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && d > 0) setZoom(zoom * (d / pinchDist));
      pinchDist = d;
    }
  });

  const end = (e, cancelled) => {
    const p = active.get(e.pointerId);
    active.delete(e.pointerId);
    if (!p || cancelled || maxPointers !== 1 || moved) return;
    const touch = e.pointerType !== 'mouse';
    const now = e.timeStamp;
    if (touch && now - p.t > THEME.TAP_MAX_MS) return;                       // a long press is not a tap
    let double = false;
    if (touch) {
      double = !!lastTap && now - lastTap.t <= THEME.DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= THEME.DOUBLE_TAP_PX;
      lastTap = double ? null : { x: e.clientX, y: e.clientY, t: now };
    }
    onTap({ x: e.clientX, y: e.clientY, pointerType: e.pointerType, double });
  };
  element.addEventListener('pointerup', (e) => end(e, false));
  element.addEventListener('pointercancel', (e) => end(e, true));
  element.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && onHover) onHover(-1, -1); });

  element.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * THEME.ZOOM2D_WHEEL)); }, { passive: false });

  return {
    get zoom() { return zoom; },
    setZoom,
    zoomIn() { return setZoom(zoom * THEME.ZOOM2D_STEP); },
    zoomOut() { return setZoom(zoom / THEME.ZOOM2D_STEP); },
    get canZoomIn() { return zoom < THEME.ZOOM2D_MAX - 1e-9; },
    get canZoomOut() { return zoom > 1 + 1e-9; },
  };
}
