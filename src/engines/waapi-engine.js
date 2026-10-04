/**
 * @module agent-stage/engines/waapi-engine
 * WaapiEngine: one-shot WAAPI animations on overlay SVG/DOM elements via
 * element.animate(keyframes, options). Holds the created Animation for
 * pause/seek/stop. Seek = animation.currentTime = t*1000 (frame-accurate).
 *
 * Track spec:
 * { engine:'waapi', svg:'face', selector:'#mouth',
 *   keyframes:[{t:0, opacity:0, transform:'translateY(0px)'},{t:0.4, opacity:1}],
 *   options:{ fill?, composite?, easing? }, loop?:'repeat'|'pingpong' }
 * Offsets are derived from t/duration, sorted and normalized: first 0, last 1.
 */
import { applyEasing } from '../core/easing.js';

export class WaapiEngine {
  /** @param {import('../layers/svg-layer.js').SvgLayer} svgLayer */
  constructor(svgLayer) {
    if (!svgLayer) throw new Error('[agent-stage.waapiEngine] requires an SvgLayer');
    this._svgLayer = svgLayer;
    this._spec = null;
    this._element = null;
    this._animation = null;
    this._duration = 0;
    this._playing = false;
    this._snapshot = null; // inline style/attribute snapshot for restore
    this._kfs = []; // normalized {offset, ...props, ease?}
    this._rate = 1;
  }

  /**
   * Compile a track spec. Does not start playback; call play() or seek(t) first.
   * @param {object} spec
   * @returns {WaapiEngine} this
   */
  compile(spec) {
    if (!spec || spec.engine !== 'waapi') {
      throw new Error('[agent-stage.waapiEngine] spec must have engine:"waapi"');
    }
    if (typeof spec.selector !== 'string' || !spec.selector) {
      throw new Error('[agent-stage.waapiEngine] spec.selector required');
    }
    if (!Array.isArray(spec.keyframes) || spec.keyframes.length === 0) {
      throw new Error('[agent-stage.waapiEngine] spec.keyframes must be a non-empty array');
    }

    const svgName = spec.svg;
    if (!svgName) {
      throw new Error('[agent-stage.waapiEngine] spec.svg (mounted svg name) required');
    }
    const root = this._svgLayer.get(svgName);
    if (!root) {
      throw new Error(`[agent-stage.waapiEngine] unknown svg "${svgName}"`);
    }
    const el = root.querySelector(spec.selector);
    if (!el) {
      throw new Error(`[agent-stage.waapiEngine] selector "${spec.selector}" not found in svg "${svgName}"`);
    }

    // Sort by t, derive offsets
    const sorted = [...spec.keyframes].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    const lastT = sorted[sorted.length - 1].t ?? 0;
    if (lastT <= 0) {
      throw new Error('[agent-stage.waapiEngine] keyframes need increasing t values with a positive final t');
    }
    const normalized = sorted
      .filter((kf, i, arr) => i === 0 || kf.t !== arr[i - 1].t) // drop duplicates
      .map((kf) => {
        const offset = Math.min(1, Math.max(0, (kf.t ?? 0) / lastT));
        const { t, ease, ...props } = kf;
        return { offset, ease, ...props };
      });
    // normalize: first must be 0, last must be 1
    normalized[0].offset = 0;
    normalized[normalized.length - 1].offset = 1;
    if (normalized.length < 2) {
      throw new Error('[agent-stage.waapiEngine] need at least 2 distinct keyframes');
    }

    this._spec = spec;
    this._kfs = normalized;
    this._element = el;
    this._duration = lastT;
    this._animation = null;
    this._playing = false;
    this._snapshot = null;
    return this;
  }

  /** @returns {number} seconds */
  duration() {
    return this._duration;
  }

  /** Set playback rate, fanned from Timeline.setRate. Applies to live + future animations. */
  setRate(rate) {
    this._rate = typeof rate === 'number' && rate > 0 && !Number.isNaN(rate) ? rate : 1;
    if (this._animation) this._animation.playbackRate = this._rate;
  }

  /** @returns {Animation|null} */
  get animation() {
    return this._animation;
  }

  /** @returns {boolean} */
  get playing() {
    return this._playing;
  }

  /** Create/start the Animation (from current seek position if any). */
  play() {
    if (!this._element) return;
    this._ensureAnimation();
    this._playing = true;
    const held = this._heldTime ?? 0;
    this._animation.currentTime = held * 1000;
    this._animation.play();
  }

  pause() {
    if (this._animation && this._playing) {
      this._heldTime = this._animation.currentTime / 1000;
      this._animation.pause();
    }
    this._playing = false;
  }

  /** Frame-accurate seek (works while paused or playing). */
  seek(t) {
    if (!this._element) return;
    this._ensureAnimation();
    const loop = this._spec.loop || 'none';
    let local = t;
    if (loop !== 'none' && this._duration > 0) {
      if (loop === 'repeat') local = ((t % this._duration) + this._duration) % this._duration;
      else if (loop === 'pingpong') {
        const period = this._duration * 2;
        const m = ((t % period) + period) % period;
        local = m <= this._duration ? m : period - m;
      }
    } else {
      local = Math.min(Math.max(t, 0), this._duration);
    }
    this._heldTime = local;
    this._animation.currentTime = local * 1000;
    if (!this._playing) this._animation.pause();
  }

  /** Cancel and restore element to pre-animation state. */
  stop() {
    this._playing = false;
    this._heldTime = 0;
    if (this._animation) {
      this._animation.cancel();
      this._animation = null;
    }
    if (this._snapshot) {
      this._restore();
    }
  }

  /** Jump to final keyframe and hold. */
  finish() {
    if (!this._element) return;
    this._ensureAnimation();
    this._heldTime = this._duration;
    this._animation.currentTime = this._duration * 1000;
    this._animation.pause();
    this._playing = false;
  }

  /**
   * Frame callback for play-mode looping: call from timeline tick when playing
   * to keep held time in sync for later seeks. (WAAPI self-runs otherwise.)
   * @param {number} tSec
   */
  update(tSec) {
    if (this._playing && this._animation) {
      this._heldTime = this._animation.currentTime / 1000;
    }
  }

  /**
   * Export support: bake the CURRENT animated state of this track's element as
   * inline style attributes so that serializing `outerHTML` captures the frame
   * (WAAPI-computed styles do not serialize). Values are sampled from this
   * engine's normalized keyframes at the current held time — loop-mapped the
   * same way as seek() so looping tracks don't bake the final keyframe.
   * @param {Element} [scopeRoot] when given, only bake if this element is
   *        inside it (compositor scoping: no cross-SVG-tree style writes).
   * @returns {string[]} style property names applied
   */
  snapshotStyles(scopeRoot) {
    if (!this._element || !this._kfs.length) return [];
    if (scopeRoot && !scopeRoot.contains(this._element)) return [];
    let local = this._heldTime ?? (this._animation ? this._animation.currentTime / 1000 : 0);
    const dur = this._duration || 1;
    const loop = this._spec.loop || 'none';
    if (loop !== 'none') {
      if (loop === 'repeat') local = ((local % dur) + dur) % dur;
      else if (loop === 'pingpong') {
        const period = dur * 2;
        const m = ((local % period) + period) % period;
        local = m <= dur ? m : period - m;
      }
    }
    const p = Math.min(1, Math.max(0, local / dur));
    const props = new Set();
    for (const kf of this._kfs) {
      for (const k of Object.keys(kf)) {
        if (!['offset', 'ease'].includes(k)) props.add(k);
      }
    }
    const applied = [];
    for (const prop of props) {
      const val = sampleKeyframes(this._kfs, prop, p);
      if (val === null || val === undefined) continue;
      applied.push(prop);
      this._element.style.setProperty(prop, String(val));
    }
    return applied;
  }

  /** Remove inline styles written by snapshotStyles(), restoring the captured pre-animation style. */
  clearSnapshot(applied) {
    if (!this._element) return;
    if (this._snapshot) {
      // Restore from the captured snapshot instead of blindly removing —
      // the element may have had pre-existing inline values.
      if (this._snapshot.style === null) this._element.removeAttribute('style');
      else this._element.setAttribute('style', this._snapshot.style);
    } else {
      for (const prop of applied ?? []) this._element.style.removeProperty(prop);
    }
  }

  /** @private */
  _ensureAnimation() {
    if (this._animation) return;
    this._snapshotIfNeeded();

    const kfs = this._buildKeyframes();
    const opts = {
      fill: this._spec.options?.fill ?? 'both',
      ...this._spec.options,
      duration: this._spec.options?.duration ?? this._duration * 1000,
    };
    // Avoid overriding explicit WAAPI easing with per-keyframe ease values; if
    // any keyframe carries `ease`, drop the top-level easing option.
    if (kfs.some((k) => k.easing !== undefined)) delete opts.easing;
    this._animation = this._element.animate(kfs, opts);
    this._animation.playbackRate = this._rate;
    this._animation.pause();
  }

  /** @private map normalized tracks to WAAPI keyframes (with optional easing) */
  _buildKeyframes() {
    return this._kfs.map((kf) => {
      const { offset, ease, ...props } = kf;
      const out = { offset, ...props };
      if (ease !== undefined && ease !== null) {
        // Map our easing names to CSS easing syntax; linear passthrough, else
        // fall back to per-segment evaluation is not possible in WAAPI, so use
        // closest CSS equivalents.
        out.easing = cssEasing(ease);
      }
      return out;
    });
  }

  /** @private */
  _snapshotIfNeeded() {
    if (this._snapshot || !this._element) return;
    const el = this._element;
    this._snapshot = {
      style: el.getAttribute('style'),
      opacity: el.getAttribute('opacity'),
      transform: el.getAttribute('transform'),
    };
  }

  /** @private */
  _restore() {
    const el = this._element;
    if (!el || !this._snapshot) return;
    if (this._snapshot.style === null) el.removeAttribute('style');
    else el.setAttribute('style', this._snapshot.style);
    for (const attr of ['opacity', 'transform']) {
      const v = this._snapshot[attr];
      if (v === null) el.removeAttribute(attr);
      else el.setAttribute(attr, v);
    }
    this._snapshot = null;
  }
}

/**
 * Sample one CSS property across normalized keyframes at progress p (0..1).
 * Numeric values are interpolated; string values take the nearest keyframe.
 * @private
 */
function sampleKeyframes(kfs, prop, p) {
  const vals = kfs.filter((kf) => kf[prop] !== undefined && kf[prop] !== null && kf[prop] !== '');
  if (!vals.length) return null;
  const num = vals.filter((kf) => typeof kf[prop] === 'number');
  if (num.length >= 2 && num.length === vals.length) {
    let i = 0;
    while (i < num.length - 1 && num[i + 1].offset <= p) i++;
    if (p <= num[0].offset) return num[0][prop];
    if (p >= num[num.length - 1].offset) return num[num.length - 1][prop];
    const a = num[i];
    const b = num[Math.min(i + 1, num.length - 1)];
    const span = b.offset - a.offset || 1;
    const raw = (p - a.offset) / span;
    return a[prop] + (b[prop] - a[prop]) * raw;
  }
  let best = vals[0];
  for (const kf of vals) if (kf.offset <= p) best = kf;
  return best[prop];
}

/**
 * Map our named easings to CSS easing strings for WAAPI.
 * Unknown names fall back to 'linear'.
 * @param {string} name
 * @returns {string}
 */
function cssEasing(name) {
  switch (name) {
    case 'linear': return 'linear';
    case 'easeInQuad': case 'easeInCubic': return 'cubic-bezier(0.55, 0.085, 0.68, 0.53)';
    case 'easeOutQuad': case 'easeOutCubic': return 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    case 'easeInOutQuad': case 'easeInOutCubic': return 'cubic-bezier(0.455, 0.03, 0.515, 0.955)';
    case 'backOut': return 'cubic-bezier(0.34, 1.56, 0.64, 1)';
    case 'elasticOut': return 'linear'; // no CSS equivalent; keep linear
    case 'step': return 'steps(1, end)';
    default: return 'linear';
  }
}
