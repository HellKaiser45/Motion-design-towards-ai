/**
 * @module agent-stage/core/easing
 * Named easing functions f(t) -> v with t in [0,1].
 * Every easing is a PURE function of t (seek-safe, export-safe).
 *
 * v2 changes:
 *  - unknown names THROW (via assertEasing) instead of silently becoming linear
 *  - `cssLinear(name)` samples any easing into a CSS `linear()` string, so the
 *    WAAPI engine reproduces exactly the same curve as PropEngine / the kit
 *  - more easings an animator actually reaches for (expo, sine, back in/out, bounce)
 */
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const bounceOut = (t) => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

const easings = {
  linear: (t) => t,

  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),

  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),

  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),

  easeInExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t) =>
    t === 0 ? 0 : t === 1 ? 1
      : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,

  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

  backIn: (t) => c3 * t * t * t - c1 * t * t,
  backOut: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  backInOut: (t) =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,

  elasticOut: (t) => {
    if (t === 0 || t === 1) return t;
    const p = 0.45;
    return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
  },
  bounceOut,

  /** hold the start value until the segment ends */
  step: (t) => (t < 1 ? 0 : 1),
};

/** @returns {string[]} every valid easing name (for error messages / docs) */
const easingNames = () => Object.keys(easings);

/** @returns {boolean} */
const isEasing = (name) => Object.prototype.hasOwnProperty.call(easings, name);

/** Closest names by edit distance — powers "did you mean" errors. */
function suggest(name, pool = easingNames(), n = 3) {
  const d = (a, b) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  };
  return [...pool].sort((x, y) => d(name.toLowerCase(), x.toLowerCase()) - d(name.toLowerCase(), y.toLowerCase())).slice(0, n);
}

/** Throw a helpful error when an easing name is unknown. `where` = context string. */
function assertEasing(name, where = '') {
  if (name === undefined || name === null || isEasing(name)) return;
  throw new Error(
    `[agent-stage] unknown easing "${name}"${where ? ' in ' + where : ''}. ` +
    `Did you mean: ${suggest(String(name)).join(', ')}? (all: ${easingNames().join(', ')})`
  );
}

/** Apply a named easing. Unknown names throw — typos must never be silent. */
function applyEasing(name, t) {
  if (typeof t !== 'number' || Number.isNaN(t)) return 0;
  if (name === undefined || name === null) return t;
  const fn = easings[name];
  if (!fn) assertEasing(name);
  return fn(t);
}

/**
 * Sample an easing into a CSS `linear(...)` easing string (Chrome 113+, Firefox 112+,
 * Safari 17.2+). Gives WAAPI the EXACT curve PropEngine uses, incl. elastic/bounce.
 */
function cssLinear(name, samples = 48) {
  if (name === undefined || name === null || name === 'linear') return 'linear';
  assertEasing(name);
  if (name === 'step') return 'steps(1, end)';
  const fn = easings[name];
  const pts = [];
  for (let i = 0; i <= samples; i++) pts.push(+fn(i / samples).toFixed(4));
  return `linear(${pts.join(', ')})`;
}

export { easings, easingNames, isEasing, suggest, assertEasing, applyEasing, cssLinear };
