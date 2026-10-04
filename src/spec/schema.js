/**
 * Single source of truth for the agent-stage Phase-1 token vocabulary.
 * Pure data module — no three.js or gsap imports.
 */

export const BACKGROUND_PRESETS = Object.freeze({
  void: '#000000',
  dawn: '#ffb199',
  night: '#0b1026',
});

export const LIGHT_TYPES = Object.freeze(['ambient', 'directional', 'point', 'spot']);

export const MATERIAL_PRESETS = Object.freeze(['basic', 'standard', 'neon', 'glass', 'metal', 'wire']);

export const OBJECT_TYPES = Object.freeze({
  box: { params: { width: 1, height: 1, depth: 1 } },
  sphere: { params: { radius: 1, widthSegments: 32, heightSegments: 16 } },
  icosahedron: { params: { radius: 1, detail: 0 } },
  dodecahedron: { params: { radius: 1 } },
  torus: { params: { radius: 1, tube: 0.4, radialSegments: 16, tubularSegments: 48 } },
  torusKnot: { params: { radius: 1, tube: 0.4, tubularSegments: 64, radialSegments: 8, p: 2, q: 3 } },
  cone: { params: { radius: 1, height: 1, radialSegments: 32 } },
  cylinder: { params: { radiusTop: 1, radiusBottom: 1, height: 1, radialSegments: 32 } },
  plane: { params: { width: 1, height: 1, widthSegments: 1, heightSegments: 1 } },
  ring: { params: { innerRadius: 0.5, outerRadius: 1, thetaSegments: 32 } },
});

export const DEFAULTS = Object.freeze({
  meta: Object.freeze({
    title: undefined,
    background: 'void',
    fog: undefined,
    size: Object.freeze({ width: 1280, height: 720 }),
  }),
  camera: Object.freeze({
    fov: 50,
    position: Object.freeze([4, 3, 8]),
    lookAt: Object.freeze([0, 0, 0]),
  }),
  light: Object.freeze({
    color: '#ffffff',
    intensity: 1,
    position: Object.freeze([2, 3, 4]),
    target: undefined,
  }),
  object: Object.freeze({
    material: Object.freeze({
      preset: 'standard',
      color: '#94a3b8',
      opacity: 1,
      emissive: undefined,
    }),
    position: Object.freeze([0, 0, 0]),
    rotation: Object.freeze([0, 0, 0]),
    scale: 1,
    params: undefined,
  }),
});

export const schema = Object.freeze({ version: 1, tokens: describeTokens() });

export function describeTokens() {
  return {
    version: 1,
    backgroundPresets: { ...BACKGROUND_PRESETS },
    lightTypes: [...LIGHT_TYPES],
    materialPresets: [...MATERIAL_PRESETS],
    objectTypes: Object.fromEntries(
      Object.entries(OBJECT_TYPES).map(([type, def]) => [
        type,
        { params: { ...def.params } },
      ])
    ),
    defaults: JSON.parse(JSON.stringify(DEFAULTS)),
    rules: {
      meta: {
        title: 'string, optional',
        background: "'#rrggbb' or one of the backgroundPresets names; default 'void'",
        fog: "{ color: '#rrggbb', near: number, far: number } — optional, all three required together",
        size: '{ width: int > 0, height: int > 0 }; default 1280x720',
      },
      camera: {
        fov: 'number 1..179; default 50',
        position: '[x, y, z]; default [4, 3, 8]',
        lookAt: '[x, y, z]; default [0, 0, 0]',
      },
      lights: {
        name: 'unique non-empty string, required',
        type: 'one of lightTypes, required',
        color: "'#rrggbb'; default '#ffffff'",
        intensity: 'number; default 1',
        position: '[x, y, z]; default [2, 3, 4]',
        target: '[x, y, z]; optional, directional/spot only',
      },
      objects: {
        name: 'unique non-empty string, required',
        type: 'one of objectTypes keys, required',
        material: {
          preset: 'one of materialPresets; default standard',
          color: "'#rrggbb'; default '#94a3b8'",
          opacity: 'number 0..1; default 1',
          emissive: "'#rrggbb'; neon only, default derived from color",
        },
        position: '[x, y, z]; default [0, 0, 0]',
        rotation: '[x, y, z] in radians; default [0, 0, 0]',
        scale: 'single number or [x, y, z]; normalized to [x, y, z]; default [1, 1, 1]',
        params: 'type-specific numbers, all optional; keys per objectTypes',
      },
    },
  };
}
