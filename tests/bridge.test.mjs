import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import gsap from 'gsap';

import { createBridge } from '../src/bridge/createBridge.js';
import { BRIDGE_PROPS, describeTokens } from '../src/spec/schema.js';

function ctxWith(meshes = {}) {
  const objects = new Map(Object.entries(meshes));
  return { objects, lights: new Map(), camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() };
}

function box(opts = {}) {
  return new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(opts));
}

test('bridge exposes exactly the BRIDGE_PROPS vocabulary', () => {
  const bridge = createBridge(ctxWith({ a: box() }));
  assert.deepEqual(bridge.props, Object.keys(BRIDGE_PROPS));
  assert.deepEqual(Object.keys(bridge.object('a')).sort(), Object.keys(BRIDGE_PROPS).sort());
  assert.deepEqual(Object.keys(describeTokens().bridgeProps), Object.keys(BRIDGE_PROPS));
});

test('proxy writes go straight to the Object3D, reads reflect it', () => {
  const a = box();
  const p = createBridge(ctxWith({ a })).object('a');
  p.x = 3;
  p.y = -2;
  p.z = 1;
  p.rotateX = 0.1;
  p.rotateY = 0.2;
  p.rotateZ = 0.3;
  assert.deepEqual(a.position.toArray(), [3, -2, 1]);
  assert.deepEqual([a.rotation.x, a.rotation.y, a.rotation.z], [0.1, 0.2, 0.3]);
  a.position.x = 9; // direct mutation is visible through the proxy: no copy state
  assert.equal(p.x, 9);
});

test('scale is uniform; scaleX/Y/Z are per axis', () => {
  const a = box();
  const p = createBridge(ctxWith({ a })).object('a');
  p.scale = 2;
  assert.deepEqual(a.scale.toArray(), [2, 2, 2]);
  p.scaleY = 5;
  assert.deepEqual(a.scale.toArray(), [2, 5, 2]);
  assert.equal(p.scale, 2);
});

test('opacity sets material.opacity and enables transparency', () => {
  const a = box();
  const p = createBridge(ctxWith({ a })).object('a');
  assert.equal(p.opacity, 1);
  p.opacity = 0.4;
  assert.equal(a.material.opacity, 0.4);
  assert.equal(a.material.transparent, true);
});

test('opacity applies to every material of a multi-material mesh', () => {
  const m1 = new THREE.MeshBasicMaterial();
  const m2 = new THREE.MeshBasicMaterial();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), [m1, m2]);
  createBridge(ctxWith({ a })).object('a').opacity = 0.25;
  assert.equal(m1.opacity, 0.25);
  assert.equal(m2.opacity, 0.25);
});

test('opacity on an object without a material reads 1 and is a no-op', () => {
  const g = new THREE.Group();
  const p = createBridge(ctxWith({ g })).object('g');
  assert.equal(p.opacity, 1);
  assert.doesNotThrow(() => { p.opacity = 0.1; });
  assert.equal(p.opacity, 1);
});

test('same proxy reference per target (by name, by node, camera, scene)', () => {
  const a = box();
  const ctx = ctxWith({ a });
  const bridge = createBridge(ctx);
  assert.equal(bridge.object('a'), bridge.object('a'));
  assert.equal(bridge.object('a'), bridge.object(a));
  assert.equal(bridge.object('camera'), bridge.object(ctx.camera));
  bridge.object('scene').y = 4;
  assert.equal(ctx.scene.position.y, 4);
});

test('unknown target throws with the list of known names', () => {
  const bridge = createBridge(ctxWith({ hero: box() }));
  assert.throws(() => bridge.object('her0'), /Unknown bridge target "her0".*hero/);
  assert.throws(() => bridge.object(42), /registered name/);
});

test('snapshot returns a plain JSON object of all props', () => {
  const a = box();
  a.position.set(1, 2, 3);
  const snap = createBridge(ctxWith({ a })).snapshot('a');
  assert.deepEqual(Object.keys(snap), Object.keys(BRIDGE_PROPS));
  assert.equal(snap.x, 1);
  assert.equal(snap.z, 3);
  assert.doesNotThrow(() => JSON.stringify(snap));
});

test('GSAP tweens the proxy deterministically (seek is a pure function of time)', () => {
  const a = box();
  const p = createBridge(ctxWith({ a })).object('a');
  const tl = gsap.timeline({ paused: true });
  tl.to(p, { x: 5, rotateY: 2, scale: 3, opacity: 0, duration: 1, ease: 'none' }, 0);
  tl.time(0.5);
  const half = { x: a.position.x, ry: a.rotation.y, s: a.scale.x, o: a.material.opacity };
  assert.deepEqual(half, { x: 2.5, ry: 1, s: 2, o: 0.5 });
  tl.time(1);
  tl.time(0.5);
  assert.deepEqual({ x: a.position.x, ry: a.rotation.y, s: a.scale.x, o: a.material.opacity }, half);
  tl.time(0);
  assert.equal(a.position.x, 0);
  tl.kill();
});

test('dispose makes the bridge unusable', () => {
  const bridge = createBridge(ctxWith({ a: box() }));
  bridge.dispose();
  assert.throws(() => bridge.object('a'), /disposed/);
});

// ---------------------------------------------------------------- stage wiring

import { createStage, createBridge as createBridgeFromRoot, BRIDGE_PROPS as RootProps } from '../src/index.js';

test('package root exports createBridge and BRIDGE_PROPS', () => {
  assert.equal(createBridgeFromRoot, createBridge);
  assert.deepEqual(Object.keys(RootProps), Object.keys(BRIDGE_PROPS));
});

test('stage.bridge drives spec objects and lights through the stage timeline', () => {
  const stage = createStage({
    objects: [{ name: 'hero', type: 'box' }],
    lights: [{ name: 'key', type: 'point' }],
  });
  assert.equal(stage.ok, true);
  const hero = stage.bridge.object('hero');
  stage.timeline.to(hero, { x: 4, rotateY: Math.PI, duration: 2, ease: 'none' }, 0);
  stage.timeline.to(stage.bridge.object('key'), { y: 9, duration: 2, ease: 'none' }, 0);
  stage.seek(1);
  assert.equal(stage.objects.get('hero').position.x, 2);
  assert.ok(Math.abs(stage.objects.get('hero').rotation.y - Math.PI / 2) < 1e-6); // GSAP rounds tween output to ~1e-6
  assert.equal(stage.lights.get('key').position.y, 3 + (9 - 3) / 2);
  stage.seek(0);
  assert.equal(stage.objects.get('hero').position.x, 0);
  stage.dispose();
});

test('stage.dispose disposes the bridge', () => {
  const stage = createStage({ objects: [{ name: 'a', type: 'box' }] });
  const { bridge } = stage;
  stage.dispose();
  assert.throws(() => bridge.object('a'), /disposed/);
});
