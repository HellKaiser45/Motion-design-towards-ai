# agent-stage

agent-stage wraps three.js + GSAP to hide 3D/2D animation boilerplate behind a declarative, JSON-serializable spec — so LLM/AI agents can author scenes and animations from a small, enumerable token vocabulary instead of imperative three.js code.

## Status

Phase 1 (foundation) is complete:

- **Token schema** (`src/spec/schema.js`) — one enumerable vocabulary: 10 object types with per-type params, 6 material presets, 4 light types, background presets, defaults. `describeTokens()` emits the whole vocabulary as plain JSON.
- **Validator** (`src/spec/validate.js`) — structured errors (`{ path, message, suggestion }`) with did-you-mean suggestions and JSON-pointer paths.
- **Stage** (`src/stage/createStage.js`) — `createStage(spec)` hides renderer/scene/camera/lights/resize; a single paused GSAP timeline is the only clock; `seek(t)` is deterministic; `dispose()` is idempotent and leak-free.

Phase 2A (score compiler) is complete:

- **Score compiler** (`src/score/compile.js`) — a flat cue list in the spec's `score` array is compiled onto the single paused GSAP timeline. Cues are `{ do, to, at, dur, ease, repeat, pingpong, stagger, with }` — 7 verbs (`move-to`, `rotate`, `scale-to`, `spin`, `fade`, `color-to`, `look-at`), ~30 ease tokens mapped 1:1 onto GSAP eases, and targets resolved across objects, lights, the reserved `camera`/`scene`, and DOM selectors (no-op + warning in Node). Infinite repeats are clamped so `seek(t)` stays a pure function of time. `createStage` compiles the spec's score automatically (`stage.scoreCompile`); `stage.compileScore(score)` appends cues to the live timeline.

Phase 2B (SVG overlay) is complete:

- **SVG overlay** (`src/svg/createOverlay.js`) — `createStage(spec)` builds an absolutely-positioned, pointer-events-none `<svg>` layer over the canvas when the spec has a top-level `svg` (alias `overlay`) section, exposed as `stage.svg`. Text items render as `<g id="...">` groups with built-in char/word splitting (no GSAP SplitText); shapes compile to flat parametrized SVG elements. The overlay only creates structure — animation comes from score cues routed to DOM selectors (`#id`, `.class`, `svg …`) and animated on the same stage timeline. In headless Node the overlay is a lightweight mock (`detached: true`) with the same API (`el`, `byId`, `charsOf`, `wordsOf`, `resize`, `destroy`). `stage.onResize(cb)` notifies overlay subscribers on canvas resize; the overlay is destroyed by `stage.dispose()`.

The decal bridge and render/verdict tooling are planned.

## Run tests

```sh
npm install
npm test
```

*(ESM only, Node >= 20, no build step. The same source runs in the browser via importmap — see `examples/dev.html`.)*
