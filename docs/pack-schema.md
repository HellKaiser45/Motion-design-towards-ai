# Agent Stage — Pack Schema

**The AI-facing animation contract.** An Agent Stage animation is *data*: a
JSON "pack" declares tracks against logical asset names, and the runtime
(compiler → registry → driver) turns it into live motion across 3D props, SVG
overlay elements, and embedded SMIL. An agent never touches code to make its
character move — it emits packs.

---

## Philosophy

1. **Animations are data.** A pack is plain JSON: serializable, cacheable,
   generatable by an LLM, diffable in review.
2. **Logical names only.** Packs reference `svg: "face"` and `target: "body"` —
   never DOM ids or scene-graph paths. The Registry resolves names at compile
   time, so assets and packs are swappable without edits.
3. **Seek-first determinism.** PropEngine tracks are pure functions of `t`;
   WAAPI tracks are positioned via `animation.currentTime`; SMIL *sync* tracks
   map the SVG document clock. `Timeline.seek(t)` / `pack.seek(t)` position the
   whole experience exactly — which is what makes offline video export
   frame-accurate.
4. **Channels, not choreography.** Packs declare which *channel* they play on
   (`body`, `face`, `hud`, `state`, …). Parallel channels move simultaneously;
   same-channel playback follows a blend policy. Sequencing is the caller's
   job (`finished` promises, queues, or schedules).

---

## Pack reference

```jsonc
{
  "name": "greet",               // required, unique registry key
  "channel": "body",             // default "default"
  "duration": 1.6,               // optional; derived from tracks if absent
                                 // (max over tracks of begin + trackDuration)
  "loop": false,                 // pack-level default: false | "repeat" | "pingpong"
  "tracks": [ /* see below */ ],
  "text": { "svg": "nametag", "selector": "[data-as-text]" }  // optional; used by driver.say()
}
```

| Field      | Type            | Notes |
|------------|-----------------|-------|
| `name`     | string, req.    | Registry key. |
| `channel`  | string          | Logical playback lane. Driver convenience intents map to `face` (`emote`), `body` (`motion`), `hud` (`hud`), `state` (`state`). |
| `duration` | number (s)      | Only extends the derived duration; never shortens it. Non-looping packs resolve `finished` at this time. |
| `loop`     | bool / string   | `false` (play once), `"repeat"` (wrap), `"pingpong"` (wrap & reverse). Per-track `loop` overrides this. |
| `tracks`   | array, req.     | ≥ 1 track; each compiled against its engine. |
| `text`     | object          | `{ svg, selector }` — `driver.say(text)` writes into this element. |

### Track: `prop` (3D objects — deterministic, pure f(t))

```jsonc
{
  "engine": "prop",
  "target": "body",              // ThreeLayer name
  "props": {
    "position:y":     [{ "t": 0, "v": 0, "ease": "easeOutCubic" },
                       { "t": 0.8, "v": 0.25 }],
    "rotation:x":     [{ "t": 0, "v": 0 }, { "t": 0.5, "v": 0.35 },
                       { "t": 1.4, "v": 0 }],
    "material.color:r": [{ "t": 0, "v": 1 }, { "t": 1, "v": 0.2 }]
  },
  "begin": 0.2,                  // optional offset into the pack
  "loop": "repeat"               // optional; overrides pack loop
}
```

- Property paths: `"<target>.<prop>:<channel>"` — e.g. `position:y`,
  `rotation:x`, `material.emissive:r` (Color channels `r/g/b`). Numeric
  channels only.
- **First keyframe must be `t: 0`**; times strictly increasing; values numeric.
- Easing comes from the segment's **END** keyframe. Named easings: `linear`,
  `easeInQuad`, `easeInCubic`, `easeOutQuad`, `easeOutCubic`,
  `easeInOutQuad`, `easeInOutCubic`, `backOut`, `elasticOut`, `step`.

### Track: `waapi` (SVG/DOM overlay elements)

```jsonc
{
  "engine": "waapi",
  "svg": "face",                 // mounted SVG name
  "selector": "#mouth",          // CSS selector scoped to that SVG
  "keyframes": [
    { "t": 0,   "opacity": 0, "transform": "translateY(4px)" },
    { "t": 0.3, "opacity": 1, "ease": "backOut" }
  ],
  "options": { "fill": "both", "composite": "replace", "easing": "linear" },
  "begin": 0,
  "loop": "pingpong"
}
```

- Animatable: CSS properties (`opacity`, `transform`, `fill`, `stroke`, …).
- Offsets derive from `t` values (normalized so first = 0, last = 1).
- `fill` defaults to `"both"` so seek positions render correctly.
- Export note: WAAPI-computed styles don't serialize into markup; the
  Compositor bakes them per frame (via `getAnimations()` sampling +
  `WaapiEngine.snapshotStyles()`), so packs are export-safe as-is.

### Track: `smil` (animations embedded inside the SVG asset)

```jsonc
// trigger mode — event style: fires beginElement() when the playhead crosses
// the track's begin offset. Great for one-shot morphs in live playback; NOT
// seek-deterministic (accepted caveat for offline export).
{ "engine": "smil", "svg": "face", "mode": "trigger", "animation": "smile" }

// sync mode — maps the SVG document clock: docTime = begin + localTime.
// Fully seek-deterministic. The SVG's SMIL elements should start at
// begin="0s" relative offsets with fill="freeze" inside the track's window.
{ "engine": "smil", "svg": "face", "mode": "sync", "begin": 0, "duration": 0.6 }
```

- `sync` requires numeric `duration > 0`. Only ONE sync track should own a
  given SVG's doc clock at a time (same-channel packs are exclusive, so this
  falls out naturally).
- Author SMIL assets with `begin="0s"` (or small offsets), `fill="freeze"`,
  so doc-clock seeking positions them exactly.

### Semantic targets & compact form

Engine-less tracks + a target registry mean packs never name engines or CSS
selectors. Targets bind logical names to assets once:

```js
registry.registerTarget('body', { three: 'body' });
registry.registerTarget('face.smile', { svg: 'face', selector: '#m-smile' });
registry.registerTargets({                     // bulk form
  'face.mouth': { svg: 'face', selector: '#mouth' },
  hud:          { svg: 'hud',  selector: '#panel' },
});
registry.listTargets();                        // ['body', 'face.smile', ...]
```

Bindings are `{ three: 'objectName' }` or `{ svg: 'svgName', selector: '#sel' }`
(malformed bindings throw `[agent-stage.registry]` errors). A track target
resolves **exact-match first**, then the **longest dot-prefix**:
`'body.position.y'` → binding `body` + rest `position.y`; `'face.smile'`
exact-matches binding `face.smile`.

Compact tracks (compiler rewrites them to canonical form; the compile context
needs `ctx.registry`):

```jsonc
// three: dotted target + tuple keys [t, v, ease?]
{ "target": "body.position.y", "keys": [[0, 0], [0.4, 0.2, "easeOutCubic"]] }

// three: multi-prop keys map
{ "target": "body", "keys": {
    "position.y": [[0, 0], [1, 1]],
    "rotation.x": [[0, 0], [1, 0.5, "backOut"]]
} }

// svg: element target + keyframe objects ("keyframes" is an alias of "keys")
{ "target": "face.smile", "keys": [
    { "t": 0,    "opacity": 0 },
    { "t": 0.25, "opacity": 1, "ease": "backOut" }
] }
```

`begin` / `loop` / `options` pass through to the canonical track. Unknown
targets throw a clear error naming the target and suggesting
`registry.listTargets()`.

**Legacy-but-supported:** the explicit `"engine": "prop"` / `"engine": "waapi"`
forms with `target` / `svg` + `selector` keep working unchanged.

### Loop mapping

`repeat` wraps `t % dur`; `pingpong` folds `t` across `2·dur`. Applied inside
each engine, so both live ticks and seeks behave identically.

---

## Channels & policies (`AgentDriver`)

Channels are parallel lanes. Same-channel playback follows a blend policy:

| Policy      | Behavior |
|-------------|----------|
| `interrupt` | Stop the current instance; the new one plays now. (default) |
| `queue`     | FIFO enqueue; plays when the current instance finishes. |
| `crossfade` | Start now; stop the old instance after `fadeTime` (default 0.3 s). |

Per-call: `driver.play(name, { blend, fadeTime, channel, loop, rate })` or set
a channel default: `driver.setChannelBlend('face', 'crossfade', 0.25)`.

Convenience intents: `emote`→`face`, `motion`→`body`, `hud`→`hud`,
`state(name, on)`→`state`, `say(text)`→`speak` + writes into the pack's
`text` target. Every `play` returns `{ instance, finished }`; the driver emits
`play / pause / stop / finished / queued / queue-empty` events (HUDs subscribe
to these).

### Registry

```js
registry.registerAsset('svg', 'face', faceMarkupOrUrl);
registry.registerAsset('three', 'body', (threeLayer) => buildRobot());
registry.registerPacks([idlePack, greetPack]);   // objects or URLs
await registry.instantiate(agg);                 // mount SVGs, add 3D objects
await registry.compileAll(ctx);                  // compile every pack
const pack = registry.getPack('greet');          // CompiledPack
```

Packs registered as URL strings are fetched and name-keyed lazily by
`compileAll()`. Object packs compile lazily on first `getPack()` if a context
was cached (`registry.setContext(ctx)` — done by `createAgentStage()`).

### Definitions and instances

`compile()` returns an **immutable definition**. `definition.createInstance(loop?)`
builds an isolated playback instance (fresh engines, own playhead and
`finished` promise) — the driver does this on every `play()`, so the same pack
on several channels never shares state. A `play({loop})` override never
mutates the definition. The legacy `pack.play()/seek()/tick()/finished`
surface still works (an internal default instance).

### Authoring reusable SVG assets

- Give every animated/selected element an **id** — pack selectors target it.
- Embed CSS keyframes (e.g. blinking) and SMIL morphs directly in the asset;
  they animate with zero pack tracks and (SMIL sync) seek deterministically.
- Prefer `fill="freeze"` + `begin="0s"` on SMIL elements that packs will sync.
- Avoid `<foreignObject>`; rasterization (TextureBridge + export) is
  markup-only.

---

## Worked example — a full `greet` pack

```jsonc
{
  "name": "greet",
  "channel": "body",
  "duration": 2.2,
  "loop": false,
  "tracks": [
    { "engine": "prop", "target": "body",
      "props": {
        "rotation:x": [
          { "t": 0,   "v": 0 },
          { "t": 0.5, "v": 0.42, "ease": "easeOutCubic" },
          { "t": 1.1, "v": 0,    "ease": "easeInOutCubic" }
        ],
        "position:y": [
          { "t": 0,   "v": 0 },
          { "t": 0.4, "v": 0.12, "ease": "easeOutCubic" },
          { "t": 1.0, "v": 0,    "ease": "easeOutCubic" }
        ]
      } },
    { "engine": "smil", "svg": "face", "mode": "sync",
      "begin": 0.3, "duration": 0.5 },
    { "engine": "waapi", "svg": "face", "selector": "#m-smile",
      "keyframes": [
        { "t": 0,   "opacity": 0 },
        { "t": 0.3, "opacity": 1, "ease": "easeOutCubic" },
        { "t": 1.8, "opacity": 1 },
        { "t": 2.1, "opacity": 0, "ease": "easeInCubic" }
      ] },
    { "engine": "waapi", "svg": "face", "selector": "#m-neutral",
      "keyframes": [
        { "t": 0,   "opacity": 1 },
        { "t": 0.3, "opacity": 0, "ease": "easeInCubic" },
        { "t": 1.8, "opacity": 0 },
        { "t": 2.1, "opacity": 1, "ease": "easeOutCubic" }
      ] },
    { "engine": "waapi", "svg": "nametag", "selector": "#tag",
      "begin": 0.2,
      "keyframes": [
        { "t": 0,    "opacity": 0, "transform": "translateY(-6px) scale(0.85)" },
        { "t": 0.45, "opacity": 1, "transform": "translateY(0px) scale(1)", "ease": "backOut" },
        { "t": 1.4,  "opacity": 1, "transform": "translateY(0px) scale(1)" },
        { "t": 1.9,  "opacity": 0, "transform": "translateY(-6px) scale(0.9)", "ease": "easeInCubic" }
      ] }
  ]
}
```

Play it: `driver.play('greet')` → awaits `finished` → chain the next pack.

---

## Export formats

| Format     | Alpha | Method | Deterministic | Choose when |
|------------|-------|--------|---------------|-------------|
| **WebM**   | ✅ per-pixel (VP9/VP8) | MediaRecorder real-time capture | real-time (machine-speed dependent pacing, not content) | Transparent-video deliverables (web overlays, editors that take alpha WebM). Default/alpha path. |
| **PNG seq**| ✅ per-frame | Seek-driven offline render → ZIP of PNGs + `sequence.json` | ✅ frame-exact | Maximum quality / compositing in external tools / no-WebM browsers. |
| **MP4**    | ❌ (flattened, bg forced `#101014`) | Seek-driven offline render + WebCodecs H.264 | ✅ frame-exact | Universal playback, small files, social/emails. |

Formats: `webm` (480p+), `png-seq`, `mp4` (needs WebCodecs; dimensions rounded
to even). Probe with `ExportManager.supported()`. Pass
`packsToPlay: [{ name, at }]` or `{ "0": "idle", "1.5": "greet" }` to capture
a scripted show; progress via `onProgress`; cancel via
`signal: { cancelled }`.
