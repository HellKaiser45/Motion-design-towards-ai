/**
 * @module agent-stage/export/backends/mp4-encoder
 * Mp4Encoder: deterministic offline export via FrameRenderer + WebCodecs
 * H.264 (avc) encoding, muxed with mp4-muxer loaded via DYNAMIC IMPORT at
 * encode time only (this module stays dependency-free at import time).
 *
 * Caveats handled honestly:
 *  - MP4/H.264 cannot carry alpha: if background is null a solid background
 *    is forced (#101014) with a console warning.
 *  - Codec dimensions must be EVEN numbers; odd sizes are rounded down.
 *  - If WebCodecs or the CDN muxer is unavailable, a clear error is thrown
 *    listing supported alternatives (WebM, PNG sequence).
 */

import { FrameRenderer } from '../frame-renderer.js';

// Same +esm pattern as webm-encoder (verified 200, ES module). The historical
// /built/ path 404s on jsdelivr; /build/ is kept as a fallback candidate.
const MUXER_URLS = [
  'https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm',
  'https://cdn.jsdelivr.net/npm/mp4-muxer@5/build/mp4-muxer.min.js',
];
const FALLBACK_BG = '#101014';

export class Mp4Encoder {
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
      throw new Error(
        '[agent-stage.mp4Encoder] WebCodecs (VideoEncoder) is unavailable in this browser. ' +
        'Supported alternatives: "webm" (MediaRecorder) or "png-seq" (ZIP of PNGs).'
      );
    }

    let muxerLib = null, lastErr = null;
    for (const url of MUXER_URLS) {
      try { muxerLib = await import(/* @vite-ignore */ url); break; }
      catch (err) { lastErr = err; }
    }
    if (!muxerLib) {
      throw new Error(
        '[agent-stage.mp4Encoder] failed to load the mp4-muxer CDN module (' + MUXER_URLS.join(', ') + '). ' +
        'Check connectivity, or use "webm" / "png-seq" export. Original error: ' + (lastErr?.message ?? lastErr)
      );
    }
    const { Muxer, ArrayBufferTarget } = probeMuxerExports(muxerLib);

    let {
      duration, fps = 30, width, height, background = null,
      bitrate = 8_000_000, schedule, onProgress, signal,
      stage, timeline, svgLayer, engines, driver, compositor,
    } = opts;

    // H.264 requires even dimensions.
    const evenW = width - (width % 2);
    const evenH = height - (height % 2);
    if (evenW !== width || evenH !== height) {
      console.warn(`[agent-stage.mp4Encoder] dimensions rounded to even: ${width}x${height} -> ${evenW}x${evenH}`);
    }
    width = evenW; height = evenH;

    // Alpha is not possible in MP4.
    if (background === null || background === undefined) {
      background = FALLBACK_BG;
      console.warn('[agent-stage.mp4Encoder] MP4 cannot carry alpha; a solid background "' +
        FALLBACK_BG + '" was applied. Use WebM or PNG-sequence for alpha.');
    }

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: fps },
      fastStart: 'in-memory',
    });

    const config = {
      codec: 'avc1.42001f', // baseline profile, level 3.1 — probe accepts higher automatically
      width, height, bitrate, framerate: fps,
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support?.supported) {
      // retry with a higher level / main profile as a fallback probe
      const alt = { ...config, codec: 'avc1.4d0028' };
      const altSupport = await VideoEncoder.isConfigSupported(alt);
      if (!altSupport?.supported) {
        throw new Error('[agent-stage.mp4Encoder] no supported H.264 (avc) encoder configuration found. Use "webm" or "png-seq".');
      }
      config.codec = alt.codec;
    }

    // Encoder errors must FAIL the export, not just log (silent truncation).
    let rejectEncode;
    const encodeFailed = new Promise((_res, rej) => { rejectEncode = rej; });
    // Chrome can emit metadata.colorSpace = null; mp4-muxer dereferences
    // colorSpace unconditionally, so strip null/empty colorSpace objects.
    const sanitizeMeta = (meta) => {
      if (!meta) return meta;
      if (!meta.colorSpace || typeof meta.colorSpace !== 'object') {
        const { colorSpace, ...rest } = meta;
        return rest;
      }
      return meta;
    };
    let lastMeta = null;
    const encoder = new VideoEncoder({
      // NB: chunk.metadata is always null in Chrome; the decoderConfig comes
      // via the callback's second argument (and only on the first chunk).
      output: (chunk, meta) => {
        if (meta && Object.keys(meta).length) lastMeta = meta;
        muxer.addVideoChunk(chunk, sanitizeMeta(meta && Object.keys(meta).length ? meta : lastMeta));
      },
      error: (e) => rejectEncode(new Error('[agent-stage.mp4Encoder] encoder error: ' + (e?.message ?? e))),
    });
    encoder.configure(config);

    const renderer = new FrameRenderer({ stage, timeline, driver, svgLayer, engines, compositor });
    const renderPromise = renderer.render({
      duration, fps, width, height, background, schedule, signal,
      onFrame: async (canvas, i) => {
        // Backpressure: don't outrun the encoder hardware queue.
        while (encoder.encodeQueueSize > 8) {
          await new Promise((r) => setTimeout(r, 4));
        }
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i / fps) * 1_000_000),
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
    muxer.finalize();
    const { buffer } = muxer.target;

    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      filename: 'agent-stage-export.mp4',
      mimeType: 'video/mp4',
      frames: summary.frames, duration: summary.duration, fps: summary.fps,
    };
  }
}

/**
 * mp4-muxer export names have varied across versions (Muxer / Mp4Muxer / …).
 * Probe defensively.
 * @private
 */
function probeMuxerExports(mod) {
  const Muxer = mod.Muxer ?? mod.Mp4Muxer?.Muxer ?? mod.default?.Muxer ?? mod.default;
  const ArrayBufferTarget = mod.ArrayBufferTarget ?? mod.Mp4Muxer?.ArrayBufferTarget ??
    mod.default?.ArrayBufferTarget;
  if (typeof Muxer !== 'function' || typeof ArrayBufferTarget !== 'function') {
    throw new Error(
      '[agent-stage.mp4Encoder] could not find Muxer/ArrayBufferTarget exports in the loaded muxer module. ' +
      'Available keys: ' + Object.keys(mod ?? {}).join(', ')
    );
  }
  return { Muxer, ArrayBufferTarget };
}