import * as THREE from 'three';
import gsap from 'gsap';
import { validateSpec, normalizeSpec } from '../spec/validate.js';
import { BACKGROUND_PRESETS } from '../spec/schema.js';
import { buildObject } from '../objects/buildObject.js';
import { createCamera } from '../camera/createCamera.js';
import { createLights } from '../lights/createLights.js';

// Memoized at module level so repeated createStage calls do not create/abandon
// WebGL contexts on every probe.
let webglProbe;
function hasWebGL() {
  if (webglProbe === undefined) {
    try {
      const canvas = document.createElement('canvas');
      webglProbe = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
      webglProbe = false;
    }
  }
  return webglProbe;
}

function resolveBackground(background) {
  // Object.hasOwn guards against prototype-chain keys like 'toString'.
  const hex = Object.hasOwn(BACKGROUND_PRESETS, background) ? BACKGROUND_PRESETS[background] : background;
  return new THREE.Color(hex);
}

export function createStage(spec, options = {}) {
  const { canvas, webgl = true, width, height, onValidateError } = options;

  const { ok, errors } = validateSpec(spec);
  if (!ok) {
    if (onValidateError) {
      onValidateError(errors);
      return { ok: false, errors };
    }
    throw new Error(`Invalid stage spec:\n${errors.map((e) => JSON.stringify(e)).join('\n')}`);
  }

  // Validation already ran above; skip normalizeSpec's internal validation.
  const normalized = normalizeSpec(spec, { skipValidation: true });

  const scene = new THREE.Scene();
  scene.background = resolveBackground(normalized.meta.background);
  if (normalized.meta.fog) {
    const { color, near, far } = normalized.meta.fog;
    scene.fog = new THREE.Fog(color, near, far);
  }

  const size = {
    width: width ?? normalized.meta.size.width,
    height: height ?? normalized.meta.size.height,
  };

  let renderer = null;
  if (webgl && typeof document !== 'undefined' && hasWebGL()) {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas ?? undefined, antialias: true, alpha: false });
      renderer.setSize(size.width, size.height);
      renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
    } catch {
      renderer = null;
    }
  }

  const camera = createCamera(normalized.camera, size.width / size.height);
  // Object registry: named objects are addressable via stage.objects.
  const objects = new Map();
  for (const def of normalized.objects) {
    const mesh = buildObject(def);
    scene.add(mesh);
    objects.set(def.name, mesh);
  }

  // Light registry: named lights are addressable via stage.lights.
  // Phase 2 targeting is uniform across stage.objects (THREE.Object3D),
  // stage.lights (Map of name -> THREE.Light) and stage.camera (THREE.Camera).
  const lights = new Map();
  for (const light of createLights(normalized.lights)) {
    scene.add(light);
    lights.set(light.name, light);
  }

  // Single source of truth for time: everything animates on this one timeline.
  // It is always created, even in headless Node, so Phase 2's score compiler
  // can target `stage.timeline` regardless of rendering environment.
  const timeline = gsap.timeline({ paused: true });

  let disposed = false;
  let tickerCallback = null;

  function render() {
    if (!renderer || disposed) return;
    renderer.render(scene, camera);
  }

  // Live mode: GSAP's ticker is only a paint driver — it paints whatever the
  // timeline currently shows. Determinism comes from seek(t), not from
  // smoothing, so lagSmoothing stays at GSAP defaults.
  if (renderer) {
    tickerCallback = () => render();
    gsap.ticker.add(tickerCallback);
  }

  function seek(seconds) {
    if (disposed) return;
    timeline.time(seconds);
    render();
  }

  // Same disposed guard as seek: all time controls are no-ops after dispose.
  function play() {
    if (disposed) return;
    timeline.play();
  }

  function pause() {
    if (disposed) return;
    timeline.pause();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (tickerCallback) {
      gsap.ticker.remove(tickerCallback);
      tickerCallback = null;
    }
    timeline.kill();
    scene.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      const material = node.material;
      if (material) {
        const list = Array.isArray(material) ? material : [material];
        for (const m of list) {
          for (const key of Object.keys(m)) {
            const value = m[key];
            if (value && typeof value.dispose === 'function' && value.isTexture) value.dispose();
          }
          m.dispose();
        }
      }
    });
    scene.clear();
    objects.clear();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer = null;
    }
  }

  return {
    ok: true,
    scene,
    camera,
    renderer,
    timeline,
    objects,
    lights,
    play,
    pause,
    seek,
    render,
    dispose,
  };
}
