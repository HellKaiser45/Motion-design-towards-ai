import * as THREE from 'three';
import gsap from 'gsap';
import { validateSpec, normalizeSpec } from '../spec/validate.js';
import { BACKGROUND_PRESETS } from '../spec/schema.js';
import { buildObject } from '../objects/buildObject.js';
import { createCamera } from '../camera/createCamera.js';
import { createLights } from '../lights/createLights.js';

// Probed per createStage call instead of memoized at module level: caching a
// module-level boolean let test stubs poison each other through it.
function hasWebGL() {
  try {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch {
    return false;
  }
}

function resolveBackground(background) {
  // Object.hasOwn guards against prototype-chain keys like 'toString'.
  const hex = Object.hasOwn(BACKGROUND_PRESETS, background) ? BACKGROUND_PRESETS[background] : background;
  return new THREE.Color(hex);
}

function applyAutoCanvasStyle(el, display, metaSize) {
  const s = el.style;
  s.position = display.position;
  s.display = 'block';
  if (display.fit === 'contain') {
    // Letterbox: centered via margin auto + inset 0, visual box locked to the
    // meta.size aspect ratio; the draw buffer is sized to the fitted box.
    s.top = '0';
    s.left = '0';
    s.right = '0';
    s.bottom = '0';
    s.margin = 'auto';
    s.maxWidth = '100%';
    s.maxHeight = '100%';
    s.aspectRatio = `${metaSize.width} / ${metaSize.height}`;
  } else {
    s.inset = '0';
    s.width = '100vw';
    s.height = '100vh';
  }
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
  const display = normalized.display;

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

  // Canvas resolution happens before the WebGL probe so the display/mount
  // lifecycle works even when rendering is unavailable (or fails later).
  let renderer = null;
  let renderCanvas = canvas ?? null;
  // True when WE created the canvas because the caller did not pass
  // options.canvas; dispose() must remove it from the DOM.
  let autoAttachedCanvas = null;
  let browserManaged = false;
  if (!renderCanvas && typeof document !== 'undefined') {
    try {
      renderCanvas = document.createElement('canvas');
      browserManaged = true;
      if (display.mount === 'body' && document.body) {
        applyAutoCanvasStyle(renderCanvas, display, normalized.meta.size);
        document.body.appendChild(renderCanvas);
        autoAttachedCanvas = renderCanvas;
      }
    } catch {
      renderCanvas = null;
      browserManaged = false;
    }
  }

  if (webgl && renderCanvas && typeof document !== 'undefined' && hasWebGL()) {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: renderCanvas, antialias: true, alpha: false });
      // With updateStyle=false the visual box stays under our CSS control
      // (100vw/100vh for cover, aspect-ratio letterbox for contain).
      renderer.setSize(size.width, size.height, browserManaged ? false : true);
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

  // Resize handling only for canvases we created; caller-owned canvases stay
  // entirely under the caller's control.
  function updateRenderSize() {
    if (!renderer || !browserManaged || typeof window === 'undefined') return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let w;
    let h;
    if (display.fit === 'contain') {
      const aspect = size.width / size.height;
      if (vw / vh > aspect) {
        h = vh;
        w = vh * aspect;
      } else {
        w = vw;
        h = vw / aspect;
      }
    } else {
      w = vw;
      h = vh;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  let resizeHandler = null;
  if (browserManaged && typeof window !== 'undefined') {
    resizeHandler = () => updateRenderSize();
    window.addEventListener('resize', resizeHandler);
    updateRenderSize();
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
    if (resizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
    if (autoAttachedCanvas) {
      autoAttachedCanvas.remove();
      autoAttachedCanvas = null;
    }
  }

  return {
    ok: true,
    scene,
    camera,
    renderer,
    canvas: renderCanvas,
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
