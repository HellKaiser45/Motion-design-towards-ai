/**
 * @module agent-stage/driver/agent-driver
 * AgentDriver: the AI-agent-facing API. Channels are named parallel tracks —
 * packs played on different channels run simultaneously; same-channel
 * playback follows a per-call (or per-channel default) blend policy:
 *   'interrupt' — stop the current instance, later wins (default)
 *   'queue'     — enqueue FIFO; plays when the current instance finishes
 *   'crossfade' — start now, stop the old instance after fadeTime (0.3s)
 *
 * Emits: play / pause / stop / finished / queue-empty with {pack, channel}.
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
    /** @private Map<pack-instance, {channel, fadeUntil}> fading instances */
    this._fading = new Set();

    this._onTick = ({ dt }) => this._tick(dt);
    stage.on('tick', this._onTick);
  }

  on(name, fn) { return this._events.on(name, fn); }
  off(name, fn) { this._events.off(name, fn); }

  /** Set a channel's default blend policy (used when a play() call omits blend). */
  setChannelBlend(channel, blend, fadeTime = 0.3) {
    this._channel(channel).blend = blend;
    this._channel(channel).fadeTime = fadeTime;
  }

  /**
   * Play a registered pack on its declared channel (or opts.channel override).
   * @param {string} packName
   * @param {{channel?:string, loop?:false|'repeat'|'pingpong', rate?:number,
   *          blend?:'interrupt'|'queue'|'crossfade', fadeTime?:number}} [opts]
   * @returns {{instance:object|null, finished:Promise}} instance is null when queued
   */
  play(packName, opts = {}) {
    const pack = this.registry.getPack(packName);
    const channel = opts.channel ?? pack.channel;
    const ch = this._channel(channel);
    const blend = opts.blend ?? ch.blend ?? 'interrupt';

    if (blend === 'queue' && ch.current) {
      return this._enqueue(ch, channel, packName, opts);
    }

    if (blend === 'crossfade' && ch.current) {
      const fadeTime = opts.fadeTime ?? ch.fadeTime ?? 0.3;
      const old = ch.current;
      old._fadeUntil = performance.now() + fadeTime * 1000;
      this._fading.add(old);
    } else if (ch.current) {
      this._stopInstance(ch.current, channel); // interrupt
    }

    const instance = this._startInstance(pack, channel, opts);
    ch.current = instance;
    this._events.emit('play', { pack: packName, channel });
    return { instance, finished: instance.finished };
  }

  /** Enqueue a pack on a channel (FIFO; plays when the current one finishes). */
  queue(packName, opts = {}) {
    const pack = this.registry.getPack(packName);
    const channel = opts.channel ?? pack.channel;
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

  /** @private create + start a running instance */
  _startInstance(pack, channel, opts) {
    pack.play({ loop: opts.loop });
    const instance = {
      pack,
      channel,
      rate: opts.rate && opts.rate > 0 ? opts.rate : 1,
      finished: pack.finished,
    };
    // Looping packs never finish — never chain the handler (belt) and their
    // finished promise is never-resolving (suspenders in CompiledPack).
    if (pack.loop === false) {
      instance.finished.then((result) => this._onInstanceFinished(instance, result));
    }
    if (typeof opts.dur === 'number' && opts.dur > 0) instance._dur = opts.dur;
    return instance;
  }

  /** @private stop an instance and clear its channel slot */
  _stopInstance(instance, channel) {
    instance.pack.stop();
    if (this._fading.has(instance)) this._fading.delete(instance);
    const ch = this._channel(channel ?? instance.channel);
    if (ch.current === instance) ch.current = null;
    this._events.emit('stop', { pack: instance.pack.name, channel: instance.channel });
  }

  /** @private per-frame advance */
  _tick(dt) {
    const now = performance.now();
    for (const [channel, ch] of this._channels) {
      // advance + finish fading crossfaded instances (they must keep ticking
      // through the fade window or they freeze mid-fade)
      for (const inst of [...this._fading]) {
        inst.pack.tick(dt, inst.rate ?? 1);
        if (now >= inst._fadeUntil) {
          this._fading.delete(inst);
          inst.pack.stop();
          this._events.emit('stop', { pack: inst.pack.name, channel: inst.channel });
        }
      }
      const cur = ch.current;
      if (cur) {
        cur.pack.tick(dt, cur.rate);
        // dur-bounded instances (say(dur)): stop once the pack passes dur
        if (cur._dur != null && cur.pack.time >= cur._dur) {
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
        ch.current.pack.pause();
        this._events.emit('pause', { pack: ch.current.pack.name, channel });
      }
    }
  }

  /** Resume paused playback on a channel (or 'all'). */
  resume(which = 'all') {
    for (const [channel, ch] of this._channels) {
      if (which !== 'all' && channel !== which) continue;
      if (ch.current) {
        ch.current.pack.resume();
        this._events.emit('play', { pack: ch.current.pack.name, channel });
      }
    }
  }

  /** Seek every active instance's local playhead to t seconds. */
  seekAll(t) {
    for (const ch of this._channels.values()) {
      if (ch.current) ch.current.pack.seek(t);
    }
  }

  /** @param {string} channel @returns {boolean} */
  isPlaying(channel) {
    const ch = this._channels.get(channel);
    return !!(ch && ch.current && ch.current.pack.playing);
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
   * Minimal speech: plays a 'speak' pack (or opts.pack) and sets `text` into
   * the mounted SVG element the pack declares via `"text": {svg, selector}`.
   * No speak pack registered -> no-op with a console warning.
   * @param {string} text
   * @param {{pack?:string, dur?:number}} [opts]
   */
  say(text, opts = {}) {
    let pack;
    try {
      pack = this.registry.getPack(opts.pack ?? 'speak');
    } catch {
      console.warn('[agent-stage.driver] say(): no speak pack registered — no-op');
      return null;
    }
    if (pack.text) {
      const svg = this.registry.svgLayer.get(pack.text.svg);
      const el = svg?.querySelector(pack.text.selector);
      if (el) el.textContent = text;
    }
    const channel = opts.channel ?? pack.channel ?? 'speak';
    const ch = this._channel(channel);
    if (ch.current) this._stopInstance(ch.current, channel);
    const instance = this._startInstance(pack, channel, { dur: opts.dur });
    ch.current = instance;
    this._events.emit('play', { pack: pack.name, channel });
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

  /** @private called when an instance's finished promise resolves */
  _onInstanceFinished(instance, result) {
    const ch = this._channel(instance.channel);
    if (ch.current === instance) ch.current = null;
    this._events.emit('finished', { pack: instance.pack.name, channel: instance.channel, ...result });
    const next = ch.queue.shift();
    if (next) {
      const pack = this.registry.getPack(next.packName);
      const inst = this._startInstance(pack, next.channel, next.opts);
      ch.current = inst;
      this._events.emit('play', { pack: next.packName, channel: next.channel });
      next.resolveFin(inst.finished);
      if (inst.pack.loop === false) {
        inst.finished.then((r) => this._onInstanceFinished(inst, r));
      }
    } else {
      this._events.emit('queue-empty', { pack: null, channel: instance.channel });
    }
  }
}
