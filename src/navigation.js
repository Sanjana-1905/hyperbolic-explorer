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

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { vec3, geodesicLerp3Free } from './mobius3d.js';
import { THEME } from './theme.js';

const ANIM_SECONDS = 0.5;       // refocus animation length (comfort rule: transitions under 0.6 s)

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

    // Glide (or jump) so that ball point `to` ends up at the centre.
    flyTo(to, animate = true) {
      if (animate) {
        // If a previous animation is still running, start from where the view is now.
        anim = { from: focusPoint, to, start: performance.now() };
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
      // Slide the focus point along the geodesic between the old and new focus.
      focusPoint = geodesicLerp3Free(anim.from, anim.to, easeInOut(t));
      if (t >= 1) {
        focusPoint = anim.to; // land exactly on the target (no rounding drift)
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

    // Pixels currently covered by the code panel (eased value), so labels can stay out of that area.
    get inset() { return inset; },

    // Pixels of the screen covered on the right / at the bottom (0 = nothing covered).
    setInset(right, bottom) {
      inset.targetRight = right;
      inset.targetBottom = bottom;
    },
  };
}
