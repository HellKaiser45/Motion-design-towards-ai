/**
 * @module agent-stage/core/easing
 * Named easing functions f(t) -> v with t, v in [0,1].
 * Seekability note: every easing is a pure function of t — no internal state.
 */

const c1 = 1.70158;
const c3 = c1 + 1;

const easings = {
  linear: (t) => t,

  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),

  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),

  backOut: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),

  elasticOut: (t) => {
    // soft variant: decaying sine, amplitude limited so overshoot is modest
    if (t === 0 || t === 1) return t;
    const p = 0.45;
    return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
  },

  step: (t) => (t < 1 ? 0 : 1),
};

/**
 * Apply a named easing with safe fallback to linear.
 * @param {string} name
 * @param {number} t
 * @returns {number}
 */
function applyEasing(name, t) {
  if (typeof t !== 'number' || Number.isNaN(t)) return 0;
  const fn = easings[name];
  return fn ? fn(t) : easings.linear(t);
}

export { easings, applyEasing };
