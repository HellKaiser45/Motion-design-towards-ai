/**
 * @module agent-stage/kit/review
 * Review/iframe protocol + autoplay wrapper for a Motion instance.
 */

/** Pure time wrapper: wraps t into [0, duration); 0 for non-positive/NaN duration. */
export function loopTime(t, duration) {
  if (typeof duration !== 'number' || Number.isNaN(duration) || duration <= 0) return 0;
  return ((t % duration) + duration) % duration;
}

/**
 * Attach review protocol + playback control to a motion instance.
 * @param {Motion} motion result of createMotion()
 * @param {object} [opts]
 * @returns the same motion instance
 */
export function attachReview(motion, opts = {}) {
  if (typeof window === 'undefined') return motion;
  const params = new URLSearchParams(window.location.search);
  if (params.has('capture')) return motion; // headless tools drive render(t) directly

  const embedded = window.parent !== window || params.has('review');
  const target = embedded ? window.parent : null;
  const post = (msg) => target?.postMessage(msg, '*');

  let loop = false;
  let ended = false;
  let errSent = false;
  let lastTimePost = 0;

  const duration = motion.duration;
  const seek = (t) => motion.seek(Math.max(0, Math.min(t, duration)));
  const restart = () => { ended = false; seek(0); motion.play(); };

  window.__agentStageReview = {
    play: () => motion.play(),
    pause: () => motion.pause(),
    seek,
    restart,
    duration,
  };

  // error reporting (first error only)
  const msgOf = (e) => {
    const reason = e?.reason ?? e?.error;
    if (reason instanceof Error) return reason.message;
    if (reason != null) return String(reason);
    return String(e?.message ?? 'unknown error');
  };
  const onError = (e) => {
    if (errSent) return;
    errSent = true;
    post({ type: 'error', message: msgOf(e) });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);

  // message protocol
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    switch (d.type) {
      case 'play': ended = false; motion.play(); break;
      case 'pause': motion.pause(); break;
      case 'seek': ended = false; seek(d.t ?? 0); break;
      case 'restart': restart(); break;
      case 'loop': loop = !!d.on; break;
    }
  });

  // poll: throttled time posts + end detection / looping
  function tick() {
    const t = motion.time();
    const now = performance.now();
    if (now - lastTimePost >= 100) {
      lastTimePost = now;
      post({ type: 'time', t });
    }
    if (!ended && !motion.playing() && t >= duration - 1e-6) {
      if (loop) {
        // auto-loop silently: posting 'ended' here would flip the console's
        // Play/Pause button while playback has already restarted.
        motion.seek(loopTime(0, duration));
        motion.play();
      } else {
        ended = true;
        post({ type: 'ended' });
      }
    }
    requestAnimationFrame(tick);
  }

  post({ type: 'ready', duration });

  if (embedded) {
    // review mode: start paused at t=0; parent console sends 'play'
    motion.seek(0);
    requestAnimationFrame(tick);
  } else {
    // standalone: autoplay with looping on
    loop = true;
    motion.play();
    requestAnimationFrame(tick);
  }

  return motion;
}
