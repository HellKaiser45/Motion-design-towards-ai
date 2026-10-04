import {
  easingNames, isEasing, suggest, applyEasing, cssLinear,
} from '../src/core/easing.js';
import { normalizePack } from '../src/driver/pack-compiler.js';
import { loopTime } from '../src/kit/review.js';

let pass = 0, fail = 0;

const t = (name, fn) => {
  try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
};
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || 'eq'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const approx = (a, b, eps, msg) => { if (Math.abs(a - b) > eps) throw new Error(`${msg || 'approx'}: |${a} - ${b}| > ${eps}`); };
const deepEq = (a, b, msg) => {
  const rec = (x, y) => {
    if (x === y) return true;
    if (typeof x !== typeof y || x === null || y === null) return false;
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    if (typeof x !== 'object') return Number.isNaN(x) && Number.isNaN(y);
    const kx = Object.keys(x), ky = Object.keys(y);
    if (kx.length !== ky.length) return false;
    return kx.every((k) => rec(x[k], y[k]));
  };
  if (!rec(a, b)) throw new Error(`${msg || 'deepEq'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
const throws = (fn, match, msg) => {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  if (!threw) throw new Error(`${msg || 'throws'}: did not throw`);
  if (match && !threw.message.includes(match)) throw new Error(`${msg || 'throws'}: message "${threw.message}" lacks "${match}"`);
};

// ── EASING ──
t('legacy easing superset', () => {
  const names = easingNames();
  for (const n of ['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic', 'backOut', 'elasticOut', 'step']) {
    eq(names.includes(n), true, `missing ${n}`);
  }
});
t('new easing names', () => {
  const names = easingNames();
  for (const n of ['easeInOutSine', 'easeOutExpo', 'bounceOut', 'backInOut', 'easeInQuart']) {
    eq(names.includes(n), true, `missing ${n}`);
  }
});
t('easeOutCubic 0.5 = 0.875', () => eq(applyEasing('easeOutCubic', 0.5), 0.875));
t('easeOutQuad 0.5 = 0.75', () => eq(applyEasing('easeOutQuad', 0.5), 0.75));
t('null easing passthrough', () => eq(applyEasing(null, 0.5), 0.5));
t('step at 0.999 and 1', () => {
  eq(applyEasing('step', 0.999), 0);
  eq(applyEasing('step', 1), 1);
});
t('unknown easing throws with suggestion', () => throws(() => applyEasing('easeOutCub', 0.5), 'unknown easing'));
t('unknown easing message includes Did you mean', () => throws(() => applyEasing('easeOutCub', 0.5), 'Did you mean'));
t('suggest easeOutCub', () => eq(suggest('easeOutCub').includes('easeOutCubic'), true));
t('cssLinear linear/undefined', () => {
  eq(cssLinear('linear'), 'linear');
  eq(cssLinear(undefined), 'linear');
});
t('cssLinear step', () => eq(cssLinear('step'), 'steps(1, end)'));
t('cssLinear easeOutQuad 4', () => eq(cssLinear('easeOutQuad', 4), 'linear(0, 0.4375, 0.75, 0.9375, 1)'));
t('cssLinear unknown throws', () => throws(() => cssLinear('easeOutCub', 0.5), 'unknown easing'));

// ── normalizePack ──
t('tuple keyframes normalize', () => {
  const p = { tracks: [{ engine: 'prop', target: 'a', props: { 'rotation:y': [[0, 0], [0.5, 1, 'easeOutCubic']] } }] };
  const out = normalizePack(p);
  deepEq(out.tracks[0].props['rotation:y'], [{ t: 0, v: 0 }, { t: 0.5, v: 1, ease: 'easeOutCubic' }]);
  eq('ease' in out.tracks[0].props['rotation:y'][0], false, 'first tuple has no ease');
});
t('dotted channel rewritten', () => {
  const p = { tracks: [{ engine: 'prop', target: 'a', props: { 'position.y': [[0, 1]], 'rotation.z': [[0, 2]] } }] };
  const out = normalizePack(p).tracks[0].props;
  eq(out['position:y'][0].v, 1, 'position.y -> position:y');
  eq(out['rotation:z'][0].v, 2, 'rotation.z -> rotation:z');
});
t('dotted non-channel passthrough', () => {
  const p = { tracks: [{ engine: 'prop', target: 'a', props: { 'dust.spread': [[0, 1]] } }] };
  const out = normalizePack(p).tracks[0].props;
  eq(out['dust.spread'][0].v, 1);
});
t('already-coloned passthrough', () => {
  const p = { tracks: [{ engine: 'prop', target: 'a', props: { 'material.color:r': [[0, 1]] } }] };
  const out = normalizePack(p).tracks[0].props;
  eq(out['material.color:r'][0].v, 1);
});
t('plain prop passthrough', () => {
  const kf = [{ t: 0, v: 1 }];
  const p = { tracks: [{ engine: 'prop', target: 'a', props: { scale: kf } }] };
  const out = normalizePack(p);
  // normalizePack rebuilds containers (purity) — content must be identical
  deepEq(out.tracks[0].props.scale, kf);
});
t('non-prop track returned as-is', () => {
  const track = { engine: 'waapi', svg: 'face', selector: '#mouth', keyframes: [{ t: 0, opacity: 1 }], options: { fill: 'both' } };
  const p = { tracks: [track] };
  const out = normalizePack(p);
  eq(out.tracks[0], track);
});
t('pack without tracks as-is', () => {
  const p = { name: 'x', duration: 1 };
  eq(normalizePack(p), p);
});
t('normalizePack does not mutate input', () => {
  const p = { tracks: [{ engine: 'prop', target: 'a', props: { 'rotation:y': [[0, 0], [0.5, 1, 'easeOutCubic']], 'position.y': [[0, 1]] } }, { engine: 'waapi', selector: '#m', keyframes: [{ t: 0, opacity: 1 }] }] };
  const before = JSON.parse(JSON.stringify(p));
  normalizePack(p);
  deepEq(p, before);
});
t('normalizePack idempotent', () => {
  const p = { tracks: [{ engine: 'prop', target: 'a', props: { 'rotation:y': [[0, 0], [0.5, 1, 'easeOutCubic']], 'position.y': [[0, 1]] } }] };
  deepEq(normalizePack(normalizePack(p)), normalizePack(p));
});
t('mixed tuple + canonical prop tracks', () => {
  const canonical = [{ t: 0, v: 0 }, { t: 1, v: 2, ease: 'linear' }];
  const p = { tracks: [{ engine: 'prop', target: 'a', props: { 'scale:x': [[0, 0], [1, 2]], 'rotation:y': canonical } }] };
  const out = normalizePack(p).tracks[0].props;
  deepEq(out['scale:x'], [{ t: 0, v: 0 }, { t: 1, v: 2 }]);
  deepEq(out['rotation:y'], canonical);
});

// ── review helpers ──
t('loopTime wraps t into [0, duration)', () => {
  eq(loopTime(0, 12), 0);
  eq(loopTime(5, 12), 5);
  eq(loopTime(12, 12), 0);
  eq(loopTime(13.5, 12), 1.5);
});
t('loopTime clamps negatives to 0', () => {
  eq(loopTime(-1, 12), 11);
  eq(loopTime(-13, 12), 11);
});
t('loopTime guards non-positive duration', () => {
  eq(loopTime(3, 0), 0);
  eq(loopTime(3, -2), 0);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
