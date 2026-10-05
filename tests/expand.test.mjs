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

test('describeTokens exposes scoreCueFields and sequencing/meta.duration rules', () => {
  const tokens = describeTokens();
  assert.ok(tokens.scoreCueFields.includes('id'));
  assert.ok(tokens.scoreCueFields.includes('after'));
  assert.ok(tokens.scoreCueFields.includes('alongside'));
  assert.ok(tokens.scoreCueFields.includes('offset'));
  assert.ok(tokens.scoreCueFields.includes('from'));
  assert.match(tokens.rules.score.sequencing, /after/);
  assert.match(tokens.rules.meta.duration, /duration/);
});

// ---------------------------------------------------------------- sequencing

test('after resolves to the referenced cue end plus offset', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }, { name: 'b', type: 'box' }], [
    { id: 'intro', do: 'move-to', to: 'a', at: 1, dur: 2, with: { x: 1 } },
    { id: 'next', do: 'move-to', to: 'b', after: 'intro', offset: 0.5, dur: 1, with: { y: 1 } },
  ]);
  const b = stage.objects.get('b');
  stage.seek(3.4);
  assert.ok(Math.abs(b.position.y) < 1e-9, String(b.position.y));
  stage.seek(3.6);
  assert.ok(b.position.y > 0.1, String(b.position.y));
  stage.seek(4.5);
  assert.ok(Math.abs(b.position.y - 1) < 1e-6, String(b.position.y));
  stage.dispose();
});

test('alongside starts at the same time as the referenced cue', () => {
  const ex = expandScore({
    objects: [{ name: 'a', type: 'box' }],
    score: [
      { id: 'a', do: 'move-to', to: 'a', at: 2, dur: 1, with: { x: 1 } },
      { do: 'fade', to: 'a', alongside: 'a', dur: 1, with: { opacity: 0 } },
    ],
  });
  assert.equal(ex.errors.length, 0, JSON.stringify(ex.errors));
  assert.ok(Math.abs(ex.cues[1].at - 2) < 1e-9, String(ex.cues[1].at));
});

test('chained after (c after b after a) accumulates start times', () => {
  const ex = expandScore({
    objects: [{ name: 'a', type: 'box' }],
    score: [
      { id: 'a', do: 'move-to', to: 'a', at: 1, dur: 2, with: { x: 1 } },
      { id: 'b', do: 'move-to', to: 'a', after: 'a', dur: 1, with: { y: 1 } },
      { id: 'c', do: 'move-to', to: 'a', after: 'b', dur: 1, with: { z: 1 } },
    ],
  });
  assert.equal(ex.errors.length, 0, JSON.stringify(ex.errors));
  assert.ok(Math.abs(ex.cues[1].at - 3) < 1e-9, String(ex.cues[1].at));
  assert.ok(Math.abs(ex.cues[2].at - 4) < 1e-9, String(ex.cues[2].at));
});

test('forward references (id defined later in the array) resolve', () => {
  const ex = expandScore({
    objects: [{ name: 'a', type: 'box' }],
    score: [
      { id: 'late', do: 'move-to', to: 'a', after: 'first', dur: 1, with: { x: 1 } },
      { id: 'first', do: 'move-to', to: 'a', at: 1, dur: 1, with: { y: 1 } },
    ],
  });
  assert.equal(ex.errors.length, 0, JSON.stringify(ex.errors));
  assert.ok(Math.abs(ex.cues[0].at - 2) < 1e-9, String(ex.cues[0].at));
});

test('after accounts for stagger groups and repeat in end time', () => {
  const ex = expandScore({
    objects: [{ name: 'a', type: 'box' }, { name: 'b', type: 'box' }],
    score: [
      { id: 'g', do: 'move-to', to: ['a', 'b'], at: 0, dur: 1, stagger: 0.5, with: { x: 1 } },
      { do: 'move-to', to: 'a', after: 'g', dur: 1, with: { y: 1 } },
    ],
  });
  assert.equal(ex.errors.length, 0);
  // g ends at 0 + 0.5*(2-1) + 1 = 1.5
  assert.ok(Math.abs(ex.cues[1].at - 1.5) < 1e-9, String(ex.cues[1].at));
});

// ---------------------------------------------------------------- validation

test('at combined with after/alongside is a validation error', () => {
  const base = { objects: [{ name: 'a', type: 'box' }] };
  const r1 = validateSpec({ ...base, score: [{ do: 'fade', to: 'a', at: 1, after: 'x', with: { opacity: 0 } }] });
  assert.ok(r1.errors.some((e) => e.path === '/score/0/at'));
  const r2 = validateSpec({ ...base, score: [{ do: 'fade', to: 'a', at: 1, alongside: 'x', with: { opacity: 0 } }] });
  assert.ok(r2.errors.some((e) => e.path === '/score/0/at'));
});

test('unknown after id is a validation error with a suggestion', () => {
  const { ok, errors } = validateSpec({
    objects: [{ name: 'a', type: 'box' }],
    score: [
      { id: 'intro', do: 'fade', to: 'a', with: { opacity: 0 } },
      { do: 'fade', to: 'a', after: 'intro2', with: { opacity: 1 } },
    ],
  });
  assert.equal(ok, false);
  const e = errors.find((e) => e.path === '/score/1/after');
  assert.ok(e, JSON.stringify(errors));
  assert.equal(e.suggestion, 'intro');
});

test('duplicate cue ids are a validation error naming both indexes', () => {
  const { ok, errors } = validateSpec({
    objects: [{ name: 'a', type: 'box' }],
    score: [
      { id: 'x', do: 'fade', to: 'a', with: { opacity: 0 } },
      { id: 'x', do: 'fade', to: 'a', with: { opacity: 1 } },
    ],
  });
  assert.equal(ok, false);
  const e = errors.find((e) => e.path === '/score/1/id');
  assert.ok(e, JSON.stringify(errors));
  assert.match(e.message, /\/score\/0/);
  assert.match(e.message, /\/score\/1/);
});

test('cycling after/alongside chains produce expansion errors', () => {
  const ex = expandScore({
    objects: [{ name: 'a', type: 'box' }],
    score: [
      { id: 'a', do: 'fade', to: 'a', after: 'b', with: { opacity: 0 } },
      { id: 'b', do: 'fade', to: 'a', after: 'a', with: { opacity: 1 } },
    ],
  });
  assert.ok(ex.errors.length > 0, JSON.stringify(ex.errors));
  assert.ok(ex.errors.some((e) => /cycle/i.test(e.message)));
  assert.ok(ex.brokenIndexes.length > 0);
});

test('negative resolved start (offset) is an expansion error', () => {
  const ex = expandScore({
    objects: [{ name: 'a', type: 'box' }],
    score: [{ do: 'fade', to: 'a', at: 1, offset: -2, with: { opacity: 0 } }],
  });
  assert.ok(ex.errors.some((e) => e.path === '/score/0'));
  assert.ok(ex.brokenIndexes.includes(0));
});

// ---------------------------------------------------------------- meta.duration

test('meta.duration scales the score and preserves spin angle', () => {
  const spec = {
    meta: { duration: 3 },
    objects: [{ name: 'a', type: 'box' }, { name: 'b', type: 'box' }],
    score: [
      { do: 'move-to', to: 'a', at: 2, dur: 4, with: { x: 1 } },
      { do: 'spin', to: 'b', at: 0, dur: 4, with: { axis: 'y', speed: 2 } },
    ],
  };
  const ex = expandScore(spec);
  assert.equal(ex.errors.length, 0);
  assert.ok(Math.abs(ex.factor - 0.5) < 1e-9, String(ex.factor));
  assert.ok(Math.abs(ex.naturalDuration - 6) < 1e-9, String(ex.naturalDuration));
  assert.ok(Math.abs(ex.cues[0].at - 1) < 1e-9);
  assert.ok(Math.abs(ex.cues[0].dur - 2) < 1e-9);
  assert.ok(Math.abs(ex.cues[1].with.speed - 4) < 1e-9, String(ex.cues[1].with.speed));

  const stage = createStage(spec);
  assert.equal(stage.ok, true);
  assert.equal(stage.scoreCompile.ok, true, JSON.stringify(stage.scoreCompile.errors));
  assert.ok(Math.abs(stage.timeline.duration() - 3) < 1e-6, String(stage.timeline.duration()));
  // Determinism: two stages, same t, same snapshot.
  const stage2 = createStage(spec);
  const snap = (st) => {
    st.seek(1.37);
    return [
      [...st.objects.get('a').position.toArray()],
      [...st.objects.get('b').rotation.toArray()],
    ];
  };
  assert.deepEqual(snap(stage), snap(stage2));
  // Angle preservation: original angle over full spin = speed*dur = 8 rad.
  stage.seek(3);
  assert.ok(Math.abs(stage.objects.get('b').rotation.y - 8) < 1e-6, String(stage.objects.get('b').rotation.y));
  stage.dispose();
  stage2.dispose();
});

test('meta.duration is skipped when naturalDuration is 0 and validated > 0', () => {
  const ex = expandScore({ meta: { duration: 5 }, objects: [{ name: 'a', type: 'box' }], score: [] });
  assert.equal(ex.factor, 1);
  const { ok, errors } = validateSpec({
    meta: { duration: 0 },
    objects: [{ name: 'a', type: 'box' }],
    score: [],
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.path === '/meta/duration'));
});

// ---------------------------------------------------------------- from

test('animate from puts the object in the from-state before the tween', () => {
  const stage = stageWith(
    [{ name: 'hero', type: 'box' }],
    [{ do: 'animate', to: 'hero', at: 1, dur: 1, ease: 'linear', with: { y: 2 }, from: { y: -3, opacity: 0 } }],
  );
  const hero = stage.objects.get('hero');
  stage.seek(0);
  assert.ok(Math.abs(hero.position.y - (-3)) < 1e-4, String(hero.position.y));
  assert.ok(Math.abs(hero.material.opacity - 0) < 1e-4, String(hero.material.opacity));
  stage.seek(1);
  assert.ok(Math.abs(hero.position.y - (-3)) < 1e-4, String(hero.position.y));
  assert.ok(Math.abs(hero.material.opacity - 0) < 1e-4, String(hero.material.opacity));
  stage.seek(2);
  assert.ok(Math.abs(hero.position.y - 2) < 1e-4, String(hero.position.y));
  stage.dispose();
});

test('from on a non-animate verb and bad from keys are validation errors', () => {
  const base = { objects: [{ name: 'a', type: 'box' }] };
  const wrongVerb = validateSpec({ ...base, score: [{ do: 'fade', to: 'a', from: { y: -1 }, with: { opacity: 0 } }] });
  assert.ok(wrongVerb.errors.some((e) => e.path === '/score/0/from'));
  const typo = validateSpec({ ...base, score: [{ do: 'animate', to: 'a', with: { y: 1 }, from: { scle: 1 } }] });
  const e = typo.errors.find((e) => e.path === '/score/0/from/scle');
  assert.ok(e, JSON.stringify(typo.errors));
  assert.equal(e.suggestion, 'scale');
});

// ---------------------------------------------------------------- stage integration

test('stage.scoreCompile merges expansion errors and ok is false when sequencing breaks', () => {
  const stage = createStage({
    objects: [{ name: 'a', type: 'box' }, { name: 'b', type: 'box' }],
    score: [
      { do: 'move-to', to: 'a', at: 0, dur: 1, with: { x: 1 } },
      { id: 'b', do: 'move-to', to: 'b', after: 'c', dur: 1, with: { x: 1 } },
      { id: 'c', do: 'move-to', to: 'b', after: 'b', dur: 1, with: { x: 1 } },
    ],
  });
  assert.equal(stage.ok, true);
  assert.equal(stage.scoreCompile.ok, false);
  assert.ok(stage.scoreCompile.errors.some((e) => /cycle/i.test(e.message)), JSON.stringify(stage.scoreCompile.errors));
  // The clean cue still compiled.
  stage.seek(1);
  assert.ok(Math.abs(stage.objects.get('a').position.x - 1) < 1e-6);
  stage.dispose();
});

test('stage.compileScore live-append path runs expansion too', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }, { name: 'b', type: 'box' }], [
    { id: 'intro', do: 'move-to', to: 'a', at: 0, dur: 2, with: { x: 1 } },
  ]);
  // Live-append batches sequence within the batch: 'step' resolves inside it.
  const res = stage.compileScore([
    { id: 'step', do: 'move-to', to: 'a', at: 2, dur: 1, with: { z: 1 } },
    { do: 'move-to', to: 'b', after: 'step', offset: 0.5, dur: 1, with: { y: 1 } },
  ]);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const b = stage.objects.get('b');
  stage.seek(3.4);
  assert.ok(Math.abs(b.position.y) < 1e-9, String(b.position.y));
  stage.seek(3.6);
  assert.ok(b.position.y > 0.05, String(b.position.y));
  stage.seek(4.5);
  assert.ok(Math.abs(b.position.y - 1) < 1e-6, String(b.position.y));
  // Broken sequencing through the live path is reported, not thrown.
  const bad = stage.compileScore([{ do: 'move-to', to: 'a', after: 'ghost', with: { x: 1 } }]);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.path === '/score/0/after'));
  stage.dispose();
});

// ---------------------------------------------------------------- determinism

test('expandScore is pure: same input expands to the same output', () => {
  const spec = {
    meta: { duration: 4 },
    objects: [{ name: 'a', type: 'box' }],
    score: [
      { id: 'a', do: 'move-to', to: 'a', at: 1, dur: 2, with: { x: 1 } },
      { do: 'spin', to: 'a', after: 'a', dur: 1, with: { axis: 'z', speed: 3 } },
      { do: 'animate', to: 'a', alongside: 'a', dur: 1, with: { y: 2 }, from: { y: -1 } },
    ],
  };
  const e1 = expandScore(spec);
  const e2 = expandScore(spec);
  assert.deepEqual(e1, e2);
  // Input was not mutated.
  assert.equal(spec.score[0].at, 1);
  assert.equal(spec.score[1].with.speed, 3);
});
