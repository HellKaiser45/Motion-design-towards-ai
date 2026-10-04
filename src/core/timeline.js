/**
 * @module agent-stage/core/timeline
 * Timeline: the conductor. One master clock (owned by Stage) fans out to
 * every live track AND to the Stage clock. seek(t) positions PropEngine,
 * every WAAPI Animation, and every SMIL doc at the same logical time.
 *
 * Time mapping: each track may declare `begin` (offset); effective track
 * time = masterTime - begin.
 *
 * Internal structure keeps `groups` so a later phase can add channels /
 * queues / crossfades as named groups of track handles. Phase 1 uses one
 * implicit group 'default'.
 */
import { EventEmitter } from './events.js';

/** Duck-typed engine interface: { play, pause, seek, stop, duration, update? } */

export class Timeline {
  /**
   * @param {{stage: import('./stage.js').Stage,
   *          propEngine?: import('../engines/prop-engine.js').PropEngine,
   *          waapiEngine?: import('../engines/waapi-engine.js').WaapiEngine,
   *          smilEngine?: import('../engines/smil-engine.js').SmilEngine,
   *          svgLayer?: import('../layers/svg-layer.js').SvgLayer,
   *          threeLayer?: import('../layers/three-layer.js').ThreeLayer}} deps
   */
  constructor({ stage, propEngine, waapiEngine, smilEngine, svgLayer, threeLayer }) {
    if (!stage) throw new Error('[agent-stage.timeline] Timeline requires a stage');
    this.stage = stage;
    this.engines = { propEngine, waapiEngine, smilEngine };
    this.svgLayer = svgLayer;
    this.threeLayer = threeLayer;

    /** @type {Map<string, TrackHandle[]>} named groups (phase 2 extension point) */
    this.groups = new Map([['default', []]]);
    this._events = new EventEmitter();
    this._rate = 1;

    this._onTick = ({ dt, time }) => {
      // Update prop tracks every frame (WAAPI/SMIL self-run in the browser).
      for (const handle of this._allTracks()) {
        const lt = time - handle.begin;
        if (lt < 0) continue; // before begin: hold local 0, never wrap
        if (handle.engine === 'prop' && handle.playing) {
          this.engines.propEngine.update(lt);
        }
        if (handle.engine === 'waapi' && handle.playing) {
          this.engines.waapiEngine.update(lt);
        }
      }
      this._events.emit('tick', { dt, time });
    };
    stage.on('tick', this._onTick);
  }

  /** @returns {EventEmitter-like} on/off/emit passthrough */
  on(name, fn) { return this._events.on(name, fn); }
  off(name, fn) { this._events.off(name, fn); }
  emit(name, payload) { this._events.emit(name, payload); }

  /**
   * Add a track. A "track" is either an engine instance already compiled via
   * `engine.compile(spec)`, or a raw spec compiled here against the matching
   * engine. Returns a handle; the track starts paused.
   * @param {object} input compiled engine instance or spec
   * @param {{begin?:number, group?:string}} [opts]
   * @returns {{engine:string, begin:number, group:string,
   *            play:Function, pause:Function, seek:Function, stop:Function,
   *            duration:number, effectiveTime:Function}}
   */
  add(input, opts = {}) {
    const { engine, compiled } = this._prepare(input);
    const begin = opts.begin ?? input.begin ?? 0;
    if (typeof begin !== 'number' || Number.isNaN(begin) || begin < 0) {
      throw new RangeError('[agent-stage.timeline] track begin must be a number >= 0');
    }
    const groupName = opts.group ?? input.group ?? 'default';
    if (!this.groups.has(groupName)) this.groups.set(groupName, []);

    const duration = compiled.duration ? compiled.duration() : 0;
    const self = this;

    const handle = {
      engine,
      compiled,
      begin,
      group: groupName,
      playing: false,
      duration,
      /** set by pause(); timeline.play() skips these (individually paused) */
      individuallyPaused: false,
      /** set by stop(); timeline.play() skips these until played again */
      stopped: false,
      /** Map master time -> local track time. */
      effectiveTime(masterTime) {
        return masterTime - begin;
      },
      play() {
        this.playing = true;
        this.individuallyPaused = false;
        this.stopped = false;
        compiled.play();
      },
      pause() {
        this.playing = false;
        this.individuallyPaused = true;
        compiled.pause();
      },
      seek(masterTime) {
        // Clamp: before a track's begin, the track sits at its local 0 —
        // mirrors CompiledPack.seek; avoids negative time wrapping into
        // mid-cycle poses on looping tracks.
        compiled.seek(Math.max(0, this.effectiveTime(masterTime)));
      },
      stop() {
        this.playing = false;
        this.stopped = true;
        compiled.stop();
      },
    };

    this.groups.get(groupName).push(handle);
    self._events.emit('track-added', handle);
    return handle;
  }

  /** @private compile-or-adopt input */
  _prepare(input) {
    if (input && typeof input.play === 'function' && typeof input.duration === 'function' && input._spec) {
      // Compiled engine instance (duck-typed).
      const engine = input._spec.engine;
      if (engine === 'prop' && !this.engines.propEngine) throw new Error('[agent-stage.timeline] no propEngine wired');
      return { engine, compiled: input };
    }
    if (!input || typeof input.engine !== 'string') {
      throw new Error('[agent-stage.timeline] add() requires a compiled engine or a spec with engine:"..."');
    }
    switch (input.engine) {
      case 'prop': {
        if (!this.engines.propEngine) throw new Error('[agent-stage.timeline] no propEngine wired');
        const e = new this.engines.propEngine.constructor(this.threeLayer);
        e.compile(input);
        return { engine: 'prop', compiled: e };
      }
      case 'waapi': {
        if (!this.engines.waapiEngine) throw new Error('[agent-stage.timeline] no waapiEngine wired');
        const e = new this.engines.waapiEngine.constructor(this.svgLayer);
        e.compile(input);
        return { engine: 'waapi', compiled: e };
      }
      case 'smil': {
        if (!this.engines.smilEngine) throw new Error('[agent-stage.timeline] no smilEngine wired');
        const e = new this.engines.smilEngine.constructor(this.svgLayer);
        e.compile(input);
        return { engine: 'smil', compiled: e };
      }
      default:
        throw new Error(`[agent-stage.timeline] unknown engine "${input.engine}"`);
    }
  }

  /** All track handles across groups, flattened. */
  _allTracks() {
    const out = [];
    for (const list of this.groups.values()) out.push(...list);
    return out;
  }

  /** Remove a track from the timeline (stops it). */
  remove(handle) {
    const list = this.groups.get(handle.group);
    if (!list) return false;
    const i = list.indexOf(handle);
    if (i < 0) return false;
    handle.stop();
    list.splice(i, 1);
    return true;
  }

  /** Play one track (master-clock aware; track respects master pause implicitly). */
  playTrack(handle) { handle.play(); }
  pauseTrack(handle) { handle.pause(); }
  stopTrack(handle) { handle.stop(); }

  // ---- global fan-out ----

  /** Play master clock + all live tracks (skips individually-paused/stopped tracks). */
  play() {
    for (const h of this._allTracks()) {
      if (!h.individuallyPaused && !h.stopped) h.play();
    }
    this.stage.resumeClock();
    this._events.emit('state', { playing: true });
  }

  pause() {
    for (const h of this._allTracks()) h.pause();
    this.stage.pauseClock();
    this._events.emit('state', { playing: false });
  }

  /**
   * THE key op: position every engine + stage at the same logical time.
   * @param {number} tSec master time (seconds)
   */
  seek(tSec) {
    if (typeof tSec !== 'number' || Number.isNaN(tSec) || tSec < 0) {
      throw new RangeError('[agent-stage.timeline] seek(t) requires t >= 0, got ' + tSec);
    }
    for (const h of this._allTracks()) h.seek(tSec);
    this.stage.seek(tSec);
    this._events.emit('seek', { t: tSec });
  }

  /** Set master time scale, fanned to stage clock AND every engine. */
  setRate(r) {
    if (typeof r !== 'number' || r <= 0 || Number.isNaN(r)) {
      throw new RangeError('[agent-stage.timeline] setRate(r) requires r > 0');
    }
    this._rate = r;
    this.stage.setRate(r);
    // Fan out: WAAPI animations self-run (playbackRate), SMIL doc clocks must
    // track scaled master time. PropEngine needs nothing — it is driven by
    // already-scaled tick dt / timeline seeks.
    this.engines.waapiEngine?.setRate?.(r);
    this.engines.smilEngine?.setRate?.(r);
    this._events.emit('rate', { rate: r });
  }

  /** @returns {number} current master rate */
  get rate() {
    return this._rate;
  }

  /** @returns {number} current master time (seconds) */
  get time() {
    return this.stage.time;
  }

  /** Stop and remove all tracks (per group or all). */
  stopAll(groupName) {
    const lists = groupName ? [this.groups.get(groupName)] : [...this.groups.values()];
    for (const list of lists) {
      if (!list) continue;
      for (const h of list.splice(0)) h.stop();
    }
  }

  /** Longest track duration (any group) — useful for slider bounds. */
  get duration() {
    let max = 0;
    for (const h of this._allTracks()) max = Math.max(max, h.begin + h.duration);
    return max;
  }
}
