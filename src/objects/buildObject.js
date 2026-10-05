import * as THREE from 'three';
import { buildMaterial } from './presets.js';

const GEOMETRY_BUILDERS = {
  box: (p) => new THREE.BoxGeometry(p.width, p.height, p.depth),
  sphere: (p) => new THREE.SphereGeometry(p.radius, p.widthSegments, p.heightSegments),
  icosahedron: (p) => new THREE.IcosahedronGeometry(p.radius, p.detail),
  dodecahedron: (p) => new THREE.DodecahedronGeometry(p.radius),
  torus: (p) => new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments),
  torusKnot: (p) => new THREE.TorusKnotGeometry(p.radius, p.tube, p.tubularSegments, p.radialSegments, p.p, p.q),
  cone: (p) => new THREE.ConeGeometry(p.radius, p.height, p.radialSegments),
  cylinder: (p) => new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments),
  plane: (p) => new THREE.PlaneGeometry(p.width, p.height, p.widthSegments, p.heightSegments),
  ring: (p) => new THREE.RingGeometry(p.innerRadius, p.outerRadius, p.thetaSegments),
};

export function buildObject(def, warnings = [], readiness = []) {
  const geometry = GEOMETRY_BUILDERS[def.type](def.params);
  const material = buildMaterial(def.material, warnings, readiness);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = def.name;
  mesh.position.set(def.position[0], def.position[1], def.position[2]);
  mesh.rotation.set(def.rotation[0], def.rotation[1], def.rotation[2]);
  // normalizeSpec resolves a scalar scale to [v, v, v]; both forms are vectors here.
  const scale = Array.isArray(def.scale) ? def.scale : [def.scale, def.scale, def.scale];
  mesh.scale.set(scale[0], scale[1], scale[2]);
  return mesh;
}
