# agent-stage

Zero-build-step SVG + Three.js animation framework for AI agents. The only dependency is three.js, loaded via CDN importmap (or a local `node_modules` install for offline use).

**Start here if you are an AI agent: [AGENTS.md](AGENTS.md)** — the opinionated authoring rules — and [docs/agent-authoring.md](docs/agent-authoring.md), the agent contract (semantic targets, compact keyframes, playback model).

Two layers, one philosophy — **everything is a pure function of logical time** (seek-safe, export-safe, render-tool verifiable):

1. **Engine layer** (`src/`) — the interactive avatar runtime: registry packs, engines (prop/WAAPI/SMIL), the AgentDriver with channels and blend policies, bridges and export backends. See `docs/pack-schema.md`.
2. **Kit layer** (`src/kit/`) — the motion-design layer: `createMotion(spec)` builds a complete 3D + SVG piece from one declarative object: objects (including `box` and live **SVG decals on 3D surfaces**), lights, an SVG overlay, and a flat `score` of cues. See `docs/kit.md`.

## The loop this framework exists for: agent authors → agent verifies → human validates

1. The **agent** writes a scene (see "Kit in 30 seconds") and drops it in `examples/<name>/`.
2. The **agent verifies its own work** headlessly (`npm run check` / `tools/render.mjs` — JSON pass/fail, black-frame detection, console errors, contact sheet).
3. The agent registers the piece in `review/manifest.json`.
4. The **human validates** it at `/` — the **Motion Review console**: play/scrub/loop the submission, then **Approve / Request changes / Reject** with a note.
5. The **agent reads the verdict** at `/?verdicts=1` (pure JSON, machine-readable) and iterates.

No human has to look at logs or a black screen to know what happened; no agent has to guess whether the human liked the result.

## Running

Serve the repo root as the HTTP document root:

- `npm run serve` (or `npx serve .`)
- `python3 -m http.server 3000`

Then open:

- `/` — **Motion Review console** (watch, scrub, approve/reject agent-made animations)
- `/?verdicts=1` — machine-readable verdict JSON (for the agent)
- `/examples/cube-reveal/` — CU-13 character boot cinematic: 3D cube with its **animated face rendered live on the cube** (kit layer)
- `/examples/nova-core/` — 12 s reactor-reveal cinematic (kit layer)
- `/examples/hello-motion/` — smallest complete kit piece (start here)
- `/examples/cube-agent/` — CU-13 interactive demo (engine layer, with export panel)
- `/dev.html` — engine-layer dev harness (tweaks, driver channels, bridges)

ES modules require HTTP; `file://` will not work.

## The agent loop: author → verify → iterate

The framework ships a headless verification tool so an agent can **check its own work** without a human looking at a screen:

```bash
npm install                # three + playwright-core
npm test                   # 51 dependency-free unit tests (easing, pack normalization,
                           #  immutable definitions/instances, semantic targets, driver)
npm run check              # headless-render both kit examples, report JSON
node tools/render.mjs examples/cube-reveal --chrome $(which chrome) \
     --size 1280x720 --frames 12    # PNG frames + contact sheet + JSON report
```

The tool loads the example in headless Chrome, seeks the deterministic `render(t)` at sampled times, screenshots, and reports: console errors, page warnings, black-frame detection, and a contact sheet of the sampled frames. `ok: true` means the piece compiles, runs and renders — the agent's feedback signal.

## Kit in 30 seconds

```js
import { createMotion } from 'agent-stage/kit/index.js';

createMotion({
  size: [1280, 720],
  objects: { orb: { type: 'icosahedron', material: { preset: 'neon', color: '#4de2ff', glow: 1 } } },
  svg: `<svg viewBox="0 0 1280 720"><text id="t" data-split x="640" y="360">HELLO</text></svg>`,
  score: [
    { at: 0,   dur: 1, target: 'orb', scale: [0, 1], ease: 'backOut' },
    { at: 0.5, dur: 1, target: '#t .ch', stagger: 0.06, opacity: [0, 1], y: [20, 0] },
  ],
}).then((m) => attachReview(m));
```

Copy `examples/hello-motion/scene.js`, change the objects and the score — that's the whole workflow. Full reference: `docs/kit.md`.

Notable kit features: `box` geometry, and **`decal` objects** — an inline SVG rendered as a *live animated texture* on a 3D plane (this is how the CU-13 face lives on the cube in `examples/cube-reveal`: eye blinks, mouth crossfades and boot screens are ordinary score cues targeting `face #m-smile`-style selectors). `attachReview(m)` makes any scene console-controllable (play/pause/seek/loop via postMessage) and is a no-op under `?capture`.

## Error philosophy (agent-friendly)

- **Typos never pass silently.** Unknown easing names throw with a "did you mean" suggestion (`easeOutCub` → `easeOutCubic`). The WAAPI engine reproduces easing curves exactly via CSS `linear()` sampling instead of approximating them.
- **Structural errors throw** (missing svg root, bad cue shape, non-numeric `at`).
- **Recoverable issues warn** (unknown score target/selector/prop → collected in `warnings`, visible in the render tool report).
- **Failures are visible.** Every example page shows a red banner on any page error — an empty stage is never a mystery.
- Compact authoring forms are accepted and normalized: keyframe tuples `[0, 0.5]`, `[1, 1, 'easeOutExpo']` and dotted channels `'position.y'` all compile to the canonical schema (`normalizePack`, also exported).
- **Semantic targets replace engines/selectors in new data**: register `registry.registerTarget('face.smile', {svg:'face', selector:'#m-smile'})` and author `{target:'face.smile', keys:[...]}` — the compiler picks the engine. Legacy engine-named tracks still compile unchanged.
- **Packs are immutable definitions; playback is isolated**. `compile()` builds a definition; `definition.createInstance()` (the driver does this per play) yields an independent instance — the same pack on several channels can no longer corrupt shared state. Loop overrides never mutate the definition.

## Structure

```
agent-stage/
  AGENTS.md    # the AI authoring rules (read this first)
  src/
    core/      # stage, timeline, events, easing (validated, cssLinear-sampled)
    engines/   # smil, waapi, prop animation engines
    layers/    # svg-layer, three-layer
    bridges/   # anchor-bridge, texture-bridge (sample-on-seek capable)
    driver/    # agent-driver (isolated instances), pack-compiler (immutable
               #   definitions + createInstance + compact/semantic forms),
               #   registry (assets, packs, semantic targets)
    export/    # compositor, frame-renderer, backends (webm/mp4/png)
    kit/       # createMotion + review.js (console/review protocol)
  review/      # manifest.json — the submissions the console lists
  tools/
    render.mjs  # headless render + verification (JSON report, contact sheet)
  tests/        # dependency-free node test suite
  assets/       # shared svg assets
  examples/     # cube-agent (engines), hello-motion + nova-core + cube-reveal (kit)
  docs/         # pack-schema.md, kit.md, agent-authoring.md
```

## Troubleshooting

**`Loading module ... blocked because of a disallowed MIME type (text/html)`** — your server root is wrong, most likely you served the example folder alone, so `../../src/index.js` escapes the root and the server returns an HTML fallback page. Fix: serve the repo root as the document root.

Also note:

- ES modules do not load over `file://` — use a local HTTP server.
- `tools/render.mjs` needs a Chrome executable: pass `--chrome <path>` or set `CHROME_PATH`. It runs with software GL (SwiftShader), no GPU required.
- If `node_modules/three` exists, the render tool serves three.js locally and intercepts the CDN URLs — fully offline.
- The review console stores verdicts in the browser's localStorage under `agent-stage:verdicts`; "Download verdicts.json" / `/?verdicts=1` are the machine-readable exports.
- Console noise from browser extensions (e.g. MetaMask) is unrelated to this project.
