/**
 * SVG overlay layer for agent-stage Phase 2B.
 *
 * The overlay only creates structure (never animates): score cues routed to
 * DOM targets animate its elements on the stage timeline. Works headless in
 * Node by returning a mock overlay with `detached: true` built on a tiny
 * local element shim, so structure tests run without a real DOM.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// --- Minimal element shim (Node only) ---------------------------------------

class MockClassList {
  constructor(owner) {
    this._owner = owner;
    this._set = new Set();
  }
  add(...names) {
    for (const n of names) this._set.add(n);
  }
  remove(...names) {
    for (const n of names) this._set.delete(n);
  }
  contains(name) {
    return this._set.has(name);
  }
  get value() {
    return [...this._set].join(' ');
  }
  get length() {
    return this._set.size;
  }
}

export class MockElement {
  constructor(tagName) {
    this.tagName = String(tagName).toLowerCase();
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
    this.style = {};
    this.classList = new MockClassList(this);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    const v = this.attributes[name];
    return v === undefined ? null : v;
  }

  appendChild(child) {
    if (child && child.parentNode) {
      const i = child.parentNode.children.indexOf(child);
      if (i >= 0) child.parentNode.children.splice(i, 1);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
}

// --- Element helpers (work identically for real SVG elements and the shim) --

function makeElement(tag, isBrowser) {
  return isBrowser ? document.createElementNS(SVG_NS, tag) : new MockElement(tag);
}

function setAttr(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
}

function setClass(el, baseClass, extraClass) {
  el.classList.add(baseClass);
  if (extraClass) el.classList.add(extraClass);
}

// --- Built-in splitter (no GSAP SplitText) ----------------------------------

export function splitChars(content) {
  return [...String(content)];
}

export function splitWords(content) {
  return String(content).split(/\s+/).filter((w) => w.length > 0);
}

// --- Overlay ----------------------------------------------------------------

function applyTextStyle(el, item) {
  setAttr(el, {
    x: item.x,
    y: item.y,
    'font-size': item.size,
    'font-weight': item.weight,
    'font-family': item.family,
    fill: item.color,
    'text-anchor': item.align,
    opacity: item.opacity ?? 1,
  });
}

/**
 * ID / class convention (consumed by the score compiler's DOM routing):
 * - Each text item renders a <g id="{id}" class="svg-text [class]">.
 * - split 'char': one child element per character,
 *     class "{id}-char char", data-index="<i>", data-char="<c>".
 * - split 'word': one <g> per word,
 *     class "{id}-word word", data-index="<i>", containing one <text>
 *     child with the word as textContent.
 * - split 'none': one child <{tag}> with textContent = content,
 *     class "{id}-text".
 */
export function createOverlay(stage, svgSpec) {
  const isBrowser = typeof document !== 'undefined';
  const spec = svgSpec ?? {};

  const el = makeElement('svg', isBrowser);
  setAttr(el, { 'data-agent-stage-overlay': 'true', 'aria-hidden': 'true' });
  if (isBrowser) {
    const s = el.style;
    s.position = 'absolute';
    s.top = '0';
    s.left = '0';
    s.width = '100%';
    s.height = '100%';
    s.pointerEvents = 'none';
  } else {
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.pointerEvents = 'none';
  }

  const registry = new Map(); // id -> element
  const chars = new Map(); // id -> [char elements]
  const words = new Map(); // id -> [word group elements]

  function textChildTag(item) {
    return item.tag === 'tspan' ? 'tspan' : 'text';
  }

  function buildTextItem(item) {
    const group = makeElement('g', isBrowser);
    setAttr(group, { id: item.id });
    setClass(group, 'svg-text', item.class);
    registry.set(item.id, group);

    if (item.split === 'char') {
      const list = [];
      splitChars(item.content).forEach((ch, i) => {
        const t = makeElement('text', isBrowser);
        setAttr(t, { 'data-index': i, 'data-char': ch });
        t.classList.add(`${item.id}-char`, 'char');
        applyTextStyle(t, { ...item, x: item.x });
        t.textContent = ch;
        group.appendChild(t);
        list.push(t);
      });
      chars.set(item.id, list);
    } else if (item.split === 'word') {
      const list = [];
      splitWords(item.content).forEach((word, i) => {
        const g = makeElement('g', isBrowser);
        setAttr(g, { 'data-index': i, 'data-word': word });
        g.classList.add(`${item.id}-word`, 'word');
        const t = makeElement(textChildTag(item), isBrowser);
        applyTextStyle(t, item);
        t.textContent = word;
        g.appendChild(t);
        group.appendChild(g);
        list.push(g);
      });
      words.set(item.id, list);
    } else {
      const t = makeElement(textChildTag(item), isBrowser);
      t.classList.add(`${item.id}-text`);
      applyTextStyle(t, item);
      t.textContent = item.content;
      group.appendChild(t);
    }
    el.appendChild(group);
  }

  function applyGeometry(el2, shape) {
    const geometry = shape.geometry ?? {};
    setAttr(el2, geometry);
    setAttr(el2, {
      stroke: shape.stroke,
      fill: shape.fill,
      'stroke-width': shape.strokeWidth,
      opacity: shape.opacity ?? 1,
    });
  }

  function buildShape(shape, parent) {
    const tag = shape.type === 'group' ? 'g' : shape.type;
    const node = makeElement(tag, isBrowser);
    setAttr(node, { id: shape.id });
    setClass(node, 'svg-shape', shape.class);
    registry.set(shape.id, node);
    applyGeometry(node, shape);
    if (shape.type === 'group') {
      for (const child of shape.children ?? []) buildShape(child, node);
    }
    parent.appendChild(node);
  }

  for (const item of spec.text ?? []) buildTextItem(item);
  for (const shape of spec.shapes ?? []) buildShape(shape, el);

  function resize(size) {
    const w = size?.width ?? 0;
    const h = size?.height ?? 0;
    setAttr(el, { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
  }

  function destroy() {
    el.remove();
    registry.clear();
    chars.clear();
    words.clear();
  }

  return {
    el,
    detached: !isBrowser,
    destroyed: false,
    byId(name) {
      return registry.get(name) ?? null;
    },
    charsOf(id) {
      return chars.get(id) ?? [];
    },
    wordsOf(id) {
      return words.get(id) ?? [];
    },
    resize,
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      destroy();
    },
  };
}
