/**
 * @module agent-stage/export/export-manager
 * ExportManager: the facade over the export subsystem.
 *
 *   const em = new ExportManager({ stage, timeline, driver, svgLayer, engines, compositor });
 *   const res = await em.export('webm', { duration: 6, fps: 30, width: 1280, height: 720,
 *                                          packsToPlay: [{ name: 'greet', at: 0.5 }], onProgress });
 *   em.download(res.blob, res.filename);
 *
 * packsToPlay accepts:
 *   - [{ name, channel?, at?, loop? }] (at = seconds into the export, default 0)
 *   - a script object { [tSec]: packName }  (e.g. { "0": "idle", "1.5": "greet" })
 *   - omitted: the live scene is captured as-is (frozen/seek-driven)
 * or pass a raw `schedule(t)` hook for full control.
 *
 * Cancellation: opts.signal = { cancelled: boolean } (AbortSignal-like).
 */

import { Compositor } from './compositor.js';
import { FrameRenderer } from './frame-renderer.js';
import { WebmRecorder } from './backends/webm-recorder.js';
import { WebmEncoder } from './backends/webm-encoder.js';
import { PngSequence } from './backends/png-sequence.js';
import { Mp4Encoder } from './backends/mp4-encoder.js';

export class ExportManager {
  /**
   * @param {{stage:object, timeline:object, driver?:object, svgLayer:object,
   *          engines?:object, compositor?:Compositor, anchorBridge?:object,
   *          textureBridge?:object}} deps
   */
  constructor({ stage, timeline, driver, svgLayer, engines, compositor,
    anchorBridge, textureBridge }) {
    if (!stage || !timeline || !svgLayer) {
      throw new Error('[agent-stage.exportManager] requires { stage, timeline, svgLayer }');
    }
    this.stage = stage;
    this.timeline = timeline;
    this.driver = driver ?? null;
    this.svgLayer = svgLayer;
    this.engines = engines ?? null;
    this.compositor = compositor ?? new Compositor();
    this.anchorBridge = anchorBridge ?? null;
    this.textureBridge = textureBridge ?? null;
  }

  /**
   * Which export formats this browser can do.
   * @returns {{webm:boolean, mp4:boolean, pngSeq:boolean, webCodecs:boolean,
   *            notes:string[]}}
   */
  static supported() {
    const notes = [];
    const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
    const hasCaptureStream = typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
    const webCodecs = typeof VideoEncoder !== 'undefined';
    const mp4 = webCodecs; // muxer is loaded lazily at encode time
    // 'webm' prefers the deterministic WebCodecs VP9 encoder; the real-time
    // MediaRecorder recorder is only a fallback path.
    const webm = webCodecs || (hasMediaRecorder && hasCaptureStream &&
      ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .some((m) => MediaRecorder.isTypeSupported(m)));
    if (webCodecs) {
      notes.push('webm: WebCodecs VP9 (offline, alpha-capable) — MediaRecorder fallback if encoding fails.');
    } else if (hasMediaRecorder && !webm) {
      notes.push('MediaRecorder present but no WebM codec support (some Safari builds) — use PNG sequence.');
    } else if (webm) {
      notes.push('webm: real-time MediaRecorder fallback (WebCodecs unavailable) — output is live-paced.');
    }
    if (!webCodecs) notes.push('WebCodecs unavailable — MP4 export unsupported.');
    return { webm, mp4, pngSeq: true, webCodecs, notes };
  }

  /**
   * Run an export.
   * @param {'webm'|'png-seq'|'mp4'} format
   * @param {{duration?:number, fps?:number, width?:number, height?:number,
 *          background?:string|null, packsToPlay?:Array|object,
   *          schedule?:(t:number)=>void, onProgress?:(p:number)=>void,
   *          signal?:{cancelled:boolean}}} [opts]
   * @returns {Promise<{blob:Blob, filename:string, mimeType:string,
   *                    frames?:number, duration?:number, fps?:number}>}
   */
  async export(format, opts = {}) {
    const {
      duration = 5, fps = 30,
      width = this.stage.canvas.width, height = this.stage.canvas.height,
      background = null, packsToPlay, schedule, onProgress, signal,
    } = opts;

    const hook = schedule ?? (packsToPlay ? makePackScheduler(this.driver, packsToPlay) : null);

    const common = {
      driver: this.driver, compositor: this.compositor,
      anchorBridge: this.anchorBridge, textureBridge: this.textureBridge,
      duration, fps, width, height, background, onProgress, signal,
    };

    switch (format) {
      case 'webm': {
        const args = {
          stage: this.stage, timeline: this.timeline, svgLayer: this.svgLayer,
          engines: this.engines, ...common, schedule: hook,
        };
        // Default path: deterministic offline VP9 encode. Fall back to the
        // real-time MediaRecorder recorder when WebCodecs/muxer is missing
        // or the encode fails — never fail the export outright.
        if (WebmEncoder.isAvailable()) {
          try {
            return await new WebmEncoder().render(args);
          } catch (err) {
            console.warn('[agent-stage.exportManager] WebmEncoder failed, falling back to WebmRecorder:', err?.message ?? err);
          }
        }
        return new WebmRecorder().record(args);
      }
      case 'png-seq': {
        const seq = new PngSequence();
        return seq.render({
          stage: this.stage, timeline: this.timeline, svgLayer: this.svgLayer,
          engines: this.engines, ...common, schedule: hook,
        });
      }
      case 'mp4': {
        const enc = new Mp4Encoder();
        return enc.render({
          stage: this.stage, timeline: this.timeline, svgLayer: this.svgLayer,
          engines: this.engines, ...common, schedule: hook,
        });
      }
      default:
        throw new Error(`[agent-stage.exportManager] unknown export format "${format}" (webm | png-seq | mp4)`);
    }
  }

  /** Trigger a browser download of an exported blob. */
  download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Exposed for advanced use. */
  get frameRenderer() {
    return new FrameRenderer({
      stage: this.stage, timeline: this.timeline, driver: this.driver,
      svgLayer: this.svgLayer, engines: this.engines, compositor: this.compositor,
      anchorBridge: this.anchorBridge, textureBridge: this.textureBridge,
    });
  }
}

/**
 * Build a per-frame schedule hook from a packsToPlay spec. The hook starts
 * each pack at its `at` threshold (driver.play — so driver events fire, e.g.
 * HUD state updates), positions it at local time t-at, and leaves it for the
 * FrameRenderer's freeze pass (paused = deterministic).
 * @private
 */
export function makePackScheduler(driver, packsToPlay) {
  if (!driver) {
    throw new Error('[agent-stage.exportManager] packsToPlay requires a driver');
  }
  let entries;
  if (Array.isArray(packsToPlay)) {
    entries = packsToPlay.map((p) => ({
      name: p.name, channel: p.channel, loop: p.loop,
      at: typeof p.at === 'number' ? p.at : 0, started: false, instance: null,
    }));
  } else if (packsToPlay && typeof packsToPlay === 'object') {
    entries = Object.entries(packsToPlay).map(([at, name]) => ({
      name, at: parseFloat(at) || 0, started: false, stopped: false, instance: null,
    }));
  } else {
    throw new Error('[agent-stage.exportManager] packsToPlay must be an array or a {[tSec]: packName} object');
  }
  entries.sort((a, b) => a.at - b.at);

    return function schedule(t) {
    for (const e of entries) {
      if (e.instance && !e.stopped && t >= (e.endAt ?? Infinity)) {
        e.stopped = true;
        // Only stop the channel if THIS instance is still the active one; if
        // a later pack took over the channel, leaving it running is correct.
        const channel = e.channel ?? e.instance.channel;
        if (driver.active(channel) === e.instance) {
          driver.stop(channel);
        } else {
          delete e.instance; // the channel moved on — drop our stale ref
        }
      }
      if (e.started || t < e.at) continue;
      e.started = true;
      const { instance } = driver.play(e.name, {
        channel: e.channel, loop: e.loop, blend: 'interrupt',
      });
      e.instance = instance;
      // Non-looping packs: compute their end for auto-stop.
      if (instance && instance.pack && instance.pack.loop === false) {
        e.endAt = e.at + instance.pack.duration;
      }
    }
    // Position every started, non-stopped instance at its local time. Skip
    // instances that were interrupted on their channel by a later entry — a
    // dead instance's PropEngine would overwrite the live pack's pose on the
    // shared Three.js object.
    for (const e of entries) {
      if (!e.instance || e.stopped) continue;
      const channel = e.channel ?? e.instance.channel;
      if (driver.active(channel) !== e.instance) continue;
      e.instance.pack.seek(t - e.at);
    }
  };
}
