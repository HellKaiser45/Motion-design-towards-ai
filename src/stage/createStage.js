import * as THREE from 'three';
import gsap from 'gsap';
import { validateSpec, normalizeSpec } from '../spec/validate.js';
import { BACKGROUND_PRESETS } from '../spec/schema.js';
import { buildObject } from '../objects/buildObject.js';
import { createCamera } from '../camera/createCamera.js';
import { createLights } from '../lights/createLights.js';
import { createOverlay } from '../svg/createOverlay.js';
import { compileScore as compileCues } from '../score/compile.js';
import { createBridge } from '../bridge/createBridge.js';

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
    return { width: w, height: h };
  }

  // Overlay subscribers are notified with the fitted size when available
  // (browser-managed resize), or with undefined otherwise (headless).
  const resizeCallbacks = new Set();
  function notifyResize(size) {
    for (const cb of resizeCallbacks) cb(size);
  }

  let resizeHandler = null;
  if (browserManaged && typeof window !== 'undefined') {
    resizeHandler = () => updateRenderSize();
    window.addEventListener('resize', resizeHandler);
  }

  function updateRenderSizeWithNotify() {
    if (!renderer || !browserManaged || typeof window === 'undefined') return;
    const fitted = updateRenderSize();
    if (fitted) notifyResize(fitted);
  }
  if (resizeHandler) updateRenderSizeWithNotify();

  function onResize(cb) {
    if (typeof cb !== 'function') return () => {};
    resizeCallbacks.add(cb);
    return () => resizeCallbacks.delete(cb);
  }

  // Overlay layer (structure only; animation comes from score cues).
  // Created and mounted BEFORE the score compiles so DOM-selector cues can
  // resolve real elements at compile time.
  const svgSpec = spec.svg ?? spec.overlay;
  const svg = svgSpec ? createOverlay(null, svgSpec) : null;
  let autoAttachedOverlay = null;
  if (svg && display.mount === 'body' && typeof document !== 'undefined' && document.body) {
    // Appended after the canvas, so DOM order stacks the overlay on top
    // (both are positioned elements; no z-index needed).
    document.body.appendChild(svg.el);
    autoAttachedOverlay = svg.el;
  }
  if (svg) onResize((size) => svg.resize(size));

  // Single source of truth for time: everything animates on this one timeline.
  // It is always created, even in headless Node, so Phase 2's score compiler
  // can target `stage.timeline` regardless of rendering environment.
  const timeline = gsap.timeline({ paused: true });

  // Bridge: DOM-style animation handles (x, rotateY, opacity, ...) for 3D
  // objects. Created before the score compiles so cues can use it.
  const bridge = createBridge({ objects, lights, camera, scene });

  const stage = { timeline, objects, lights, camera, scene, bridge };
  function compileScore(score) {
    return compileCues(stage, score);
  }

  // Score compile result (ok/errors/warnings); always present as a contract,
  // empty when the spec has no score.
  const scoreCompile = spec.score
    ? compileScore(normalized.score)
    : { ok: true, errors: [], warnings: [], duration: 0 };

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
    bridge.dispose();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer = null;
    }
    if (resizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
    if (resizeCallbacks) resizeCallbacks.clear();
    if (svg) {
      // svg.destroy() calls el.remove(); safe even when the overlay was never
      // attached (el.remove() no-ops without a parentNode).
      svg.destroy();
    }
    if (autoAttachedOverlay) {
      autoAttachedOverlay.remove();
      autoAttachedOverlay = null;
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
    /**
     * Bridge (DOM-style 3D handles): `bridge.object(name)` returns a proxy with
     * x/y/z/rotateX-Z/scale/scaleX-Z/opacity that GSAP can tween directly on
     * `stage.timeline`; `bridge.snapshot(name)` returns the current values.
     */
    bridge,
    /**
     * SVG overlay layer (Phase 2B).
     * - null when the spec has no `svg` section.
     * - When `display.mount === 'body'` (and a DOM is available) the overlay
     *   element is auto-appended to document.body, on top of the canvas;
     *   dispose() removes it exactly once.
     * - When `display.mount` is not 'body', the overlay stays detached —
     *   callers mount `stage.svg.el` themselves.
     * - Headless (no DOM): a mock overlay with `detached: true` is returned.
     */
    svg,
    onResize,
    scoreCompile,
    compileScore,
    play,
    pause,
    seek,
    render,
    dispose,
  };
}
