import { BRIDGE_PROPS } from '../spec/schema.js';

/**
 * Bridge: DOM-style animation handles for three.js objects.
 *
 * `bridge.object(name)` returns a proxy whose properties (x, y, z, rotateX/Y/Z,
 * scale, scaleX/Y/Z, opacity) are accessors that read and write the live
 * Object3D directly. GSAP tweens the proxy like any plain object, so there is
 * no copy step and no second render loop: the scene is always exactly what the
 * single stage timeline says at the current time, which keeps seek(t) pure.
 */

function materialsOf(node) {
  const m = node.material;
  if (!m) return [];
  return Array.isArray(m) ? m : [m];
}

// name -> [get(node), set(node, value)]. Keys must equal BRIDGE_PROPS keys
// (enforced by tests/bridge.test.mjs).
const ACCESSORS = {
  x: [(n) => n.position.x, (n, v) => { n.position.x = v; }],
  y: [(n) => n.position.y, (n, v) => { n.position.y = v; }],
  z: [(n) => n.position.z, (n, v) => { n.position.z = v; }],
  rotateX: [(n) => n.rotation.x, (n, v) => { n.rotation.x = v; }],
  rotateY: [(n) => n.rotation.y, (n, v) => { n.rotation.y = v; }],
  rotateZ: [(n) => n.rotation.z, (n, v) => { n.rotation.z = v; }],
  scale: [(n) => n.scale.x, (n, v) => { n.scale.set(v, v, v); }],
  scaleX: [(n) => n.scale.x, (n, v) => { n.scale.x = v; }],
  scaleY: [(n) => n.scale.y, (n, v) => { n.scale.y = v; }],
  scaleZ: [(n) => n.scale.z, (n, v) => { n.scale.z = v; }],
  opacity: [
    (n) => {
      const [m] = materialsOf(n);
      return m ? m.opacity : 1;
    },
    (n, v) => {
      for (const m of materialsOf(n)) {
        // Same rule as the `fade` verb: opacity only shows when transparent.
        m.transparent = true;
        m.opacity = v;
      }
    },
  ],
};

function makeProxy(node) {
  const proxy = {};
  for (const [name, [get, set]] of Object.entries(ACCESSORS)) {
    Object.defineProperty(proxy, name, {
      enumerable: true,
      configurable: true,
      get: () => get(node),
      set: (v) => set(node, v),
    });
  }
  return proxy;
}

/**
 * @param {{ objects: Map, lights: Map, camera: object, scene: object }} ctx
 *   Name registries the bridge resolves against (same order as the score
 *   compiler: objects, lights, then reserved `camera` / `scene`).
 */
export function createBridge(ctx) {
  const { objects, lights, camera, scene } = ctx;
  let proxies = new WeakMap();
  let disposed = false;

  function names() {
    return [...objects.keys(), ...lights.keys(), 'camera', 'scene'];
  }

  function resolve(ref) {
    if (typeof ref !== 'string') {
      if (ref && typeof ref === 'object' && ref.isObject3D) return ref;
      throw new Error('bridge target must be a registered name or a THREE.Object3D.');
    }
    if (objects.has(ref)) return objects.get(ref);
    if (lights.has(ref)) return lights.get(ref);
    if (ref === 'camera') return camera;
    if (ref === 'scene') return scene;
    throw new Error(`Unknown bridge target "${ref}". Known targets: ${names().join(', ')}.`);
  }

  /** Stable proxy for a name or Object3D (same reference every call). */
  function object(ref) {
    if (disposed) throw new Error('bridge is disposed.');
    const node = resolve(ref);
    let proxy = proxies.get(node);
    if (!proxy) {
      proxy = makeProxy(node);
      proxies.set(node, proxy);
    }
    return proxy;
  }

  /** Plain JSON snapshot of every bridge property of a target. */
  function snapshot(ref) {
    const proxy = object(ref);
    const out = {};
    for (const name of Object.keys(ACCESSORS)) out[name] = proxy[name];
    return out;
  }

  // ---- channels: named scalars bound to anything (shader uniform, morph
  // influence, a custom getter/setter). Same accessor idea as object(): the
  // proxy has one property, `value`, that reads/writes the live target.
  const channelMap = new Map();

  function bindPath(id, binding) {
    const root = typeof binding.target === 'string' ? resolve(binding.target) : binding.target;
    if (root === null || typeof root !== 'object') {
      throw new Error(`Channel "${id}": target must be a registered name or an object.`);
    }
    const segments = String(binding.path).split('.');
    const last = segments.pop();
    let parent = root;
    for (const seg of segments) parent = parent?.[seg];
    if (parent === null || typeof parent !== 'object' || !(last in parent)) {
      throw new Error(`Channel "${id}": path "${binding.path}" does not resolve on the target.`);
    }
    // The container is captured at bind time; replacing it later (e.g.
    // assigning a new `uniforms` object) detaches the channel.
    return { get: () => parent[last], set: (v) => { parent[last] = v; } };
  }

  /**
   * channel(id, { target, path })  — bind to a dotted path on a registered
   *   name or an object, e.g. { target: 'hero', path: 'material.uniforms.uProgress.value' }
   *   or { target: mesh, path: 'morphTargetInfluences.0' }.
   * channel(id, { get, set })      — bind to arbitrary functions.
   * channel(id)                    — fetch an existing channel.
   * Returns `{ value }`, tweenable by GSAP on stage.timeline.
   */
  function channel(id, binding) {
    if (disposed) throw new Error('bridge is disposed.');
    if (typeof id !== 'string' || id === '') throw new Error('channel id must be a non-empty string.');
    if (binding === undefined) {
      const existing = channelMap.get(id);
      if (!existing) {
        throw new Error(`Unknown channel "${id}". Known channels: ${[...channelMap.keys()].join(', ') || '(none)'}.`);
      }
      return existing;
    }
    if (channelMap.has(id)) throw new Error(`Channel "${id}" already exists.`);
    let accessors;
    if (binding && typeof binding.get === 'function' && typeof binding.set === 'function') {
      accessors = { get: binding.get, set: binding.set };
    } else if (binding && binding.target !== undefined && typeof binding.path === 'string' && binding.path !== '') {
      accessors = bindPath(id, binding);
    } else {
      throw new Error(`Channel "${id}": binding must be { target, path } or { get, set }.`);
    }
    const proxy = {};
    Object.defineProperty(proxy, 'value', {
      enumerable: true,
      configurable: true,
      get: accessors.get,
      set: accessors.set,
    });
    channelMap.set(id, proxy);
    return proxy;
  }

  /** Plain JSON map of channel id -> current value. */
  function channelValues() {
    const out = {};
    for (const [id, proxy] of channelMap) out[id] = proxy.value;
    return out;
  }

  function dispose() {
    disposed = true;
    proxies = new WeakMap();
    channelMap.clear();
  }

  return { object, snapshot, channel, channelValues, props: Object.keys(BRIDGE_PROPS), dispose };
}
