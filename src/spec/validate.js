import {
  BACKGROUND_PRESETS,
  LIGHT_TYPES,
  MATERIAL_PRESETS,
  OBJECT_TYPES,
  DEFAULTS,
  SCORE_VERBS,
  SCORE_PRESETS,
  SCORE_EASES,
  SCORE_REPEAT_CAP,
  SCORE_RESERVED_TARGETS,
  isDomSelector,
  SVG_SHAPE_TYPES,
  SVG_TEXT_PARAMS,
  SVG_SPLITS,
  SVG_TAGS,
  SVG_ALIGNS,
  SVG_FITS,
} from './schema.js';

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function suggest(value, candidates) {
  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(String(value).toLowerCase(), c.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return bestDist <= 2 ? best : null;
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Error paths are rooted at '/': top-level keys are '/meta', '/camera', '/lights/i',
// '/objects/i'; nested keys append segments. The spec root itself is '/'.

function isColor(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

function isVector3(v) {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function err(path, message, suggestion, patch) {
  const e = { path, message };
  if (suggestion !== undefined && suggestion !== null) e.suggestion = suggestion;
  if (Array.isArray(patch) && patch.length > 0) e.patch = patch;
  return e;
}

// RFC 6902 JSON Patch helpers. Paths in errors are already JSON pointers
// rooted at '/' (e.g. '/score/0/ease'); key segments escape per RFC 6901.
function escPtr(t) {
  return String(t).replace(/~/g, '~0').replace(/\//g, '~1');
}
function patchReplace(path, value) {
  return [{ op: 'replace', path, value }];
}
function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function validateVector(v, path, errors, { allowScalar = false, what = 'value' } = {}) {
  if (allowScalar && typeof v === 'number' && Number.isFinite(v)) return;
  if (Array.isArray(v) && v.length !== 3) {
    errors.push(err(path, `${what} must be an array of exactly 3 finite numbers; got length ${v.length}.`));
    return;
  }
  if (!isVector3(v)) {
    errors.push(err(path, `${what} must be an array of exactly 3 finite numbers.`));
  }
}

function checkUnknownKeys(obj, allowed, path, errors) {
  // Root path is '/'; join without doubling the separator.
  const base = path.endsWith('/') ? path.slice(0, -1) : path;
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      const sug = suggest(key, allowed);
      let patch;
      if (sug) {
        patch = [
          { op: 'remove', path: `${base}/${escPtr(key)}` },
          { op: 'add', path: `${base}/${escPtr(sug)}`, value: obj[key] },
        ];
      }
      errors.push(
        err(`${base}/${key}`, `Unknown key "${key}". Allowed keys: ${allowed.join(', ')}.`, sug, patch)
      );
    }
  }
}

function validateNumber(v, path, errors, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push(err(path, `${what} must be a finite number.`));
  }
}

function validateShape(shape, path, seenIds, errors, depth = 0) {
  if (!isPlainObject(shape)) {
    errors.push(err(path, 'each svg shape must be an object.'));
    return;
  }
  if (depth > 8) {
    errors.push(err(path, 'svg group nesting is limited to 8 levels.'));
    return;
  }
  let knownType = null;
  if ('type' in shape && typeof shape.type === 'string' && Object.hasOwn(SVG_SHAPE_TYPES, shape.type)) {
    knownType = shape.type;
  }
  const allowed = [
    'id', 'class', 'type', 'stroke', 'fill', 'strokeWidth', 'opacity', 'children',
    ...Object.keys(knownType ? SVG_SHAPE_TYPES[knownType].params : {}),
  ];
  checkUnknownKeys(shape, allowed, path, errors);
  if (!('id' in shape) || typeof shape.id !== 'string' || shape.id.trim() === '') {
    errors.push(err(`${path}/id`, 'shape.id is required and must be a non-empty string.'));
  } else if (seenIds.has(shape.id)) {
    errors.push(err(`${path}/id`, `Duplicate id "${shape.id}". SVG text and shape ids must be unique.`));
  } else {
    seenIds.add(shape.id);
  }
  if ('class' in shape && typeof shape.class !== 'string') {
    errors.push(err(`${path}/class`, 'shape.class must be a string.'));
  }
  let shapeType = knownType;
  if (!('type' in shape)) {
    errors.push(err(`${path}/type`, 'shape.type is required.'));
  } else if (typeof shape.type !== 'string' || !Object.hasOwn(SVG_SHAPE_TYPES, shape.type)) {
    const sug = suggest(shape.type, Object.keys(SVG_SHAPE_TYPES));
    errors.push(
      err(`${path}/type`, `Unknown svg shape type "${shape.type}". Valid types: ${Object.keys(SVG_SHAPE_TYPES).join(', ')}.`, sug, sug ? patchReplace(`${path}/type`, sug) : undefined)
    );
  }
  // Type-specific geometry params must be numbers, except path's string d.
  if (knownType) {
    for (const [key, def] of Object.entries(SVG_SHAPE_TYPES[knownType].params)) {
      if (!(key in shape)) continue;
      const v = shape[key];
      if (key === 'd' && knownType === 'path') {
        if (typeof v !== 'string') errors.push(err(`${path}/d`, 'path d must be a string.'));
      } else {
        validateNumber(v, `${path}/${key}`, errors, `shape ${key}`);
      }
    }
  }
  if ('stroke' in shape && !isColor(shape.stroke)) {
    errors.push(err(`${path}/stroke`, 'shape.stroke must match #rrggbb.'));
  }
  if ('fill' in shape && shape.fill !== 'none' && !isColor(shape.fill)) {
    errors.push(err(`${path}/fill`, 'shape.fill must match #rrggbb or be the string "none".'));
  }
  if ('strokeWidth' in shape) validateNumber(shape.strokeWidth, `${path}/strokeWidth`, errors, 'shape.strokeWidth');
  if ('opacity' in shape) {
    const op = shape.opacity;
    if (typeof op !== 'number' || !Number.isFinite(op) || op < 0 || op > 1) {
      errors.push(err(`${path}/opacity`, 'shape.opacity must be a number between 0 and 1.', undefined, typeof op === 'number' && Number.isFinite(op) ? patchReplace(`${path}/opacity`, clamp01(op)) : undefined));
    }
  }
  if ('children' in shape) {
    if (shapeType !== 'group') {
      errors.push(err(`${path}/children`, 'shape.children is only valid for type "group".'));
    } else if (!Array.isArray(shape.children)) {
      errors.push(err(`${path}/children`, 'shape.children must be an array of shapes.'));
    } else {
      shape.children.forEach((child, i) => validateShape(child, `${path}/children/${i}`, seenIds, errors, depth + 1));
    }
  }
}

function validateSvg(svg, errors) {
  const path = '/svg';
  if (!isPlainObject(svg)) {
    errors.push(err(path, 'svg must be an object.'));
    return;
  }
  const allowed = ['fit', 'text', 'shapes'];
  checkUnknownKeys(svg, allowed, path, errors);
  if ('fit' in svg) {
    const fit = svg.fit;
    if (typeof fit !== 'string' || !SVG_FITS.includes(fit)) {
      const sug = suggest(fit, SVG_FITS);
      errors.push(err(`${path}/fit`, `svg.fit must be one of: ${SVG_FITS.join(', ')}.`, sug, sug ? patchReplace(`${path}/fit`, sug) : undefined));
    }
  }
  const seenIds = new Set();
  if ('text' in svg) {
    if (!Array.isArray(svg.text)) {
      errors.push(err(`${path}/text`, 'svg.text must be an array.'));
    } else {
      svg.text.forEach((item, i) => {
        const p = `${path}/text/${i}`;
        if (!isPlainObject(item)) {
          errors.push(err(p, 'each svg text item must be an object.'));
          return;
        }
        checkUnknownKeys(item, [...SVG_TEXT_PARAMS], p, errors);
        if (!('id' in item) || typeof item.id !== 'string' || item.id.trim() === '') {
          errors.push(err(`${p}/id`, 'svg text id is required and must be a non-empty string.'));
        } else if (seenIds.has(item.id)) {
          errors.push(err(`${p}/id`, `Duplicate id "${item.id}". SVG text and shape ids must be unique.`));
        } else {
          seenIds.add(item.id);
        }
        if (!('content' in item) || typeof item.content !== 'string') {
          errors.push(err(`${p}/content`, 'svg text content is required and must be a string.'));
        }
        if ('class' in item && typeof item.class !== 'string') {
          errors.push(err(`${p}/class`, 'svg text class must be a string.'));
        }
        if ('split' in item && !SVG_SPLITS.includes(item.split)) {
          const sug = suggest(item.split, SVG_SPLITS);
          errors.push(err(`${p}/split`, `svg text split must be one of: ${SVG_SPLITS.join(', ')}.`, sug, sug ? patchReplace(`${p}/split`, sug) : undefined));
        }
        if ('tag' in item && !SVG_TAGS.includes(item.tag)) {
          const sug = suggest(item.tag, SVG_TAGS);
          errors.push(err(`${p}/tag`, `svg text tag must be one of: ${SVG_TAGS.join(', ')}.`, sug, sug ? patchReplace(`${p}/tag`, sug) : undefined));
        }
        for (const key of ['x', 'y', 'size', 'weight']) {
          if (key in item) validateNumber(item[key], `${p}/${key}`, errors, `svg text ${key}`);
        }
        if ('opacity' in item) {
          const op = item.opacity;
          if (typeof op !== 'number' || !Number.isFinite(op) || op < 0 || op > 1) {
            errors.push(err(`${p}/opacity`, 'svg text opacity must be a number between 0 and 1.', undefined, typeof op === 'number' && Number.isFinite(op) ? patchReplace(`${p}/opacity`, clamp01(op)) : undefined));
          }
        }
        if ('family' in item && typeof item.family !== 'string') {
          errors.push(err(`${p}/family`, 'svg text family must be a string.'));
        }
        if ('color' in item && !isColor(item.color)) {
          errors.push(err(`${p}/color`, 'svg text color must match #rrggbb.'));
        }
        if ('align' in item && !SVG_ALIGNS.includes(item.align)) {
          const sug = suggest(item.align, SVG_ALIGNS);
          errors.push(err(`${p}/align`, `svg text align must be one of: ${SVG_ALIGNS.join(', ')}.`, sug, sug ? patchReplace(`${p}/align`, sug) : undefined));
        }
      });
    }
  }
  if ('shapes' in svg) {
    if (!Array.isArray(svg.shapes)) {
      errors.push(err(`${path}/shapes`, 'svg.shapes must be an array.'));
    } else {
      svg.shapes.forEach((shape, i) => validateShape(shape, `${path}/shapes/${i}`, seenIds, errors));
    }
  }
}

function validateMeta(meta, errors) {
  const path = '/meta';
  if (!isPlainObject(meta)) {
    errors.push(err(path, 'meta must be an object.'));
    return;
  }
  checkUnknownKeys(meta, ['title', 'background', 'fog', 'size', 'duration'], path, errors);
  if ('duration' in meta) {
    const d = meta.duration;
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) {
      errors.push(err(`${path}/duration`, 'meta.duration must be a finite number > 0 (seconds).'));
    }
  }
  if ('title' in meta && typeof meta.title !== 'string') {
    errors.push(err(`${path}/title`, 'meta.title must be a string.'));
  }
  if ('background' in meta) {
    const bg = meta.background;
    if (typeof bg === 'string' && (Object.hasOwn(BACKGROUND_PRESETS, bg) || isColor(bg))) {
      // ok
    } else {
      const sug = suggest(bg, [...Object.keys(BACKGROUND_PRESETS)]);
      errors.push(
        err(
          `${path}/background`,
          `Unknown background value. Use '#rrggbb' or one of: ${Object.keys(BACKGROUND_PRESETS).join(', ')}.`,
          sug,
          sug ? patchReplace(`${path}/background`, sug) : undefined
        )
      );
    }
  }
  if ('fog' in meta) {
    const fog = meta.fog;
    if (!isPlainObject(fog)) {
      errors.push(err(`${path}/fog`, 'meta.fog must be an object with color, near, far.'));
    } else {
      checkUnknownKeys(fog, ['color', 'near', 'far'], `${path}/fog`, errors);
      const missing = ['color', 'near', 'far'].filter((k) => !(k in fog));
      if (missing.length > 0) {
        errors.push(
          err(`${path}/fog`, `meta.fog requires all three fields together; missing: ${missing.join(', ')}.`)
        );
      }
      if ('color' in fog && !isColor(fog.color)) {
        errors.push(err(`${path}/fog/color`, 'meta.fog.color must match #rrggbb.'));
      }
      if ('near' in fog) validateNumber(fog.near, `${path}/fog/near`, errors, 'meta.fog.near');
      if ('far' in fog) validateNumber(fog.far, `${path}/fog/far`, errors, 'meta.fog.far');
    }
  }
  if ('size' in meta) {
    const size = meta.size;
    if (!isPlainObject(size)) {
      errors.push(err(`${path}/size`, 'meta.size must be an object with width and height.'));
    } else {
      checkUnknownKeys(size, ['width', 'height'], `${path}/size`, errors);
      for (const k of ['width', 'height']) {
        if (k in size) {
          const v = size[k];
          if (!Number.isInteger(v) || v <= 0) {
            errors.push(err(`${path}/size/${k}`, `meta.size.${k} must be an integer > 0.`));
          }
        }
      }
    }
  }
}

function validateCamera(camera, errors) {
  const path = '/camera';
  if (!isPlainObject(camera)) {
    errors.push(err(path, 'camera must be an object.'));
    return;
  }
  checkUnknownKeys(camera, ['fov', 'position', 'lookAt'], path, errors);
  if ('fov' in camera) {
    const fov = camera.fov;
    if (typeof fov !== 'number' || !Number.isFinite(fov) || fov < 1 || fov > 179) {
      errors.push(err(`${path}/fov`, 'camera.fov must be a finite number between 1 and 179.', undefined, typeof fov === 'number' && Number.isFinite(fov) ? patchReplace(`${path}/fov`, fov < 1 ? 1 : 179) : undefined));
    }
  }
  if ('position' in camera) validateVector(camera.position, `${path}/position`, errors, { what: 'camera.position' });
  if ('lookAt' in camera) validateVector(camera.lookAt, `${path}/lookAt`, errors, { what: 'camera.lookAt' });
}

function validateDisplay(display, errors) {
  const path = '/display';
  if (!isPlainObject(display)) {
    errors.push(err(path, 'display must be an object.'));
    return;
  }
  const enums = {
    fit: ['cover', 'contain'],
    position: ['fixed', 'absolute'],
    mount: ['body', 'none'],
  };
  const allowed = Object.keys(enums);
  checkUnknownKeys(display, allowed, path, errors);
  for (const key of allowed) {
    if (key in display) {
      const v = display[key];
      if (typeof v !== 'string' || !enums[key].includes(v)) {
        const sug = suggest(v, enums[key]);
        errors.push(
          err(
            `${path}/${key}`,
            `display.${key} must be one of: ${enums[key].join(', ')}.`,
            sug,
            sug ? patchReplace(`${path}/${key}`, sug) : undefined
          )
        );
      }
    }
  }
}

function validateLight(light, index, seenNames, errors) {
  const path = `/lights/${index}`;
  if (!isPlainObject(light)) {
    errors.push(err(path, 'each light must be an object.'));
    return;
  }
  const allowed = ['name', 'type', 'color', 'intensity', 'position', 'target'];
  checkUnknownKeys(light, allowed, path, errors);
  if (!('name' in light) || typeof light.name !== 'string' || light.name.trim() === '') {
    errors.push(err(`${path}/name`, 'light.name is required and must be a non-empty string.'));
  } else if (seenNames.has(light.name)) {
    errors.push(err(`${path}/name`, `Duplicate light name "${light.name}". Light names must be unique.`));
  } else {
    seenNames.add(light.name);
  }
  if (!('type' in light)) {
    errors.push(err(`${path}/type`, 'light.type is required.'));
  } else if (!LIGHT_TYPES.includes(light.type)) {
    const sug = suggest(light.type, LIGHT_TYPES);
    errors.push(
      err(`${path}/type`, `Unknown light type "${light.type}". Valid types: ${LIGHT_TYPES.join(', ')}.`, sug, sug ? patchReplace(`${path}/type`, sug) : undefined)
    );
  }
  if ('color' in light && !isColor(light.color)) {
    errors.push(err(`${path}/color`, 'light.color must match #rrggbb.'));
  }
  if ('intensity' in light) validateNumber(light.intensity, `${path}/intensity`, errors, 'light.intensity');
  if ('position' in light) validateVector(light.position, `${path}/position`, errors, { what: 'light.position' });
  if ('target' in light) {
    if (light.type === 'ambient') {
      errors.push(err(`${path}/target`, 'light.target is only valid for directional or spot lights.'));
    } else if (light.type === undefined || !LIGHT_TYPES.includes(light.type)) {
      // Do not silently accept a target when the light type itself is invalid.
      errors.push(err(`${path}/target`, 'light.target cannot be evaluated because light.type is missing or invalid.'));
    } else {
      validateVector(light.target, `${path}/target`, errors, { what: 'light.target' });
    }
  }
}

const PRESET_DIRECTIONS = ['below', 'above', 'left', 'right', 'front', 'back'];
const PRESET_ENUMS = {
  from: PRESET_DIRECTIONS,
  to: PRESET_DIRECTIONS,
  axis: ['x', 'y'],
  of: ['chars', 'words'],
};

function validatePresetParams(name, params, path, errors) {
  if (params === undefined) return;
  if (!isPlainObject(params)) {
    errors.push(err(path, 'cue "with" must be an object of preset params.'));
    return;
  }
  const def = SCORE_PRESETS[name].params;
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(def, key)) {
      const sug = suggest(key, Object.keys(def));
      errors.push(
        err(`${path}/${key}`, `Unknown param "${key}" for preset "${name}". Valid params: ${Object.keys(def).join(', ')}.`, sug,
          sug ? [{ op: 'remove', path: `${path}/${escPtr(key)}` }, { op: 'add', path: `${path}/${escPtr(sug)}`, value: params[key] }] : undefined)
      );
      continue;
    }
    const v = params[key];
    if (key === 'center') {
      if (!isVector3(v)) {
        errors.push(err(`${path}/center`, 'preset center must be an array of exactly 3 finite numbers.'));
      }
      continue;
    }
    if (key in PRESET_ENUMS) {
      const allowed = PRESET_ENUMS[key];
      if (typeof v !== 'string' || !allowed.includes(v)) {
        const sug = suggest(v, allowed);
        errors.push(err(`${path}/${key}`, `preset "${name}" param "${key}" must be one of: ${allowed.join(', ')}.`, sug, sug ? patchReplace(`${path}/${key}`, sug) : undefined));
      }
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(err(`${path}/${key}`, `preset param "${key}" must be a finite number.`));
    }
  }
}

function validateCueParams(verb, params, path, errors, names) {
  if (!isPlainObject(params)) {
    errors.push(err(path, 'cue "with" must be an object of verb params.'));
    return;
  }
  const allowed = SCORE_VERBS[verb].params;
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(allowed, key)) {
      const sug = suggest(key, Object.keys(allowed));
      errors.push(
        err(`${path}/${key}`, `Unknown param "${key}" for verb "${verb}". Valid params: ${Object.keys(allowed).join(', ')}.`, sug,
          sug ? [{ op: 'remove', path: `${path}/${escPtr(key)}` }, { op: 'add', path: `${path}/${escPtr(sug)}`, value: params[key] }] : undefined)
      );
      continue;
    }
    const v = params[key];
    if (key === 'axis') {
      if (v !== 'x' && v !== 'y' && v !== 'z') {
        const sug = suggest(v, ['x', 'y', 'z']);
        errors.push(err(`${path}/axis`, 'spin axis must be one of: x, y, z.', sug, sug ? patchReplace(`${path}/axis`, sug) : undefined));
      }
    } else if (key === 'hex') {
      if (!isColor(v)) errors.push(err(`${path}/hex`, 'color-to hex must match #rrggbb.'));
    } else if (key === 'target') {
      if (typeof v !== 'string' || !names.includes(v)) {
        const sug = suggest(v, names);
        errors.push(err(`${path}/target`, `look-at target "${v}" is not a known object name. Valid names: ${names.join(', ')}.`, sug, sug ? patchReplace(`${path}/target`, sug) : undefined));
      }
    } else if (key === 'center' && (verb === 'orbit' || verb === 'dolly')) {
      if (!isVector3(v)) {
        errors.push(err(`${path}/center`, `${verb} center must be an array of exactly 3 finite numbers.`));
      }
    } else if (key === 'points' && verb === 'move-along') {
      if (!Array.isArray(v) || v.length < 2) {
        errors.push(err(`${path}/points`, 'move-along points must be an array of at least 2 [x, y, z] points.'));
      } else {
        v.forEach((pt, pi) => {
          if (!isVector3(pt)) {
            errors.push(err(`${path}/points/${pi}`, 'each move-along point must be an array of exactly 3 finite numbers.'));
          }
        });
      }
    } else if (key === 'smooth' || key === 'closed' || key === 'orient') {
      if (typeof v !== 'boolean') {
        errors.push(err(`${path}/${key}`, `${verb} param "${key}" must be a boolean.`));
      }
    } else if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(err(`${path}/${key}`, `cue param "${key}" must be a finite number.`));
    } else if (key === 'radius' && verb === 'orbit' && v <= 0) {
      errors.push(err(`${path}/radius`, 'orbit radius must be a number > 0.'));
    } else if (key === 'to' && verb === 'dolly' && v <= 0) {
      errors.push(err(`${path}/to`, 'dolly to must be a number > 0.'));
    } else if ((key === 'from' || key === 'to') && verb === 'zoom' && (v < 1 || v > 179)) {
      errors.push(err(`${path}/${key}`, 'zoom fov values must be between 1 and 179.'));
    } else if ((key === 'from' || key === 'to') && verb === 'dolly' && v !== undefined && v <= 0) {
      errors.push(err(`${path}/${key}`, 'dolly distances must be numbers > 0.'));
    } else if ((verb === 'fade' || verb === 'animate') && key === 'opacity' && (v < 0 || v > 1)) {
      errors.push(err(`${path}/opacity`, `${verb} opacity must be between 0 and 1.`, undefined, patchReplace(`${path}/opacity`, clamp01(v))));
    }
  }
}

function validateCue(cue, index, errors, names, seenCueIds) {
  const path = `/score/${index}`;
  if (!isPlainObject(cue)) {
    errors.push(err(path, 'each cue must be an object.'));
    return;
  }
  const allowed = ['do', 'to', 'at', 'dur', 'ease', 'repeat', 'pingpong', 'stagger', 'with', 'id', 'after', 'alongside', 'offset', 'from'];
  checkUnknownKeys(cue, allowed, path, errors);

  // `orbit` exists as BOTH an intent preset (objects) and a camera verb
  // (to: 'camera'); the camera target disambiguates.
  const isPreset = typeof cue.do === 'string' && Object.hasOwn(SCORE_PRESETS, cue.do)
    && !(cue.do === 'orbit' && cue.to === 'camera');
  let verb;
  if (!('do' in cue) || typeof cue.do !== 'string' || cue.do === '') {
    errors.push(err(`${path}/do`, 'cue.do is required and must be a verb string.', suggest(cue.do, [...Object.keys(SCORE_VERBS), ...Object.keys(SCORE_PRESETS)])));
  } else if (Object.hasOwn(SCORE_VERBS, cue.do)) {
    verb = cue.do;
    } else if (!isPreset) {
    const sug = suggest(cue.do, [...Object.keys(SCORE_VERBS), ...Object.keys(SCORE_PRESETS)]);
    errors.push(
      err(`${path}/do`, `Unknown verb "${cue.do}". Valid verbs: ${[...Object.keys(SCORE_VERBS), ...Object.keys(SCORE_PRESETS)].join(', ')}.`, sug, sug ? patchReplace(`${path}/do`, sug) : undefined)
    );
  }

  if (isPreset) {
    for (const key of ['repeat', 'pingpong']) {
      if (key in cue) {
        errors.push(err(`${path}/${key}`, `preset ${cue.do} owns its repeat/pingpong; remove "${key}" from the cue.`));
      }
    }
  }

  if (!('to' in cue)) {
    errors.push(err(`${path}/to`, 'cue.to is required: an object/light name, camera, scene, an array of names, or a DOM selector.'));
  } else {
    const targets = Array.isArray(cue.to) ? cue.to : [cue.to];
    if (targets.length === 0) {
      errors.push(err(`${path}/to`, 'cue.to array must contain at least one target.'));
    }
    targets.forEach((t, ti) => {
      if (typeof t !== 'string' || t === '') {
        errors.push(err(`${path}/to/${ti}`, 'cue.to targets must be non-empty strings.'));
        return;
      }
      if (isDomSelector(t) || SCORE_RESERVED_TARGETS.includes(t) || names.includes(t)) return;
      const sug = suggest(t, [...names, ...SCORE_RESERVED_TARGETS]);
      // cue.to may be a single string; the patch then replaces the string itself.
      const tPath = Array.isArray(cue.to) ? `${path}/to/${ti}` : `${path}/to`;
      errors.push(
        err(`${path}/to/${ti}`, `Unknown target "${t}". Valid targets: ${[...names, ...SCORE_RESERVED_TARGETS].join(', ')} or a DOM selector.`, sug, sug ? patchReplace(tPath, sug) : undefined)
      );
    });
    if (verb && !isPreset && ['orbit', 'dolly', 'zoom'].includes(verb) && cue.to !== 'camera') {
      errors.push(err(`${path}/to`, `verb "${verb}" requires to: 'camera'.`));
    }
  }

  if ('at' in cue) {
    if (typeof cue.at !== 'number' || !Number.isFinite(cue.at) || cue.at < 0) {
      errors.push(err(`${path}/at`, 'cue.at must be a finite number >= 0 (seconds).', undefined, typeof cue.at === 'number' && Number.isFinite(cue.at) && cue.at < 0 ? patchReplace(`${path}/at`, 0) : undefined));
    }
    if ('after' in cue || 'alongside' in cue) {
      errors.push(err(`${path}/at`, 'cue.at cannot be combined with after/alongside; sequenced cues derive their start from the referenced cue (use offset for fine-tuning).'));
    }
  }
  if ('id' in cue) {
    if (typeof cue.id !== 'string' || cue.id.trim() === '') {
      errors.push(err(`${path}/id`, 'cue.id must be a non-empty string.'));
    } else if (seenCueIds.has(cue.id)) {
      errors.push(
        err(`${path}/id`, `Duplicate cue id "${cue.id}"; first used at /score/${seenCueIds.get(cue.id)}, repeated at /score/${index}.`)
      );
    } else {
      seenCueIds.set(cue.id, index);
    }
  }
  for (const key of ['after', 'alongside']) {
    if (key in cue && (typeof cue[key] !== 'string' || cue[key] === '')) {
      errors.push(err(`${path}/${key}`, `cue.${key} must be a non-empty string referencing another cue's id.`));
    }
  }
  if ('offset' in cue) {
    validateNumber(cue.offset, `${path}/offset`, errors, 'cue.offset');
  }
  if ('from' in cue) {
    if (verb === 'animate') {
      if (!isPlainObject(cue.from)) {
        errors.push(err(`${path}/from`, 'cue.from must be an object of bridge props (same keys as "with").'));
      } else {
        validateCueParams('animate', cue.from, `${path}/from`, errors, names);
      }
    } else {
      errors.push(err(`${path}/from`, 'cue.from is only valid with the animate verb.'));
    }
  }
  if ('dur' in cue) {
    if (typeof cue.dur !== 'number' || !Number.isFinite(cue.dur) || cue.dur < 0) {
      errors.push(err(`${path}/dur`, 'cue.dur must be a finite number >= 0 (seconds).', undefined, typeof cue.dur === 'number' && Number.isFinite(cue.dur) && cue.dur < 0 ? patchReplace(`${path}/dur`, 0) : undefined));
    }
  }
  if ('ease' in cue) {
    if (typeof cue.ease !== 'string' || !Object.hasOwn(SCORE_EASES, cue.ease)) {
      const sug = suggest(cue.ease, Object.keys(SCORE_EASES));
      errors.push(
        err(`${path}/ease`, `Unknown ease "${cue.ease}". Valid eases: ${Object.keys(SCORE_EASES).join(', ')}.`, sug, sug ? patchReplace(`${path}/ease`, sug) : undefined)
      );
    }
  }
  if ('repeat' in cue) {
    if (!Number.isInteger(cue.repeat) || cue.repeat < -1) {
      errors.push(err(`${path}/repeat`, 'cue.repeat must be an integer >= -1 (-1 is clamped to the repeat cap).'));
    }
  }
  if ('pingpong' in cue && typeof cue.pingpong !== 'boolean') {
    errors.push(err(`${path}/pingpong`, 'cue.pingpong must be a boolean.'));
  }
  if ('stagger' in cue) {
    if (typeof cue.stagger !== 'number' || !Number.isFinite(cue.stagger) || cue.stagger < 0) {
      errors.push(err(`${path}/stagger`, 'cue.stagger must be a finite number >= 0 (seconds).', undefined, typeof cue.stagger === 'number' && Number.isFinite(cue.stagger) && cue.stagger < 0 ? patchReplace(`${path}/stagger`, 0) : undefined));
    }
  }
  if ('with' in cue) {
    if (isPreset) validatePresetParams(cue.do, cue.with, `${path}/with`, errors);
    else if (verb) validateCueParams(verb, cue.with, `${path}/with`, errors, names);
    if (verb === 'animate' && isPlainObject(cue.with) && Object.keys(cue.with).length === 0) {
      errors.push(err(`${path}/with`, `animate needs at least one property. Valid: ${Object.keys(SCORE_VERBS.animate.params).join(', ')}.`));
    }
  } else if (verb === 'animate') {
    errors.push(err(`${path}/with`, `animate requires "with" listing at least one property. Valid: ${Object.keys(SCORE_VERBS.animate.params).join(', ')}.`));
  }
  if (verb && !isPreset && ['orbit', 'dolly', 'zoom'].includes(verb) && !(isPlainObject(cue.with) && 'to' in cue.with)) {
    errors.push(err(`${path}/with`, `verb "${verb}" requires with.to (${verb === 'zoom' ? 'fov 1..179' : verb === 'dolly' ? 'distance > 0' : 'end angle in radians'}).`));
  }
  if (verb && !isPreset && verb === 'move-along' && !(isPlainObject(cue.with) && Array.isArray(cue.with.points))) {
    errors.push(err(`${path}/with`, 'verb "move-along" requires with.points: an array of at least 2 [x, y, z] points.'));
  }
}

function validateScore(score, spec, errors) {
  if (!Array.isArray(score)) {
    errors.push(err('/score', 'score must be an array of cues.'));
    return;
  }
  const names = [
    ...(Array.isArray(spec.objects) ? spec.objects.map((o) => o?.name) : []),
    ...(Array.isArray(spec.lights) ? spec.lights.map((l) => l?.name) : []),
  ].filter((n) => typeof n === 'string' && n !== '');
  const seenCueIds = new Map();
  score.forEach((cue, i) => validateCue(cue, i, errors, names, seenCueIds));
  // Two-pass reference check: after/alongside may reference ids defined later.
  const idList = [...seenCueIds.keys()];
  score.forEach((cue, i) => {
    if (!isPlainObject(cue)) return;
    for (const key of ['after', 'alongside']) {
      const v = cue[key];
      if (typeof v === 'string' && v !== '' && !seenCueIds.has(v)) {
        const sug = idList.length > 0 ? suggest(v, idList) : undefined;
        errors.push(
          err(`/score/${i}/${key}`, `Unknown cue id "${v}". Defined ids: ${idList.join(', ') || '(none)'}.`, sug, sug ? patchReplace(`/score/${i}/${key}`, sug) : undefined)
        );
      }
    }
  });
}

function validateParents(objects, errors) {
  const names = objects.filter((o) => isPlainObject(o) && typeof o.name === 'string' && o.name.trim() !== '').map((o) => o.name);
  objects.forEach((obj, i) => {
    if (!isPlainObject(obj) || !('parent' in obj)) return;
    const path = `/objects/${i}/parent`;
    const p = obj.parent;
    if (typeof p !== 'string' || p.trim() === '') {
      errors.push(err(path, 'object.parent must be a non-empty string naming another object.'));
      return;
    }
    if (p === obj.name) {
      errors.push(err(path, `object "${obj.name}" cannot be its own parent.`));
      return;
    }
    if (!names.includes(p)) {
      const sug = suggest(p, names);
      errors.push(err(path, `Unknown parent "${p}". Valid object names: ${names.join(', ')}.`, sug, sug ? patchReplace(path, sug) : undefined));
    }
  });
  // Cycle detection: a -> parent chains must terminate at a parentless object.
  const byName = new Map();
  for (const o of objects) if (isPlainObject(o) && typeof o.name === 'string') byName.set(o.name, o.parent);
  for (const name of byName.keys()) {
    const seen = new Set([name]);
    let cur = byName.get(name);
    while (typeof cur === 'string' && byName.has(cur)) {
      if (seen.has(cur)) {
        const idx = objects.findIndex((o) => isPlainObject(o) && o.name === name);
        errors.push(err(`/objects/${idx}/parent`, `Parent cycle detected involving "${cur}"; parent chains must end at an unparented object.`));
        break;
      }
      seen.add(cur);
      cur = byName.get(cur);
    }
  }
}

function validateMaterial(material, path, errors, objType) {
  if (!isPlainObject(material)) {
    errors.push(err(path, 'material must be an object.'));
    return;
  }
  const allowed = ['preset', 'color', 'opacity', 'emissive', 'map'];
  checkUnknownKeys(material, allowed, path, errors);
  if ('preset' in material) {
    if (!MATERIAL_PRESETS.includes(material.preset)) {
      const sug = suggest(material.preset, MATERIAL_PRESETS);
      errors.push(
        err(`${path}/preset`, `Unknown material preset "${material.preset}". Valid presets: ${MATERIAL_PRESETS.join(', ')}.`, sug, sug ? patchReplace(`${path}/preset`, sug) : undefined)
      );
    }
  }
  const preset = material.preset ?? DEFAULTS.object.material.preset;
  if ('color' in material && !isColor(material.color)) {
    errors.push(err(`${path}/color`, 'material.color must match #rrggbb.'));
  }
  if ('opacity' in material) {
    const op = material.opacity;
    if (typeof op !== 'number' || !Number.isFinite(op) || op < 0 || op > 1) {
      errors.push(err(`${path}/opacity`, 'material.opacity must be a number between 0 and 1.', undefined, typeof op === 'number' && Number.isFinite(op) ? patchReplace(`${path}/opacity`, clamp01(op)) : undefined));
    }
  }
  if ('emissive' in material) {
    if (preset !== 'neon') {
      errors.push(err(`${path}/emissive`, 'material.emissive is only valid for the neon material preset.'));
    } else if (!isColor(material.emissive)) {
      errors.push(err(`${path}/emissive`, 'material.emissive must match #rrggbb.'));
    }
  }
  if ('map' in material) {
    if (typeof material.map !== 'string' || !/^(https?:\/\/|data:image\/)/i.test(material.map)) {
      errors.push(err(`${path}/map`, 'material.map must be a string URL starting with http://, https:// or data:image/.'));
    }
  }
}

function validateObject(obj, index, seenNames, errors) {
  const path = `/objects/${index}`;
  if (!isPlainObject(obj)) {
    errors.push(err(path, 'each object must be an object.'));
    return;
  }
  const allowed = ['name', 'type', 'material', 'position', 'rotation', 'scale', 'params', 'parent'];
  checkUnknownKeys(obj, allowed, path, errors);
  if (!('name' in obj) || typeof obj.name !== 'string' || obj.name.trim() === '') {
    errors.push(err(`${path}/name`, 'object.name is required and must be a non-empty string.'));
  } else if (seenNames.has(obj.name)) {
    errors.push(err(`${path}/name`, `Duplicate object name "${obj.name}". Object names must be unique.`));
  } else {
    seenNames.add(obj.name);
  }
  let objType;
  if (!('type' in obj)) {
    errors.push(err(`${path}/type`, 'object.type is required.'));
  } else if (typeof obj.type !== 'string' || !Object.hasOwn(OBJECT_TYPES, obj.type)) {
    const sug = suggest(obj.type, Object.keys(OBJECT_TYPES));
    errors.push(
      err(`${path}/type`, `Unknown object type "${obj.type}". Valid types: ${Object.keys(OBJECT_TYPES).join(', ')}.`, sug, sug ? patchReplace(`${path}/type`, sug) : undefined)
    );
  } else {
    objType = obj.type;
  }
  if ('material' in obj) validateMaterial(obj.material, `${path}/material`, errors, objType);
  if ('position' in obj) validateVector(obj.position, `${path}/position`, errors, { what: 'position' });
  if ('rotation' in obj) validateVector(obj.rotation, `${path}/rotation`, errors, { what: 'rotation (radians)' });
  if ('scale' in obj) {
    validateVector(obj.scale, `${path}/scale`, errors, { allowScalar: true, what: 'scale' });
  }
  if ('params' in obj) {
    const params = obj.params;
    const paramKeys = objType ? Object.keys(OBJECT_TYPES[objType].params) : null;
    if (!isPlainObject(params)) {
      errors.push(err(`${path}/params`, 'params must be an object of type-specific numbers.'));
    } else if (paramKeys) {
      for (const key of Object.keys(params)) {
        if (!paramKeys.includes(key)) {
          const sug = suggest(key, paramKeys);
          errors.push(
            err(`${path}/params/${key}`, `Unknown param "${key}" for object type "${objType}". Valid params: ${paramKeys.join(', ')}.`, sug,
              sug ? [{ op: 'remove', path: `${path}/params/${escPtr(key)}` }, { op: 'add', path: `${path}/params/${escPtr(sug)}`, value: params[key] }] : undefined)
          );
        } else if (typeof params[key] !== 'number' || !Number.isFinite(params[key])) {
          errors.push(err(`${path}/params/${key}`, `params.${key} must be a finite number.`));
        }
      }
    }
  }
}

export function validateSpec(spec) {
  const errors = [];
  if (!isPlainObject(spec)) {
    return { ok: false, errors: [err('/', 'spec must be a JSON object.')] };
  }
  const allowedTop = ['meta', 'camera', 'display', 'lights', 'objects', 'score', 'svg', 'overlay'];
  checkUnknownKeys(spec, allowedTop, '/', errors);
  const svgKeys = ['svg', 'overlay'].filter((k) => k in spec);
  if (svgKeys.length > 1) {
    errors.push(err('/', 'spec cannot define both "svg" and "overlay"; use "svg".'));
  } else if (svgKeys.length === 1) {
    validateSvg(spec[svgKeys[0]], errors);
  }
  if ('meta' in spec) validateMeta(spec.meta, errors);
  if ('camera' in spec) validateCamera(spec.camera, errors);
  if ('display' in spec) validateDisplay(spec.display, errors);
  if ('lights' in spec) {
    if (!Array.isArray(spec.lights)) {
      errors.push(err('/lights', 'lights must be an array.'));
    } else {
      const seenLightNames = new Set();
      spec.lights.forEach((light, i) => validateLight(light, i, seenLightNames, errors));
    }
  }
  if ('objects' in spec) {
    if (!Array.isArray(spec.objects)) {
      errors.push(err('/objects', 'objects must be an array.'));
    } else {
      const seenObjNames = new Set();
      spec.objects.forEach((obj, i) => validateObject(obj, i, seenObjNames, errors));
      validateParents(spec.objects, errors);
    }
  }
  if ('score' in spec) validateScore(spec.score, spec, errors);
  return { ok: errors.length === 0, errors };
}

function resolveVector(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return [v, v, v];
  return [...v];
}

// normalizeSpec validates by default. createStage already validated the spec,
// so it passes { skipValidation: true } to avoid double validation.
export function normalizeSpec(spec, { skipValidation = false } = {}) {
  const { ok, errors } = skipValidation ? { ok: true, errors: [] } : validateSpec(spec);
  if (!ok) {
    const detail = errors.map((e) => `${e.path || '/'}: ${e.message}${e.suggestion ? ` (did you mean "${e.suggestion}"?)` : ''}`).join('\n');
    throw new Error(`Invalid stage spec:\n${detail}`);
  }
  const out = {};
  out.meta = { ...DEFAULTS.meta, size: { ...DEFAULTS.meta.size } };
  if (spec.meta) {
    if ('title' in spec.meta) out.meta.title = spec.meta.title;
    if ('background' in spec.meta) out.meta.background = spec.meta.background;
    if (spec.meta.fog) out.meta.fog = { ...spec.meta.fog };
    if (spec.meta.size) out.meta.size = { ...spec.meta.size };
  }
  out.camera = { ...DEFAULTS.camera, position: [...DEFAULTS.camera.position], lookAt: [...DEFAULTS.camera.lookAt] };
  if (spec.camera) {
    if ('fov' in spec.camera) out.camera.fov = spec.camera.fov;
    if ('position' in spec.camera) out.camera.position = [...spec.camera.position];
    if ('lookAt' in spec.camera) out.camera.lookAt = [...spec.camera.lookAt];
  }
  out.display = { ...DEFAULTS.display };
  if (spec.display) {
    for (const key of Object.keys(DEFAULTS.display)) {
      if (key in spec.display) out.display[key] = spec.display[key];
    }
  }
  out.lights = (spec.lights ?? []).map((light) => {
    const l = {
      name: light.name,
      type: light.type,
      color: light.color ?? DEFAULTS.light.color,
      intensity: light.intensity ?? DEFAULTS.light.intensity,
      position: light.position ? [...light.position] : [...DEFAULTS.light.position],
    };
    if ('target' in light) l.target = [...light.target];
    return l;
  });
  // Score is passed through verbatim (already validated); the compiler owns it.
  if (spec.score) out.score = JSON.parse(JSON.stringify(spec.score));
  out.objects = (spec.objects ?? []).map((obj) => {
    const material = { preset: DEFAULTS.object.material.preset, color: DEFAULTS.object.material.color, opacity: DEFAULTS.object.material.opacity };
    if (obj.material) {
      if ('preset' in obj.material) material.preset = obj.material.preset;
      if ('color' in obj.material) material.color = obj.material.color;
      if ('opacity' in obj.material) material.opacity = obj.material.opacity;
      if ('emissive' in obj.material) material.emissive = obj.material.emissive;
      if ('map' in obj.material) material.map = obj.material.map;
    }
    const o = {
      name: obj.name,
      type: obj.type,
      material,
      position: obj.position ? [...obj.position] : [...DEFAULTS.object.position],
      rotation: obj.rotation ? [...obj.rotation] : [...DEFAULTS.object.rotation],
      // Scale is always normalized to a [x, y, z] vector.
      scale: obj.scale !== undefined ? resolveVector(obj.scale) : [1, 1, 1],
    };
    if ('parent' in obj) o.parent = obj.parent;
    const typeDefaults = OBJECT_TYPES[obj.type]?.params;
    if (typeDefaults || obj.params) {
      const params = {};
      for (const [k, v] of Object.entries(typeDefaults ?? {})) params[k] = obj.params?.[k] ?? v;
      o.params = params;
    }
    return o;
  });
  const svgSpec = spec.svg ?? spec.overlay;
  if (svgSpec) out.svg = normalizeSvg(svgSpec);
  return out;
}

function normalizeShape(shape) {
  const out = {
    id: shape.id,
    type: shape.type,
    stroke: shape.stroke ?? DEFAULTS.svg.shape.stroke,
    fill: shape.fill ?? DEFAULTS.svg.shape.fill,
    strokeWidth: shape.strokeWidth ?? DEFAULTS.svg.shape.strokeWidth,
    opacity: shape.opacity ?? DEFAULTS.svg.shape.opacity,
  };
  if ('class' in shape) out.class = shape.class;
  const typeDefaults = SVG_SHAPE_TYPES[shape.type]?.params;
  const geometry = {};
  for (const [k, v] of Object.entries(typeDefaults ?? {})) geometry[k] = shape[k] ?? v;
  if (Object.keys(geometry).length > 0) out.geometry = geometry;
  if (shape.type === 'group' && Array.isArray(shape.children)) {
    out.children = shape.children.map(normalizeShape);
  }
  return out;
}

function normalizeSvg(svg) {
  const out = { fit: svg.fit ?? DEFAULTS.svg.fit };
  out.text = (svg.text ?? []).map((item) => {
    const d = DEFAULTS.svg.text;
    const t = {
      id: item.id,
      content: item.content,
      split: item.split ?? d.split,
      tag: item.tag ?? d.tag,
      x: item.x ?? d.x,
      y: item.y ?? d.y,
      size: item.size ?? d.size,
      weight: item.weight ?? d.weight,
      family: item.family ?? d.family,
      color: item.color ?? d.color,
      align: item.align ?? d.align,
      opacity: item.opacity ?? d.opacity,
    };
    if ('class' in item) t.class = item.class;
    return t;
  });
  out.shapes = (svg.shapes ?? []).map(normalizeShape);
  return out;
}
