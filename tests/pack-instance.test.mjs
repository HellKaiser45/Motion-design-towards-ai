import { compile, normalizePack } from '../src/driver/pack-compiler.js';
import { PropEngine } from '../src/engines/prop-engine.js';
import { WaapiEngine } from '../src/engines/waapi-engine.js';
import { Registry } from '../src/driver/registry.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
};
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || 'eq'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const throws = (fn, match, msg) => {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  if (!threw) throw new Error(`${msg || 'throws'}: did not throw`);
  if (match && !threw.message.includes(match)) throw new Error(`${msg || 'throws'}: message "${threw.message}" lacks "${match}"`);
};
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

// ── stubs ──

/** headless threeLayer: resolve(name) -> {object, prop, channel} for PropEngine.compile */
function makeThreeLayer() {
  const objs = new Map();
  const resolve = (name) => {
    const [target, ...rest] = name.split('.');
    const propBase = rest.join('.') || 'position';
    if (!objs.has(target)) {
      objs.set(target, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });
    }
    const object = objs.get(target);
    if (!(propBase in object)) {
      object[propBase] = { x: 0, y: 0, z: 0 };
    }
    const channel = propBase === 'position' ? 'y' : 'x';
    return { object, prop: propBase, channel };
  };
  return { resolve, _objs: objs };
}

/** minimal svgLayer: mounted fake SVG with queryable elements */
function makeSvgLayer() {
  const svgs = new Map();
  const mount = (name, ids) => svgs.set(name, ids);
  const get = (name) => {
    const ids = svgs.get(name);
    if (!ids) return null;
    return {
      querySelector: (sel) => {
        if (ids.includes(sel)) {
          return {
            style: { setProperty() {}, removeProperty() {} },
            getAttribute: () => null,
            setAttribute() {},
            removeAttribute() {},
            animate() {
              const anim = { currentTime: 0, playbackRate: 1, play() {}, pause() {}, cancel() {} };
              return anim;
            },
          };
        }
        return null;
      },
    };
  };
  return { mount, get };
}

/** minimal stub engine for definition-level behavior tests */
function makeStubEngine(kind, log) {
  return class StubEngine {
    constructor(layer) { this.layer = layer; this.spec = null; this._duration = kind === 'prop' ? 1 : 0.5; this.playing = false; }
    compile(spec) { this.spec = spec; log.push(`${kind}:compile:${spec.target ?? spec.selector}`); return this; }
    duration() { return this._duration; }
    play() { this.playing = true; }
    pause() { this.playing = false; }
    stop() { this.playing = false; }
    seek() {}
    update() {}
  };
}

function makeCtx(log) {
  const threeLayer = makeThreeLayer();
  const svgLayer = makeSvgLayer();
  svgLayer.mount('face', ['#m-smile', '#mouth']);
  return {
    threeLayer,
    svgLayer,
    propEngine: { constructor: makeStubEngine('prop', log) },
    waapiEngine: { constructor: makeStubEngine('waapi', log) },
    smilEngine: { constructor: makeStubEngine('smil', log) },
  };
}

const basePack = (extra = {}) => ({
  name: 'p',
  channel: 'body',
  tracks: [{ engine: 'prop', target: 'body', props: { 'position:y': [{ t: 0, v: 0 }, { t: 1, v: 2 }] } }],
  ...extra,
});

// ── (a) definition immutability ──
t('definition.loop unchanged after facade play({loop:"repeat"})', () => {
  const ctx = makeCtx([]);
  const def = compile(basePack(), ctx);
  eq(def.loop, false);
  def.play({ loop: 'repeat' });
  eq(def.loop, false, 'definition loop must not be mutated');
  eq(def.playing, true, 'facade still plays');
  eq(def._defaultInstance.loop, 'repeat', 'default instance uses the override');
  def.stop();
});

t('definition.loop unchanged after createInstance("repeat")', () => {
  const ctx = makeCtx([]);
  const def = compile(basePack({ loop: 'repeat' }), ctx);
  const inst = def.createInstance('pingpong');
  eq(def.loop, 'repeat', 'definition loop untouched');
  eq(inst.loop, 'pingpong', 'instance uses the override');
});

t('definition has no playback state / live engines', () => {
  const ctx = makeCtx([]);
  const def = compile(basePack(), ctx);
  eq(def._local, undefined, 'no _local on definition');
  eq(def._playing, undefined, 'no _playing on definition');
  eq(def._specs[0].fired, undefined, 'no fired flag on definition tracks');
  eq(typeof def._specs[0].inst, 'undefined', 'no engine instance on definition tracks');
  eq(def._specs[0].spec.engine, 'prop');
  eq(def._specs[0].begin, 0);
  eq(def._specs[0].duration, 1);
});

// ── (b) two instances fully independent ──
t('two createInstance()s are fully independent', () => {
  const ctx = makeCtx([]);
  const def = compile(basePack({ duration: 2 }), ctx);
  const a = def.createInstance();
  const b = def.createInstance();
  a.play();
  a.tick(0.5);
  eq(a.time, 0.5);
  eq(b.time, 0, 'untouched instance playhead stays 0');
  eq(b.playing, false, 'untouched instance not playing');
  b.seek(1);
  eq(a.time, 0.5, 'seeking b does not move a');
  a.stop();
  b.stop();
});

// ── (c) facade delegation with stub engines ──
t('facade play/pause/resume/stop/tick/finished still work', () => {
  const log = [];
  const ctx = makeCtx(log);
  const def = compile(basePack(), ctx);
  def.play();
  eq(def.playing, true);
  eq(log.includes('prop:compile:body'), true, 'default instance compiled a fresh prop engine');
  def.tick(0.5);
  eq(def.time, 0.5);
  def.pause();
  eq(def.playing, false);
  def.resume();
  eq(def.playing, true);
  def.seek(0.75);
  eq(def.time, 0.75);
  def.stop();
  eq(def.playing, false);
  eq(def.time, 0);
  eq(def.tracks.length, 1, 'facade exposes live engine instances');
  eq(def.tracks[0].constructor.name, 'StubEngine');
});

t('facade play({loop:X}) replaces the default instance cleanly', () => {
  const log = [];
  const ctx = makeCtx(log);
  const def = compile(basePack(), ctx);
  def.play();
  const first = def._defaultInstance;
  def.tick(0.4);
  def.play({ loop: 'repeat' });
  eq(def._defaultInstance === first, false, 'old default instance replaced');
  eq(first.playing, false, 'old instance stopped (decommissioned cleanly)');
  eq(def.time, 0, 'new instance starts from 0');
  eq(def._defaultInstance.loop, 'repeat');
  eq(def.loop, false);
  def.stop();
});

t('createInstance with invalid loop override throws', () => {
  const ctx = makeCtx([]);
  const def = compile(basePack(), ctx);
  throws(() => def.createInstance('bogus'), 'loop override');
});

// ── (d) resolveTarget ──
t('resolveTarget: exact match, prefix match, null', () => {
  const reg = new Registry();
  reg.registerTarget('body', { three: 'body' });
  reg.registerTarget('face.smile', { svg: 'face', selector: '#m-smile' });
  const exact = reg.resolveTarget('body');
  deepEq(exact, { binding: { three: 'body' }, rest: '' }, 'exact match');
  const prefix = reg.resolveTarget('body.position.y');
  deepEq(prefix.binding, { three: 'body' });
  eq(prefix.rest, 'position.y');
  const exactDeep = reg.resolveTarget('face.smile');
  deepEq(exactDeep.binding, { svg: 'face', selector: '#m-smile' }, 'deep name exact match');
  eq(reg.resolveTarget('nope'), null);
  const deep = reg.resolveTarget('body.nope.dot');
  deepEq(deep.binding, { three: 'body' }, 'longest dot-prefix still wins');
  eq(deep.rest, 'nope.dot');
  eq(reg.resolveTarget(''), null);
  deepEq(reg.listTargets().sort(), ['body', 'face.smile']);
});

t('registerTarget validation throws clear errors', () => {
  const reg = new Registry();
  throws(() => reg.registerTarget('', { three: 'x' }), 'non-empty name');
  throws(() => reg.registerTarget('t', null), 'binding must be an object');
  throws(() => reg.registerTarget('t', {}), 'binding must not be empty');
  throws(() => reg.registerTarget('t', { three: 5 }), 'binding.three must be a non-empty string');
  throws(() => reg.registerTarget('t', { three: 'x', svg: 'y' }), 'must not also declare');
  throws(() => reg.registerTarget('t', { svg: 'face' }), 'svg binding must be { svg: string, selector: string }');
  throws(() => reg.registerTarget('t', { foo: 1 }), 'binding must be { three } or { svg, selector }');
  throws(() => reg.registerTargets('nope'), 'map object');
});

// ── (e) compact three track compiles to canonical prop track ──
t('compact three track (dotted target + tuple keys) -> prop spec', () => {
  const reg = new Registry();
  reg.registerTarget('body', { three: 'body' });
  const ctx = { ...makeCtx([]), registry: reg };
  const def = compile({
    name: 'c',
    tracks: [{ target: 'body.position.y', keys: [[0, 0], [0.4, 0.2, 'easeOutCubic']] }],
  }, ctx);
  const spec = def._specs[0].spec;
  eq(spec.engine, 'prop');
  eq(spec.target, 'body');
  deepEq(spec.props['position:y'], [{ t: 0, v: 0 }, { t: 0.4, v: 0.2, ease: 'easeOutCubic' }], 'tuple keys normalized + dotted channel rewritten');
  eq(def._specs[0].duration, 0.4);
});

t('compact three track (multi-prop keys map) -> prop spec', () => {
  const reg = new Registry();
  reg.registerTarget('body', { three: 'body' });
  const ctx = { ...makeCtx([]), registry: reg };
  const def = compile({
    name: 'c2',
    tracks: [{ target: 'body', keys: { 'position.y': [[0, 0], [1, 1]], 'rotation.x': [[0, 0], [1, 0.5, 'backOut']] } }],
  }, ctx);
  const spec = def._specs[0].spec;
  eq(spec.engine, 'prop');
  eq(spec.target, 'body');
  deepEq(spec.props['position:y'], [{ t: 0, v: 0 }, { t: 1, v: 1 }]);
  deepEq(spec.props['rotation:x'], [{ t: 0, v: 0 }, { t: 1, v: 0.5, ease: 'backOut' }]);
});

t('semantic three pack actually plays headlessly via real PropEngine', () => {
  const reg = new Registry();
  reg.registerTarget('body', { three: 'body' });
  const ctx = { ...makeCtx([]), registry: reg, propEngine: { constructor: PropEngine } };
  const def = compile({
    name: 'c3',
    tracks: [{ target: 'body.position.y', keys: [[0, 0], [1, 2]] }],
  }, ctx);
  const inst = def.createInstance();
  inst.play();
  inst.tick(0.5);
  const body = ctx.threeLayer.resolve('body').object;
  eq(body.position.y, 1, 'PropEngine applied interpolated value');
});

// ── (f) compact svg track compiles to waapi spec with binding svg/selector ──
t('compact svg track -> waapi spec (keyframes alias)', () => {
  const reg = new Registry();
  reg.registerTarget('face.smile', { svg: 'face', selector: '#m-smile' });
  const svgLayer = makeSvgLayer();
  svgLayer.mount('face', ['#m-smile']);
  const ctx = {
    threeLayer: makeThreeLayer(),
    svgLayer,
    propEngine: { constructor: PropEngine },
    waapiEngine: { constructor: WaapiEngine },
    smilEngine: { constructor: WaapiEngine },
    registry: reg,
  };
  const def = compile({
    name: 'c4',
    tracks: [{ target: 'face.smile', keys: [{ t: 0, opacity: 0 }, { t: 0.25, opacity: 1, ease: 'backOut' }] }],
  }, ctx);
  const spec = def._specs[0].spec;
  eq(spec.engine, 'waapi');
  eq(spec.svg, 'face');
  eq(spec.selector, '#m-smile');
  deepEq(spec.keyframes, [{ t: 0, opacity: 0 }, { t: 0.25, opacity: 1, ease: 'backOut' }]);
  eq(def._specs[0].duration, 0.25);

  // real WaapiEngine compiles the canonical spec headlessly
  const inst = def.createInstance();
  eq(inst.tracks.length, 1);
});

t('"keyframes" alias works for semantic svg tracks', () => {
  const reg = new Registry();
  reg.registerTarget('face.smile', { svg: 'face', selector: '#m-smile' });
  const out = normalizePack({
    tracks: [{ target: 'face.smile', keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }] }],
  }, reg);
  eq(out.tracks[0].engine, 'waapi');
  eq(out.tracks[0].selector, '#m-smile');
  eq(out.tracks[0].keyframes.length, 2);
});

t('compact track with begin/loop passthrough keeps them', () => {
  const reg = new Registry();
  reg.registerTarget('body', { three: 'body' });
  const out = normalizePack({
    tracks: [{ target: 'body.position.y', keys: [[0, 0], [1, 1]], begin: 0.3, loop: 'pingpong' }],
  }, reg);
  eq(out.tracks[0].begin, 0.3);
  eq(out.tracks[0].loop, 'pingpong');
});

// ── (g) unknown semantic target ──
t('unknown semantic target throws naming the target (with registry)', () => {
  const reg = new Registry();
  reg.registerTarget('body', { three: 'body' });
  const ctx = { ...makeCtx([]), registry: reg };
  throws(() => compile({ name: 'x', tracks: [{ target: 'arm.wave', keys: [[0, 0]] }] }, ctx), 'arm.wave');
  throws(() => compile({ name: 'x', tracks: [{ target: 'arm.wave', keys: [[0, 0]] }] }, ctx), 'listTargets');
});

t('semantic track without registry throws with clear hint', () => {
  const ctx = makeCtx([]); // no registry in ctx
  throws(() => compile({ name: 'x', tracks: [{ target: 'body.position.y', keys: [[0, 0]] }] }, ctx), 'no registry');
});

t('canonical engine-named tracks still work unchanged', () => {
  const ctx = makeCtx([]);
  const def = compile(basePack({ loop: 'pingpong' }), ctx);
  eq(def._specs[0].spec.engine, 'prop');
  eq(def._specs[0].spec.loop, 'pingpong');
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
