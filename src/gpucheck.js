// gpucheck.js - debug check that the GPU's Möbius addition agrees with the CPU's.
//
// The refocus now runs in the vertex shader (glsl.js), but picking, the edges
// and the tests still use the CPU version (mobius3d.js). If the two ever
// disagreed, you would click on something that is not where it is drawn.
//
// How it works: put N pairs of test points (u, v) into textures, draw one
// pixel per pair with a shader that computes mobiusAdd3(u, v) and the
// hyperbolic distance 2*artanh(|u (+) v|), read the pixels back, and compare
// with the same numbers computed on the CPU (64-bit doubles).
// The GPU uses 32-bit floats (about 7 digits), so a tiny difference is normal;
// we report the largest one. Call it from the browser console:
//     await __explorer.gpuCheck()

import * as THREE from 'three';
import { mobiusAdd3 } from './mobius3d.js';
import { MOBIUS_GLSL } from './glsl.js';

export function gpuCheck(renderer, count = 2048) {
  if (!renderer.extensions.has('EXT_color_buffer_float')) {
    return { ok: false, reason: 'this GPU cannot render to float textures' };
  }

  // Deterministic pseudo-random test points, radius up to 0.99 (the layout's real range).
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
    const u = randomPoint(0.99), v = randomPoint(0.99);
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
      void main() {
        ivec2 px = ivec2(int(gl_FragCoord.x), 0);   // pixel i handles test pair i
        vec3 r = mobiusAdd3(texelFetch(tU, px, 0).xyz, texelFetch(tV, px, 0).xyz);
        outColor = vec4(r, 2.0 * atanh(length(r)));
      }`,
    depthTest: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const target = new THREE.WebGLRenderTarget(count, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
  });
  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const out = new Float32Array(count * 4);
  renderer.readRenderTargetPixels(target, 0, 0, count, 1, out);
  renderer.setRenderTarget(previousTarget);

  let maxPosErr = 0, maxDistErr = 0;
  for (let i = 0; i < count; i++) {
    const c = mobiusAdd3(us[i], vs[i]);
    maxPosErr = Math.max(maxPosErr,
      Math.abs(out[i * 4] - c.x), Math.abs(out[i * 4 + 1] - c.y), Math.abs(out[i * 4 + 2] - c.z));
    const cpuDist = 2 * Math.atanh(Math.hypot(c.x, c.y, c.z));
    maxDistErr = Math.max(maxDistErr, Math.abs(out[i * 4 + 3] - cpuDist));
  }

  target.dispose(); material.dispose(); quad.geometry.dispose();
  return { ok: maxPosErr < 1e-4, pairs: count, maxPosErr, maxDistErr };
}
