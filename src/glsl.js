// glsl.js - every shader (GLSL source string) of the 3D "galaxy" look.
//
// Reading guide: a shader is a tiny program that runs on the GPU.
//   - The VERTEX shader runs once per corner of every quad (4 per node) and
//     decides WHERE it goes on screen and what colour/brightness it carries.
//   - The FRAGMENT shader runs once per pixel the quad covers and decides the
//     final colour of that pixel.
// Values handed from vertex to fragment are called `varying`s; the GPU blends
// them smoothly across the quad.

// ---------------------------------------------------------------------------
// 1. Möbius addition in GLSL (the same formula as mobiusAdd3 in mobius3d.js)
// ---------------------------------------------------------------------------
// u (+) v = ((1 + 2<u,v> + |v|^2) u + (1 - |u|^2) v) / (1 + 2<u,v> + |u|^2 |v|^2)
// "Move the point v as if the centre of the ball had been moved to u."
// Numeric example (1D, so vectors are plain numbers): u = 0.5, v = 0.5:
//   top    = (1 + 2*0.25 + 0.25) * 0.5 + (1 - 0.25) * 0.5 = 0.875 + 0.375 = 1.25
//   bottom = 1 + 2*0.25 + 0.25*0.25 = 1.5625      ->  1.25 / 1.5625 = 0.8
// So 0.5 (+) 0.5 = 0.8: two equal steps do not reach 1.0, the edge is infinitely far.
// The last two lines are the same clamp as the CPU: never closer to the surface than 0.995.
export const MOBIUS_GLSL = /* glsl */ `
vec3 mobiusAdd3(vec3 u, vec3 v) {
  float uv = dot(u, v);
  float uu = dot(u, u);
  float vv = dot(v, v);
  vec3 top = (1.0 + 2.0 * uv + vv) * u + (1.0 - uu) * v;
  float bottom = 1.0 + 2.0 * uv + uu * vv;
  vec3 r = top / bottom;
  float len = length(r);
  return len > 0.995 ? r * (0.995 / len) : r;
}
`;

// ---------------------------------------------------------------------------
// 2. Nodes: camera-facing impostor quads (folders = stars, files = twinkling points)
// ---------------------------------------------------------------------------
// ONE quad (4 corners) is reused for every node (instancing). Each instance has
// its own attributes:
//   aPos      home position in the ball (never changes)
//   aHue      colour of the node's "arm" (0..1 around the colour wheel)
//   aEnergy   0..1: bigger and brighter when higher. (Phase 3: log of subtree size;
//             Phase 6: real data, e.g. file size or recent activity)
//   aFlag     reserved status marker (0 = none; 1 draws a magenta ring)
//   aKind     1 = folder, 0 = file
//   aSeed     random 0..1 per node, makes twinkles and breathing out of step
//   aId       node index, so the shader can tell which node is the focus
// Compiled twice: the normal version, and with HALO defined for the soft glow
// quads that sit behind the focus and its children (our "fake bloom").
// Constants (FOLDER_R, ...) are injected from main3d.js through `defines`, so
// the CPU picking code uses exactly the same numbers.
export const NODE_VERT = /* glsl */ `
uniform vec3 _Focus;     // the ball point currently shown at the centre of the screen
uniform float uFocusId;  // id of the node we are focusing on (gets the "sun" look)
uniform float uTime;     // seconds, drives breathing and twinkling

attribute vec2 corner;   // quad corner: (-1,-1) (1,-1) (1,1) (-1,1)
attribute vec3 aPos;
attribute float aHue;
attribute float aEnergy;
attribute float aFlag;
attribute float aKind;
attribute float aSeed;
attribute float aId;

varying vec2 vUv;        // where in the quad this pixel is: -1..1 in x and y
varying vec3 vColor;
varying float vBright;
varying float vFocus;
varying float vKind;
varying float vFlag;

${MOBIUS_GLSL}

// Hue (0..1 around the wheel) + saturation + lightness -> red/green/blue.
// Example: h = 0 gives red, h = 0.33 green, h = 0.66 blue (at s = 1, l = 0.5).
vec3 hsl2rgb(float h, float s, float l) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h * 12.0, 12.0);
  float a = s * min(l, 1.0 - l);
  return l - a * max(vec3(-1.0), min(min(k - 3.0, 9.0 - k), vec3(1.0)));
}

void main() {
  // --- 1. REFOCUS ON THE GPU: bring the focus point to the centre ----------
  // Same as the CPU did before: p = (-focus) (+) home position.
  vec3 p = mobiusAdd3(-_Focus, aPos);
  float r2 = dot(p, p);

  // After the move the focus sits at the origin, so the hyperbolic distance
  // from the focus is d = 2*artanh(|p|). Example: |p| = 0.5 -> d = 1.10,
  // |p| = 0.9 -> d = 2.94, |p| = 0.99 -> d = 5.29.
  float d = 2.0 * atanh(sqrt(r2));

  float isFocus = step(abs(aId - uFocusId), 0.5);

  // --- 2. SIZE: world radius of the solid core ------------------------------
  // Folders vary with energy: radius factor 0.6 + 0.9*energy (0 -> 0.6, 1 -> 1.5).
  // Then the Poincare size factor (1 - r^2)/2 shrinks things toward the surface.
  // Example: folder energy 0.5 -> 0.075*1.05 = 0.079; at |p| = 0.9 the factor is
  // (1 - 0.81)/2 = 0.095, so the core is 0.0075 across, but never below MIN_R.
  float rho = mix(FILE_R, FOLDER_R * (0.6 + 0.9 * aEnergy), aKind);
  rho *= mix(1.0, FOCUS_BOOST, isFocus);
  // Slow breathing, +-6 % for folders only (aSeed makes each one out of step).
  float breathe = 1.0 + 0.06 * aKind * sin(uTime * 0.8 + aSeed * 6.2831);
  float size = max(rho * (1.0 - r2) * 0.5 * breathe, MIN_R);

  // --- 3. BRIGHTNESS and COLOUR by hyperbolic distance ----------------------
  // fog = e^(-d/2): 1 at the focus, 0.37 at d = 2, 0.08 at d = 5.
  float fog = exp(-d * 0.5);
  float distBright = 0.12 + 0.88 * fog;       // never fully black: context stays visible

  // Files: faint, each twinkling at its own speed; ~7 % are bright stars.
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.0 + 3.0 * aSeed) + aSeed * 50.0);
  float fileBright = (0.35 + 1.6 * step(0.93, aSeed)) * twinkle;
  // Folders: a gentle pulse, scaled by energy (0.7 .. 1.3).
  float folderBright = (0.85 + 0.15 * sin(uTime * 0.6 + aSeed * 20.0)) * (0.7 + 0.6 * aEnergy);
  vBright = distBright * mix(fileBright, folderBright, aKind);

  // Cooling: rotate the hue a quarter of the way toward blue (0.62) as the node
  // gets further away. Rotating the hue keeps colours saturated; mixing RGB with
  // blue would turn a red arm into muddy grey. Example: red (0.0): shortest way
  // to 0.62 is backwards by 0.38, so at fog = 0 it becomes 0 - 0.38*0.25 = -0.095
  // = 0.905 (magenta). Yellow-green 0.2 moves forward to 0.3 (green).
  float towardBlue = fract(0.62 - aHue + 0.5) - 0.5;
  float hue = aHue + towardBlue * (1.0 - fog) * 0.25;
  vec3 col = hsl2rgb(hue, 0.90, 0.55);
  vec3 warm = vec3(1.00, 0.85, 0.55);         // near the focus -> a little warm
  col = mix(col, warm, exp(-d * 1.5) * 0.12);
  col = mix(col, vec3(0.90, 0.93, 1.00), 0.6 * (1.0 - aKind)); // files: pale
  // The focus is a warm gold-white sun, always at full brightness.
  col = mix(col, vec3(1.00, 0.84, 0.50), isFocus);
  vBright = mix(vBright, 1.2, isFocus);
  vColor = col;

  vFocus = isFocus;
  vKind = aKind;
  vFlag = aFlag;
  vUv = corner;

  // --- 4. BILLBOARD: a quad that always faces the camera ---------------------
  // Move the centre into camera space, then push the corner sideways in
  // camera space (x, y) - so the quad can never be seen edge-on.
  // The quad is GLOW_SCALE times larger than the core so the glow has room.
  float quad = size * GLOW_SCALE;
#ifdef HALO
  quad = size * mix(CHILD_HALO, FOCUS_HALO, isFocus);
#endif
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += corner * quad;
  gl_Position = projectionMatrix * mv;
}
`;

// Fragment shader of the node impostors.
// q = distance of this pixel from the quad centre: 0 in the middle, 1 at the
// middle of an edge. The solid ball covers q < CORE (= 1/GLOW_SCALE = 0.33).
// Everything outside it is glow that fades to 0 at q = 1, so the quad's square
// edge is never visible; `discard` removes the corners outside the circle.
export const NODE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vBright;
varying float vFocus;
varying float vKind;
varying float vFlag;

void main() {
  float q = length(vUv);
  if (q > 1.0) discard;                          // outside the circle: throw the pixel away

#ifdef HALO
  // Fake bloom: only a big soft glow, no ball. (1 - q)^2: q = 0.5 -> 0.25, q = 0.8 -> 0.04.
  float strength = mix(0.30, 0.55, vFocus);
  vec3 halo = vColor * pow(1.0 - q, 2.0) * strength * vBright;
  gl_FragColor = vec4(1.0 - exp(-halo * 1.5), 1.0);
#else
  vec3 col;
  if (vKind < 0.5) {
    // ---- FILE: a tiny glowing point ----
    // (1 - q)^4: q = 0.33 -> 0.20, q = 0.6 -> 0.026: falls off fast = a point of light.
    float point = pow(1.0 - q, 4.0) + 0.8 * (1.0 - smoothstep(0.0, CORE, q));
    col = vColor * point;
  } else {
    // ---- FOLDER: a star = glow + fake sphere ----
    float s = q / CORE;                          // 0..1 across the solid ball
    float ball = 1.0 - smoothstep(0.9, 1.0, s);  // 1 inside the ball, soft edge, 0 outside

    // Fake sphere: pretend this pixel is a point on a ball facing us. The sphere
    // surface height is z = sqrt(1 - s^2) (Pythagoras on the unit ball), so
    // the surface normal is n = (x, y, z). Example: s = 0.6 -> z = 0.8,
    // n = (0.6, 0, 0.8), which has length 1.
    float z = sqrt(max(1.0 - s * s, 0.0));
    vec3 n = normalize(vec3(vUv / CORE, z));

    vec3 L = normalize(vec3(-0.4, 0.6, 0.7));    // direction toward a fake light
    float diff = max(dot(n, L), 0.0);            // 1 facing the light, 0 at right angles
    // Fresnel rim glow: strong where the surface turns away from us (z -> 0).
    // (1 - z)^3: s = 0.6 -> 0.008 (nothing), s = 0.95 -> 0.57, s = 1 -> 1.
    float fresnel = pow(1.0 - z, 3.0);
    // Tiny specular highlight: a small bright spot where the normal is halfway
    // between the light and the viewer. pow(..., 40) makes the spot tiny.
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 40.0);

    // Bright core: the centre (z = 1) mixes 40 % toward white; z^3 keeps the edge coloured.
    vec3 hot = mix(vColor, vec3(1.0), z * z * z * 0.4);
    vec3 sphere = hot * (0.40 + 0.45 * z) + vColor * diff * 0.2
                + vColor * fresnel * 1.1 + vec3(spec * 0.35);

    // Soft halo outside the ball: (1 - q)^2.5: q = 0.5 -> 0.18, q = 0.8 -> 0.018.
    float glow = pow(1.0 - q, 2.5);
    col = vColor * glow * 0.6 + sphere * ball;
  }

  // Reserved status marker (aFlag): a thin magenta ring. Phase 6 only changes the number.
  col += vFlag * vec3(1.0, 0.2, 0.8) * smoothstep(0.06, 0.0, abs(q - 0.85));

  col *= vBright;
  // Soft limiter: 1 - e^(-1.5 x). 0.2 -> 0.26, 1 -> 0.78, 3 -> 0.99. Never harshly clipped.
  gl_FragColor = vec4(1.0 - exp(-col * 1.5), 1.0);
#endif
}
`;

// ---------------------------------------------------------------------------
// 3. Nebula background and starfield (a big sphere around the camera)
// ---------------------------------------------------------------------------
export const NEBULA_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;   // the sphere is centred on the camera, so the position IS the view direction
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

// OCTAVES (noise layers) and STAR_LAYERS are injected from the quality setting.
export const NEBULA_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vDir;

// Cheap pseudo-random number from a 3D grid cell: same cell in, same number out.
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// Value noise: random numbers at grid corners, smoothly blended in between.
// f*f*(3-2f) is the "smoothstep" blend: f = 0.25 -> 0.156, f = 0.5 -> 0.5.
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i),                  hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)),    hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)),    hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)),    hash31(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

// Fractal noise: add noise at doubling frequency and halving strength.
// Big soft clouds from the first layer, finer wisps from the later ones.
float fbm(vec3 p) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + 11.7;
    amp *= 0.5;
  }
  return sum;
}

// One layer of stars: cut the sky into little cells, put at most one star in
// each (about 3 % of cells), jitter it inside the cell, draw a small soft dot.
float starLayer(vec3 dir, float scale, float seed) {
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  float h = hash31(cell + seed);
  vec3 jitter = vec3(hash31(cell + 3.1 + seed), hash31(cell + 7.7 + seed), hash31(cell + 5.3 + seed));
  float dist = length(fract(p) - (0.2 + 0.6 * jitter));
  float star = smoothstep(0.10, 0.0, dist) * step(0.97, h);
  float twinkle = 0.7 + 0.3 * sin(uTime * (0.5 + 3.0 * h) + h * 100.0);
  return star * twinkle * (0.4 + 0.6 * hash31(cell + 9.9));
}

void main() {
  vec3 dir = normalize(vDir);

  // Two big noise fields at different positions give two overlapping cloud systems.
  float a = fbm(dir * 1.6 + vec3(0.0, uTime * 0.004, 0.0));
  float b = fbm(dir * 2.6 + vec3(7.0, 3.0, uTime * 0.003));

  vec3 violet = vec3(0.34, 0.12, 0.52);
  vec3 teal   = vec3(0.04, 0.42, 0.48);
  vec3 indigo = vec3(0.10, 0.14, 0.55);
  vec3 col = vec3(0.004, 0.006, 0.020);                      // deep navy-black space
  // smoothstep(0.45, 0.9, a): 0 below 0.45, 1 above 0.9: only the thick parts of the noise glow.
  col += violet * smoothstep(0.42, 0.88, a) * 0.40;
  col += teal   * smoothstep(0.48, 0.88, b) * 0.32;
  col += indigo * smoothstep(0.35, 0.80, a * b * 2.0) * 0.25;

  float stars = starLayer(dir, 60.0, 0.0);
#if STAR_LAYERS > 1
  stars += 0.7 * starLayer(dir, 130.0, 17.0);
#endif
  col += vec3(0.85, 0.9, 1.0) * stars;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// 4. The edge of the ball: only a faint rim glow, never a solid disc
// ---------------------------------------------------------------------------
export const SHELL_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

// Fresnel again: surfaces seen edge-on (the ball's silhouette) glow, surfaces
// seen face-on are invisible. 1 - |cos|: face-on 0, 60 degrees 0.5, edge-on 1;
// to the 4th power it is 0, 0.06, 1.
export const SHELL_FRAG = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 4.0);
  gl_FragColor = vec4(vec3(0.25, 0.32, 0.85) * rim * 0.12, 1.0);
}
`;
