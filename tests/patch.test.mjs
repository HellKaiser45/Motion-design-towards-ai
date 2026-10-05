import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec, applyErrorPatches } from '../src/index.js';

function firstPatch(r, path) {
  const e = r.errors.find((e) => e.path === path);
  assert.ok(e, `expected an error at ${path}, got ${JSON.stringify(r.errors)}`);
  return e;
}

test('typo\u2019d ease error carries a replace patch and repair makes the spec valid', () => {
  const spec = { score: [{ do: 'fade', to: 'hero', at: 0, ease: 'power2.oout' }], objects: [{ name: 'hero', type: 'box' }] };
  const r = validateSpec(spec);
  assert.equal(r.ok, false);
  const e = firstPatch(r, '/score/0/ease');
  assert.equal(e.suggestion, 'power2.out');
  assert.deepEqual(e.patch, [{ op: 'replace', path: '/score/0/ease', value: 'power2.out' }]);
  const { spec: repaired } = applyErrorPatches(spec, r.errors);
  assert.equal(validateSpec(repaired).ok, true, JSON.stringify(validateSpec(repaired).errors));
});

test('typo\u2019d animate prop gets a rename patch (remove + add with original value)', () => {
  const spec = { objects: [{ name: 'hero', type: 'box' }], score: [{ do: 'animate', to: 'hero', with: { rotatey: 1 } }] };
  const r = validateSpec(spec);
  assert.equal(r.ok, false);
  const e = firstPatch(r, '/score/0/with/rotatey');
  assert.equal(e.suggestion, 'rotateY');
  assert.deepEqual(e.patch, [
    { op: 'remove', path: '/score/0/with/rotatey' },
    { op: 'add', path: '/score/0/with/rotateY', value: 1 },
  ]);
  const { spec: repaired } = applyErrorPatches(spec, r.errors);
  assert.deepEqual(repaired.score[0].with, { rotateY: 1 });
  assert.equal(validateSpec(repaired).ok, true, JSON.stringify(validateSpec(repaired).errors));
});

test('material opacity out of range clamps to 1', () => {
  const spec = { objects: [{ name: 'x', type: 'box', material: { opacity: 1.5 } }] };
  const r = validateSpec(spec);
  const e = firstPatch(r, '/objects/0/material/opacity');
  assert.deepEqual(e.patch, [{ op: 'replace', path: '/objects/0/material/opacity', value: 1 }]);
  const { spec: repaired } = applyErrorPatches(spec, r.errors);
  assert.equal(validateSpec(repaired).ok, true);
});

test('svg text opacity out of range clamps to 0', () => {
  const spec = { svg: { text: [{ id: 't', content: 'hi', opacity: -0.2 }] } };
  const r = validateSpec(spec);
  const e = firstPatch(r, '/svg/text/0/opacity');
  assert.deepEqual(e.patch, [{ op: 'replace', path: '/svg/text/0/opacity', value: 0 }]);
  const { spec: repaired } = applyErrorPatches(spec, r.errors);
  assert.equal(validateSpec(repaired).ok, true);
});

test('negative cue.at is patched to 0', () => {
  const spec = { score: [{ do: 'fade', to: 'hero', at: -3 }], objects: [{ name: 'hero', type: 'box' }] };
  const r = validateSpec(spec);
  const e = firstPatch(r, '/score/0/at');
  assert.deepEqual(e.patch, [{ op: 'replace', path: '/score/0/at', value: 0 }]);
  const { spec: repaired } = applyErrorPatches(spec, r.errors);
  assert.equal(validateSpec(repaired).ok, true);
  assert.equal(repaired.score[0].at, 0);
});

test('unknown background gets a replace patch', () => {
  const spec = { meta: { background: 'dwan' } };
  const r = validateSpec(spec);
  const e = firstPatch(r, '/meta/background');
  assert.equal(e.suggestion, 'dawn');
  assert.deepEqual(e.patch, [{ op: 'replace', path: '/meta/background', value: 'dawn' }]);
  const { spec: repaired } = applyErrorPatches(spec, r.errors);
  assert.equal(validateSpec(repaired).ok, true);
});

test('unknown score target near-miss is patched to the known name', () => {
  const spec = { objects: [{ name: 'hero', type: 'box' }], score: [{ do: 'fade', to: 'heroo' }] };
  const r = validateSpec(spec);
  const e = firstPatch(r, '/score/0/to/0');
  assert.equal(e.suggestion, 'hero');
  // cue.to is a single string here, so the patch replaces the string itself.
  assert.deepEqual(e.patch, [{ op: 'replace', path: '/score/0/to', value: 'hero' }]);
  const { spec: repaired } = applyErrorPatches(spec, r.errors);
  assert.equal(validateSpec(repaired).ok, true);
});

test('errors without a mechanical fix carry no patch', () => {
  const r = validateSpec({
    objects: [
      { name: 'a', type: 'box' },
      { name: 'a', type: 'box' },
      { name: 'b', position: [0, 0] },
      { name: 'c' },
    ],
  });
  const dup = firstPatch(r, '/objects/1/name');
  assert.equal(dup.patch, undefined);
  const vec = firstPatch(r, '/objects/2/position');
  assert.equal(vec.patch, undefined);
  const missing = firstPatch(r, '/objects/3/type');
  assert.equal(missing.patch, undefined);
});

test('applyErrorPatches never mutates the input spec', () => {
  const spec = { objects: [{ name: 'hero', type: 'box' }], score: [{ do: 'fade', to: 'hero', ease: 'power2.oout' }] };
  const before = JSON.parse(JSON.stringify(spec));
  const r = validateSpec(spec);
  applyErrorPatches(spec, r.errors);
  assert.deepEqual(spec, before);
});

test('repair is deterministic', () => {
  const spec = { meta: { background: 'dwan' }, objects: [{ name: 'hero', type: 'box' }], score: [{ do: 'fade', to: 'hero', at: -1 }] };
  const r = validateSpec(spec);
  const a = applyErrorPatches(spec, r.errors);
  const b = applyErrorPatches(spec, r.errors);
  assert.deepEqual(a, b);
});

test('multi-error spec: 2 patchable + 1 non-patchable \u2192 applied 2, skipped 1, still invalid', () => {
  const spec = {
    meta: { background: 'dwan' },
    objects: [
      { name: 'a', type: 'box' },
      { name: 'a', type: 'box' },
    ],
    score: [{ do: 'fade', to: 'a', at: -2 }],
  };
  const r = validateSpec(spec);
  const patchable = r.errors.filter((e) => Array.isArray(e.patch)).length;
  assert.equal(patchable, 2);
  const { spec: repaired, applied, skipped } = applyErrorPatches(spec, r.errors);
  assert.deepEqual(applied.length, 2);
  assert.deepEqual(skipped.length, 1);
  assert.equal(skipped[0] === applied[0] || skipped[0] === applied[1], false);
  const after = validateSpec(repaired);
  assert.equal(after.ok, false);
  // The only remaining error is the non-patchable duplicate name.
  assert.deepEqual(after.errors.length, 1);
  assert.match(after.errors[0].message, /Duplicate/);
  // Repair strictly reduced the error count.
  assert.ok(after.errors.length < r.errors.length);
});
