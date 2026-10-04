/**
 * @module agent-stage/export/backends/webm-encoder
 * WebmEncoder: deterministic OFFLINE export via FrameRenderer + WebCodecs
 * VP9 encoding, muxed with webm-muxer loaded via DYNAMIC IMPORT at encode
 * time only (this module stays dependency-free at import time).
 *
 * This is the default "webm" path: frames are produced seek-driven at a fixed
 * fps (machine speed is irrelevant), so no MediaRecorder timestamp drift —
 * the output is a valid, constant-frame-rate WebM with a finite Duration
 * (what MLT-based editors like kdenlive require).
 *
 * Alpha: background null => VP9 alpha ('keep') preserves per-pixel
 * transparency. Codec dimensions must be EVEN numbers. If WebCodecs or the
 * CDN muxer is unavailable, ExportManager falls back to WebmRecorder.
 */

import { FrameRenderer } from '../frame-renderer.js';

const MUXER_URL = 'https://cdn.jsdelivr.net/npm/webm-muxer@5/+esm';

export class WebmEncoder {
  /** @returns {boolean} whether the hard requirements (WebCodecs) exist */
  static isAvailable() {
    return typeof VideoEncoder !== 'undefined';
  }

  /**
   * @param {{stage:object, timeline:object, svgLayer:object, engines?:object,
   *          driver?:object, compositor:object,
   *          duration:number, fps?:number, width:number, height:number,
   *          background?:string|null, bitrate?:number,
   *          schedule?:(t:number)=>void, onProgress?:(p:number)=>void,
   *          signal?:{cancelled:boolean}}} opts
   * @returns {Promise<{blob:Blob, filename:string, mimeType:string,
   *                    frames:number, duration:number, fps:number}>}
   */
  async render(opts) {
    if (typeof VideoEncoder === 'undefined') {
      throw new Error('[agent-stage.webmEncoder] WebCodecs (VideoEncoder) is unavailable in this browser.');
    }

    let muxerLib;
    try {
      muxerLib = await import(/* @vite-ignore */ MUXER_URL);
    } catch (err) {
      throw new Error(
        '[agent-stage.webmEncoder] failed to load the webm-muxer CDN module (' + MUXER_URL + '). ' +
        'Original error: ' + (err?.message ?? err)
      );
    }
    const { Muxer, ArrayBufferTarget } = probeMuxerExports(muxerLib);

    let {
      duration, fps = 30, width, height, background = null,
      bitrate, schedule, onProgress, signal,
      stage, timeline, svgLayer, engines, driver, compositor,
    } = opts;

    // VP9 requires even dimensions.
    const evenW = width - (width % 2);
    const evenH = height - (height % 2);
    if (evenW !== width || evenH !== height) {
      console.warn(`[agent-stage.webmEncoder] dimensions rounded to even: ${width}x${height} -> ${evenW}x${evenH}`);
    }
    width = evenW; height = evenH;

    if (typeof bitrate !== 'number' || !(bitrate > 0)) {
      bitrate = Math.max(2_000_000, Math.round(width * height * fps * 0.1));
    }

    const wantsAlpha = background === null || background === undefined;

    const config = {
      codec: 'vp09.00.10.08', // VP9 profile 0, level 1.0, 8-bit
      width, height, bitrate, framerate: fps,
      ...(wantsAlpha ? { alpha: 'keep' } : {}),
    };
    const makeMuxer = (alpha) => new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'V_VP9', width, height, frameRate: fps, alpha },
    });

    // isConfigSupported is advisory on some builds — configure() is the source
    // of truth. If the alpha configuration is rejected, fall back to opaque
    // VP9 rather than failing the whole export.
    let muxer = makeMuxer(wantsAlpha);
    if (wantsAlpha && !(await VideoEncoder.isConfigSupported(config))?.supported) {
      console.warn('[agent-stage.webmEncoder] alpha "keep" not supported by this encoder; using opaque VP9.');
      delete config.alpha;
      muxer = makeMuxer(false);
    }

    // Encoder errors must FAIL the encode, not just log (silent truncation).
    let rejectEncode;
    const encodeFailed = new Promise((_res, rej) => { rejectEncode = rej; });
    // activeMuxer is indirect so a mid-setup alpha fallback can swap it
    // (VideoEncoder.output is readonly once constructed).
    let activeMuxer = muxer;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => activeMuxer.addVideoChunk(chunk, meta),
      error: (e) => rejectEncode(new Error('[agent-stage.webmEncoder] encoder error: ' + (e?.message ?? e))),
    });
    try {
      encoder.configure(config);
    } catch (err) {
      if (!config.alpha) {
        throw new Error('[agent-stage.webmEncoder] VP9 configure() rejected: ' + (err?.message ?? err));
      }
      console.warn('[agent-stage.webmEncoder] alpha "keep" rejected by configure() (' +
        (err?.message ?? err) + '); retrying with opaque VP9.');
      delete config.alpha;
      activeMuxer = makeMuxer(false);
      encoder.configure(config);
    }

    const renderer = new FrameRenderer({ stage, timeline, driver, svgLayer, engines, compositor });
    const renderPromise = renderer.render({
      duration, fps, width, height, background, schedule, signal,
      onFrame: async (canvas, i) => {
        // Backpressure: don't outrun the encoder hardware queue.
        while (encoder.encodeQueueSize > 8) {
          await new Promise((r) => setTimeout(r, 4));
        }
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i / fps) * 1_000_000), // microseconds
          duration: Math.round(1_000_000 / fps),
        });
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
      },
      onProgress,
    });
    const summary = await Promise.race([renderPromise, encodeFailed]);
    renderPromise.catch(() => {}); // avoid unhandled rejection if the encoder errored first

    await Promise.race([encoder.flush(), encodeFailed]);
    encoder.close();
    muxer = activeMuxer;
    muxer.finalize();
    const { buffer } = muxer.target;

    return {
      blob: new Blob([buffer], { type: 'video/webm' }),
      filename: 'agent-stage-export.webm',
      mimeType: 'video/webm',
      frames: summary.frames, duration: summary.duration, fps: summary.fps,
    };
  }
}

/**
 * webm-muxer export names have varied across versions/builds. Probe defensively.
 * @private
 */
function probeMuxerExports(mod) {
  const Muxer = mod.Muxer ?? mod.WebmMuxer?.Muxer ?? mod.default?.Muxer ?? mod.default;
  const ArrayBufferTarget = mod.ArrayBufferTarget ?? mod.WebmMuxer?.ArrayBufferTarget ??
    mod.default?.ArrayBufferTarget;
  if (typeof Muxer !== 'function' || typeof ArrayBufferTarget !== 'function') {
    throw new Error(
      '[agent-stage.webmEncoder] could not find Muxer/ArrayBufferTarget exports in the loaded muxer module. ' +
      'Available keys: ' + Object.keys(mod ?? {}).join(', ')
    );
  }
  return { Muxer, ArrayBufferTarget };
}
