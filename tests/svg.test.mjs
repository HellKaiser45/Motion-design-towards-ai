import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createStage, validateSpec, normalizeSpec, describeTokens, splitChars, splitWords, createOverlay } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const helloSpec = JSON.parse(readFileSync(path.join(here, '..', 'examples', 'hello-stage.json'), 'utf8'));

const svgSpec = {
  ...helloSpec,
  svg: {
    fit: 'contain',
    text: [
      { id: 'title', content: 'ab cd', split: 'char', x: 100, y: 200, size: 48, color: '#ff0000' },
      { id: 'subtitle', content: 'one two three', split: 'word' },
      { id: 'plain', content: 'hello' },
    ],
    shapes: [
      { id: 'frame', type: 'rect', width: 300, height: 200, fill: '#000000' },
      { id: 'dot', type: 'circle', cx: 50, cy: 50, r: 10 },
    ],
  },
};

test('describeTokens exposes the svg vocabulary', () => {
  const tokens = describeTokens();
  assert.ok(tokens.rules.svg, 'svg rules present');
  assert.ok(tokens.rules.svg.text.split.includes("'char'"));
  assert.deepEqual(Object.keys(tokens.svgShapeTypes), ['rect', 'circle', 'line', 'path', 'group']);
  assert.ok(tokens.svgTextParams.includes('split'));
});

test('valid svg spec passes validation and normalizes with defaults', () => {
  const { ok, errors } = validateSpec(svgSpec);
  assert.equal(ok, true, JSON.stringify(errors));
  const norm = normalizeSpec(svgSpec);
  assert.equal(norm.svg.fit, 'contain');
  const title = norm.svg.text.find((t) => t.id === 'title');
  assert.equal(title.split, 'char');
  assert.equal(title.weight, 400);
  assert.equal(title.align, 'start');
  const rect = norm.svg.shapes.find((s) => s.id === 'frame');
  assert.equal(rect.geometry.x, 0);
  assert.equal(rect.geometry.rx, 0);
});

test('unknown svg shape type produces a structured error with suggestion', () => {
  const { ok, errors } = validateSpec({
    svg: { shapes: [{ id: 's', type: 'cricle' }] },
  });
  assert.equal(ok, false);
  const e = errors.find((x) => x.path === '/svg/shapes/0/type');
  assert.ok(e, 'error present');
  assert.equal(e.suggestion, 'circle');
});

test('duplicate ids across svg text and shapes are rejected', () => {
  const { ok, errors } = validateSpec({
    svg: {
      text: [{ id: 'a', content: 'x' }],
      shapes: [{ id: 'a', type: 'rect' }],
    },
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /Duplicate id "a"/.test(e.message)));
});

test('unknown svg text param and bad split are rejected with suggestions', () => {
  const bad = validateSpec({ svg: { text: [{ id: 't', content: 'x', spli: 'char' }] } });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.suggestion === 'split'));

  const badSplit = validateSpec({ svg: { text: [{ id: 't', content: 'x', split: 'chars' }] } });
  assert.equal(badSplit.ok, false);
  assert.ok(badSplit.errors.some((e) => e.suggestion === 'char'));
});

test('the overlay key is accepted as an alias and canonicalized to svg', () => {
  const { ok, errors } = validateSpec({ overlay: { text: [{ id: 't', content: 'hi' }] } });
  assert.equal(ok, true, JSON.stringify(errors));
  const norm = normalizeSpec({ overlay: { fit: 'cover', text: [{ id: 't', content: 'hi' }] } });
  assert.ok(norm.svg);
  assert.equal(norm.svg.fit, 'cover');
  const both = validateSpec({ svg: {}, overlay: {} });
  assert.equal(both.ok, false);
});

test('createStage exposes a detached headless overlay with structure', () => {
  const stage = createStage(svgSpec);
  assert.ok(stage.svg, 'overlay created');
  assert.equal(stage.svg.detached, true);
  const title = stage.svg.byId('title');
  assert.ok(title, 'title group registered');
  assert.equal(title.tagName, 'g');
  assert.ok(title.classList.contains('svg-text'));
  assert.ok(stage.svg.byId('frame'), 'shape registered');
  stage.dispose();
});

test('char split produces one element per character with data-char', () => {
  const stage = createStage(svgSpec);
  const chars = stage.svg.charsOf('title');
  assert.deepEqual(chars.map((c) => c.getAttribute('data-char')), ['a', 'b', ' ', 'c', 'd']);
  for (let i = 0; i < chars.length; i++) {
    assert.equal(chars[i].getAttribute('data-index'), String(i));
    assert.ok(chars[i].classList.contains('title-char'));
    assert.ok(chars[i].classList.contains('char'));
  }
  stage.dispose();
});

test('word split produces one group per word with data-index', () => {
  const stage = createStage(svgSpec);
  const words = stage.svg.wordsOf('subtitle');
  assert.equal(words.length, 3);
  assert.equal(words[0].getAttribute('data-word'), 'one');
  assert.ok(words[1].classList.contains('subtitle-word'));
  assert.ok(words[1].classList.contains('word'));
  assert.equal(words[2].children[0].textContent, 'three');
  stage.dispose();
});

test('split none renders a single text child and empty chars/words lists', () => {
  const stage = createStage(svgSpec);
  const plain = stage.svg.byId('plain');
  assert.equal(plain.children.length, 1);
  assert.equal(plain.children[0].textContent, 'hello');
  assert.equal(stage.svg.charsOf('plain').length, 0);
  assert.equal(stage.svg.wordsOf('plain').length, 0);
  stage.dispose();
});

test('byId returns null for unknown ids; standalone splitters match', () => {
  const stage = createStage(svgSpec);
  assert.equal(stage.svg.byId('nope'), null);
  assert.deepEqual(splitChars('a b'), ['a', ' ', 'b']);
  assert.deepEqual(splitWords('  a  b c '), ['a', 'b', 'c']);
  stage.dispose();
});

test('stage.svg is null when the spec has no svg section', () => {
  const stage = createStage({ objects: [{ name: 'b', type: 'box' }] });
  assert.equal(stage.svg, null);
  assert.equal(typeof stage.onResize, 'function');
  stage.dispose();
});

test('overlay is destroyed on stage.dispose()', () => {
  const stage = createStage(svgSpec);
  const overlay = stage.svg;
  stage.dispose();
  assert.equal(overlay.destroyed, true);
  assert.equal(overlay.byId('title'), null);
  assert.equal(overlay.charsOf('title').length, 0);
  assert.doesNotThrow(() => overlay.destroy());
});

test('createOverlay can be used standalone and resize updates the layer', () => {
  const overlay = createOverlay(null, { text: [{ id: 't', content: 'x' }] });
  assert.equal(overlay.detached, true);
  overlay.resize({ width: 800, height: 600 });
  assert.equal(overlay.el.getAttribute('width'), '800');
  assert.equal(overlay.el.getAttribute('viewBox'), '0 0 800 600');
  overlay.destroy();
});
