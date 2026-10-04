import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createStage } from '../src/index.js';
import { createBridge } from '../src/bridge/createBridge.js';

function ctx(meshes = {}) {
  return { objects: new Map(Object.entries(meshes)), lights: new Map(), camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() };
}

function shaderMesh() {
  const material = new THREE.ShaderMaterial({ uniforms: { uProgress: { value: 0 } } });
  return new THREE.Mesh(new THREE.BoxGeometry(), material);
}

test('channel binds a shader uniform by registered name + dotted path', () => {
  const hero = shaderMesh();
  const bridge = createBridge(ctx({ hero }));
  const ch = bridge.channel('progress', { target: 'hero', path: 'material.uniforms.uProgress.value' });
  ch.value = 0.75;
  assert.equal(hero.material.uniforms.uProgress.value, 0.75);
  hero.material.uniforms.uProgress.value = 0.1;
  assert.equal(ch.value, 0.1);
});

test('channel binds array indices (morph target influences) on an object', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.morphTargetInfluences = [0, 0];
  const ch = createBridge(ctx()).channel('smile', { target: mesh, path: 'morphTargetInfluences.1' });
  ch.value = 0.5;
  assert.deepEqual(mesh.morphTargetInfluences, [0, 0.5]);
});

test('channel with custom get/set', () => {
  let store = 2;
  const ch = createBridge(ctx()).channel('custom', { get: () => store, set: (v) => { store = v * 10; } });
  assert.equal(ch.value, 2);
  ch.value = 3;
  assert.equal(store, 30);
});

test('channel(id) returns the same channel; duplicates and unknown ids throw', () => {
  const bridge = createBridge(ctx());
  const a = bridge.channel('a', { get: () => 1, set: () => {} });
  assert.equal(bridge.channel('a'), a);
  assert.throws(() => bridge.channel('a', { get: () => 1, set: () => {} }), /already exists/);
  assert.throws(() => bridge.channel('nope'), /Unknown channel "nope".*a/);
});

test('channel rejects bad bindings and unresolvable paths', () => {
  const bridge = createBridge(ctx({ hero: shaderMesh() }));
  assert.throws(() => bridge.channel('x', {}), /binding must be/);
  assert.throws(() => bridge.channel('x', { target: 'hero', path: 'material.uniforms.uNope.value' }), /does not resolve/);
  assert.throws(() => bridge.channel('x', { target: 'hero', path: 'material.nope' }), /does not resolve/);
  assert.throws(() => bridge.channel('x', { target: 'ghost', path: 'position.x' }), /Unknown bridge target/);
  assert.throws(() => bridge.channel('', { get: () => 1, set: () => {} }), /non-empty/);
});

test('channelValues returns a plain JSON map', () => {
  const hero = shaderMesh();
  const bridge = createBridge(ctx({ hero }));
  bridge.channel('p', { target: 'hero', path: 'material.uniforms.uProgress.value' }).value = 0.3;
  assert.deepEqual(bridge.channelValues(), { p: 0.3 });
});

test('dispose clears channels', () => {
  const bridge = createBridge(ctx());
  bridge.channel('a', { get: () => 1, set: () => {} });
  bridge.dispose();
  assert.throws(() => bridge.channel('a'), /disposed/);
});

test('a channel tweened on the stage timeline is deterministic under seek', () => {
  const stage = createStage({ objects: [{ name: 'a', type: 'box' }] });
  const mesh = stage.objects.get('a');
  mesh.morphTargetInfluences = [0];
  const ch = stage.bridge.channel('m', { target: 'a', path: 'morphTargetInfluences.0' });
  stage.timeline.to(ch, { value: 1, duration: 2, ease: 'none' }, 0);
  stage.seek(1);
  assert.ok(Math.abs(mesh.morphTargetInfluences[0] - 0.5) < 1e-6);
  stage.seek(2);
  stage.seek(0.5);
  assert.ok(Math.abs(mesh.morphTargetInfluences[0] - 0.25) < 1e-6);
  stage.dispose();
});
