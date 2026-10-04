import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createStage,
  validateSpec,
  compileScore,
  SCORE_VERBS,
  SCORE_EASES,
  describeTokens,
} from '../src/index.js';

function stageWith(objects, score, extra = {}) {
  const stage = createStage({ objects, ...extra, score });
  assert.equal(stage.ok, true);
  return stage;
}

// ---------------------------------------------------------------- schema

test('score tokens are part of describeTokens', () => {
  const tokens = describeTokens();
  assert.deepEqual(Object.keys(tokens.scoreVerbs).sort(), Object.keys(SCORE_VERBS).sort());
  assert.ok(SCORE_EASES['power1.in']);
  assert.equal(SCORE_EASES.linear, 'none');
  assert.equal(SCORE_EASES['power1'], 'power1.out');
  assert.equal(SCORE_EASES['bounce'], 'bounce.out');
  assert.equal(tokens.scoreRepeatCap, 100);
});

// ---------------------------------------------------------------- validation

test('unknown verb produces a structured error with a suggestion', () => {
  const { ok, errors } = validateSpec({
    objects: [{ name: 'a', type: 'box' }],
    score: [{ do: 'move-too', to: 'a', with: { x: 1 } }],
  });
  assert.equal(ok, false);
  const e = errors.find((e) => e.path === '/score/0/do');
  assert.ok(e, JSON.stringify(errors));
  assert.equal(e.suggestion, 'move-to');
});

test('unknown ease token produces a structured error with a suggestion', () => {
  const { ok, errors } = validateSpec({
    objects: [{ name: 'a', type: 'box' }],
    score: [{ do: 'fade', to: 'a', ease: 'power3.inn', with: { opacity: 0 } }],
  });
  assert.equal(ok, false);
  const e = errors.find((e) => e.path === '/score/0/ease');
  assert.ok(e, JSON.stringify(errors));
  assert.equal(e.suggestion, 'power3.in');
});

test('unknown target names are rejected with near-miss suggestions', () => {
  const { ok, errors } = validateSpec({
    objects: [{ name: 'hero', type: 'box' }],
    score: [{ do: 'fade', to: 'her0', with: { opacity: 0 } }],
  });
  assert.equal(ok, false);
  const e = errors.find((e) => e.path === '/score/0/to/0');
  assert.ok(e, JSON.stringify(errors));
  assert.equal(e.suggestion, 'hero');
});

test('negative at/dur are rejected', () => {
  const badAt = validateSpec({
    objects: [{ name: 'a', type: 'box' }],
    score: [{ do: 'fade', to: 'a', at: -1, with: { opacity: 0 } }],
  });
  assert.ok(badAt.errors.some((e) => e.path === '/score/0/at'));
  const badDur = validateSpec({
    objects: [{ name: 'a', type: 'box' }],
    score: [{ do: 'fade', to: 'a', dur: -0.5, with: { opacity: 0 } }],
  });
  assert.ok(badDur.errors.some((e) => e.path === '/score/0/dur'));
});

test('unknown cue keys and bad with params are rejected', () => {
  const base = { objects: [{ name: 'a', type: 'box' }] };
  const unknownKey = validateSpec({ ...base, score: [{ do: 'fade', to: 'a', wibble: 1 }] });
  assert.ok(unknownKey.errors.some((e) => e.path === '/score/0/wibble'));
  const badParam = validateSpec({ ...base, score: [{ do: 'spin', to: 'a', with: { axiss: 'y' } }] });
  const e = badParam.errors.find((e) => e.path === '/score/0/with/axiss');
  assert.ok(e, JSON.stringify(badParam.errors));
  assert.equal(e.suggestion, 'axis');
  const badHex = validateSpec({ ...base, score: [{ do: 'color-to', to: 'a', with: { hex: 'red' } }] });
  assert.ok(badHex.errors.some((e) => e.path === '/score/0/with/hex'));
});

test('well-formed score (array target, DOM selector, camera) passes validation', () => {
  const { ok, errors } = validateSpec({
    objects: [{ name: 'a', type: 'box' }, { name: 'b', type: 'box' }],
    lights: [{ name: 'key', type: 'point' }],
    score: [
      { do: 'move-to', to: ['a', 'b'], at: 0, dur: 1, stagger: 0.5, with: { x: 1, y: 2, z: 3 } },
      { do: 'fade', to: '#hud', with: { opacity: 0.5 } },
      { do: 'move-to', to: 'camera', with: { x: 0, y: 10, z: 0 } },
      { do: 'spin', to: 'key', with: { axis: 'y', speed: 2 } },
    ],
  });
  assert.equal(ok, true, JSON.stringify(errors));
});

// ---------------------------------------------------------------- compilation

test('move-to cue compiles onto the timeline and lands on target', () => {
  const stage = stageWith([{ name: 'a', type: 'box', position: [0, 0, 0] }], [
    { do: 'move-to', to: 'a', dur: 1, with: { x: 5, y: 2, z: -3 } },
  ]);
  const a = stage.objects.get('a');
  stage.seek(0);
  assert.deepEqual([...a.position.toArray()], [0, 0, 0]);
  stage.seek(1);
  assert.deepEqual([...a.position.toArray()], [5, 2, -3]);
  stage.dispose();
});

test('seek(t) is deterministic for composed cues', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }], [
    { do: 'move-to', to: 'a', dur: 2, with: { x: 4 } },
    { do: 'rotate', to: 'a', dur: 2, ease: 'linear', with: { y: 3 } },
  ]);
  const a = stage.objects.get('a');
  stage.seek(1.3);
  const s1 = { p: [...a.position.toArray()], r: [...a.rotation.toArray()] };
  stage.seek(2);
  stage.seek(1.3);
  const s2 = { p: [...a.position.toArray()], r: [...a.rotation.toArray()] };
  assert.deepEqual(s1, s2);
  stage.dispose();
});

test('timeline duration matches at+dur chains', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }], [
    { do: 'move-to', to: 'a', at: 2, dur: 1.5, with: { x: 1 } },
    { do: 'move-to', to: 'a', at: 0, dur: 1, with: { y: 1 } },
  ]);
  assert.ok(Math.abs(stage.timeline.duration() - 3.5) < 1e-6, String(stage.timeline.duration()));
  stage.dispose();
});

test('repeat + pingpong yoyos back through the start value', () => {
  const stage = stageWith([{ name: 'a', type: 'box', material: { preset: 'basic' } }], [
    { do: 'fade', to: 'a', dur: 1, repeat: 2, pingpong: true, ease: 'linear', with: { opacity: 0.2 } },
  ]);
  const mat = stage.objects.get('a').material;
  stage.seek(1);
  assert.ok(Math.abs(mat.opacity - 0.2) < 1e-6, String(mat.opacity));
  stage.seek(2);
  assert.ok(Math.abs(mat.opacity - 1) < 1e-6, String(mat.opacity));
  stage.seek(3);
  assert.ok(Math.abs(mat.opacity - 0.2) < 1e-6, String(mat.opacity));
  stage.dispose();
});

test('infinite spin (repeat:-1) is clamped with a warning', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }], [
    { do: 'spin', to: 'a', dur: 1, repeat: -1, with: { axis: 'y', speed: 1 } },
  ]);
  const res = stage.scoreCompile;
  assert.equal(res.ok, true);
  assert.equal(res.warnings.length, 1, JSON.stringify(res.warnings));
  assert.match(res.warnings[0].message, /clamped/);
  const a = stage.objects.get('a');
  stage.seek(0);
  assert.ok(Math.abs(a.rotation.y) < 1e-9);
  stage.seek(1);
  assert.ok(Math.abs(a.rotation.y - 1) < 1e-6, String(a.rotation.y));
  // Timeline must remain finite.
  assert.ok(Number.isFinite(stage.timeline.duration()));
  stage.dispose();
});

test('stagger fans array targets out over time and still lands them all', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }, { name: 'b', type: 'box' }], [
    { do: 'move-to', to: ['a', 'b'], dur: 1, stagger: 0.5, ease: 'linear', with: { y: 5 } },
  ]);
  assert.ok(Math.abs(stage.timeline.duration() - 1.5) < 1e-6);
  stage.seek(0.6);
  const a = stage.objects.get('a');
  const b = stage.objects.get('b');
  // linear ease: a is 60% through (y=3); b starts 0.5s late, 10% through (y=0.5).
  assert.ok(Math.abs(a.position.y - 3) < 1e-6, String(a.position.y));
  assert.ok(Math.abs(b.position.y - 0.5) < 1e-6, String(b.position.y));
  assert.ok(a.position.y > b.position.y, 'a starts before b under stagger');
  stage.seek(1.5);
  assert.ok(Math.abs(a.position.y - 5) < 1e-6);
  assert.ok(Math.abs(b.position.y - 5) < 1e-6);
  stage.dispose();
});

test('camera targeting moves the camera via cues', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }], [
    { do: 'move-to', to: 'camera', dur: 1, with: { x: 0, y: 10, z: 0 } },
  ]);
  stage.seek(1);
  assert.deepEqual([...stage.camera.position.toArray()], [0, 10, 0]);
  stage.dispose();
});

test('lights are addressable as cue targets', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }], [
    { do: 'move-to', to: 'key', dur: 1, with: { x: 9, y: 9, z: 9 } },
  ], { lights: [{ name: 'key', type: 'point' }] });
  stage.seek(1);
  const key = stage.lights.get('key');
  assert.deepEqual([...key.position.toArray()], [9, 9, 9]);
  stage.dispose();
});

test('color-to tweens the material color via THREE.Color', () => {
  const stage = stageWith([{ name: 'a', type: 'box', material: { preset: 'basic', color: '#000000' } }], [
    { do: 'color-to', to: 'a', dur: 1, ease: 'linear', with: { hex: '#ff0000' } },
  ]);
  const mat = stage.objects.get('a').material;
  stage.seek(0);
  assert.equal(mat.color.getHexString(), '000000');
  stage.seek(1);
  assert.equal(mat.color.getHexString(), 'ff0000');
  stage.seek(0.5);
  assert.ok(Math.abs(mat.color.r - 0.5) < 1e-6, String(mat.color.r));
  stage.dispose();
});

test('look-at orients the object via onUpdate and stays deterministic', () => {
  const stage = stageWith([{ name: 'a', type: 'box', position: [2, 0, 0] }], [
    { do: 'look-at', to: 'a', dur: 1, with: { x: 0, y: 0, z: 0 } },
  ]);
  const a = stage.objects.get('a');
  stage.seek(0);
  const r0 = a.rotation.y;
  stage.seek(1);
  const r1 = a.rotation.y;
  assert.ok(Math.abs(r1 - (-Math.PI / 2)) < 1e-6, String(r1));
  stage.seek(0.5);
  const half = [...a.rotation.toArray()];
  stage.seek(1);
  stage.seek(0.5);
  assert.deepEqual([...a.rotation.toArray()], half);
  assert.ok(r0 !== r1);
  stage.dispose();
});

test('look-at can target another object by name', () => {
  const stage = stageWith(
    [{ name: 'a', type: 'box', position: [2, 0, 0] }, { name: 'b', type: 'box', position: [4, 0, 4] }],
    [{ do: 'look-at', to: 'a', dur: 1, with: { target: 'b' } }],
  );
  stage.seek(1);
  const a = stage.objects.get('a');
  // a at (2,0,0) looking at b at (4,0,4): direction (2,0,4) -> ry = atan2(2, 4).
  assert.ok(Math.abs(a.rotation.y - Math.atan2(2, 4)) < 1e-6, String(a.rotation.y));
  stage.dispose();
});

test('DOM-selector cues are structured no-ops in Node, not crashes', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }], [
    { do: 'fade', to: '#hud', dur: 1, with: { opacity: 0 } },
  ]);
  const res = stage.scoreCompile;
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.errors.length, 0);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0].message, /#hud/);
  assert.doesNotThrow(() => stage.seek(1));
  stage.dispose();
});

test('unknown target name fails compile with structured error (standalone compileScore)', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }], []);
  const res = compileScore(stage, [{ do: 'fade', to: 'zzz', with: { opacity: 0 } }]);
  assert.equal(res.ok, false);
  const e = res.errors[0];
  assert.equal(e.path, '/score/0/to');
  assert.ok(e.suggestion === null || e.suggestion === undefined || e.suggestion !== 'a');
  stage.dispose();
});

test('stage.compileScore(score) appends cues to the live timeline', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }], [
    { do: 'move-to', to: 'a', dur: 1, with: { x: 1 } },
  ]);
  assert.ok(Math.abs(stage.timeline.duration() - 1) < 1e-6);
  const res = stage.compileScore([{ do: 'move-to', to: 'a', at: 1, dur: 2, with: { x: 3 } }]);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.ok(Math.abs(stage.timeline.duration() - 3) < 1e-6);
  stage.seek(3);
  assert.deepEqual([...stage.objects.get('a').position.toArray()], [3, 0, 0]);
  stage.dispose();
});

test('scale-to tweens object scale', () => {
  const stage = stageWith([{ name: 'a', type: 'box' }], [
    { do: 'scale-to', to: 'a', dur: 1, with: { x: 2, y: 2, z: 2 } },
  ]);
  stage.seek(1);
  assert.deepEqual([...stage.objects.get('a').scale.toArray()], [2, 2, 2]);
  stage.dispose();
});

test('createStage compiles spec.score automatically with ok result', () => {
  const stage = createStage({
    objects: [{ name: 'a', type: 'box' }],
    score: [{ do: 'move-to', to: 'a', dur: 1, with: { x: 1 } }],
  });
  assert.equal(stage.ok, true);
  assert.equal(stage.scoreCompile.ok, true);
  assert.ok(stage.timeline.duration() > 0);
  stage.dispose();
});
