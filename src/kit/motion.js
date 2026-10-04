/**
 * @module agent-stage/kit/motion
 * Standalone declarative motion-design layer over Three.js + an SVG overlay.
 * Pure functions of logical time everywhere: render(t) is fully deterministic
 * (seek-safe, export-safe). No wall-clock state enters the render path.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { applyEasing, assertEasing } from '../core/easing.js';

/** mulberry32 — deterministic PRNG returning floats in [0,1). */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @returns {Array} length-n array of fn(i) */
export const range = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

const D2R = Math.PI / 180;
const RESERVED = new Set(['at', 'dur', 'target', 'stagger', 'ease', 'loop', 'every', 'keys']);

const OBJECT_PROPS = new Set([
  'scale', 'scaleX', 'scaleY', 'scaleZ', 'opacity', 'glow', 'burst', 'intensity', 'color',
  'rotation.x', 'rotation.y', 'rotation.z', 'position.x', 'position.y', 'position.z',
]);
const CAMERA_PROPS = new Set(['azimuth', 'elevation', 'distance', 'fov', 'shake']);
const FX_PROPS = new Set(['fade', 'flash', 'bloom']);
const SVG_PROPS = new Set(['opacity', 'x', 'y', 'rotate', 'scale', 'scaleX', 'scaleY', 'blur', 'draw']);

/** deterministic per-axis hash noise (pure function of t) for camera shake */
function hash1(n, s) {
  const x = Math.sin(n * 127.1 + s * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const PARTICLE_VERT = /* glsl */ `
uniform float uTime;
uniform float uSwirl;
uniform float uBurst;
uniform float uSize;
attribute float aRand;
varying float vRand;
void main() {
  vec3 pos = position;
  float a = uSwirl * uTime;
  float c = cos(a), s = sin(a);
  pos = vec3(c * pos.x - s * pos.z, pos.y, s * pos.x + c * pos.z);
  pos *= (1.0 + uBurst * aRand);
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = uSize * (150.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  vRand = aRand;
}`;

const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vRand;
void main() {
  float a = smoothstep(0.5, 0.08, length(gl_PointCoord - 0.5)) * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y / 60.0 * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(uBottom, uTop, h), 1.0);
}`;

/**
 * Build the motion system from a declarative spec.
 * @param {object} spec
 * @returns {Promise<Motion>}
 */
export async function createMotion(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('[motion] createMotion() requires a spec object');
  }
  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    console.warn(msg);
  };

  const [DW, DH] = spec.size ?? [1280, 720];
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const capture = params.has('capture');
  let [RW, RH] = [DW, DH];
  const sizeParam = params.get('size');
  if (sizeParam) {
    const m = /^(\d+)x(\d+)$/.exec(sizeParam);
    if (m) [RW, RH] = [Number(m[1]), Number(m[2])];
    else warn(`[motion] ignoring malformed size param "${sizeParam}" (expected WxH)`);
  }

  // ---------- duration ----------
  let duration = typeof spec.duration === 'number' ? spec.duration : null;
  if (spec.score) {
    for (const cue of spec.score) {
      if (typeof cue?.dur === 'number' && typeof cue?.at === 'number') {
        duration ??= 0;
        duration = Math.max(duration, cue.at + cue.dur);
      }
    }
  }
  if (duration == null) throw new Error('[motion] "duration" required when no cue has a numeric dur');

  // ---------- DOM scaffold ----------
  const root = document.getElementById('agent-stage-root') ?? document.createElement('div');
  root.id = 'agent-stage-root';
  Object.assign(root.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
  document.body.appendChild(root);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: capture,
  });
  renderer.setPixelRatio(capture ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(RW, RH);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(spec.camera?.fov ?? 40, RW / RH, 0.1, 500);
  const camState = {
    azimuth: spec.camera?.azimuth ?? 0,
    elevation: spec.camera?.elevation ?? 0,
    distance: spec.camera?.distance ?? 8,
    fov: spec.camera?.fov ?? 40,
    lookAt: [...(spec.camera?.lookAt ?? [0, 0, 0])],
    shake: 0,
  };

  // ---------- background gradient dome ----------
  const bg = Array.isArray(spec.background) ? spec.background : ['#1a2a52', '#05070f'];
  const topC = new THREE.Color(Array.isArray(bg) ? bg[0] : bg);
  const botC = new THREE.Color(Array.isArray(bg) ? bg[1] : bg);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: { uTop: { value: topC }, uBottom: { value: botC } },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // ---------- lights ----------
  const named = new Map(); // name -> { kind:'obj'|'light', node, type, ... }
  for (const [name, def] of Object.entries(spec.lights ?? {})) {
    const color = new THREE.Color(def.color ?? '#ffffff');
    let light;
    switch (def.type) {
      case 'directional': light = new THREE.DirectionalLight(color, def.intensity ?? 1); break;
      case 'point': {
        light = new THREE.PointLight(color, def.intensity ?? 1, 0, def.decay ?? 2);
        break;
      }
      case 'ambient': light = new THREE.AmbientLight(color, def.intensity ?? 1); break;
      default: throw new Error(`[motion] light "${name}" has unknown type "${def.type}"`);
    }
    if (def.pos) light.position.set(...def.pos);
    scene.add(light);
    named.set(name, { kind: 'light', node: light, type: def.type });
  }

  // ---------- objects (pass 1: create nodes, pass 2: link parents) ----------
  function makeMaterial(def) {
    const m = def.material ?? {};
    const base = new THREE.Color(m.color ?? '#ffffff');
    const glow = m.glow ?? 0;
    const opacity = m.opacity;
    let mat;
    switch (m.preset) {
      case 'basic':
        mat = new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(Math.max(1, glow)) });
        mat.toneMapped = false;
        break;
      case 'wire':
        mat = new THREE.MeshBasicMaterial({ color: base, wireframe: true });
        break;
      case 'glass':
        mat = new THREE.MeshStandardMaterial({
          color: base, transparent: true, opacity: opacity ?? 0.2, roughness: 0.15, metalness: 0.6,
        });
        break;
      case 'additive':
        mat = new THREE.MeshBasicMaterial({
          color: base, transparent: true, blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide, depthWrite: false,
        });
        break;
      case 'neon':
      default:
        mat = new THREE.MeshStandardMaterial({
          color: base, emissive: base, emissiveIntensity: glow,
          roughness: m.roughness ?? def.roughness ?? 0.4, metalness: 0.15,
        });
        break;
    }
    if (opacity != null) {
      mat.transparent = true;
      mat.opacity = opacity;
    }
    if (m.side === 'double' && m.preset !== 'additive') mat.side = THREE.DoubleSide;
    return { mat, base, glow, preset: m.preset ?? 'neon' };
  }

  function makeObject(name, def) {
    const entry = { kind: 'obj', node: null, type: def.type, mat: null };
    switch (def.type) {
      case 'group': {
        entry.node = new THREE.Group();
        break;
      }
      case 'particles': {
        const rand = rng(def.seed ?? 1);
        const count = def.count ?? 1000;
        const spread = def.spread ?? 5;
        const flatten = def.flatten ?? 1;
        const pos = new Float32Array(count * 3);
        const aRand = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          let x, y, z;
          do {
            x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1;
          } while (x * x + y * y + z * z > 1);
          pos[i * 3] = x * spread;
          pos[i * 3 + 1] = y * spread * flatten;
          pos[i * 3 + 2] = z * spread;
          aRand[i] = rand();
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));
        const base = new THREE.Color(def.color ?? '#ffffff');
        const uniforms = {
          uColor: { value: base.clone().multiplyScalar(Math.max(1, def.glow ?? 1)) },
          uSize: { value: def.size ?? 2.2 },
          uOpacity: { value: def.opacity ?? 1 },
          uSwirl: { value: def.swirl ?? 0 },
          uBurst: { value: 0 },
          uTime: { value: 0 },
        };
        const mat = new THREE.ShaderMaterial({
          uniforms,
          vertexShader: PARTICLE_VERT,
          fragmentShader: PARTICLE_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        entry.node = new THREE.Points(geo, mat);
        entry.mat = { uniforms, base, glow: def.glow ?? 1 };
        break;
      }
      default: {
        let geo;
        switch (def.type) {
          case 'icosahedron': geo = new THREE.IcosahedronGeometry(def.radius ?? 1, def.detail ?? 2); break;
          case 'torus': geo = new THREE.TorusGeometry(def.radius, def.tube, 32, def.seg ?? 220); break;
          case 'sphere': geo = new THREE.SphereGeometry(def.radius, 48, 32); break;
          case 'ring': geo = new THREE.RingGeometry(def.inner, def.outer, 64); break;
          default: throw new Error(`[motion] object "${name}" has unknown type "${def.type}"`);
        }
        const { mat, base, glow, preset } = makeMaterial(def);
        entry.node = new THREE.Mesh(geo, mat);
        entry.baseColor = base;
        entry.glow = glow;
        entry.preset = preset;
        break;
      }
    }
    if (def.pos) entry.node.position.set(...def.pos);
    if (def.rot) entry.node.rotation.set(def.rot[0] * D2R, def.rot[1] * D2R, def.rot[2] * D2R);
    if (def.scale != null) entry.node.scale.setScalar(def.scale);
    return entry;
  }

  for (const [name, def] of Object.entries(spec.objects ?? {})) {
    named.set(name, makeObject(name, def));
  }
  for (const [name, entry] of named) {
    if (entry.kind !== 'obj') continue;
    const def = spec.objects[name];
    if (def.parent) {
      const parent = named.get(def.parent);
      if (!parent) throw new Error(`[motion] object "${name}" references unknown parent "${def.parent}"`);
      parent.node.add(entry.node);
    } else {
      scene.add(entry.node);
    }
  }

  // ---------- SVG layer ----------
  let svgRoot = null;
  const svgStates = new Map(); // element -> state
  if (spec.svg != null) {
    // HTML parser on purpose: forgiving (bare attributes, no xmlns needed) —
    // what LLM-written SVG needs.
    const tpl = document.createElement('template');
    tpl.innerHTML = spec.svg.trim();
    svgRoot = tpl.content.querySelector('svg');
    if (!svgRoot) throw new Error('[motion] "svg" must contain an <svg> root element');
    if (!svgRoot.getAttribute('viewBox')) svgRoot.setAttribute('viewBox', `0 0 ${DW} ${DH}`);

    const overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    svgRoot.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svgRoot.setAttribute('width', '100%');
    svgRoot.setAttribute('height', '100%');
    overlay.appendChild(svgRoot);
    root.appendChild(overlay);

    // data-split: one <tspan class="ch"> per character
    for (const text of svgRoot.querySelectorAll('[data-split]')) {
      const chars = [...text.textContent];
      text.textContent = '';
      for (const ch of chars) {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('class', 'ch');
        tspan.textContent = ch === ' ' ? '\u00A0' : ch;
        text.appendChild(tspan);
      }
    }

    // data-origin: per-element transform-origin (default = fill-box center)
    const KEY = { left: '0%', right: '100%', center: '50%', top: '0%', bottom: '100%' };
    for (const el of svgRoot.querySelectorAll('*')) {
      el.style.transformBox = 'fill-box';
      const raw = el.getAttribute('data-origin');
      if (raw) {
        const [hx, vy] = raw.trim().split(/\s+/);
        el.style.transformOrigin = `${KEY[hx] ?? '50%'} ${KEY[vy] ?? '50%'}`;
      } else {
        el.style.transformOrigin = '50% 50%';
      }
    }

    for (const el of svgRoot.querySelectorAll('*')) {
      svgStates.set(el, { el, x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1, blur: 0, opacity: null, draw: null, drawLen: null });
    }
  } else if (spec.anchors) {
    warn('[motion] "anchors" given but no "svg" — anchors ignored');
  }

  // ---------- anchors ----------
  const anchors = [];
  for (const [selector, a] of Object.entries(spec.anchors ?? {})) {
    const el = svgRoot?.querySelector(selector);
    if (!el) {
      warn(`[motion] anchor "${selector}" matched no SVG element — skipped`);
      continue;
    }
    const to = named.get(a.to);
    if (!to) {
      warn(`[motion] anchor "${selector}" references unknown object "${a.to}" — skipped`);
      continue;
    }
    anchors.push({ el, to, offset: a.offset ?? [0, 0, 0] });
  }

  // ---------- post chain ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(RW, RH),
    spec.bloom?.strength ?? 0.35,
    spec.bloom?.radius ?? 0.4,
    spec.bloom?.threshold ?? 0.92
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setSize(RW, RH);

  // ---------- fx overlays (on top of the svg) ----------
  const vignette = document.createElement('div');
  const v = Math.min(1, Math.max(0, spec.vignette ?? 0));
  Object.assign(vignette.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none',
    background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${v}) 100%)`,
  });
  const fadeEl = document.createElement('div');
  Object.assign(fadeEl.style, { position: 'absolute', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none' });
  const flashEl = document.createElement('div');
  Object.assign(flashEl.style, { position: 'absolute', inset: '0', background: '#fff', opacity: '0', pointerEvents: 'none' });
  root.append(vignette, fadeEl, flashEl);

  const fxState = { fade: 0, flash: 0, bloom: spec.bloom?.strength ?? 0.35 };

  // ---------- compile the score ----------
  function resolveTarget(target) {
    if (named.has(target)) return [named.get(target)];
    if (target === 'camera') return [camState];
    if (target === 'fx') return [fxState];
    if (!svgRoot) {
      warn(`[motion] unknown target "${target}" (no svg layer) — skipped`);
      return [];
    }
    const els = [...svgRoot.querySelectorAll(target)];
    if (!els.length) warn(`[motion] selector "${target}" matched 0 SVG elements — skipped`);
    return els.map((el) => svgStates.get(el));
  }

  function parseValue(prop, raw, where) {
    if (Array.isArray(raw)) {
      const [from, to, pairEase] = raw;
      if (pairEase !== undefined) assertEasing(pairEase, where);
      if (prop === 'color') {
        return { from: new THREE.Color(from), to: new THREE.Color(to), ease: pairEase };
      }
      if (typeof from !== 'number' || typeof to !== 'number') {
        throw new Error(`[motion] ${where}: prop "${prop}" pair values must be numbers`);
      }
      return { from, to, ease: pairEase };
    }
    throw new Error(`[motion] ${where}: prop "${prop}" needs a [from, to] pair (or "keys")`);
  }

  function evalKeys(keys, p) {
    const kfs = keys;
    if (p <= kfs[0][0]) return kfs[0][1];
    const last = kfs[kfs.length - 1];
    if (p >= last[0]) return last[1];
    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1][0] <= p) i++;
    const a = kfs[i];
    const b = kfs[i + 1];
    const raw = (p - a[0]) / (b[0] - a[0]);
    return a[1] + (b[1] - a[1]) * applyEasing(b[2], raw);
  }

  // groups: Map<stateRef, Map<prop, tracks[]>>
  const groups = new Map();
  function groupFor(ref) {
    let g = groups.get(ref);
    if (!g) {
      g = new Map();
      groups.set(ref, g);
    }
    return g;
  }

  for (const cue of spec.score ?? []) {
    if (!cue || typeof cue !== 'object' || Array.isArray(cue)) {
      throw new Error('[motion] score cue must be an object');
    }
    if (typeof cue.at !== 'number' || Number.isNaN(cue.at)) {
      throw new Error(`[motion] cue "at" must be a number (got ${JSON.stringify(cue.at)})`);
    }
    const where = `cue at ${cue.at}`;
    let dur = cue.dur;
    if (dur === 'end') dur = duration - cue.at;
    else if (typeof dur !== 'number' || Number.isNaN(dur) || dur <= 0) {
      throw new Error(`[motion] ${where}: "dur" must be a positive number or 'end'`);
    }
    if (cue.ease !== undefined) assertEasing(cue.ease, where);

    const targetsRaw = Array.isArray(cue.target) ? cue.target : [cue.target];
    if (!targetsRaw.length) {
      warn(`[motion] ${where}: empty target array — skipped`);
      continue;
    }
    const resolved = [];
    for (const t of targetsRaw) {
      if (typeof t !== 'string') throw new Error(`[motion] ${where}: target must be a string`);
      resolved.push(...resolveTarget(t));
    }

    for (const prop of Object.keys(cue)) {
      if (RESERVED.has(prop)) continue;
      if (cue.keys && prop in cue.keys) continue;

      for (let i = 0; i < resolved.length; i++) {
        const ref = resolved[i];
        const at = cue.at + (cue.stagger ? i * cue.stagger : 0);
        const isCam = ref === camState;
        const isFx = ref === fxState;
        const isSvg = ref && svgStates.has(ref.el);
        if (isCam && !CAMERA_PROPS.has(prop)) { warn(`[motion] ${where}: camera has no prop "${prop}" — skipped`); continue; }
        if (isFx && !FX_PROPS.has(prop)) { warn(`[motion] ${where}: fx has no prop "${prop}" — skipped`); continue; }
        if (!isCam && !isFx && !(isSvg ? SVG_PROPS : OBJECT_PROPS).has(prop)) {
          warn(`[motion] ${where}: unknown prop "${prop}" for target — skipped`);
          continue;
        }
        let track;
        if (prop === 'color') {
          // per-target color track
          const v = parseValue(prop, cue[prop], where);
          track = { at, dur, fromC: v.from, toC: v.to, ease: cue.ease ?? v.ease, loop: cue.loop, every: cue.every };
        } else if (cue.keys && cue.keys[prop]) {
          const kfs = cue.keys[prop];
          if (!Array.isArray(kfs) || kfs.length < 2) {
            throw new Error(`[motion] ${where}: keys for "${prop}" need >= 2 keyframes`);
          }
          for (const kf of kfs) {
            if (!Array.isArray(kf) || typeof kf[0] !== 'number' || typeof kf[1] !== 'number') {
              throw new Error(`[motion] ${where}: keyframes for "${prop}" must be [t, v] pairs`);
            }
            if (kf[2] !== undefined) assertEasing(kf[2], `${where} / "${prop}"`);
          }
          track = { at, dur, keys: [...kfs].sort((a, b) => a[0] - b[0]), loop: cue.loop, every: cue.every };
        } else {
          const v = parseValue(prop, cue[prop], where);
          track = { at, dur, from: v.from, to: v.to, ease: cue.ease ?? v.ease, loop: cue.loop, every: cue.every };
        }
        const g = groupFor(ref);
        if (!g.has(prop)) g.set(prop, []);
        g.get(prop).push(track);
      }
    }
    // keys-only cues (props that appear only inside `keys`)
    if (cue.keys) {
      for (const [prop, kfs] of Object.entries(cue.keys)) {
        for (let i = 0; i < resolved.length; i++) {
          const ref = resolved[i];
          const at = cue.at + (cue.stagger ? i * cue.stagger : 0);
          const isCam = ref === camState;
          const isFx = ref === fxState;
          const isSvg = ref && svgStates.has(ref.el);
          const valid = isCam ? CAMERA_PROPS.has(prop) : isFx ? FX_PROPS.has(prop) : isSvg ? SVG_PROPS.has(prop) : OBJECT_PROPS.has(prop);
          if (!valid) { warn(`[motion] cue at ${cue.at}: unknown prop "${prop}" for target — skipped`); continue; }
          if (!Array.isArray(kfs) || kfs.length < 2) {
            throw new Error(`[motion] cue at ${cue.at}: keys for "${prop}" need >= 2 keyframes`);
          }
          for (const kf of kfs) {
            if (!Array.isArray(kf) || typeof kf[0] !== 'number' || typeof kf[1] !== 'number') {
              throw new Error(`[motion] cue at ${cue.at}: keyframes for "${prop}" must be [t, v] pairs`);
            }
            if (kf[2] !== undefined) assertEasing(kf[2], `cue at ${cue.at} / "${prop}"`);
          }
          const g = groupFor(ref);
          if (!g.has(prop)) g.set(prop, []);
          g.get(prop).push({ at, dur, keys: [...kfs].sort((a, b) => a[0] - b[0]), loop: cue.loop, every: cue.every });
        }
      }
    }
  }

  // compile-time draw prep
  for (const [ref, props] of groups) {
    if (!ref || !ref.el || !svgStates.has(ref.el)) continue;
    if (!groups.get(ref).has('draw')) continue;
    const st = ref;
    try {
      st.drawLen = st.el.getTotalLength();
      st.el.style.strokeDasharray = String(st.drawLen);
    } catch (e) {
      warnings.push(`[motion] draw channel on "${st.el.id || 'element'}": getTotalLength() failed (${e.message})`);
    }
  }
  for (const g of groups.values()) for (const tracks of g.values()) tracks.sort((a, b) => a.at - b.at);

  // ---------- evaluation ----------
  function evalTrack(tr, local) {
    // pingpong cues oscillate between from/to from the moment they start, with
    // period `every` (default: their own dur) — NOT only after dur elapses.
    // (nova-core's bars and core-breathing use dur:'end' + every, so the loop
    // must run inside the cue window, not after it.)
    if (tr.loop === 'pingpong') {
      const period = tr.every ?? tr.dur;
      const m = ((local % (2 * period)) + 2 * period) % (2 * period);
      const tri = m <= period ? m / period : 2 - m / period;
      return evalAt(tr, applyEasing(tr.ease, tri));
    }
    if (local >= tr.dur) return lastValue(tr);
    const p = tr.dur > 0 ? local / tr.dur : 1;
    return evalAt(tr, p);
  }
  function evalAt(tr, pe) {
    if (tr.keys) return evalKeys(tr.keys, pe);
    if (tr.fromC) return tr.fromC.clone().lerp(tr.toC, pe);
    return tr.from + (tr.to - tr.from) * pe;
  }
  function lastValue(tr) {
    if (tr.keys) return tr.keys[tr.keys.length - 1][1];
    if (tr.fromC) return tr.toC.clone();
    return tr.to;
  }
  function firstValue(tr) {
    if (tr.keys) return tr.keys[0][1];
    if (tr.fromC) return tr.fromC.clone();
    return tr.from;
  }

  const _v = new THREE.Vector3();
  function render(t) {
    // evaluate tracks
    for (const [ref, props] of groups) {
      for (const [prop, tracks] of props) {
        let tr = null;
        for (const tk of tracks) if (tk.at <= t) tr = tk;
        let value;
        if (!tr) value = firstValue(tracks[0]);
        else value = evalTrack(tr, t - tr.at);
        apply(ref, prop, value);
      }
    }

    // svg per-element compose
    for (const st of svgStates.values()) {
      if (!st._touched) continue;
      const sx = st.scaleX * st.scale;
      const sy = st.scaleY * st.scale;
      st.el.style.transform = `translate(${st.x}px, ${st.y}px) rotate(${st.rotate}deg) scale(${sx}, ${sy})`;
      st.el.style.filter = st.blur > 0 ? `blur(${st.blur}px)` : 'none';
      if (st.opacity !== null) st.el.style.opacity = String(st.opacity);
      if (st.drawLen != null && st.draw !== null) {
        st.el.style.strokeDashoffset = String(st.drawLen * (1 - st.draw));
      }
    }

    // camera
    const az = camState.azimuth * D2R;
    const elv = camState.elevation * D2R;
    const shakeT = Math.floor(t * 47);
    camera.position.set(
      camState.distance * Math.sin(az) * Math.cos(elv) + hash1(shakeT, 1) * camState.shake,
      camState.distance * Math.sin(elv) + hash1(shakeT, 2) * camState.shake,
      camState.distance * Math.cos(az) * Math.cos(elv) + hash1(shakeT, 3) * camState.shake
    );
    camera.fov = camState.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(...camState.lookAt);

    // particles uTime (logical)
    for (const entry of named.values()) {
      if (entry.kind === 'obj' && entry.node.isPoints) entry.mat.uniforms.uTime.value = t;
    }

    // anchors
    for (const a of anchors) {
      a.to.node.getWorldPosition(_v);
      if (a.offset) _v.x += a.offset[0], _v.y += a.offset[1], _v.z += a.offset[2];
      _v.project(camera);
      const px = (_v.x * 0.5 + 0.5) * DW;
      const py = (-_v.y * 0.5 + 0.5) * DH;
      a.el.setAttribute('transform', `translate(${px} ${py})`);
    }

    // fx
    fadeEl.style.opacity = String(fxState.fade);
    flashEl.style.opacity = String(fxState.flash);
    bloom.strength = fxState.bloom;

    composer.render();
  }

  function apply(ref, prop, value) {
    if (ref === camState) {
      camState[prop] = value;
      return;
    }
    if (ref === fxState) {
      fxState[prop] = value;
      return;
    }
    const st = ref; // svg state or object entry
    if (st && st.el !== undefined && svgStates.has(st.el)) {
      if (prop === 'scaleX' || prop === 'scaleY') st[prop] = value;
      else if (prop === 'scale') st.scale = value;
      else st[prop] = value;
      st._touched = true;
      return;
    }
    const entry = ref;
    const node = entry.node;
    switch (prop) {
      case 'scale': node.scale.setScalar(value); break;
      case 'scaleX': node.scale.x = value; break;
      case 'scaleY': node.scale.y = value; break;
      case 'scaleZ': node.scale.z = value; break;
      case 'opacity':
        if (node.isPoints) node.material.uniforms.uOpacity.value = value;
        else {
          node.material.transparent = true;
          node.material.opacity = value;
        }
        break;
      case 'glow':
        if (node.isPoints) {
          entry.mat.glowValue = value;
          entry.mat.uniforms.uColor.value.copy(entry.mat.base).multiplyScalar(Math.max(1, value));
        } else if (entry.preset === 'neon') {
          entry.node.material.emissiveIntensity = value;
          entry.glow = value;
        } else {
          entry.glow = value;
          entry.node.material.color.copy(entry.baseColor).multiplyScalar(Math.max(1, value));
        }
        break;
      case 'burst':
        if (node.isPoints) node.material.uniforms.uBurst.value = value;
        break;
      case 'intensity':
        if (entry.kind === 'light') node.intensity = value;
        break;
      case 'color':
        if (node.isPoints) {
          entry.mat.base.copy(value);
          entry.mat.uniforms.uColor.value.copy(value).multiplyScalar(Math.max(1, entry.mat.glowValue));
        } else if (entry.preset === 'neon') {
          entry.baseColor.copy(value);
          node.material.color.copy(value);
          node.material.emissive.copy(value);
        } else {
          entry.baseColor.copy(value);
          node.material.color.copy(value).multiplyScalar(Math.max(1, entry.glow));
        }
        break;
      default: {
        const [base, ch] = prop.split('.');
        if (base === 'rotation') node.rotation[ch] = value * D2R;
        else if (base === 'position') node.position[ch] = value;
        else warn(`[motion] cannot apply prop "${prop}"`);
      }
    }
  }

  // ---------- live loop ----------
  let _playing = false;
  let _t = 0;
  let _raf = 0;

  function play() {
    if (capture) return; // headless tools drive render(t) directly
    if (_playing) return;
    _playing = true;
    let last = performance.now();
    const loop = (now) => {
      if (!_playing) return;
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      _t = Math.min(_t + dt, duration);
      render(_t);
      if (_t < duration) _raf = requestAnimationFrame(loop);
      else _playing = false;
    };
    _raf = requestAnimationFrame(loop);
  }
  function pause() {
    _playing = false;
    cancelAnimationFrame(_raf);
  }
  function stop() {
    pause();
    _t = 0;
    render(0);
  }
  function seek(t) {
    _t = t;
    render(t);
  }

  if (!capture && typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
  }

  render(0);

  const motion = {
    duration,
    size: [RW, RH],
    designSize: [DW, DH],
    warnings,
    named,
    play,
    pause,
    stop,
    seek: seek,
    render,
  };
  if (capture) window.__agentStageMotion = motion;
  return motion;
}
