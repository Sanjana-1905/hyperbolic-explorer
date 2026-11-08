// navigation.js - ALL camera and navigation code of the 3D viewer lives in this one module.
//
// Why one module: the VR phase (Phase 9) replaces how the user moves. A headset camera needs a
// hyperboloid-model (Lorentz) matrix so rotations never drift, and it must never rotate the user's
// view. If everything about "where am I looking from and how do I move" is here, that replacement
// is a rewrite of THIS file; main3d.js (drawing, picking, expansion) only calls the functions below.
//
// Two separate things move:
//   - the FOCUS POINT: which ball point is shown at the centre. Refocusing slides it along the geodesic
//     from the old point to the new one (0.5 s, ease-in-out). The GPU applies it as the `_Focus` uniform.
//   - the CAMERA: a perspective camera orbiting the centre of the ball (drag to look, scroll to move
//     closer). Panning is off so the focus always stays in the middle of the screen.
//
// What this module offers:
//   nav.camera, nav.controls   the three.js camera and its OrbitControls
//   nav.focusPoint             the ball point currently at the centre (updates while animating)
//   nav.flyTo(point, animate)  start gliding to a ball point (or jump there with animate = false)
//   nav.update(now)            call once per frame; returns true if the focus point moved
//   nav.animating              true while a glide is running
//   nav.resize(w, h)           keep the camera's aspect ratio right
//   nav.setSpin(on)            optional slow ambient rotation (desktop only; must stay off in VR)
//   nav.setInset(right, bottom) keep the focus centred in the part of the screen NOT covered by the code panel
//   nav.pushBack(place)        remember where we were before following a link (Phase 4c back stack)
//   nav.popBack()              the last remembered place (or null), removed from the stack
//   nav.backDepth              how many places are remembered
//   nav.onTap(cb)              cb({ x, y, pointerType, double }) for every tap (a press that did not drag); `double` is true for the
//                              second tap of a touch double-tap (two taps within DOUBLE_TAP_MS, DOUBLE_TAP_PX apart)
//   nav.haptic()               light vibration (where the browser allows it); flyTo(animate) calls it itself
//
// Touch (phones): one finger orbits with inertia (OrbitControls damping, ORBIT_DAMPING), two fingers pinch to zoom (pan is off,
// so the focus stays centred), a short press that did not move is a tap. The canvas has touch-action: none, so the browser
// never scrolls, zooms or pulls-to-refresh from a gesture that starts on it.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { vec3, geodesicLerp3Free, hyperbolicDistance3 } from './mobius3d.js';
import { THEME } from './theme.js';

const DEFAULT_CAMERA_DISTANCE = 1.8;   // camera distance at start; zoomRatio compares against it
const ANIM_SECONDS = 0.5;       // refocus animation length (comfort rule: transitions under 0.6 s)
const MAX_BACK = 50;            // the back stack forgets the oldest places beyond this many

// Ease-in-out: slow start, fast middle, slow end. smoothstep(t) = 3t² − 2t³.
// Example: t = 0.25 -> 0.156, t = 0.5 -> 0.5, t = 0.75 -> 0.844.
function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

export function createNavigation(renderer) {
  // 70° vertical field of view. From 1.8 units away the whole ball (radius 1)
  // fits: it spans asin(1 / 1.8) ≈ 34° either side of the centre, under 35°.
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 40);
  camera.position.set(0, 0.3, 1.8);

  // OrbitControls: drag rotates the camera around the target (the ball's centre),
  // scroll moves it closer or further.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enablePan = false;
  controls.enableDamping = true;   // smooth glide after letting go
  controls.minDistance = 0.15;     // can go inside the ball, close to the focus
  controls.maxDistance = 4;
  controls.dampingFactor = THEME.ORBIT_DAMPING;     // inertia: after letting go the view keeps turning and eases to a stop
  controls.rotateSpeed = THEME.TOUCH_ROTATE_SPEED;
  // One finger = orbit, two fingers = pinch zoom only (panning is disabled above, so DOLLY_PAN is a pure dolly).
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  // No browser gestures on the canvas: no scrolling, pull-to-refresh, page bounce or double-tap zoom.
  const el = renderer.domElement;
  el.style.touchAction = 'none';
  el.style.userSelect = 'none';
  el.style.webkitTapHighlightColor = 'transparent';
  el.addEventListener('contextmenu', (e) => e.preventDefault()); // a long press must not open a menu on the canvas

  // ---- Tap and double-tap detection --------------------------------------------------------------------------
  // A tap = one pointer, pressed and released without dragging. Touch/pen: moved < TAP_MAX_MOVE_PX and shorter than
  // TAP_MAX_MS (a long press is not a tap). Mouse: moved <= 5 px (as before). If a second finger touched during the
  // gesture (a pinch) it is not a tap. A double-tap = a touch tap shortly after, and near, the previous one.
  // Both are only REPORTED here; main3d.js decides what they mean (focus a node, go up).
  const tapListeners = [];
  const active = new Map();         // pointerId -> { x, y, t } of the press
  let maxPointers = 0;              // most fingers down at once during this gesture
  let lastTap = null;               // { x, y, t } of the previous touch tap
  el.addEventListener('pointerdown', (e) => {
    if (active.size === 0) maxPointers = 0;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    maxPointers = Math.max(maxPointers, active.size);
  });
  el.addEventListener('pointercancel', (e) => { active.delete(e.pointerId); });
  el.addEventListener('pointerup', (e) => {
    const start = active.get(e.pointerId);
    active.delete(e.pointerId);
    if (!start || maxPointers !== 1) return;
    const now = performance.now();
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    const touch = e.pointerType !== 'mouse';
    if (touch ? (moved >= THEME.TAP_MAX_MOVE_PX || now - start.t > THEME.TAP_MAX_MS) : moved > 5) return;
    let isDouble = false;
    if (touch) {
      isDouble = !!lastTap && now - lastTap.t <= THEME.DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= THEME.DOUBLE_TAP_PX;
      lastTap = isDouble ? null : { x: e.clientX, y: e.clientY, t: now };   // a third tap starts a new pair
    }
    for (const cb of tapListeners) cb({ x: e.clientX, y: e.clientY, pointerType: e.pointerType, double: isDouble });
  });

  // ---- Haptics: a very light tick when the focus changes (Android Chrome; silently ignored elsewhere) ----------
  // Chrome ignores vibrate() until the page has had a touch/click (and logs a warning if we try), so we check first.
  let lastBuzz = 0;
  function haptic() {
    const now = performance.now();
    if (now - lastBuzz < THEME.HAPTIC_MIN_GAP_MS) return;
    if (typeof navigator.vibrate !== 'function') return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    lastBuzz = now;
    try { navigator.vibrate(THEME.HAPTIC_MS); } catch { /* not allowed: fine */ }
  }

  // Optional slow ambient rotation of the view. Desktop (mouse) only, OFF by default:
  // turn it on with ?spin=1 or the R key. It is never active on touch devices, and the VR
  // phase must keep `ambientSpinAllowed` false (no automatic camera motion in a headset).
  const ambientSpinAllowed = window.matchMedia('(pointer: fine)').matches;
  function setSpin(on) {
    controls.autoRotate = ambientSpinAllowed && on;
    controls.autoRotateSpeed = THEME.AMBIENT_SPIN_SPEED;
  }
  setSpin(new URLSearchParams(location.search).get('spin') === '1');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') setSpin(!controls.autoRotate);
  });

  let focusPoint = vec3(0, 0, 0); // the ball point currently shown at the centre

  // Back stack (Phase 4c): following a link (clicking an arc's far end or a "Calls / Called by" entry) pushes the
  // place we came from; Backspace pops it, like a browser's Back button. A "place" is whatever the caller can find
  // again later (main3d.js stores { baseId } or { fileId, sym }, because symbol nodes are rebuilt when files reopen).
  const backStack = [];
  let anim = null;                // { from, to, start } while animating

  // View inset: when the code panel covers the right (or bottom) part of the screen, the picture is slid so
  // the focus stays in the middle of the visible part. three.js's setViewOffset shifts the projection: to move
  // the picture left by s pixels the view window starts s pixels to the right. The centre of the visible area
  // is (w - panelWidth)/2, i.e. s = panelWidth/2. The inset eases toward its target (20 % of the gap per frame).
  let viewW = 1, viewH = 1;
  const inset = { right: 0, bottom: 0, targetRight: 0, targetBottom: 0 };
  function applyInset() {
    if (inset.right < 0.5 && inset.bottom < 0.5 && inset.targetRight === 0 && inset.targetBottom === 0) {
      inset.right = inset.bottom = 0;
      camera.clearViewOffset();
    } else {
      camera.setViewOffset(viewW, viewH, inset.right / 2, inset.bottom / 2, viewW, viewH);
    }
  }

  return {
    camera,
    controls,
    get focusPoint() { return focusPoint; },
    get animating() { return anim !== null; },
    get spinning() { return controls.autoRotate; },
    setSpin,
    onTap(cb) { tapListeners.push(cb); },
    haptic,

    // How far the camera is from the centre relative to its default distance (1 = default, 0.5 = twice as close).
    get zoomRatio() { return camera.position.distanceTo(controls.target) / DEFAULT_CAMERA_DISTANCE; },

    // Glide (or jump) so that ball point `to` ends up at the centre. `via` (optional) = ball points the glide must pass
    // through on the way, in order: following a link glides ALONG the link's curve instead of the straight geodesic.
    // The route is [where we are, ...via, to] joined by geodesics and travelled at even speed (see update).
    flyTo(to, animate = true, via = null) {
      if (animate) {
        haptic();
        // If a previous animation is still running, start from where the view is now.
        const path = [focusPoint, ...(via || []), to];
        const cum = [0];                                    // cum[k] = hyperbolic length of the route up to path[k]
        for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + hyperbolicDistance3(path[k - 1], path[k]));
        anim = { path, cum, start: performance.now() };
      } else {
        focusPoint = to;
        anim = null;
      }
    },

    // Once per frame. Returns true when the focus point changed (the caller then refreshes the uniform).
    update(now) {
      controls.update(); // applies the damping glide
      if (inset.right !== inset.targetRight || inset.bottom !== inset.targetBottom) {
        inset.right += (inset.targetRight - inset.right) * 0.2;
        inset.bottom += (inset.targetBottom - inset.bottom) * 0.2;
        if (Math.abs(inset.targetRight - inset.right) < 0.5) inset.right = inset.targetRight;
        if (Math.abs(inset.targetBottom - inset.bottom) < 0.5) inset.bottom = inset.targetBottom;
        applyInset();
      }
      if (!anim) return false;
      const t = Math.min((now - anim.start) / (ANIM_SECONDS * 1000), 1);
      // Slide the focus point along the route. s = how much of the route's total length is done (ease-in-out);
      // find the piece of the route s falls in, and move along its geodesic. With no `via` the route is one piece:
      // exactly the old straight glide. Example: pieces of length 1 and 3 (total 4), t = 0.5 -> s = 2: the piece
      // [1, 4] is 1/3 done, so we are a third of the way along the second geodesic.
      const { path, cum } = anim;
      const total = cum[cum.length - 1];
      const s = easeInOut(t) * total;
      let k = 1;
      while (k < path.length - 1 && cum[k] < s) k++;
      const piece = cum[k] - cum[k - 1];
      focusPoint = piece > 1e-12 ? geodesicLerp3Free(path[k - 1], path[k], Math.min(1, (s - cum[k - 1]) / piece)) : path[k];
      if (t >= 1) {
        focusPoint = path[path.length - 1]; // land exactly on the target (no rounding drift)
        anim = null;
      }
      return true;
    },

    resize(w, h) {
      viewW = w; viewH = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      applyInset();
    },

    pushBack(place) {
      backStack.push(place);
      if (backStack.length > MAX_BACK) backStack.shift();
    },
    popBack() { return backStack.pop() ?? null; },
    get backDepth() { return backStack.length; },

    // Pixels currently covered by the code panel (eased value), so labels can stay out of that area.
    get inset() { return inset; },

    // Pixels of the screen covered on the right / at the bottom (0 = nothing covered).
    setInset(right, bottom) {
      inset.targetRight = right;
      inset.targetBottom = bottom;
    },
  };
}
