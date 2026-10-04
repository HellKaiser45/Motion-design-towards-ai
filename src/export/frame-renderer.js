/**
 * @module agent-stage/export/frame-renderer
 * FrameRenderer: deterministic, seek-driven offline rendering.
 *
 * Algorithm: pause the live clock (Stage + Timeline + driver packs), then for
 * each frame index i: t = i / fps; run the caller's schedule hook (which may
 * start packs via the AgentDriver at time thresholds), position every active
 * pack instance at its local time (pack.seek — prop is pure f(t), WAAPI gets
 * currentTime set while paused, SMIL sync maps the doc clock), then
 * timeline.seek(t) fans out to ambient timeline tracks and renders the Stage
 * synchronously, then await compositor.captureFrame(). Machine speed is
 * irrelevant: each output frame is the exact state at t.
 *
 * Before returning, the previous play state is restored (resumed if it was
 * playing, otherwise left paused at its prior playhead).
 */

export class FrameRenderer {
  /**
   * @param {{stage:object, timeline:object, driver?:object, compositor:object,
   *          svgLayer:object, engines?:object}} ctx
   */
  constructor(ctx) {
    if (!ctx || !ctx.stage || !ctx.timeline || !ctx.compositor) {
      throw new Error('[agent-stage.frameRenderer] requires { stage, timeline, compositor }');
    }
    this._ctx = ctx;
  }

  /**
   * @param {{duration:number, fps?:number, width:number, height:number,
   *          background?:string|null,
   *          schedule?:(t:number)=>void,
   *          onFrame?:(canvas:HTMLCanvasElement, index:number, tSec:number)=>void|Promise<void>,
   *          onProgress?:(p:number)=>void,
   *          signal?:{cancelled:boolean}}} opts
   * @returns {Promise<{frames:number, duration:number, fps:number}>}
   */
  async render(opts) {
    const {
      duration, fps = 30, width, height, background = null,
      schedule, onFrame, onProgress, signal,
    } = opts;
    if (typeof duration !== 'number' || duration <= 0) {
      throw new Error('[agent-stage.frameRenderer] opts.duration must be > 0');
    }
    const { stage, timeline, driver, compositor, svgLayer, engines } = this._ctx;
    const frames = Math.max(1, Math.round(duration * fps));

    // --- freeze the live experience, snapshotting exact per-track state ---
    const priorTime = timeline.time;
    const wasPlaying = stage.playing;
    const trackStates = (timeline._allTracks ? timeline._allTracks() : [])
      .map((h) => ({ h, playing: h.playing }));
    const driverStates = snapshotDriver(driver);
    driver?.pause?.('all');
    timeline.pause();

    const captureCtx = { stage, svgLayer, width, height, background, engines };
    try {
      for (let i = 0; i < frames; i++) {
        if (signal?.cancelled) {
          throw Object.assign(new Error('[agent-stage.frameRenderer] export cancelled'), {
            cancelled: true,
          });
        }
        const t = i / fps;

        // Caller hook: start/position packs for this master time.
        schedule?.(t);
        seekInstances(driver);

        // Fan out to ambient timeline tracks + synchronous stage render.
        timeline.seek(t);

        const frameCanvas = await compositor.captureFrame(captureCtx);
        if (onFrame) await onFrame(frameCanvas, i, t);
        onProgress?.((i + 1) / frames);
      }
    } finally {
      restore(driver, timeline, stage, { priorTime, wasPlaying, trackStates, driverStates });
    }

    return { frames, duration, fps };
  }
}

/**
 * Snapshot per-channel playing state of the driver's active pack instances.
 * @private
 */
function snapshotDriver(driver) {
  if (!driver?._channels) return [];
  const out = [];
  for (const [channel, ch] of driver._channels) {
    if (ch.current) out.push({ channel, playing: !!ch.current.pack.playing });
  }
  return out;
}

/**
 * Position every active pack instance on its channel at master time t.
 * Local time is NOT derivable generically (the schedule hook knows each
 * pack's start offset), so this only re-freezes instances: WAAPI must be
 * PAUSED for seeks to be deterministic (a playing animation would drift in
 * real time between frames). Packs played by the schedule hook are expected
 * to seek themselves and then pause — helper `makePackScheduler` in
 * export-manager.js does exactly that.
 * @private
 */
function seekInstances(driver) {
  // freeze pass: pause any pack the schedule left playing
  if (!driver?._channels) return;
  for (const [, ch] of driver._channels) {
    const inst = ch.current;
    if (inst && inst.pack.playing) inst.pack.pause();
  }
}

/** @private restore the exact prior play state (playhead + per-track playing) */
function restore(driver, timeline, stage, snap) {
  const { priorTime, wasPlaying, trackStates, driverStates } = snap;
  // Rewind the playhead to where it was before export, then re-establish each
  // track's individual playing state (resume ONLY tracks that were playing).
  timeline.seek(priorTime);
  for (const { h, playing } of trackStates) {
    if (playing) h.play();
    else h.pause();
  }
  for (const { channel, playing } of driverStates) {
    const ch = driver._channels.get(channel);
    if (!ch?.current) continue;
    if (playing) ch.current.pack.resume();
    else ch.current.pack.pause();
  }
  if (wasPlaying) stage.resumeClock();
  else stage.pauseClock();
}