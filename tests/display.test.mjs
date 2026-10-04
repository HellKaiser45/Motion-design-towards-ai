import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStage, validateSpec, normalizeSpec } from '../src/index.js';

// Hand-rolled DOM stubs (no jsdom). The fake canvas's getContext returns a
// truthy dummy so hasWebGL() passes; THREE.WebGLRenderer then fails on the
// dummy context, which the framework catches -> renderer is null but the
// canvas display/mount lifecycle still runs and is what we assert on.
const realDocument = globalThis.document;
const realWindow = globalThis.window;

function makeFakeCanvas() {
  return {
    style: {},
    getContext: () => ({}),
    remove() {
      this.removed = true;
    },
  };
}

function installDom({ innerWidth = 800, innerHeight = 600 } = {}) {
  const children = [];
  const listeners = new Map();
  const document = {
    createElement: () => makeFakeCanvas(),
    body: {
      appendChild: (el) => {
        children.push(el);
        return el;
      },
      get children() {
        return children;
      },
      contains: (el) => children.includes(el) && !el.removed,
    },
  };
  const window = {
    innerWidth,
    innerHeight,
    devicePixelRatio: 1,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      const list = listeners.get(type) ?? [];
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    getListenerCount(type) {
      return (listeners.get(type) ?? []).length;
    },
  };
  globalThis.document = document;
  globalThis.window = window;
  return {
    document,
    window,
    get appended() {
      return children;
    },
    dispose() {
      globalThis.document = realDocument;
      globalThis.window = realWindow;
    },
  };
}

test('no display key: canvas auto-appended to body with fixed cover CSS', () => {
  const dom = installDom();
  try {
    const stage = createStage({ objects: [{ name: 'b', type: 'box' }] });
    assert.equal(stage.ok, true);
    assert.ok(stage.canvas, 'canvas exposed');
    assert.equal(dom.appended.length, 1);
    assert.equal(dom.appended[0], stage.canvas);
    const s = stage.canvas.style;
    assert.equal(s.position, 'fixed');
    assert.equal(s.width, '100vw');
    assert.equal(s.height, '100vh');
    stage.dispose();
  } finally {
    dom.dispose();
  }
});

test('display: { mount: "none" } creates a detached canvas exposed as stage.canvas', () => {
  const dom = installDom();
  try {
    const stage = createStage({
      display: { mount: 'none' },
      objects: [{ name: 'b', type: 'box' }],
    });
    assert.equal(stage.ok, true);
    assert.ok(stage.canvas);
    assert.equal(dom.appended.length, 0);
    stage.dispose();
  } finally {
    dom.dispose();
  }
});

test('display: { fit: "contain" } applies letterbox styling', () => {
  const dom = installDom();
  try {
    const stage = createStage({
      display: { fit: 'contain' },
      objects: [{ name: 'b', type: 'box' }],
    });
    assert.equal(stage.ok, true);
    assert.equal(dom.appended.length, 1);
    const s = stage.canvas.style;
    assert.equal(s.aspectRatio, '1280 / 720');
    assert.equal(s.margin, 'auto');
    assert.equal(s.maxWidth, '100%');
    assert.equal(s.maxHeight, '100%');
    assert.equal(s.display, 'block');
    stage.dispose();
  } finally {
    dom.dispose();
  }
});

test('display: { position: "absolute" } is honored', () => {
  const dom = installDom();
  try {
    const stage = createStage({
      display: { position: 'absolute' },
      objects: [{ name: 'b', type: 'box' }],
    });
    assert.equal(stage.canvas.style.position, 'absolute');
    stage.dispose();
  } finally {
    dom.dispose();
  }
});

test('invalid display values produce structured errors with suggestions', () => {
  const { ok, errors } = validateSpec({ display: { fit: 'covr' }, objects: [{ name: 'b', type: 'box' }] });
  assert.equal(ok, false);
  const fit = errors.find((e) => e.path === '/display/fit');
  assert.ok(fit, 'error at /display/fit');
  assert.equal(fit.suggestion, 'cover');

  const collected = [];
  const stage = createStage(
    { display: { mount: 'bodt' }, objects: [{ name: 'b', type: 'box' }] },
    { onValidateError: (errors) => collected.push(...errors) }
  );
  assert.equal(stage.ok, false);
  const mount = collected.find((e) => e.path === '/display/mount');
  assert.ok(mount, 'error at /display/mount');
  assert.equal(mount.suggestion, 'body');
});

test('normalizeSpec fills display defaults and passes partial values through', () => {
  const norm = normalizeSpec({ display: { fit: 'contain' }, objects: [] });
  assert.deepEqual(norm.display, { fit: 'contain', position: 'fixed', mount: 'body' });
  const norm2 = normalizeSpec({ objects: [] });
  assert.deepEqual(norm2.display, { fit: 'cover', position: 'fixed', mount: 'body' });
});

test('unknown display sub-keys are rejected', () => {
  const { ok, errors } = validateSpec({ display: { fits: 'cover' } });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.path === '/display/fits' && e.suggestion === 'fit'));
});

test('dispose removes the auto-attached canvas and is idempotent', () => {
  const dom = installDom();
  try {
    const stage = createStage({ objects: [{ name: 'b', type: 'box' }] });
    assert.equal(dom.appended.length, 1);
    stage.dispose();
    assert.ok(stage.canvas.removed, 'canvas.remove() was called');
    assert.ok(!dom.document.body.contains(stage.canvas), 'body no longer contains the canvas');
    assert.doesNotThrow(() => stage.dispose());
  } finally {
    dom.dispose();
  }
});

test('dispose removes the resize listener', () => {
  const dom = installDom();
  try {
    const stage = createStage({ objects: [{ name: 'b', type: 'box' }] });
    assert.equal(dom.window.getListenerCount('resize'), 1);
    stage.dispose();
    assert.equal(dom.window.getListenerCount('resize'), 0);
  } finally {
    dom.dispose();
  }
});

test('caller-provided options.canvas is never styled, mounted, or resize-managed', () => {
  const dom = installDom();
  try {
    const owned = makeFakeCanvas();
    const stage = createStage({ objects: [{ name: 'b', type: 'box' }] }, { canvas: owned });
    assert.equal(stage.canvas, owned);
    assert.equal(Object.keys(owned.style).length, 0, 'no styling applied');
    assert.equal(dom.appended.length, 0);
    assert.equal(dom.window.getListenerCount('resize'), 0);
    stage.dispose();
    assert.ok(!owned.removed, 'caller canvas not removed by dispose');
  } finally {
    dom.dispose();
  }
});

test('stage.canvas is null in the pure-headless path without throwing', () => {
  // No DOM stubs installed: document/window are the real (undefined) Node globals.
  assert.equal(typeof document, 'undefined');
  const stage = createStage({ objects: [{ name: 'b', type: 'box' }] });
  assert.equal(stage.ok, true);
  assert.equal(stage.canvas ?? null, null);
  stage.dispose();
});
