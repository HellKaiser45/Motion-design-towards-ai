import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reportSpec } from '../src/report/report.js';
import { reportSpec as reportSpecFromIndex } from '../src/index.js';

function kinds(report) {
  return new Set(report.issues.map((i) => i.kind));
}

function subjectsOf(report, kind) {
  return report.issues.filter((i) => i.kind === kind).flatMap((i) => i.subjects ?? []);
}

// One spec exercising every heuristic: animated box, never-animated sphere,
// invisible cube (faded to 0 the whole timeline), a visible cone that leaves
// the frame, and two overlapping SVG texts.
function problemSpec() {
  return {
    meta: { size: { width: 1280, height: 720 } },
    objects: [
      { name: 'hero', type: 'box' },
      { name: 'still', type: 'sphere' },
      { name: 'ghost', type: 'box', position: [0, 5, 0], material: { preset: 'standard', color: '#94a3b8', opacity: 0 } },
      { name: 'escapee', type: 'cone' },
    ],
    score: [
      { do: 'animate', to: 'hero', at: 0, dur: 2, with: { x: 2 } },
      { do: 'spin', to: 'ghost', at: 0, dur: 2, with: { axis: 'y', speed: 1 } },
      { do: 'move-to', to: 'escapee', at: 0, dur: 2, with: { x: 40 } },
    ],
    svg: {
      text: [
        { id: 't1', content: 'overlapping label here', x: 100, y: 100 },
        { id: 't2', content: 'another overlapping label', x: 130, y: 110 },
      ],
    },
  };
}

test('reportSpec is re-exported from the package index', () => {
  assert.equal(reportSpecFromIndex, reportSpec);
});

test('full heuristic report: frames, issues and per-object summaries agree', () => {
  const report = reportSpec(problemSpec(), { samples: 12 });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.ok(report.duration > 0);
  assert.equal(report.sampleCount, 13);
  assert.equal(report.frames.length, 13);

  const issueKinds = kinds(report);
  assert.ok(issueKinds.has('never-animated'));
  assert.ok(issueKinds.has('invisible'));
  assert.ok(issueKinds.has('leaves-frame'));
  assert.ok(issueKinds.has('overlay-collision'));
  assert.deepEqual(subjectsOf(report, 'never-animated'), ['still']);
  assert.deepEqual(subjectsOf(report, 'invisible'), ['ghost']);
  assert.deepEqual(subjectsOf(report, 'leaves-frame'), ['escapee']);
  const collision = report.issues.find((i) => i.kind === 'overlay-collision');
  assert.deepEqual([...collision.subjects].sort(), ['t1', 't2']);
  assert.ok(/t1/.test(collision.message) && /t2/.test(collision.message));

  // frames: every object snapshot has all projection fields, camera per frame
  for (const frame of report.frames) {
    assert.ok(Number.isFinite(frame.camera.x) && Number.isFinite(frame.camera.z));
    for (const name of ['hero', 'still', 'ghost', 'escapee']) {
      const o = frame.objects[name];
      for (const key of ['x', 'y', 'z', 'rotateX', 'rotateY', 'rotateZ', 'scale', 'scaleX', 'scaleY', 'scaleZ', 'opacity', 'screenX', 'screenY', 'depth', 'onScreen']) {
        assert.ok(key in o, `${name}.${key} missing`);
      }
    }
  }

  // summaries consistent with frames
  const hero = report.objects.find((o) => o.name === 'hero');
  assert.equal(hero.animated, true);
  const still = report.objects.find((o) => o.name === 'still');
  assert.equal(still.animated, false);
  const ghost = report.objects.find((o) => o.name === 'ghost');
  assert.deepEqual(ghost.opacityRange, [0, 0]);
  const escapee = report.objects.find((o) => o.name === 'escapee');
  assert.equal(escapee.onScreenAt.length + escapee.offScreenAt.length, 13);
  // offScreenAt times match frames where the object projects off-screen
  for (const t of escapee.offScreenAt) {
    const frame = report.frames.find((f) => f.t === t);
    assert.equal(frame.objects.escapee.onScreen, false, `t=${t}`);
  }
  // floats rounded to 4 decimals
  for (const frame of report.frames) {
    assert.equal(frame.t, Math.round(frame.t * 10000) / 10000);
    for (const o of Object.values(frame.objects)) {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number') assert.equal(v, Math.round(v * 10000) / 10000, `${k}`);
      }
    }
  }
});

test('reportSpec is deterministic across runs', () => {
  const a = reportSpec(problemSpec(), { samples: 8 });
  const b = reportSpec(problemSpec(), { samples: 8 });
  assert.deepEqual(a, b);
});

test('invalid spec returns ok:false with errors and no crash', () => {
  const report = reportSpec({ objects: [{ name: 'x', type: 'nope' }] });
  assert.equal(report.ok, false);
  assert.ok(Array.isArray(report.errors) && report.errors.length > 0);
  assert.equal(report.duration, 0);
  assert.deepEqual(report.frames, []);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.warnings, []);
});

test('empty score produces a no-score issue', () => {
  const report = reportSpec({ objects: [{ name: 'b', type: 'box' }], score: [] });
  assert.ok(kinds(report).has('no-score'));
});

test('clean minimal spec: ok true with no unexpected issues', () => {
  const report = reportSpec({
    objects: [{ name: 'b', type: 'box', position: [0, 0, 4] }],
    score: [{ do: 'animate', to: 'b', at: 0, dur: 1, with: { y: 1 } }],
  });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.issues, []);
  const b = report.objects.find((o) => o.name === 'b');
  assert.equal(b.animated, true);
  assert.equal(report.frames.length, 13);
  assert.deepEqual(b.offScreenAt, []);
});
