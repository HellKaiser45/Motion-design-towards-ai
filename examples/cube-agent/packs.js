/**
 * CU-13 animation packs — pure data, exactly what an AI agent would emit.
 *
 * Channels used by the flagship show:
 *   body    — cube motion (interrupt blend)
 *   face    — spare lane (emote() intent)
 *   camera  — cinematic rig: camPivot (orbit) + camArm (dolly/pitch)
 *   lights  — key/rim/fill intensity + color choreography
 *   fx      — holographic orbit rig + panel reveals
 *
 * Camera rig layout (see main.js):
 *   camPivot at world origin (rotation:y = orbit)
 *   └─ camArm at (0, 0.7, 4.4), rotation:x = pitch
 *      └─ stage.camera at origin, looking down -Z (toward the pivot)
 * One-shot camera packs chain end-to-end: each starts where the previous
 * ended, so there is no visible cut. Interrupts restore via engine.stop()
 * and the show's recovery path immediately re-seats camIdle.
 */

// 120 BPM — every keyframe grid below aligns to a 0.5 s beat.
const BEAT = 0.5;

/** Merge keyframe sets, sort by t, drop duplicate times (later wins). */
function kfMerge(...sets) {
  const all = sets.flat().sort((a, b) => a.t - b.t);
  return all.filter((k, i) => i === 0 || k.t !== all[i - 1].t);
}

/** Generate one bounce-with-squash-and-stretch keyframe set for a beat. */
function bounceBeat(t0, height) {
  return [
    { t: t0, v: 0 },
    // anticipation: squash (handled by scale tracks at the same times)
    { t: t0 + 0.10, v: height * 0.18, ease: 'easeOutCubic' }, // lazy push-off
    { t: t0 + 0.22, v: height, ease: 'easeOutQuad' },         // apex
    { t: t0 + 0.36, v: 0, ease: 'easeInQuad' },               // fall
    { t: t0 + 0.40, v: -0.06, ease: 'linear' },               // landing sink
    { t: t0 + 0.50, v: 0, ease: 'backOut' },                  // recover
  ];
}

/** Squash (-y / +xz) and stretch (+y / -xz) profile matching bounceBeat. */
function squashBeat(t0) {
  return [
    { t: t0, v: 1 },
    { t: t0 + 0.10, v: 0.76, ease: 'easeOutQuad' },  // anticipation squash
    { t: t0 + 0.22, v: 1.26, ease: 'easeOutQuad' },  // stretch in flight
    { t: t0 + 0.36, v: 1.18, ease: 'linear' },
    { t: t0 + 0.42, v: 0.72, ease: 'linear' },       // landing squash
    { t: t0 + 0.56, v: 1.08, ease: 'backOut' },      // overshoot
    { t: t0 + 0.68, v: 1, ease: 'easeOutCubic' },
  ];
}

/** Antenna emissive flash per beat: cyan base -> white pop -> cyan. */
function flashBeat(t0, dur = 2) {
  return [
    { t: t0, v: 0.13 }, { t: t0 + 0.06, v: 1, ease: 'easeOutQuad' },
    { t: t0 + 0.22, v: 0.13, ease: 'easeInQuad' },
  ];
}

function flashBeatG(t0) {
  return [
    { t: t0, v: 0.83 }, { t: t0 + 0.06, v: 1, ease: 'easeOutQuad' },
    { t: t0 + 0.22, v: 0.83, ease: 'easeInQuad' },
  ];
}

function flashBeatB(t0) {
  return [
    { t: t0, v: 0.93 }, { t: t0 + 0.06, v: 1, ease: 'easeOutQuad' },
    { t: t0 + 0.22, v: 0.93, ease: 'easeInQuad' },
  ];
}

/**
 * Face expression cycling: one expression group per beat inside a 2 s loop.
 * Crossfade helper — opacity keys for `sel` visible in [tIn, tOut].
 */
function faceBeat(sel, tIn, tOut, pop = false) {
  const kfs = [
    { t: Math.max(0, tIn - 0.08), opacity: 0 },
    { t: tIn, opacity: 1, ease: pop ? 'backOut' : 'easeOutCubic' },
    { t: tOut - 0.08, opacity: 1 },
    { t: tOut, opacity: 0, ease: 'easeInCubic' },
  ];
  if (tIn === 0) kfs[0] = { t: 0, opacity: 1 };
  return { engine: 'waapi', svg: 'face', selector: sel, keyframes: kfs };
}

export const packs = [

  // ------------------------------------------------------------ idle ----
  {
    name: 'idle',
    channel: 'body',
    loop: 'repeat',
    duration: 4,
    tracks: [
      { engine: 'prop', target: 'body', loop: 'pingpong',
        props: { 'position:y': [{ t: 0, v: 0 }, { t: 2, v: 0.12, ease: 'easeInOutCubic' }] } },
      { engine: 'prop', target: 'antenna',
        props: { 'rotation:z': [
          { t: 0, v: 0 }, { t: 1, v: 0.14, ease: 'easeInOutQuad' },
          { t: 2, v: 0 }, { t: 3, v: -0.14, ease: 'easeInOutQuad' }, { t: 4, v: 0 },
        ] } },
    ],
  },

  // ------------------------------------------------------------- boot ----
  // Scene 1: materialize in the spotlight. Scale 0 -> 1 with a backOut pop,
  // emissive flash on the shell, boot face, spotlight fade-up, nametag type-in.
  {
    name: 'boot',
    channel: 'body',
    loop: false,
    duration: 5,
    tracks: [
      { engine: 'prop', target: 'body',
        props: {
          'scale:x': [{ t: 0, v: 0.001 }, { t: 1.9, v: 0.001 }, { t: 2.45, v: 1, ease: 'backOut' }],
          'scale:y': [{ t: 0, v: 0.001 }, { t: 1.9, v: 0.001 }, { t: 2.45, v: 1, ease: 'backOut' }],
          'scale:z': [{ t: 0, v: 0.001 }, { t: 1.9, v: 0.001 }, { t: 2.45, v: 1, ease: 'backOut' }],
          'material.emissive:r': [
            { t: 0, v: 0 }, { t: 1.9, v: 0 }, { t: 2.05, v: 0.55, ease: 'easeOutQuad' },
            { t: 2.9, v: 0, ease: 'easeInOutCubic' }, { t: 5, v: 0 },
          ],
          'material.emissive:g': [
            { t: 0, v: 0 }, { t: 1.9, v: 0 }, { t: 2.05, v: 0.85, ease: 'easeOutQuad' },
            { t: 2.9, v: 0, ease: 'easeInOutCubic' }, { t: 5, v: 0 },
          ],
          'material.emissive:b': [
            { t: 0, v: 0 }, { t: 1.9, v: 0 }, { t: 2.05, v: 0.95, ease: 'easeOutQuad' },
            { t: 2.9, v: 0, ease: 'easeInOutCubic' }, { t: 5, v: 0 },
          ],
          'position:y': [{ t: 0, v: 0 }, { t: 2.45, v: 0 }, { t: 3.9, v: 0.1, ease: 'easeInOutCubic' }, { t: 5, v: 0.06 }],
        } },
      // spotlight + rim + fill fade up (lights channel content lives here as a
      // separate pack — see 'lights-boot' — so the lights lane stays reusable)
      { engine: 'waapi', svg: 'face', selector: '#m-boot',
        keyframes: [
          { t: 0, opacity: 0 }, { t: 0.4, opacity: 1, ease: 'easeOutCubic' },
          { t: 3.1, opacity: 1 }, { t: 3.9, opacity: 0, ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'face', selector: '#m-neutral',
        keyframes: [
          { t: 0, opacity: 0 }, { t: 3.9, opacity: 0 }, { t: 4.3, opacity: 1, ease: 'easeOutCubic' },
        ] },
      // nametag: card pops, cover slides off in typewriter steps, cursor blinks
      { engine: 'waapi', svg: 'nametag', selector: '#tag',
        keyframes: [
          { t: 0, opacity: 0, transform: 'translateY(-10px) scale(0.8)' },
          { t: 1.1, opacity: 1, transform: 'translateY(0px) scale(1)', ease: 'backOut' },
          { t: 5, opacity: 1, transform: 'translateY(0px) scale(1)' },
        ] },
      { engine: 'waapi', svg: 'nametag', selector: '#cover',
        begin: 1.5,
        keyframes: [
          { t: 0, transform: 'translateX(0px)' },
          { t: 0.22, transform: 'translateX(24px)' },
          { t: 0.44, transform: 'translateX(48px)' },
          { t: 0.66, transform: 'translateX(72px)' },
          { t: 0.88, transform: 'translateX(96px)' },
          { t: 1.10, transform: 'translateX(120px)' },
          { t: 1.32, transform: 'translateX(144px)' },
          { t: 1.54, transform: 'translateX(168px)' },
          { t: 1.76, transform: 'translateX(190px)' },
          { t: 2.0, transform: 'translateX(210px)', ease: 'easeOutCubic' },
          { t: 3.5, transform: 'translateX(210px)' },
          { t: 3.9, transform: 'translateX(0px)', ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'nametag', selector: '#cursor',
        begin: 1.5,
        keyframes: [
          { t: 0, opacity: 1 }, { t: 0.25, opacity: 0 }, { t: 0.5, opacity: 1 },
          { t: 0.75, opacity: 0 }, { t: 1, opacity: 1 }, { t: 1.25, opacity: 0 },
          { t: 1.5, opacity: 1 }, { t: 1.75, opacity: 0 }, { t: 2, opacity: 0 },
        ] },
    ],
  },

  {
    name: 'lights-boot',
    channel: 'lights',
    loop: false,
    duration: 3,
    tracks: [
      { engine: 'prop', target: 'keyLight',
        props: { 'intensity': [{ t: 0, v: 0 }, { t: 1.8, v: 2.6, ease: 'easeOutCubic' }, { t: 3, v: 2.2, ease: 'easeInOutCubic' }] } },
      { engine: 'prop', target: 'rimLight',
        props: { 'intensity': [{ t: 0, v: 0 }, { t: 2.2, v: 1.1, ease: 'easeInOutCubic' }] } },
      { engine: 'prop', target: 'fillLight',
        props: { 'intensity': [{ t: 0, v: 0 }, { t: 2.6, v: 0.55, ease: 'easeInOutCubic' }] } },
    ],
  },

  // ------------------------------------------------------------ greet ----
  // (button pack — SMIL-driven smile morph; kept from v2)
  {
    name: 'greet',
    channel: 'body',
    loop: false,
    duration: 2.4,
    tracks: [
      { engine: 'prop', target: 'body',
        props: {
          'rotation:x': [
            { t: 0, v: 0 }, { t: 0.5, v: 0.42, ease: 'easeOutCubic' },
            { t: 1.1, v: 0, ease: 'easeInOutCubic' },
          ],
          'position:y': [
            { t: 0, v: 0 }, { t: 0.4, v: 0.14, ease: 'easeOutCubic' },
            { t: 1.0, v: 0, ease: 'easeOutCubic' },
          ],
        } },
      { engine: 'smil', svg: 'face', mode: 'sync', begin: 0.3, duration: 0.5 },
      { engine: 'waapi', svg: 'face', selector: '#m-smile',
        keyframes: [
          { t: 0, opacity: 0 }, { t: 0.3, opacity: 1, ease: 'easeOutCubic' },
          { t: 1.9, opacity: 1 }, { t: 2.3, opacity: 0, ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'face', selector: '#m-neutral',
        keyframes: [
          { t: 0, opacity: 1 }, { t: 0.3, opacity: 0, ease: 'easeInCubic' },
          { t: 1.9, opacity: 0 }, { t: 2.3, opacity: 1, ease: 'easeOutCubic' },
        ] },
      { engine: 'waapi', svg: 'nametag', selector: '#tag', begin: 0.2,
        keyframes: [
          { t: 0, opacity: 0, transform: 'translateY(-8px) scale(0.85)' },
          { t: 0.45, opacity: 1, transform: 'translateY(0px) scale(1)', ease: 'backOut' },
          { t: 1.5, opacity: 1, transform: 'translateY(0px) scale(1)' },
          { t: 2.0, opacity: 0, transform: 'translateY(-8px) scale(0.9)', ease: 'easeInCubic' },
        ] },
    ],
  },

  // ----------------------------------------------------- hop (scene 2) ----
  // Three squash-and-stretch hops toward the camera, big grin, wink payoff.
  {
    name: 'hop',
    channel: 'body',
    loop: false,
    duration: 4.8,
    tracks: [
      { engine: 'prop', target: 'body',
        props: {
          'position:y': kfMerge(
            bounceBeat(0, 0.55), bounceBeat(1.4, 0.55), bounceBeat(2.3, 0.62),
            [{ t: 3.4, v: 0 }, { t: 3.9, v: 0.1, ease: 'easeInOutCubic' }, { t: 4.8, v: 0 }],
          ),
          'position:z': [
            { t: 0, v: 0 }, { t: 0.36, v: -0.28, ease: 'easeOutQuad' },
            { t: 0.5, v: -0.28 }, { t: 1.26, v: -0.56, ease: 'easeOutQuad' },
            { t: 1.4, v: -0.56 }, { t: 2.16, v: -0.88, ease: 'easeOutQuad' },
            { t: 2.3, v: -0.88 }, { t: 4.8, v: -0.88 },
          ],
          'scale:y': [
            ...squashBeat(0), ...squashBeat(1.4), ...squashBeat(2.3),
            { t: 3.4, v: 1 }, { t: 4.8, v: 1 },
          ],
          'scale:x': [
            ...squashBeat(0).map((k) => ({ ...k, v: k.t === 0 ? 1 : 2 - k.v })),
            ...squashBeat(1.4).map((k) => ({ ...k, v: k.t === 0 ? 1 : 2 - k.v })),
            ...squashBeat(2.3).map((k) => ({ ...k, v: k.t === 0 ? 1 : 2 - k.v })),
            { t: 3.4, v: 1 }, { t: 4.8, v: 1 },
          ],
          'rotation:x': [
            { t: 0, v: 0 }, { t: 0.22, v: -0.18, ease: 'easeOutQuad' },
            { t: 0.5, v: 0.06, ease: 'easeInQuad' }, { t: 2.3, v: 0.06 },
            { t: 3.0, v: 0, ease: 'easeInOutCubic' }, { t: 4.8, v: 0 },
          ],
        } },
      { engine: 'waapi', svg: 'face', selector: '#m-grin',
        keyframes: [
          { t: 0, opacity: 0 }, { t: 0.3, opacity: 1, ease: 'backOut' },
          { t: 3.6, opacity: 1 }, { t: 4.0, opacity: 0, ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'face', selector: '#m-wink',
        keyframes: [
          { t: 0, opacity: 0 }, { t: 3.9, opacity: 0 }, { t: 4.05, opacity: 1, ease: 'backOut' },
          { t: 4.5, opacity: 1 }, { t: 4.7, opacity: 0, ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'face', selector: '#m-neutral',
        keyframes: [
          { t: 0, opacity: 1 }, { t: 0.3, opacity: 0, ease: 'easeInCubic' },
          { t: 4.7, opacity: 0 }, { t: 4.8, opacity: 1, ease: 'linear' },
        ] },
      // HUD slides in with the greeting
      { engine: 'waapi', svg: 'hud', selector: '#card',
        begin: 0.4,
        keyframes: [
          { t: 0, opacity: 0, transform: 'translateY(26px)' },
          { t: 0.6, opacity: 1, transform: 'translateY(0px)', ease: 'backOut' },
          { t: 4.4, opacity: 1, transform: 'translateY(0px)' },
        ] },
    ],
  },

  // ------------------------------------------------------------- think ----
  {
    name: 'think',
    channel: 'body',
    loop: 'repeat',
    duration: 2,
    tracks: [
      { engine: 'prop', target: 'antennaTip',
        props: {
          'material.emissive:r': [{ t: 0, v: 0.13 }, { t: 1, v: 1, ease: 'easeInOutQuad' }, { t: 2, v: 0.13 }],
          'material.emissive:g': [{ t: 0, v: 0.83 }, { t: 1, v: 1, ease: 'easeInOutQuad' }, { t: 2, v: 0.83 }],
          'material.emissive:b': [{ t: 0, v: 0.93 }, { t: 1, v: 1, ease: 'easeInOutQuad' }, { t: 2, v: 0.93 }],
        } },
      { engine: 'prop', target: 'body',
        props: { 'rotation:z': [{ t: 0, v: 0 }, { t: 1, v: 0.06, ease: 'easeInOutQuad' }, { t: 2, v: 0 }] } },
      { engine: 'waapi', svg: 'face', selector: '#m-think',
        keyframes: [
          { t: 0, opacity: 0 }, { t: 0.2, opacity: 1, ease: 'easeOutCubic' },
          { t: 1.8, opacity: 1 }, { t: 2, opacity: 0, ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'face', selector: '#m-neutral',
        keyframes: [
          { t: 0, opacity: 1 }, { t: 0.2, opacity: 0, ease: 'easeInCubic' },
          { t: 1.8, opacity: 0 }, { t: 2, opacity: 1, ease: 'easeOutCubic' },
        ] },
    ],
  },

  // ------------------------------------------------------------- speak ----
  {
    name: 'speak',
    channel: 'body',
    loop: 'repeat',
    duration: 0.8,
    text: { svg: 'hud', selector: '#state-label' },
    tracks: [
      { engine: 'waapi', svg: 'face', selector: '#m-talk-open',
        keyframes: [
          { t: 0, opacity: 0 }, { t: 0.25, opacity: 1, ease: 'easeInQuad' },
          { t: 0.45, opacity: 0, ease: 'easeOutQuad' },
          { t: 0.65, opacity: 1, ease: 'easeInQuad' }, { t: 0.8, opacity: 0 },
        ] },
      { engine: 'waapi', svg: 'face', selector: '#m-talk-closed',
        keyframes: [
          { t: 0, opacity: 1 }, { t: 0.25, opacity: 0 },
          { t: 0.45, opacity: 1 }, { t: 0.65, opacity: 0 }, { t: 0.8, opacity: 1 },
        ] },
      { engine: 'waapi', svg: 'face', selector: '#m-neutral',
        keyframes: [{ t: 0, opacity: 0 }, { t: 0.8, opacity: 0 }] },
      { engine: 'prop', target: 'body',
        props: { 'position:y': [{ t: 0, v: 0 }, { t: 0.4, v: 0.05, ease: 'easeOutCubic' }, { t: 0.8, v: 0 }] } },
    ],
  },

  // ---------------------------------------------------------- surprise ----
  {
    name: 'surprise',
    channel: 'body',
    loop: false,
    duration: 1.2,
    tracks: [
      { engine: 'prop', target: 'body',
        props: {
          'position:z': [
            { t: 0, v: 0 }, { t: 0.15, v: -0.35, ease: 'easeOutCubic' },
            { t: 1.2, v: 0, ease: 'easeInOutCubic' },
          ],
          'rotation:x': [{ t: 0, v: 0 }, { t: 0.15, v: -0.2, ease: 'easeOutCubic' }, { t: 1.0, v: 0 }],
        } },
      { engine: 'waapi', svg: 'face', selector: '#m-surprise',
        keyframes: [
          { t: 0, opacity: 0 }, { t: 0.15, opacity: 1, ease: 'backOut' },
          { t: 0.9, opacity: 1 }, { t: 1.2, opacity: 0, ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'face', selector: '#m-neutral',
        keyframes: [
          { t: 0, opacity: 1 }, { t: 0.15, opacity: 0, ease: 'easeInCubic' },
          { t: 0.9, opacity: 0 }, { t: 1.2, opacity: 1, ease: 'easeOutCubic' },
        ] },
    ],
  },

  // ------------------------------------------------------------- dance ----
  // Scene 4 centerpiece. 2 s loop = 4 beats @ 120 BPM: anticipation -> jump
  // with stretch -> landing squash with overshoot; antenna flashes white on
  // every beat; face cycles grin -> wink -> star -> heart; lights pulse warm.
  {
    name: 'dance',
    channel: 'body',
    loop: 'repeat',
    duration: 2,
    tracks: [
      { engine: 'prop', target: 'body',
        props: {
          'position:y': kfMerge(
            bounceBeat(0, 0.32), bounceBeat(0.5, 0.32),
            bounceBeat(1.0, 0.32), bounceBeat(1.5, 0.32),
            [{ t: 2, v: 0 }],
          ),
          'scale:y': [
            ...squashBeat(0), ...squashBeat(0.5), ...squashBeat(1.0), ...squashBeat(1.5),
            { t: 2, v: 1 },
          ],
          'scale:x': [
            ...squashBeat(0).map((k) => ({ ...k, v: k.t === 0 ? 1 : 2 - k.v })),
            ...squashBeat(0.5).map((k) => ({ ...k, v: k.t === 0 ? 1 : 2 - k.v })),
            ...squashBeat(1.0).map((k) => ({ ...k, v: k.t === 0 ? 1 : 2 - k.v })),
            ...squashBeat(1.5).map((k) => ({ ...k, v: k.t === 0 ? 1 : 2 - k.v })),
            { t: 2, v: 1 },
          ],
          'rotation:y': [
            { t: 0, v: 0 }, { t: 0.25, v: 0.3, ease: 'easeOutQuad' },
            { t: 0.5, v: 0, ease: 'easeInQuad' },
            { t: 0.75, v: -0.3, ease: 'easeOutQuad' },
            { t: 1.0, v: 0, ease: 'easeInQuad' },
            { t: 1.25, v: 0.3, ease: 'easeOutQuad' },
            { t: 1.5, v: 0, ease: 'easeInQuad' },
            { t: 1.75, v: -0.3, ease: 'easeOutQuad' },
            { t: 2, v: 0, ease: 'easeInQuad' },
          ],
        } },
      { engine: 'prop', target: 'antenna',
        props: { 'rotation:z': [
          { t: 0, v: 0 }, { t: 0.25, v: 0.3, ease: 'easeOutQuad' },
          { t: 0.5, v: 0, ease: 'easeInQuad' }, { t: 0.75, v: -0.3, ease: 'easeOutQuad' },
          { t: 1.0, v: 0, ease: 'easeInQuad' }, { t: 1.25, v: 0.3, ease: 'easeOutQuad' },
          { t: 1.5, v: 0, ease: 'easeInQuad' }, { t: 1.75, v: -0.3, ease: 'easeOutQuad' },
          { t: 2, v: 0, ease: 'easeInQuad' },
        ] } },
      { engine: 'prop', target: 'antennaTip',
        props: {
          'material.emissive:r': [
            ...flashBeat(0), ...flashBeat(0.5), ...flashBeat(1.0), ...flashBeat(1.5), { t: 2, v: 0.13 },
          ],
          'material.emissive:g': [
            ...flashBeatG(0), ...flashBeatG(0.5), ...flashBeatG(1.0), ...flashBeatG(1.5), { t: 2, v: 0.83 },
          ],
          'material.emissive:b': [
            ...flashBeatB(0), ...flashBeatB(0.5), ...flashBeatB(1.0), ...flashBeatB(1.5), { t: 2, v: 0.93 },
          ],
        } },
      // face cycles one expression per beat
      faceBeat('#m-grin', 0, 0.5),
      faceBeat('#m-wink', 0.5, 1.0),
      faceBeat('#m-star', 1.0, 1.5, true),
      faceBeat('#m-heart', 1.5, 2.0, true),
      { engine: 'waapi', svg: 'face', selector: '#m-neutral',
        keyframes: [{ t: 0, opacity: 0 }, { t: 2, opacity: 0 }] },
      { engine: 'waapi', svg: 'hud', selector: '#eq',
        keyframes: [
          { t: 0, opacity: 1 }, { t: 0.4, opacity: 0.35, ease: 'easeInQuad' },
          { t: 1, opacity: 1, ease: 'easeOutQuad' },
          { t: 1.4, opacity: 0.35, ease: 'easeInQuad' }, { t: 2, opacity: 1, ease: 'easeOutQuad' },
        ] },
    ],
  },

  {
    name: 'lights-dance',
    channel: 'lights',
    loop: false,
    duration: 10,
    tracks: [
      { engine: 'prop', target: 'keyLight',
        props: {
          'intensity': [
            { t: 0, v: 2.2 }, { t: 0.5, v: 3.4, ease: 'easeOutQuad' },
            { t: 1.0, v: 2.4, ease: 'easeInQuad' },
            { t: 1.5, v: 3.4, ease: 'easeOutQuad' }, { t: 2.0, v: 2.4, ease: 'easeInQuad' },
            { t: 9.0, v: 2.4, ease: 'linear' }, { t: 10, v: 2.2, ease: 'easeInOutCubic' },
          ],
          'color:r': [{ t: 0, v: 1 }, { t: 2.5, v: 1 }, { t: 5, v: 0.85, ease: 'easeInOutQuad' }, { t: 8, v: 1, ease: 'easeInOutQuad' }, { t: 10, v: 1 }],
          'color:b': [{ t: 0, v: 0.9 }, { t: 2.5, v: 0.75 }, { t: 5, v: 0.95, ease: 'easeInOutQuad' }, { t: 8, v: 0.75, ease: 'easeInOutQuad' }, { t: 10, v: 0.9 }],
        } },
      { engine: 'prop', target: 'rimLight',
        props: {
          'intensity': [
            { t: 0, v: 1.1 }, { t: 0.5, v: 2.0, ease: 'easeOutQuad' }, { t: 1, v: 1.2, ease: 'easeInQuad' },
            { t: 1.5, v: 2.0, ease: 'easeOutQuad' }, { t: 2, v: 1.2, ease: 'easeInQuad' },
            { t: 10, v: 1.1, ease: 'linear' },
          ],
          'color:g': [{ t: 0, v: 0.83 }, { t: 5, v: 1, ease: 'easeInOutQuad' }, { t: 10, v: 0.83, ease: 'easeInOutQuad' }],
          'color:b': [{ t: 0, v: 0.93 }, { t: 5, v: 0.6, ease: 'easeInOutQuad' }, { t: 10, v: 0.93, ease: 'easeInOutQuad' }],
        } },
    ],
  },

  // -------------------------------------------------------- showcase (3) ----
  {
    name: 'showcase',
    channel: 'body',
    loop: false,
    duration: 6.5,
    tracks: [
      { engine: 'prop', target: 'body',
        props: {
          'position:z': [{ t: 0, v: -0.88 }, { t: 1.2, v: 0, ease: 'easeInOutCubic' }],
          'position:y': [
            { t: 0, v: 0 }, { t: 0.8, v: 0.22, ease: 'easeOutCubic' },
            { t: 2.0, v: 0.14, ease: 'easeInOutCubic' }, { t: 6.0, v: 0.14 },
            { t: 6.5, v: 0, ease: 'easeInOutCubic' },
          ],
          'rotation:y': [{ t: 0, v: 0 }, { t: 6.5, v: Math.PI * 2, ease: 'easeInOutCubic' }],
          'rotation:x': [{ t: 0, v: 0 }, { t: 1.0, v: -0.08, ease: 'easeOutCubic' }, { t: 5.4, v: -0.08 }, { t: 6.5, v: 0, ease: 'easeInOutCubic' }],
        } },
      { engine: 'waapi', svg: 'face', selector: '#m-smile',
        keyframes: [
          { t: 0, opacity: 0 }, { t: 0.5, opacity: 1, ease: 'easeOutCubic' },
          { t: 5.8, opacity: 1 }, { t: 6.4, opacity: 0, ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'face', selector: '#m-neutral',
        keyframes: [
          { t: 0, opacity: 1 }, { t: 0.5, opacity: 0, ease: 'easeInCubic' },
          { t: 6.4, opacity: 0 }, { t: 6.5, opacity: 1, ease: 'linear' },
        ] },
    ],
  },

  {
    name: 'holo-on',
    channel: 'fx',
    loop: false,
    duration: 6.5,
    tracks: [
      { engine: 'prop', target: 'holoOrbit',
        props: { 'rotation:y': [{ t: 0, v: 0 }, { t: 6.5, v: 2.6, ease: 'easeInOutQuad' }] } },
      { engine: 'prop', target: 'holo1', loop: 'pingpong',
        props: { 'position:y': [{ t: 0, v: 0 }, { t: 1.1, v: 0.14, ease: 'easeInOutQuad' }] } },
      { engine: 'prop', target: 'holo2', loop: 'pingpong',
        props: { 'position:y': [{ t: 0, v: 0.14 }, { t: 1.1, v: 0, ease: 'easeInOutQuad' }] } },
      { engine: 'prop', target: 'holo3', loop: 'pingpong',
        props: { 'position:y': [{ t: 0, v: 0 }, { t: 1.1, v: 0.14, ease: 'easeInOutQuad' }] } },
      { engine: 'waapi', svg: 'holo1', selector: '#panel',
        keyframes: [
          { t: 0, opacity: 0, transform: 'scale(0.6)' },
          { t: 0.7, opacity: 1, transform: 'scale(1)', ease: 'backOut' },
          { t: 5.7, opacity: 1, transform: 'scale(1)' },
          { t: 6.3, opacity: 0, transform: 'scale(0.85)', ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'holo2', selector: '#panel',
        begin: 0.5,
        keyframes: [
          { t: 0, opacity: 0, transform: 'scale(0.6)' },
          { t: 0.7, opacity: 1, transform: 'scale(1)', ease: 'backOut' },
          { t: 5.2, opacity: 1, transform: 'scale(1)' },
          { t: 5.8, opacity: 0, transform: 'scale(0.85)', ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'holo3', selector: '#panel',
        begin: 1.0,
        keyframes: [
          { t: 0, opacity: 0, transform: 'scale(0.6)' },
          { t: 0.7, opacity: 1, transform: 'scale(1)', ease: 'backOut' },
          { t: 4.7, opacity: 1, transform: 'scale(1)' },
          { t: 5.3, opacity: 0, transform: 'scale(0.85)', ease: 'easeInCubic' },
        ] },
    ],
  },

  // ------------------------------------------------------------ finale ----
  {
    name: 'finale',
    channel: 'body',
    loop: false,
    duration: 5.2,
    tracks: [
      { engine: 'prop', target: 'body',
        props: {
          'position:z': [{ t: 0, v: 0 }, { t: 0.2, v: -0.25, ease: 'backOut' }, { t: 5.2, v: -0.25 }],
          'rotation:y': [{ t: 0, v: 0 }, { t: 4.6, v: Math.PI * 2, ease: 'easeInOutCubic' }, { t: 5.2, v: Math.PI * 2 }],
          'position:y': [{ t: 0, v: 0 }, { t: 0.5, v: 0.18, ease: 'backOut' }, { t: 4.6, v: 0.18, ease: 'linear' }, { t: 5.2, v: 0, ease: 'easeInOutCubic' }],
        } },
      { engine: 'waapi', svg: 'face', selector: '#m-star',
        keyframes: [
          { t: 0, opacity: 0 }, { t: 0.25, opacity: 1, ease: 'backOut' },
          { t: 4.9, opacity: 1 }, { t: 5.2, opacity: 0, ease: 'easeInCubic' },
        ] },
      { engine: 'waapi', svg: 'face', selector: '#m-neutral',
        keyframes: [
          { t: 0, opacity: 1 }, { t: 0.25, opacity: 0, ease: 'easeInCubic' },
          { t: 5.2, opacity: 1, ease: 'easeOutCubic' },
        ] },
      { engine: 'waapi', svg: 'nametag', selector: '#tag',
        keyframes: [
          { t: 0, opacity: 0.9 }, { t: 3.6, opacity: 0.9 }, { t: 4.4, opacity: 0, ease: 'easeInOutCubic' },
        ] },
      { engine: 'waapi', svg: 'hud', selector: '#card',
        keyframes: [
          { t: 0, opacity: 1 }, { t: 3.6, opacity: 1 }, { t: 4.4, opacity: 0, ease: 'easeInOutCubic' },
        ] },
    ],
  },

  {
    // instant restore of the base lighting state (show recovery / post-export)
    name: 'lights-idle',
    channel: 'lights',
    loop: false,
    duration: 0.05,
    tracks: [
      { engine: 'prop', target: 'keyLight',
        props: { 'intensity': [{ t: 0, v: 0.05 }, { t: 0.05, v: 2.2, ease: 'easeOutQuad' }] } },
      { engine: 'prop', target: 'rimLight',
        props: { 'intensity': [{ t: 0, v: 0.05 }, { t: 0.05, v: 1.1, ease: 'easeOutQuad' }] } },
      { engine: 'prop', target: 'fillLight',
        props: { 'intensity': [{ t: 0, v: 0.05 }, { t: 0.05, v: 0.55, ease: 'easeOutQuad' }] } },
    ],
  },

  {
    name: 'lights-dim',
    channel: 'lights',
    loop: false,
    duration: 2,
    tracks: [
      { engine: 'prop', target: 'keyLight',
        props: { 'intensity': [{ t: 0, v: 2.2 }, { t: 2, v: 0.15, ease: 'easeInOutCubic' }] } },
      { engine: 'prop', target: 'rimLight',
        props: { 'intensity': [{ t: 0, v: 1.1 }, { t: 2, v: 0.1, ease: 'easeInOutCubic' }] } },
      { engine: 'prop', target: 'fillLight',
        props: { 'intensity': [{ t: 0, v: 0.55 }, { t: 2, v: 0.05, ease: 'easeInOutCubic' }] } },
    ],
  },

  // ------------------------------------------------------ camera packs ----
  // All camArm/camPivot keyframe chains are contiguous: each pack's first
  // keyframe equals the previous pack's last, so cuts are invisible.
  {
    name: 'cam-idle',
    channel: 'camera',
    loop: 'repeat',
    duration: 8,
    tracks: [
      { engine: 'prop', target: 'camPivot', loop: 'pingpong',
        props: { 'rotation:y': [{ t: 0, v: 0 }, { t: 4, v: 0.13, ease: 'easeInOutSine' }] } },
      { engine: 'prop', target: 'camArm', loop: 'pingpong',
        props: {
          'position:y': [{ t: 0, v: 0.7 }, { t: 4, v: 0.84, ease: 'easeInOutSine' }],
          'rotation:x': [{ t: 0, v: -0.169 }, { t: 4, v: -0.15, ease: 'easeInOutSine' }],
        } },
    ],
  },

  {
    name: 'cam-boot',
    channel: 'camera',
    loop: false,
    duration: 5,
    tracks: [
      { engine: 'prop', target: 'camArm',
        props: {
          'position:z': [{ t: 0, v: 7.6 }, { t: 4.2, v: 4.4, ease: 'easeInOutCubic' }, { t: 5, v: 4.4 }],
          'position:y': [{ t: 0, v: 1.6 }, { t: 4.2, v: 0.7, ease: 'easeInOutCubic' }, { t: 5, v: 0.7 }],
          'rotation:x': [{ t: 0, v: -0.3 }, { t: 4.2, v: -0.169, ease: 'easeInOutCubic' }, { t: 5, v: -0.169 }],
        } },
      { engine: 'prop', target: 'camPivot',
        props: { 'rotation:y': [{ t: 0, v: 0 }, { t: 5, v: 0 }] } },
    ],
  },

  {
    name: 'cam-greet',
    channel: 'camera',
    loop: false,
    duration: 4.8,
    tracks: [
      { engine: 'prop', target: 'camArm',
        props: {
          'position:z': [{ t: 0, v: 4.4 }, { t: 2.4, v: 3.85, ease: 'easeInOutCubic' }, { t: 4.8, v: 4.4, ease: 'easeInOutCubic' }],
          'position:y': [{ t: 0, v: 0.7 }, { t: 4.8, v: 0.7 }],
          'rotation:x': [{ t: 0, v: -0.169 }, { t: 4.8, v: -0.169 }],
        } },
      { engine: 'prop', target: 'camPivot',
        props: { 'rotation:y': [{ t: 0, v: 0 }, { t: 4.8, v: 0 }] } },
    ],
  },

  {
    name: 'cam-holo',
    channel: 'camera',
    loop: false,
    duration: 6.5,
    tracks: [
      { engine: 'prop', target: 'camArm',
        props: {
          'position:z': [{ t: 0, v: 4.4 }, { t: 2.0, v: 4.9, ease: 'easeInOutCubic' }, { t: 6.5, v: 4.4, ease: 'easeInOutCubic' }],
          'position:y': [{ t: 0, v: 0.7 }, { t: 2.0, v: 0.95, ease: 'easeInOutCubic' }, { t: 6.5, v: 0.7, ease: 'easeInOutCubic' }],
          'rotation:x': [{ t: 0, v: -0.169 }, { t: 6.5, v: -0.169 }],
        } },
      { engine: 'prop', target: 'camPivot',
        props: { 'rotation:y': [{ t: 0, v: 0 }, { t: 3.2, v: 0.5, ease: 'easeInOutCubic' }, { t: 6.5, v: 0, ease: 'easeInOutCubic' }] } },
    ],
  },

  {
    name: 'cam-dance',
    channel: 'camera',
    loop: false,
    duration: 10,
    tracks: [
      { engine: 'prop', target: 'camArm',
        props: {
          'position:z': [{ t: 0, v: 4.4 }, { t: 2.2, v: 3.15, ease: 'easeInOutCubic' }, { t: 8.5, v: 3.15, ease: 'linear' }, { t: 10, v: 3.3, ease: 'easeInOutCubic' }],
          'position:y': [{ t: 0, v: 0.7 }, { t: 2.2, v: 0.9, ease: 'easeInOutCubic' }, { t: 10, v: 0.8, ease: 'easeInOutCubic' }],
          'rotation:x': [{ t: 0, v: -0.169 }, { t: 2.2, v: -0.22, ease: 'easeInOutCubic' }, { t: 10, v: -0.18, ease: 'easeInOutCubic' }],
        } },
      { engine: 'prop', target: 'camPivot',
        props: { 'rotation:y': [{ t: 0, v: 0 }, { t: 10, v: 0.95, ease: 'easeInOutQuad' }] } },
    ],
  },

  {
    name: 'cam-finale',
    channel: 'camera',
    loop: false,
    duration: 5.2,
    tracks: [
      { engine: 'prop', target: 'camArm',
        props: {
          'position:z': [{ t: 0, v: 3.3 }, { t: 4.8, v: 6.4, ease: 'easeInOutCubic' }, { t: 5.2, v: 6.8, ease: 'easeOutCubic' }],
          'position:y': [{ t: 0, v: 0.8 }, { t: 4.8, v: 1.7, ease: 'easeInOutCubic' }, { t: 5.2, v: 1.85, ease: 'easeOutCubic' }],
          'rotation:x': [{ t: 0, v: -0.18 }, { t: 4.8, v: -0.28, ease: 'easeInOutCubic' }, { t: 5.2, v: -0.3, ease: 'easeOutCubic' }],
        } },
      { engine: 'prop', target: 'camPivot',
        props: { 'rotation:y': [{ t: 0, v: 0.95 }, { t: 5.2, v: 1.35, ease: 'easeInOutCubic' }] } },
    ],
  },
];

/** Map pack name -> HUD state label. */
export const stateLabels = {
  idle: 'idle',
  boot: 'booting',
  greet: 'greeting',
  hop: 'greeting',
  think: 'thinking',
  speak: 'speaking',
  surprise: 'surprised',
  dance: 'dancing',
  showcase: 'showcase',
  finale: 'celebrating',
};

/**
 * Default scripted show used by "Run show" and by the exporter. Channels are
 * explicit so the pack scheduler drives body / camera / lights / fx lanes in
 * parallel. Timings match the live show in main.js (SHOW total ≈ 32 s).
 */
export const showSchedule = [
  // Scene 1 — Boot (0 – 5)
  { name: 'lights-boot', channel: 'lights', at: 0 },
  { name: 'boot', channel: 'body', at: 0 },
  { name: 'cam-boot', channel: 'camera', at: 0 },
  // Scene 2 — Greeting (5 – 9.8)
  { name: 'cam-greet', channel: 'camera', at: 5 },
  { name: 'hop', channel: 'body', at: 5 },
  // Scene 3 — Holo Showcase (9.8 – 16.3)
  { name: 'showcase', channel: 'body', at: 9.8 },
  { name: 'holo-on', channel: 'fx', at: 9.8 },
  { name: 'cam-holo', channel: 'camera', at: 9.8 },
  // Scene 4 — Dance (16.3 – 26.3)
  { name: 'dance', channel: 'body', at: 16.3 },
  { name: 'lights-dance', channel: 'lights', at: 16.3 },
  { name: 'cam-dance', channel: 'camera', at: 16.3 },
  // Scene 5 — Finale (26.3 – 31.5)
  { name: 'finale', channel: 'body', at: 26.3 },
  { name: 'cam-finale', channel: 'camera', at: 26.3 },
  { name: 'lights-dim', channel: 'lights', at: 29.5 },
];
