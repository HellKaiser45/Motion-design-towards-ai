import {
  BACKGROUND_PRESETS,
  LIGHT_TYPES,
  MATERIAL_PRESETS,
  OBJECT_TYPES,
  DEFAULTS,
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

function err(path, message, suggestion) {
  const e = { path, message };
  if (suggestion !== undefined && suggestion !== null) e.suggestion = suggestion;
  return e;
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
      errors.push(
        err(`${base}/${key}`, `Unknown key "${key}". Allowed keys: ${allowed.join(', ')}.`, suggest(key, allowed))
      );
    }
  }
}

function validateNumber(v, path, errors, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push(err(path, `${what} must be a finite number.`));
  }
}

function validateMeta(meta, errors) {
  const path = '/meta';
  if (!isPlainObject(meta)) {
    errors.push(err(path, 'meta must be an object.'));
    return;
  }
  checkUnknownKeys(meta, ['title', 'background', 'fog', 'size'], path, errors);
  if ('title' in meta && typeof meta.title !== 'string') {
    errors.push(err(`${path}/title`, 'meta.title must be a string.'));
  }
  if ('background' in meta) {
    const bg = meta.background;
    if (typeof bg === 'string' && (Object.hasOwn(BACKGROUND_PRESETS, bg) || isColor(bg))) {
      // ok
    } else {
      errors.push(
        err(
          `${path}/background`,
          `Unknown background value. Use '#rrggbb' or one of: ${Object.keys(BACKGROUND_PRESETS).join(', ')}.`,
          suggest(bg, [...Object.keys(BACKGROUND_PRESETS)])
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
      checkUnknownKeys(size, ['width', 'height'], path, errors);
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
      errors.push(err(`${path}/fov`, 'camera.fov must be a finite number between 1 and 179.'));
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
        errors.push(
          err(
            `${path}/${key}`,
            `display.${key} must be one of: ${enums[key].join(', ')}.`,
            suggest(v, enums[key])
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
    errors.push(
      err(`${path}/type`, `Unknown light type "${light.type}". Valid types: ${LIGHT_TYPES.join(', ')}.`, suggest(light.type, LIGHT_TYPES))
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

function validateMaterial(material, path, errors, objType) {
  if (!isPlainObject(material)) {
    errors.push(err(path, 'material must be an object.'));
    return;
  }
  const allowed = ['preset', 'color', 'opacity', 'emissive'];
  checkUnknownKeys(material, allowed, path, errors);
  if ('preset' in material) {
    if (!MATERIAL_PRESETS.includes(material.preset)) {
      errors.push(
        err(`${path}/preset`, `Unknown material preset "${material.preset}". Valid presets: ${MATERIAL_PRESETS.join(', ')}.`, suggest(material.preset, MATERIAL_PRESETS))
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
      errors.push(err(`${path}/opacity`, 'material.opacity must be a number between 0 and 1.'));
    }
  }
  if ('emissive' in material) {
    if (preset !== 'neon') {
      errors.push(err(`${path}/emissive`, 'material.emissive is only valid for the neon material preset.'));
    } else if (!isColor(material.emissive)) {
      errors.push(err(`${path}/emissive`, 'material.emissive must match #rrggbb.'));
    }
  }
}

function validateObject(obj, index, seenNames, errors) {
  const path = `/objects/${index}`;
  if (!isPlainObject(obj)) {
    errors.push(err(path, 'each object must be an object.'));
    return;
  }
  const allowed = ['name', 'type', 'material', 'position', 'rotation', 'scale', 'params'];
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
    errors.push(
      err(`${path}/type`, `Unknown object type "${obj.type}". Valid types: ${Object.keys(OBJECT_TYPES).join(', ')}.`, suggest(obj.type, Object.keys(OBJECT_TYPES)))
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
          errors.push(
            err(`${path}/params/${key}`, `Unknown param "${key}" for object type "${objType}". Valid params: ${paramKeys.join(', ')}.`, suggest(key, paramKeys))
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
  const allowedTop = ['meta', 'camera', 'display', 'lights', 'objects'];
  checkUnknownKeys(spec, allowedTop, '/', errors);
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
    }
  }
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
  out.objects = (spec.objects ?? []).map((obj) => {
    const material = { preset: DEFAULTS.object.material.preset, color: DEFAULTS.object.material.color, opacity: DEFAULTS.object.material.opacity };
    if (obj.material) {
      if ('preset' in obj.material) material.preset = obj.material.preset;
      if ('color' in obj.material) material.color = obj.material.color;
      if ('opacity' in obj.material) material.opacity = obj.material.opacity;
      if ('emissive' in obj.material) material.emissive = obj.material.emissive;
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
    const typeDefaults = OBJECT_TYPES[obj.type]?.params;
    if (typeDefaults || obj.params) {
      const params = {};
      for (const [k, v] of Object.entries(typeDefaults ?? {})) params[k] = obj.params?.[k] ?? v;
      o.params = params;
    }
    return o;
  });
  return out;
}
