import {
  BACKGROUND_PRESETS,
  LIGHT_TYPES,
  MATERIAL_PRESETS,
  OBJECT_TYPES,
  SVG_SHAPE_TYPES,
  SVG_SPLITS,
  SVG_TAGS,
  SVG_ALIGNS,
  SVG_FITS,
  SCORE_VERBS,
  SCORE_PRESETS,
  SCORE_EASES,
  BRIDGE_PROPS,
} from './schema.js';

const COLOR = {
  type: 'string',
  pattern: '^#[0-9a-fA-F]{6}$',
  description: "Color as '#rrggbb'.",
};

const VEC3 = {
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
  description: 'Array of exactly 3 finite numbers [x, y, z].',
};

const P01 = { type: 'number', minimum: 0, maximum: 1 };
const NON_NEG = { type: 'number', minimum: 0 };

const PRESET_DIRECTIONS = ['below', 'above', 'left', 'right', 'front', 'back'];

function enumOf(values) {
  return { type: 'string', enum: [...values] };
}

function bridgePropsSchema(minProperties) {
  return {
    type: 'object',
    additionalProperties: false,
    ...(minProperties ? { minProperties } : {}),
    properties: {
      x: { type: 'number', description: 'position.x, world units' },
      y: { type: 'number', description: 'position.y, world units' },
      z: { type: 'number', description: 'position.z, world units' },
      rotateX: { type: 'number', description: 'rotation.x, radians' },
      rotateY: { type: 'number', description: 'rotation.y, radians' },
      rotateZ: { type: 'number', description: 'rotation.z, radians' },
      scale: { type: 'number', description: 'uniform scale; sets scale.x/y/z' },
      scaleX: { type: 'number', description: 'scale.x' },
      scaleY: { type: 'number', description: 'scale.y' },
      scaleZ: { type: 'number', description: 'scale.z' },
      opacity: P01,
    },
  };
}

function materialSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    description: 'Object material. emissive is only valid for the neon preset.',
    properties: {
      preset: { ...enumOf(MATERIAL_PRESETS), description: 'Material preset; default standard.' },
      color: COLOR,
      opacity: { ...P01, description: 'Material opacity; default 1.' },
      emissive: COLOR,
      map: {
        type: 'string',
        pattern: '^(https?://|data:image/)',
        description: 'Texture image URL (http(s):// or data:image/); applied in DOM/WebGL environments, ignored headless with a warning.',
      },
    },
    allOf: [
      {
        if: { properties: { preset: { const: 'neon' } }, required: ['preset'] },
        then: { properties: { emissive: COLOR } },
      },
      {
        if: { not: { properties: { preset: { const: 'neon' } }, required: ['preset'] } },
        then: { properties: { emissive: false } },
      },
    ],
  };
}

function lightSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    description: 'Scene light. target is only valid for directional and spot lights.',
    required: ['name', 'type'],
    properties: {
      name: { type: 'string', minLength: 1, description: 'Unique light name.' },
      type: { ...enumOf(LIGHT_TYPES), description: 'Light type.' },
      color: COLOR,
      intensity: { type: 'number', description: 'Light intensity; default 1.' },
      position: VEC3,
      target: VEC3,
    },
    allOf: [
      {
        if: { properties: { type: { const: 'ambient' } }, required: ['type'] },
        then: { properties: { target: false } },
      },
    ],
  };
}

function objectSchema() {
  const branches = Object.entries(OBJECT_TYPES).map(([type, def]) => ({
    if: { properties: { type: { const: type } }, required: ['type'] },
    then: {
      properties: {
        params: {
          type: 'object',
          additionalProperties: false,
          description: `Geometry params for ${type} (all optional, numbers).`,
          properties: Object.fromEntries(
            Object.keys(def.params).map((k) => [k, { type: 'number' }])
          ),
        },
      },
    },
  }));
  return {
    type: 'object',
    additionalProperties: false,
    description: '3D object. params keys are gated per object type.',
    required: ['name', 'type'],
    properties: {
      name: { type: 'string', minLength: 1, description: 'Unique object name.' },
      type: { ...enumOf(Object.keys(OBJECT_TYPES)), description: 'Geometry type.' },
      parent: { type: 'string', minLength: 1, description: 'Name of another object in the spec to parent to; no cycles or self-reference.' },
      material: materialSchema(),
      position: VEC3,
      rotation: { ...VEC3, description: 'Rotation in radians [x, y, z].' },
      scale: {
        anyOf: [{ type: 'number' }, VEC3],
        description: 'Uniform number or [x, y, z].',
      },
      params: { type: 'object', description: 'Type-specific numbers; keys per object type.' },
    },
    allOf: branches,
  };
}

function presetParamProps(name) {
  switch (name) {
    case 'entrance':
    case 'exit': {
      const props = {
        distance: { type: 'number', description: 'Distance in world units; default 3.' },
      };
      if (name === 'entrance') props.from = { ...enumOf(PRESET_DIRECTIONS), description: "Start direction; default 'below'." };
      else props.to = { ...enumOf(PRESET_DIRECTIONS), description: "End direction; default 'below'." };
      return props;
    }
    case 'pop':
      return {};
    case 'emphasis':
      return { amount: { type: 'number', description: 'Scale multiplier; default 1.35.' } };
    case 'pulse':
      return {
        amount: { type: 'number', description: 'Scale multiplier; default 1.08.' },
        count: { type: 'number', description: 'Pulse cycles; default 3.' },
      };
    case 'float':
      return {
        height: { type: 'number', description: 'World units; default 0.4.' },
        count: { type: 'number', description: 'Float cycles; default 2.' },
      };
    case 'flip':
      return {
        axis: { ...enumOf(['x', 'y']), description: "Rotation axis; default 'y'." },
        turns: { type: 'number', description: 'Full turns; default 1.' },
      };
    case 'shake':
      return {
        intensity: { type: 'number', description: 'World units; default 0.3.' },
        count: { type: 'number', description: 'Number of shakes; default 6.' },
      };
    case 'orbit':
      return {
        center: VEC3,
        radius: { type: 'number', description: 'World units; default 3.' },
        revolutions: { type: 'number', description: 'Revolutions; default 1.' },
        steps: { type: 'number', description: 'Keyframes on the circle; default 16.' },
      };
    case 'reveal-text':
      return {
        of: { ...enumOf(['chars', 'words']), description: "Reveal unit; default 'chars'." },
        stagger: { ...NON_NEG, description: 'Seconds per item; default 0.03.' },
      };
    default:
      return {};
  }
}

function verbWithSchema(verb) {
  switch (verb) {
    case 'move-to':
    case 'rotate':
    case 'scale-to':
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
        },
        description: `${verb} params: x, y, z.`,
      };
    case 'spin':
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          axis: enumOf(['x', 'y', 'z']),
          speed: { type: 'number', description: 'Radians per second.' },
        },
        description: 'Continuous spin params.',
      };
    case 'fade':
      return {
        type: 'object',
        additionalProperties: false,
        properties: { opacity: P01 },
        description: 'Target opacity 0..1.',
      };
    case 'color-to':
      return {
        type: 'object',
        additionalProperties: false,
        properties: { hex: COLOR },
        description: 'Target color as hex.',
      };
    case 'animate':
      return bridgePropsSchema(1);
    case 'look-at':
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
          target: { type: 'string', description: "Object name to look at." },
        },
        description: 'Look-at point and/or object name.',
      };
    case 'orbit':
      return {
        type: 'object',
        additionalProperties: false,
        required: ['to'],
        properties: {
          center: VEC3,
          from: { type: 'number', description: 'Start angle in radians; default atan2 of camera position vs center.' },
          to: { type: 'number', description: 'End angle in radians.' },
          radius: { type: 'number', exclusiveMinimum: 0, description: 'Circle radius; default distance from camera to center.' },
          height: { type: 'number', description: 'Camera height; default camera y.' },
        },
        description: 'Camera orbit around center in the XZ plane.',
      };
    case 'dolly':
      return {
        type: 'object',
        additionalProperties: false,
        required: ['to'],
        properties: {
          center: VEC3,
          from: { type: 'number', exclusiveMinimum: 0, description: 'Start distance; default current distance.' },
          to: { type: 'number', exclusiveMinimum: 0, description: 'End distance.' },
        },
        description: 'Camera dolly along the direction from center to the camera.',
      };
    case 'zoom':
      return {
        type: 'object',
        additionalProperties: false,
        required: ['to'],
        properties: {
          from: { type: 'number', minimum: 1, maximum: 179, description: 'Start fov; default camera fov.' },
          to: { type: 'number', minimum: 1, maximum: 179, description: 'End fov.' },
        },
        description: 'Camera field-of-view change in degrees.',
      };
    case 'move-along':
      return {
        type: 'object',
        additionalProperties: false,
        required: ['points'],
        properties: {
          points: {
            type: 'array',
            minItems: 2,
            items: VEC3,
            description: 'Path waypoints [x, y, z].',
          },
          smooth: { type: 'boolean', description: 'Catmull-Rom smoothing when >= 3 points; default true.' },
          closed: { type: 'boolean', description: 'Close the curve back to the first point; default false.' },
          orient: { type: 'boolean', description: 'Look along the path direction while moving; default false.' },
        },
        description: 'Motion along a path.',
      };
    default:
      return null;
  }
}

function scoreSchema() {
  const cueProps = {
    do: {
      ...enumOf([...Object.keys(SCORE_VERBS), ...Object.keys(SCORE_PRESETS)]),
      description: 'Animation verb or intent preset name.',
    },
    to: {
      anyOf: [
        { type: 'string', minLength: 1 },
        { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
      ],
      description: 'Object/light name, camera, scene, DOM selector, or array of names (staggered).',
    },
    id: { type: 'string', minLength: 1, description: 'Unique cue id, addressable by after/alongside.' },
    after: { type: 'string', minLength: 1, description: 'Start when the referenced cue ends; mutually exclusive with at.' },
    alongside: { type: 'string', minLength: 1, description: 'Start when the referenced cue starts; mutually exclusive with at.' },
    offset: { type: 'number', description: 'Seconds added to the resolved start; default 0.' },
    at: { ...NON_NEG, description: 'Start time in seconds; default 0.' },
    dur: { ...NON_NEG, description: 'Duration in seconds; default 1.' },
    stagger: { ...NON_NEG, description: 'Stagger in seconds when to is an array.' },
    ease: { ...enumOf(Object.keys(SCORE_EASES)), description: 'Ease token; default power1.out.' },
    repeat: { type: 'integer', minimum: -1, description: 'Repeats; -1 or values above the cap are clamped.' },
    pingpong: { type: 'boolean', description: 'Reverse on repeat (GSAP yoyo).' },
    with: { type: 'object', description: 'Verb/preset params.' },
    from: {
      ...bridgePropsSchema(0),
      description: 'animate only: starting bridge-prop values before the tween.',
    },
  };

  const presetNames = Object.keys(SCORE_PRESETS);
  const branches = [];

  for (const [verb] of Object.entries(SCORE_VERBS)) {
    const withSchema = verbWithSchema(verb);
    if (withSchema) {
      // `orbit` is also an intent preset; only a camera-targeted orbit cue is
      // the camera verb, so gate the with-branch on to === 'camera'.
      const ifCond = verb === 'orbit'
        ? { properties: { do: { const: 'orbit' }, to: { const: 'camera' } }, required: ['do'] }
        : { properties: { do: { const: verb } }, required: ['do'] };
      branches.push({
        if: ifCond,
        then: { properties: { with: withSchema } },
      });
    }
  }
  for (const name of presetNames) {
    const presetIf = { properties: { do: { const: name } }, required: ['do'] };
    if (name === 'orbit') {
      presetIf.properties.to = { not: { const: 'camera' } };
    }
    branches.push({
      if: presetIf,
      then: {
        properties: {
          with: {
            type: 'object',
            additionalProperties: false,
            properties: presetParamProps(name),
            description: `Params for the "${name}" preset.`,
          },
        },
      },
    });
  }
  if (presetNames.length > 0) {
    branches.push({
      if: {
        properties: { do: { enum: presetNames } },
        required: ['do'],
      },
      then: {
        properties: {
          repeat: false,
          pingpong: false,
          from: false,
        },
      },
    });
  }
  branches.push({
    if: { properties: { do: { const: 'dolly' } }, required: ['do'] },
    then: { properties: { to: { const: 'camera', description: "Camera verbs only target 'camera'." }, from: false } },
  });
  branches.push({
    if: { properties: { do: { const: 'zoom' } }, required: ['do'] },
    then: { properties: { to: { const: 'camera', description: "Camera verbs only target 'camera'." }, from: false } },
  });
  branches.push({
    if: { properties: { do: { const: 'orbit' }, to: { const: 'camera' } }, required: ['do'] },
    then: { properties: { from: false } },
  });

  return {
    type: 'array',
    description: 'Flat array of animation cues, sequenced via id/after/alongside/offset.',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['do', 'to'],
      properties: cueProps,
      allOf: branches,
    },
  };
}

function svgShapeSchema() {
  const shapeRef = { $ref: '#/$defs/svgShape' };
  const geometryBranches = Object.entries(SVG_SHAPE_TYPES).map(([type, def]) => {
    const props = {};
    for (const key of Object.keys(def.params)) {
      props[key] = key === 'd' && type === 'path' ? { type: 'string', description: 'SVG path data.' } : { type: 'number' };
    }
    if (type === 'group') props.children = { type: 'array', items: shapeRef };
    return {
      if: { properties: { type: { const: type } }, required: ['type'] },
      then: { properties: props },
    };
  });
  return {
    type: 'object',
    additionalProperties: false,
    description:
      'SVG shape. Geometry keys are gated per type; group children may nest (limited to 8 levels).',
    required: ['id', 'type'],
    properties: {
      id: { type: 'string', minLength: 1, description: 'Unique DOM id for the shape element.' },
      class: { type: 'string' },
      type: { ...enumOf(Object.keys(SVG_SHAPE_TYPES)), description: 'Shape type.' },
      stroke: COLOR,
      fill: {
        anyOf: [COLOR, { const: 'none' }],
        description: "'#rrggbb' or 'none'.",
      },
      strokeWidth: { type: 'number' },
      opacity: P01,
      children: { type: 'array', items: shapeRef, description: 'Only for type group.' },
    },
    allOf: geometryBranches,
  };
}

function svgSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    description: '2D SVG overlay layer. "overlay" is accepted as an alias at the spec root.',
    properties: {
      fit: { ...enumOf(SVG_FITS), description: "How the layer matches the canvas; default 'cover'." },
      text: {
        type: 'array',
        description: 'SVG text items.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'content'],
          properties: {
            id: { type: 'string', minLength: 1, description: 'Unique DOM id for the text group.' },
            class: { type: 'string' },
            content: { type: 'string', description: 'Text content.' },
            split: { ...enumOf(SVG_SPLITS), description: "Split into chars/words; default 'none'." },
            tag: { ...enumOf(SVG_TAGS), description: "Element per text unit; default 'text'." },
            x: { type: 'number', description: 'Default 0.' },
            y: { type: 'number', description: 'Default 0.' },
            size: { type: 'number', description: 'Font-size; default 24.' },
            weight: { type: 'number', description: 'Font-weight; default 400.' },
            family: { type: 'string', description: 'Font-family; default sans-serif.' },
            color: COLOR,
            align: { ...enumOf(SVG_ALIGNS), description: "Text-anchor; default 'start'." },
            opacity: P01,
          },
        },
      },
      shapes: { type: 'array', items: { $ref: '#/$defs/svgShape' } },
    },
  };
}

export function buildJsonSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://agent-stage.dev/spec.schema.json',
    title: 'agent-stage spec',
    description: 'Declarative 3D/2D animation spec for agent-stage (three.js + GSAP).',
    type: 'object',
    additionalProperties: false,
    properties: {
      meta: {
        type: 'object',
        additionalProperties: false,
        description: 'Stage metadata.',
        properties: {
          title: { type: 'string' },
          background: {
            anyOf: [
              { ...enumOf(Object.keys(BACKGROUND_PRESETS)), description: 'Named background preset.' },
              COLOR,
            ],
            description: "Background preset name or '#rrggbb'; default 'void'.",
          },
          fog: {
            type: 'object',
            additionalProperties: false,
            description: 'Fog requires color, near and far together.',
            required: ['color', 'near', 'far'],
            properties: {
              color: COLOR,
              near: { type: 'number' },
              far: { type: 'number' },
            },
          },
          size: {
            type: 'object',
            additionalProperties: false,
            description: 'Canvas size in pixels; default 1280x720.',
            properties: {
              width: { type: 'integer', exclusiveMinimum: 0 },
              height: { type: 'integer', exclusiveMinimum: 0 },
            },
          },
          duration: {
            type: 'number',
            exclusiveMinimum: 0,
            description: 'Scale the whole score to fit exactly this duration (seconds).',
          },
        },
      },
      camera: {
        type: 'object',
        additionalProperties: false,
        description: 'Camera setup.',
        properties: {
          fov: { type: 'number', minimum: 1, maximum: 179, description: 'Field of view; default 50.' },
          position: VEC3,
          lookAt: VEC3,
        },
      },
      display: {
        type: 'object',
        additionalProperties: false,
        description: 'How the canvas is mounted and fitted.',
        properties: {
          fit: enumOf(SVG_FITS),
          position: enumOf(['fixed', 'absolute']),
          mount: enumOf(['body', 'none']),
        },
      },
      lights: { type: 'array', items: { $ref: '#/$defs/light' } },
      objects: { type: 'array', items: { $ref: '#/$defs/objectDef' } },
      score: { $ref: '#/$defs/score' },
      svg: { $ref: '#/$defs/svg' },
      overlay: {
        ...svgSchema(),
        description: 'Deprecated alias for svg; cannot be combined with svg.',
      },
    },
    allOf: [
      {
        if: { required: ['overlay'] },
        then: { not: { required: ['svg'] } },
        description: '"overlay" and "svg" are mutually exclusive aliases.',
      },
      {
        if: { required: ['svg'] },
        then: { not: { required: ['overlay'] } },
      },
    ],
    $defs: {
      color: COLOR,
      vec3: VEC3,
      material: materialSchema(),
      light: lightSchema(),
      objectDef: objectSchema(),
      score: scoreSchema(),
      svg: svgSchema(),
      svgShape: svgShapeSchema(),
    },
  };
}
