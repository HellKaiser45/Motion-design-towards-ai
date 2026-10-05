import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  frameTimes,
  filmstripTimes,
  pngFileName,
  ffmpegPipeArgs,
  ffmpegDirArgs,
} from '../src/export/renderSchedule.js';
import { createStage } from '../src/stage/createStage.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- frameTimes ------------------------------------------------------------
test('frameTimes basic', () => {
  assert.deepEqual(frameTimes({ duration: 1, fps: 2 }), [0, 0.5, 1]);
});

test('frameTimes zero duration', () => {
  assert.deepEqual(frameTimes({ duration: 0 }), [0]);
});

test('frameTimes to <= from', () => {
  assert.deepEqual(frameTimes({ duration: 2, from: 1, to: 1 }), [1]);
});

test('frameTimes deterministic', () => {
  assert.deepEqual(frameTimes({ duration: 3, fps: 30 }), frameTimes({ duration: 3, fps: 30 }));
});

// --- filmstripTimes ---------------------------------------------------------
test('filmstripTimes even spread', () => {
  assert.deepEqual(filmstripTimes({ duration: 3, count: 4 }), [0, 1, 2, 3]);
});

test('filmstripTimes count 1', () => {
  assert.deepEqual(filmstripTimes({ duration: 3, count: 1 }), [0]);
});

test('filmstripTimes invalid duration', () => {
  assert.deepEqual(filmstripTimes({ duration: -1, count: 4 }), [0]);
});

// --- naming -----------------------------------------------------------------
test('pngFileName', () => {
  assert.equal(pngFileName(0), '000000.png');
  assert.equal(pngFileName(42), '000042.png');
});

// --- ffmpeg args -------------------------------------------------------------
test('ffmpegPipeArgs', () => {
  assert.deepEqual(ffmpegPipeArgs({ fps: 24, output: 'a.mp4' }), [
    '-f', 'image2pipe', '-framerate', '24', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-y', 'a.mp4',
  ]);
});

test('ffmpegDirArgs', () => {
  assert.deepEqual(ffmpegDirArgs({ fps: 24, dir: 'd', output: 'a.mp4' }), [
    '-framerate', '24', '-i', 'd/%06d.png',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-y', 'a.mp4',
  ]);
});

// --- headless stage -----------------------------------------------------------
test('headless captureFrame is null and whenReady resolves', async () => {
  const spec = {
    meta: { title: 't', background: '#000000' },
    camera: { position: [3, 2, 5], lookAt: [0, 0, 0] },
    objects: [{ name: 'hero', type: 'box', material: { preset: 'neon', color: '#22d3ee' } }],
    score: [{ do: 'spin', to: 'hero', at: 0, with: { axis: 'y', speed: 1.2 } }],
  };
  const stage = createStage(spec, { webgl: false });
  try {
    assert.equal(stage.captureFrame(0), null);
    await stage.whenReady();
  } finally {
    stage.dispose();
  }
});

// --- CLI ------------------------------------------------------------------------
const SPEC_FIXTURE = {
  meta: { title: 'export test', background: '#0a0a0f' },
  camera: { position: [3, 2, 5], lookAt: [0, 0, 0] },
  lights: [{ name: 'key', type: 'directional' }],
  objects: [{ name: 'hero', type: 'box', material: { preset: 'neon', color: '#22d3ee' } }],
  score: [{ do: 'spin', to: 'hero', at: 0, with: { axis: 'y', speed: 1.2 } }],
};

function writeSpec(dir, spec) {
  const file = path.join(dir, 'spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  return file;
}

test('CLI --help exits 0 with usage', () => {
  const r = spawnSync(process.execPath, ['scripts/export-video.mjs', '--help'], {
    cwd: REPO_ROOT,
    timeout: 30000,
  });
  assert.equal(r.status, 0);
  assert.match(String(r.stdout), /Usage:/);
});

test('CLI without puppeteer: filmstrip exits 2, prints verdict', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stage-export-'));
  try {
    const specFile = writeSpec(dir, SPEC_FIXTURE);
    const r = spawnSync(process.execPath, ['scripts/export-video.mjs', specFile, '--filmstrip', '4'], {
      cwd: REPO_ROOT,
      timeout: 30000,
    });
    assert.equal(r.status, 2);
    assert.match(String(r.stderr), /puppeteer/);
    assert.match(String(r.stdout), /duration:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI invalid spec exits 1 with suggestion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stage-export-'));
  try {
    const bad = JSON.parse(JSON.stringify(SPEC_FIXTURE));
    bad.score[0].do = 'spinnn';
    const specFile = writeSpec(dir, bad);
    const r = spawnSync(process.execPath, ['scripts/export-video.mjs', specFile], {
      cwd: REPO_ROOT,
      timeout: 30000,
    });
    assert.equal(r.status, 1);
    assert.match(String(r.stderr), /suggestion/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
