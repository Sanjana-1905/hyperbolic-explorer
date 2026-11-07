// gpucheck.js - debug check that the GPU's Möbius addition agrees with the CPU's.
//
// The refocus now runs in the vertex shader (glsl.js), but picking, the edges
// and the tests still use the CPU version (mobius3d.js). If the two ever
// disagreed, you would click on something that is not where it is drawn.
//
// How it works: put N pairs of test points (u, v) into textures, draw one
// pixel per pair with a shader that computes mobiusAdd3(u, v) and the
// hyperbolic distance 2*artanh(|u (+) v|) (and, for the edges, the point 37 % of the
// way along the geodesic from u to v; for the links (Phase 4c), the point at t = 0.37 of a hyperbolic Bézier curve
// with 5 control points made from u and v), read the pixels back, and compare
// with the same numbers computed on the CPU (64-bit doubles).
// The GPU uses 32-bit floats (about 7 digits), so a tiny difference is normal;
// we report the largest one. Call it from the browser console:
//     await __explorer.gpuCheck()

import * as THREE from 'three';
import { mobiusAdd3, geodesicLerp3, geodesicBezier3, vScale, vNeg } from './mobius3d.js';
import { MOBIUS_GLSL, GEODESIC_GLSL, BEZIER_GLSL } from './glsl.js';

const GEODESIC_T = 0.37;

// The 5 Bézier control points of test pair (u, v): u, two points made by shuffling the coordinates (scaled by 0.5 so
// they stay inside the ball), -u/2, and v. The shader builds the same five from the same u and v.
const bezierPoints = (u, v) => [u, vScale({ x: u.y, y: v.z, z: u.x }, 0.5), vScale({ x: v.x, y: u.z, z: v.y }, 0.5), vScale(vNeg(u), 0.5), v];

export function gpuCheck(renderer, count = 2048, maxRadius = 0.99) {
  if (!renderer.extensions.has('EXT_color_buffer_float')) {
    return { ok: false, reason: 'this GPU cannot render to float textures' };
  }

  // Deterministic pseudo-random test points, radius up to `maxRadius` (0.99 = the folder layout's range; symbols reach 0.9967).
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const randomPoint = (maxR) => {
    // Random direction (normalised Gaussian-ish via rejection) times a random radius.
    let x, y, z, len;
    do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; len = Math.hypot(x, y, z); }
    while (len > 1 || len < 1e-6);
    const r = maxR * Math.sqrt(rand());
    return { x: (x / len) * r, y: (y / len) * r, z: (z / len) * r };
  };

  const us = [], vs = [];
  const dataU = new Float32Array(count * 4), dataV = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const u = randomPoint(maxRadius), v = randomPoint(maxRadius);
    us.push(u); vs.push(v);
    dataU.set([u.x, u.y, u.z, 0], i * 4);
    dataV.set([v.x, v.y, v.z, 0], i * 4);
  }
  const makeTex = (data) => {
    const t = new THREE.DataTexture(data, count, 1, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  };

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { tU: { value: makeTex(dataU) }, tV: { value: makeTex(dataV) } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      precision highp float;
      uniform sampler2D tU;
      uniform sampler2D tV;
      out vec4 outColor;
      ${MOBIUS_GLSL}
      ${GEODESIC_GLSL}
      ${BEZIER_GLSL}
      void main() {
        // Pixels 3i, 3i+1, 3i+2 all handle test pair i: Möbius add, geodesic, Bézier curve.
        int x = int(gl_FragCoord.x);
        ivec2 px = ivec2(x / 3, 0);
        vec3 u = texelFetch(tU, px, 0).xyz;
        vec3 v = texelFetch(tV, px, 0).xyz;
        if (x % 3 == 0) {
          vec3 r = mobiusAdd3(u, v);
          outColor = vec4(r, 2.0 * atanh(length(r)));
        } else if (x % 3 == 1) {
          outColor = vec4(geodesicLerp3(u, v, ${GEODESIC_T.toFixed(2)}), 0.0);
        } else {
          vec3 p1 = 0.5 * vec3(u.y, v.z, u.x);
          vec3 p2 = 0.5 * vec3(v.x, u.z, v.y);
          outColor = vec4(geodesicBezier5(u, p1, p2, -0.5 * u, v, ${GEODESIC_T.toFixed(2)}), 0.0);
        }
      }`,
    depthTest: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const target = new THREE.WebGLRenderTarget(count * 3, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
  });
  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const out = new Float32Array(count * 3 * 4);
  renderer.readRenderTargetPixels(target, 0, 0, count * 3, 1, out);
  renderer.setRenderTarget(previousTarget);

  let maxPosErr = 0, maxDistErr = 0, maxGeoErr = 0, maxBezierErr = 0;
  for (let i = 0; i < count; i++) {
    const e = i * 12;      // pixel 3i starts at float 12i, pixel 3i+1 at 12i+4, pixel 3i+2 at 12i+8
    const c = mobiusAdd3(us[i], vs[i]);
    maxPosErr = Math.max(maxPosErr,
      Math.abs(out[e] - c.x), Math.abs(out[e + 1] - c.y), Math.abs(out[e + 2] - c.z));
    const cpuDist = 2 * Math.atanh(Math.hypot(c.x, c.y, c.z));
    maxDistErr = Math.max(maxDistErr, Math.abs(out[e + 3] - cpuDist));
    const g = geodesicLerp3(us[i], vs[i], GEODESIC_T);
    maxGeoErr = Math.max(maxGeoErr,
      Math.abs(out[e + 4] - g.x), Math.abs(out[e + 5] - g.y), Math.abs(out[e + 6] - g.z));
    const b = geodesicBezier3(bezierPoints(us[i], vs[i]), GEODESIC_T);
    maxBezierErr = Math.max(maxBezierErr,
      Math.abs(out[e + 8] - b.x), Math.abs(out[e + 9] - b.y), Math.abs(out[e + 10] - b.z));
  }

  target.dispose(); material.dispose(); quad.geometry.dispose();
  return { ok: maxPosErr < 1e-4 && maxGeoErr < 1e-3 && maxBezierErr < 1e-3, pairs: count, maxPosErr, maxDistErr, maxGeoErr, maxBezierErr };
}
