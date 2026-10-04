import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createStage, validateSpec, normalizeSpec, schema, describeTokens } from '../src/index.js';
import { MockElement } from '../src/svg/createOverlay.js';
import gsap from 'gsap';

const here = path.dirname(fileURLToPath(import.meta.url));
const helloSpec = JSON.parse(readFileSync(path.join(here, '..', 'examples', 'hello-stage.json'), 'utf8'));

test('describeTokens / schema are exported', () => {
  assert.equal(schema.version, 1);
  assert.equal(describeTokens().version, 1);
});

test('createStage builds scene from hello-stage.json', () => {
  const stage = createStage(helloSpec);
  assert.equal(stage.ok, true);
  assert.equal(stage.renderer, null); // no WebGL in Node
  const hero = stage.objects.get('hero');
  assert.ok(hero, 'hero object registered');
  assert.equal(hero.name, 'hero');
  assert.equal(hero.material.emissive.getHexString(), '22d3ee');
  assert.equal(stage.camera.position.x, 3);
  assert.equal(stage.camera.position.y, 2);
  assert.equal(stage.camera.position.z, 5);
  assert.equal(stage.scene.children.filter((c) => c.isLight).length, 1);
  assert.equal(stage.scene.background.getHexString(), '0a0a0f');
  assert.equal(stage.objects.size, 1);
});

test('neon material uses emissive derived from color when not specified', () => {
  const stage = createStage({
    objects: [{ name: 'n', type: 'sphere', material: { preset: 'neon', color: '#ff0000' } }],
  });
  const mesh = stage.objects.get('n');
  assert.equal(mesh.material.emissive.getHexString(), 'ff0000');
  assert.equal(mesh.material.emissiveIntensity, 1);
  stage.dispose();
});

test('material presets map to expected material classes', () => {
  const specs = {
    basic: 'MeshBasicMaterial',
    standard: 'MeshStandardMaterial',
    neon: 'MeshStandardMaterial',
    glass: 'MeshPhysicalMaterial',
    metal: 'MeshStandardMaterial',
    wire: 'MeshBasicMaterial',
  };
  for (const [preset, className] of Object.entries(specs)) {
    const stage = createStage({
      objects: [{ name: 'o', type: 'box', material: { preset, color: '#123456' } }],
    });
    const mesh = stage.objects.get('o');
    assert.equal(mesh.material.type, className, preset);
    stage.dispose();
  }
});

test('glass material is transparent with transmission 0.9', () => {
  const stage = createStage({
    objects: [{ name: 'g', type: 'box', material: { preset: 'glass', color: '#ffffff', opacity: 0.5 } }],
  });
  const mesh = stage.objects.get('g');
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.transmission, 0.9);
  assert.equal(mesh.material.opacity, 0.5);
  stage.dispose();
});

test('buildObject applies position/rotation/scale and geometry params', () => {
  const stage = createStage({
    objects: [{ name: 'b', type: 'box',
      params: { width: 2, height: 3, depth: 4 },
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: 2,
    }],
  });
  const mesh = stage.objects.get('b');
  assert.deepEqual([...mesh.position.toArray()], [1, 2, 3]);
  assert.ok(Math.abs(mesh.rotation.x - 0.1) < 1e-9);
  assert.deepEqual([...mesh.scale.toArray()], [2, 2, 2]);
  assert.equal(mesh.geometry.parameters.width, 2);
  assert.equal(mesh.geometry.parameters.height, 3);
  assert.equal(mesh.geometry.parameters.depth, 4);
  stage.dispose();
});

test('invalid spec returns structured errors when onValidateError given', () => {
  const collected = [];
  const stage = createStage({ objects: [{ name: 'x', type: 'sqhere' }] }, {
    onValidateError: (errors) => collected.push(...errors),
  });
  assert.equal(stage.ok, false);
  assert.ok(Array.isArray(stage.errors));
  assert.equal(collected.length, stage.errors.length);
  for (const e of stage.errors) {
    assert.equal(typeof e.path, 'string');
    assert.equal(typeof e.message, 'string');
  }
  assert.ok(stage.errors.some((e) => e.suggestion === 'sphere'));
});

test('invalid spec throws when no onValidateError provided', () => {
  assert.throws(() => createStage({ objects: [{ type: 'box' }] }), /Invalid stage spec/);
});

test('timeline is a paused GSAP timeline', () => {
  const stage = createStage(helloSpec);
  assert.equal(typeof stage.timeline.add, 'function');
  assert.equal(stage.timeline.paused(), true);
  stage.dispose();
});

test('seek(0) does not throw and seek is drift-free', () => {
  const stage = createStage(helloSpec);
  assert.doesNotThrow(() => stage.seek(0));
  stage.seek(1);
  const pos1 = stage.objects.get('hero').position.clone();
  stage.seek(1);
  const pos2 = stage.objects.get('hero').position.clone();
  assert.deepEqual(pos2.toArray(), pos1.toArray());
  stage.dispose();
});

test('dispose is idempotent and safe in Node', () => {
  const stage = createStage(helloSpec);
  stage.dispose();
  assert.doesNotThrow(() => stage.dispose());
  assert.equal(stage.objects.size, 0);
});

test('exposed API surface', () => {
  const stage = createStage(helloSpec);
  for (const key of ['ok', 'scene', 'camera', 'renderer', 'timeline', 'objects', 'play', 'pause', 'seek', 'render', 'dispose']) {
    assert.ok(key in stage, `missing ${key}`);
  }
  assert.equal(typeof stage.play, 'function');
  assert.equal(typeof stage.pause, 'function');
  assert.equal(typeof stage.seek, 'function');
  assert.equal(typeof stage.render, 'function');
  assert.equal(typeof stage.dispose, 'function');
  stage.dispose();
});

test('render() and play/pause are safe headless', () => {
  const stage = createStage(helloSpec);
  assert.doesNotThrow(() => stage.render());
  assert.doesNotThrow(() => stage.play());
  assert.doesNotThrow(() => stage.pause());
  stage.dispose();
});

test('dispose makes play/pause/seek consistent no-ops (M1)', () => {
  const stage = createStage(helloSpec);
  stage.dispose();
  assert.doesNotThrow(() => stage.play());
  assert.doesNotThrow(() => stage.pause());
  assert.doesNotThrow(() => stage.seek(2));
});

test('stage.lights registry is addressable by name (M2)', () => {
  const stage = createStage({
    lights: [
      { name: 'key', type: 'directional', position: [5, 10, 5] },
      { name: 'fill', type: 'point', intensity: 0.5 },
      { name: 'amb', type: 'ambient', intensity: 0.3 },
    ],
    objects: [{ name: 'b', type: 'box' }],
  });
  assert.ok(stage.lights instanceof Map);
  assert.deepEqual([...stage.lights.keys()].sort(), ['amb', 'fill', 'key']);
  const key = stage.lights.get('key');
  assert.ok(key.isLight);
  assert.equal(key.name, 'key');
  assert.ok(stage.lights.get('fill').isPointLight);
  assert.ok(stage.lights.get('amb').isAmbientLight);
  assert.equal(stage.lights.size, 3);
  stage.dispose();
});

test('stage.objects, stage.lights and stage.camera share the registry story (M2)', () => {
  const stage = createStage(helloSpec);
  assert.ok(stage.objects instanceof Map);
  assert.ok(stage.lights instanceof Map);
  assert.ok(stage.camera.isCamera);
  stage.dispose();
});

test('createStage rejects prototype-chain object type without a TypeError (C1)', () => {
  const collected = [];
  const stage = createStage({ objects: [{ name: 'x', type: 'constructor' }] }, {
    onValidateError: (errors) => collected.push(...errors),
  });
  assert.equal(stage.ok, false);
  assert.ok(stage.errors.some((e) => e.path === '/objects/0/type'));
  assert.throws(() => createStage({ objects: [{ name: 'x', type: 'constructor' }] }), /Invalid stage spec/);
});

test('createStage rejects prototype-chain background without corrupting the stage (C1)', () => {
  const stage = createStage({ meta: { background: 'toString' }, objects: [{ name: 'x', type: 'box' }] }, {
    onValidateError: (errors) => errors,
  });
  assert.equal(stage.ok, false);
  assert.ok(stage.errors.some((e) => e.path === '/meta/background'));
});

// SVG overlay mount stubs: overlay uses createElementNS + body.appendChild.
// querySelector returns null so DOM-selector score cues compile as no-ops.
function installOverlayDom() {
  const realDocument = globalThis.document;
  const fakeCanvas = () => ({ style: {}, getContext: () => ({}), remove() { this.removed = true; } });
  const body = new MockElement('body');
  globalThis.document = {
    createElement: () => fakeCanvas(),
    createElementNS: () => new MockElement('svg'),
    querySelector: () => null,
    body,
  };
  return { body, restore() { globalThis.document = realDocument; } };
}

test('svg overlay with mount "body" is auto-appended to document.body on top of the canvas', () => {
  const dom = installOverlayDom();
  try {
    const stage = createStage({
      svg: { text: [{ id: 't', content: 'hi', split: 'char', x: 10, y: 20 }] },
      objects: [{ name: 'b', type: 'box' }],
    });
    assert.equal(stage.ok, true);
    assert.equal(stage.svg.detached, false);
    assert.ok(dom.body.children.includes(stage.canvas), 'canvas in body');
    assert.ok(dom.body.children.includes(stage.svg.el), 'overlay in body');
    assert.ok(dom.body.children.indexOf(stage.svg.el) > dom.body.children.indexOf(stage.canvas), 'overlay after canvas');
    stage.dispose();
  } finally {
    dom.restore();
  }
});

test('svg overlay with mount other than "body" is built but stays detached', () => {
  const dom = installOverlayDom();
  try {
    const stage = createStage({
      display: { mount: 'none' },
      svg: { text: [{ id: 't', content: 'hi', split: 'char', x: 10, y: 20 }] },
      objects: [{ name: 'b', type: 'box' }],
    });
    assert.equal(stage.ok, true);
    assert.ok(stage.svg, 'overlay built');
    assert.ok(stage.svg.el, 'overlay element exists');
    assert.ok(!dom.body.children.includes(stage.svg.el), 'overlay NOT in body');
    assert.ok(!dom.body.children.includes(stage.canvas), 'canvas also detached');
    stage.dispose();
    assert.ok(!dom.body.children.includes(stage.svg.el));
  } finally {
    dom.restore();
  }
});

test('dispose removes the auto-attached overlay from body exactly once', () => {
  const dom = installOverlayDom();
  try {
    const stage = createStage({
      svg: { text: [{ id: 't', content: 'hi', split: 'char', x: 10, y: 20 }] },
      objects: [{ name: 'b', type: 'box' }],
    });
    assert.ok(dom.body.children.includes(stage.svg.el));
    stage.dispose();
    assert.ok(!dom.body.children.includes(stage.svg.el), 'overlay removed from body');
    assert.ok(stage.svg.destroyed);
    assert.doesNotThrow(() => stage.dispose(), 'double dispose is safe');
  } finally {
    dom.restore();
  }
});

test('validateSpec + normalizeSpec round-trip (frozen contract still works)', () => {
  const { ok, errors } = validateSpec(helloSpec);
  assert.equal(ok, true, JSON.stringify(errors));
  const norm = normalizeSpec(helloSpec);
  assert.equal(norm.objects[0].params.width, 1);
  assert.deepEqual(norm.objects[0].scale, [1, 1, 1]);
});
