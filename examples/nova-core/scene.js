/**
 * NOVA CORE — 12 s product-reveal piece. ~100% declarative: objects + SVG + a flat score.
 * Beats:  0–2.1 ignite from black · 2–4 rings & shell assemble · 3–6 HUD draws on
 *         5.6–6.8 charge-up · 6.8 DETONATION (flash, shockwave, sparks, camera punch) · 7.1 title · 11.2 fade (loops cleanly)
 */
import { createMotion, rng, range } from 'agent-stage/kit/index.js';
import { attachReview } from 'agent-stage/kit/review.js';

const W = 1920, H = 1080, CX = W / 2, CY = H / 2;
const BOOM = 6.8; // the one number everything else is timed against
const END = 12;

// ───────────────────────────── SVG HUD (design coords = 1920×1080) ─────────────────────────────
const r = rng(11);
const ticks = range(72, (i) => {
  const a = (i / 72) * Math.PI * 2, long = i % 6 === 0, r0 = 392, r1 = r0 + (long ? 22 : 10);
  return `<line class="tick" x1="${CX + Math.cos(a) * r0}" y1="${CY + Math.sin(a) * r0}" x2="${CX + Math.cos(a) * r1}" y2="${CY + Math.sin(a) * r1}" stroke="#9fe8ff" stroke-width="${long ? 2.5 : 1.2}"/>`;
}).join('');
const BARS = 28, barH = range(BARS, () => 0.25 + r() * 0.75);
const bars = range(BARS, (i) => `<rect id="bar${i}" class="bar" x="${1560 + i * 11}" y="150" width="6" height="90" fill="#4de2ff" data-origin="center bottom"/>`).join('');
const bracket = (id, d) => `<path id="${id}" class="bracket" d="${d}" fill="none" stroke="#dff6ff" stroke-width="2.5" stroke-linecap="square"/>`;
const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const sans = 'Helvetica Neue, Helvetica, Arial, sans-serif';

const svg = `<svg viewBox="0 0 ${W} ${H}">
  <g id="hud">
    <g id="rings" fill="none">
      <circle id="r1" cx="${CX}" cy="${CY}" r="360" stroke="#9fe8ff" stroke-opacity=".55" stroke-width="1.5"/>
      <circle id="r2" cx="${CX}" cy="${CY}" r="376" stroke="#4de2ff" stroke-opacity=".9" stroke-width="3" stroke-dasharray="1 1"/>
    </g>
    <g id="ticks">${ticks}</g>
    ${bracket('b1', 'M 70 130 V 70 H 130')}${bracket('b2', `M ${W - 130} 70 H ${W - 70} V 130`)}
    ${bracket('b3', `M 70 ${H - 130} V ${H - 70} H 130`)}${bracket('b4', `M ${W - 130} ${H - 70} H ${W - 70} V ${H - 130}`)}
    <g id="tl" font-family='${mono}' font-size="17" fill="#9fe8ff" letter-spacing="3">
      <text x="110" y="118">NOVA-CORE // TELEMETRY</text>
      <text x="110" y="146" fill="#5f87a6" font-size="14">LATTICE  STABLE   ·   RINGS  3/3 LOCKED</text>
    </g>
    <text id="barlabel" x="1560" y="272" font-family='${mono}' font-size="14" fill="#5f87a6" letter-spacing="3">PLASMA FLUX</text>
    ${bars}
    <!-- callouts follow 3D objects: outer <g> is anchored (attribute transform), inner parts animate (CSS transform) -->
    <g id="c1">
      <circle id="c1dot" r="6" fill="#fff"/>
      <path id="c1line" d="M 0 0 L 110 -70 L 380 -70" fill="none" stroke="#dff6ff" stroke-width="2"/>
      <g id="c1txt" font-family='${mono}' fill="#dff6ff"><text x="124" y="-84" font-size="22" letter-spacing="4">PLASMA LATTICE</text>
        <text x="124" y="-52" font-size="15" fill="#5f87a6" letter-spacing="3">4.2 MK · CONFINED</text></g>
    </g>
    <g id="c2">
      <circle id="c2dot" r="6" fill="#ff7ac0"/>
      <path id="c2line" d="M 0 0 L -90 80 L -330 80" fill="none" stroke="#ff9ad0" stroke-width="2"/>
      <g id="c2txt" font-family='${mono}' fill="#ffd0e8" text-anchor="end"><text x="-110" y="70" font-size="22" letter-spacing="4">ORBITAL NODE 02</text>
        <text x="-110" y="102" font-size="15" fill="#a05c85" letter-spacing="3">PHASE-LOCKED</text></g>
    </g>
    <rect x="360" y="1004" width="1200" height="2" fill="#ffffff" fill-opacity=".12"/>
    <rect id="pbar" x="360" y="1004" width="1200" height="2" fill="#4de2ff" data-origin="left center"/>
  </g>
  <g style="filter: drop-shadow(0 0 14px rgba(120,215,255,.75))">
    <text id="title" data-split x="${CX}" y="905" text-anchor="middle" fill="#f4fbff" font-family='${sans}' font-size="128" font-weight="200" letter-spacing="38">NOVA CORE</text>
  </g>
  <path id="tline" d="M ${CX - 330} 940 H ${CX + 330}" stroke="#4de2ff" stroke-width="2" fill="none"/>
  <text id="sub" x="${CX}" y="985" text-anchor="middle" font-family='${mono}' font-size="24" fill="#8fd8ff" letter-spacing="14">PLASMA-LATTICE REACTOR  ·  GEN 2</text>
</svg>`;

// ───────────────────────────── 3D scene ─────────────────────────────
const CYAN = '#4de2ff', MAGENTA = '#ff3ea5', WARM = '#fff1d6';
const orbit = (n, radius, tilt, color, tube) => ({
  [`tilt${n}`]: { type: 'group', rot: tilt },
  [`spin${n}`]: { type: 'group', parent: `tilt${n}`, scale: 0 },
  [`ring${n}`]: { type: 'torus', parent: `spin${n}`, radius, tube, seg: 220, material: { preset: 'basic', color, glow: 1.7 } },
  [`sat${n}`]: { type: 'sphere', parent: `spin${n}`, radius: 0.075, pos: [radius, 0, 0], material: { preset: 'basic', color: '#ffffff', glow: 3.2 } },
});

const objects = {
  dust:   { type: 'particles', count: 4200, spread: 12, flatten: 0.35, swirl: 0.22, size: 2.8, color: '#7fb8ff', glow: 1.1, opacity: 0, seed: 3 },
  core:   { type: 'icosahedron', radius: 0.95, detail: 2, scale: 0, material: { preset: 'neon', color: CYAN, glow: 0, roughness: 0.25 } },
  glass:  { type: 'sphere', radius: 1.75, scale: 0.6, material: { preset: 'glass', color: '#9fe8ff', opacity: 0 } },
  shell:  { type: 'icosahedron', radius: 1.4, detail: 1, scale: 0, material: { preset: 'wire', color: '#8fe3ff', glow: 1.4, opacity: 0 } },
  ...orbit(1, 2.0, [72, 12, 0], CYAN, 0.014),
  ...orbit(2, 2.6, [-58, 0, 24], MAGENTA, 0.02),
  ...orbit(3, 3.2, [20, 0, -62], '#ffffff', 0.012),
  wave1:  { type: 'ring', inner: 0.965, outer: 1, rot: [-90, 0, 0], scale: 0.1, focus: false, material: { preset: 'additive', color: '#bff3ff', glow: 1.5, opacity: 0, side: 'double' } },
  wave2:  { type: 'ring', inner: 0.975, outer: 1, rot: [-90, 0, 0], scale: 0.1, focus: false, material: { preset: 'additive', color: MAGENTA, glow: 1.3, opacity: 0, side: 'double' } },
  sparks: { type: 'particles', count: 1100, spread: 0.5, swirl: 0.0, size: 3.0, color: '#ffd9a8', glow: 1.8, opacity: 0, seed: 21 },
};

const lights = {
  key:       { type: 'directional', color: '#9fe8ff', intensity: 1.1, pos: [4, 6, 5] },
  rim:       { type: 'point', color: MAGENTA, intensity: 70, pos: [-5, 2, -4] },
  coreLight: { type: 'point', color: CYAN, intensity: 0, pos: [0, 0, 0], decay: 1.4 },
  fill:      { type: 'ambient', color: '#223355', intensity: 0.6 },
};

// ───────────────────────────── score ─────────────────────────────
const E = {
  expo: 'easeOutExpo', io: 'easeInOutSine', cube: 'easeOutCubic', back: 'backOut', lin: 'linear',
};

const score = [
  // — global: fade in from black, fade out at the end (loops cleanly)
  { at: 0,    dur: 1.2, target: 'fx', fade: [1, 0], ease: 'easeOutQuad' },
  { at: 11.2, dur: 0.8, target: 'fx', fade: [0, 1], ease: 'easeInQuad' },

  // — camera: one long orbit + chained dolly, punch-in at the detonation
  { at: 0,    dur: END, target: 'camera', azimuth: [-70, 22], ease: E.io },
  { at: 0,    dur: 5.6, target: 'camera', elevation: [3, 12], distance: [19, 11.5], ease: E.io },
  { at: 5.6,  dur: 1.2, target: 'camera', distance: [11.5, 8.8], ease: 'easeInCubic' },           // anticipation
  { at: BOOM, dur: 2.7, target: 'camera', distance: [8.8, 12.4], ease: E.expo },                  // blast pull-back
  { at: 9.5,  dur: 2.5, target: 'camera', distance: [12.4, 13.8], ease: E.io },
  { at: BOOM, dur: 5.2, target: 'camera', elevation: [12, 7], ease: E.io },
  { at: 5.9,  dur: 2.2, target: 'camera', keys: { fov: [[0, 40], [0.36, 33, 'easeInCubic'], [0.42, 58, E.expo], [1, 42, E.io]] } },
  { at: BOOM, dur: 1.6, target: 'camera', keys: { shake: [[0, 0], [0.06, 8, 'easeOutQuad'], [1, 0, E.expo]] } },

  // — dust field
  { at: 0.2,  dur: 2.5, target: 'dust', opacity: [0, 0.9], ease: E.cube },

  // — core ignites, charges, detonates, then breathes
  { at: 0.9,  dur: 1.2, target: 'core', scale: [0, 1], ease: E.back },
  { at: 0.9,  dur: 1.2, target: 'core', glow: [0, 0.5], ease: E.cube },
  { at: 0.9,  dur: 1.2, target: 'coreLight', intensity: [0, 20], ease: E.cube },
  { at: 5.6,  dur: 1.2, target: 'core', scale: [1, 0.8], glow: [0.5, 2.4], ease: 'easeInCubic' },
  { at: 5.6,  dur: 1.2, target: 'coreLight', intensity: [20, 70], ease: 'easeInCubic' },

  // — detonation: color pop, scale punch, glow/light decay, then a slow breathing loop
  { at: BOOM, dur: 0.3, target: 'core', color: [CYAN, WARM], ease: 'easeOutQuad' },
  { at: BOOM + 0.3, dur: 2.0, target: 'core', color: [WARM, CYAN], ease: E.io },
  { at: BOOM, dur: 0.22, target: 'core', scale: [0.8, 1.4], ease: E.expo },
  { at: BOOM + 0.22, dur: 0.9, target: 'core', scale: [1.4, 1], ease: E.back },
  { at: BOOM, dur: 1.4, target: 'core', glow: [2.4, 0.5], ease: E.cube },
  { at: BOOM, dur: 1.4, target: 'coreLight', intensity: [70, 20], ease: E.cube },
  { at: 8.2,  dur: 'end', target: 'core', scale: [0.97, 1.05], ease: E.io, loop: 'pingpong', every: 1.2 },
  { at: 0,    dur: END, target: 'core', 'rotation.y': [0, 140], 'rotation.x': [0, 50], ease: E.lin },

  // — glass + wire shell assemble, kick on detonation
  { at: 1.6,  dur: 1.4, target: 'glass', scale: [0.6, 1], opacity: [0, 0.16], ease: E.expo },
  { at: 1.4,  dur: 1.4, target: 'shell', scale: [0, 1], opacity: [0, 0.5], ease: E.expo },
  { at: BOOM, dur: 0.35, target: 'shell', scale: [1, 1.3], ease: E.expo },
  { at: BOOM + 0.35, dur: 1.3, target: 'shell', scale: [1.3, 1], ease: 'easeInOutCubic' },
  { at: 0,    dur: END, target: 'shell', 'rotation.y': [0, 200], 'rotation.x': [0, 60], ease: E.lin },

  // — orbit rings: staggered reveal, constant spin (different speeds), shock on detonation
  { at: 2.0,  dur: 1.5, target: ['spin1', 'spin2', 'spin3'], stagger: 0.35, scale: [0, 1], opacity: [0, 1], ease: E.expo },
  { at: BOOM, dur: 0.5, target: ['spin1', 'spin2', 'spin3'], stagger: 0.08, scale: [1, 1.25], ease: E.expo },
  { at: BOOM + 0.5, dur: 1.6, target: ['spin1', 'spin2', 'spin3'], stagger: 0.08, scale: [1.25, 1], ease: 'easeInOutCubic' },
  { at: 0, dur: END, target: 'spin1', 'rotation.z': [0, 360], ease: E.lin },
  { at: 0, dur: END, target: 'spin2', 'rotation.z': [0, -540], ease: E.lin },
  { at: 0, dur: END, target: 'spin3', 'rotation.z': [0, 720], ease: E.lin },
  { at: BOOM, dur: 1.0, target: 'rim', intensity: [70, 200], ease: E.expo },
  { at: BOOM + 1.0, dur: 2.0, target: 'rim', intensity: [200, 70], ease: E.io },

  // — shockwaves + sparks
  { at: BOOM, dur: 2.0, target: 'wave1', scale: [0.1, 13], ease: E.expo },
  { at: BOOM, dur: 2.0, target: 'wave1', keys: { opacity: [[0, 0], [0.02, 0.95, 'linear'], [1, 0, 'easeOutQuad']] } },
  { at: BOOM + 0.22, dur: 2.2, target: 'wave2', scale: [0.1, 19], ease: E.expo },
  { at: BOOM + 0.22, dur: 2.2, target: 'wave2', keys: { opacity: [[0, 0], [0.02, 0.8, 'linear'], [1, 0, 'easeInQuad']] } },
  { at: BOOM, dur: 2.8, target: 'sparks', burst: [0, 17], ease: E.expo },
  { at: BOOM, dur: 2.8, target: 'sparks', keys: { opacity: [[0, 0], [0.04, 1, 'easeOutQuad'], [1, 0, 'easeInQuad']] } },

  // — post fx: bloom swells on charge-up, white flash on the hit
  { at: 5.6,  dur: 1.2, target: 'fx', bloom: [0.35, 0.7], ease: 'easeInCubic' },
  { at: BOOM, dur: 2.2, target: 'fx', bloom: [0.7, 0.38], ease: E.cube },
  { at: BOOM, dur: 1.0, target: 'fx', keys: { flash: [[0, 0], [0.05, 0.5, 'easeOutQuad'], [1, 0, E.cube]] } },

  // ───────── HUD (SVG) ─────────
  { at: 3.0,  dur: 0.9, target: '.bracket', stagger: 0.1, draw: [0, 1], ease: E.cube },
  { at: 3.2,  dur: 1.7, target: '#r1', draw: [0, 1], ease: 'easeInOutCubic' },
  { at: 3.4,  dur: 1.9, target: '#r2', draw: [0, 1], ease: 'easeInOutCubic' },
  { at: 3.6,  dur: 0.4, target: '.tick', stagger: 0.012, opacity: [0, 0.75], ease: E.cube },
  { at: 3.6,  dur: 'end', target: '#ticks', rotate: [0, 40], ease: E.lin },
  { at: 3.4,  dur: 0.8, target: '#tl', opacity: [0, 1], x: [-24, 0], ease: E.expo },
  { at: 3.6,  dur: 0.5, target: '#barlabel', opacity: [0, 1], ease: E.cube },
  { at: 3.6,  dur: 0.5, target: '.bar', stagger: 0.03, opacity: [0, 0.85], ease: E.cube },
  ...barH.flatMap((h, i) => [
    { at: 3.6 + i * 0.03, dur: 0.9, target: `#bar${i}`, scaleY: [0.04, h], ease: E.expo },
    { at: 4.6 + i * 0.03, dur: 'end', target: `#bar${i}`, scaleY: [h, h * 0.35], ease: E.io, loop: 'pingpong', every: 0.45 + (i % 5) * 0.13 },
  ]),
  // callouts: dot pops, leader line draws, label slides in
  { at: 4.2,  dur: 0.5, target: '#c1dot', scale: [0, 1], ease: E.back },
  { at: 4.4,  dur: 0.8, target: '#c1line', draw: [0, 1], ease: 'easeInOutCubic' },
  { at: 5.0,  dur: 0.7, target: '#c1txt', opacity: [0, 1], x: [-14, 0], ease: E.expo },
  { at: 4.9,  dur: 0.5, target: '#c2dot', scale: [0, 1], ease: E.back },
  { at: 5.1,  dur: 0.8, target: '#c2line', draw: [0, 1], ease: 'easeInOutCubic' },
  { at: 5.7,  dur: 0.7, target: '#c2txt', opacity: [0, 1], x: [14, 0], ease: E.expo },
  // the HUD stutters when the core detonates
  { at: BOOM, dur: 0.9, target: '#hud', keys: { opacity: [[0, 1], [0.08, 0.15, 'linear'], [0.18, 1, 'linear'], [0.3, 0.4, 'linear'], [0.42, 1, 'linear'], [1, 1, 'linear']] } },
  { at: 0,    dur: END, target: '#pbar', scaleX: [0, 1], ease: E.lin },

  // ───────── title ─────────
  { at: 7.1,  dur: 1.2, target: '#title .ch', stagger: 0.075, opacity: [0, 1], y: [56, 0], blur: [18, 0], ease: E.expo },
  { at: 8.0,  dur: 1.0, target: '#tline', draw: [0, 1], ease: 'easeInOutCubic' },
  { at: 8.3,  dur: 0.9, target: '#sub', opacity: [0, 1], y: [14, 0], ease: E.expo },
];

createMotion({
  size: [W, H],
  duration: END,
  camera: { azimuth: -70, elevation: 3, distance: 19, fov: 40, lookAt: [0, -0.75, 0] },
  background: ['#14224a', '#04060e'],
  bloom: { strength: 0.35, radius: 0.5, threshold: 0.9 },
  vignette: 0.55,
  objects, lights, svg,
  anchors: { '#c1': { to: 'core', offset: [1.0, 0.9, 0] }, '#c2': { to: 'sat2' } },
  score,
}).then((m) => attachReview(m));
