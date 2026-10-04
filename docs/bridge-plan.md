# Bridge Engine — plan & progress

Goal: let an agent treat a 3D object like a DOM element — `x`, `y`, `rotateY`,
`scale`, `opacity` — and animate it with GSAP, **without** a second render
loop and **without** losing the `seek(t)` determinism contract.

## Design decisions

1. **No private rAF loop.** The naive pattern (proxy object + `requestAnimationFrame`
   copying proxy -> mesh every frame) creates a second clock. `seek(t)` would no
   longer be a pure function of time, and headless/render-to-t would break.
   The stage already has one paused GSAP timeline plus a ticker that only *paints*.
2. **Accessor proxies instead of copy-sync.** `bridge.object(name)` returns an
   object whose properties (`x`, `rotateY`, `opacity`, ...) are getters/setters
   that read/write the live `Object3D` directly. GSAP tweens them like any plain
   object, the mesh is always up to date, and there is nothing to "sync".
3. **Radians everywhere** (matches the existing `rotate` verb).
4. **JSON-first for agents.** The proxy vocabulary is exposed as tokens
   (`BRIDGE_PROPS`) and as one new score verb, `animate`, so an agent can drive
   several properties in a single cue and gets did-you-mean validation.
5. **Programmatic escape hatch.** `bridge.channel()` binds a named scalar to any
   property path (shader uniform, morph influence, ...). Not in the JSON spec
   because paths into live three.js objects are not enumerable tokens.

## Steps

- [x] 1. Plan doc, fix `npm test` on Node >= 22
- [x] 2. `src/bridge/createBridge.js` core (object proxies) + unit tests
- [x] 3. Wire `stage.bridge` into `createStage`, export from package root
- [x] 4. `animate` score verb: schema tokens, validation, compiler, tests
- [x] 5. `bridge.channel()` custom bindings (uniforms etc.) + tests
- [x] 6. `bridge.project(name)` 3D -> screen px (for DOM/SVG overlays) + tests
- [ ] 7. Docs (AGENTS.md, README), example spec

## Log

(each step appends a line here when committed)

- step 2: `createBridge` core — accessor proxies, `snapshot`, `BRIDGE_PROPS` token + `describeTokens().bridgeProps`; 11 tests (113 total).
- step 3: `stage.bridge` wired into `createStage` (disposed with the stage), `createBridge` + `BRIDGE_PROPS` exported from the package root; 3 tests (116 total). Note: GSAP rounds tweened values to ~1e-6 — compare with tolerance, as existing tests do.
- step 4: `animate` score verb (params = BRIDGE_PROPS, opacity 0..1, empty/missing `with` rejected, did-you-mean on property names, DOM targets warn); 10 tests (126 total).
- step 5: `bridge.channel(id, {target,path}|{get,set})` + `channelValues()` — tween shader uniforms / morph influences / anything on the stage timeline; 8 tests (134 total).
- step 6: `bridge.project(name)` -> `{ x, y, depth, onScreen }` in render px (normalized 0..1 when no size given); stage tracks the fitted view size on resize; 6 tests (140 total).
