/**
 * @module agent-stage/driver/pack-compiler
 * Compiles a JSON animation "pack" into an IMMUTABLE CompiledPack definition.
 * Playback happens on PackInstance objects created via createInstance() (or,
 * transparently, via the CompiledPack facade methods for backward compat).
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
 * SEMANTIC TARGETS + COMPACT TRACKS (see docs/pack-schema.md):
 *   Targets are registered via registry.registerTarget(name, binding), where a
 *   binding is { three: 'objectName' } or { svg: 'svgName', selector: '#sel' }.
 *   Engine-less tracks are then rewritten to canonical form:
 *     three: { "target": "body.position.y", "keys": [[0,0],[0.4,0.2,"easeOutCubic"]] }
 *         or { "target": "body", "keys": { "position.y": [[0,0],[1,1]] } }
 *     svg:   { "target": "face.smile", "keys": [{"t":0,"opacity":0}, ...] }
 *            ("keyframes" is an accepted alias of "keys")
 *
 * COMPACT AUTHORING FORMS (normalized by normalizePack, also exported):
 *   keyframe tuples   [0, 0]  [0.5, 1, 'easeOutCubic']   ->  {t, v, ease}
 *   dotted channels   'position.y'                     ->  'position:y'
 * The canonical form keeps working unchanged.
 */

const LOOP_MODES = [false, 'repeat', 'pingpong'];

/**
 * @param {object} pack raw pack JSON
 * @param {{threeLayer:object, svgLayer:object, propEngine:object,
 *          waapiEngine:object, smilEngine:object, registry?:object}} ctx compile context
 * @returns {CompiledPack} immutable pack definition
 */
export function compile(pack, ctx) {
  if (!pack || typeof pack !== 'object') {
    throw new Error('[agent-stage.packCompiler] compile() requires a pack object');
  }
  pack = normalizePack(pack, ctx?.registry);
  if (typeof pack.name !== 'string' || !pack.name) {
    throw new Error('[agent-stage.packCompiler] pack.name (non-empty string) required');
  }
  if (!Array.isArray(pack.tracks) || pack.tracks.length === 0) {
    throw new Error(`[agent-stage.packCompiler] pack "${pack.name}" needs a non-empty tracks array`);
  }

  const channel = pack.channel ?? 'default';
  const packLoop = pack.loop ?? false;
  if (!LOOP_MODES.includes(packLoop)) {
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
    const td = trackDuration(spec);
    duration = Math.max(duration, begin + td);
    trackSpecs.push({ spec, begin, engine: spec.engine, duration: td });
  }

  if (typeof pack.duration === 'number' && pack.duration > duration) {
    duration = pack.duration;
  }
  if (duration <= 0) duration = 1; // degenerate packs still get a sensible length

  return new CompiledPack(pack.name, channel, duration, packLoop, pack.text ?? null, trackSpecs, ctx);
}

const CHANNELS = new Set(['x', 'y', 'z', 'w', 'r', 'g', 'b']);

function isCompactTrack(tr) {
  return tr && typeof tr === 'object' && tr.engine === undefined && typeof tr.target === 'string';
}

function semanticError(target, hasRegistry) {
  const hint = hasRegistry
    ? 'known targets: registry.listTargets()'
    : 'no registry in compile context (ctx.registry) — pass one or use registry.listTargets() after registering targets';
  return new Error(`[agent-stage.packCompiler] unknown semantic target "${target}" — ${hint}`);
}

/**
 * Accept the compact authoring forms an LLM naturally writes and rewrite them to
 * the canonical schema (the canonical form keeps working unchanged):
 *   keyframe tuples   [0, 0], [0.5, 1, 'easeOutCubic']   ->  {t, v, ease}
 *   dotted channels   'position.y'                        ->  'position:y'
 *   engine-less tracks with semantic targets -> canonical engine tracks
 * Pure: returns a new pack, never mutates the input.
 * @param {object} pack
 * @param {object} [registry] optional Registry for semantic-target resolution
 */
export function normalizePack(pack, registry) {
  if (!pack || !Array.isArray(pack.tracks)) return pack;
  const tracks = pack.tracks.map((tr) => {
    if (isCompactTrack(tr)) tr = expandSemanticTrack(tr, registry);
    if (!tr || tr.engine !== 'prop' || !tr.props || typeof tr.props !== 'object') return tr;
    return normalizePropTrack(tr);
  });
  return { ...pack, tracks };
}

/** @private rewrite an engine-less semantic track into canonical form */
function expandSemanticTrack(tr, registry) {
  if (!registry || typeof registry.resolveTarget !== 'function') {
    throw semanticError(tr.target, false);
  }
  const resolved = registry.resolveTarget(tr.target);
  if (!resolved) throw semanticError(tr.target, true);
  const { binding, rest } = resolved;

  const keys = tr.keys ?? tr.keyframes;
  const passthrough = {};
  for (const k of ['begin', 'loop', 'options']) {
    if (tr[k] !== undefined) passthrough[k] = tr[k];
  }

  if (binding.svg !== undefined) {
    if (!Array.isArray(keys) || !keys.length) {
      throw new Error(`[agent-stage.packCompiler] semantic track "${tr.target}" needs a non-empty "keys" array`);
    }
    return normalizeWaapiTrack({ engine: 'waapi', svg: binding.svg, selector: binding.selector, keyframes: keys, ...passthrough });
  }

  // three binding
  let props;
  if (Array.isArray(keys)) {
    if (!rest) {
      throw new Error(`[agent-stage.packCompiler] semantic track "${tr.target}" with array "keys" needs a dotted property target (e.g. "${tr.target}.position.y") or an object "keys" map`);
    }
    props = { [rest]: keys };
  } else if (keys && typeof keys === 'object') {
    props = keys;
  } else {
    throw new Error(`[agent-stage.packCompiler] semantic track "${tr.target}" needs "keys" (array or object map)`);
  }
  return normalizePropTrack({ engine: 'prop', target: binding.three, props, ...passthrough });
}

/** @private normalize tuple keyframes + dotted channels on one prop track */
function normalizePropTrack(tr) {
  const props = {};
  for (const [key, kfs] of Object.entries(tr.props)) {
    let k = key;
    if (!k.includes(':')) {
      const parts = k.split('.');
      if (parts.length > 1 && CHANNELS.has(parts[parts.length - 1])) {
        k = parts.slice(0, -1).join('.') + ':' + parts[parts.length - 1];
      }
    }
    props[k] = Array.isArray(kfs)
      ? kfs.map((kf) => (Array.isArray(kf) ? { t: kf[0], v: kf[1], ...(kf[2] ? { ease: kf[2] } : {}) } : kf))
      : kfs;
  }
  return { ...tr, props };
}

/** @private validate + normalize waapi keyframes (t + numeric check lives in buildTrackSpec) */
function normalizeWaapiTrack(tr) {
  return { ...tr };
}

/** @private spec-derived track duration (no engine instances needed) */
function trackDuration(spec) {
  switch (spec.engine) {
    case 'prop': {
      let d = 0;
      for (const kfs of Object.values(spec.props)) {
        for (const kf of kfs) d = Math.max(d, kf.t);
      }
      return d;
    }
    case 'waapi': {
      let d = 0;
      for (const kf of spec.keyframes) d = Math.max(d, kf.t);
      return d;
    }
    case 'smil':
      return spec.mode === 'sync' ? (spec.duration || 0) : 0;
    default:
      return 0;
  }
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

/** @private build a FRESH engine instance for one track spec */
function buildEngine(spec, ctx) {
  switch (spec.engine) {
    case 'prop': return new ctx.propEngine.constructor(ctx.threeLayer);
    case 'waapi': return new ctx.waapiEngine.constructor(ctx.svgLayer);
    case 'smil': return new ctx.smilEngine.constructor(ctx.svgLayer);
    default: throw new Error(`[agent-stage.packCompiler] unknown engine "${spec.engine}"`);
  }
}

/**
 * One live playback of a CompiledPack definition: holds the engine instances,
 * fired flags, local playhead, and finished-promise machinery. All playback
 * state lives here, never on the definition — two instances of one definition
 * are fully independent.
 */
export class PackInstance {
  /** @private use CompiledPack.createInstance() */
  constructor(definition, loop, tracks) {
    this._def = definition;
    this._loop = loop;
    this._tracks = tracks;
    this._local = 0;
    this._playing = false;
    this._finished = null;
    this._finishedResolve = null;
  }

  /** effective loop mode (the override, if any) */
  get loop() {
    return this._loop;
  }

  get name() { return this._def.name; }
  get channel() { return this._def.channel; }
  get duration() { return this._def.duration; }
  get text() { return this._def.text; }

  /** this instance (driver code pattern `inst.pack.tick(...)` keeps working) */
  get pack() {
    return this;
  }

  /** @returns {object[]} live engine instances */
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

  /** Start from 0. */
  play() {
    this._local = 0;
    this._playing = true;
    this._finished = null;
    this._finishedResolve = null;
    if (this._loop === false) {
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
    // otherwise callers awaiting `instance.finished` hang forever.
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
    if (this._loop === false && this._local >= this.duration && this._finishedResolve) {
      const res = this._finishedResolve;
      this._finishedResolve = null;
      this._playing = false; // hold last frame
      res({ pack: this.name, channel: this.channel, duration: this.duration });
    }
  }

  /**
   * Resolves when a non-looping instance reaches its duration.
   * Looping instances NEVER finish — a never-resolving promise (stable identity).
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
}

/**
 * An IMMUTABLE compiled pack definition: name/channel/duration/loop/text plus
 * per-track {spec, begin, engine, duration}. No live engines, no playback
 * state. Instances (isolated playback state) are created via createInstance();
 * the play/pause/... facade below delegates to a lazily-created internal
 * default instance for backward compatibility.
 */
export class CompiledPack {
  /** @private use compile() */
  constructor(name, channel, duration, loop, text, trackSpecs, ctx) {
    this.name = name;
    this.channel = channel;
    this.duration = duration;
    this.loop = loop;
    this.text = text;
    // private, non-enumerable: compile context + immutable track specs
    Object.defineProperty(this, '_ctx', { value: ctx });
    Object.defineProperty(this, '_specs', { value: trackSpecs });
    Object.defineProperty(this, '_defaultInstance', { value: null, writable: true });
  }

  /**
   * Create an isolated playback instance of this definition.
   * @param {false|'repeat'|'pingpong'} [loopOverride] defaults to the definition's loop
   * @returns {PackInstance}
   */
  createInstance(loopOverride = this.loop) {
    if (!LOOP_MODES.includes(loopOverride)) {
      throw new Error('[agent-stage.packCompiler] loop override must be false | "repeat" | "pingpong"');
    }
    const ctx = this._ctx;
    if (!ctx) throw new Error('[agent-stage.packCompiler] definition has no compile context — cannot instantiate');
    const tracks = this._specs.map((ts) => {
      const spec = structuredCloneForSpec(ts.spec);
      spec.loop = loopOverride === false ? undefined : loopOverride;
      const inst = buildEngine(spec, ctx);
      inst.compile(structuredCloneForSpec(spec));
      return { spec, inst, begin: ts.begin, engine: ts.engine, fired: false, duration: inst.duration() || 0 };
    });
    return new PackInstance(this, loopOverride, tracks);
  }

  // ---- backward-compatible facade (delegates to a default instance) ----

  /** @returns {object[]} live engine instances of the default instance */
  get tracks() {
    return this._default().tracks;
  }

  /** @returns {boolean} */
  get playing() {
    return this._defaultInstance?.playing ?? false;
  }

  /** @returns {number} local playhead seconds */
  get time() {
    return this._defaultInstance?.time ?? 0;
  }

  /**
   * Start (or restart) the default instance from 0. A loop override that
   * differs from the definition's loop creates a FRESH default instance with
   * that mode — the definition's own `loop` is never mutated.
   * @param {{loop?:false|'repeat'|'pingpong'}} [opts]
   */
  play(opts = {}) {
    if (opts.loop !== undefined && !LOOP_MODES.includes(opts.loop)) {
      throw new Error('[agent-stage.packCompiler] loop override must be false | "repeat" | "pingpong"');
    }
    if (opts.loop !== undefined && opts.loop !== this._defaultInstance?._loop) {
      if (this._defaultInstance) this._defaultInstance.stop();
      this._defaultInstance = this.createInstance(opts.loop);
    }
    this._default().play();
  }

  /** Pause the default instance in place. */
  pause() {
    this._defaultInstance?.pause();
  }

  /** Resume the default instance after pause. */
  resume() {
    this._defaultInstance?.resume();
  }

  /** Stop the default instance and reset its playhead. */
  stop() {
    this._defaultInstance?.stop();
  }

  /** Frame-accurate seek of the default instance's playhead. */
  seek(t) {
    this._default().seek(t);
  }

  /** Advance the default instance's playhead. */
  tick(dt, rate = 1) {
    if (this._defaultInstance) this._defaultInstance.tick(dt, rate);
  }

  /**
   * Resolves when the default (non-looping) instance reaches its duration.
   * Looping instances NEVER finish — a never-resolving promise (stable identity).
   */
  get finished() {
    // No instantiation side effect on read: if the default instance has never
    // been created, return a never-resolving promise instead.
    return this._defaultInstance?.finished ?? new Promise(() => {});
  }

  /** @private get (or lazily create) the internal default instance */
  _default() {
    if (!this._defaultInstance) this._defaultInstance = this.createInstance();
    return this._defaultInstance;
  }
}
