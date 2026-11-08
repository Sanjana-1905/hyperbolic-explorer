// idlefade.js - the interface fades away while you only look, so the galaxy fills the whole screen (touch screens).
//
// After UI_FADE_AFTER_S seconds without a touch, key press or focus change, a "level" glides from 1 (everything visible)
// to 0 (nothing but the picture) over UI_FADE_SECONDS; any activity brings it back over UI_FADE_BACK_SECONDS.
// The level is published two ways:
//   - the CSS variable --ui-o on <html>: the HTML buttons, title, breadcrumb, map and cards use it as their opacity
//     (see index.html). While it is below 0.05 the class `ui-hidden` is on <html>, which switches their pointer-events off,
//     so a touch on the (invisible) toolbar goes to the picture instead of hitting a button you cannot see;
//   - the `onLevel(level)` callback: main3d.js passes it to the 3D labels.
// Things that must stay put are NOT faded: the code panel, the search box, the intro card and the study bar. While one of
// the overlays (search, intro, study card) is open nothing fades.
// Off on desktop (mouse) by default; ?fade=1 forces it on, ?fade=0 off; off in study mode so all conditions look alike.

import { THEME } from './theme.js';

// One step of the fade: move `level` toward `target` (1 or 0) for `dt` seconds. Fading out takes UI_FADE_SECONDS for the whole
// range, fading in UI_FADE_BACK_SECONDS. Example: level 1, target 0, dt 0.3 s, fade 0.6 s -> level 0.5.
export function stepFade(level, target, dt) {
  const seconds = target < level ? THEME.UI_FADE_SECONDS : THEME.UI_FADE_BACK_SECONDS;
  const delta = dt / seconds;
  return target < level ? Math.max(target, level - delta) : Math.min(target, level + delta);
}

export function createIdleFade({ onLevel }) {
  const params = new URLSearchParams(location.search);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const enabled = params.get('fade') === '1' || (params.get('fade') !== '0' && coarse && params.get('study') !== '1');
  let lastActive = performance.now();
  let lastFrame = lastActive;
  let level = 1;
  let overlayOpen = false;
  let overlayChecked = 0;
  const root = document.documentElement;

  const poke = () => { lastActive = performance.now(); };
  if (enabled) {
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) window.addEventListener(type, poke, { capture: true, passive: true });
  }

  // Is the search box, intro card or study card showing? (Checked twice a second, not every frame.)
  function checkOverlays(now) {
    if (now - overlayChecked < 500) return;
    overlayChecked = now;
    overlayOpen = ['search', 'intro', 'studycard'].some((id) => {
      const el = document.getElementById(id);
      return el && !el.hidden && getComputedStyle(el).display !== 'none';
    });
  }

  return {
    enabled,
    poke,
    get level() { return level; },
    // Once per frame.
    update(now) {
      if (!enabled) return;
      checkOverlays(now);
      if (overlayOpen) lastActive = now;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);   // a long pause (hidden tab) must not skip the fade
      lastFrame = now;
      const idle = now - lastActive > THEME.UI_FADE_AFTER_S * 1000;
      const next = stepFade(level, idle ? 0 : 1, dt);
      if (next === level) return;
      level = next;
      root.style.setProperty('--ui-o', level.toFixed(3));
      root.classList.toggle('ui-hidden', level < 0.05);
      onLevel(level);
    },
  };
}
