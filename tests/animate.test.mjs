import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStage, validateSpec, compileScore, SCORE_VERBS, describeTokens, BRIDGE_PROPS } from '../src/index.js';

const OBJ = [{ name: 'a', type: 'box' }, { name: 'b', type: 'box' }];

function stageWith(score, extra = {}) {
  const stage = createStage({ objects: OBJ, ...extra, score });
  assert.equal(stage.ok, true);
  return stage;
}

test('animate verb params mirror BRIDGE_PROPS and appear in describeTokens', () => {
  assert.deepEqual(Object.keys(SCORE_VERBS.animate.params), Object.keys(BRIDGE_PROPS));
  assert.deepEqual(Object.keys(describeTokens().scoreVerbs.animate.params), Object.keys(BRIDGE_PROPS));
});

test('animate: unknown property gets a did-you-mean suggestion', () => {
  const { ok, errors } = validateSpec({ objects: OBJ, score: [{ do: 'animate', to: 'a', with: { rotatey: 1 } }] });
  assert.equal(ok, false);
  const e = errors.find((e) => e.path === '/score/0/with/rotatey');
  assert.ok(e, JSON.stringify(errors));
  assert.equal(e.suggestion, 'rotateY');
});

test('animate: missing or empty "with" is an error', () => {
  for (const cue of [{ do: 'animate', to: 'a' }, { do: 'animate', to: 'a', with: {} }]) {
    const { ok, errors } = validateSpec({ objects: OBJ, score: [cue] });
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.path === '/score/0/with'), JSON.stringify(errors));
  }
});

test('animate: opacity must be within 0..1, other props must be finite numbers', () => {
  const bad = validateSpec({ objects: OBJ, score: [{ do: 'animate', to: 'a', with: { opacity: 2, x: 'no' } }] });
  assert.ok(bad.errors.some((e) => e.path === '/score/0/with/opacity'));
  assert.ok(bad.errors.some((e) => e.path === '/score/0/with/x'));
  const good = validateSpec({ objects: OBJ, score: [{ do: 'animate', to: ['a', 'b'], with: { x: 1, rotateY: 3, scale: 2, opacity: 0.5 } }] });
  assert.equal(good.ok, true, JSON.stringify(good.errors));
});

test('animate drives several properties from one cue and lands them', () => {
  const stage = stageWith([
    { do: 'animate', to: 'a', dur: 2, ease: 'linear', with: { x: 4, y: 2, rotateY: 2, scale: 3, opacity: 0 } },
  ]);
  assert.equal(stage.scoreCompile.ok, true, JSON.stringify(stage.scoreCompile.errors));
  const a = stage.objects.get('a');
  stage.seek(1);
  assert.ok(Math.abs(a.position.x - 2) < 1e-6);
  assert.ok(Math.abs(a.position.y - 1) < 1e-6);
  assert.ok(Math.abs(a.rotation.y - 1) < 1e-6);
  assert.ok(Math.abs(a.scale.x - 2) < 1e-6);
  assert.ok(Math.abs(a.material.opacity - 0.5) < 1e-6);
  stage.seek(2);
  assert.deepEqual(a.position.toArray(), [4, 2, 0]);
  assert.equal(a.material.opacity, 0);
  stage.seek(0);
  assert.deepEqual(a.position.toArray(), [0, 0, 0]);
  assert.deepEqual(a.scale.toArray(), [1, 1, 1]);
  stage.dispose();
});

test('animate is deterministic under out-of-order seeks', () => {
  const stage = stageWith([{ do: 'animate', to: 'a', dur: 2, with: { x: 4, rotateZ: 1 } }]);
  const a = stage.objects.get('a');
  stage.seek(1.2);
  const s1 = { p: a.position.toArray(), r: a.rotation.toArray() };
  stage.seek(2);
  stage.seek(0.3);
  stage.seek(1.2);
  assert.deepEqual({ p: a.position.toArray(), r: a.rotation.toArray() }, s1);
  stage.dispose();
});

test('animate fans out over array targets with stagger', () => {
  const stage = stageWith([
    { do: 'animate', to: ['a', 'b'], dur: 1, stagger: 0.5, ease: 'linear', with: { y: 5 } },
  ]);
  assert.ok(Math.abs(stage.timeline.duration() - 1.5) < 1e-6);
  stage.seek(0.6);
  assert.ok(Math.abs(stage.objects.get('a').position.y - 3) < 1e-6);
  assert.ok(Math.abs(stage.objects.get('b').position.y - 0.5) < 1e-6);
  stage.dispose();
});

test('animate works on lights and the camera, and honours at/pingpong', () => {
  const stage = stageWith(
    [
      { do: 'animate', to: 'key', at: 1, dur: 1, ease: 'linear', repeat: 1, pingpong: true, with: { y: 10 } },
      { do: 'animate', to: 'camera', dur: 1, ease: 'linear', with: { z: 0 } },
    ],
    { lights: [{ name: 'key', type: 'point', position: [0, 0, 0] }] },
  );
  const key = stage.lights.get('key');
  stage.seek(2);
  assert.ok(Math.abs(key.position.y - 10) < 1e-6);
  stage.seek(3);
  assert.ok(Math.abs(key.position.y - 0) < 1e-6);
  stage.seek(1);
  assert.equal(stage.camera.position.z, 0);
  stage.dispose();
});

test('animate on a DOM selector is a warning, not an error', () => {
  const stage = stageWith([{ do: 'animate', to: '#hud', dur: 1, with: { x: 5 } }]);
  assert.equal(stage.scoreCompile.ok, true);
  assert.equal(stage.scoreCompile.warnings.length, 1);
  stage.dispose();
});

test('standalone compileScore rejects an animate cue with no valid property', () => {
  const stage = stageWith([]);
  const res = compileScore(stage, [{ do: 'animate', to: 'a', with: { bogus: 1 } }]);
  assert.equal(res.ok, false);
  assert.equal(res.errors[0].path, '/score/0/with');
  stage.dispose();
});

import { readFileSync } from 'node:fs';

test('examples/bridge-demo.json validates, compiles without warnings, and animates', () => {
  const spec = JSON.parse(readFileSync(new URL('../examples/bridge-demo.json', import.meta.url), 'utf8'));
  const { ok, errors } = validateSpec(spec);
  assert.equal(ok, true, JSON.stringify(errors));
  const stage = createStage(spec);
  assert.equal(stage.ok, true);
  assert.equal(stage.scoreCompile.ok, true, JSON.stringify(stage.scoreCompile.errors));
  assert.equal(stage.scoreCompile.warnings.length, 0);
  assert.ok(stage.timeline.duration() >= 3);
  stage.seek(stage.timeline.duration());
  assert.ok(Math.abs(stage.objects.get('hero').position.y) < 1e-6);
  assert.equal(stage.objects.get('sat').material.opacity, 1);
  stage.dispose();
});
