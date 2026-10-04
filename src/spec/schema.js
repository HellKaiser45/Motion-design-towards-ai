/**
 * Single source of truth for the agent-stage Phase-1+2A token vocabulary.
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

export const SVG_SHAPE_TYPES = Object.freeze({
  rect: Object.freeze({ params: Object.freeze({ x: 0, y: 0, width: 10, height: 10, rx: 0 }) }),
  circle: Object.freeze({ params: Object.freeze({ cx: 0, cy: 0, r: 1 }) }),
  line: Object.freeze({ params: Object.freeze({ x1: 0, y1: 0, x2: 1, y2: 1 }) }),
  path: Object.freeze({ params: Object.freeze({ d: '' }) }),
  group: Object.freeze({ params: Object.freeze({}) }),
});

export const SVG_TEXT_PARAMS = Object.freeze([
  'id', 'class', 'content', 'split', 'tag', 'x', 'y', 'size', 'weight', 'family', 'color', 'align',
]);

export const SVG_SPLITS = Object.freeze(['char', 'word', 'none']);

export const SVG_TAGS = Object.freeze(['text', 'tspan']);

export const SVG_ALIGNS = Object.freeze(['start', 'middle', 'end']);

export const SVG_FITS = Object.freeze(['cover', 'contain']);

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
  display: Object.freeze({
    fit: 'cover',
    position: 'fixed',
    mount: 'body',
  }),
  svg: Object.freeze({
    fit: 'cover',
    text: Object.freeze({
      class: undefined,
      content: '',
      split: 'none',
      tag: 'text',
      x: 0,
      y: 0,
      size: 24,
      weight: 400,
      family: 'sans-serif',
      color: '#ffffff',
      align: 'start',
    }),
    shape: Object.freeze({
      class: undefined,
      stroke: '#ffffff',
      fill: 'none',
      strokeWidth: 1,
    }),
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

// Score cue vocabulary (Phase 2A). Params are described as plain strings so
// the vocabulary stays JSON-emittable via describeTokens().
export const SCORE_VERBS = Object.freeze({
  'move-to': Object.freeze({ props: 'position', params: Object.freeze({ x: 'number', y: 'number', z: 'number' }) }),
  rotate: Object.freeze({ props: 'rotation (radians)', params: Object.freeze({ x: 'number', y: 'number', z: 'number' }) }),
  'scale-to': Object.freeze({ props: 'scale', params: Object.freeze({ x: 'number', y: 'number', z: 'number' }) }),
  spin: Object.freeze({ props: 'rotation (continuous)', params: Object.freeze({ axis: "'x' | 'y' | 'z'", speed: 'number, radians per second' }) }),
  fade: Object.freeze({ props: 'material.opacity (3D) | element opacity (DOM)', params: Object.freeze({ opacity: 'number 0..1' }) }),
  'color-to': Object.freeze({ props: 'material.color (3D) | element color (DOM)', params: Object.freeze({ hex: "'#rrggbb'" }) }),
  'look-at': Object.freeze({ props: 'object.lookAt via onUpdate', params: Object.freeze({ x: 'number', y: 'number', z: 'number', target: "object name — look at that object's position" }) }),
});

// Reserved non-registry targets for cue routing.
export const SCORE_RESERVED_TARGETS = Object.freeze(['camera', 'scene']);

// Repeat cap: an infinite repeat (-1) or any repeat above this is clamped so
// the timeline stays finite (seek(t) / render-to-t require a finite duration).
export const SCORE_REPEAT_CAP = 100;

export const SCORE_DEFAULTS = Object.freeze({
  at: 0,
  dur: 1,
  ease: 'power1.out',
  spin: Object.freeze({ axis: 'y', speed: 1 }),
});

// Ease tokens map 1:1 onto GSAP ease strings. Bare names default to the
// '.out' variant (GSAP's own default direction).
export const SCORE_EASES = Object.freeze(
  (() => {
    const map = {
      linear: 'none',
      none: 'none',
      steps: 'steps(12)',
    };
    const full = ['', '.in', '.out', '.inOut'];
    for (const base of ['power1', 'power2', 'power3', 'power4', 'sine', 'expo', 'circ']) {
      for (const v of full) map[base + v] = (v ? base + v : base + '.out');
    }
    for (const base of ['back', 'elastic', 'bounce']) {
      for (const v of ['', '.out', '.inOut']) map[base + v] = (v ? base + v : base + '.out');
    }
    return Object.freeze({ ...map });
  })()
);

// A cue target starting with one of these routes to the DOM layer
// (document.querySelector) instead of the 3D registries.
export function isDomSelector(target) {
  return typeof target === 'string' && /^(#|\.|svg)/.test(target);
}

export const schema = Object.freeze({ version: 1, tokens: describeTokens() });

export function describeTokens() {
  return {
    version: 1,
    svgShapeTypes: Object.fromEntries(
      Object.entries(SVG_SHAPE_TYPES).map(([type, def]) => [
        type,
        { params: { ...def.params } },
      ])
    ),
    svgTextParams: [...SVG_TEXT_PARAMS],
    svgSplits: [...SVG_SPLITS],
    svgTags: [...SVG_TAGS],
    svgAligns: [...SVG_ALIGNS],
    svgFits: [...SVG_FITS],
    backgroundPresets: { ...BACKGROUND_PRESETS },
    scoreVerbs: JSON.parse(JSON.stringify(SCORE_VERBS)),
    scoreEases: { ...SCORE_EASES },
    scoreDefaults: JSON.parse(JSON.stringify(SCORE_DEFAULTS)),
    scoreRepeatCap: SCORE_REPEAT_CAP,
    scoreReservedTargets: [...SCORE_RESERVED_TARGETS],
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
      svg: {
        fit: "'cover' | 'contain'; how the layer matches the canvas; default 'cover'",
        text: {
          id: 'unique non-empty string, required; becomes the DOM id of the text group',
          class: 'string, optional; extra CSS class on the group',
          content: 'string, required',
          split: "'char' | 'word' | 'none'; default 'none'",
          tag: "'text' | 'tspan'; element used for the text content; default 'text'",
          x: 'number; default 0',
          y: 'number; default 0',
          size: 'number; font-size; default 24',
          weight: 'number; font-weight; default 400',
          family: 'string; font-family; default sans-serif',
          color: "'#rrggbb'; fill color; default '#ffffff'",
          align: "'start' | 'middle' | 'end'; text-anchor; default 'start'",
        },
        shapes: {
          id: 'unique non-empty string, required; becomes the DOM id of the shape element',
          class: 'string, optional',
          type: "one of: 'rect' | 'circle' | 'line' | 'path' | 'group'",
          geometry: 'type-specific flat numbers, keys per SVG_SHAPE_TYPES (path uses string d; group uses children)',
          stroke: "'#rrggbb'; default '#ffffff'",
          fill: "'#rrggbb' | 'none'; default 'none'",
          strokeWidth: 'number; default 1',
        },
      },
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
      display: {
        fit: "'cover' | 'contain'; cover fills the viewport, contain letterboxes to meta.size aspect; default 'cover'",
        position: "'fixed' | 'absolute'; CSS position of the auto-mounted canvas; default 'fixed'",
        mount: "'body' | 'none'; 'body' appends the canvas to document.body, 'none' leaves it detached; default 'body'",
      },
      lights: {
        name: 'unique non-empty string, required',
        type: 'one of lightTypes, required',
        color: "'#rrggbb'; default '#ffffff'",
        intensity: 'number; default 1',
        position: '[x, y, z]; default [2, 3, 4]',
        target: '[x, y, z]; optional, directional/spot only',
      },
      score: {
        cue: "{ do: verb, to: target, at: seconds, dur: seconds, ease: token, repeat: int, pingpong: bool, stagger: seconds, with: { ...verb params } } — flat array of cues",
        verbs: 'one of scoreVerbs keys, required',
        to: 'object name, light name, \'camera\', \'scene\', an array of such names (stagger), or a DOM selector (starts with #, . or svg)',
        at: 'number >= 0, seconds; default 0',
        dur: 'number >= 0, seconds; default 1',
        ease: 'one of scoreEases keys; default power1.out',
        repeat: 'integer >= -1; -1 or values above repeatCap are clamped to repeatCap with a warning',
        pingpong: 'boolean; maps to GSAP yoyo',
        stagger: 'number >= 0; applies when to is an array',
        with: 'verb params, keys per scoreVerbs[verb].params',
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
