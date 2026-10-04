# agent-stage

agent-stage wraps three.js + GSAP to hide 3D/2D animation boilerplate behind a declarative, JSON-serializable spec — so LLM/AI agents can author scenes and animations from a small, enumerable token vocabulary instead of imperative three.js code.

## Status

Phase 1 (foundation) is complete:

- **Token schema** (`src/spec/schema.js`) — one enumerable vocabulary: 10 object types with per-type params, 6 material presets, 4 light types, background presets, defaults. `describeTokens()` emits the whole vocabulary as plain JSON.
- **Validator** (`src/spec/validate.js`) — structured errors (`{ path, message, suggestion }`) with did-you-mean suggestions and JSON-pointer paths.
- **Stage** (`src/stage/createStage.js`) — `createStage(spec)` hides renderer/scene/camera/lights/resize; a single paused GSAP timeline is the only clock; `seek(t)` is deterministic; `dispose()` is idempotent and leak-free.

Phase 2 (score compiler, SVG overlay, decal bridge) is planned.

## Run tests

```sh
npm install
npm test
```

*(ESM only, Node >= 20, no build step. The same source runs in the browser via importmap — see `examples/dev.html`.)*
