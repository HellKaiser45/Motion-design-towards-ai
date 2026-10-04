# agent-stage

Zero-build-step SVG + Three.js animation framework for AI agents. The only dependency is three.js, loaded via CDN importmap (or a local `node_modules` install for offline use).

Two layers, one philosophy — **everything is a pure function of logical time** (seek-safe, export-safe, render-tool verifiable):

1. **Engine layer** (`src/`) — the interactive avatar runtime: registry packs, engines (prop/WAAPI/SMIL), the AgentDriver with channels and blend policies, bridges and export backends. See `docs/pack-schema.md`.
2. **Kit layer** (`src/kit/`) — the motion-design layer: `createMotion(spec)` builds a complete 3D + SVG piece from one declarative object: objects, lights, an SVG overlay, and a flat `score` of cues. See `docs/kit.md` and `examples/hello-motion` (the 30-line starting point) and `examples/nova-core` (a full 12-second cinematic).

## Running

Serve the repo root as the HTTP document root:

- `npm run serve` (or `npx serve .`)
- `python3 -m http.server 3000`

Then open:

- `/` — engine-layer dev harness
- `/examples/cube-agent/` — CU-13 flagship demo (engine layer, with export panel)
- `/examples/hello-motion/` — smallest complete kit piece (start here)
- `/examples/nova-core/` — 12 s product-reveal cinematic (kit layer)

ES modules require HTTP; `file://` will not work.

## The agent loop: author → verify → iterate

The framework ships a headless verification tool so an agent can **check its own work** without a human looking at a screen:

```bash
npm install                # three + playwright-core
npm test                   # dependency-free unit tests (easing, pack normalization)
npm run check              # headless-render both kit examples, report JSON
node tools/render.mjs examples/nova-core --chrome $(which chrome) \
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
}).then((m) => m.play());
```

Copy `examples/hello-motion/scene.js`, change the objects and the score — that's the whole workflow. Full reference: `docs/kit.md`.

## Error philosophy (agent-friendly)

- **Typos never pass silently.** Unknown easing names throw with a "did you mean" suggestion (`easeOutCub` → `easeOutCubic`). The WAAPI engine reproduces easing curves exactly via CSS `linear()` sampling instead of approximating them.
- **Structural errors throw** (missing svg root, bad cue shape, non-numeric `at`).
- **Recoverable issues warn** (unknown score target/selector/prop → collected in `warnings`, visible in the render tool report).
- Compact authoring forms are accepted and normalized: keyframe tuples `[0, 0.5]`, `[1, 1, 'easeOutCubic']` and dotted channels `'position.y'` all compile to the canonical schema (`normalizePack`, also exported).

## Structure

```
agent-stage/
  src/
    core/      # stage, timeline, events, easing (validated, cssLinear-sampled)
    engines/   # smil, waapi, prop animation engines
    layers/    # svg-layer, three-layer
    bridges/   # anchor-bridge, texture-bridge
    driver/    # agent-driver, pack-compiler (+normalizePack), registry
    export/    # compositor, frame-renderer, backends (webm/mp4/png)
    kit/       # createMotion — the declarative motion-design layer
  tools/
    render.mjs  # headless render + verification (JSON report, contact sheet)
  tests/        # dependency-free node test suite
  assets/       # shared svg assets
  examples/     # cube-agent (engines), hello-motion + nova-core (kit)
  docs/         # pack-schema.md, kit.md
```

## Troubleshooting

**`Loading module ... blocked because of a disallowed MIME type (text/html)`** — your server root is wrong, most likely you served the example folder alone, so `../../src/index.js` escapes the root and the server returns an HTML fallback page. Fix: serve the repo root as the document root.

Also note:

- ES modules do not load over `file://` — use a local HTTP server.
- `tools/render.mjs` needs a Chrome executable: pass `--chrome <path>` or set `CHROME_PATH`. It runs with software GL (SwiftShader), no GPU required.
- If `node_modules/three` exists, the render tool serves three.js locally and intercepts the CDN URLs — fully offline.
- Console noise from browser extensions (e.g. MetaMask) is unrelated to this project.
