/**
 * agent-stage — public entry point.
 * @module agent-stage
 */

export {
  BACKGROUND_PRESETS,
  LIGHT_TYPES,
  MATERIAL_PRESETS,
  OBJECT_TYPES,
  SVG_SHAPE_TYPES,
  SVG_TEXT_PARAMS,
  SVG_SPLITS,
  SVG_TAGS,
  SVG_ALIGNS,
  SVG_FITS,
  DEFAULTS,
  schema,
  describeTokens,
} from './spec/schema.js';

export {
  SCORE_VERBS,
  SCORE_EASES,
  SCORE_DEFAULTS,
  SCORE_REPEAT_CAP,
  SCORE_RESERVED_TARGETS,
  BRIDGE_PROPS,
} from './spec/schema.js';

export { validateSpec, normalizeSpec } from './spec/validate.js';
export { compileScore } from './score/compile.js';
export { createBridge } from './bridge/createBridge.js';
export { createStage } from './stage/createStage.js';
export { createOverlay, splitChars, splitWords } from './svg/createOverlay.js';
