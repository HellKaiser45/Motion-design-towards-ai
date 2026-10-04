# AGENTS.md — how to author animations in agent-stage

Opinionated instructions for coding agents working in this repository. Follow
these rules; they exist so your animation runs, verifies, and validates on the
first try.

## Pick the right layer

- **Motion-design / cinematic pieces** → the **kit layer** (`src/kit/`).
  `createMotion(spec)` — objects, lights, SVG overlay, one flat `score` of cues.
  Start from `examples/hello-motion/scene.js`. Full reference: `docs/kit.md`.
- **Interactive / reactive characters (avatars)** → the **engine layer**
  (`src/`): registry assets + animation packs + the AgentDriver channels.
  Reference: `docs/pack-schema.md`, `docs/agent-authoring.md`.

Do not mix layers inside one piece unless you know why.

## Rule 1 — never name an engine

Engine names (`prop`, `waapi`, `smil`) and CSS selectors are implementation
details. They still work (legacy format) but new animation data must use
**semantic targets**:

```js
registry.registerTargets({
  body:       { three: 'body' },
  'face.smile': { svg: 'face', selector: '#m-smile' },
});
```

Then author without engines:

```js
{ target: 'body.position.y', keys: [[0, 0], [0.4, 0.2, 'easeOutCubic'], [0.8, 0]] }
{ target: 'face.smile',       keys: [{ t: 0, opacity: 0 }, { t: 0.25, opacity: 1, ease: 'backOut' }] }
```

The compiler picks the engine from the target. Typos in easing names throw
with a "did you mean" — read the message, never guess.

## Rule 2 — think in beats, not frames

- Beat durations 0.2–1.5 s; entrance/exit 0.6–1.2 s.
- Strong terminal easing: `easeOutExpo` for big moves, `backOut` for pops.
- Groups of elements animate with `stagger` (0.03–0.08 s per element).
- Loops: `repeat` (cycle) or `pingpong` (breathe). A looping animation never
  "finishes" — don't await it.

## Rule 3 — determinism is the contract

Everything is a pure function of time `t`. That is what makes seek, export and
headless verification exact.

- Never use `performance.now()`, `Date.now()`, or unseeded `Math.random()` in
  animation data (the kit provides seeded `rng(seed)` / `range()`).
- Pack playback is driven by `driver` ticks; instances are isolated
  (`createInstance`) — playing one pack never corrupts another.

## Rule 4 — always verify your own work

```bash
npm test                       # 51 unit tests must pass
node tools/render.mjs examples/<name> --check     # headless render of a kit piece
```

`ok: true` means the piece compiles, runs and renders with no console errors,
no page warnings and no black frames. Fix every `issue` and `warning` until
`ok: true`. Do not submit unverified work.

## Rule 5 — submit for human validation

1. Scene in `examples/<name>/` (kit) or via registered packs (engine layer).
2. Add the piece to `review/manifest.json`.
3. The human watches it at `/` (Motion Review console) and approves /
   requests changes / rejects.
4. Read the machine-readable verdict at `/?verdicts=1` and iterate.

## Quick API reminders

- Play a pack: `driver.play('greet')` → `{ instance, finished }`. Same pack on
  multiple channels is safe — each play creates an isolated instance.
- Queue on a channel: `{ blend: 'queue' }`; interrupt: default;
  crossfade: `{ blend: 'crossfade', fadeTime: 0.3 }`.
- Compact authoring forms are auto-normalized: keyframe tuples
  `[t, v, 'ease']` and dotted channels `'position.y'`.
- Unknown target/easing errors name the offender and list valid options.
