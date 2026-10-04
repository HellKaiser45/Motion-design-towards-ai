# The agent authoring contract

How an AI agent creates motion in agent-stage without touching the
implementation underneath. Companion to `AGENTS.md` (quick rules) and
`docs/pack-schema.md` (pack format) / `docs/kit.md` (kit spec).

## The principle

> The agent says **what** to animate, **when**, **for how long**, and **with
> which feel**. The framework decides **how** (which engine, which adapter).

Concretely: an animation is data. It declares a semantic `target`, keyframes
(`keys`) with named easings, a start time and a duration. Compilation resolves
targets through the registry, picks the right runtime engine per target, and
produces an immutable definition. Playback happens on isolated instances.

```
agent JSON  →  normalize (compact forms)  →  resolve semantic targets
           →  immutable AnimationDefinition (CompiledPack)
           →  definition.createInstance()  →  PackInstance (isolated playback)
```

## Semantic targets

Register things an agent can animate by meaning:

```js
registry.registerTarget('body',        { three: 'body' });            // 3D object
registry.registerTarget('face.smile',  { svg: 'face', selector: '#m-smile' }); // SVG part
registry.registerTargets({
  'face.leftEye':  { svg: 'face', selector: '#eye-l' },
  'face.rightEye': { svg: 'face', selector: '#eye-r' },
});
```

Resolution rules (`registry.resolveTarget(name)`):

1. exact name match first (`face.smile`);
2. otherwise longest dot-prefix match (`body.position.y` → binding `body`,
   remainder `position.y` becomes the property path);
3. unknown names throw, listing registered targets (`registry.listTargets()`).

`registerTarget`/`registerTargets`/`resolveTarget`/`listTargets` are the
registry's animation vocabulary. The same bindings work in pack tracks and
anywhere a semantic target is accepted.

## Compact track forms (no engine names)

A track with a semantic `target` and `keys` — the compiler derives the engine:

```js
// single 3D property: tuple keyframes [t, v, ease?]
{ target: 'body.position.y', keys: [[0, 0], [0.4, 0.25, 'easeOutCubic'], [0.8, 0]] }

// multiple 3D properties at once
{ target: 'body', keys: {
    'position.y': [[0, 0], [0.6, 0.2, 'easeOutExpo']],
    'rotation.x': [[0, 0], [0.6, 0.35, 'easeOutCubic']],
} }

// SVG element: object keyframes (any CSS-animatable props)
{ target: 'face.smile', keys: [{ t: 0, opacity: 0 }, { t: 0.25, opacity: 1, ease: 'backOut' }] }
```

`begin` (offset), `loop` (`repeat` | `pingpong`) and `options` pass through.
`keyframes` is an accepted alias of `keys`. Dotted channels (`position.y`)
and tuple keyframes are normalized automatically everywhere.

The legacy engine-named forms (`{engine:'prop', target, props}` and
`{engine:'waapi', svg, selector, keyframes}`) remain fully supported — they
are now considered the compiled/verbose form, not the authoring form.

## Easings

Named, pure functions of progress. Unknown names throw with a "did you mean"
suggestion. The WAAPI adapter reproduces every curve exactly via CSS
`linear()` sampling (including `elasticOut`/`bounceOut` — no visual drift
between live playback and export). Valid names are listed in
`src/core/easing.js` (`easingNames()`), e.g. `linear`, `easeOutCubic`,
`easeInOutSine`, `easeOutExpo`, `backOut`, `backInOut`, `elasticOut`,
`bounceOut`, `step`.

## Playback model (instances, channels)

- `compile(pack, ctx)` → immutable **definition**: name, channel, duration,
  loop, text, track specs. Never mutated by playback.
- `definition.createInstance(loop?)` → **PackInstance**: isolated playhead,
  engine instances, `finished` promise. Two instances of one definition never
  interfere (same pack on many channels is safe).
- `driver.play('greet', opts)` creates an instance for you and returns
  `{ instance, finished }`.
- Blend policies per play: `interrupt` (default), `queue` (FIFO),
  `crossfade` (fadeTime seconds, logical-time driven).
- Looping instances never resolve `finished` — do not await them.

## Determinism & export

Everything is seek-exact: `seek(t)` positions prop tracks (pure evaluation),
WAAPI tracks (currentTime while paused), SMIL sync (document clock). Offline
export (FrameRenderer) runs the same pipeline per frame — schedule → seek →
timeline.seek → bridges sample (anchors reproject, textures re-rasterize
awaited) → capture — and restores the live state afterward, including the
camera aspect. What you preview is what exports.

## The verification loop

1. `npm test` — unit suites (easing, normalization, instances, driver).
2. `node tools/render.mjs examples/<name> --check` — headless render,
   JSON verdict: console errors, warnings, black-frame detection.
3. Human validation at `/` (Motion Review console); agent reads
   `/?verdicts=1`.

## Deliberately not in the agent vocabulary (yet)

- Engine selection (`prop`/`waapi`/`smil`) — resolved for you.
- Weighted crossfade *blending* — crossfade currently runs both instances for
  the fade window (later writes win); true lerp-weight mixing is future work
  (universal sampler).
- Motion primitives (pop/bounce/spring/squash...) — planned; today compose
  from keyframes + easings, or use kit score cues.
