import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildJsonSchema } from '../src/spec/jsonSchema.js';
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
} from '../src/spec/schema.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node && typeof node === 'object') {
    visit(node);
    for (const value of Object.values(node)) walk(value, visit);
  }
}

test('buildJsonSchema output is JSON round-trippable', () => {
  const schema = buildJsonSchema();
  const parsed = JSON.parse(JSON.stringify(schema));
  assert.deepEqual(parsed, schema);
});

test('enum parity with schema.js tables', () => {
  const schema = buildJsonSchema();
  const enums = [];
  walk(schema, (node) => {
    if (node.enum && node.type === 'string') enums.push([...node.enum]);
  });
  const findEnum = (values) =>
    enums.find((e) => e.length === values.length && e.every((v) => values.includes(v)));

  const verbsAndPresets = [...Object.keys(SCORE_VERBS), ...Object.keys(SCORE_PRESETS)].sort();
  const doEnum = enums.find((e) => [...e].sort().join() === verbsAndPresets.join());
  assert.ok(doEnum, 'score do enum found');
  assert.deepEqual([...doEnum].sort(), verbsAndPresets);

  const easeEnum = findEnum(Object.keys(SCORE_EASES));
  assert.ok(easeEnum, 'ease enum found');
  assert.deepEqual([...easeEnum].sort(), Object.keys(SCORE_EASES).sort());

  const bgEnum = findEnum(Object.keys(BACKGROUND_PRESETS));
  assert.ok(bgEnum);
  assert.deepEqual([...bgEnum].sort(), Object.keys(BACKGROUND_PRESETS).sort());

  const matEnum = findEnum(MATERIAL_PRESETS);
  assert.ok(matEnum);
  assert.deepEqual([...matEnum].sort(), [...MATERIAL_PRESETS].sort());

  const lightEnum = findEnum(LIGHT_TYPES);
  assert.ok(lightEnum);
  assert.deepEqual([...lightEnum].sort(), [...LIGHT_TYPES].sort());

  const objEnum = findEnum(Object.keys(OBJECT_TYPES));
  assert.ok(objEnum);
  assert.deepEqual([...objEnum].sort(), Object.keys(OBJECT_TYPES).sort());

  const shapeEnum = findEnum(Object.keys(SVG_SHAPE_TYPES));
  assert.ok(shapeEnum);
  assert.deepEqual([...shapeEnum].sort(), Object.keys(SVG_SHAPE_TYPES).sort());

  for (const [values, label] of [
    [SVG_SPLITS, 'splits'],
    [SVG_TAGS, 'tags'],
    [SVG_ALIGNS, 'aligns'],
    [SVG_FITS, 'fits'],
  ]) {
    const e = findEnum(values);
    assert.ok(e, `${label} enum found`);
    assert.deepEqual([...e].sort(), [...values].sort());
  }
});

test('docs/spec.schema.json matches a fresh buildJsonSchema()', () => {
  const onDisk = JSON.parse(readFileSync(path.join(root, 'docs', 'spec.schema.json'), 'utf8'));
  assert.deepEqual(onDisk, buildJsonSchema());
});

test('cue if/then coverage: every verb and preset appears as a do const', () => {
  const schema = buildJsonSchema();
  const cueDef = schema.$defs.score.items;
  const consts = new Set();
  walk(cueDef, (node) => {
    if (node.properties?.do?.const !== undefined) consts.add(node.properties.do.const);
  });
  const expected = new Set([...Object.keys(SCORE_VERBS), ...Object.keys(SCORE_PRESETS)]);
  assert.deepEqual([...consts].sort(), [...expected].sort());
});

test('object param coverage: every OBJECT_TYPES param key is gated', () => {
  const schema = buildJsonSchema();
  const objDef = schema.$defs.objectDef;
  const gated = new Set();
  walk(objDef, (node) => {
    if (node.properties?.params?.properties) {
      for (const key of Object.keys(node.properties.params.properties)) gated.add(key);
    }
  });
  const expected = new Set(
    Object.values(OBJECT_TYPES).flatMap((def) => Object.keys(def.params))
  );
  assert.deepEqual([...gated].sort(), [...expected].sort());
});

test('root additionalProperties false and overlay/svg mutual exclusion', () => {
  const schema = buildJsonSchema();
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.properties.svg, 'svg property present');
  assert.ok(schema.properties.overlay, 'overlay property present');
  const clauses = schema.allOf.filter(
    (branch) =>
      branch.if?.required &&
      branch.then?.not?.required &&
      (branch.if.required.includes('overlay') || branch.if.required.includes('svg'))
  );
  assert.equal(clauses.length, 2, 'mutual exclusion encoded via two if/then clauses');
  const ifKeys = clauses.flatMap((c) => c.if.required);
  assert.ok(ifKeys.includes('overlay') && ifKeys.includes('svg'));
});

test('$schema is draft 2020-12 and $id present', () => {
  const schema = buildJsonSchema();
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.ok(typeof schema.$id === 'string' && schema.$id.length > 0);
});
