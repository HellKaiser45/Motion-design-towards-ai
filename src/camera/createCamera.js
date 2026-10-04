import * as THREE from 'three';
import { DEFAULTS } from '../spec/schema.js';

// With no arguments, yields a valid camera from DEFAULTS.camera.
export function createCamera(specSection = {}, aspect = 16 / 9) {
  const { fov = DEFAULTS.camera.fov, position = DEFAULTS.camera.position, lookAt = DEFAULTS.camera.lookAt } = specSection;
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2]));
  return camera;
}
