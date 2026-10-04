/**
 * @module agent-stage/engines/prop-engine
 * PropEngine: tween engine for Three.js object properties (WAAPI/SMIL cannot
 * touch JS objects). Pure function of time: update(t) computes and applies
 * interpolated values — required for deterministic seek/offline export.
 *
 * Track spec:
 * { engine:'prop', target:'body', loop?:'repeat'|'pingpong',
 *   props: { "rotation:y": [{t:0,v:0,ease:'easeOutCubic'},{t:0.8,v:0.6}], ... } }
 * Keyframes are absolute seconds, numeric values, linear interp between
 * keyframes with easing from the segment's END keyframe.
 */
import { applyEasing } from '../core/easing.js';

export class PropEngine {
  /** @param {import('../layers/three-layer.js').ThreeLayer} threeLayer */
  constructor(threeLayer) {
    if (!threeLayer) throw new Error('[agent-stage.propEngine] requires a ThreeLayer');
    this._threeLayer = threeLayer;
    this._spec = null;
    this._channels = []; // { object, key, channel, kfs (sorted), applied value }
    this._initial = null; // captured on first apply
    this._duration = 0;
    this._playing = false;
    this._t = 0;
  }

  /**
   * Compile a track spec. Replaces any previous spec on this engine instance.
   * @param {object} spec
   * @returns {PropEngine} this
   */
  compile(spec) {
    if (!spec || spec.engine !== 'prop' || typeof spec.target !== 'string') {
      throw new Error('[agent-stage.propEngine] spec must be {engine:"prop", target:"name", props:{...}}');
    }
    if (!spec.props || typeof spec.props !== 'object') {
      throw new Error('[agent-stage.propEngine] spec.props object required');
    }
    const resolved = this._threeLayer.resolve(spec.target);
    const channels = [];
    let maxT = 0;

    for (const [propPath, kfs] of Object.entries(spec.props)) {
      if (!Array.isArray(kfs) || kfs.length === 0) {
        throw new Error(`[agent-stage.propEngine] empty keyframe list for prop "${propPath}"`);
      }
      const sorted = [...kfs].sort((a, b) => a.t - b.t);
      if (sorted[0].t > 0) {
        throw new Error(
          `[agent-stage.propEngine] prop "${propPath}" must start at t=0 (first keyframe t=${sorted[0].t})`
        );
      }
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].t <= sorted[i - 1].t) {
          throw new Error(`[agent-stage.propEngine] unsorted/duplicate times in prop "${propPath}"`);
        }
      }
      for (const kf of sorted) {
        if (typeof kf.v !== 'number' || Number.isNaN(kf.v)) {
          throw new Error(`[agent-stage.propEngine] keyframe value must be numeric in "${propPath}"`);
        }
      }
      maxT = Math.max(maxT, sorted[sorted.length - 1].t);

      // Resolve target prop path, e.g. "rotation:y" -> object.rotation with channel 'y'
      const [propBase, channel] = propPath.split(':');
      const { object, prop, channel: resolvedChannel } = this._threeLayer.resolve(
        `${spec.target}.${propBase}`
      );
      if (!prop) {
        throw new Error(`[agent-stage.propEngine] prop path "${propPath}" must address a property of "${spec.target}"`);
      }
      channels.push({
        object,
        prop,
        channel: channel ?? resolvedChannel,
        kfs: sorted,
        value: 0,
      });
    }

    this._spec = spec;
    this._channels = channels;
    this._duration = maxT;
    this._initial = null;
    this._t = 0;
    this._playing = false;
    return this;
  }

  /** @returns {number} seconds */
  duration() {
    return this._duration;
  }

  /** @returns {boolean} */
  get playing() {
    return this._playing;
  }

  play() {
    this._playing = true;
  }

  pause() {
    this._playing = false;
  }

  /** Seek: pure evaluation at t (seconds, local track time before loop mapping). */
  seek(t) {
    this.update(t);
  }

  /**
   * Evaluate and apply at time t. Loops map t into [0, duration].
   * @param {number} tSec
   */
  update(tSec) {
    if (!this._channels.length) return;
    this._t = tSec;
    let local = tSec;
    const dur = this._duration;
    if (dur > 0) {
      const loop = this._spec.loop || 'none';
      if (loop === 'repeat') {
        local = ((tSec % dur) + dur) % dur;
      } else if (loop === 'pingpong') {
        const period = dur * 2;
        const m = ((tSec % period) + period) % period;
        local = m <= dur ? m : period - m;
      } else {
        local = Math.min(tSec, dur);
      }
    }
    this._captureInitialIfNeeded();
    for (const ch of this._channels) {
      ch.value = this._evalChannel(ch, local);
      this._apply(ch, ch.value);
    }
  }

  /** Stop and restore initial values. */
  stop() {
    this._playing = false;
    this._t = 0;
    if (this._initial) {
      for (const ch of this._channels) {
        const init = this._initial.get(ch);
        if (init !== undefined) this._apply(ch, init);
        ch.value = init ?? 0;
      }
      this._initial = null;
    }
  }

  /** Jump to end and hold (fill). */
  finish() {
    this._captureInitialIfNeeded();
    for (const ch of this._channels) {
      const last = ch.kfs[ch.kfs.length - 1];
      this._apply(ch, last.v);
      ch.value = last.v;
    }
    this._t = this._duration;
  }

  /** @private capture once so stop() can restore */
  _captureInitialIfNeeded() {
    if (this._initial) return;
    this._initial = new Map();
    for (const ch of this._channels) {
      this._initial.set(ch, this._readCurrent(ch));
    }
  }

  /** @private numeric read of the current value of one channel */
  _readCurrent(ch) {
    let holder = ch.object;
    const parts = ch.prop.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      holder = holder[parts[i]];
      if (holder == null) return 0;
    }
    const leaf = holder[parts[parts.length - 1]];
    if (ch.channel != null) {
      if (leaf.isColor) {
        const c = ch.channel.toLowerCase();
        if (c === 'r') return leaf.r;
        if (c === 'g') return leaf.g;
        if (c === 'b') return leaf.b;
      }
      return leaf?.[ch.channel] ?? 0;
    }
    // No channel: only valid for numeric leafs
    return typeof leaf === 'number' ? leaf : 0;
  }

  /** @private keyframe interpolation for one channel at local time */
  _evalChannel(ch, local) {
    const kfs = ch.kfs;
    if (local <= kfs[0].t) return kfs[0].v;
    const last = kfs[kfs.length - 1];
    if (local >= last.t) return last.v;
    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].t <= local) i++;
    const a = kfs[i];
    const b = kfs[i + 1];
    const raw = (local - a.t) / (b.t - a.t);
    const eased = applyEasing(b.ease, raw); // easing comes from segment END keyframe
    return a.v + (b.v - a.v) * eased;
  }

  /** @private write value into the object property */
  _apply(ch, value) {
    let holder = ch.object;
    const parts = ch.prop.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      holder = holder[parts[i]];
      if (holder == null) return;
    }
    const leaf = holder[parts[parts.length - 1]];
    if (leaf == null) return;
    if (ch.channel != null) {
      if (leaf.isColor) {
        const c = ch.channel.toLowerCase();
        if (c === 'r') leaf.r = value;
        else if (c === 'g') leaf.g = value;
        else if (c === 'b') leaf.b = value;
        else leaf[c] = value;
      } else {
        leaf[ch.channel] = value;
      }
    } else if (typeof leaf === 'number') {
      holder[parts[parts.length - 1]] = value;
    } else {
      throw new Error(
        `[agent-stage.propEngine] prop "${ch.prop}" on target is not numeric and has no channel; ` +
        'phase 1 supports numeric channels only (e.g. "position:x", "material.color:r")'
      );
    }
  }
}
