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

// Möbius scalar multiplication t (x) v and the geodesic from A to B, in GLSL.
// "Keep v's direction, multiply its hyperbolic distance from the centre by t":
//   new radius = tanh(t * artanh(|v|)).   Example: |v| = 0.5 (artanh = 0.549), t = 0.5:
//   tanh(0.2747) = 0.268, so the point halfway along the way to 0.5 is at 0.268.
// Geodesic from A to B at fraction t: move A to the centre (w = (-A) (+) B), go the
// fraction t toward w, move back:  A (+) (t (x) w). Same recipe as geodesicLerp3 in mobius3d.js.
export const GEODESIC_GLSL = /* glsl */ `
vec3 mobiusScale3(float t, vec3 v) {
  float r = length(v);
  if (r < 1e-9) return vec3(0.0);
  float newR = tanh(t * atanh(min(r, 0.995)));
  return v * (newR / r);
}
vec3 geodesicLerp3(vec3 a, vec3 b, float t) {
  vec3 w = mobiusAdd3(-a, b);
  return mobiusAdd3(a, mobiusScale3(t, w));
}
`;

// Colours of an "arm": hue (0..1 around the colour wheel) -> RGB, plus cooling.
// SAT is a bit below 1 for a calmer, more cinematic palette.
// hsl2rgb example: h = 0.5 (cyan) at s = 0.7, l = 0.55 -> about (0.2, 0.8, 0.9).
// Cooling: rotate the hue an eighth of the way toward blue-indigo (0.62) as the
// node gets further from the focus (fog goes 1 -> 0). Rotating the hue keeps colours
// saturated; mixing RGB with blue would turn them grey. Example: magenta 0.87:
// shortest way to 0.62 is backwards by 0.25, so at fog = 0 it becomes 0.87 - 0.25*0.12 = 0.84.
export const COLOR_GLSL = /* glsl */ `
vec3 hsl2rgb(float h, float s, float l) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h * 12.0, 12.0);
  float a = s * min(l, 1.0 - l);
  return l - a * max(vec3(-1.0), min(min(k - 3.0, 9.0 - k), vec3(1.0)));
}
vec3 armColor(float hue0, float fog) {
  float towardBlue = fract(COOL_HUE - hue0 + 0.5) - 0.5;
  float hue = hue0 + towardBlue * (1.0 - fog) * COOL_AMOUNT;
  return hsl2rgb(hue, ARM_SATURATION, ARM_LIGHTNESS);
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
//   aState    semantic zoom (set on the CPU): 0 = normal, 1 = hidden (inside a collapsed folder),
//             2 = collapsed "+N" orb (a folder drawn bigger and brighter with a ring)
// Compiled twice: the normal version, and with HALO defined for the soft glow
// quads that sit behind the focus and its children (our "fake bloom").
// Every look constant (FOLDER_R, ARM_SATURATION, TONE_GAIN, ...) lives in theme.js and is
// injected through `defines`, so this file contains no tuning numbers: to restyle, edit
// theme.js. The CPU picking code reads the same numbers.
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
attribute float aState;

varying vec2 vUv;        // where in the quad this pixel is: -1..1 in x and y
varying vec3 vColor;
varying float vBright;
varying float vFocus;
varying float vKind;
varying float vFlag;
varying float vOrb;      // 1 for a collapsed orb

${MOBIUS_GLSL}
${COLOR_GLSL}

void main() {
  float orb = step(1.5, aState);                     // state 2
  float hidden = step(0.5, aState) * step(aState, 1.5); // state 1
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
  // Folders: radius FOLDER_R * (1 + 2*energy). Energy is the log of the subtree size,
  // rescaled to 0..1, so the biggest folder is 3x the smallest. Example, FOLDER_R = 0.04:
  // energy 0 -> 0.04, energy 0.5 -> 0.08, energy 1 -> 0.12.
  // ~10 % of folders (aSeed >= HERO_AT) are "heroes": 25 % bigger and about twice as bright.
  float hero = step(HERO_AT, aSeed) * aKind;
  float rho = mix(FILE_R, FOLDER_R * (1.0 + SIZE_SPREAD * aEnergy) * (1.0 + (HERO_SIZE - 1.0) * hero), aKind);
  rho = mix(rho, FOCUS_R, isFocus);                 // the focus has one fixed, large size
  rho *= mix(1.0, COLLAPSED_SIZE, orb);             // a collapsed orb is drawn bigger
  // Then the Poincare size factor (1 - r^2)/2 shrinks things toward the surface.
  // Example: at |p| = 0.9 the factor is (1 - 0.81)/2 = 0.095, so a 0.08 folder is
  // drawn 0.0076 across, but never below MIN_R.
  // Slow breathing, +-6 % for folders only (aSeed makes each one out of step).
  float breathe = 1.0 + BREATHE_AMOUNT * aKind * sin(uTime * BREATHE_SPEED + aSeed * 6.2831);
  float size = max(rho * (1.0 - r2) * 0.5 * breathe, MIN_R);

  // --- 3. BRIGHTNESS and COLOUR by hyperbolic distance ----------------------
  // fog = e^(-d/2): 1 at the focus, 0.37 at d = 2, 0.08 at d = 5.
  float fog = exp(-d * NODE_FOG_RATE);
  float distBright = NODE_FOG_FLOOR + (1.0 - NODE_FOG_FLOOR) * fog;       // never fully black: context stays visible

  // Files: faint, each twinkling at its own speed; ~7 % are bright stars.
  float twinkle = (1.0 - FILE_TWINKLE) + FILE_TWINKLE * sin(uTime * (1.0 + 3.0 * aSeed) + aSeed * 50.0);
  float fileBright = (FILE_BRIGHT + FILE_STAR_BRIGHT * step(FILE_STAR_AT, aSeed)) * twinkle;
  // Folders: a gentle pulse, scaled by energy (0.7 .. 1.3).
  float folderBright = ((1.0 - FOLDER_PULSE) + FOLDER_PULSE * sin(uTime * 0.6 + aSeed * 20.0))
                     * (FOLDER_BRIGHT_BASE + FOLDER_BRIGHT_PER_ENERGY * aEnergy) * (1.0 + HERO_BRIGHT * hero);
  vBright = distBright * mix(fileBright, folderBright, aKind);

  vec3 col = armColor(aHue, fog);
  col = mix(col, WARM_TINT, exp(-d * WARM_RATE) * WARM_AMOUNT);   // near the focus -> a little warm
  col = mix(col, FILE_TINT, FILE_PALE * (1.0 - aKind));          // files: pale
  // The focus is a warm gold-white sun, always at full brightness.
  col = mix(col, FOCUS_COLOR, isFocus);
  vBright = mix(vBright, FOCUS_BRIGHT, isFocus);
  vBright *= mix(1.0, COLLAPSED_BRIGHT, orb);
  vColor = col;

  vFocus = isFocus;
  vKind = aKind;
  vFlag = aFlag;
  vOrb = orb;
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
  // Hidden nodes (inside a collapsed folder) are sent outside the screen: clipped, never drawn.
  if (hidden > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
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
varying float vOrb;

void main() {
  float q = length(vUv);
  if (q > 1.0) discard;                          // outside the circle: throw the pixel away

#ifdef HALO
  // Fake bloom: only a big soft glow, no ball. (1 - q)^2: q = 0.5 -> 0.25, q = 0.8 -> 0.04.
  float strength = mix(HALO_CHILD_STRENGTH, HALO_FOCUS_STRENGTH, vFocus);
  vec3 halo = vColor * pow(1.0 - q, 2.0) * strength * vBright;
  gl_FragColor = vec4(1.0 - exp(-halo * TONE_GAIN), 1.0);
#else
  vec3 col;
  if (vKind < 0.5) {
    // ---- FILE: a tiny glowing point ----
    // (1 - q)^4: q = 0.33 -> 0.20, q = 0.6 -> 0.026: falls off fast = a point of light.
    float point = pow(1.0 - q, FILE_POINT_POWER) + FILE_CORE_GAIN * (1.0 - smoothstep(0.0, CORE, q));
    col = vColor * point;
  } else {
    // ---- FOLDER: a star = glow + fake sphere ----
    float s = q / CORE;                          // 0..1 across the solid ball
    float ball = 1.0 - smoothstep(BALL_EDGE, 1.0, s);  // 1 inside the ball, soft edge, 0 outside

    // Fake sphere: pretend this pixel is a point on a ball facing us. The sphere
    // surface height is z = sqrt(1 - s^2) (Pythagoras on the unit ball), so
    // the surface normal is n = (x, y, z). Example: s = 0.6 -> z = 0.8,
    // n = (0.6, 0, 0.8), which has length 1.
    float z = sqrt(max(1.0 - s * s, 0.0));
    vec3 n = normalize(vec3(vUv / CORE, z));

    vec3 L = normalize(LIGHT_DIR);    // direction toward a fake light
    float diff = max(dot(n, L), 0.0);            // 1 facing the light, 0 at right angles
    // Fresnel rim glow: strong where the surface turns away from us (z -> 0).
    // (1 - z)^3: s = 0.6 -> 0.008 (nothing), s = 0.95 -> 0.57, s = 1 -> 1.
    float fresnel = pow(1.0 - z, FRESNEL_POWER);
    // Tiny specular highlight: a small bright spot where the normal is halfway
    // between the light and the viewer. pow(..., 40) makes the spot tiny.
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), SPEC_POWER);

    // Bright core: the centre (z = 1) mixes toward white, 40 % for folders and 95 % for
    // the focus (a hot white core); z^3 keeps the edge coloured.
    vec3 hot = mix(vColor, vec3(1.0), z * z * z * mix(CORE_WHITE_FOLDER, CORE_WHITE_FOCUS, vFocus));
    vec3 sphere = hot * (SPHERE_BASE + SPHERE_CENTRE * z) + vColor * diff * DIFFUSE_GAIN
                + vColor * fresnel * RIM_GAIN + vec3(spec * SPEC_GAIN);

    // Soft halo outside the ball: (1 - q)^2.5: q = 0.5 -> 0.18, q = 0.8 -> 0.018.
    float glow = pow(1.0 - q, GLOW_POWER);
    col = vColor * glow * GLOW_GAIN + sphere * ball;
  }

  // Reserved status marker (aFlag): a thin magenta ring. Phase 6 only changes the number.
  // Collapsed orb: a faint ring around the star says "there is more inside".
  col += vOrb * vColor * COLLAPSED_RING_GAIN * smoothstep(COLLAPSED_RING_WIDTH, 0.0, abs(q - COLLAPSED_RING_AT));
  col += vFlag * FLAG_COLOR * smoothstep(FLAG_RING_WIDTH, 0.0, abs(q - FLAG_RING_AT));

  col *= vBright;
  // Soft limiter: 1 - e^(-1.5 x). 0.2 -> 0.26, 1 -> 0.78, 3 -> 0.99. Never harshly clipped.
  gl_FragColor = vec4(1.0 - exp(-col * TONE_GAIN), 1.0);
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
  float star = smoothstep(STAR_SIZE, 0.0, dist) * step(STAR_DENSITY, h);
  float twinkle = (1.0 - STAR_TWINKLE) + STAR_TWINKLE * sin(uTime * (0.5 + 3.0 * h) + h * 100.0);
  return star * twinkle * (0.4 + 0.6 * hash31(cell + 9.9));
}

void main() {
  vec3 dir = normalize(vDir);

  // Two big noise fields at different positions give two overlapping cloud systems.
  float a = fbm(dir * NEBULA_SCALE_A + vec3(0.0, uTime * NEBULA_DRIFT_A, 0.0));
  float b = fbm(dir * NEBULA_SCALE_B + vec3(7.0, 3.0, uTime * NEBULA_DRIFT_B));

  vec3 col = SPACE_COLOR;                                    // deep navy-black space
  // smoothstep(lo, hi, a): 0 below lo, 1 above hi: only the thick parts of the noise glow.
  col += NEBULA_VIOLET * smoothstep(NEBULA_VIOLET_RANGE.x, NEBULA_VIOLET_RANGE.y, a) * NEBULA_VIOLET_GAIN;
  col += NEBULA_TEAL   * smoothstep(NEBULA_TEAL_RANGE.x,   NEBULA_TEAL_RANGE.y,   b) * NEBULA_TEAL_GAIN;
  col += NEBULA_INDIGO * smoothstep(NEBULA_INDIGO_RANGE.x, NEBULA_INDIGO_RANGE.y, a * b * 2.0) * NEBULA_INDIGO_GAIN;

  float stars = starLayer(dir, STAR_SCALE_1, 0.0);
#if STAR_LAYERS > 1
  stars += STAR_LAYER2_GAIN * starLayer(dir, STAR_SCALE_2, 17.0);
#endif
  col += STAR_COLOR * stars;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// 4. Haze instead of a shell: a faint glow that fades to nothing at the boundary
// ---------------------------------------------------------------------------
// One quad at the centre of the ball, always facing the camera, HAZE_R wide.
// q = 0 at the centre, 1 at the ball's boundary. brightness = (1 - q)^2 has value AND
// slope 0 at q = 1, so there is no visible edge: q = 0.5 -> 0.25, q = 0.8 -> 0.04, q = 1 -> 0.
export const HAZE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 mv = viewMatrix * vec4(0.0, 0.0, 0.0, 1.0);   // centre of the ball in camera space
  mv.xy += position.xy * HAZE_R;
  gl_Position = projectionMatrix * mv;
}
`;
export const HAZE_FRAG = /* glsl */ `
varying vec2 vUv;
void main() {
  float q = length(vUv);
  if (q > 1.0) discard;
  vec3 tint = mix(HAZE_INNER, HAZE_OUTER, q);  // indigo inside, violet outside
  gl_FragColor = vec4(tint * pow(1.0 - q, HAZE_POWER) * HAZE_STRENGTH, 1.0);
}
`;

// ---------------------------------------------------------------------------
// 5. The sun: a billboard at the focus with core, gold glow, corona and rays
// ---------------------------------------------------------------------------
// The quad is SUN_SCALE core-radii wide. Everything is drawn in units of q (0 centre, 1 quad edge).
// With SUN_SCALE = 14 the solid core is at q = 1/14 = 0.07.
export const SUN_VERT = /* glsl */ `
uniform vec3 _Focus;
uniform vec3 uFocusPos;     // home position of the focused node
uniform float uTime;
varying vec2 vUv;
${MOBIUS_GLSL}
void main() {
  vUv = position.xy;
  vec3 p = mobiusAdd3(-_Focus, uFocusPos);          // same GPU refocus as every node
  float size = max(FOCUS_R * (1.0 - dot(p, p)) * 0.5, MIN_R) * SUN_SCALE;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}
`;
export const SUN_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  float q = length(vUv);
  if (q > 1.0) discard;
  float pulse = 1.0 + SUN_PULSE * sin(uTime * SUN_PULSE_SPEED);       // gentle pulsing, +-8 %

  // Gaussians: exp(-(q/w)^2) is 1 at the centre, 0.37 at q = w, 0.02 at q = 2w.
  float core   = exp(-pow(q / SUN_CORE_W, 2.0));           // hot white core
  float inner  = exp(-pow(q / SUN_INNER_W, 2.0));            // warm gold inner glow
  float corona = pow(1.0 - q, SUN_CORONA_POWER);       // larger faint corona: q = 0.3 -> 0.24

  // Star-shaped glow: cos(3a) has 3 positive and 3 negative lobes, abs() makes 6 spikes.
  // pow(.., 30) squeezes each lobe to a thin ray (cos = 0.9 -> 0.04). A second, shorter set of
  // 4 rays (cos(2a)) sits at another angle. Slow rotation: the angle offset grows with time.
  float a = atan(vUv.y, vUv.x);
  float rays = pow(abs(cos(3.0 * a + uTime * SUN_RAY_SPIN_A)), SUN_RAY_SHARP_A) * pow(1.0 - q, 2.0) * exp(-q * 3.0)
             + SUN_RAY_B_GAIN * pow(abs(cos(2.0 * a - uTime * SUN_RAY_SPIN_B + 0.6)), SUN_RAY_SHARP_B) * pow(1.0 - q, 3.0) * exp(-q * 4.0);

  vec3 col = SUN_CORE_COLOR * core * SUN_CORE_GAIN
           + SUN_GOLD * inner * SUN_INNER_GAIN
           + SUN_CORONA_COLOR * corona * SUN_CORONA_GAIN
           + SUN_RAY_COLOR * rays * SUN_RAY_GAIN;
  col *= pulse;
  gl_FragColor = vec4(1.0 - exp(-col * TONE_GAIN), 1.0);
}
`;

// ---------------------------------------------------------------------------
// 6. Edges: thick glowing filaments, geodesics computed in the vertex shader
// ---------------------------------------------------------------------------
// Each edge is ONE instance (its two end points aA, aB in home coordinates). The
// base geometry is a strip of (EDGE_SEGMENTS + 1) pairs of vertices: aT = 0..1 is how
// far along the edge a pair is and aSide = -1 / +1 is the left / right vertex of the pair.
// For every vertex the shader:
//   1. moves both ends with the _Focus uniform (the GPU refocus),
//   2. finds the point at fraction aT on the geodesic between the moved ends,
//   3. finds the screen direction of the curve there (a second point slightly further on),
//   4. pushes the vertex sideways by half the line width, perpendicular to that direction.
// So the 1-pixel limit of GL lines disappears and the width can follow the fog.
export const EDGE_VERT = /* glsl */ `
uniform vec3 _Focus;
uniform vec2 uResolution;     // drawing-buffer size in pixels
uniform float uLineWidth;     // base width in drawing-buffer pixels

attribute float aT;
attribute float aSide;
attribute vec3 aA;
attribute vec3 aB;
attribute float aHue;
attribute float aEnergy;
attribute float aSeed;
attribute float aHide;        // 1 = the child end is inside a collapsed folder: do not draw

varying float vAcross;        // -1 at one side of the line, +1 at the other
varying float vT;
varying float vSeed;
varying float vBright;
varying vec3 vColor;

${MOBIUS_GLSL}
${GEODESIC_GLSL}
${COLOR_GLSL}

void main() {
  vec3 A = mobiusAdd3(-_Focus, aA);
  vec3 B = mobiusAdd3(-_Focus, aB);
  vec3 w = mobiusAdd3(-A, B);
  vec3 P = mobiusAdd3(A, mobiusScale3(aT, w));
  // A second point a little further along (or back, at the far end) gives the direction.
  float dir = aT < 0.5 ? 1.0 : -1.0;
  vec3 Q = mobiusAdd3(A, mobiusScale3(aT + dir * 0.04, w));

  // Fog: same idea as for nodes, from the hyperbolic distance of this point to the focus.
  float d = 2.0 * atanh(length(P));
  float fog = exp(-d * EDGE_FOG_RATE);              // 1 at the focus, 0.4 at d = 2, 0.1 at d = 5
  vBright = EDGE_BRIGHT_FLOOR + EDGE_BRIGHT_NEAR * fog;                      // never invisible, brightest near the focus
  vColor = armColor(aHue, fog);
  vT = aT; vSeed = aSeed; vAcross = aSide;

  vec4 cp = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vec4 cq = projectionMatrix * viewMatrix * vec4(Q, 1.0);
  // Screen-space (pixel) direction of the curve and its perpendicular.
  vec2 dirPx = (cq.xy / cq.w - cp.xy / cp.w) * uResolution * 0.5 * dir;
  dirPx = length(dirPx) > 1e-4 ? normalize(dirPx) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dirPx.y, dirPx.x);

  // Width: 0.55x far away to 1.45x near the focus, a bit more for big subtrees.
  float width = uLineWidth * (EDGE_WIDTH_FAR + EDGE_WIDTH_NEAR * fog) * (EDGE_WIDTH_ENERGY_BASE + EDGE_WIDTH_PER_ENERGY * aEnergy);
  // One pixel is 2/uResolution in normalised screen units (the screen is 2 units wide).
  gl_Position = cp;
  gl_Position.xy += perp * aSide * (width * 0.5) * (2.0 / uResolution) * cp.w;
  if (aHide > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // outside the screen: clipped
}
`;
export const EDGE_FRAG = /* glsl */ `
uniform float uTime;
varying float vAcross;
varying float vT;
varying float vSeed;
varying float vBright;
varying vec3 vColor;
void main() {
  // Soft cross-section: 1 - x^2 is 1 along the middle of the line, 0.75 at x = 0.5, 0 at the sides.
  float soft = 1.0 - vAcross * vAcross;

  // Travelling light pulse (a small comet from parent to child).
  //   head = where the comet's head is along the edge (0 = parent end, 1 = child end).
  //          It moves at EDGE_PULSE_SPEED laps per second, and a lap is EDGE_PULSE_GAP edge
  //          lengths long, so after reaching the child it rests before starting again.
  //   vSeed shifts every edge's start by a random amount, so they never pulse in unison.
  //   behind = how far this pixel is behind the head; the comet is bright at the head and
  //          fades as e^(-TAIL * behind). Nothing is lit ahead of the head.
  // Example (SPEED 0.35, GAP 2.2, seed 0) at t = 1 s: fract(0.35) * 2.2 = 0.77. At vT = 0.7 we are
  // 0.07 behind the head -> e^(-9 * 0.07) = 0.53; at vT = 0.3, 0.47 behind -> 0.015 (nearly dark).
  float head = fract(uTime * EDGE_PULSE_SPEED + vSeed) * EDGE_PULSE_GAP;
  float behind = head - vT;
  float comet = behind > 0.0 ? exp(-EDGE_PULSE_TAIL * behind) : 0.0;
  vec3 pulseColor = mix(vColor, vec3(1.0), EDGE_PULSE_WHITE);

  vec3 col = (vColor + pulseColor * comet * EDGE_PULSE_GAIN) * vBright * soft;
  gl_FragColor = vec4(1.0 - exp(-col * TONE_GAIN), 1.0);
}
`;

// ---------------------------------------------------------------------------
// 7. Background dust: faint points inside the ball that fill the empty space
// ---------------------------------------------------------------------------
// They live at fixed home positions in the ball and are moved by the same _Focus
// refocus as everything else, so they slide past with correct parallax when you refocus,
// and each one wanders slowly around its home (see `wander`).
export const DUST_VERT = /* glsl */ `
uniform vec3 _Focus;
uniform float uTime;
attribute vec2 corner;
attribute vec3 aPos;
attribute float aSeed;
varying vec2 vUv;
varying vec3 vColor;
varying float vBright;
${MOBIUS_GLSL}
void main() {
  // Slow wander: each speck drifts around its home along three sine waves of different
  // phase and speed (aSeed makes every speck different). The offset is at most
  // DUST_DRIFT in each axis, e.g. 0.03 of the ball's radius.
  float spd = DUST_DRIFT_SPEED * (0.6 + aSeed);
  vec3 wander = vec3(sin(uTime * spd + aSeed * 17.0),
                     sin(uTime * spd * 1.3 + aSeed * 31.0 + 2.0),
                     sin(uTime * spd * 0.8 + aSeed * 47.0 + 4.0)) * DUST_DRIFT;
  vec3 p = mobiusAdd3(-_Focus, aPos + wander);
  float r2 = dot(p, p);
  float d = 2.0 * atanh(sqrt(r2));
  float size = max(DUST_SIZE * (1.0 - r2) * 0.5, MIN_R);
  // Each speck twinkles at its own speed; ~15 % are a bit brighter. Fades slowly with distance.
  float twinkle = 0.5 + 0.5 * sin(uTime * (0.4 + 1.5 * aSeed) + aSeed * 60.0);
  vBright = (DUST_BRIGHT + DUST_STAR_BRIGHT * step(DUST_STAR_AT, aSeed))
          * ((1.0 - DUST_TWINKLE) + DUST_TWINKLE * twinkle)
          * (DUST_FOG_FLOOR + (1.0 - DUST_FOG_FLOOR) * exp(-d * DUST_FOG_RATE));
  vColor = mix(DUST_TINT_A, DUST_TINT_B, aSeed);  // pale blue .. pale violet
  vUv = corner;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += corner * size * 3.0;
  gl_Position = projectionMatrix * mv;
}
`;
export const DUST_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vBright;
void main() {
  float q = length(vUv);
  if (q > 1.0) discard;
  float glow = pow(1.0 - q, 3.0);                   // q = 0.33 -> 0.30, q = 0.6 -> 0.06
  gl_FragColor = vec4(1.0 - exp(-vColor * glow * vBright * TONE_GAIN), 1.0);
}
`;
