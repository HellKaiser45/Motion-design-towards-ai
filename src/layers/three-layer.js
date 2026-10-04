/**
 * @module agent-stage/layers/three-layer
 * Named object registry for the 3D side + path resolution for PropEngine targets.
 * Paths: "body", "body.rotation", "head.position:y", "screen.material.color:r".
 */

export class ThreeLayer {
  constructor() {
    /** @private @type {Map<string, import('three').Object3D>} */
    this._objects = new Map();
  }

  /**
   * @param {string} name
   * @param {import('three').Object3D} object3d
   * @returns {import('three').Object3D}
   */
  add(name, object3d) {
    if (typeof name !== 'string' || !name) {
      throw new TypeError('[agent-stage.threeLayer] add() requires a non-empty name');
    }
    if (!object3d) {
      throw new TypeError('[agent-stage.threeLayer] add() requires a THREE.Object3D');
    }
    this._objects.set(name, object3d);
    return object3d;
  }

  /** @param {string} name @returns {import('three').Object3D|undefined} */
  get(name) {
    return this._objects.get(name);
  }

  /** @param {string} name */
  remove(name) {
    this._objects.delete(name);
  }

  /** @returns {string[]} */
  list() {
    return [...this._objects.keys()];
  }

  /**
   * Resolve a dot/colon path into { object, prop, channel }.
   *   "body"                    -> { object, prop:null }
   *   "body.rotation"           -> { object, prop:'rotation' }
   *   "head.position:y"         -> { object, prop:'position', channel:'y' }
   *   "screen.material.color:r" -> { object, prop:'material.color', channel:'r' }
   * @param {string} path
   */
  resolve(path) {
    if (typeof path !== 'string' || !path) {
      throw new Error('[agent-stage.threeLayer] resolve() requires a non-empty path');
    }
    const [base, channel] = path.split(':');
    const parts = base.split('.');
    const name = parts[0];
    const object = this._objects.get(name);
    if (!object) {
      throw new Error(
        `[agent-stage.threeLayer] unknown object name "${name}" in path "${path}". ` +
        `Registered: [${this.list().join(', ')}]`
      );
    }
    const prop = parts.length > 1 ? parts.slice(1).join('.') : null;
    return { object, prop, channel: channel ?? null };
  }
}
