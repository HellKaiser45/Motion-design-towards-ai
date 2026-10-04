# AGENTS.md

**agent-stage** is a wrapper framework around three.js + GSAP that hides 3D/2D boilerplate behind a declarative, JSON-serializable spec. It is designed so LLM/AI agents can author animations by mapping intent to a small, enumerable token vocabulary.

## Current state (Phase 1 + 2A + 2B + bridge)

Implemented:

- `src/spec/schema.js` — single source of truth for the token vocabulary (pure data module, no three.js/gsap imports). `describeTokens()` emits the full vocabulary as JSON.
- `src/spec/validate.js` — `validateSpec()` / `normalizeSpec()`: structured errors with did-you-mean suggestions and JSON-pointer paths rooted at `/`.
- `src/stage/createStage.js` — `createStage(spec)` builds renderer/scene/camera/lights/objects and exposes `timeline` (a single paused GSAP timeline), `objects` (name -> mesh registry), `lights` (name -> light registry), `canvas` (the canvas in use, or null headless), and `seek/play/pause/render/dispose`. Works headless in Node (renderer auto-skips without WebGL). Without `options.canvas` and when a DOM exists, it auto-creates a canvas and mounts it to `document.body` per the top-level `display` token (`fit: cover|contain`, `position: fixed|absolute`, `mount: body|none`), adds a window resize listener, and removes both on `dispose()`. A caller-provided `options.canvas` is never styled/mounted/resize-managed.
- `src/score/compile.js` (Phase 2A) — `compileScore(stage, score)` compiles the flat cue list in `spec.score` onto `stage.timeline` (the single paused GSAP clock). `createStage` calls it automatically when the spec has a `score` array (result exposed as `stage.scoreCompile`: `{ ok, errors, warnings, duration }`); it is also callable standalone as `stage.compileScore(score)` to append cues to the live timeline.
- `src/svg/createOverlay.js` (Phase 2B) — SVG overlay layer (see below).
- `src/bridge/createBridge.js` — the bridge (see below): DOM-style handles for 3D objects, exposed as `stage.bridge`.
- Tests: `npm test` (node --test).

## Phase 2A — score compiler (cue vocabulary)

Top-level spec section `score`: a flat array of cues.

```json
{ "score": [ { "do": "move-to", "to": "hero", "at": 0, "dur": 1, "ease": "power2.out", "repeat": 0, "pingpong": false, "stagger": 0, "with": { "x": 1, "y": 2, "z": 3 } } ] }
```

Cue fields (all plain string/number/bool — JSON-serializable):

- `do` (required) — one of the 8 verbs; `to` (required) — object name, light name, reserved `camera`/`scene`, an array of such names (fans out with `stagger`), or a DOM selector (`#id`, `.class`, `svg …`) for the SVG overlay layer; `at` (default 0) and `dur` (default 1) in seconds; `ease` (default `power1.out`); `repeat` (integer >= -1); `pingpong` (bool, -> GSAP yoyo); `stagger` (seconds, multi-target); `with` — the verb params.

Verbs (`SCORE_VERBS` in schema.js) and their `with` params:

- `move-to` -> object `position` (x, y, z)
- `rotate` -> object `rotation` in radians (x, y, z)
- `scale-to` -> object `scale` (x, y, z)
- `spin` -> continuous rotation (axis: 'x'|'y'|'z', speed: radians/sec)
- `fade` -> `material.opacity` (3D) / element `opacity` (DOM) (opacity: 0..1)
- `color-to` -> `material.color` via THREE.Color (3D) / element `fill` (DOM) (hex: '#rrggbb')
- `animate` -> several bridge properties at once (see Bridge)
- `look-at` -> `Object3D.lookAt` applied in `onUpdate` (x, y, z, or target: object name — the target's position is snapshotted at compile time)

Eases (`SCORE_EASES`, 1:1 onto GSAP ease strings): `linear`, `none`, `steps`; `power1`..`power4`, `sine`, `expo`, `circ` with `in`/`out`/`inOut` variants; `back`, `elastic`, `bounce` with `out`/`inOut`. Bare names mean the `.out` variant (GSAP's default). Ease tokens are validated with did-you-mean suggestions.

Routing and determinism:

- Targets are resolved in order: `stage.objects` -> `stage.lights` -> reserved `camera`/`scene` -> DOM selector. An unknown 3D name is a structured error with a near-miss suggestion (validation pre-checks targets against spec object/light names).
- DOM-selector cues in Node (no `document`) are structured no-ops: they produce a **warning** (`stage.scoreCompile.warnings`), never an error or a crash. In the browser they `document.querySelector` and tween `opacity` (fade) / `fill` (color-to); 3D-only verbs (spin, look-at, move-to, rotate, scale-to) on DOM targets warn that they have no DOM equivalent.
- `repeat: -1` (or any repeat above `SCORE_REPEAT_CAP` = 100) is clamped to the cap with a warning — an infinite timeline would break `seek(t)` / render-to-t.
- Every cue becomes `timeline.to(...)` positioned at its `at` offset; `seek(t)` remains a pure function of time.

## Phase 2B — SVG overlay layer

Top-level spec section `svg` (alias `overlay`; canonical key is `svg`, normalized as such; defining both is an error):

```json
{
  "svg": {
    "fit": "cover | contain",
    "text": [{ "id": "title", "class": "", "content": "hello", "split": "char | word | none", "tag": "text | tspan", "x": 0, "y": 0, "size": 24, "weight": 400, "family": "sans-serif", "color": "#ffffff", "align": "start | middle | end" }],
    "shapes": [{ "id": "frame", "class": "", "type": "rect | circle | line | path | group", "stroke": "#ffffff", "fill": "none", "strokeWidth": 1, "...geometry": "flat params per SVG_SHAPE_TYPES (path d is a string; group takes children)" }]
  }
}
```

- Tokens live in `src/spec/schema.js` (`SVG_SHAPE_TYPES`, `SVG_TEXT_PARAMS`, `SVG_SPLITS`, `SVG_TAGS`, `SVG_ALIGNS`, `SVG_FITS`, `DEFAULTS.svg`); validation lives in `src/spec/validate.js` (duplicate ids across text+shapes, unknown shape types/params, bad enums -> structured errors with suggestions).
- `createStage(spec)` calls `createOverlay` when `spec.svg` exists and exposes `stage.svg` (else `null`). The layer is absolutely positioned over the canvas with `pointer-events: none` and resizes via `stage.onResize(cb)`; it only creates structure — score cues routed to DOM selectors (`#id`, `.class`, `svg …`) animate it on the shared timeline.
- **ID/class convention for the score compiler's DOM routing:** each text item renders `<g id="{id}" class="svg-text [class]">`. `split: 'char'` renders one child per character with class `"{id}-char char"` and attributes `data-index="<i>"`, `data-char="<c>"`; `charsOf(id)` lists them. `split: 'word'` renders one `<g>` per word with class `"{id}-word word"`, `data-index="<i>"`, `data-word="<w>"`, each containing one text element with the word as textContent; `wordsOf(id)` lists them. `split: 'none'` renders one child `<text|tspan class="{id}-text">` with the full content. Shapes render as `<{type} id="{id}" class="svg-shape [class]">` with geometry as flat attributes. Target split children with `#id .char` / `#id .word` or `.{id}-char` / `.{id}-word`.
- The overlay element is auto-appended to `document.body` right after the canvas when `display.mount === 'body'` (stacking via DOM order, no z-index); with any other mount it stays detached for caller mounting (`stage.svg.el`). `stage.dispose()` removes it exactly once.
- Headless Node: the overlay is a lightweight mock (`detached: true`) with the same API surface (`el`, `byId`, `charsOf`, `wordsOf`, `resize`, `destroy`), so structure is verifiable without a DOM. `stage.dispose()` destroys the overlay.

## Bridge — treat a 3D object like a DOM element

`stage.bridge` (also `createBridge(ctx)` from the package root) gives GSAP-friendly handles for three.js objects. There is **no second render loop**: proxies are accessors that read/write the live `Object3D`, so the single paused stage timeline stays the only clock and `seek(t)` stays a pure function of time.

Vocabulary (`BRIDGE_PROPS`, also in `describeTokens().bridgeProps`; rotations are radians): `x y z rotateX rotateY rotateZ scale scaleX scaleY scaleZ opacity`. `scale` is uniform (reads `scale.x`); `opacity` writes `material.opacity` on every material and enables transparency (objects without a material read `1`, writes are no-ops).

JSON, for agents — the `animate` verb (3D targets only; a DOM selector target warns) tweens several properties in one cue:

```json
{ "do": "animate", "to": ["hero", "sat"], "at": 1, "dur": 1.5, "ease": "back.out", "stagger": 0.2,
  "with": { "y": 1, "rotateY": 3.14, "scale": 1.5, "opacity": 0.8 } }
```

`with` must list at least one bridge property; unknown names get did-you-mean suggestions (`rotatey` -> `rotateY`). Targets are objects, lights, `camera`, `scene`, or arrays of them. Uniform `scale` tweens start from the current `scale.x`.

Programmatic API (not part of the JSON spec — live three.js paths are not enumerable tokens):

```js
const hero = stage.bridge.object('hero');            // stable proxy, same reference every call
stage.timeline.to(hero, { x: 4, rotateY: Math.PI, duration: 2 }, 0);

const p = stage.bridge.channel('progress', {          // any scalar: uniform, morph influence...
  target: 'hero', path: 'material.uniforms.uProgress.value',
});
stage.timeline.to(p, { value: 1, duration: 1 }, 0);   // channel(id) fetches it later; channel(id, { get, set }) for custom

stage.bridge.snapshot('hero');                        // plain JSON of all bridge props
stage.bridge.channelValues();                         // { progress: 0.3, ... }
stage.bridge.project('hero');                         // { x, y, depth, onScreen } in render px, y down
```

`project()` is for placing SVG/DOM overlays on a 3D object (e.g. position an overlay element from `project()` after each `seek`). GSAP rounds tweened values to about 1e-6, so compare with a tolerance. Channels capture their container at bind time; replacing it afterwards (e.g. assigning a new `uniforms` object) detaches the channel. Plan and decisions: `docs/bridge-plan.md`. Example: `examples/bridge-demo.json`.

Not yet implemented: decal bridge, render/verdict tooling, docs site, bridge support for DOM targets in `animate`, an automatic overlay-follow helper built on `project()`.

## Contract for agents

- Specs are JSON-serializable objects. Every token is validated; typos produce structured errors with suggestions — never guess, fix from the suggestion.
- Determinism is non-negotiable: `stage.seek(t)` must always produce the same scene state for the same `t`.
- The one-page token map will live in `docs/tokens.md` once Phase 2 lands; until then, `describeTokens()` (exported from the package root) is the authoritative vocabulary.
