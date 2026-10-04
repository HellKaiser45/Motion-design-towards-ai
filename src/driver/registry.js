/**
 * @module agent-stage/driver/registry
 * Registry: named assets (svg markup / three objects) and named animation
 * packs. Names decouple packs from files — a pack says `"svg": "face"`,
 * `"target": "body"` and the registry resolves those logical names at
 * compile time, so assets/packs are swappable without code changes.
 *
 * Assets are stored, not mounted, until instantiate(); packs are stored until
 * compileAll() (or lazily compiled on first getPack()).
 */

export class Registry {
  /** @param {{svgLayer?:object, threeLayer?:object}} [layers] */
  constructor({ svgLayer, threeLayer } = {}) {
    this.svgLayer = svgLayer;
    this.threeLayer = threeLayer;
    /** @private Map<string, {kind:'svg'|'three', source:string|Function|object}> */
    this._assets = new Map();
    /** @private Map<string, {kind:'obj'|'url', value:object|string}> */
    this._packs = new Map();
    /** @private Map<string, Promise<CompiledPack>|CompiledPack> */
    this._compiled = new Map();
    /** @private Map<string, {three?:string}|{svg:string, selector:string}> */
    this._targets = new Map();
    this._instantiated = false;
  }

  // ---- assets ----

  /**
   * Register an asset under a logical name. Stored only — call instantiate().
   * @param {'svg'|'three'} kind
   * @param {string} name
   * @param {string|Function|object} source svg: markup string or URL;
   *        three: factory `(threeLayer) => Object3D` or an Object3D
   */
  registerAsset(kind, name, source) {
    if (kind !== 'svg' && kind !== 'three') {
      throw new Error(`[agent-stage.registry] registerAsset kind must be "svg" or "three", got "${kind}"`);
    }
    if (typeof name !== 'string' || !name) {
      throw new Error('[agent-stage.registry] registerAsset requires a non-empty name');
    }
    if (!source) {
      throw new Error(`[agent-stage.registry] asset "${name}" requires a source`);
    }
    this._assets.set(name, { kind, source });
    return this;
  }

  /** @param {string} name @returns {{kind:string, source:any}|undefined} */
  getAsset(name) {
    return this._assets.get(name);
  }

  /** @returns {string[]} registered asset names */
  listAssets() {
    return [...this._assets.keys()];
  }

  // ---- semantic targets ----

  /**
   * Register a semantic target: a logical name an engine-less pack track can
   * reference. Bindings are `{ three: 'objectName' }` (a ThreeLayer name) or
   * `{ svg: 'svgName', selector: '#sel' }` (mounted SVG + CSS selector).
   * @param {string} name e.g. 'body' or 'face.smile' (dots allowed; longest-prefix match applies)
   * @param {{three?:string, svg?:string, selector?:string}} binding
   */
  registerTarget(name, binding) {
    if (typeof name !== 'string' || !name) {
      throw new Error('[agent-stage.registry] registerTarget requires a non-empty name');
    }
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      throw new Error(`[agent-stage.registry] target "${name}" binding must be an object ({ three } or { svg, selector })`);
    }
    const keys = Object.keys(binding);
    if (keys.length === 0) {
      throw new Error(`[agent-stage.registry] target "${name}" binding must not be empty`);
    }
    if (binding.three !== undefined) {
      if (typeof binding.three !== 'string' || !binding.three) {
        throw new Error(`[agent-stage.registry] target "${name}" binding.three must be a non-empty string`);
      }
      if (keys.some((k) => k !== 'three')) {
        throw new Error(`[agent-stage.registry] target "${name}" binding with "three" must not also declare svg/selector`);
      }
    } else if (binding.svg !== undefined || binding.selector !== undefined) {
      if (typeof binding.svg !== 'string' || !binding.svg || typeof binding.selector !== 'string' || !binding.selector) {
        throw new Error(`[agent-stage.registry] target "${name}" svg binding must be { svg: string, selector: string }`);
      }
      if (keys.some((k) => k !== 'svg' && k !== 'selector')) {
        throw new Error(`[agent-stage.registry] target "${name}" binding has unknown keys ${keys.join(', ')}`);
      }
    } else {
      throw new Error(`[agent-stage.registry] target "${name}" binding must be { three } or { svg, selector }`);
    }
    this._targets.set(name, { ...binding });
    return this;
  }

  /** @param {Record<string, {three?:string}|{svg?:string, selector?:string}>} map */
  registerTargets(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      throw new Error('[agent-stage.registry] registerTargets requires a map object of name -> binding');
    }
    for (const [name, binding] of Object.entries(map)) this.registerTarget(name, binding);
    return this;
  }

  /**
   * Resolve a semantic target name to a binding. Exact match first, then the
   * longest dot-prefix match: 'body.position.y' resolves binding 'body' with
   * rest 'position.y'; 'face.smile' exact-matches a binding 'face.smile'.
   * @param {string} name
   * @returns {{binding:object, rest:string}|null} rest is the unmatched remainder ('' on exact match)
   */
  resolveTarget(name) {
    if (typeof name !== 'string' || !name) return null;
    const exact = this._targets.get(name);
    if (exact) return { binding: exact, rest: '' };
    const parts = name.split('.');
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join('.');
      const b = this._targets.get(prefix);
      if (b) return { binding: b, rest: parts.slice(i).join('.') };
    }
    return null;
  }

  /** @returns {string[]} registered target names */
  listTargets() {
    return [...this._targets.keys()];
  }

  // ---- packs ----

  /**
   * Register one pack: an object or a URL string (fetched + parsed lazily).
   * @param {object|string} packOrUrl
   */
  registerPack(packOrUrl) {
    if (typeof packOrUrl === 'string') {
      this._packs.set(urlName(packOrUrl), { kind: 'url', value: packOrUrl });
      return this;
    }
    if (!packOrUrl || typeof packOrUrl.name !== 'string' || !packOrUrl.name) {
      throw new Error('[agent-stage.registry] registerPack requires an object with a name (or a URL string)');
    }
    this._packs.set(packOrUrl.name, { kind: 'obj', value: packOrUrl });
    this._compiled.delete(packOrUrl.name);
    return this;
  }

  /** @param {Array<object|string>} list */
  registerPacks(list) {
    for (const p of list) this.registerPack(p);
    return this;
  }

  /** @param {string} name @returns {boolean} */
  hasPack(name) {
    return this._packs.has(name);
  }

  /** @returns {string[]} registered pack names */
  listPacks() {
    return [...this._packs.keys()];
  }

  /**
   * Mount registered SVG assets into the SvgLayer and build + register three
   * objects into the ThreeLayer (and the stage scene, if not parented).
   * @param {{scene?:object, svgLayer?:object, threeLayer?:object}} stage aggregate or stage
   */
  async instantiate(stage) {
    const svgLayer = this.svgLayer ?? stage?.svgLayer;
    const threeLayer = this.threeLayer ?? stage?.threeLayer;
    if (!svgLayer || !threeLayer) {
      throw new Error('[agent-stage.registry] instantiate() needs svgLayer + threeLayer (constructor or stage aggregate)');
    }
    this.svgLayer = svgLayer;
    this.threeLayer = threeLayer;

    for (const [name, entry] of this._assets) {
      if (entry.kind === 'svg') {
        await svgLayer.mount(name, entry.source);
      } else {
        const obj = typeof entry.source === 'function' ? entry.source(threeLayer) : entry.source;
        if (!obj) throw new Error(`[agent-stage.registry] three asset "${name}" factory returned nothing`);
        threeLayer.add(name, obj);
        const scene = stage?.scene;
        if (scene && !obj.parent) scene.add(obj);
      }
    }
    this._instantiated = true;
    return this;
  }

  /**
   * Compile every registered pack against ctx. URL packs are fetched first.
   * @param {{threeLayer:object, svgLayer:object, propEngine:object,
   *          waapiEngine:object, smilEngine:object}} ctx
   * @returns {Promise<Map<string, CompiledPack>>}
   */
  async compileAll(ctx) {
    for (const [name, entry] of this._packs) {
      if (this._compiled.has(name)) continue;
      if (entry.kind === 'url') {
        const p = (async () => {
          const res = await fetch(entry.value);
          if (!res.ok) throw new Error(`[agent-stage.registry] failed to fetch pack ${entry.value}: ${res.status}`);
          const json = await res.json();
          if (!json || typeof json.name !== 'string') {
            throw new Error(`[agent-stage.registry] pack at ${entry.value} has no "name"`);
          }
          // Re-key by json.name — URL-derived names are placeholders only;
          // getPack() and recompile checks must use the pack's real name.
          const compiled = compilePack(json, ctx, json.name);
          this._packs.delete(name);
          this._packs.set(json.name, { kind: 'obj', value: json });
          this._compiled.set(json.name, compiled);
          return compiled;
        })();
        // A rejected fetch must not wedge the registry: drop the failed
        // promise entry so a retry (fresh registerPack or next compileAll)
        // is possible. The rejection still propagates to Promise.all below.
        p.catch(() => { this._compiled.delete(name); });
        this._compiled.set(name, p);
      } else {
        this._compiled.set(name, compilePack(entry.value, ctx, name));
      }
    }
    await Promise.all([...this._compiled.values()].map((p) => (p instanceof Promise ? p : null)));
    // Drop resolved placeholder promise entries (url keys) — real compiled
    // packs live under their json.name.
    for (const [k, v] of this._compiled) {
      if (v instanceof Promise) this._compiled.delete(k);
    }
    return this._compiled;
  }

  /**
   * Get a compiled pack by name. Synchronous if compiled (or object-pack with
   * ctx cached); URL packs must have gone through compileAll() first.
   * @param {string} name
   * @returns {CompiledPack}
   */
  getPack(name) {
    const entry = this._packs.get(name);
    if (!entry) throw new Error(`[agent-stage.registry] unknown pack "${name}"`);
    const compiled = this._compiled.get(name);
    if (compiled instanceof Promise) {
      throw new Error(`[agent-stage.registry] pack "${name}" is still loading — await compileAll(ctx) first`);
    }
    if (compiled) return compiled;
    if (entry.kind === 'obj' && this._ctx) {
      const c = compilePack(entry.value, this._ctx, name);
      this._compiled.set(name, c);
      return c;
    }
    throw new Error(`[agent-stage.registry] pack "${name}" is not compiled yet — call compileAll(ctx) first`);
  }

  /** Cache a compile context so getPack() can compile object packs lazily. */
  setContext(ctx) {
    this._ctx = ctx;
  }
}

import { compile } from './pack-compiler.js';

/** @private */
function compilePack(json, ctx, fallbackName) {
  if (!json.name) json.name = fallbackName;
  return compile(json, ctx);
}

/** @private derive a name from a pack URL (basename without extension) */
function urlName(url) {
  const base = url.split('/').pop() || 'pack';
  return base.replace(/\.(json|pack\.json)$/i, '');
}
