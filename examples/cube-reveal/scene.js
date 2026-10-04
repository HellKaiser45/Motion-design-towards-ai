/**
 * CU-13 · BOOT SEQUENCE — 10 s cinematic. The cube is a CHARACTER: an animated face
 * lives on its front face (live SVG decal). ~100% declarative: objects + SVG + a flat score.
 * Beats:  0–0.9 fade from black · 0.7–2.2 cube materializes · 2.0 WAKE (flash/light/shake)
 *         1.9–3.0 face boots, eyes open · 2.6–4.2 holo rings · 3.8 nametag · 4.6–6.0 bow
 *         6.0–7.2 talk · 7.2–8.6 title · 8.6–10 settle & fade (loops cleanly)
 */
import { createMotion, rng, range } from 'agent-stage/kit/index.js';
import { attachReview } from 'agent-stage/kit/review.js';

const W = 1920, H = 1080, CX = W / 2, CY = H / 2;
const WAKE = 2.0;

// ───────────────────────────── the FACE (live decal, 200×140 design space) ─────────────────────────
const monoFace = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const faceSvg = `<svg viewBox="0 0 200 140">
  <defs>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="screenbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0e1626"/>
      <stop offset="1" stop-color="#070b14"/>
    </linearGradient>
  </defs>

  <rect width="200" height="140" rx="10" fill="url(#screenbg)"/>

  <g filter="url(#glow)">
    <g id="eyeL"><rect x="48" y="36" width="22" height="32" rx="10" fill="#22d3ee"/></g>
    <g id="eyeR"><rect x="130" y="36" width="22" height="32" rx="10" fill="#22d3ee"/></g>
  </g>

  <g id="m-neutral" opacity="1">
    <rect x="84" y="97" width="32" height="6" rx="3" fill="#22d3ee" opacity="0.92"/>
  </g>

  <g id="m-smile" opacity="0">
    <path d="M70 98 Q100 122 130 98" fill="none" stroke="#22d3ee" stroke-width="6" stroke-linecap="round"/>
  </g>

  <g id="m-grin" opacity="0">
    <path d="M72 92 Q100 126 128 92 Q100 106 72 92 Z" fill="#22d3ee" opacity="0.95"/>
    <rect x="78" y="84" width="10" height="5" rx="2.5" fill="#22d3ee" opacity="0.5"/>
    <rect x="112" y="84" width="10" height="5" rx="2.5" fill="#22d3ee" opacity="0.5"/>
  </g>

  <g id="m-talk" opacity="0">
    <path d="M86 94 Q100 118 114 94 Q100 104 86 94 Z" fill="#22d3ee" opacity="0"/>
    <path d="M84 98 Q100 106 116 98" fill="none" stroke="#22d3ee" stroke-width="6" stroke-linecap="round" opacity="1"/>
  </g>

  <g id="m-surprise" opacity="0">
    <ellipse cx="100" cy="100" rx="11" ry="13" fill="none" stroke="#22d3ee" stroke-width="6"/>
  </g>

  <g id="m-boot" opacity="0">
    <rect x="6" y="10" width="188" height="120" rx="8" fill="#070b14" opacity="0.92"/>
    <text x="20" y="38" font-family='${monoFace}' font-size="13" fill="#22d3ee" letter-spacing="2">CU-13 BOOT v2.3</text>
    <text x="20" y="58" font-family='${monoFace}' font-size="10" fill="#5f7d9c" letter-spacing="1">loading persona modules…</text>
    <rect x="20" y="72" width="160" height="5" rx="2.5" fill="#12283c"/>
    <rect x="20" y="72" width="104" height="5" rx="2.5" fill="#22d3ee"/>
    <rect x="6" y="18" width="188" height="4" fill="#22d3ee" opacity="0.8"/>
  </g>
</svg>`;

// ───────────────────────────── SVG HUD (design coords = 1920×1080) ─────────────────────────
const bracket = (id, d) => `<path id="${id}" class="bracket" d="${d}" fill="none" stroke="#dff6ff" stroke-width="2.5" stroke-linecap="square"/>`;
const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const sans = 'Helvetica Neue, Helvetica, Arial, sans-serif';

const svg = `<svg viewBox="0 0 ${W} ${H}">
  <g id="hud">
    ${bracket('b1', 'M 70 130 V 70 H 130')}${bracket('b2', `M ${W - 130} 70 H ${W - 70} V 130`)}
    ${bracket('b3', `M 70 ${H - 130} V ${H - 70} H 130`)}${bracket('b4', `M ${W - 130} ${H - 70} H ${W - 70} V ${H - 130}`)}
    <g id="tele" font-family='${mono}' font-size="17" fill="#9fe8ff" letter-spacing="3">
      <text x="110" y="118">CU-13 // BOOT TELEMETRY</text>
      <text x="110" y="146" fill="#5f87a6" font-size="14">CORE  NOMINAL   ·   PERSONA  LOADED   ·   RINGS  3/3</text>
    </g>
    <!-- nametag follows the cube on screen; inner parts animate -->
    <g id="nametag">
      <rect id="npill" x="-128" y="-44" width="256" height="52" rx="26" fill="#0b1626" fill-opacity="0.85" stroke="#22d3ee" stroke-opacity="0.55" stroke-width="1.5"/>
      <text id="ntxt" x="0" y="-8" text-anchor="middle" font-family='${mono}' font-size="21" fill="#bdf3ff" letter-spacing="5">CU-13 · ONLINE</text>
    </g>
  </g>
  <g style="filter: drop-shadow(0 0 16px rgba(120,215,255,.75))">
    <text id="title" data-split x="${CX}" y="880" text-anchor="middle" fill="#f4fbff" font-family='${sans}' font-size="150" font-weight="200" letter-spacing="44">CU-13</text>
  </g>
  <path id="tline" d="M ${CX - 280} 916 H ${CX + 280}" stroke="#22d3ee" stroke-width="2" fill="none"/>
  <text id="sub" x="${CX}" y="966" text-anchor="middle" font-family='${mono}' font-size="24" fill="#8fd8ff" letter-spacing="14">AUTONOMOUS AGENT · ONLINE</text>
</svg>`;

// ───────────────────────────── 3D scene ─────────────────────────
const CYAN = '#22d3ee', VIOLET = '#a78bfa';
const r = rng(7);

const objects = {
  cube:  { type: 'box', size: 1.5, scale: 0, material: { preset: 'neon', color: CYAN, glow: 0.5, roughness: 0.3 } },
  face:  { type: 'decal', svg: faceSvg, width: 1.35, height: 0.95, pos: [0, 0, 0.76], res: 512, parent: 'cube', opacity: 0 },
  glass: { type: 'sphere', radius: 1.9, material: { preset: 'glass', color: '#9fe8ff', opacity: 0.08 } },

  tilt1: { type: 'group', rot: [72, 12, 0] },
  spin1: { type: 'group', parent: 'tilt1', scale: 0 },
  ring1: { type: 'torus', parent: 'spin1', radius: 2.0, tube: 0.014, seg: 220, material: { preset: 'basic', color: CYAN, glow: 1.6 } },

  tilt2: { type: 'group', rot: [-58, 0, 24] },
  spin2: { type: 'group', parent: 'tilt2', scale: 0 },
  ring2: { type: 'torus', parent: 'spin2', radius: 2.55, tube: 0.02, seg: 220, material: { preset: 'basic', color: VIOLET, glow: 1.6 } },

  tilt3: { type: 'group', rot: [20, 0, -62] },
  spin3: { type: 'group', parent: 'tilt3', scale: 0 },
  ring3: { type: 'torus', parent: 'spin3', radius: 3.1, tube: 0.012, seg: 220, material: { preset: 'basic', color: '#ffffff', glow: 1.4 } },

  dust:   { type: 'particles', count: 3000, spread: 11, flatten: 0.4, swirl: 0.15, size: 2.4, color: '#7fb8ff', glow: 1.1, opacity: 0, seed: 5 },
  sparks: { type: 'particles', count: 900, spread: 0.4, swirl: 0.0, size: 3.0, color: '#aef4ff', glow: 1.8, opacity: 0, seed: 19 },
};

const lights = {
  key:       { type: 'directional', color: '#dff5ff', intensity: 1.1, pos: [4, 6, 5] },
  rim:       { type: 'point', color: VIOLET, intensity: 40, pos: [-5, 2, -4] },
  coreLight: { type: 'point', color: CYAN, intensity: 0, pos: [0, 0, 0.4], decay: 1.4 },
  fill:      { type: 'ambient', color: '#223355', intensity: 0.5 },
};

// ───────────────────────────── score ─────────────────────────────
const E = {
  expo: 'easeOutExpo', io: 'easeInOutSine', cube: 'easeOutCubic', back: 'backOut',
  quad: 'easeOutQuad', lin: 'linear', inout: 'easeInOutCubic',
};

const score = [
  // — global: fade in from black, fade out at the end (loops cleanly)
  { at: 0,    dur: 0.9, target: 'fx', fade: [1, 0], ease: 'easeOutQuad' },
  { at: 9.3,  dur: 0.7, target: 'fx', fade: [0, 1], ease: 'easeInQuad' },

  // — camera: long orbit, chained dolly, elevation drift, fov punch at the wake
  { at: 0,    dur: 10,  target: 'camera', azimuth: [-38, 34], elevation: [5, 13], ease: E.io },
  { at: 0,    dur: 4.2, target: 'camera', distance: [10, 6.4], ease: E.io },
  { at: 8.6,  dur: 1.4, target: 'camera', distance: [6.4, 8.6], elevation: [13, 17], ease: E.io },
  { at: WAKE, dur: 0.9, target: 'camera', keys: { fov: [[0, 38], [0.05, 34.5, 'easeOutQuad'], [1, 38, E.io]] } },
  { at: WAKE, dur: 0.7, target: 'camera', keys: { shake: [[0, 0], [0.08, 5, 'easeOutQuad'], [1, 0, E.expo]] } },

  // — dust field
  { at: 0.15, dur: 1.6, target: 'dust', opacity: [0, 0.85], ease: E.cube },

  // — cube materializes: scale + settle spin (face decal rides along, hidden)
  { at: 0.7,  dur: 1.5, target: 'cube', scale: [0, 1], ease: E.back },
  { at: 0.7,  dur: 1.5, target: 'cube', 'rotation.y': [210, 0], ease: E.cube },
  // 72° = the camera's azimuth sweep (-38→34): the character keeps its face
  // pointed at the audience for the whole piece instead of turning away.
  { at: 2.2,  dur: 'end', target: 'cube', 'rotation.y': [0, 72], ease: E.lin },
  { at: 8.6,  dur: 'end', target: 'cube', scale: [0.99, 1.02], ease: E.io, loop: 'pingpong', every: 1.4 },

  // ───────── WAKE at 2.0: flash + light burst + bloom pulse + sparks, all together ─────────
  { at: WAKE, dur: 0.9, target: 'fx', keys: { flash: [[0, 0], [0.05, 0.35, 'easeOutQuad'], [1, 0, E.cube]] } },
  { at: WAKE, dur: 1.4, target: 'coreLight', keys: { intensity: [[0, 0], [0.06, 28, 'easeOutQuad'], [0.5, 12, E.cube], [1, 4, E.io]] } },
  { at: WAKE, dur: 1.6, target: 'fx', keys: { bloom: [[0, 0.3], [0.08, 0.6, 'easeOutQuad'], [1, 0.4, E.cube]] } },
  { at: WAKE, dur: 1.1, target: 'sparks', burst: [0, 10], ease: E.expo },
  { at: WAKE, dur: 1.1, target: 'sparks', keys: { opacity: [[0, 0], [0.05, 1, 'easeOutQuad'], [1, 0, 'easeInQuad']] } },

  // — face boots: boot overlay shows, then fades; eyes pop open; neutral mouth on
  { at: 1.9,  dur: 0.4, target: 'face #m-boot', opacity: [0, 1], ease: E.quad },
  { at: 1.9,  dur: 0.4, target: 'face', opacity: [0, 1], ease: E.quad },
  { at: 2.6,  dur: 0.4, target: 'face #m-boot', opacity: [1, 0], ease: 'easeInQuad' },
  { at: 2.6,  dur: 0.4, target: 'face #eyeL', scaleY: [0, 1], ease: E.back },
  { at: 2.6,  dur: 0.4, target: 'face #eyeR', scaleY: [0, 1], ease: E.back },

  // — holo rings: staggered reveal, then spin forever at different speeds
  { at: 2.6,  dur: 1.0, target: ['spin1', 'spin2', 'spin3'], stagger: 0.4, scale: [0, 1], ease: E.expo },
  { at: 0,    dur: 10,  target: 'spin1', 'rotation.z': [0, 260], ease: E.lin },
  { at: 0,    dur: 10,  target: 'spin2', 'rotation.z': [0, -340], ease: E.lin },
  { at: 0,    dur: 10,  target: 'spin3', 'rotation.z': [0, 460], ease: E.lin },

  // — nametag: pill pops in above the cube, text slides up
  { at: 3.8,  dur: 0.5, target: '#npill', opacity: [0, 1], scaleY: [0.4, 1], ease: E.back },
  { at: 3.95, dur: 0.55, target: '#ntxt', opacity: [0, 1], y: [10, 0], ease: E.expo },

  // ───────── GREET 4.6–6.0: the bow, mouth crossfade, one blink ─────────
  { at: 4.6,  dur: 1.2, target: 'cube', keys: { 'rotation.x': [[0, 0], [0.35, -0.32, E.cube], [0.6, -0.32, E.lin], [1, 0, E.inout]] } },
  { at: 4.7,  dur: 0.3, target: 'face #m-neutral', opacity: [1, 0], ease: 'easeInQuad' },
  { at: 4.9,  dur: 0.3, target: 'face #m-smile', opacity: [0, 1], ease: E.quad },
  { at: 5.4,  dur: 0.3, target: 'face #eyeL', keys: { scaleY: [[0, 1], [0.5, 0.06, 'easeInQuad'], [1, 1, 'easeOutQuad']] } },
  { at: 5.4,  dur: 0.3, target: 'face #eyeR', keys: { scaleY: [[0, 1], [0.5, 0.06, 'easeInQuad'], [1, 1, 'easeOutQuad']] } },

  // ───────── TALK 6.0–7.2: mouth flaps (pingpong), then back to smile ─────────
  { at: 6.0,  dur: 0.2, target: 'face #m-smile', opacity: [1, 0], ease: 'easeInQuad' },
  { at: 6.2,  dur: 1.0, target: 'face #m-talk', opacity: [0.15, 1], ease: 'linear', loop: 'pingpong', every: 0.22 },
  { at: 7.2,  dur: 0.25, target: 'face #m-talk', opacity: [1, 0], ease: 'easeInQuad' },
  { at: 7.45, dur: 0.25, target: 'face #m-smile', opacity: [0, 1], ease: E.quad },

  // — HUD draws on during the talk beat
  { at: 6.0,  dur: 0.9, target: '.bracket', stagger: 0.1, draw: [0, 1], ease: E.cube },
  { at: 6.2,  dur: 0.8, target: '#tele', opacity: [0, 1], x: [-24, 0], ease: E.expo },

  // ───────── TITLE 7.2–8.6 ─────────
  { at: 7.2,  dur: 1.1, target: '#title .ch', stagger: 0.08, opacity: [0, 1], y: [56, 0], blur: [18, 0], ease: E.expo },
  { at: 8.0,  dur: 0.8, target: '#tline', draw: [0, 1], ease: E.inout },
  { at: 8.2,  dur: 0.7, target: '#sub', opacity: [0, 1], y: [14, 0], ease: E.expo },

  // — final settle: rings pulse gently, bloom calms
  { at: 8.6,  dur: 1.4, target: ['spin1', 'spin2', 'spin3'], stagger: 0.2, scale: [1, 1.06], ease: E.io, loop: 'pingpong', every: 0.9 },
  { at: 8.6,  dur: 1.4, target: 'fx', bloom: [0.4, 0.3], ease: E.io },
];

createMotion({
  size: [W, H],
  duration: 10,
  camera: { azimuth: -38, elevation: 5, distance: 10, fov: 38, lookAt: [0, 0.1, 0] },
  background: ['#0d1b33', '#04060e'],
  bloom: { strength: 0.3, radius: 0.5, threshold: 0.9 },
  vignette: 0.5,
  objects, lights, svg,
  anchors: { '#nametag': { to: 'cube', offset: [0, 1.35, 0] } },
  score,
}).then((m) => attachReview(m));
