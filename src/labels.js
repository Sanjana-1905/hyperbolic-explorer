// labels.js - SDF text labels, drawn in a flat screen-space pass on top of the 3D scene.
//
// WHY A SEPARATE FLAT PASS
// A label should stay the same readable size on screen and always face the viewer.
// If we draw labels in their own orthographic scene whose units ARE screen pixels, both
// come for free: we project each node to a pixel position in main3d.js, hand it to us, and
// we place text at that pixel. No billboarding maths, no size-by-distance maths.
//
// TEXT RENDERING
// troika-three-text turns each string into quads textured with a signed-distance-field (SDF)
// glyph atlas: crisp at any size, outline for free. `BatchedText` packs ALL labels into ONE
// draw call (25 separate text meshes would be 25 draw calls). The font is a local file
// (public/fonts/Inter-SemiBold.woff, OFL licence) so labels work offline.
//
// NEVER OVERLAPPING (priority sort + push-apart)
// main3d.js gives us candidates with a priority. We go from highest to lowest priority and
// for each one try a list of spots around its node (right, left, above, below, diagonals,
// then right pushed up/down by whole label heights). The first spot that does not touch an
// already placed label and stays on screen wins; if none is free the label is dropped.
// So important labels (the focus, the pointer) are never displaced by less important ones.
// At most MAX_LABELS are placed.

import * as THREE from 'three';
import { Text, BatchedText } from 'troika-three-text';
import { THEME } from './theme.js';

const MAX_LABELS = 25;        // hard cap on visible labels (CLAUDE.md: about 25)
const TRIAL_LIMIT = 40;       // only the best this-many candidates are even tried each frame (more would churn text objects)
const POOL_LIMIT = 64;        // Text objects kept around (re-typesetting text is slow, so we reuse them)
const WARMUP_FRAMES = 150;    // right after load the batch is repacked many times while the first texts are typeset, and
                              // for a moment strings can be drawn over each other; labels stay hidden until it has settled
const KEEP_FRAMES = 90;       // an unused label's text object is kept this many frames before it can be recycled

export function createLabels(renderer) {
  // Flat scene: 1 unit = 1 CSS pixel, origin bottom-left, y up.
  const hudScene = new THREE.Scene();
  const hudCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  let width = 1, height = 1;

  const batch = new BatchedText();
  batch.material = new THREE.MeshBasicMaterial({
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  batch.frustumCulled = false;
  hudScene.add(batch);

  const fontUrl = `${import.meta.env.BASE_URL}fonts/Inter-SemiBold.woff`;
  const slots = new Map();   // node key -> { text, lastIdx, lastUsed }
  let frameNo = 0;
  let stableFrames = 0;      // consecutive frames in which every tried label was already typeset
  let placedCount = 0;
  let lastPlaced = [];

  const rgb = (c) => new THREE.Color(c[0], c[1], c[2]);

  function getSlot(key, string, px, colorArr) {
    let slot = slots.get(key);
    if (!slot) {
      if (slots.size >= POOL_LIMIT) recycleOldest();
      const text = new Text();
      text.font = fontUrl;
      text.anchorX = 'left';
      text.anchorY = 'middle';
      text.outlineWidth = `${THEME.LABEL_OUTLINE_WIDTH * 100}%`;
      text.outlineColor = rgb(THEME.LABEL_OUTLINE_COLOR);
      text.frustumCulled = false;
      text.scale.setScalar(0);              // invisible until placed
      batch.addText(text);
      slot = { text, lastIdx: 0, lastUsed: frameNo };
      slots.set(key, slot);
    }
    const t = slot.text;
    if (t.text !== string) t.text = string;
    if (t.fontSize !== px) t.fontSize = px;
    t.color = rgb(colorArr);
    slot.lastUsed = frameNo;
    return slot;
  }

  function recycleOldest() {
    let oldestKey = null, oldest = Infinity;
    for (const [key, s] of slots) if (s.lastUsed < oldest && s.lastUsed < frameNo) { oldest = s.lastUsed; oldestKey = key; } // never one used this frame
    if (oldestKey !== null) removeSlot(oldestKey);
  }
  function removeSlot(key) {
    const s = slots.get(key);
    batch.removeText(s.text);
    s.text.dispose();
    slots.delete(key);
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Candidate: { key, text, x, y, r, priority, px, color }   (x, y, r in CSS pixels, y down)
  function update(cands) {
    frameNo++;
    cands.sort((a, b) => b.priority - a.priority);
    const placed = [];
    const gap = THEME.LABEL_GAP_PX, pad = THEME.LABEL_PAD_PX;
    const shownKeys = new Set();

    for (const c of cands.slice(0, TRIAL_LIMIT)) {
      if (placed.length >= MAX_LABELS) break;
      if (c.x < -20 || c.x > width + 20 || c.y < -20 || c.y > height + 20) continue; // off screen
      const slot = getSlot(c.key, c.text, c.px, c.color);
      const info = slot.text.textRenderInfo;
      if (!info) continue;                                   // still being typeset (first frames)
      const [x0, y0, x1, y1] = info.blockBounds;
      const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
      const r = c.r + gap;

      // Spots to try: top-left corner of the label rectangle for each.
      const spots = [
        [c.x + r, c.y - h / 2],               // 0 right
        [c.x - r - w, c.y - h / 2],           // 1 left
        [c.x + r, c.y - h * 1.5],             // 2 right, one row up
        [c.x + r, c.y + h * 0.5],             // 3 right, one row down
        [c.x - r - w, c.y - h * 1.5],         // 4 left, one row up
        [c.x - r - w, c.y + h * 0.5],         // 5 left, one row down
        [c.x - w / 2, c.y - r - h],           // 6 above
        [c.x - w / 2, c.y + r],               // 7 below
        [c.x + r, c.y - h * 2.5],             // 8 right, two rows up (push-apart)
        [c.x + r, c.y + h * 1.5],             // 9 right, two rows down
        [c.x - r - w, c.y - h * 2.5],         // 10
        [c.x - r - w, c.y + h * 1.5],         // 11
      ];
      // Try the spot this label used last frame first, so labels do not jump around.
      const order = [slot.lastIdx, ...spots.keys()].filter((v, i, a) => a.indexOf(v) === i);
      let chosen = null;
      for (const idx of order) {
        const [sx, sy] = spots[idx];
        const rect = { x: sx, y: sy, w, h };
        if (rect.x < 0 || rect.y < 0 || rect.x + w > width || rect.y + h > height) continue;
        if (placed.some((p) => overlaps(rect, p))) continue;
        chosen = { rect, idx };
        break;
      }
      if (!chosen) continue;                                  // no free spot: drop this label

      slot.lastIdx = chosen.idx;
      placed.push(chosen.rect);
      shownKeys.add(c.key);
      // Text origin: left edge, vertically centred (anchorX left, anchorY middle).
      const t = slot.text;
      t.position.set(chosen.rect.x + pad - x0, height - (chosen.rect.y + h / 2), 0);
      t.scale.setScalar(1);
    }

    // Everything not placed this frame is hidden (scale 0); old unused ones are eventually freed.
    for (const [key, s] of slots) {
      if (!shownKeys.has(key)) {
        s.text.scale.setScalar(0);
        if (frameNo - s.lastUsed > KEEP_FRAMES) removeSlot(key);
      }
    }
    // Warm-up gate: show nothing until all tried labels have been typeset for a while
    // (or, at the latest, after WARMUP_FRAMES frames).
    const allReady = cands.slice(0, TRIAL_LIMIT).every((c) => slots.get(c.key)?.text.textRenderInfo);
    stableFrames = allReady ? stableFrames + 1 : 0;
    batch.visible = stableFrames > 20 || frameNo > WARMUP_FRAMES;
    placedCount = placed.length;
    lastPlaced = placed.map((r, i) => ({ ...r, key: [...shownKeys][i] }));
  }

  function resize(w, h) {
    width = w; height = h;
    hudCamera.right = w; hudCamera.top = h;
    hudCamera.updateProjectionMatrix();
  }

  // Draw the labels on top of what is already on screen (no clear).
  function render() {
    renderer.render(hudScene, hudCamera);
  }

  // Debug: how many text objects exist and how many finished typesetting.
  function debug() {
    const list = [...slots.values()];
    const vis = list.filter((x) => x.text.scale.x > 0).map((x) => `${x.text.text}@${Math.round(x.text.position.x)},${Math.round(height - x.text.position.y)}`);
    return { vis, placed: lastPlaced.map((r) => `${r.key}:${slots.get(r.key).text.text}@${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`), slots: list.length, ready: list.filter((s) => s.text.textRenderInfo).length,
             sample: list[0] ? { text: list[0].text.text, info: !!list[0].text.textRenderInfo, scale: list[0].text.scale.x } : null };
  }

  return { update, resize, render, debug, get count() { return placedCount; } };
}
