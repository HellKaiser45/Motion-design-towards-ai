import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec, normalizeSpec } from '../src/spec/validate.js';
import { describeTokens, OBJECT_TYPES, MATERIAL_PRESETS, LIGHT_TYPES, BACKGROUND_PRESETS } from '../src/spec/schema.js';

const VALID_MINIMAL = {
  objects: [{ name: 'cube', type: 'box' }],
};

const VALID_FULL = {
  meta: {
    title: 'demo',
    background: 'dawn',
    fog: { color: '#101010', near: 5, far: 30 },
    size: { width: 800, height: 600 },
  },
  camera: { fov: 60, position: [0, 5, 10], lookAt: [0, 1, 0] },
  lights: [
    { name: 'key', type: 'directional', color: '#ffffff', intensity: 2, position: [5, 10, 5], target: [0, 0, 0] },
    { name: 'amb', type: 'ambient', intensity: 0.4 },
  ],
  objects: [
    {
      name: 'ball',
      type: 'sphere',
      material: { preset: 'neon', color: '#ff00ff', opacity: 0.9, emissive: '#ff00ff' },
      position: [1, 2, 3],
      rotation: [0, 0.5, 0],
      scale: 2,
      params: { radius: 2 },
    },
    {
      name: 'knot',
      type: 'torusKnot',
      material: { preset: 'glass' },
      scale: [1, 1, 1],
      params: { p: 3, q: 4 },
    },
  ],
};

test('minimal spec is valid', () => {
  const r = validateSpec(VALID_MINIMAL);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.errors, []);
});

test('full-featured spec is valid', () => {
  const r = validateSpec(VALID_FULL);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('empty spec {} is valid', () => {
  const r = validateSpec({});
  assert.equal(r.ok, true);
});

test('unknown object type suggests sphere', () => {
  const r = validateSpec({ objects: [{ name: 'x', type: 'spher' }] });
  assert.equal(r.ok, false);
  const e = r.errors.find((e) => e.path === '/objects/0/type');
  assert.ok(e);
  assert.equal(e.suggestion, 'sphere');
});

test('unknown material preset suggests metal', () => {
  const r = validateSpec({ objects: [{ name: 'x', type: 'box', material: { preset: 'metl' } }] });
  assert.equal(r.ok, false);
  const e = r.errors.find((e) => e.path === '/objects/0/material/preset');
  assert.ok(e);
  assert.equal(e.suggestion, 'metal');
});

test('unknown background suggests nearest preset or gives clear error', () => {
  const r = validateSpec({ meta: { background: 'dusk' } });
  assert.equal(r.ok, false);
  const e = r.errors.find((e) => e.path === '/meta/background');
  assert.ok(e);
  assert.ok(e.suggestion === 'dawn' || e.message.includes('background'), JSON.stringify(e));
});

test('unknown object key with did-you-mean', () => {
  const r = validateSpec({ objects: [{ name: 'x', type: 'box', rotaton: [0, 0, 0] }] });
  assert.equal(r.ok, false);
  const e = r.errors.find((e) => e.path === '/objects/0/rotaton');
  assert.ok(e);
  assert.equal(e.suggestion, 'rotation');
});

test('duplicate object names error with path', () => {
  const r = validateSpec({
    objects: [
      { name: 'a', type: 'box' },
      { name: 'a', type: 'sphere' },
    ],
  });
  assert.equal(r.ok, false);
  const e = r.errors.find((e) => e.path === '/objects/1/name');
  assert.ok(e);
  assert.match(e.message, /Duplicate/);
});

test('duplicate light names error', () => {
  const r = validateSpec({
    lights: [
      { name: 'l', type: 'ambient' },
      { name: 'l', type: 'point' },
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/lights/1/name' && /Duplicate/.test(e.message)));
});

test('malformed vector: wrong length', () => {
  const r = validateSpec({ camera: { position: [1, 2] } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/camera/position'));
});

test('malformed vector: non-number element', () => {
  const r = validateSpec({ objects: [{ name: 'x', type: 'box', position: [0, '1', 0] }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/objects/0/position'));
});

test('scale accepts number or [x,y,z], rejects other shapes', () => {
  assert.equal(validateSpec({ objects: [{ name: 'x', type: 'box', scale: 2 }] }).ok, true);
  assert.equal(validateSpec({ objects: [{ name: 'x', type: 'box', scale: [1, 2, 3] }] }).ok, true);
  const r = validateSpec({ objects: [{ name: 'x', type: 'box', scale: 'big' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/objects/0/scale'));
});

test('fog requires color, near, far together', () => {
  const r = validateSpec({ meta: { fog: { color: '#101010', near: 1 } } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/meta/fog'));
});

test('non-integer or non-positive size errors', () => {
  const r = validateSpec({ meta: { size: { width: 0, height: 1.5 } } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/meta/size/width'));
  assert.ok(r.errors.some((e) => e.path === '/meta/size/height'));
});

test('fov out of range errors', () => {
  const r = validateSpec({ camera: { fov: 200 } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/camera/fov'));
});

test('opacity must be 0..1', () => {
  const r = validateSpec({ objects: [{ name: 'x', type: 'box', material: { opacity: 2 } }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/objects/0/material/opacity'));
});

test('emissive only allowed for neon', () => {
  const r = validateSpec({ objects: [{ name: 'x', type: 'box', material: { emissive: '#ff0000' } }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/objects/0/material/emissive'));
  assert.equal(validateSpec({ objects: [{ name: 'x', type: 'box', material: { preset: 'neon', emissive: '#ff0000' } }] }).ok, true);
});

test('params must match object type', () => {
  const r = validateSpec({ objects: [{ name: 'x', type: 'box', params: { radius: 1 } }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/objects/0/params/radius'));
  const r2 = validateSpec({ objects: [{ name: 'x', type: 'box', params: { widht: 1 } }] });
  const e2 = r2.errors.find((e) => e.path === '/objects/0/params/widht');
  assert.ok(e2);
  assert.equal(e2.suggestion, 'width');
});

test('colors must match #rrggbb', () => {
  const r = validateSpec({ objects: [{ name: 'x', type: 'box', material: { color: 'red' } }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/objects/0/material/color'));
});

test('unknown top-level key errors', () => {
  const r = validateSpec({ scene: {} });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/scene'));
});

test('normalizeSpec applies camera defaults', () => {
  const out = normalizeSpec(VALID_MINIMAL);
  assert.deepEqual(out.camera, { fov: 50, position: [4, 3, 8], lookAt: [0, 0, 0] });
  assert.deepEqual(out.meta.background, 'void');
  assert.deepEqual(out.meta.size, { width: 1280, height: 720 });
});

test('normalizeSpec applies object and light defaults', () => {
  const out = normalizeSpec(VALID_MINIMAL);
  const obj = out.objects[0];
  assert.deepEqual(obj.position, [0, 0, 0]);
  assert.deepEqual(obj.rotation, [0, 0, 0]);
  assert.deepEqual(obj.scale, [1, 1, 1]);
  assert.deepEqual(obj.material, { preset: 'standard', color: '#94a3b8', opacity: 1 });
  assert.deepEqual(obj.params, OBJECT_TYPES.box.params);
});

test('normalizeSpec resolves numeric scale to vector', () => {
  const out = normalizeSpec({ objects: [{ name: 'x', type: 'box', scale: 2 }] });
  assert.deepEqual(out.objects[0].scale, [2, 2, 2]);
});

test('normalizeSpec fills light defaults', () => {
  const out = normalizeSpec({ lights: [{ name: 'l', type: 'point' }] });
  assert.deepEqual(out.lights[0], { name: 'l', type: 'point', color: '#ffffff', intensity: 1, position: [2, 3, 4] });
});

test('normalizeSpec merges type params with user overrides', () => {
  const out = normalizeSpec({ objects: [{ name: 'k', type: 'torusKnot', params: { p: 3, q: 4 } }] });
  assert.deepEqual(out.objects[0].params, { radius: 1, tube: 0.4, tubularSegments: 64, radialSegments: 8, p: 3, q: 4 });
});

test('normalizeSpec throws on invalid input with structured detail', () => {
  assert.throws(() => normalizeSpec({ objects: [{ name: 'x', type: 'spher' }] }), /Invalid stage spec[\s\S]*\/objects\/0\/type[\s\S]*sphere/);
});

test('prototype-chain keys are rejected for object type (C1)', () => {
  const r = validateSpec({ objects: [{ name: 'x', type: 'constructor' }] });
  assert.equal(r.ok, false);
  const e = r.errors.find((e) => e.path === '/objects/0/type');
  assert.ok(e);
  assert.match(e.message, /Unknown object type "constructor"/);
});

test('prototype-chain keys are rejected for background (C1)', () => {
  const r = validateSpec({ meta: { background: 'toString' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/meta/background'));
});

test('normalizeSpec default scale is a [1,1,1] vector (M3)', () => {
  const out = normalizeSpec({ objects: [{ name: 'x', type: 'box' }] });
  assert.deepEqual(out.objects[0].scale, [1, 1, 1]);
});

test('normalizeSpec skips validation when requested (M4 fast path)', () => {
  const out = normalizeSpec({ objects: [{ name: 'x', type: 'box' }] }, { skipValidation: true });
  assert.deepEqual(out.objects[0].scale, [1, 1, 1]);
});

test('light.target is not silently accepted when light.type is invalid', () => {
  const r = validateSpec({ lights: [{ name: 'l', type: 'nope', target: [0, 0, 0] }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '/lights/0/target'));
});

test('describeTokens exposes the full vocabulary', () => {
  const tokens = describeTokens();
  assert.equal(tokens.version, 1);
  assert.deepEqual(Object.keys(tokens.backgroundPresets), Object.keys(BACKGROUND_PRESETS));
  assert.deepEqual(tokens.lightTypes, [...LIGHT_TYPES]);
  assert.deepEqual(tokens.materialPresets, [...MATERIAL_PRESETS]);
  assert.deepEqual(Object.keys(tokens.objectTypes), Object.keys(OBJECT_TYPES));
  for (const [type, def] of Object.entries(tokens.objectTypes)) {
    assert.deepEqual(Object.keys(def.params), Object.keys(OBJECT_TYPES[type].params));
  }
  assert.ok(tokens.rules.objects.material);
  assert.ok(JSON.stringify(tokens).length > 500);
});
