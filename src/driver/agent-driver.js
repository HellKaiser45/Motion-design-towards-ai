/**
 * @module agent-stage/driver/agent-driver
 * AgentDriver: the AI-agent-facing API. Channels are named parallel tracks —
 * packs played on different channels run simultaneously; same-channel
 * playback follows a per-call (or per-channel default) blend policy:
 *   'interrupt' — stop the current instance, later wins (default)
 *   'queue'     — enqueue FIFO; plays when the current instance finishes
 *   'crossfade' — start now, stop the old instance after fadeTime (0.3s)
 *
 * Every play() obtains an ISOLATED instance from the pack definition via
 * `def.createInstance(loopOverride)` (legacy fallback: the def itself), so
 * concurrent plays never share mutable playback state.
 *
 * Emits: play / pause / stop / finished / queued / queue-empty with {pack, channel}.
 * Every play() returns { instance, finished }.
 */
import { EventEmitter } from '../core/events.js';

export class AgentDriver {
  /**
   * @param {{stage:object, timeline:object, registry:object, ctx:object}} deps
   *        ctx = { threeLayer, svgLayer, propEngine, waapiEngine, smilEngine }
   */
  constructor({ stage, timeline, registry, ctx }) {
    if (!stage || !registry || !ctx) {
      throw new Error('[agent-stage.driver] requires { stage, registry, ctx }');
    }
    this.stage = stage;
    this.timeline = timeline;
    this.registry = registry;
    this.ctx = ctx;
    this._events = new EventEmitter();
    /** @private Map<string, {current:null, queue:[], blend?:string, fadeTime?:number}> */
    this._channels = new Map();
    /** @private Set<instance> fading instances (crossfaded out; still ticking) */
    this._fading = new Set();
    /** @private WeakMap<instance, {rate, dur, fadeLeft, stopped}> per-instance driver state */
    this._meta = new WeakMap();

    this._onTick = ({ dt }) => this._tick(dt);
    stage.on('tick', this._onTick);
  }

  on(name, fn) { return this._events.on(name, fn); }
  off(name, fn) { return this._events.off(name, fn); }

  /** Set a channel's default blend policy (used when a play() call omits blend). */
  setChannelBlend(channel, blend, fadeTime = 0.3) {
    this._channel(channel).blend = blend;
    this._channel(channel).fadeTime = fadeTime;
  }

  /**
   * Play a registered pack on its declared channel (or opts.channel override).
   * @param {string} packName
   * @param {{channel?:string, loop?:false|'repeat'|'pingpong', rate?:number,
 *          blend?:'interrupt'|'queue'|'crossfade', fadeTime?:number, dur?:number}} [opts]
 * @returns {{instance:object|null, finished:Promise}} instance is null when queued
   */
  play(packName, opts = {}) {
    const def = this.registry.getPack(packName);
    const channel = opts.channel ?? def.channel;
    const ch = this._channel(channel);
    const blend = opts.blend ?? ch.blend ?? 'interrupt';

    if (blend === 'queue' && ch.current) {
      return this._enqueue(ch, channel, packName, opts);
    }

    if (blend === 'crossfade' && ch.current) {
      const fadeTime = opts.fadeTime ?? ch.fadeTime ?? 0.3;
      const meta = this._meta.get(ch.current);
      if (meta) meta.fadeLeft = fadeTime; // seconds of LOGICAL time (dt-driven => seek/export-deterministic)
      this._fading.add(ch.current);
    } else if (ch.current) {
      this._stopInstance(ch.current, channel); // interrupt
    }

    const instance = this._startInstance(def, channel, opts);
    ch.current = instance;
    this._events.emit('play', { pack: packName, channel });
    return { instance, finished: instance.finished };
  }

  /** Enqueue a pack on a channel (FIFO; plays when the current one finishes). */
  queue(packName, opts = {}) {
    const def = this.registry.getPack(packName);
    const channel = opts.channel ?? def.channel;
    const ch = this._channel(channel);
    return this._enqueue(ch, channel, packName, opts);
  }

  /** @private */
  _enqueue(ch, channel, packName, opts) {
    let resolveFin;
    const finished = new Promise((res) => { resolveFin = res; });
    ch.queue.push({ packName, opts, channel, resolveFin });
    this._events.emit('queued', { pack: packName, channel, depth: ch.queue.length });
    return { instance: null, finished };
  }

  /** @private create (or adopt) an instance and start it running */
  _startInstance(def, channel, opts) {
    const inst = typeof def.createInstance === 'function'
      ? def.createInstance(opts.loop)
      : def; // legacy fallback: the definition doubles as its own (shared) instance
    inst.play(typeof def.createInstance === 'function'
      ? {}
      : (opts.loop !== undefined ? { loop: opts.loop } : {}));
    const meta = {
      rate: opts.rate && opts.rate > 0 ? opts.rate : 1,
      dur: null,
      fadeLeft: 0,
      stopped: false,
      channel,
    };
    this._meta.set(inst, meta);
    if (typeof opts.dur === 'number' && opts.dur > 0) meta.dur = opts.dur;
    // Exactly one finished handler per instance. Looping packs never finish —
    // never chain the handler (belt) and their finished promise is never-resolving.
    if (inst.loop === false) {
      inst.finished.then((result) => this._onInstanceFinished(inst, result));
    }
    return inst;
  }

  /** @private stop an instance and clear its channel slot */
  _stopInstance(instance, channel) {
    const meta = this._meta.get(instance);
    if (!meta || meta.stopped) return;
    meta.stopped = true;
    instance.stop();
    this._fading.delete(instance);
    const effective = meta.channel ?? instance.channel;
    const ch = this._channel(channel ?? effective);
    if (ch.current === instance) ch.current = null;
    this._events.emit('stop', { pack: instance.name, channel: effective });
  }

  /** @private per-frame advance */
  _tick(dt) {
    // Fading (crossfaded-out) instances: advance ONCE per frame, driven by dt
    // (never performance.now() => seek/export-deterministic).
    for (const inst of [...this._fading]) {
      const meta = this._meta.get(inst);
      inst.tick(dt, meta.rate);
      meta.fadeLeft -= dt;
      if (meta.fadeLeft <= 0) {
        this._stopInstance(inst, meta.channel ?? inst.channel);
      }
    }
    for (const [channel, ch] of this._channels) {
      const cur = ch.current;
      if (cur) {
        const meta = this._meta.get(cur);
        cur.tick(dt, meta.rate);
        // dur-bounded instances (say(dur)): stop once the pack passes dur
        if (meta.dur != null && cur.time >= meta.dur) {
          this._stopInstance(cur, channel);
        }
      }
    }
  }

  /**
   * Stop current playback on a channel (or 'all'). Queued items are dropped.
   * @param {string} [which='all']
   */
  stop(which = 'all') {
    for (const [channel, ch] of this._channels) {
      if (which !== 'all' && channel !== which) continue;
      if (ch.current) this._stopInstance(ch.current, channel);
      for (const q of ch.queue.splice(0)) q.resolveFin({ pack: q.packName, channel, stopped: true });
      this._events.emit('stop', { pack: null, channel });
    }
  }

  /** Pause current playback on a channel (or 'all'). */
  pause(which = 'all') {
    for (const [channel, ch] of this._channels) {
      if (which !== 'all' && channel !== which) continue;
      if (ch.current) {
        ch.current.pause();
        this._events.emit('pause', { pack: ch.current.name, channel });
      }
    }
  }

  /** Resume paused playback on a channel (or 'all'). */
  resume(which = 'all') {
    for (const [channel, ch] of this._channels) {
      if (which !== 'all' && channel !== which) continue;
      if (ch.current) {
        ch.current.resume();
        this._events.emit('play', { pack: ch.current.name, channel });
      }
    }
  }

  /** Seek every active instance's local playhead to t seconds. */
  seekAll(t) {
    for (const ch of this._channels.values()) {
      if (ch.current) ch.current.seek(t);
    }
  }

  /** @param {string} channel @returns {boolean} */
  isPlaying(channel) {
    const ch = this._channels.get(channel);
    return !!(ch && ch.current && ch.current.playing);
  }

  /** @param {string} channel @returns {object|null} the active pack instance */
  active(channel) {
    const ch = this._channels.get(channel);
    return ch?.current ?? null;
  }

  // ---- convenience intents (channel mapping) ----

  /** Face expression pack on the 'face' channel. */
  emote(name, opts = {}) {
    return this.play(name, { ...opts, channel: 'face' });
  }

  /** Body motion pack on the 'body' channel. */
  motion(name, opts = {}) {
    return this.play(name, { ...opts, channel: 'body' });
  }

  /** HUD overlay pack on the 'hud' channel. */
  hud(name, opts = {}) {
    return this.play(name, { ...opts, channel: 'hud' });
  }

  /** Play (on=true) or stop (on=false) a looping state pack on the 'state' channel. */
  state(name, on = true) {
    if (on) return this.play(name, { channel: 'state' });
    this.stop('state');
    return null;
  }

  /**
   * Minimal speech: plays a 'speak' pack (or opts.pack) on an isolated instance
   * and sets `text` into the mounted SVG element the pack declares via
   * `"text": {svg, selector}`. dur-bounds it when opts.dur is given.
   * No speak pack registered -> no-op with a console warning.
   * @param {string} text
   * @param {{pack?:string, dur?:number, channel?:string}} [opts]
   */
  say(text, opts = {}) {
    let def;
    try {
      def = this.registry.getPack(opts.pack ?? 'speak');
    } catch {
      console.warn('[agent-stage.driver] say(): no speak pack registered — no-op');
      return null;
    }
    if (def.text) {
      const svg = this.registry.svgLayer.get(def.text.svg);
      const el = svg?.querySelector(def.text.selector);
      if (el) el.textContent = text;
    }
    const channel = opts.channel ?? def.channel ?? 'speak';
    const ch = this._channel(channel);
    if (ch.current) this._stopInstance(ch.current, channel);
    const instance = this._startInstance(def, channel, { dur: opts.dur });
    ch.current = instance;
    this._events.emit('play', { pack: def.name, channel });
    return { instance, finished: instance.finished };
  }

  /** @private get-or-create channel state */
  _channel(name) {
    let ch = this._channels.get(name);
    if (!ch) {
      ch = { current: null, queue: [], blend: undefined, fadeTime: undefined };
      this._channels.set(name, ch);
    }
    return ch;
  }

  /**
   * @private called when an instance's finished promise resolves.
   * Starts the next queued instance via the SAME _startInstance path (which
   * attaches the single finished handler). A stale call (instance no longer
   * the channel's current, or already stopped) is a no-op.
   */
  _onInstanceFinished(instance, result) {
    const meta = this._meta.get(instance);
    if (!meta || meta.stopped) return;
    const channel = meta.channel ?? instance.channel;
    const ch = this._channel(channel);
    if (ch.current !== instance) return;
    ch.current = null;
    this._events.emit('finished', { pack: instance.name, channel, ...result });
    const next = ch.queue.shift();
    if (next) {
      const pack = this.registry.getPack(next.packName);
      const inst = this._startInstance(pack, next.channel, next.opts);
      ch.current = inst;
      this._events.emit('play', { pack: next.packName, channel: next.channel });
      next.resolveFin(inst.finished);
    } else {
      this._events.emit('queue-empty', { pack: null, channel });
    }
  }
}
