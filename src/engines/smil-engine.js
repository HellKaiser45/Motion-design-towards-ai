/**
 * @module agent-stage/engines/smil-engine
 * SmilEngine: drives SMIL animations embedded in mounted SVG assets.
 * Two modes:
 *  - 'trigger': beginElement()/endElement() on an <animate id="..."> — event style.
 *  - 'sync': uses the SVG document clock (pause/unpause/setCurrentTime) so the
 *    SMIL animation follows the master timeline (seek-accurate).
 *
 * Track specs:
 * { engine:'smil', svg:'face', mode:'trigger', animation:'smile' }
 * { engine:'smil', svg:'face', mode:'sync', begin:0, duration:2 }
 */
export class SmilEngine {
  /** @param {import('../layers/svg-layer.js').SvgLayer} svgLayer */
  constructor(svgLayer) {
    if (!svgLayer) throw new Error('[agent-stage.smilEngine] requires an SvgLayer');
    this._svgLayer = svgLayer;
    this._spec = null;
    this._element = null; // the SMIL animation element
    this._svgName = null;
    this._begin = 0;
    this._duration = 0;
    this._playing = false;
    this._rate = 1;
  }

  /**
   * Compile a track spec.
   * @param {object} spec
   * @returns {SmilEngine} this
   */
  compile(spec) {
    if (!spec || spec.engine !== 'smil') {
      throw new Error('[agent-stage.smilEngine] spec must have engine:"smil"');
    }
    if (!spec.svg) {
      throw new Error('[agent-stage.smilEngine] spec.svg (mounted svg name) required');
    }
    const root = this._svgLayer.get(spec.svg);
    if (!root) {
      throw new Error(`[agent-stage.smilEngine] unknown svg "${spec.svg}"`);
    }

    if (spec.mode === 'trigger') {
      if (!spec.animation) {
        throw new Error('[agent-stage.smilEngine] trigger mode requires spec.animation (SMIL element id)');
      }
      const el = findSmilElement(root, spec.animation);
      if (!el) {
        throw new Error(
          `[agent-stage.smilEngine] no <animate|animateTransform|animateMotion> with id "${spec.animation}" in svg "${spec.svg}"`
        );
      }
      this._element = el;
      this._svgName = spec.svg;
      this._spec = spec;
      this._begin = 0;
      this._duration = readSmilDuration(el);
      this._playing = false;
      return this;
    }

    if (spec.mode === 'sync') {
      if (typeof spec.duration !== 'number' || spec.duration <= 0) {
        throw new Error('[agent-stage.smilEngine] sync mode requires numeric spec.duration > 0');
      }
      this._element = spec.animation ? findSmilElement(root, spec.animation) : null;
      this._svgName = spec.svg;
      this._spec = spec;
      this._begin = spec.begin ?? 0;
      this._duration = spec.duration;
      this._playing = false;
      return this;
    }

    throw new Error('[agent-stage.smilEngine] spec.mode must be "trigger" or "sync"');
  }

  /** @returns {number} seconds */
  duration() {
    return this._duration;
  }

  /** @returns {boolean} */
  get playing() {
    return this._playing;
  }

  /**
   * Playback rate, fanned from Timeline.setRate. Sync mode maps the SVG doc
   * clock onto scaled master time at every seek/tick reposition; when the
   * SvgLayer exposes setRate we also scale the doc clock itself.
   */
  setRate(rate) {
    this._rate = typeof rate === 'number' && rate > 0 && !Number.isNaN(rate) ? rate : 1;
    if (this._spec?.mode === 'sync') {
      this._svgLayer.setRate?.(this._svgName, this._rate);
    }
  }

  /** Start: trigger mode fires beginElement; sync mode unpauses doc clock. */
  play() {
    if (!this._spec) return;
    this._playing = true;
    if (this._spec.mode === 'trigger') {
      try { this._element?.beginElement(); } catch (e) {
        throw new Error(`[agent-stage.smilEngine] beginElement failed on "${this._spec.animation}": ${e?.message ?? e}`);
      }
    } else {
      this._svgLayer.setRate?.(this._svgName, this._rate ?? 1);
      this._svgLayer.resume(this._svgName);
    }
  }

  /** Pause: trigger mode is event-style (no pause); sync pauses doc clock. */
  pause() {
    if (!this._spec) return;
    this._playing = false;
    if (this._spec.mode === 'sync') {
      this._svgLayer.pause(this._svgName);
    }
  }

  /**
   * Seek. Trigger mode: no deterministic mapping (event-style, accepted).
   * Sync mode: map master time onto the SVG document clock.
   * @param {number} tSec
   */
  seek(t) {
    if (!this._spec) return;
    if (this._spec.mode === 'sync') {
      const docTime = this._begin + t;
      this._svgLayer.seekTo(this._svgName, docTime);
      if (this._playing) this._svgLayer.resume(this._svgName);
      else this._svgLayer.pause(this._svgName);
    }
  }

  /** Stop: trigger mode fires endElement; sync pauses doc clock. */
  stop() {
    if (!this._spec) return;
    this._playing = false;
    if (this._spec.mode === 'trigger') {
      try { this._element?.endElement(); } catch { /* element may not be active */ }
    } else {
      this._svgLayer.pause(this._svgName);
    }
  }
}

/**
 * Find a SMIL animation element by id within an SVG root.
 * @param {SVGSVGElement} root
 * @param {string} id
 * @returns {Element|null}
 */
function findSmilElement(root, id) {
  return root.querySelector(
    `animate[id="${id}"], animateTransform[id="${id}"], animateMotion[id="${id}"]`
  );
}

/**
 * Read duration from a SMIL element (`dur` attribute) if present.
 * @param {Element} el
 * @returns {number} seconds (0 if unknown)
 */
function readSmilDuration(el) {
  const dur = el.getAttribute('dur');
  if (!dur) return 0;
  const m = /^([\d.]+)s$/.exec(dur.trim());
  return m ? parseFloat(m[1]) : 0;
}
