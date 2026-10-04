/**
 * agent-stage — public entry point.
 * @module agent-stage
 */

export {
  BACKGROUND_PRESETS,
  LIGHT_TYPES,
  MATERIAL_PRESETS,
  OBJECT_TYPES,
  DEFAULTS,
  schema,
  describeTokens,
} from './spec/schema.js';

export { validateSpec, normalizeSpec } from './spec/validate.js';
export { createStage } from './stage/createStage.js';
