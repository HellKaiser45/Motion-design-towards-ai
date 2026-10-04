import * as THREE from 'three';

function vector(v) {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

export function createLights(specLights = []) {
  return specLights.map((def) => {
    let light;
    switch (def.type) {
      case 'ambient':
        light = new THREE.AmbientLight(def.color, def.intensity);
        break;
      case 'directional':
        light = new THREE.DirectionalLight(def.color, def.intensity);
        light.position.copy(vector(def.position));
        if (def.target) light.target.position.copy(vector(def.target));
        break;
      case 'point':
        light = new THREE.PointLight(def.color, def.intensity);
        light.position.copy(vector(def.position));
        break;
      case 'spot':
        light = new THREE.SpotLight(def.color, def.intensity);
        light.position.copy(vector(def.position));
        if (def.target) light.target.position.copy(vector(def.target));
        break;
      default:
        throw new Error(`Unknown light type "${def.type}"`);
    }
    light.name = def.name;
    return light;
  });
}
