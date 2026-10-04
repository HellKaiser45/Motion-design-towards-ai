/**
 * @module agent-stage/export/compositor
 * Compositor: renders ONE frame of the full experience (WebGL canvas + SVG
 * overlay) into an offscreen 2D canvas. This is the WYSIWYG guarantee — what
 * is exported is exactly what is previewed.
 *
 * WebGL readback: the Stage's renderer is called synchronously
 * (`renderer.render(scene, camera)`) in the same task as the `drawImage`, so
 * the drawing buffer is guaranteed current regardless of
 * `preserveDrawingBuffer` (same-task readback is safe per spec).
 *
 * SVG rasterization: mounted SVGs are serialized (XMLSerializer) to a
 * `data:image/svg+xml` URL, loaded into an Image and drawn at the element's
 * current DOM position/scale mapped onto the export resolution. Because the
 * offline FrameRenderer SEEKS before capture, the DOM state at seek time is
 * the source of truth. WAAPI-computed styles do NOT serialize into markup —
 * the compositor bakes them in per frame (element.getAnimations() +
 * WaapiEngine.snapshotStyles), writing sampled inline styles before
 * serialization and removing them after. Baking is scoped to the SVG being
 * serialized.
 *
 * Identical-markup rasterizations are cached (FNV-1a hash of the markup) so
 * static SVGs cost one encode for the whole export. Failed rasterizations are
 * never cached — they retry on the next frame.
 */

const SKIP_PROPS = new Set(['offset', 'computedOffset', 'easing', 'composite']);
const ENCODE_QUEUE_LIMIT = 8; // max pending image decodes before backpressure

export class Compositor {
  /** @param {{maxCache?:number}} [opts] */
  constructor(opts = {}) {
    this._maxCache = opts.maxCache ?? 96;
    /** @private Map<string, HTMLImageElement> markup-hash -> loaded image */
    this._cache = new Map();
    this._canvas = null;
  }

  /** Persistent export canvas (reused across frames). */
  ensureCanvas(width, height) {
    if (!this._canvas) this._canvas = document.createElement('canvas');
    if (this._canvas.width !== width) this._canvas.width = width;
    if (this._canvas.height !== height) this._canvas.height = height;
    return this._canvas;
  }

  /**
   * Render one full frame. Awaitable (async image decodes).
   * @param {{stage:object, svgLayer:object, width:number, height:number,
   *          background?:string|null, engines?:object}} ctx
   * @returns {Promise<HTMLCanvasElement>}
   */
  async captureFrame(ctx) {
    const base = this._prepare(ctx);
    const { svgLayer } = ctx;
    const waaapi = ctx.engines?.waapi ?? null;

    for (const svg of this._svgRoots(svgLayer)) {
      if (!this._visible(svg)) continue;
      this._bakeWAAPI(svg, waaapi);
      let markup;
      try {
        markup = new XMLSerializer().serializeToString(svg);
      } finally {
        this._unbakeWAAPI(svg, waaapi);
      }
      const hash = fnv1a(markup);
      let img = this._cache.get(hash);
      if (!img) {
        img = await this._rasterize(markup, hash);
      }
      if (img) this._drawSvg(base.c, img, svg, base);
    }
    return base.canvas;
  }

  /**
   * Synchronous variant used by real-time backends (WebmRecorder): draws the
   * WebGL canvas immediately; SVG rasters come from cache — a changed SVG is
   * re-encoded fire-and-forget and appears on a subsequent tick. NO await.
   * @param {object} ctx same shape as captureFrame
   * @returns {HTMLCanvasElement}
   */
  captureFrameSync(ctx) {
    const base = this._prepare(ctx);
    const { svgLayer } = ctx;
    const waaapi = ctx.engines?.waapi ?? null;

    for (const svg of this._svgRoots(svgLayer)) {
      if (!this._visible(svg)) continue;
      // NOTE: sync path does not bake WAAPI styles (bake+serialize+unbake is
      // deterministic but changes DOM during a real-time recording tick; the
      // async cache populated by prior frames/captureFrame calls is used).
      const markup = new XMLSerializer().serializeToString(svg);
      const hash = fnv1a(markup);
      let img = this._cache.get(hash);
      if (!img) {
        // Fire-and-forget: usable on a subsequent tick, never cached on error.
        this._rasterizeAsync(markup, hash);
        img = null;
      }
      if (img) this._drawSvg(base.c, img, svg, base);
    }
    return base.canvas;
  }

  // ---- shared pure layout/mapping helpers ----

  /** @private validate ctx, render WebGL, set up the 2D base layer */
  _prepare(ctx) {
    const { stage, svgLayer, width, height, background } = ctx;
    if (!stage || !svgLayer) {
      throw new Error('[agent-stage.compositor] captureFrame requires { stage, svgLayer }');
    }

    // Force the WebGL frame to be current in THIS task, then draw.
    stage.renderer.render(stage.scene, stage.camera);

    const canvas = this.ensureCanvas(width, height);
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, width, height);

    // Background: null/undefined -> per-pixel alpha stays 0.
    if (background !== null && background !== undefined) {
      c.fillStyle = background;
      c.fillRect(0, 0, width, height);
    }

    const wc = stage.canvas;
    const wrect = wc.getBoundingClientRect();
    const scale = wrect.width > 0 ? width / wrect.width : 1;
    c.imageSmoothingEnabled = true;
    c.drawImage(wc, 0, 0, wrect.width * scale, wrect.height * scale);

    return { canvas, c, width, height, wrect, scale };
  }

  /** @private mounted SVG roots in DOM order */
  _svgRoots(svgLayer) {
    return Array.from(svgLayer._overlay.children).filter((el) => el instanceof SVGSVGElement);
  }

  /** @private visibility test */
  _visible(svg) {
    const r = svg.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && svg.style.opacity !== '0';
  }

  /** @private map an SVG raster onto the export canvas at its DOM position */
  _drawSvg(c, img, svg, base) {
    const r = svg.getBoundingClientRect();
    if (!(img.complete && img.naturalWidth > 0)) return;
    const dx = (r.left - base.wrect.left) * base.scale;
    const dy = (r.top - base.wrect.top) * base.scale;
    c.drawImage(img, dx, dy, r.width * base.scale, r.height * base.scale);
  }

  /**
   * Bake WAAPI-computed styles into inline styles so they serialize.
   * Engine styles are applied ONLY to elements within the SVG currently being
   * serialized (scoped); additionally covers ALL live animations on the svg's
   * own elements via the standard `element.getAnimations()` API.
   * @private
   */
  _bakeWAAPI(svg, waapiEngine) {
    const applied = [];
    if (waapiEngine && typeof waapiEngine.snapshotStyles === 'function') {
      applied.push(...(waapiEngine.snapshotStyles(svg) ?? []));
    }
    for (const el of svg.querySelectorAll('*')) {
      let anims;
      try { anims = el.getAnimations({ subtree: false }); } catch { continue; }
      for (const anim of anims) {
        if (!anim.effect || typeof anim.effect.getKeyframes !== 'function') continue;
        let kfs, progress;
        try {
          kfs = anim.effect.getKeyframes();
          progress = anim.effect.getComputedTiming().progress ?? 0;
        } catch { continue; }
        if (!kfs || kfs.length < 2) continue;
        const props = new Set();
        for (const kf of kfs) {
          for (const k of Object.keys(kf)) if (!SKIP_PROPS.has(k)) props.add(k);
        }
        for (const prop of props) {
          const val = sampleKeyframes(kfs, prop, progress);
          if (val === null || val === undefined) continue;
          applied.push({ el, prop, prev: el.style.getPropertyValue(prop) });
          el.style.setProperty(prop, String(val));
        }
      }
    }
    svg.__asBaked = applied;
  }

  /** @private remove baked inline styles */
  _unbakeWAAPI(svg, waapiEngine) {
    const applied = svg.__asBaked;
    if (!applied) return;
    svg.__asBaked = null;
    for (const entry of applied) {
      if (typeof entry === 'string') {
        waapiEngine?.clearSnapshot?.([entry]);
        continue;
      }
      const { el, prop, prev } = entry;
      if (prev === '') el.style.removeProperty(prop);
      else el.style.setProperty(prop, prev);
    }
  }

  /** @private encode + await one markup rasterization (cached; failures not cached) */
  _rasterize(markup, hash) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this._cachePut(hash, img);
        resolve(img);
      };
      img.onerror = () => resolve(null); // not cached — retried next frame
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    });
  }

  /** @private fire-and-forget rasterization for the sync path */
  _rasterizeAsync(markup, hash) {
    if (this._pending >= ENCODE_QUEUE_LIMIT) return; // backpressure: skip tick
    this._pending = (this._pending ?? 0) + 1;
    const img = new Image();
    const done = () => { this._pending--; };
    img.onload = () => { this._cachePut(hash, img); done(); };
    img.onerror = done; // failure not cached — retried next tick
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  }

  /** @private insert with LRU-ish eviction; never caches failures (null) */
  _cachePut(hash, img) {
    if (!img) return;
    if (this._cache.has(hash)) this._cache.delete(hash);
    while (this._cache.size >= this._maxCache) {
      const first = this._cache.keys().next().value;
      this._cache.delete(first);
    }
    this._cache.set(hash, img);
  }

  /** Drop the raster cache (e.g. after resolution changes). */
  clearCache() {
    this._cache.clear();
  }
}

/** FNV-1a 32-bit string hash -> hex string (cache key). */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Sample one CSS property across WAAPI keyframes at progress p.
 * Numeric values lerp; strings take the nearest keyframe at/before p.
 * @private
 */
function sampleKeyframes(kfs, prop, p) {
  const vals = kfs.filter((kf) => kf[prop] !== undefined && kf[prop] !== null && kf[prop] !== '');
  if (!vals.length) return null;
  const num = vals.filter((kf) => typeof kf[prop] === 'number');
  if (num.length === vals.length && num.length >= 2) {
    if (p <= num[0].offset) return num[0][prop];
    if (p >= num[num.length - 1].offset) return num[num.length - 1][prop];
    let i = 0;
    while (i < num.length - 1 && num[i + 1].offset <= p) i++;
    const a = num[i];
    const b = num[Math.min(i + 1, num.length - 1)];
    const span = b.offset - a.offset || 1;
    return a[prop] + (b[prop] - a[prop]) * ((p - a.offset) / span);
  }
  let best = vals[0];
  for (const kf of vals) if (kf.offset <= p) best = kf;
  return best[prop];
}
