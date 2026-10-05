import * as THREE from 'three';

export const MATERIAL_BUILDERS = Object.freeze({
  basic: ({ color, opacity }) =>
    new THREE.MeshBasicMaterial({ color, opacity, transparent: opacity < 1 }),
  standard: ({ color, opacity }) =>
    new THREE.MeshStandardMaterial({ color, opacity, transparent: opacity < 1, roughness: 0.5, metalness: 0.1 }),
  neon: ({ color, emissive, opacity }) =>
    new THREE.MeshStandardMaterial({
      color,
      emissive: emissive ?? color,
      emissiveIntensity: 1,
      opacity,
      transparent: opacity < 1,
      roughness: 0.5,
      metalness: 0.1,
    }),
  glass: ({ color, opacity }) =>
    new THREE.MeshPhysicalMaterial({
      color,
      transmission: 0.9,
      transparent: true,
      opacity,
      roughness: 0.05,
      metalness: 0,
    }),
  metal: ({ color, opacity }) =>
    new THREE.MeshStandardMaterial({ color, opacity, transparent: opacity < 1, metalness: 0.9, roughness: 0.25 }),
  wire: ({ color, opacity }) =>
    new THREE.MeshBasicMaterial({ color, opacity, transparent: opacity < 1, wireframe: true }),
});

export function buildMaterial(material, warnings = [], readiness = []) {
  const builder = MATERIAL_BUILDERS[material.preset] ?? MATERIAL_BUILDERS.standard;
  const opts = { color: material.color, opacity: material.opacity };
  if (material.preset === 'neon') opts.emissive = material.emissive;
  if (material.map) {
    if (typeof document === 'undefined') {
      warnings.push(`material map "${material.map}" requires a DOM/WebGL environment; ignored headless`);
    } else {
      const tex = new THREE.TextureLoader().load(material.map);
      tex.colorSpace = THREE.SRGBColorSpace;
      opts.map = tex;
      // Resolves on load OR error so callers awaiting readiness never hang.
      readiness.push(
        new Promise((resolve) => {
          new THREE.TextureLoader().load(material.map, () => resolve(), undefined, () => resolve());
        }),
      );
    }
  }
  return builder(opts);
}
