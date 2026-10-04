# The agent-stage Kit — `createMotion(spec)`

The kit is the motion-design layer of agent-stage: one declarative spec object in, one deterministic
animated piece (Three.js scene + SVG overlay + post effects) out. It is aimed at the case
"stunning animation in a few dozen lines" — interactive avatar behavior belongs to the engine
layer (`docs/pack-schema.md`).

```js
import { createMotion, rng, range } from 'agent-stage/kit/index.js';

const m = await createMotion({ ...spec });
m.play();       // live playback
m.render(4.2);  // frame-accurate seek — same function the render tool uses
```

Everything is a pure function of logical time: `render(t)` twice at the same `t` produces the
same frame. That is what makes headless verification (`tools/render.mjs`) and export reliable.

## Spec reference

| field | type | notes |
|---|---|---|
| `size` | `[W, H]` | design size; SVG `viewBox` + anchors live in these units. Default `[1280, 720]` |
| `duration` | number | seconds. Derived from the score (`max(at + dur)`) when omitted |
| `camera` | object | orbit camera: `azimuth`, `elevation` (degrees), `distance`, `fov`, `lookAt: [x,y,z]` |
| `background` | `[top, bottom]` or color | vertical gradient sky dome. Default `['#1a2a52', '#05070f']` |
| `bloom` | `{ strength, radius, threshold }` | defaults `0.35 / 0.4 / 0.92` |
| `vignette` | number 0..1 | static radial vignette |
| `objects` | `{ name: def }` | 3D scene graph (below) |
| `lights` | `{ name: def }` | `directional` / `point` / `ambient`; `intensity` + `color` animatable |
| `svg` | string | SVG markup (forgiving parse — bare attributes, no xmlns needed) |
| `anchors` | `{ '#sel': { to, offset? } }` | pin SVG groups to 3D objects (screen-projected) |
| `score` | array of cues | the animation (below) |

### Objects

`{ type, parent?, pos?, rot? (degrees XYZ), scale?, focus?, material?, ...typeParams }`

- `icosahedron { radius, detail }` · `torus { radius, tube, seg }` · `sphere { radius }` ·
  `ring { inner, outer }` (XY plane; `rot: [-90, 0, 0]` lays it flat) · `group` ·
  `particles { count, spread, flatten?, swirl?, size?, color?, glow?, opacity?, seed? }`
- `parent: name` nests the object under a named parent (groups are the usual parents).
- `focus: false` marks the object as excluded from framing metadata (informational in v1).

**Material presets** (`material: { preset, color, glow, opacity, roughness, side }`):

| preset | look | `glow` means |
|---|---|---|
| `neon` | lit standard material, emissive | `emissiveIntensity` (bloom picks it up) |
| `basic` | unlit, tone-mapped off | color multiplied > 1 for HDR bloom pickup |
| `wire` | wireframe | color multiplier |
| `glass` | transparent standard | color multiplier |
| `additive` | additive blending, double-sided | color multiplier |

**Particles** are a custom point shader, seeded (`seed`) so the field is deterministic. `swirl`
rotates the field around Y over time; `burst` (animatable) pushes points outward
(`pos *= 1 + burst * aRand`); `uTime` is logical time, never wall clock.

### The score

A cue animates one or more props of one or more targets between two values:

```js
{ at: 5.6, dur: 1.2, target: 'core', scale: [1, 0.8], glow: [0.5, 2.4], ease: 'easeInCubic' }
{ at: 6.8, dur: 1.6, target: 'camera', keys: { shake: [[0,0],[0.06,8,'easeOutQuad'],[1,0]] } }
{ at: 3.6, dur: 0.4, target: '.tick', stagger: 0.012, opacity: [0, 0.75] }
{ at: 4.6, dur: 'end', target: '#bar3', scaleY: [0.8, 0.3], loop: 'pingpong', every: 0.45 }
```

- `at` (seconds) + `dur` (seconds or `'end'` = until the piece ends). `stagger` delays the i-th
  element of an array target by `i * stagger`.
- Value forms: a `[from, to]` pair (optionally `[from, to, ease]`), or a `keys` map with
  keyframe lists `[[t, v], [t, v, ease], ...]` where `t` is normalized 0..1 across the cue.
- `ease` (pair tween) / per-keyframe ease (keys) use the validated easing library —
  an unknown name throws with a "did you mean" suggestion. Full list via `easingNames()`
  (exported from the kit): linear, quad/cubic/quart/sine/expo in-out variants, back in/out,
  elasticOut, bounceOut, step.
- **Target resolution order:** 3D object/light name → `'camera'` → `'fx'` → CSS selector
  against the SVG root. Unknown names/selectors/props are *warnings*, not errors — they show
  up in `motion.warnings` and the render tool report.
- **Stacking:** for each (target, prop), the last cue that has *started* wins; before any cue
  starts, the first cue's `from` value is applied (elements stay hidden until their cue begins);
  after a cue's window it holds its `to` value until a later cue takes over.
- **Loops:** `loop: 'pingpong'` oscillates between `from` and `to` from cue start, with period
  `every` (default: the cue's own duration). Pairs naturally with `dur: 'end'`.

**Animatable props by target kind:**

- 3D object: `scale`, `scaleX/Y/Z`, `opacity`, `glow`, `burst` (particles), `rotation.x/y/z`
  (degrees), `position.x/y/z`, `color` (hex pair `[from, to]`)
- light: `intensity`, `color`
- camera: `azimuth`, `elevation`, `distance`, `fov`, `shake` (deterministic hash noise)
- fx: `fade` (black overlay opacity), `flash` (white overlay opacity), `bloom` (absolute strength)
- SVG element: `opacity`, `x`, `y`, `rotate`, `scale`, `scaleX`, `scaleY`, `blur`, `draw`

### SVG layer

The overlay is sized to the viewport with `preserveAspectRatio="xMidYMid slice"`, so design
coordinates (the `size`/`viewBox` units) stay stable at any render resolution.

- `data-split` on a `<text>` splits it into per-character `<tspan class="ch">` — animate
  `#title .ch` with `stagger` for letter-by-letter reveals.
- `data-origin="center bottom" | "left center" | ...` sets the transform origin (default:
  fill-box center — a symmetric group like a tick ring rotates around its own center).
- `draw: [0, 1]` draws strokes on: the kit measures `getTotalLength()` and animates
  `stroke-dashoffset`.
- `blur`, `opacity`, and the transform channels compose into CSS `transform`/`filter`.
- **Anchors**: `anchors: { '#c1': { to: 'core', offset: [1, 0.9, 0] } }` pins an SVG group to a
  3D object — each frame the object's world position (plus offset) is projected to design
  coordinates and written as an *attribute* transform on the group, so inner elements can
  still animate with CSS transforms. Callouts/leader-lines that track 3D objects are one
  line each.

### Headless capture contract (used by `tools/render.mjs`)

- `?capture` — `play()` becomes a no-op and the motion is exposed as
  `window.__agentStageMotion = { duration, size, designSize, warnings, named, render(t), ... }`
- `?size=WxH` — render size override (canvas), while design coordinates stay untouched
- In capture mode the renderer uses `preserveDrawingBuffer` + pixelRatio 1 so screenshots and
  pixel stats are exact.

## Helpers

- `rng(seed)` — mulberry32 PRNG; returns a deterministic `() => [0, 1)` function.
- `range(n, fn)` — `Array.from({ length: n }, (_, i) => fn(i))`.

## Verifying a piece

```bash
node tools/render.mjs examples/my-piece --chrome /path/to/chrome --frames 12
```

Prints a JSON report (`ok`, `issues`, `warnings`, `console`, frame paths, contact sheet) and
exits non-zero on failure — wire it into your agent loop as the feedback signal.
