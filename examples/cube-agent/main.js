/**
 * CU-13 — flagship Agent Stage demo (cinematic cut).
 *
 * A desktop-robot cube character: 3D body with live SVG face texture, anchored
 * nametag + HUD, holographic showcase panels, a full cinematic show
 * (Boot / Greeting / Holo Showcase / Dance / Finale) choreographed through the
 * driver across body / camera / lights / fx channels, and video export.
 *
 * Camera choreography needs NO framework hook: the camera is parented to a
 * camPivot (orbit) -> camArm (dolly + pitch) rig that is registered in the
 * ThreeLayer, so packs on the dedicated "camera" channel drive it like any
 * other prop — live playback AND seek-driven export both work.
 *
 * Serve over http (ES modules + asset fetch). The server document root MUST be
 * the `agent-stage/` folder, NOT this example folder (the importmap maps
 * `agent-stage` -> `../../src/index.js`, which escapes the example folder):
 *   npx serve agent-stage            (from the parent directory)
 *   python3 -m http.server 3000      (run inside agent-stage/)
 * Then open http://localhost:PORT/examples/cube-agent/ in the browser.
 * Note: ES modules require HTTP — file:// will not work.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createAgentStage, ExportManager, Compositor } from 'agent-stage';
import { packs, stateLabels, showSchedule } from './packs.js';

const $ = (sel) => document.querySelector(sel);
const assetUrl = (n) => new URL(`assets/${n}`, import.meta.url).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- assets ---
const [faceMarkup, nametagMarkup, hudMarkup, holoMarkup] = await Promise.all(
  ['cube-face.svg', 'nametag.svg', 'hud.svg', 'holo.svg']
    .map((n) => fetch(assetUrl(n)).then((r) => { if (!r.ok) throw new Error('asset ' + n + ': ' + r.status); return r.text(); }))
);

// ------------------------------------------------------------- 3D scene ---
const agg = createAgentStage({ mount: '#stage' });
const { stage, threeLayer, svgLayer, engines, registry, driver, anchorBridge, textureBridge } = agg;

const scene = stage.scene;
const camera = stage.camera;

// Cinematic look: fog fades distant floor/grid into the CSS backdrop gradient
// (scene background stays transparent so the alpha checkerboard still works).
scene.fog = new THREE.FogExp2(0x070d18, 0.052);
stage.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
stage.renderer.shadowMap.enabled = true;
stage.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---- camera rig: camPivot (orbit at world origin) -> camArm (dolly/pitch).
// Registered in the threeLayer so prop packs on the "camera" channel drive it.
const camPivot = new THREE.Group(); // at origin; rotation:y = orbit
const camArm = new THREE.Group();   // offset; rotation:x = pitch, position = dolly
camera.position.set(0, 0, 0);
camArm.position.set(0, 0.7, 4.4);
camArm.rotation.x = -0.169; // look slightly down at the cube
camArm.add(camera);
camPivot.add(camArm);
scene.add(camPivot);
threeLayer.add('camPivot', camPivot);
threeLayer.add('camArm', camArm);

// ---- three-point lighting (key spot casts the shadow) ----
const keyLight = new THREE.SpotLight(0xbfe8ff, 2.2, 40, 0.55, 0.55, 1.2);
keyLight.position.set(2.6, 6.2, 3.4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.bias = -0.002;
const keyTarget = new THREE.Object3D();
keyTarget.position.set(0, 0, 0);
scene.add(keyTarget);
keyLight.target = keyTarget;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x22d3ee, 1.1);
rimLight.position.set(-4.5, 3, -3.5);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0xffb37a, 0.55, 20, 1.6);
fillLight.position.set(-2.6, 1.3, 2.8);
scene.add(fillLight);

scene.add(new THREE.HemisphereLight(0x8fa3c0, 0x1a2130, 0.55));

threeLayer.add('keyLight', keyLight);
threeLayer.add('rimLight', rimLight);
threeLayer.add('fillLight', fillLight);

// ---- floor: dark disc + glowing grid ----
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(14, 48),
  new THREE.MeshStandardMaterial({ color: 0x0a101c, roughness: 0.92, metalness: 0.05 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.78;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(24, 48, 0x1c4a5e, 0x10222e);
grid.material.transparent = true;
grid.material.opacity = 0.55;
grid.position.y = -0.775;
scene.add(grid);

// ---- the cube ----
const bodyGroup = new THREE.Group();
const body = new THREE.Mesh(
  new RoundedBoxGeometry(1.7, 1.5, 1.3, 5, 0.2),
  new THREE.MeshStandardMaterial({
    color: 0x2b3342, roughness: 0.45, metalness: 0.15,
    emissive: 0x000000, // packs flash this cyan during boot materialization
  })
);
body.castShadow = true;
bodyGroup.add(body);

const screen = new THREE.Mesh(
  new THREE.PlaneGeometry(1.15, 0.81),
  new THREE.MeshBasicMaterial({ color: 0x05070c })
);
screen.position.set(0, -0.02, 0.651);
bodyGroup.add(screen);

const antenna = new THREE.Group();
antenna.position.set(0, 0.75, 0);
const rod = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.022, 0.55, 12),
  new THREE.MeshStandardMaterial({ color: 0x3a4356, roughness: 0.4, metalness: 0.6 })
);
rod.position.y = 0.275;
antenna.add(rod);
const antennaTip = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.7 })
);
antennaTip.position.y = 0.58;
antenna.add(antennaTip);
bodyGroup.add(antenna);

const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(1.15, 32),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = -0.77;

scene.add(bodyGroup, shadow);

threeLayer.add('body', bodyGroup);
threeLayer.add('screen', screen);
threeLayer.add('antenna', antenna);
threeLayer.add('antennaTip', antennaTip);
threeLayer.add('shadow', shadow);

// ---- holo anchors: three markers on an orbit rig around the cube ----
const holoOrbit = new THREE.Group();
holoOrbit.position.y = 0.4;
const holoMarkers = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Object3D();
  const a = (i / 3) * Math.PI * 2;
  m.position.set(Math.cos(a) * 1.75, 0.55 + (i % 2) * 0.25, Math.sin(a) * 1.75);
  holoMarkers.push(m);
  holoOrbit.add(m);
  threeLayer.add('holo' + (i + 1), m);
}
scene.add(holoOrbit);
threeLayer.add('holoOrbit', holoOrbit);

// ---- ambient particle field (instanced points, preallocated) ----
const P_COUNT = 300;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(P_COUNT * 3);
const pSpeed = new Float32Array(P_COUNT);
const pPhase = new Float32Array(P_COUNT);
for (let i = 0; i < P_COUNT; i++) {
  pPos[i * 3] = (Math.random() - 0.5) * 14;
  pPos[i * 3 + 1] = Math.random() * 6 - 0.7;
  pPos[i * 3 + 2] = (Math.random() - 0.5) * 14;
  pSpeed[i] = 0.08 + Math.random() * 0.22;
  pPhase[i] = Math.random() * Math.PI * 2;
}
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
  color: 0x22d3ee, size: 0.045, transparent: true, opacity: 0.55,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
}));
scene.add(particles);
let particleBoost = 0; // raised during the show for a livelier swirl

// ---- ground pulse rings (pooled, reused; fired on dance beats) ----
const RING_POOL = 7;
const rings = [];
for (let i = 0; i < RING_POOL; i++) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1.0, 48),
    new THREE.MeshBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.76;
  mesh.visible = false;
  scene.add(mesh);
  rings.push({ mesh, age: Infinity });
}
function fireRing() {
  const r = rings.find((r) => r.age >= 0.9) ?? rings[0];
  r.age = 0;
  r.mesh.visible = true;
}

// ---- confetti (instanced planes, preallocated physics) ----
const C_COUNT = 90;
const confetti = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.07, 0.1),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 1 }),
  C_COUNT
);
confetti.visible = false;
confetti.frustumCulled = false;
const confColors = [0x22d3ee, 0xfde047, 0xfb7185, 0x34d399, 0xa78bfa];
const cColor = new THREE.Color();
for (let i = 0; i < C_COUNT; i++) {
  confetti.setColorAt(i, cColor.setHex(confColors[i % confColors.length]));
}
scene.add(confetti);
const cPos = new Float32Array(C_COUNT * 3);
const cVel = new Float32Array(C_COUNT * 3);
const cRot = new Float32Array(C_COUNT * 3);   // euler
const cSpin = new Float32Array(C_COUNT * 3);
const cState = new Int8Array(C_COUNT);        // 0 idle, 1 flying, 2 settled
let confettiAge = Infinity;
const cDummy = new THREE.Object3D();
function confettiBurst() {
  for (let i = 0; i < C_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 1.4;
    cPos[i * 3] = Math.cos(a) * r * 0.3;
    cPos[i * 3 + 1] = 1.1 + Math.random() * 0.6;
    cPos[i * 3 + 2] = Math.sin(a) * r * 0.3;
    cVel[i * 3] = Math.cos(a) * (1.2 + Math.random() * 1.6);
    cVel[i * 3 + 1] = 2.6 + Math.random() * 2.4;
    cVel[i * 3 + 2] = Math.sin(a) * (1.2 + Math.random() * 1.6);
    cRot[i * 3] = Math.random() * Math.PI * 2;
    cRot[i * 3 + 1] = Math.random() * Math.PI * 2;
    cRot[i * 3 + 2] = Math.random() * Math.PI * 2;
    cSpin[i * 3] = (Math.random() - 0.5) * 9;
    cSpin[i * 3 + 1] = (Math.random() - 0.5) * 9;
    cSpin[i * 3 + 2] = (Math.random() - 0.5) * 9;
    cState[i] = 1;
  }
  confettiAge = 0;
  confetti.visible = true;
  confetti.material.opacity = 1;
}

// ------------------------------------------------- registry + svg assets ---
registry.registerAsset('svg', 'face', faceMarkup);
registry.registerAsset('svg', 'nametag', nametagMarkup);
registry.registerAsset('svg', 'hud', hudMarkup);
registry.registerAsset('svg', 'holo1', holoMarkup);
registry.registerAsset('svg', 'holo2', holoMarkup);
registry.registerAsset('svg', 'holo3', holoMarkup);
registry.registerPacks(packs);

await registry.instantiate(agg);

// The face SVG drives the 3D screen texture only — hide it from the overlay.
svgLayer.get('face').style.display = 'none';
textureBridge.bind('face', screen, { width: 512 });

const overlayH = stage.svgOverlay.clientHeight;
svgLayer.mount('hud', hudMarkup, { x: 18, y: Math.max(18, overlayH - 134) });
anchorBridge.anchor('nametag', { target: 'antennaTip', anchor: 'bottom', offset: { x: 0, y: 0.22, z: 0 } });
anchorBridge.anchor('holo1', { target: 'holo1', anchor: 'center' });
anchorBridge.anchor('holo2', { target: 'holo2', anchor: 'center' });
anchorBridge.anchor('holo3', { target: 'holo3', anchor: 'center' });

// Per-panel glyph variants from the single holo.svg asset.
const holoVariants = [
  { glyph: 'g-cube', title: 'CORE-01' },
  { glyph: 'g-bolt', title: 'PWR-02' },
  { glyph: 'g-chart', title: 'DATA-03' },
];
holoVariants.forEach((v, i) => {
  const svg = svgLayer.get('holo' + (i + 1));
  svg.querySelector('#panel-title').textContent = v.title;
  for (const g of ['g-cube', 'g-bolt', 'g-chart']) {
    svg.querySelector('#' + g).style.display = g === v.glyph ? '' : 'none';
  }
});

await registry.compileAll(agg.ctx);

// ------------------------------------------------------------ UI wiring ---
const hudSvg = svgLayer.get('hud');
const spark = hudSvg.querySelector('#spark');
const sparkFill = hudSvg.querySelector('#spark-fill');
const recGroup = hudSvg.querySelector('#rec');
const stateLabel = hudSvg.querySelector('#state-label');
const countMsgs = hudSvg.querySelector('#count-msgs');
const countOps = hudSvg.querySelector('#count-ops');

driver.on('play', ({ pack }) => {
  if (pack === 'speak') return; // say() writes its text into the label
  if (stateLabels[pack]) stateLabel.textContent = stateLabels[pack];
  counterTargets.ops += 1;
});
driver.on('finished', () => { stateLabel.textContent = 'idle'; });

function setRec(on) {
  recGroup.setAttribute('opacity', on ? '1' : '0');
}

// Sparkline: activity trace driven by the active pack.
const N = 40;
const trace = new Array(N).fill(0);
const intensities = {
  idle: 0.2, boot: 0.5, greet: 0.7, hop: 0.8, think: 0.5, speak: 0.65,
  surprise: 1, dance: 1, showcase: 0.75, finale: 1,
};
setInterval(() => {
  const active = driver.active('body');
  const level = active ? (intensities[active.pack.name] ?? 0.4) : 0.15;
  trace.push(level + (Math.random() - 0.5) * 0.25);
  trace.shift();
  const pts = trace.map((v, i) => {
    const x = 16 + (i * 248) / (N - 1);
    const y = 136 - Math.max(0, Math.min(1, v)) * 18;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  spark.setAttribute('points', pts.join(' '));
  sparkFill.setAttribute('points', `16,136 ${pts.join(' ')} 284,136`);
}, 200);

// Animated counters (displayed value eases toward the target).
const counterTargets = { msgs: 0, ops: 0 };
const counterShown = { msgs: 0, ops: 0 };

stage.start();
driver.motion('idle');
driver.play('cam-idle');

// --------------------------------------------------------- ambient tick ---
const BEAT = 0.5; // 120 BPM, matches packs.js
let danceT0 = -1;
let lastBeat = -1;
driver.on('play', ({ pack }) => {
  if (pack === 'dance') { danceT0 = stage.time; lastBeat = -1; }
});

let frameMs = 16;
stage.on('tick', ({ dt, time }) => {
  frameMs = frameMs * 0.95 + dt * 1000 * 0.05;

  // particle drift (write in place — no per-frame allocations)
  const drift = 1 + particleBoost * 2.2;
  for (let i = 0; i < P_COUNT; i++) {
    let y = pPos[i * 3 + 1] + pSpeed[i] * drift * dt;
    if (y > 5.4) y = -0.7;
    pPos[i * 3 + 1] = y;
    pPos[i * 3] += Math.sin(time * 0.6 + pPhase[i]) * 0.06 * dt * drift;
  }
  pGeo.attributes.position.needsUpdate = true;

  // pulse rings
  for (const r of rings) {
    if (r.age >= 0.9) { r.mesh.visible = false; continue; }
    r.age += dt;
    const s = 1 + r.age * 3.4;
    r.mesh.scale.set(s, s, 1);
    r.mesh.material.opacity = Math.max(0, (1 - r.age / 0.9)) * 0.55;
  }

  // dance beat detection -> rings + boot materialize ring handled by show
  if (danceT0 >= 0) {
    const beat = Math.floor((time - danceT0) / BEAT);
    if (beat > lastBeat) {
      lastBeat = beat;
      fireRing();
    }
    const act = driver.active('body');
    if (!act || act.pack.name !== 'dance') danceT0 = -1;
  }

  // confetti physics
  if (confetti.visible) {
    confettiAge += dt;
    const alive = confettiAge < 3.6;
    for (let i = 0; i < C_COUNT; i++) {
      if (cState[i] === 1) {
        cVel[i * 3 + 1] -= 2.4 * dt;
        cPos[i * 3] += cVel[i * 3] * dt;
        cPos[i * 3 + 1] += cVel[i * 3 + 1] * dt;
        cPos[i * 3 + 2] += cVel[i * 3 + 2] * dt;
        cVel[i * 3] *= 1 - 0.4 * dt;
        cVel[i * 3 + 2] *= 1 - 0.4 * dt;
        if (cPos[i * 3 + 1] < -0.7) { cPos[i * 3 + 1] = -0.7; cState[i] = 2; }
        cRot[i * 3] += cSpin[i * 3] * dt;
        cRot[i * 3 + 1] += cSpin[i * 3 + 1] * dt;
        cRot[i * 3 + 2] += cSpin[i * 3 + 2] * dt;
      }
      cDummy.position.set(cPos[i * 3], cPos[i * 3 + 1], cPos[i * 3 + 2]);
      cDummy.rotation.set(cRot[i * 3], cRot[i * 3 + 1], cRot[i * 3 + 2]);
      cDummy.updateMatrix();
      confetti.setMatrixAt(i, cDummy.matrix);
    }
    confetti.instanceMatrix.needsUpdate = true;
    confetti.material.opacity = alive ? 1 : Math.max(0, 1 - (confettiAge - 3.6) / 0.8);
    if (!alive && confetti.material.opacity <= 0) confetti.visible = false;
  }

  // counters ease toward targets
  if (counterShown.msgs !== counterTargets.msgs) {
    counterShown.msgs += Math.ceil((counterTargets.msgs - counterShown.msgs) * 0.12);
    countMsgs.textContent = String(counterShown.msgs);
  }
  if (counterShown.ops !== counterTargets.ops) {
    counterShown.ops += Math.ceil((counterTargets.ops - counterShown.ops) * 0.12);
    countOps.textContent = String(counterShown.ops);
  }
});

// ------------------------------------------------------------ the show ----
// Five named scenes chained on the driver. Every step either awaits a
// non-looping finished promise (interrupts settle with {stopped:true}) or
// re-checks that the expected pack still owns the body channel — either way
// a mid-show interruption aborts cleanly and recovers to idle.
const SHOW_ABORT = Symbol('show-aborted');
const SHOW_LEN = 31.5;
let showing = false;
let abortFlag = false;
function checkAborted() { return abortFlag; }
const fadeEl = document.createElement('div');
fadeEl.id = 'fade-overlay';
fadeEl.style.cssText =
  'position:absolute;inset:0;background:#02040a;opacity:0;pointer-events:none;' +
  'transition:opacity 1.2s ease;z-index:5;';
$('#stage-wrap').appendChild(fadeEl);

const sceneLabel = $('#scene-label');
const showBar = $('#show-progress');
let showT0 = 0;

function setScene(name, at) {
  sceneLabel.textContent = name;
  showT0 = at;
}

function checkBody(expected) {
  const act = driver.active('body');
  // null = the expected pack just finished naturally — that is not an abort
  if (act && act.pack.name !== expected) throw SHOW_ABORT;
}

async function runShow() {
  driver.stop('all');
  counterTargets.msgs = 0;
  counterTargets.ops = 0;
  fadeEl.style.opacity = '0';

  // --- Scene 1: BOOT (0 – 5) — spotlight fades up, cube materializes,
  // boot face, nametag types in, one ground ring on materialize.
  setScene('01 · BOOT', 0);
  driver.play('lights-boot');
  driver.play('cam-boot');
  const bootFin = driver.play('boot').finished;
  sleep(2050).then(() => { if (!checkAborted()) fireRing(); });
  const bootRes = await bootFin;
  if (bootRes?.stopped) throw SHOW_ABORT;
  checkBody('boot');

  // --- Scene 2: GREETING (5 – 9.8) — hops toward camera, grin, HUD slides
  // in with animated counters.
  setScene('02 · GREETING', 5);
  counterTargets.msgs = 128;
  counterTargets.ops = 2147;
  driver.play('cam-greet');
  const hopFin = driver.play('hop').finished;
  await hopFin;
  checkBody('hop');

  // --- Scene 3: HOLO SHOWCASE (9.8 – 16.3) — three holo panels orbit in,
  // particle swirl picks up, slow orbiting camera.
  setScene('03 · HOLO SHOWCASE', 9.8);
  particleBoost = 1;
  driver.play('cam-holo');
  const [showFin, holoFin] = await Promise.all([
    driver.play('showcase').finished, driver.play('holo-on').finished,
  ]);
  if (showFin?.stopped || holoFin?.stopped) throw SHOW_ABORT;
  checkBody('showcase');
  particleBoost = 0;

  // --- Scene 4: DANCE (16.3 – 26.3) — 120 BPM centerpiece: squash-stretch
  // bounces, antenna flashes, expression cycle, rings pulse, lights shift,
  // camera dollies in and orbits.
  setScene('04 · DANCE', 16.3);
  driver.play('dance');
  driver.play('lights-dance');
  driver.play('cam-dance');
  // dance loops forever — poll so a mid-dance interrupt aborts immediately
  // (dance never finishes naturally, so a null/other active pack = abort)
  for (let i = 0; i < 44; i++) {
    await sleep(250);
    const act = driver.active('body');
    if (!act || act.pack.name !== 'dance') throw SHOW_ABORT;
  }
  driver.stop('body');

  // --- Scene 5: FINALE (26.3 – 31.5) — confetti burst, star eyes, slow
  // pull-back, lights dim, fade out.
  setScene('05 · FINALE', 26.3);
  driver.play('cam-finale');
  sleep(250).then(() => { if (!checkAborted()) confettiBurst(); });
  sleep(3200).then(() => { if (!checkAborted()) driver.play('lights-dim'); });
  const finRes = await driver.play('finale').finished;
  if (finRes?.stopped) throw SHOW_ABORT;

  fadeEl.style.opacity = '1';
  await sleep(1300);
  if (!checkAborted()) {
    driver.play('lights-idle');
    driver.play('cam-idle');
    driver.motion('idle');
    fadeEl.style.opacity = '0';
  }
}

async function startShow() {
  if (showing) return;
  showing = true;
  abortFlag = false;
  $('#btn-show').disabled = true;
  const showStart = stage.time;
  const progressTimer = setInterval(() => {
    const p = Math.min(1, (stage.time - showStart) / SHOW_LEN);
    showBar.style.width = `${Math.round(p * 100)}%`;
  }, 200);
  try {
    await runShow();
  } catch (err) {
    if (err !== SHOW_ABORT) console.error('[show]', err);
  } finally {
    clearInterval(progressTimer);
    // natural completion AND user-interrupt recovery both settle to idle
    driver.stop('all');
    driver.play('lights-idle');
    driver.play('cam-idle');
    driver.motion('idle');
    fadeEl.style.opacity = '0';
    showBar.style.width = '0%';
    sceneLabel.textContent = '—';
    stateLabel.textContent = 'idle';
    showing = false;
    abortFlag = false;
    $('#btn-show').disabled = false;
  }
}

// Mid-show pack button clicks abort the show cleanly.
function abortShowIfNeeded() {
  if (showing) {
    abortFlag = true;
    driver.stop('all');
  }
}

// Pack buttons.
const packButtons = { idle: $('#btn-idle'), greet: $('#btn-greet'), think: $('#btn-think'), speak: $('#btn-speak'), surprise: $('#btn-surprise'), dance: $('#btn-dance') };
for (const [name, btn] of Object.entries(packButtons)) {
  btn.addEventListener('click', () => { abortShowIfNeeded(); driver.motion(name); });
}

$('#btn-show').addEventListener('click', startShow);

// Background toggle: proves alpha exports (gradient vs checkerboard behind
// the transparent WebGL canvas).
$('#btn-bg').addEventListener('click', () => {
  $('#stage-wrap').classList.toggle('checker');
});

// ------------------------------------------------------------- exporter ---
const em = new ExportManager({
  stage, timeline: agg.timeline, driver, svgLayer,
  engines, compositor: new Compositor(),
});

const caps = ExportManager.supported();
if (!caps.webm) $('#fmt').querySelector('option[value="webm"]').disabled = true;
if (!caps.mp4) $('#fmt').querySelector('option[value="mp4"]').disabled = true;
$('#caps').textContent = caps.notes.length ? '⚠ ' + caps.notes.join(' ') : '✓ all formats available';

let exporting = false;
$('#btn-export').addEventListener('click', async () => {
  if (exporting) return;
  exporting = true;
  const format = $('#fmt').value;
  const resSel = $('#res');
  const [width, height] = resSel.value.split('x').map(Number);
  const fps = Number($('#fps').value);
  const duration = Math.max(1, Number($('#dur').value) || 32);
  const bar = $('#bar');
  const status = $('#export-status');

  abortShowIfNeeded();
  driver.stop('all');
  setRec(true);
  status.textContent = 'exporting…';
  bar.style.width = '0%';
  try {
    const result = await em.export(format, {
      duration, fps, width, height,
      background: null,
      packsToPlay: showSchedule,
      signal: cancelToken,
      onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; },
    });
    em.download(result.blob, result.filename);
    status.textContent = `saved ${result.filename}` + (result.frames ? ` (${result.frames} frames)` : '');
  } catch (err) {
    if (err?.cancelled) status.textContent = 'cancelled';
    else {
      status.textContent = 'export failed — see console';
      console.error(err);
    }
  } finally {
    setRec(false);
    bar.style.width = '0%';
    driver.motion('idle');
    driver.play('cam-idle');
    driver.play('lights-idle');
    exporting = false;
  }
});

// Simple AbortSignal-like token wired to the next export.
const cancelToken = { cancelled: false };
$('#btn-cancel').addEventListener('click', () => {
  cancelToken.cancelled = true;
});
$('#btn-export').addEventListener('click', () => { cancelToken.cancelled = false; });

// expose for tinkering
window.cu13 = { agg, driver, em, stats: { get frameMs() { return frameMs; } } };
