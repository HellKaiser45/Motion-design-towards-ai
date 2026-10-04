# agent-stage

Zero-build-step SVG + Three.js animation framework for AI agents. The only dependency is three.js, loaded via CDN importmap.

## Running

Serve the `agent-stage/` folder as the HTTP document root (the repo root of the project):

- `npx serve agent-stage` — from the parent directory
- `python3 -m http.server 3000` — run inside `agent-stage/`

Then open:

- `/` — dev harness
- `/examples/cube-agent/` — CU-13 flagship demo (with export panel)

ES modules require HTTP; `file://` will not work.

## Troubleshooting

**`Loading module ... blocked because of a disallowed MIME type (text/html)`** — your server root is wrong, most likely you served the example folder alone, so `../../src/index.js` escapes the root and the server returns an HTML fallback page. Fix: serve the `agent-stage/` folder as the document root.

Also note:

- ES modules do not load over `file://` — use a local HTTP server.
- Console noise from browser extensions (e.g. MetaMask) is unrelated to this project.

## Structure

```
agent-stage/
  src/
    core/      # stage, timeline, events, easing
    engines/   # smil, waapi, prop animation engines
    layers/    # svg-layer, three-layer
    bridges/   # anchor-bridge, texture-bridge
    driver/    # agent-driver, pack-compiler, registry
    export/    # compositor, frame-renderer, backends (webm/mp4/png)
  assets/      # shared svg assets
  examples/    # cube-agent demo
  docs/pack-schema.md
```