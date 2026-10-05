import { validateSpec } from '../spec/validate.js';
import { createStage } from '../stage/createStage.js';

const SNAP_KEYS = ['x', 'y', 'z', 'rotateX', 'rotateY', 'rotateZ', 'scale', 'scaleX', 'scaleY', 'scaleZ', 'opacity'];

function r4(v) {
  return Math.round(v * 10000) / 10000;
}

function collectToTargets(score) {
  const names = new Set();
  if (!Array.isArray(score)) return names;
  for (const cue of score) {
    const targets = Array.isArray(cue?.to) ? cue.to : [cue?.to];
    for (const t of targets) {
      if (typeof t === 'string' && t !== '') names.add(t);
    }
  }
  return names;
}

// Estimated bounding boxes for overlay collision detection. path/group are
// skipped (no cheap bbox). Returns { id, min: [x,y], max: [x,y] } or null.
function overlayBBox(item) {
  const type = item.type ?? 'text';
  if (type === 'path' || type === 'group') return null;
  if (type === 'text') {
    const content = item.content ?? '';
    const size = item.size ?? 24;
    const align = item.align ?? 'start';
    const x = item.x ?? 0;
    const y = item.y ?? 0;
    const w = size * 0.6 * content.length;
    const h = size * 1.2;
    let minX = x;
    if (align === 'middle') minX = x - w / 2;
    else if (align === 'end') minX = x - w;
    return { id: item.id, min: [minX, y - h], max: [minX + w, y] };
  }
  if (type === 'rect') {
    const x = item.x ?? 0;
    const y = item.y ?? 0;
    const w = item.width ?? 10;
    const h = item.height ?? 10;
    return { id: item.id, min: [x, y], max: [x + w, y + h] };
  }
  if (type === 'circle') {
    const cx = item.cx ?? 0;
    const cy = item.cy ?? 0;
    const r = item.r ?? 1;
    return { id: item.id, min: [cx - r, cy - r], max: [cx + r, cy + r] };
  }
  if (type === 'line') {
    const minX = Math.min(item.x1 ?? 0, item.x2 ?? 1);
    const maxX = Math.max(item.x1 ?? 0, item.x2 ?? 1);
    const minY = Math.min(item.y1 ?? 0, item.y2 ?? 1);
    const maxY = Math.max(item.y1 ?? 0, item.y2 ?? 1);
    return { id: item.id, min: [minX, minY], max: [maxX, maxY] };
  }
  return null;
}

function collectOverlayItems(spec) {
  const svgSpec = spec.svg ?? spec.overlay;
  if (!svgSpec) return [];
  const items = [];
  for (const text of svgSpec.text ?? []) items.push({ ...text, type: 'text' });
  const walk = (shapes) => {
    for (const shape of shapes ?? []) {
      items.push(shape);
      if (shape.type === 'group') walk(shape.children);
    }
  };
  walk(svgSpec.shapes);
  return items;
}

function overlayCollisions(spec) {
  const boxes = collectOverlayItems(spec)
    .map(overlayBBox)
    .filter(Boolean);
  const issues = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const w = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
      const h = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
      if (w > 0 && h > 0) {
        issues.push({
          kind: 'overlay-collision',
          message: `SVG items "${a.id}" and "${b.id}" have overlapping estimated bounding boxes.`,
          subjects: [a.id, b.id],
        });
      }
    }
  }
  return issues;
}

export function reportSpec(spec, { samples = 12 } = {}) {
  const { ok, errors } = validateSpec(spec);
  if (!ok) {
    return { ok: false, errors, warnings: [], duration: 0, sampleCount: 0, frames: [], objects: [], issues: [] };
  }

  const stage = createStage(spec, { webgl: false });
  try {
    const scoreCompile = stage.scoreCompile;
    const duration = stage.timeline.duration();
    const sampleTimes = duration > 0
      ? Array.from({ length: samples + 1 }, (_, i) => (duration * i) / samples)
      : [0];

    const animated = collectToTargets(spec.score);
    const frames = [];
    const perObject = new Map();
    for (const name of stage.objects.keys()) {
      perObject.set(name, { name, onScreenAt: [], offScreenAt: [], samples: [] });
    }

    for (const t of sampleTimes) {
      stage.seek(t);
      const cameraPos = stage.camera.position;
      const objectsFrame = {};
      for (const name of stage.objects.keys()) {
        const snap = stage.bridge.snapshot(name);
        const proj = stage.bridge.project(name);
        objectsFrame[name] = {
          ...Object.fromEntries(SNAP_KEYS.map((k) => [k, r4(snap[k])])),
          screenX: r4(proj.x),
          screenY: r4(proj.y),
          depth: r4(proj.depth),
          onScreen: proj.onScreen,
        };
        const rec = perObject.get(name);
        (proj.onScreen ? rec.onScreenAt : rec.offScreenAt).push(r4(t));
        rec.samples.push({ t: r4(t), opacity: snap.opacity, onScreen: proj.onScreen });
      }
      frames.push({
        t: r4(t),
        camera: { x: r4(cameraPos.x), y: r4(cameraPos.y), z: r4(cameraPos.z) },
        objects: objectsFrame,
      });
    }

    const issues = [];
    if (!Array.isArray(spec.score) || spec.score.length === 0) {
      issues.push({ kind: 'no-score', message: 'The spec has no score (or an empty score array); nothing animates.' });
    }
    for (const rec of perObject.values()) {
      if (!animated.has(rec.name)) {
        issues.push({
          kind: 'never-animated',
          message: `Object "${rec.name}" is never a cue target; it stays static.`,
          subjects: [rec.name],
        });
      }
      if (rec.samples.length > 0 && rec.samples.every((s) => s.opacity <= 0.02)) {
        issues.push({
          kind: 'invisible',
          message: `Object "${rec.name}" has opacity <= 0.02 at every sample; it is never visible.`,
          subjects: [rec.name],
        });
      }
      if (rec.samples.some((s) => !s.onScreen && s.opacity > 0.3)) {
        issues.push({
          kind: 'leaves-frame',
          message: `Object "${rec.name}" is off-screen at a sample where it is still clearly visible (opacity > 0.3).`,
          subjects: [rec.name],
        });
      }
    }
    issues.push(...overlayCollisions(spec));
    for (const w of scoreCompile.warnings) {
      issues.push({ kind: 'compile-warning', message: w.message, subjects: w.path ? [w.path] : undefined });
    }

    const objects = [...perObject.values()].map((rec) => ({
      name: rec.name,
      animated: animated.has(rec.name),
      onScreenAt: rec.onScreenAt,
      offScreenAt: rec.offScreenAt,
      opacityRange: rec.samples.length
        ? [r4(Math.min(...rec.samples.map((s) => s.opacity))), r4(Math.max(...rec.samples.map((s) => s.opacity)))]
        : [1, 1],
    }));

    return {
      ok: scoreCompile.ok,
      duration: r4(duration),
      sampleCount: sampleTimes.length,
      frames,
      objects,
      issues,
      warnings: scoreCompile.warnings,
      errors: scoreCompile.errors,
    };
  } finally {
    stage.dispose();
  }
}
