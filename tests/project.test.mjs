import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createStage } from '../src/index.js';
import { createBridge } from '../src/bridge/createBridge.js';

test('project: object at the look-at point lands at the center of the stage size', () => {
  const stage = createStage({ meta: { size: { width: 1000, height: 500 } }, objects: [{ name: 'a', type: 'box' }] });
  const p = stage.bridge.project('a');
  assert.ok(Math.abs(p.x - 500) < 1e-6, String(p.x));
  assert.ok(Math.abs(p.y - 250) < 1e-6, String(p.y));
  assert.equal(p.onScreen, true);
  assert.ok(p.depth > -1 && p.depth < 1);
  stage.dispose();
});

test('project follows timeline motion deterministically (right = +x px, up = -y px)', () => {
  const stage = createStage({
    objects: [{ name: 'a', type: 'box' }],
    score: [{ do: 'move-to', to: 'a', dur: 2, ease: 'linear', with: { x: 2, y: 2 } }],
  });
  stage.seek(0);
  const start = stage.bridge.project('a');
  stage.seek(1);
  const mid = stage.bridge.project('a');
  stage.seek(2);
  const end = stage.bridge.project('a');
  assert.ok(mid.x > start.x && end.x > mid.x, 'moving +x moves right on screen');
  assert.ok(mid.y < start.y && end.y < mid.y, 'moving +y moves up on screen (smaller y px)');
  stage.seek(0.3);
  stage.seek(1);
  assert.deepEqual(stage.bridge.project('a'), mid);
  stage.dispose();
});

test('project reports onScreen=false for objects behind the camera or out of frame', () => {
  const stage = createStage({
    objects: [
      { name: 'behind', type: 'box', position: [4, 3, 40] },
      { name: 'far-right', type: 'box', position: [200, 0, 0] },
    ],
  });
  assert.equal(stage.bridge.project('behind').onScreen, false);
  assert.equal(stage.bridge.project('far-right').onScreen, false);
  stage.dispose();
});

test('project is correct for parented objects (world position)', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  const parent = new THREE.Group();
  const child = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  parent.add(child);
  parent.position.x = 1;
  child.position.x = 1; // world x = 2
  const bridge = createBridge({ objects: new Map([['c', child]]), lights: new Map(), camera, scene: new THREE.Scene() });
  const direct = createBridge({ objects: new Map([['d', new THREE.Object3D()]]), lights: new Map(), camera, scene: new THREE.Scene() });
  direct.object('d').x = 2;
  assert.ok(Math.abs(bridge.project('c').x - direct.project('d').x) < 1e-9);
});

test('project without getSize returns normalized 0..1 coordinates', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  const mesh = new THREE.Object3D();
  const bridge = createBridge({ objects: new Map([['m', mesh]]), lights: new Map(), camera, scene: new THREE.Scene() });
  const p = bridge.project('m');
  assert.ok(Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y - 0.5) < 1e-9);
});

test('project after dispose throws; unknown target throws', () => {
  const stage = createStage({ objects: [{ name: 'a', type: 'box' }] });
  assert.throws(() => stage.bridge.project('zzz'), /Unknown bridge target/);
  const { bridge } = stage;
  stage.dispose();
  assert.throws(() => bridge.project('a'), /disposed/);
});
