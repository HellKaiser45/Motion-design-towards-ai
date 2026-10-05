import { SCORE_DEFAULTS, SCORE_REPEAT_CAP, SCORE_PRESETS, isDomSelector } from '../spec/schema.js';

function err(path, message, suggestion, patch) {
  const e = { path, message };
  if (suggestion !== undefined && suggestion !== null) e.suggestion = suggestion;
  if (Array.isArray(patch) && patch.length > 0) e.patch = patch;
  return e;
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function dirOffset(dir, d) {
  switch (dir) {
    case 'above': return [0, d, 0];
    case 'left': return [-d, 0, 0];
    case 'right': return [d, 0, 0];
    case 'front': return [0, 0, d];
    case 'back': return [0, 0, -d];
    default: return [0, -d, 0];
  }
}

// Resting state of a named object, straight from the spec (expandScore runs
// before the stage exists). Returns null for unknown names.
function restingOf(spec, name) {
  const objects = Array.isArray(spec?.objects) ? spec.objects : [];
  const o = objects.find((x) => x && x.name === name);
  if (!o) return null;
  const position = Array.isArray(o.position) && o.position.length === 3 ? [...o.position] : [0, 0, 0];
  const rotation = Array.isArray(o.rotation) && o.rotation.length === 3 ? [...o.rotation] : [0, 0, 0];
  const scale = typeof o.scale === 'number' && Number.isFinite(o.scale)
    ? o.scale
    : Array.isArray(o.scale) && typeof o.scale[0] === 'number' ? o.scale[0] : 1;
  return { position, rotation, scale };
}

/**
 * Expand one preset cue into concrete verb cues. Returns
 * { cues: [{ relAt, cue }], broken }. `relAt` is the cue's offset from the
 * group's resolved start; sequencing resolution adds it after after/alongside
 * /offset are applied to the whole group.
 */
function expandPresetCue(cue, i, spec, errors) {
  const name = cue.do;
  const p = isPlainObject(cue.with) ? cue.with : {};
  const targets = Array.isArray(cue.to) ? cue.to : [cue.to];
  const stagger = num(cue.stagger, 0);
  const multi = targets.length > 1;
  const out = [];
  let broken = false;

  function push(relAt, c) {
    out.push({ relAt, cue: c });
  }

  function rest(t, ti) {
    const r = restingOf(spec, t);
    if (!r) {
      errors.push(err(`/score/${i}/to/${ti}`, `Preset "${name}" target "${t}" is not a known object name.`));
      broken = true;
      return null;
    }
    return r;
  }

  targets.forEach((t, ti) => {
    // Multi-target fan-out: each target's generated cues are offset by
    // targetIndex * stagger. Single-target cues keep cue.stagger verbatim
    // (only where the generated verb still uses it).
    const tOff = multi ? ti * stagger : 0;
    switch (name) {
      case 'reveal-text': {
        if (!isDomSelector(t)) {
          errors.push(err(`/score/${i}/to/${ti}`, `reveal-text requires a DOM selector target (starting with #, . or svg); got "${t}".`));
          broken = true;
          return;
        }
        const unit = p.of === 'words' ? 'word' : 'char';
        const c = {
          do: 'fade',
          to: `${t} .${unit}`,
          dur: num(cue.dur, SCORE_DEFAULTS.dur),
          ease: cue.ease ?? 'power2.out',
          with: { opacity: 1 },
        };
        if (multi) c.at = 0;
        else c.stagger = num(p.stagger, 0.03);
        push(tOff, c);
        break;
      }
      case 'entrance':
      case 'exit':
      case 'pop':
      case 'emphasis':
      case 'pulse':
      case 'float':
      case 'flip': {
        const r = rest(t, ti);
        if (!r) return;
        const [px, py, pz] = r.position;
        const dur = num(cue.dur, SCORE_DEFAULTS.dur);
        let c;
        if (name === 'entrance') {
          const [dx, dy, dz] = dirOffset(p.from ?? 'below', num(p.distance, 3));
          c = {
            do: 'animate', to: t, dur, ease: cue.ease ?? 'back.out',
            from: { x: px + dx, y: py + dy, z: pz + dz, opacity: 0 },
            with: { x: px, y: py, z: pz, opacity: 1 },
          };
        } else if (name === 'exit') {
          const [dx, dy, dz] = dirOffset(p.to ?? 'below', num(p.distance, 3));
          c = {
            do: 'animate', to: t, dur, ease: cue.ease ?? 'power2.in',
            with: { x: px + dx, y: py + dy, z: pz + dz, opacity: 0 },
          };
        } else if (name === 'pop') {
          c = {
            do: 'animate', to: t, dur, ease: cue.ease ?? 'back.out',
            from: { scale: 0, opacity: 0 },
            with: { scale: r.scale, opacity: 1 },
          };
        } else if (name === 'emphasis') {
          c = {
            do: 'animate', to: t, dur, ease: cue.ease ?? 'power2.inOut',
            with: { scale: r.scale * num(p.amount, 1.35) },
            repeat: 1, pingpong: true,
          };
        } else if (name === 'pulse') {
          c = {
            do: 'animate', to: t, dur, ease: cue.ease ?? 'sine.inOut',
            with: { scale: r.scale * num(p.amount, 1.08) },
            repeat: Math.round(num(p.count, 3)) * 2, pingpong: true,
          };
        } else if (name === 'float') {
          c = {
            do: 'animate', to: t, dur, ease: cue.ease ?? 'sine.inOut',
            with: { y: py + num(p.height, 0.4) },
            repeat: Math.round(num(p.count, 2)) * 2, pingpong: true,
          };
        } else {
          const axis = p.axis === 'x' ? 'x' : 'y';
          c = {
            do: 'animate', to: t, dur, ease: cue.ease ?? 'power2.inOut',
            with: { [axis === 'x' ? 'rotateX' : 'rotateY']: r.rotation[axis === 'x' ? 0 : 1] + Math.PI * 2 * num(p.turns, 1) },
          };
        }
        push(tOff, c);
        break;
      }
      case 'shake': {
        const r = rest(t, ti);
        if (!r) return;
        const intensity = num(p.intensity, 0.3);
        const count = Math.max(0, Math.round(num(p.count, 6)));
        const total = num(cue.dur, 0.6);
        const seg = total / (count + 1);
        for (let k = 1; k <= count + 1; k++) {
          const x = k <= count ? r.position[0] + (k % 2 === 1 ? intensity : -intensity) : r.position[0];
          push(tOff + (k - 1) * seg, { do: 'move-to', to: t, dur: seg, ease: 'none', with: { x } });
        }
        break;
      }
      case 'orbit': {
        const r = rest(t, ti);
        if (!r) return;
        const c3 = Array.isArray(p.center) && p.center.length === 3 && p.center.every((n) => typeof n === 'number') ? p.center : [0, 0, 0];
        const radius = num(p.radius, 3);
        const revs = num(p.revolutions, 1);
        const steps = Math.max(1, Math.round(num(p.steps, 16)));
        const total = num(cue.dur, 2);
        const seg = total / steps;
        const a0 = Math.atan2(r.position[2] - c3[2], r.position[0] - c3[0]);
        for (let s = 1; s <= steps; s++) {
          const a = a0 + revs * Math.PI * 2 * (s / steps);
          push(tOff + (s - 1) * seg, {
            do: 'move-to', to: t, dur: seg, ease: 'none',
            with: { x: c3[0] + Math.cos(a) * radius, y: r.position[1], z: c3[2] + Math.sin(a) * radius },
          });
        }
        break;
      }
      default:
        errors.push(err(`/score/${i}/do`, `Preset "${name}" has no expansion path.`));
        broken = true;
    }
  });

  return { cues: out, broken };
}

/**
 * Resolve cue sequencing (id/after/alongside/offset), expand intent presets
 * (step 0, before sequencing), and apply meta.duration time-scaling. Pure:
 * input spec is never mutated; output cues are deep copies with concrete `at`
 * values. Preset cues expand into GROUPS of cues: after/alongside referencing
 * a preset id resolve against the group's start (min at) / end (max end).
 *
 * Returns { cues, errors, warnings, naturalDuration, factor, brokenIndexes }.
 * `brokenIndexes` lists output-cue indexes whose sequencing is invalid —
 * callers should skip compiling those cues but may compile the rest.
 */
export function expandScore(spec) {
  const errors = [];
  const warnings = [];
  const score = Array.isArray(spec?.score) ? spec.score : [];
  const raw = JSON.parse(JSON.stringify(score));

  // ---- Step 0: preset expansion (macros over existing verbs) ----
  const items = [];
  raw.forEach((cue, i) => {
    if (isPlainObject(cue) && typeof cue.do === 'string' && Object.hasOwn(SCORE_PRESETS, cue.do)
      // `orbit` is also a camera verb; a camera-targeted orbit cue passes
      // through to the compiler instead of expanding as the object preset.
      && !(cue.do === 'orbit' && cue.to === 'camera')) {
      const res = expandPresetCue(cue, i, spec, errors);
      if (res.broken) return; // structured error recorded; cue excluded
      items.push({
        kind: 'group',
        oi: i,
        rec: {
          id: typeof cue.id === 'string' ? cue.id : undefined,
          after: cue.after,
          alongside: cue.alongside,
          offset: num(cue.offset, 0),
          at: num(cue.at, 0),
          cues: res.cues,
        },
      });
      return;
    }
    items.push({ kind: 'cue', cue, oi: i });
  });

  // ---- Sequencing resolution over items (cues and preset groups) ----
  const idToItem = new Map();
  items.forEach((it, idx) => {
    const id = it.kind === 'group' ? it.rec.id : it.cue?.id;
    if (typeof id === 'string' && id !== '' && !idToItem.has(id)) idToItem.set(id, idx);
  });

  const starts = new Array(items.length);
  const ends = new Array(items.length);
  const brokenItems = new Set();
  const resolving = new Set();
  const ids = [...idToItem.keys()];

  function cueDur(c) {
    return num(c.dur, SCORE_DEFAULTS.dur);
  }

  function effRepeat(c) {
    let r = c.repeat ?? 0;
    // Mirror the compiler's clamp semantics: unbounded repeats are capped so the
    // natural duration stays finite.
    if (!Number.isInteger(r) || r < 0) r = 0;
    if (r === -1 || r > SCORE_REPEAT_CAP) r = SCORE_REPEAT_CAP;
    return r;
  }

  function cueSpan(c, start) {
    const stagger = num(c.stagger, 0);
    const n = Array.isArray(c.to) ? c.to.length : 1;
    return start + stagger * (n - 1) + cueDur(c) * (effRepeat(c) + 1);
  }

  function bestMatch(value, candidates) {
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const a = String(value).toLowerCase();
      const b = c.toLowerCase();
      const m = a.length;
      const n = b.length;
      let prev = Array.from({ length: n + 1 }, (_, j) => j);
      let curr = new Array(n + 1);
      for (let x = 1; x <= m; x++) {
        curr[0] = x;
        for (let y = 1; y <= n; y++) {
          const cost = a[x - 1] === b[y - 1] ? 0 : 1;
          curr[y] = Math.min(prev[y] + 1, curr[y - 1] + 1, prev[y - 1] + cost);
        }
        [prev, curr] = [curr, prev];
      }
      if (prev[n] < bestDist) {
        bestDist = prev[n];
        best = c;
      }
    }
    return bestDist <= 2 ? best : null;
  }

  function resolveItem(idx) {
    if (starts[idx] !== undefined) return starts[idx];
    const it = items[idx];
    const isGroup = it.kind === 'group';
    const ref = isGroup ? it.rec : it.cue ?? {};
    const at = num(ref.at, SCORE_DEFAULTS.at);
    const offset = num(ref.offset, 0);
    let base = at;
    const seqKey = ref.after !== undefined ? 'after' : ref.alongside !== undefined ? 'alongside' : null;
    if (seqKey) {
      const refId = ref[seqKey];
      const refIdx = idToItem.get(refId);
      if (refIdx === undefined) {
        const sug = ids.length > 0 ? bestMatch(refId, ids) : undefined;
        errors.push(
          err(
            `/score/${it.oi}/${seqKey}`,
            `Unknown cue id "${refId}". Defined ids: ${ids.join(', ') || '(none)'}.`,
            sug,
            sug ? [{ op: 'replace', path: `/score/${it.oi}/${seqKey}`, value: sug }] : undefined,
          ),
        );
        brokenItems.add(idx);
      } else if (resolving.has(idx)) {
        // Reached while this item is already on the stack: a cycle.
        errors.push(err(`/score/${it.oi}/${seqKey}`, `Cue sequencing cycle detected through id "${ref.id ?? `(cue ${it.oi})`}".`));
        brokenItems.add(idx);
      } else {
        resolving.add(idx);
        resolveItem(refIdx);
        resolving.delete(idx);
        base = seqKey === 'after' ? ends[refIdx] : starts[refIdx];
      }
    }
    const resolved = base + offset;
    if (isGroup) {
      const rels = it.rec.cues.map((rc) => rc.relAt);
      const minRel = rels.length > 0 ? Math.min(...rels) : 0;
      const maxEnd = it.rec.cues.reduce((m, rc) => Math.max(m, rc.relAt + cueDur(rc.cue) * (effRepeat(rc.cue) + 1)), 0);
      it.groupBase = resolved;
      starts[idx] = resolved + minRel;
      ends[idx] = resolved + maxEnd;
    } else {
      starts[idx] = resolved;
      ends[idx] = cueSpan(it.cue, resolved);
    }
    if (resolved < 0) {
      errors.push(err(`/score/${it.oi}`, `Resolved start time ${resolved}s is negative; cues cannot begin before t=0. Use a smaller negative offset or a later anchor.`));
      brokenItems.add(idx);
    }
    return starts[idx];
  }

  let naturalDuration = 0;
  items.forEach((_, idx) => {
    resolveItem(idx);
    naturalDuration = Math.max(naturalDuration, ends[idx]);
  });

  // ---- Materialize concrete cues in original score order ----
  const cues = [];
  const outOrigin = [];
  items.forEach((it, idx) => {
    if (it.kind === 'group') {
      for (const rc of it.rec.cues) {
        cues.push({ ...rc.cue, at: it.groupBase + rc.relAt });
        outOrigin.push(it.oi);
      }
    } else {
      cues.push({ ...it.cue, at: starts[idx] });
      outOrigin.push(it.oi);
    }
  });

  // meta.duration: scale the whole score to fit exactly that long.
  let factor = 1;
  const metaDur = spec?.meta?.duration;
  if (typeof metaDur === 'number' && Number.isFinite(metaDur) && metaDur > 0 && naturalDuration > 0) {
    factor = metaDur / naturalDuration;
    cues.forEach((cue) => {
      cue.at *= factor;
      cue.dur = cueDur(cue) * factor;
      if (typeof cue.stagger === 'number') cue.stagger *= factor;
      if (cue.do === 'spin') {
        // Preserve total rotation angle: speed/factor * dur*factor = speed*dur.
        if (isPlainObject(cue.with) && typeof cue.with.speed === 'number' && Number.isFinite(cue.with.speed)) {
          cue.with.speed = cue.with.speed / factor;
        } else {
          cue.with = { ...(isPlainObject(cue.with) ? cue.with : {}), speed: 1 / factor };
        }
      }
    });
  }

  const brokenIndexes = [];
  const brokenOis = new Set();
  items.forEach((it, idx) => {
    if (brokenItems.has(idx)) brokenOis.add(it.oi);
  });
  outOrigin.forEach((oi, ci) => {
    if (brokenOis.has(oi)) brokenIndexes.push(ci);
  });

  return { cues, errors, warnings, naturalDuration, factor, brokenIndexes };
}
