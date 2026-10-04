/**
 * @module agent-stage/layers/svg-layer
 * Mounts SVG assets into the Stage's #as-svg-overlay and provides per-SVG
 * SMIL document-clock control (pause/resume/seekTo) plus time readback.
 * Mounted SVG ids are namespaced `as-svg-<name>` so pack selectors can scope.
 */

export class SvgLayer {
  /** @param {Element} svgOverlay the Stage's overlay div */
  constructor(svgOverlay) {
    if (!svgOverlay) {
      throw new Error('[agent-stage.svgLayer] SvgLayer requires the stage overlay element');
    }
    this._overlay = svgOverlay;
    /** @private @type {Map<string, SVGSVGElement>} */
    this._svgs = new Map();
  }

  /**
   * Mount an SVG. Accepts raw SVG markup string (primary) or a URL (fetched async).
   * @param {string} name
   * @param {string} svgStringOrUrl
   * @param {{x?:number, y?:number, width?:number, height?:number,
   *          anchor?:'center'|'topleft'}} [opts]
   * @returns {Promise<SVGSVGElement>|SVGSVGElement}
   */
  mount(name, svgStringOrUrl, opts = {}) {
    if (typeof name !== 'string' || !name) {
      throw new TypeError('[agent-stage.svgLayer] mount() requires a non-empty name');
    }
    if (typeof svgStringOrUrl !== 'string') {
      throw new TypeError('[agent-stage.svgLayer] mount() requires an SVG string or URL');
    }
    const isUrl = /^(https?:)?\/\//.test(svgStringOrUrl) || svgStringOrUrl.startsWith('./') ||
      svgStringOrUrl.startsWith('/');
    if (isUrl) {
      return fetch(svgStringOrUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`[agent-stage.svgLayer] failed to fetch ${svgStringOrUrl}: ${res.status}`);
          return res.text();
        })
        .then((text) => this._mountMarkup(name, text, opts));
    }
    return this._mountMarkup(name, svgStringOrUrl, opts);
  }

  /** @private */
  _mountMarkup(name, markup, opts) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(markup, 'image/svg+xml');
    const svg = doc.documentElement;
    // Failed XML parses surface as a <parsererror> root (Firefox) or an
    // <html> root wrapping <parsererror> (Chrome); partially-valid markup can
    // nest <parsererror> inside the svg root (Firefox). Catch all three and
    // surface the parser's own message instead of a generic "not valid".
    const errEl = (svg && svg.nodeName === 'parsererror' ? svg : null)
      || doc.querySelector('parsererror')
      || (svg && svg.nodeName === 'svg' ? svg.querySelector('parsererror') : null);
    if (!svg || svg.nodeName !== 'svg' || errEl) {
      const detail = errEl ? (errEl.textContent || '').trim().split('\n')[0] : 'no <svg> root element';
      throw new Error(`[agent-stage.svgLayer] "${name}" is not valid SVG markup — ${detail}`);
    }
    svg.id = `as-svg-${name}`;
    svg.style.position = 'absolute';

    const x = opts.x ?? 0;
    const y = opts.y ?? 0;
    const w = opts.width ?? (svg.viewBox?.baseVal?.width || svg.width?.baseVal?.value || 100);
    const h = opts.height ?? (svg.viewBox?.baseVal?.height || svg.height?.baseVal?.value || 100);
    svg.style.width = `${w}px`;
    svg.style.height = `${h}px`;
    if (opts.anchor === 'center') {
      svg.style.left = `calc(${x}px - ${w / 2}px)`;
      svg.style.top = `calc(${y}px - ${h / 2}px)`;
    } else {
      svg.style.left = `${x}px`;
      svg.style.top = `${y}px`;
    }

    // replace existing mount of same name
    const existing = this._svgs.get(name);
    if (existing) this.unmount(name);

    this._overlay.appendChild(svg);
    this._svgs.set(name, svg);
    return svg;
  }

  /** @param {string} name */
  unmount(name) {
    const svg = this._svgs.get(name);
    if (!svg) return false;
    svg.remove();
    this._svgs.delete(name);
    return true;
  }

  /** @param {string} name @returns {SVGSVGElement|undefined} */
  get(name) {
    return this._svgs.get(name);
  }

  /** SMIL document clock control. */
  pause(name) {
    this._svgs.get(name)?.pauseAnimations();
  }

  resume(name) {
    this._svgs.get(name)?.unpauseAnimations();
  }

  /** Seek the SVG's SMIL document clock to tSec. */
  seekTo(name, tSec) {
    const svg = this._svgs.get(name);
    if (!svg) {
      throw new Error(`[agent-stage.svgLayer] unknown svg "${name}" in seekTo()`);
    }
    svg.setCurrentTime(tSec);
  }

  /** @returns {number} current SMIL document time in seconds */
  currentTime(name) {
    const svg = this._svgs.get(name);
    return svg ? svg.getCurrentTime() : 0;
  }
}
