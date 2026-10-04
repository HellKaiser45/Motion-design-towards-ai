/**
 * @module agent-stage/driver/pack-compiler
 * Compiles a JSON animation "pack" into a CompiledPack that drives multiple
 * engines (prop / waapi / smil) in lockstep off one local playhead.
 *
 * PACK SCHEMA
 * {
 *   "name": "greet",              // required, unique
 *   "channel": "body",            // logical channel, default "default"
 *   "duration": 1.6,              // optional seconds; derived from tracks if absent
 *   "loop": false,                // false | "repeat" | "pingpong" (pack-level default)
 *   "tracks": [
 *     { "engine": "prop",  "target": "body",
 *       "props": { "rotation:y": [{"t":0,"v":0,"ease":"easeOutCubic"}, ...] },
 *       "begin"?: 0.2, "loop"?: "repeat"|"pingpong" },
 *     { "engine": "waapi", "svg": "face", "selector": "#mouth",
 *       "keyframes": [{"t":0,"opacity":0}, ...], "options"?: {},
 *       "begin"?: 0, "loop"?: "repeat"|"pingpong" },
 *     { "engine": "smil",  "svg": "face", "mode": "trigger"|"sync",
 *       "animation"?: "smile", "begin"?: 0, "duration"?: 2, // (sync mode)
 *       "loop"?: "repeat" }
 *   ],
 *   "text"?: { "svg": "nametag", "selector": "[data-as-text]" }  // used by AgentDriver.say
 * }
 *
 * Validation errors are thrown with clear messages: unknown engine, missing
 * svg/selector/target, empty keyframes, non-numeric t, empty tracks.
 */

/**
 * @param {object} pack raw pack JSON
 * @param {{threeLayer:object, svgLayer:object, propEngine:object,
 *          waapiEngine:object, smilEngine:object}} ctx compile context
 * @returns {CompiledPack}
 */
export function compile(pack, ctx) {
  if (!pack || typeof pack !== 'object') {
    throw new Error('[agent-stage.packCompiler] compile() requires a pack object');
  }
  if (typeof pack.name !== 'string' || !pack.name) {
    throw new Error('[agent-stage.packCompiler] pack.name (non-empty string) required');
  }
  if (!Array.isArray(pack.tracks) || pack.tracks.length === 0) {
    throw new Error(`[agent-stage.packCompiler] pack "${pack.name}" needs a non-empty tracks array`);
  }

  const channel = pack.channel ?? 'default';
  const packLoop = pack.loop ?? false;
  if (![false, 'repeat', 'pingpong'].includes(packLoop)) {
    throw new Error(`[agent-stage.packCompiler] pack "${pack.name}" loop must be false | "repeat" | "pingpong"`);
  }

  let duration = 0;
  const trackSpecs = [];

  for (const track of pack.tracks) {
    if (!track || typeof track !== 'object') {
      throw new Error(`[agent-stage.packCompiler] pack "${pack.name}" has a non-object track`);
    }
    const begin = track.begin ?? 0;
    if (typeof begin !== 'number' || Number.isNaN(begin) || begin < 0) {
      throw new Error(`[agent-stage.packCompiler] track begin must be a number >= 0 in pack "${pack.name}"`);
    }
    const loop = track.loop ?? packLoop;
    const spec = buildTrackSpec(track, loop, pack.name);

    let inst;
    switch (spec.engine) {
      case 'prop': inst = new ctx.propEngine.constructor(ctx.threeLayer); break;
      case 'waapi': inst = new ctx.waapiEngine.constructor(ctx.svgLayer); break;
      case 'smil': inst = new ctx.smilEngine.constructor(ctx.svgLayer); break;
      default: throw new Error(`[agent-stage.packCompiler] unknown engine "${spec.engine}"`);
    }
    inst.compile(structuredCloneForSpec(spec));

    const td = inst.duration() || 0;
    duration = Math.max(duration, begin + td);
    trackSpecs.push({ spec, inst, begin, engine: spec.engine, fired: false, duration: td });
  }

  if (typeof pack.duration === 'number' && pack.duration > duration) {
    duration = pack.duration;
  }
  if (duration <= 0) duration = 1; // degenerate packs still get a sensible length

  return new CompiledPack(pack.name, channel, duration, packLoop, pack.text ?? null, trackSpecs);
}

/** @private validate + normalize one track into an engine spec */
function buildTrackSpec(track, loop, packName) {
  const withLoop = { ...track, loop: loop === false ? undefined : loop };

  switch (track.engine) {
    case 'prop': {
      if (typeof track.target !== 'string' || !track.target) {
        throw new Error(`[agent-stage.packCompiler] prop track in pack "${packName}" missing "target"`);
      }
      if (!track.props || typeof track.props !== 'object' || !Object.keys(track.props).length) {
        throw new Error(`[agent-stage.packCompiler] prop track in pack "${packName}" missing "props"`);
      }
      for (const [, kfs] of Object.entries(track.props)) {
        if (!Array.isArray(kfs) || !kfs.length) {
          throw new Error(`[agent-stage.packCompiler] empty keyframes in pack "${packName}" prop track`);
        }
        for (const kf of kfs) {
          if (typeof kf.t !== 'number' || Number.isNaN(kf.t)) {
            throw new Error(`[agent-stage.packCompiler] non-numeric keyframe t in pack "${packName}" prop track`);
          }
        }
      }
      return withLoop;
    }
    case 'waapi': {
      if (typeof track.svg !== 'string' || !track.svg) {
        throw new Error(`[agent-stage.packCompiler] waapi track in pack "${packName}" missing "svg"`);
      }
      if (typeof track.selector !== 'string' || !track.selector) {
        throw new Error(`[agent-stage.packCompiler] waapi track in pack "${packName}" missing "selector"`);
      }
      if (!Array.isArray(track.keyframes) || !track.keyframes.length) {
        throw new Error(`[agent-stage.packCompiler] empty keyframes in pack "${packName}" waapi track`);
      }
      for (const kf of track.keyframes) {
        if (typeof kf.t !== 'number' || Number.isNaN(kf.t)) {
          throw new Error(`[agent-stage.packCompiler] non-numeric keyframe t in pack "${packName}" waapi track`);
        }
      }
      return withLoop;
    }
    case 'smil': {
      if (typeof track.svg !== 'string' || !track.svg) {
        throw new Error(`[agent-stage.packCompiler] smil track in pack "${packName}" missing "svg"`);
      }
      if (track.mode !== 'trigger' && track.mode !== 'sync') {
        throw new Error(`[agent-stage.packCompiler] smil track in pack "${packName}" needs mode "trigger"|"sync"`);
      }
      if (track.mode === 'trigger' && !track.animation) {
        throw new Error(`[agent-stage.packCompiler] smil trigger track in pack "${packName}" missing "animation"`);
      }
      return withLoop;
    }
    default:
      throw new Error(`[agent-stage.packCompiler] unknown engine "${track.engine}" in pack "${packName}"`);
  }
}

/** structuredClone with fallback (spec objects are plain JSON, so this is safe) */
function structuredCloneForSpec(spec) {
  try { return structuredClone(spec); } catch { return JSON.parse(JSON.stringify(spec)); }
}

/**
 * A compiled, playable animation unit. One local playhead drives all tracks.
 * The AgentDriver (or harness) advances it via tick(dt, rate); seek(t) is
 * frame-accurate for prop + waapi (smil trigger mode is event-style by design).
 */
export class CompiledPack {
  /** @private use compile() */
  constructor(name, channel, duration, loop, text, trackSpecs) {
    this.name = name;
    this.channel = channel;
    this.duration = duration;
    this.loop = loop;
    this.text = text;
    this._tracks = trackSpecs;
    this._local = 0;
    this._playing = false;
    this._finished = null;
    this._finishedResolve = null;
  }

  /** @returns {object[]} raw engine instances (for advanced/introspection use) */
  get tracks() {
    return this._tracks.map((t) => t.inst);
  }

  /** @returns {boolean} */
  get playing() {
    return this._playing;
  }

  /** @returns {number} local playhead seconds */
  get time() {
    return this._local;
  }

  /**
   * Start from 0. Rebuilds track instances if an overriding loop mode differs.
   * @param {{loop?:false|'repeat'|'pingpong'}} [opts]
   */
  play(opts = {}) {
    if (opts.loop !== undefined && opts.loop !== this.loop) {
      this._rebuildWithLoop(opts.loop);
    }
    this._local = 0;
    this._playing = true;
    this._finished = null;
    this._finishedResolve = null;
    if (this.loop === false) {
      this._finished = new Promise((res) => { this._finishedResolve = res; });
    }
    for (const tr of this._tracks) {
      tr.fired = false;
      if (tr.engine === 'smil' && tr.spec.mode === 'sync') tr.inst.play();
      else if (tr.engine !== 'smil') tr.inst.play();
      // smil trigger fires on the first tick that reaches its begin offset
    }
  }

  /** Pause in place (holds current frame). */
  pause() {
    this._playing = false;
    for (const tr of this._tracks) {
      if (tr.engine === 'smil' && tr.spec.mode === 'trigger') continue; // event-style
      tr.inst.pause();
    }
  }

  /** Resume after pause (keeps playhead). */
  resume() {
    if (this._playing) return;
    this._playing = true;
    for (const tr of this._tracks) {
      if (tr.engine === 'smil' && tr.spec.mode === 'trigger') continue;
      tr.inst.play();
    }
  }

  /** Stop, reset playhead, restore engine state. */
  stop() {
    this._playing = false;
    this._local = 0;
    for (const tr of this._tracks) {
      tr.inst.stop();
      tr.fired = false;
    }
    // An interrupted non-looping pack must still settle its finished promise,
    // otherwise callers awaiting `instance.finished` (e.g. the scripted show
    // chain) hang forever with no error and no resolution.
    if (this._finishedResolve) {
      const res = this._finishedResolve;
      this._finishedResolve = null;
      this._finished = null;
      res({ pack: this.name, channel: this.channel, stopped: true });
    }
  }

  /** Frame-accurate seek of the local playhead (works while paused or playing). */
  seek(t) {
    if (typeof t !== 'number' || Number.isNaN(t) || t < 0) {
      throw new RangeError(`[agent-stage.packCompiler] seek(t) requires t >= 0 on pack "${this.name}"`);
    }
    this._local = t;
    for (const tr of this._tracks) {
      const lt = t - tr.begin;
      if (lt < 0) {
        if (tr.engine === 'prop') tr.inst.update(0);
        else if (tr.engine === 'waapi') tr.inst.seek(0);
        if (tr.fired && tr.engine === 'smil') { tr.inst.stop(); tr.fired = false; }
        continue;
      }
      this._applyTrack(tr, lt);
    }
  }

  /** Advance the playhead; called by the driver/stage each frame while playing. */
  tick(dt, rate = 1) {
    if (!this._playing) return;
    const prev = this._local;
    this._local += dt * rate;
    for (const tr of this._tracks) {
      const lt = this._local - tr.begin;
      const prevLt = prev - tr.begin;
      if (lt < 0) continue;
      if (tr.engine === 'smil' && tr.spec.mode === 'trigger') {
        if (!tr.fired && prevLt < 0) { tr.fired = true; tr.inst.play(); }
        continue;
      }
      this._applyTrack(tr, lt);
    }
    if (this.loop === false && this._local >= this.duration && this._finishedResolve) {
      const res = this._finishedResolve;
      this._finishedResolve = null;
      this._playing = false; // hold last frame
      res({ pack: this.name, channel: this.channel, duration: this.duration });
    }
  }

  /**
   * Resolves when a non-looping pack reaches its duration.
   * Looping packs NEVER finish — a never-resolving promise (stable identity),
   * so callers chaining .then() on it never see a spurious resolution.
   */
  get finished() {
    if (this._finished) return this._finished;
    if (!this._neverFinished) this._neverFinished = new Promise(() => {});
    return this._neverFinished;
  }

  /** @private apply one track at local track time lt */
  _applyTrack(tr, lt) {
    switch (tr.engine) {
      case 'prop': tr.inst.update(lt); break;
      case 'waapi': tr.inst.seek(lt); break;
      case 'smil': tr.inst.seek(lt); break; // sync mode maps doc clock; trigger handled in tick()
      default: break;
    }
  }

  /** @private rebuild track instances with a different loop mode */
  _rebuildWithLoop(loop) {
    if (![false, 'repeat', 'pingpong'].includes(loop)) {
      throw new Error(`[agent-stage.packCompiler] loop override must be false | "repeat" | "pingpong"`);
    }
    for (const tr of this._tracks) tr.inst.stop();
    this.loop = loop;
    for (const tr of this._tracks) {
      const spec = { ...tr.spec };
      spec.loop = loop === false ? undefined : loop;
      tr.spec = spec;
      const engines = { prop: tr.inst, waapi: tr.inst, smil: tr.inst };
      const inst = engines[tr.engine];
      // reuse instance, recompile with the new loop spec
      inst.compile(structuredCloneForSpec(spec));
      tr.duration = inst.duration() || 0;
    }
  }
}
