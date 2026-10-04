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

  function dispose() {
    disposed = true;
    proxies = new WeakMap();
  }

  return { object, snapshot, props: Object.keys(BRIDGE_PROPS), dispose };
}
