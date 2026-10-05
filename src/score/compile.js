import * as THREE from 'three';
import { createBridge } from '../bridge/createBridge.js';
import {
  SCORE_VERBS,
  SCORE_EASES,
  SCORE_DEFAULTS,
  SCORE_REPEAT_CAP,
  SCORE_RESERVED_TARGETS,
  isDomSelector,
} from '../spec/schema.js';

function err(path, message, suggestion, patch) {
  const e = { path, message };
  if (suggestion !== undefined && suggestion !== null) e.suggestion = suggestion;
  if (Array.isArray(patch) && patch.length > 0) e.patch = patch;
  return e;
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function resolveTarget(stage, name, errors, path) {
  if (stage.objects.has(name)) return { target: stage.objects.get(name), kind: '3d' };
  if (stage.lights.has(name)) return { target: stage.lights.get(name), kind: '3d' };
  if (name === 'camera') return { target: stage.camera, kind: '3d' };
  if (name === 'scene') return { target: stage.scene, kind: '3d' };
  if (isDomSelector(name)) {
    if (typeof document === 'undefined') return { kind: 'dom-noop', name };
    // querySelectorAll (not querySelector): a selector like "#title .char"
    // must match every element so stagger fans out across them; the singular
    // form would animate only the first match.
    const elements = Array.from(document.querySelectorAll(name));
    return elements.length > 0
      ? { kind: 'dom', elements }
      : { kind: 'dom-noop', message: `DOM selector "${name}" matched no element; cue is a no-op.` };
  }
  errors.push(
    err(
      path,
      `Unknown score target "${name}". Known targets: ${[...stage.objects.keys(), ...stage.lights.keys(), ...SCORE_RESERVED_TARGETS].join(', ')} or a DOM selector.`,
    ),
  );
  return null;
}

function compileCue(stage, cue, errors, warnings) {
  const verb = cue.do;
  const path = `/score/${cue._i}`;  const withParams = isPlainObject(cue.with) ? cue.with : {};
  const dur = cue.dur ?? SCORE_DEFAULTS.dur;
  const at = cue.at ?? SCORE_DEFAULTS.at;
  const ease = SCORE_EASES[cue.ease ?? SCORE_DEFAULTS.ease];
  const tl = stage.timeline;

  function requireCamera() {
    if (live3d.length !== 1 || live3d[0] !== stage.camera) {
      errors.push(err(path, `verb "${verb}" requires to: 'camera'.`));
      return false;
    }
    return true;
  }

  let repeat = cue.repeat ?? 0;
  if (repeat === -1 || repeat > SCORE_REPEAT_CAP) {
    warnings.push({
      path,
      message: `repeat ${repeat} would make the timeline unbounded; clamped to ${SCORE_REPEAT_CAP} (seek(t) determinism requires a finite duration).`,
    });
    repeat = SCORE_REPEAT_CAP;
  }
  const yoyo = cue.pingpong === true;
  // GSAP's var name is "duration" ("dur" would be silently ignored).
  const base = { duration: dur, ease, repeat, yoyo, stagger: cue.stagger ?? 0 };

  const targets = (Array.isArray(cue.to) ? cue.to : [cue.to]).map((name) =>
    resolveTarget(stage, name, errors, `${path}/to`),
  );
  // Any unknown target invalidates the whole cue (multi-target cues must not
  // partially apply).
  if (targets.some((t) => t === null)) return;

  const first = targets[0];
  const is3d = first.kind === '3d';
  const isDom = first.kind === 'dom';

  for (const t of targets) {
    if (t.kind === 'dom-noop') {
      warnings.push({
        path: `${path}/to`,
        message: t.message ?? `DOM target "${t.name}" has no document (Node); cue is a no-op.`,
      });
    }
  }
  const live3d = targets.filter((t) => t.kind === '3d').map((t) => t.target);
  const liveDom = targets.filter((t) => t.kind === 'dom').flatMap((t) => t.elements);
  if (live3d.length === 0 && liveDom.length === 0) return;

  function domVars() {
    // DOM cue variables per verb; 3D-only verbs (spin, look-at) have no DOM
    // meaning and are reported as no-ops.
    switch (verb) {
      case 'fade':
        return { opacity: withParams.opacity ?? 1 };
      case 'color-to':
        return withParams.hex ? { fill: withParams.hex } : {};
      default:
        return null;
    }
  }

  if (isDom) {
    const vars = domVars();
    if (!vars) {
      warnings.push({ path, message: `Verb "${verb}" has no DOM equivalent; DOM targets are skipped for this cue.` });
    } else if (liveDom.length > 0) {
      tl.to(liveDom, { ...vars, ...base }, at);
    }
    return;
  }

  // 3D path
  const dummy = { t: 0 };
  switch (verb) {
    case 'move-to': {
      const vars = {};
      for (const k of ['x', 'y', 'z']) if (k in withParams) vars[k] = withParams[k];
      tl.to(live3d.map((o) => o.position), { ...vars, ...base }, at);
      break;
    }
    case 'rotate': {
      const vars = {};
      for (const k of ['x', 'y', 'z']) if (k in withParams) vars[k] = withParams[k];
      tl.to(live3d.map((o) => o.rotation), { ...vars, ...base }, at);
      break;
    }
    case 'scale-to': {
      const vars = {};
      for (const k of ['x', 'y', 'z']) if (k in withParams) vars[k] = withParams[k];
      tl.to(live3d.map((o) => o.scale), { ...vars, ...base }, at);
      break;
    }
    case 'spin': {
      const axis = withParams.axis ?? SCORE_DEFAULTS.spin.axis;
      const speed = withParams.speed ?? SCORE_DEFAULTS.spin.speed;
      const delta = speed * dur;
      tl.to(
        live3d.map((o) => o.rotation),
        { [axis]: `+=${delta}`, duration: dur, ease: 'none', repeat, yoyo, stagger: cue.stagger ?? 0 },
        at,
      );
      break;
    }
    case 'fade': {
      const value = withParams.opacity ?? 1;
      for (const o of live3d) {
        if (o.material) o.material.transparent = true;
      }
      tl.to(
        live3d.filter((o) => o.material).map((o) => o.material),
        { opacity: value, ...base },
        at,
      );
      break;
    }
    case 'color-to': {
      const color = new THREE.Color(withParams.hex ?? '#ffffff');
      const proxies = live3d
        .filter((o) => o.material && o.material.color)
        .map((o) => {
          const proxy = { r: o.material.color.r, g: o.material.color.g, b: o.material.color.b };
          return { proxy, color: o.material.color };
        });
      if (proxies.length > 0) {
        tl.to(
          proxies.map((p) => p.proxy),
          {
            r: color.r,
            g: color.g,
            b: color.b,
            ...base,
            onUpdate() {
              // Deterministic: r/g/b are pure functions of the tween's playhead.
              for (const p of proxies) p.color.setRGB(p.proxy.r, p.proxy.g, p.proxy.b);
            },
          },
          at,
        );
      }
      break;
    }
    case 'animate': {
      // Several DOM-style properties in one cue, tweened on bridge proxies.
      // Unknown keys are already rejected by validation; filter defensively so
      // a standalone compileScore call cannot tween an arbitrary property.
      const vars = {};
      for (const k of Object.keys(SCORE_VERBS.animate.params)) if (k in withParams) vars[k] = withParams[k];
      if (Object.keys(vars).length === 0) {
        errors.push(err(`${path}/with`, 'animate needs at least one valid property.'));
        return;
      }
      const bridge = stage.bridge ?? createBridge(stage);
      const proxies = live3d.map((o) => bridge.object(o));
      // `from` turns the tween into a fromTo so the target sits at the
      // from-state for all t <= at (GSAP fromTo immediateRender).
      if (isPlainObject(cue.from)) {
        const fromVars = {};
        for (const k of Object.keys(SCORE_VERBS.animate.params)) if (k in cue.from) fromVars[k] = cue.from[k];
        if (Object.keys(fromVars).length > 0) {
          tl.fromTo(proxies, fromVars, { ...vars, ...base }, at);
          break;
        }
      }
      tl.to(proxies, { ...vars, ...base }, at);
      break;
    }
    case 'look-at': {
      const vec = new THREE.Vector3(
        withParams.x ?? 0,
        withParams.y ?? 0,
        withParams.z ?? 0,
      );
      if (withParams.target !== undefined) {
        const t = resolveTarget(stage, withParams.target, errors, `${path}/with/target`);
        if (!t || t.kind !== '3d') {
          errors.push(err(`${path}/with/target`, `look-at target "${withParams.target}" must be a 3D object or light name.`));
          return;
        }
        vec.copy(t.target.position);
      }
      for (const o of live3d) {
        tl.to(
          dummy,
          {
            t: 1,
            duration: dur,
            ease: 'none',
            repeat,
            yoyo,
            onUpdate() {
              o.lookAt(vec);
            },
          },
          at,
        );
      }
      break;
    }
    case 'orbit': {
      if (!requireCamera()) break;
      const w = isPlainObject(withParams) ? withParams : {};
      const center = new THREE.Vector3(...(Array.isArray(w.center) ? w.center : [0, 0, 0]));
      const camPos = stage.camera.position;
      const from = w.from ?? Math.atan2(camPos.z - center.z, camPos.x - center.x);
      const to = w.to;
      const radius = w.radius ?? Math.hypot(camPos.x - center.x, camPos.z - center.z);
      const height = w.height ?? camPos.y;
      tl.to(
        dummy,
        {
          t: 1,
          duration: dur,
          ease,
          repeat,
          yoyo,
          onUpdate() {
            const angle = from + (to - from) * dummy.t;
            stage.camera.position.set(
              center.x + Math.cos(angle) * radius,
              height,
              center.z + Math.sin(angle) * radius,
            );
            stage.camera.lookAt(center);
          },
        },
        at,
      );
      break;
    }
    case 'dolly': {
      if (!requireCamera()) break;
      const w = isPlainObject(withParams) ? withParams : {};
      const center = new THREE.Vector3(...(Array.isArray(w.center) ? w.center : [0, 0, 0]));
      const camPos = stage.camera.position;
      const dir = new THREE.Vector3().subVectors(camPos, center).normalize();
      const from = w.from ?? camPos.distanceTo(center);
      const to = w.to;
      tl.to(
        dummy,
        {
          t: 1,
          duration: dur,
          ease,
          repeat,
          yoyo,
          onUpdate() {
            const r = from + (to - from) * dummy.t;
            stage.camera.position.set(center.x + dir.x * r, center.y + dir.y * r, center.z + dir.z * r);
            stage.camera.lookAt(center);
          },
        },
        at,
      );
      break;
    }
    case 'zoom': {
      if (!requireCamera()) break;
      const w = isPlainObject(withParams) ? withParams : {};
      const from = w.from ?? stage.camera.fov;
      const to = w.to;
      tl.to(
        dummy,
        {
          t: 1,
          duration: dur,
          ease,
          repeat,
          yoyo,
          onUpdate() {
            stage.camera.fov = from + (to - from) * dummy.t;
            stage.camera.updateProjectionMatrix();
          },
        },
        at,
      );
      break;
    }
    case 'move-along': {
      const pts = withParams.points;
      if (!Array.isArray(pts) || pts.length < 2) {
        errors.push(err(`${path}/with/points`, 'move-along requires with.points: an array of at least 2 [x, y, z] points.'));
        break;
      }
      const vecs = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      const closed = withParams.closed === true;
      let curve;
      if (vecs.length >= 3 && withParams.smooth !== false) {
        curve = new THREE.CatmullRomCurve3(vecs, closed);
      } else {
        curve = new THREE.CurvePath();
        const end = closed ? vecs.length : vecs.length - 1;
        for (let i = 0; i < end; i++) {
          curve.add(new THREE.LineCurve3(vecs[i], vecs[(i + 1) % vecs.length]));
        }
      }
      const orient = withParams.orient === true;
      for (const o of live3d) {
        tl.to(
          dummy,
          {
            t: 1,
            duration: dur,
            ease,
            repeat,
            yoyo,
            stagger: cue.stagger ?? 0,
            onUpdate() {
              o.position.copy(curve.getPointAt(dummy.t));
              if (orient) o.lookAt(curve.getPointAt((dummy.t + 0.01) % 1));
            },
          },
          at,
        );
      }
      break;
    }
    default:
      errors.push(err(`${path}/do`, `Verb "${verb}" is registered in the schema but has no compiler path.`));
  }
}

/**
 * Compile a flat cue list onto stage.timeline (the single paused GSAP clock).
 * Returns { ok, errors, warnings, duration } — errors/warnings use the same
 * { path, message, suggestion? } shape as spec validation.
 */
export function compileScore(stage, score) {
  const errors = [];
  const warnings = [];
  const tl = stage.timeline;
  const startIndex = tl.duration();
  const cues = Array.isArray(score) ? score : [score];
  cues.forEach((cue, i) => {
    if (!isPlainObject(cue)) {
      errors.push(err(`/score/${i}`, 'each cue must be an object.'));
      return;
    }
    if (typeof cue.do !== 'string' || !Object.hasOwn(SCORE_VERBS, cue.do)) {
      errors.push(err(`/score/${i}/do`, `Unknown verb ${JSON.stringify(cue.do)}; valid verbs: ${Object.keys(SCORE_VERBS).join(', ')}.`));
      return;
    }
    if (cue.ease !== undefined && !Object.hasOwn(SCORE_EASES, cue.ease)) {
      errors.push(err(`/score/${i}/ease`, `Unknown ease "${cue.ease}"; valid eases: ${Object.keys(SCORE_EASES).join(', ')}.`));
      return;
    }
    if (!('to' in cue) || (!isDomSelector(cue.to) && typeof cue.to !== 'string' && !Array.isArray(cue.to))) {
      errors.push(err(`/score/${i}/to`, 'cue.to must be a target name, an array of names, or a DOM selector.'));
      return;
    }
    if (cue.at !== undefined && (typeof cue.at !== 'number' || cue.at < 0)) {
      errors.push(err(`/score/${i}/at`, 'cue.at must be a number >= 0.', undefined, typeof cue.at === 'number' && cue.at < 0 ? [{ op: 'replace', path: `/score/${i}/at`, value: 0 }] : undefined));
      return;
    }
    if (cue.dur !== undefined && (typeof cue.dur !== 'number' || cue.dur < 0)) {
      errors.push(err(`/score/${i}/dur`, 'cue.dur must be a number >= 0.', undefined, typeof cue.dur === 'number' && cue.dur < 0 ? [{ op: 'replace', path: `/score/${i}/dur`, value: 0 }] : undefined));
      return;
    }
    compileCue(stage, { ...cue, _i: i }, errors, warnings);
  });
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    duration: tl.duration() - startIndex,
  };
}
