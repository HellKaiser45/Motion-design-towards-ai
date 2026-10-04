/**
 * @module agent-stage/bridges/texture-bridge
 * Live SVG → offscreen canvas → THREE.CanvasTexture on a 3D surface.
 * Rasterizes the MOUNTED svg element's markup via `new Image()` + a
 * data:image/svg+xml URL (works for markup strings, no URL-loaded docs needed),
 * drawn to a 2D canvas at a configurable resolution, assigned to the target's
 * material map (replacing the material with a MeshBasicMaterial by default).
 *
 * Dirty optimization: a MutationObserver (attributes + childList + subtree +
 * characterData, debounced per frame) catches CSS/WAAPI-driven changes and a
 * SMIL `getCurrentTime()` change check catches SMIL animation. Rasterization
 * additionally runs at a configurable `fps` floor (default 30) so always-live
 * content (CSS keyframe loops inside SVG-as-image) still refreshes. Frames are
 * skipped while a previous image is still loading to avoid tearing.
 */

export class TextureBridge {
  /** @param {{stage:object, svgLayer:object, three:object}} deps
   *  `three` is the three module namespace (for CanvasTexture, SRGBColorSpace, MeshBasicMaterial). */
  constructor({ stage, svgLayer, three }) {
    if (!stage || !svgLayer || !three) {
      throw new Error('[agent-stage.textureBridge] requires { stage, svgLayer, three }');
    }
    this._stage = stage;
    this._svgLayer = svgLayer;
    this._three = three;
    /** @private Map<object3d, entry> */
    this._binds = new Map();
    this._onTick = () => this._tick();
    stage.on('tick', this._onTick);
  }

  /**
   * Bind a mounted SVG as a live texture on a target mesh.
   * @param {string} svgName mounted SVG name
   * @param {object} target THREE.Object3D with material (Mesh or similar)
   * @param {{width?:number, height?:number, fps?:number, materialIndex?:number,
   *          keepMaterial?:boolean}} [opts]
   *        width/height: canvas raster resolution (default 512 x aspect)
   *        fps: minimum refresh rate; 0 = only on dirty (default 30)
   *        materialIndex: for multi-material meshes, which slot to update
   *        keepMaterial: set .map on the existing material instead of replacing
   */
  bind(svgName, target, opts = {}) {
    const svg = this._svgLayer.get(svgName);
    if (!svg) throw new Error(`[agent-stage.textureBridge] unknown svg "${svgName}"`);
    if (!target) throw new Error('[agent-stage.textureBridge] bind() requires a target Object3D');
    if (this._binds.has(target)) this.unbind(target);

    const vw = svg.viewBox?.baseVal?.width || 200;
    const vh = svg.viewBox?.baseVal?.height || 200;
    const width = opts.width ?? 512;
    const height = opts.height ?? (Math.round(width * (vh / vw)) || 512);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const c2d = canvas.getContext('2d');

    const { CanvasTexture, SRGBColorSpace } = this._three;
    const texture = new CanvasTexture(canvas);
    if (SRGBColorSpace !== undefined) texture.colorSpace = SRGBColorSpace;

    const originalMaterial = target.material;
    this._assignMaterial(target, texture, opts);

    const entry = {
      svg, target, canvas, c2d, texture,
      originalMaterial,
      fps: opts.fps ?? 30,
      lastDraw: 0,
      lastSmilTime: -1,
      dirty: true,
      pending: false,
      observer: new MutationObserver(() => { entry.dirty = true; }),
    };
    entry.observer.observe(svg, {
      attributes: true, childList: true, subtree: true, characterData: true,
    });
    this._binds.set(target, entry);
    return this;
  }

  /** @param {object} target THREE.Object3D previously bound */
  unbind(target) {
    const entry = this._binds.get(target);
    if (!entry) return false;
    entry.observer.disconnect();
    entry.texture.dispose();
    if (entry.originalMaterial != null) {
      // restore the material that was in place before bind()
      target.material = entry.originalMaterial;
    }
    this._binds.delete(target);
    return true;
  }

  /** @private material assignment rules */
  _assignMaterial(target, texture, opts) {
    const { MeshBasicMaterial } = this._three;
    const mat = target.material;
    if (Array.isArray(mat)) {
      const i = opts.materialIndex ?? 0;
      if (!mat[i]) mat[i] = new MeshBasicMaterial({ map: texture });
      else mat[i].map = texture;
      mat[i].needsUpdate = true;
      return;
    }
    if (opts.keepMaterial && mat) {
      mat.map = texture;
      mat.needsUpdate = true;
      return;
    }
    target.material = new MeshBasicMaterial({ map: texture, transparent: true });
  }

  /** @private called every stage tick */
  _tick() {
    if (!this._binds.size) return;
    const now = performance.now();
    for (const entry of this._binds.values()) {
      const smilT = entry.svg.getCurrentTime ? entry.svg.getCurrentTime() : 0;
      const smilDirty = smilT !== entry.lastSmilTime;
      entry.lastSmilTime = smilT;

      const due = entry.fps > 0 && now - entry.lastDraw >= 1000 / entry.fps;
      if (!entry.dirty && !smilDirty && !due) continue;
      if (entry.pending) continue; // skip frames while an image is loading
      this._rasterize(entry, now);
    }
  }

  /** @private queue one rasterization pass (async image load, no tearing) */
  _rasterize(entry, now) {
    entry.dirty = false;
    entry.lastDraw = now;
    entry.pending = true;

    // Serialize the live mounted SVG (markup string — no URL loading needed).
    const markup = new XMLSerializer().serializeToString(entry.svg);
    const img = new Image();
    const done = () => { entry.pending = false; };
    img.onload = () => {
      try {
        entry.c2d.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
        entry.c2d.drawImage(img, 0, 0, entry.canvas.width, entry.canvas.height);
        entry.texture.needsUpdate = true;
      } finally { done(); }
    };
    img.onerror = () => {
      // transient decode failure must not stick as a blank texture — retry
      entry.dirty = true;
      done();
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  }

  dispose() {
    this._stage.off('tick', this._onTick);
    for (const target of [...this._binds.keys()]) this.unbind(target);
  }
}
