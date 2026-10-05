import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createStage,
  validateSpec,
  expandScore,
  describeTokens,
} from '../src/index.js';

function stageWith(objects, score, extra = {}) {
  const stage = createStage({ objects, ...extra, score });
  assert.equal(stage.ok, true);
  return stage;
}

// ---------------------------------------------------------------- schema

test('describeTokens exposes scorePresets and the macro rules text', () => {
  const tokens = describeTokens();
  for (const name of ['entrance', 'exit', 'pop', 'emphasis', 'pulse', 'float', 'flip', 'shake', 'orbit', 'reveal-text']) {
    assert.ok(Object.hasOwn(tokens.scorePresets, name), name);
  }
  assert.ok(tokens.scorePresets.entrance.params.from.includes('below'));
  assert.match(tokens.rules.score.presets, /macro/i);
  assert.match(tokens.rules.score.presets, /repeat\/pingpong/);
});

// ---------------------------------------------------------------- entrance

test('entrance expands to one animate cue with from-state and default ease', () => {
  const ex = expandScore({
    objects: [{ name: 'hero', type: 'box', position: [1, 2, 0] }],
    score: [{ do: 'entrance', to: 'hero', at: 1, dur: 1, with: { from: 'left', distance: 2 } }],
  });
  assert.equal(ex.errors.length, 0, JSON.stringify(ex.errors));
  assert.equal(ex.cues.length, 1);
  const c = ex.cues[0];
  assert.equal(c.do, 'animate');
  assert.equal(c.ease, 'back.out');
  assert.deepEqual(c.from, { x: -1, y: 2, z: 0, opacity: 0 });
  assert.deepEqual(c.with, { x: 1, y: 2, z: 0, opacity: 1 });
  assert.ok(Math.abs(c.at - 1) < 1e-9, String(c.at));

  const stage = stageWith([{ name: 'hero', type: 'box', position: [1, 2, 0] }], [
    { do: 'entrance', to: 'hero', at: 1, dur: 1, with: { from: 'left', distance: 2 } },
  ]);
  const hero = stage.objects.get('hero');
  stage.seek(1);
  assert.ok(Math.abs(hero.position.x - (-1)) < 1e-4, String(hero.position.x));
  assert.ok(Math.abs(hero.material.opacity - 0) < 1e-4, String(hero.material.opacity));
  stage.seek(2);
  assert.ok(Math.abs(hero.position.x - 1) < 1e-4, String(hero.position.x));
  assert.ok(Math.abs(hero.material.opacity - 1) < 1e-4, String(hero.material.opacity));
  stage.dispose();
});

test('entrance defaults: direction below, distance 3', () => {
  const ex = expandScore({
    objects: [{ name: 'a', type: 'box' }],
    score: [{ do: 'entrance', to: 'a', dur: 1 }],
  });
  assert.equal(ex.errors.length, 0);
  const c = ex.cues[0];
  assert.deepEqual(c.from, { x: 0, y: -3, z: 0, opacity: 0 });
  assert.deepEqual(c.with, { x: 0, y: 0, z: 0, opacity: 1 });
});

// ---------------------------------------------------------------- simple presets

test('exit / pop / emphasis / pulse / float / flip expand to expected cue shapes', () => {
  const rest = { position: [1, 1, 1], rotation: [0.5, 1, -0.25], scale: 2 };
  const mk = (score) =>
    expandScore({ objects: [{ name: 'a', type: 'box', ...rest }], score }).cues;

  const exit = mk([{ do: 'exit', to: 'a', dur: 1, with: { to: 'above' } }])[0];
  assert.equal(exit.do, 'animate');
  assert.equal(exit.ease, 'power2.in');
  assert.deepEqual(exit.with, { x: 1, y: 4, z: 1, opacity: 0 });

  const pop = mk([{ do: 'pop', to: 'a', dur: 1 }])[0];
  assert.equal(pop.ease, 'back.out');
  assert.deepEqual(pop.from, { scale: 0, opacity: 0 });
  assert.deepEqual(pop.with, { scale: 2, opacity: 1 });

  const emphasis = mk([{ do: 'emphasis', to: 'a', dur: 1, with: { amount: 1.5 } }])[0];
  assert.equal(emphasis.repeat, 1);
  assert.equal(emphasis.pingpong, true);
  assert.equal(emphasis.ease, 'power2.inOut');
  assert.deepEqual(emphasis.with, { scale: 3 });

  const pulse = mk([{ do: 'pulse', to: 'a', dur: 1 }])[0];
  assert.equal(pulse.repeat, 6);
  assert.equal(pulse.ease, 'sine.inOut');
  assert.ok(Math.abs(pulse.with.scale - 2 * 1.08) < 1e-9, String(pulse.with.scale));

  const float = mk([{ do: 'float', to: 'a', dur: 1 }])[0];
  assert.equal(float.repeat, 4);
  assert.equal(float.pingpong, true);
  assert.deepEqual(float.with, { y: 1.4 });

  const flip = mk([{ do: 'flip', to: 'a', dur: 1 }])[0];
  assert.equal(flip.ease, 'power2.inOut');
  assert.ok(Math.abs(flip.with.rotateY - (1 + Math.PI * 2)) < 1e-9, String(flip.with.rotateY));

  const flipX = mk([{ do: 'flip', to: 'a', dur: 1, with: { axis: 'x', turns: 2 } }])[0];
  assert.ok(Math.abs(flipX.with.rotateX - (0.5 + Math.PI * 4)) < 1e-9, String(flipX.with.rotateX));
});

test('pop seek: object sits at scale 0 until the cue starts', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }], [
    { do: 'pop', to: 'a', at: 1, dur: 1 },
  ]);
  const a = stage.objects.get('a');
  stage.seek(0.5);
  assert.ok(Math.abs(a.scale.x - 0) < 1e-4, String(a.scale.x));
  stage.seek(2);
  assert.ok(Math.abs(a.scale.x - 1) < 1e-4, String(a.scale.x));
  stage.dispose();
});

// ---------------------------------------------------------------- shake

test('shake generates count+1 move-to cues alternating around rest, ending at rest', () => {
  const ex = expandScore({
    objects: [{ name: 'a', type: 'box', position: [1, 2, 3] }],
    score: [{ do: 'shake', to: 'a', dur: 1, with: { intensity: 0.5, count: 4 } }],
  });
  assert.equal(ex.errors.length, 0, JSON.stringify(ex.errors));
  const cues = ex.cues;
  assert.equal(cues.length, 5);
  const xs = cues.map((c) => c.with.x);
  assert.deepEqual(xs, [1.5, 0.5, 1.5, 0.5, 1]);
  const total = cues.reduce((s, c) => s + c.dur, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, String(total));
  for (const c of cues) {
    assert.equal(c.do, 'move-to');
    assert.equal(c.ease, 'none');
  }
  // Segments tile the cue's dur back to back.
  assert.ok(Math.abs(cues[0].at - 0) < 1e-9);
  assert.ok(Math.abs(cues[4].at - 0.8) < 1e-9, String(cues[4].at));
});

// ---------------------------------------------------------------- orbit

test('orbit generates steps move-to cues, no teleport at start, radius honored', () => {
  const spec = {
    objects: [{ name: 'sat', type: 'box', position: [2, 0, 0] }],
    score: [{ do: 'orbit', to: 'sat', dur: 2, with: { center: [0, 0, 0], radius: 2, steps: 8 } }],
  };
  const ex = expandScore(spec);
  assert.equal(ex.errors.length, 0, JSON.stringify(ex.errors));
  assert.equal(ex.cues.length, 8);
  for (const c of ex.cues) {
    assert.equal(c.do, 'move-to');
    assert.equal(c.ease, 'none');
    assert.ok(Math.abs(c.dur - 0.25) < 1e-9, String(c.dur));
  }

  const stage = stageWith([{ name: 'sat', type: 'box', position: [2, 0, 0] }], spec.score);
  const sat = stage.objects.get('sat');
  stage.seek(0);
  assert.ok(Math.abs(sat.position.x - 2) < 1e-6, String(sat.position.x));
  stage.seek(2);
  const d = Math.hypot(sat.position.x, sat.position.z);
  assert.ok(Math.abs(d - 2) < 1e-3, String(d));
  stage.dispose();
});

// ---------------------------------------------------------------- reveal-text

test('reveal-text expands to a fade cue on the split children', () => {
  const ex = expandScore({
    objects: [],
    score: [{ do: 'reveal-text', to: '#title', with: { of: 'chars' } }],
  });
  assert.equal(ex.errors.length, 0, JSON.stringify(ex.errors));
  assert.equal(ex.cues.length, 1);
  const c = ex.cues[0];
  assert.equal(c.do, 'fade');
  assert.equal(c.to, '#title .char');
  assert.equal(c.stagger, 0.03);
  assert.equal(c.ease, 'power2.out');
  assert.deepEqual(c.with, { opacity: 1 });

  const words = expandScore({
    objects: [],
    score: [{ do: 'reveal-text', to: '.intro', with: { of: 'words', stagger: 0.1 } }],
  }).cues[0];
  assert.equal(words.to, '.intro .word');
  assert.equal(words.stagger, 0.1);
});

test('reveal-text on a DOM selector produces a headless DOM-noop warning', () => {
  const stage = createStage({
    objects: [],
    score: [{ do: 'reveal-text', to: '#title', with: { of: 'chars' } }],
  });
  assert.equal(stage.ok, true);
  assert.equal(stage.scoreCompile.ok, true, JSON.stringify(stage.scoreCompile.errors));
  assert.ok(
    stage.scoreCompile.warnings.some((w) => /no document|no-op/i.test(w.message)),
    JSON.stringify(stage.scoreCompile.warnings),
  );
  stage.dispose();
});

test('reveal-text with a non-selector target is a structured expansion error', () => {
  const ex = expandScore({
    objects: [{ name: 'hero', type: 'box' }],
    score: [{ do: 'reveal-text', to: 'hero' }],
  });
  assert.equal(ex.errors.length, 1, JSON.stringify(ex.errors));
  assert.equal(ex.errors[0].path, '/score/0/to/0');
  assert.equal(ex.cues.length, 0);
  const stage = createStage({
    objects: [{ name: 'hero', type: 'box' }],
    score: [{ do: 'reveal-text', to: 'hero' }],
  });
  assert.equal(stage.ok, true);
  assert.equal(stage.scoreCompile.ok, false);
  assert.ok(stage.scoreCompile.errors.some((e) => e.path === '/score/0/to/0'));
  stage.dispose();
});

// ---------------------------------------------------------------- groups & sequencing

test('after a preset id waits for the whole group to end', () => {
  const stage = stageWith([{ name: 'hero', type: 'box' }, { name: 'b', type: 'box' }], [
    { id: 'intro', do: 'entrance', to: 'hero', dur: 1, with: { from: 'below' } },
    { do: 'move-to', to: 'b', after: 'intro', dur: 1, ease: 'linear', with: { x: 1 } },
  ]);
  const b = stage.objects.get('b');
  stage.seek(0.5);
  assert.ok(Math.abs(b.position.x) < 1e-9, String(b.position.x));
  stage.seek(1.5);
  assert.ok(b.position.x > 0.4, String(b.position.x));
  stage.seek(2);
  assert.ok(Math.abs(b.position.x - 1) < 1e-6, String(b.position.x));
  stage.dispose();
});

test('alongside a preset id starts at the group start', () => {
  const ex = expandScore({
    objects: [{ name: 'a', type: 'box' }],
    score: [
      { id: 'intro', do: 'entrance', to: 'a', at: 1, dur: 1 },
      { do: 'fade', to: 'a', alongside: 'intro', dur: 1, with: { opacity: 0 } },
    ],
  });
  assert.equal(ex.errors.length, 0, JSON.stringify(ex.errors));
  assert.ok(Math.abs(ex.cues[1].at - 1) < 1e-9, String(ex.cues[1].at));
});

// ---------------------------------------------------------------- meta.duration

test('meta.duration scales expanded preset cues and preserves spin angle', () => {
  const spec = {
    meta: { duration: 4 },
    objects: [{ name: 'hero', type: 'box' }],
    score: [
      { do: 'entrance', to: 'hero', dur: 2, with: { from: 'below', distance: 1 } },
      { do: 'spin', to: 'hero', at: 0, dur: 2, with: { axis: 'y', speed: 2 } },
    ],
  };
  const stage = createStage(spec);
  assert.equal(stage.ok, true);
  assert.equal(stage.scoreCompile.ok, true, JSON.stringify(stage.scoreCompile.errors));
  assert.ok(Math.abs(stage.timeline.duration() - 4) < 1e-6, String(stage.timeline.duration()));
  // Total angle preserved: original speed*dur = 4 rad.
  stage.seek(4);
  assert.ok(Math.abs(stage.objects.get('hero').rotation.y - 4) < 1e-6, String(stage.objects.get('hero').rotation.y));
  stage.dispose();
});

// ---------------------------------------------------------------- multi-target

test('multi-target entrance fans out per target with staggered at offsets', () => {
  const ex = expandScore({
    objects: [{ name: 'a', type: 'box' }, { name: 'b', type: 'box' }],
    score: [{ do: 'entrance', to: ['a', 'b'], dur: 1, stagger: 0.2, with: { from: 'left', distance: 1 } }],
  });
  assert.equal(ex.errors.length, 0, JSON.stringify(ex.errors));
  assert.equal(ex.cues.length, 2);
  assert.deepEqual(ex.cues.map((c) => c.to), ['a', 'b']);
  assert.ok(Math.abs(ex.cues[0].at - 0) < 1e-9, String(ex.cues[0].at));
  assert.ok(Math.abs(ex.cues[1].at - 0.2) < 1e-9, String(ex.cues[1].at));
});

// ---------------------------------------------------------------- validation

test('repeat/pingpong on a preset cue is a validation error', () => {
  const base = { objects: [{ name: 'a', type: 'box' }] };
  const r1 = validateSpec({ ...base, score: [{ do: 'entrance', to: 'a', repeat: 2, with: { from: 'below' } }] });
  assert.ok(r1.errors.some((e) => e.path === '/score/0/repeat' && /owns its repeat\/pingpong/.test(e.message)), JSON.stringify(r1.errors));
  const r2 = validateSpec({ ...base, score: [{ do: 'pulse', to: 'a', pingpong: true }] });
  assert.ok(r2.errors.some((e) => e.path === '/score/0/pingpong' && /owns its repeat\/pingpong/.test(e.message)));
});

test('unknown preset params get did-you-mean suggestions; bad enum values are errors', () => {
  const base = { objects: [{ name: 'a', type: 'box' }] };
  const typo = validateSpec({ ...base, score: [{ do: 'entrance', to: 'a', with: { form: 'below' } }] });
  const e = typo.errors.find((e) => e.path === '/score/0/with/form');
  assert.ok(e, JSON.stringify(typo.errors));
  assert.equal(e.suggestion, 'from');
  const unknown = validateSpec({ ...base, score: [{ do: 'entrance', to: 'a', with: { direction: 'below' } }] });
  assert.ok(unknown.errors.some((e) => e.path === '/score/0/with/direction'));
  const badEnum = validateSpec({ ...base, score: [{ do: 'entrance', to: 'a', with: { from: 'diagonal' } }] });
  const be = badEnum.errors.find((e) => e.path === '/score/0/with/from');
  assert.ok(be, JSON.stringify(badEnum.errors));
  assert.match(be.message, /must be one of/);
  const badCenter = validateSpec({ ...base, score: [{ do: 'orbit', to: 'a', with: { center: [1, 2] } }] });
  assert.ok(badCenter.errors.some((e) => e.path === '/score/0/with/center'));
  const fromOnPreset = validateSpec({ ...base, score: [{ do: 'pop', to: 'a', from: { y: 1 } }] });
  assert.ok(fromOnPreset.errors.some((e) => e.path === '/score/0/from'));
});

// ---------------------------------------------------------------- svg opacity

test('svg text/shape opacity validates and reaches the headless overlay', () => {
  const bad = validateSpec({
    svg: { text: [{ id: 't', content: 'hi', opacity: 1.5 }], shapes: [{ id: 'r', type: 'rect', width: 4, height: 4, opacity: 2 }] },
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.path === '/svg/text/0/opacity'));
  assert.ok(bad.errors.some((e) => e.path === '/svg/shapes/0/opacity'));

  const good = validateSpec({
    svg: { text: [{ id: 't', content: 'hi', split: 'char', opacity: 0.5 }], shapes: [{ id: 'r', type: 'rect', width: 4, height: 4, opacity: 0.25 }] },
  });
  assert.equal(good.ok, true, JSON.stringify(good.errors));

  const stage = createStage({
    svg: { text: [{ id: 't', content: 'hi', split: 'char', opacity: 0.5 }], shapes: [{ id: 'r', type: 'rect', width: 4, height: 4, opacity: 0.25 }] },
  });
  assert.equal(stage.ok, true);
  const textEl = stage.svg.byId('t');
  const charEl = textEl.children[0];
  assert.equal(charEl.getAttribute('opacity'), '0.5');
  const shapeEl = stage.svg.byId('r');
  assert.equal(shapeEl.getAttribute('opacity'), '0.25');
  stage.dispose();
});
