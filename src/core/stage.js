/**
 * @module agent-stage/core/stage
 * Stage: owns the Three.js renderer/scene/camera, the SVG overlay DOM layer,
 * and the MASTER CLOCK. The master clock is the single source of truth for
 * logical time across all engines (PropEngine, WAAPI, SMIL sync), so it must
 * support play/pause/seek/rate with frame-accurate determinism.
 *
 * Emits: 'tick' ({dt, time}), 'seek' ({t}), 'state' ({playing}).
 */
import * as THREE from 'three';
import { EventEmitter } from './events.js';

export class Stage {
  /**
   * @param {Element|string} mount element or CSS selector
   * @param {{antialias?:boolean, alpha?:boolean, background?:*,
   *          width?:number, height?:number, fixedFps?:number}} [options]
   */
  constructor(mount, options = {}) {
    const el = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!el) throw new Error('[agent-stage.stage] mount element not found: ' + mount);

    const {
      antialias = true,
      alpha = true,
      background = null,
      width,
      height,
      fixedFps = 0,
    } = options;

    this._events = new EventEmitter();
    this._playing = false;
    this._time = 0; // logical seconds
    this._rate = 1;
    this._fixedFps = fixedFps;
    this._fixedSize = width != null && height != null;
    this._accumulator = 0;
    this._lastNow = 0;
    this._rafId = 0;

    const w = width ?? (el.clientWidth || 640);
    const h = height ?? (el.clientHeight || 360);

    this._renderer = new THREE.WebGLRenderer({ antialias, alpha });
    this._renderer.setClearColor(0x000000, 0); // transparent clear for later video export
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (background !== null) this._renderer.setClearColor(background);

    this._canvas = this._renderer.domElement;
    this._canvas.style.display = 'block';
    this._canvas.style.position = 'absolute';
    this._canvas.style.inset = '0';

    // container for stacking. Check the *computed* position: the inline style
    // is usually empty, and blindly setting position:relative would override a
    // stylesheet's position:absolute;inset:0, collapsing the mount box to
    // height 0 and clipping the canvas + SVG overlay out of view.
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.overflow = 'hidden';
    el.appendChild(this._canvas);

    // SVG overlay above canvas, pointer-events none by default
    this._svgOverlay = document.createElement('div');
    this._svgOverlay.id = 'as-svg-overlay';
    this._svgOverlay.style.cssText =
      'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    el.appendChild(this._svgOverlay);

    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
    this._camera.position.set(0, 0, 5);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    this._raf = this._raf.bind(this);
  }

  /** Start the RAF loop and the clock. */
  start() {
    this._playing = true;
    this._lastNow = performance.now();
    this._emitState();
    if (!this._rafId) this._rafId = requestAnimationFrame(this._raf);
  }

  /** Stop RAF loop entirely. */
  stop() {
    this._playing = false;
    this._emitState();
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
  }

  /** Pause logical clock; RAF keeps rendering (so seek previews still show). */
  pauseClock() {
    this._playing = false;
    this._emitState();
  }

  resumeClock() {
    if (!this._rafId) this._rafId = requestAnimationFrame(this._raf);
    this._playing = true;
    this._lastNow = performance.now();
    this._accumulator = 0;
    this._emitState();
  }

  /** Jump the master clock to t seconds (absolute). */
  seek(t) {
    if (typeof t !== 'number' || Number.isNaN(t) || t < 0) {
      throw new RangeError('[agent-stage.stage] seek(t) requires t >= 0, got ' + t);
    }
    this._time = t;
    this._accumulator = 0; // fixedFps: don't carry a stale fractional remainder
    this._emit('seek', { t });
    // Render immediately so a paused seek is visually confirmed.
    this._render();
  }

  /** Time scale. */
  setRate(r) {
    if (typeof r !== 'number' || r <= 0 || Number.isNaN(r)) {
      throw new RangeError('[agent-stage.stage] setRate(r) requires r > 0, got ' + r);
    }
    this._rate = r;
  }

  /** @returns {number} elapsed logical seconds */
  get time() {
    return this._time;
  }

  /** @returns {boolean} */
  get playing() {
    return this._playing;
  }

  /** @returns {{scene:THREE.Scene, camera:THREE.PerspectiveCamera, renderer:THREE.WebGLRenderer, svgOverlay:Element, canvas:HTMLCanvasElement}} */
  get scene() { return this._scene; }
  get camera() { return this._camera; }
  get renderer() { return this._renderer; }
  get svgOverlay() { return this._svgOverlay; }
  get canvas() { return this._canvas; }

  /** Resize to container — skipped when the constructor was given fixed width/height. */
  resize() {
    if (this._fixedSize) return; // honor explicit constructor size
    const parent = this._canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth || this._canvas.width;
    const h = parent.clientHeight || this._canvas.height;
    this._renderer.setSize(w, h);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  /** Event emitter passthroughs. */
  on(name, fn) { return this._events.on(name, fn); }
  off(name, fn) { this._events.off(name, fn); }
  once(name, fn) { this._events.once(name, fn); }
  _emit(name, payload) { this._events.emit(name, payload); }

  _emitState() {
    this._emit('state', { playing: this._playing });
  }

  _raf(now) {
    this._rafId = requestAnimationFrame(this._raf);
    if (!this._playing) return;

    const realDt = Math.min((now - this._lastNow) / 1000, 0.25); // clamp tab-switch jumps
    this._lastNow = now;

    if (this._fixedFps > 0) {
      const step = 1 / this._fixedFps;
      this._accumulator += realDt * this._rate;
      while (this._accumulator >= step) {
        this._accumulator -= step;
        this._time += step;
        this._emit('tick', { dt: step, time: this._time });
      }
    } else {
      const dt = realDt * this._rate;
      this._time += dt;
      this._emit('tick', { dt, time: this._time });
    }
    this._render();
  }

  _render() {
    this._renderer.render(this._scene, this._camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.stop();
    this._renderer.dispose();
    if (this._canvas.parentElement) this._canvas.parentElement.removeChild(this._canvas);
    if (this._svgOverlay.parentElement) this._svgOverlay.parentElement.removeChild(this._svgOverlay);
  }
}
