/**
 * @module agent-stage/core/events
 * Tiny synchronous event emitter used across Agent Stage (Stage, Timeline, engines).
 * No dependencies.
 */

/** @returns {Record<string, Function[]>} */
function blankMap() {
  return Object.create(null);
}

export class EventEmitter {
  constructor() {
    /** @private */
    this._handlers = blankMap();
    this._once = new WeakMap();
  }

  /**
   * Subscribe to an event.
   * @param {string} name
   * @param {Function} fn
   * @returns {Function} unsubscribe
   */
  on(name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') {
      throw new TypeError('[agent-stage.events] on(name, fn) requires a string name and function');
    }
    (this._handlers[name] ||= []).push(fn);
    return () => this.off(name, fn);
  }

  /**
   * Subscribe for a single invocation.
   * @param {string} name
   * @param {Function} fn
   */
  once(name, fn) {
    const wrapped = (payload) => {
      this.off(name, wrapped);
      fn(payload);
    };
    this._once.set(fn, wrapped);
    this.on(name, wrapped);
  }

  /** @param {string} name @param {Function} fn */
  off(name, fn) {
    const list = this._handlers[name];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) delete this._handlers[name];
  }

  /**
   * Emit synchronously. Listener errors are not swallowed — rethrow policy is caller's.
   * @param {string} name
   * @param {*} [payload]
   */
  emit(name, payload) {
    const list = this._handlers[name];
    if (!list || !list.length) return;
    for (const fn of list.slice()) fn(payload);
  }
}

/** Convenience mixin-ish emitter instance factory (single shared instance per caller). */
export function createEmitter() {
  return new EventEmitter();
}
