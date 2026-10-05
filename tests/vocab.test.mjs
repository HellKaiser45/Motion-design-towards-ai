import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  createStage,
  validateSpec,
  normalizeSpec,
  reportSpec,
  describeTokens,
} from '../src/index.js';
import { buildObject } from '../src/objects/buildObject.js';

assert.equal(typeof document, 'undefined', 'vocab tests must run headless');

function near(v, target, tol = 1e-4) {
  const d = Math.hypot(v.x - target[0], v.y - target[1], v.z - target[2]);
  assert.ok(d <= tol, `expected [${target}] within ${tol}, got delta ${d} at [${v.x}, ${v.y}, ${v.z}]`);
}

// ---------------------------------------------------------------- (A) groups

test('parent moves → child world position follows it', () => {
  const stage = createStage({
    camera: { position: [0, 3, 12] },
    objects: [
      { name: 'root', type: 'box', position: [1, 0, 0] },
      { name: 'leaf', type: 'sphere', parent: 'root', position: [1, 0, 0] },
    ],
    score: [{ do: 'move-to', to: 'root', at: 0, dur: 1, with: { x: 5 } }],
  });
  const root = stage.objects.get('root');
  const leaf = stage.objects.get('leaf');
  assert.equal(leaf.parent, root, 'registry is flat but tree links child to parent');
  assert.ok(stage.scene.children.includes(root), 'root is a direct scene child');
  assert.ok(!stage.scene.children.includes(leaf), 'child is not a direct scene child');
  const before = new THREE.Vector3();
  leaf.getWorldPosition(before);
  near(before, [2, 0, 0]);
  stage.seek(1);
  const after = new THREE.Vector3();
  leaf.getWorldPosition(after);
  near(after, [6, 0, 0], 1e-4);
  stage.dispose();
});

test('cue on a child animates its LOCAL transform', () => {
  const stage = createStage({
    objects: [
      { name: 'root', type: 'box', position: [2, 0, 0] },
      { name: 'leaf', type: 'sphere', parent: 'root' },
    ],
    score: [{ do: 'move-to', to: 'leaf', at: 0, dur: 1, with: { x: 1 } }],
  });
  const leaf = stage.objects.get('leaf');
  stage.seek(1);
  assert.equal(leaf.position.x, 1, 'local position animated');
  const world = new THREE.Vector3();
  leaf.getWorldPosition(world);
  near(world, [3, 0, 0], 1e-4);
  stage.dispose();
});

test('parent validation: unknown parent (suggestion), self-parent, cycle', () => {
  const unknown = validateSpec({
    objects: [
      { name: 'a', type: 'box', parent: 'bb' },
      { name: 'b', type: 'box' },
    ],
  });
  assert.equal(unknown.ok, false);
  const e = unknown.errors.find((e) => e.path === '/objects/0/parent');
  assert.ok(e, 'structured parent error');
  assert.equal(e.suggestion, 'b');

  const self = validateSpec({
    objects: [{ name: 'a', type: 'box', parent: 'a' }],
  });
  assert.equal(self.ok, false);
  assert.ok(self.errors.some((e) => e.path === '/objects/0/parent' && /own parent/.test(e.message)));

  const cycle = validateSpec({
    objects: [
      { name: 'a', type: 'box', parent: 'b' },
      { name: 'b', type: 'box', parent: 'a' },
    ],
  });
  assert.equal(cycle.ok, false);
  assert.ok(cycle.errors.some((e) => /cycle/i.test(e.message) && e.path.startsWith('/objects/')));

  // Valid chain is ok.
  const ok = validateSpec({
    objects: [
      { name: 'a', type: 'box' },
      { name: 'b', type: 'box', parent: 'a' },
      { name: 'c', type: 'box', parent: 'b' },
    ],
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(normalizeSpec({ objects: [{ name: 'a', type: 'box' }, { name: 'b', type: 'sphere', parent: 'a' }] }).objects[1].parent, 'a');
});

// ----------------------------------------------------------- (B) camera verbs

function cameraStage(withParams, cue) {
  return createStage({
    camera: { position: [8, 2, 0] },
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: cue.do, to: 'camera', at: 0, dur: 2, with: withParams }],
  });
}

test('orbit half-turn from [8,2,0] radius 8 ends at [-8,2,0] looking at center', () => {
  const stage = cameraStage({ to: Math.PI }, { do: 'orbit' });
  const cam = stage.camera;
  stage.seek(0);
  near(cam.position, [8, 2, 0], 1e-6);
  stage.seek(2);
  near(cam.position, [-8, 2, 0], 1e-3);
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  const expected = new THREE.Vector3(0, 0, 0).sub(cam.position).normalize();
  assert.ok(dir.angleTo(expected) < 1e-3, 'camera looks at center after orbit');
  stage.dispose();
});

test('dolly 8 -> 2 ends at distance 2 from center, looking at center', () => {
  const stage = cameraStage({ to: 2 }, { do: 'dolly' });
  const cam = stage.camera;
  stage.seek(2);
  assert.ok(Math.abs(cam.position.length() - 2) < 1e-3, `distance ${cam.position.length()}`);
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  const expected = new THREE.Vector3(0, 0, 0).sub(cam.position).normalize();
  assert.ok(dir.angleTo(expected) < 1e-3);
  stage.dispose();
});

test('zoom 50 -> 80 ends at fov 80', () => {
  const stage = cameraStage({ from: 50, to: 80 }, { do: 'zoom' });
  stage.seek(0);
  assert.equal(stage.camera.fov, 50);
  stage.seek(2);
  assert.ok(Math.abs(stage.camera.fov - 80) < 1e-6);
  stage.dispose();
});

test('camera verbs: non-camera target, missing with.to, fov range errors', () => {
  const badTarget = validateSpec({
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: 'dolly', to: 'b', with: { to: 1 } }],
  });
  assert.equal(badTarget.ok, false);
  assert.ok(badTarget.errors.some((e) => /requires to: 'camera'/.test(e.message)));

  const missingTo = validateSpec({
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: 'dolly', to: 'camera' }],
  });
  assert.equal(missingTo.ok, false);
  assert.ok(missingTo.errors.some((e) => /requires with\.to/.test(e.message)));

  const fov = validateSpec({
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: 'zoom', to: 'camera', with: { to: 200 } }],
  });
  assert.equal(fov.ok, false);
  assert.ok(fov.errors.some((e) => /1 and 179/.test(e.message)));

  const ok = validateSpec({
    objects: [{ name: 'b', type: 'box' }],
    score: [
      { do: 'zoom', to: 'camera', with: { to: 80 }, repeat: 1, pingpong: true },
      { do: 'move-along', to: 'b', with: { points: [[0, 0, 0], [1, 0, 0]] } },
    ],
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
});

// ------------------------------------------------------------- (C) move-along

test('move-along 2-point line, linear ease hits the exact midpoint', () => {
  const stage = createStage({
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: 'move-along', to: 'b', at: 0, dur: 2, ease: 'linear', with: { points: [[0, 0, 0], [2, 0, 0]] } }],
  });
  const b = stage.objects.get('b');
  stage.seek(1);
  near(b.position, [1, 0, 0], 1e-6);
  stage.seek(2);
  near(b.position, [2, 0, 0], 1e-6);
  stage.dispose();
});

test('move-along 3-point smooth curve matches a rebuilt CatmullRomCurve3', () => {
  const points = [[0, 0, 0], [1, 1, 0], [2, 0, 0]];
  const stage = createStage({
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: 'move-along', to: 'b', at: 0, dur: 2, ease: 'linear', with: { points } }],
  });
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const b = stage.objects.get('b');
  stage.seek(1);
  const expected = curve.getPointAt(0.5);
  near(b.position, [expected.x, expected.y, expected.z], 1e-6);
  stage.dispose();
});

test('move-along orient looks along the path direction', () => {
  const stage = createStage({
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: 'move-along', to: 'b', at: 0, dur: 2, ease: 'linear', with: { points: [[0, 0, 0], [4, 0, 0]], orient: true } }],
  });
  const b = stage.objects.get('b');
  stage.seek(1);
  const dir = new THREE.Vector3();
  b.getWorldDirection(dir);
  near(dir, [1, 0, 0], 1e-3);
  stage.dispose();
});

test('move-along closed loop returns to the first point', () => {
  const stage = createStage({
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: 'move-along', to: 'b', at: 0, dur: 2, ease: 'linear', with: { points: [[0, 0, 0], [2, 0, 0], [1, 2, 0]], closed: true } }],
  });
  const b = stage.objects.get('b');
  stage.seek(2);
  near(b.position, [0, 0, 0], 1e-3);
  stage.dispose();
});

test('move-along validation: 1-point and non-vec3 point errors', () => {
  const one = validateSpec({
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: 'move-along', to: 'b', with: { points: [[0, 0, 0]] } }],
  });
  assert.equal(one.ok, false);
  assert.ok(one.errors.some((e) => /at least 2/.test(e.message)));

  const badPoint = validateSpec({
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: 'move-along', to: 'b', with: { points: [[0, 0, 0], [1, 0]] } }],
  });
  assert.equal(badPoint.ok, false);
  assert.ok(badPoint.errors.some((e) => e.path === '/score/0/with/points/1'));

  const noPoints = validateSpec({
    objects: [{ name: 'b', type: 'box' }],
    score: [{ do: 'move-along', to: 'b', with: {} }],
  });
  assert.equal(noPoints.ok, false);
  assert.ok(noPoints.errors.some((e) => /points/.test(e.message)));
});

// --------------------------------------------------------------- (D) textures

test('material.map validation: http(s) and data:image ok, other URLs rejected', () => {
  const ok = validateSpec({
    objects: [
      { name: 'a', type: 'box', material: { map: 'https://example.com/tex.png' } },
      { name: 'b', type: 'box', material: { map: 'data:image/png;base64,AAAA' } },
    ],
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  const bad = validateSpec({
    objects: [{ name: 'a', type: 'box', material: { map: 'ftp://example.com/tex.png' } }],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.path === '/objects/0/material/map'));
});

test('normalizeSpec round-trips material.map and object.parent', () => {
  const spec = {
    objects: [
      { name: 'a', type: 'box', material: { map: 'https://example.com/tex.png' } },
      { name: 'b', type: 'sphere', parent: 'a' },
    ],
  };
  const norm = normalizeSpec(spec);
  assert.equal(norm.objects[0].material.map, 'https://example.com/tex.png');
  assert.equal(norm.objects[1].parent, 'a');
});

test('headless: map is skipped with a warning; material has no map', () => {
  assert.equal(typeof document, 'undefined');
  const warnings = [];
  const mesh = buildObject(
    { name: 'm', type: 'box', params: { width: 1, height: 1, depth: 1 }, position: [0, 0, 0], rotation: [0, 0, 0], material: { preset: 'standard', color: '#ffffff', opacity: 1, map: 'https://example.com/tex.png' } },
    warnings,
  );
  assert.ok(!mesh.material.map, 'no texture headless');
  assert.deepEqual(warnings, ['material map "https://example.com/tex.png" requires a DOM/WebGL environment; ignored headless']);

  const stage = createStage({
    objects: [
      { name: 'a', type: 'box', material: { map: 'https://example.com/tex.png' } },
      { name: 'b', type: 'box' },
    ],
  });
  assert.ok(Array.isArray(stage.materialWarnings));
  assert.equal(stage.materialWarnings.length, 1);
  assert.match(stage.materialWarnings[0], /requires a DOM\/WebGL environment; ignored headless/);
  assert.ok(!stage.objects.get('a').material.map, 'no texture headless via createStage');
  stage.dispose();
});

// ------------------------------------------------------------ reportSpec integration

test('reportSpec works with move-along + orbit + parent-child', () => {
  const report = reportSpec({
    camera: { position: [8, 2, 0] },
    objects: [
      { name: 'root', type: 'box', position: [1, 0, 0] },
      { name: 'leaf', type: 'sphere', parent: 'root' },
    ],
    score: [
      { do: 'orbit', to: 'camera', at: 0, dur: 2, with: { to: Math.PI } },
      { do: 'move-along', to: 'leaf', at: 0, dur: 2, with: { points: [[0, 0, 0], [2, 0, 0], [1, 2, 0]], orient: true } },
    ],
  });
  assert.equal(report.ok, true, JSON.stringify(report.errors ?? report.issues ?? {}));
  assert.ok(Array.isArray(report.frames) && report.frames.length > 0, 'frames present');
});

test('new verbs appear in describeTokens scoreVerbs', () => {
  const verbs = describeTokens().scoreVerbs;
  for (const v of ['orbit', 'dolly', 'zoom', 'move-along']) assert.ok(verbs[v], `${v} in scoreVerbs`);
});
