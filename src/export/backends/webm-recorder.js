/**
 * @module agent-stage/export/backends/webm-recorder
 * WebmRecorder: REAL-TIME capture backend (alpha capable; FALLBACK for when
 * WebCodecs is unavailable). Uses canvas.captureStream(0) + MediaRecorder and
 * pushes exactly ONE canvas frame per composited tick via
 * track.requestFrame(), paced by a drift-corrected timer. captureStream(0)
 * means the browser never auto-captures on its own schedule, so the encoded
 * frame sequence is monotonic and free of duplicate/drifted frames even when
 * the main thread janks under compositor load (broken VFR WebM was the
 * failure mode of the old captureStream(fps) approach).
 *
 * Mime probing order: vp9 -> vp8 -> generic webm (isTypeSupported).
 * Per frame: compositor.captureFrameSync() (WebGL drawImage is synchronous;
 * SVG rasters come from the markup cache, re-encoded fire-and-forget when
 * markup changes). Background null => per-pixel alpha preserved in VP8/VP9
 * WebM (playback of alpha WebM: Chromium supports it).
 */

export class WebmRecorder {
  /** @returns {string|null} best supported webm mime */
  static pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
  }

  /**
   * @param {{stage:object, timeline:object, svgLayer:object, engines?:object,
   *          driver?:object, compositor:object,
   *          duration:number, fps?:number, width:number, height:number,
   *          background?:string|null, videoBitsPerSecond?:number,
   *          schedule?:(t:number)=>void, onProgress?:(p:number)=>void,
   *          signal?:{cancelled:boolean}}} opts
   * @returns {Promise<{blob:Blob, filename:string, mimeType:string}>}
   */
  async record(opts) {
    const {
      stage, timeline, svgLayer, engines, driver, compositor,
      duration, fps = 30, width, height, background = null,
      videoBitsPerSecond = 8_000_000,
      schedule, onProgress, signal,
    } = opts;
    if (!stage || !compositor) {
      throw new Error('[agent-stage.webmRecorder] record() requires { stage, compositor }');
    }
    const mimeType = WebmRecorder.pickMime();
    if (!mimeType) {
      throw new Error('[agent-stage.webmRecorder] MediaRecorder with WebM is not supported in this browser. Try the PNG-sequence backend.');
    }

    const exportCanvas = compositor.ensureCanvas(width, height);
    const stream = exportCanvas.captureStream(0); // manual frame push only
    const track = stream.getVideoTracks()[0];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    const ctx = { stage, svgLayer, width, height, background, engines };
    const wasPlaying = stage.playing;

    // Freeze the live clock; we drive frames ourselves on a drift-corrected
    // timer (NOT setInterval, which accumulates backlog under load).
    driver?.pause?.('all');
    timeline.pause();
    const started = performance.now();
    const frameInterval = 1000 / fps;
    let frame = 0;
    let timer = 0;

    recorder.start(200);
    const draw = () => {
      const t = (performance.now() - started) / 1000;
      schedule?.(t);
      freezePlayingPacks(driver);
      compositor.captureFrameSync(ctx);
      track.requestFrame(); // exactly one encoded frame per composited tick
      onProgress?.(Math.min(1, t / duration));
      frame++;
      // Drift-corrected pacing: aim the NEXT tick at the ideal grid time;
      // if we are behind, clamp the backlog (fire immediately) instead of
      // letting late timers pile up and distort timestamps.
      const nextAt = started + frame * frameInterval;
      timer = window.setTimeout(draw, Math.max(0, nextAt - performance.now()));
    };
    timer = window.setTimeout(draw, 0);

    const finished = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = (e) => reject(new Error('[agent-stage.webmRecorder] MediaRecorder error: ' + (e.error?.name ?? 'unknown')));
    });

    const cancelPoll = window.setInterval(() => {
      if (signal?.cancelled) {
        window.clearTimeout(timer);
        window.clearInterval(cancelPoll);
        if (recorder.state !== 'inactive') recorder.stop();
      }
    }, 100);

    await new Promise((r) => setTimeout(r, duration * 1000 + frameInterval));
    window.clearTimeout(timer);
    window.clearInterval(cancelPoll);
    if (recorder.state !== 'inactive') recorder.stop();
    const blob = await finished;

    onProgress?.(1);
    if (wasPlaying) {
      timeline.play();
      driver?.resume?.('all');
    }
    return { blob, filename: 'agent-stage-export.webm', mimeType };
  }
}

/** @private pause any pack instance the schedule hook left playing */
function freezePlayingPacks(driver) {
  if (!driver?._channels) return;
  for (const [, ch] of driver._channels) {
    const inst = ch.current;
    if (inst && inst.pack.playing) inst.pack.pause();
  }
}