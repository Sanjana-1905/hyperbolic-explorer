// quality.js - how much detail to draw: desktop, phone, or ?quality=low; plus the adaptive step.
//
// Three tiers (all numbers for the phone tier are in theme.js, PHONE_*):
//   high  - desktop default
//   phone - chosen automatically on a phone (coarse pointer AND shorter screen side <= PHONE_MAX_SHORT_SIDE_PX)
//   low   - ?quality=low (the old low setting, still used for tests)
// Override with ?quality=high | phone | low.
//
// Adaptive step: if the frame rate stays under ADAPT_FPS for ADAPT_SECONDS, the render resolution (pixel ratio) is
// multiplied by ADAPT_STEP. Only the pixel ratio changes live: the other settings are baked into geometry and shader
// defines when the page starts. Resolution is also by far the biggest cost on a phone (fill rate grows with its square).
// Example: pixel ratio 1.5 -> 1.2 means 0.64x as many pixels to shade.

import { THEME } from './theme.js';

export function detectTier(search = location.search, coarse = window.matchMedia('(pointer: coarse)').matches,
  shortSide = Math.min(screen.width, screen.height)) {
  const q = new URLSearchParams(search).get('quality');
  if (q === 'high' || q === 'low' || q === 'phone') return q;
  return coarse && shortSide <= THEME.PHONE_MAX_SHORT_SIDE_PX ? 'phone' : 'high';
}

// The settings of a tier.
export function settingsFor(tier) {
  if (tier === 'low') return { maxHalos: 16, octaves: 2, starLayers: 1, pixelRatio: 1, dustCount: 200, edgeSegments: 6, linkSegments: 10 };
  if (tier === 'phone') {
    return {
      maxHalos: THEME.PHONE_HALOS, octaves: THEME.PHONE_OCTAVES, starLayers: THEME.PHONE_STAR_LAYERS,
      pixelRatio: THEME.PHONE_PIXEL_RATIO, dustCount: THEME.PHONE_DUST,
      edgeSegments: THEME.PHONE_EDGE_SEGMENTS, linkSegments: THEME.PHONE_LINK_SEGMENTS,
    };
  }
  return { maxHalos: 64, octaves: 5, starLayers: 2, pixelRatio: 2, dustCount: 450, edgeSegments: 10, linkSegments: 16 };
}

// The adaptive step. `tick(now_ms, fps)` once per measured fps value; it calls onLower(newPixelRatio) when it lowers.
// `enabled` is false on desktop by default (?adapt=1 forces it on, ?adapt=0 off).
export function createAdaptive({ pixelRatio, onLower, enabled, fps: slowFps = THEME.ADAPT_FPS, seconds: slowSeconds = THEME.ADAPT_SECONDS }) {
  let ratio = pixelRatio;
  let slowSince = null;
  let waitUntil = THEME.ADAPT_WARMUP_S * 1000;   // `now` is the page clock (requestAnimationFrame time), so this is "5 s after load"
  let steps = 0;
  return {
    tick(now, fps) {
      if (!enabled || fps <= 0 || document.hidden || now < waitUntil) { slowSince = null; return; }
      if (fps >= slowFps) { slowSince = null; return; }
      if (slowSince === null) slowSince = now;
      if (now - slowSince >= slowSeconds * 1000 && ratio > THEME.ADAPT_MIN_PIXEL_RATIO + 1e-6) {
        ratio = Math.max(THEME.ADAPT_MIN_PIXEL_RATIO, ratio * THEME.ADAPT_STEP);
        steps++;
        slowSince = null;
        waitUntil = now + THEME.ADAPT_COOLDOWN_S * 1000;
        onLower(ratio);
      }
    },
    get pixelRatio() { return ratio; },
    get steps() { return steps; },
  };
}
