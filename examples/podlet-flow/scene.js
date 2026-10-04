// PODLET FLOW — overlay terminal LICHEN : URL du chat -> arborescence -> agent -> fourche GitHub.
// Storyboard v2 (12 s, 6 beats, 1920x1080). Deterministic: seeded particles, no wall-clock.
import { createMotion } from 'agent-stage/kit/index.js';
import { attachReview } from 'agent-stage/kit/review.js';

const INK = '#faf5e8';
const SOFT = '#bfb39d';
const LEAF = '#b4dd88';
const WASH = '#1d2714';
const PANEL = 'rgba(20,13,5,0.72)';
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const SERIF = "'Fraunces', Georgia, serif";

const svg = `<svg viewBox="0 0 1920 1080">
  <defs>
    <radialGradient id="sunGrad">
      <stop offset="0" stop-color="rgba(255,190,100,0.15)"/>
      <stop offset="1" stop-color="rgba(255,190,100,0)"/>
    </radialGradient>
    <linearGradient id="streakGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(180,221,136,0.35)"/>
      <stop offset="1" stop-color="rgba(180,221,136,0)"/>
    </linearGradient>
    <filter id="hardShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="6" dy="6" stdDeviation="0" flood-color="#faf5e8"/>
    </filter>
  </defs>

  <ellipse id="sunHalo" cx="960" cy="40" rx="720" ry="340" fill="url(#sunGrad)"/>
  <g id="streaks">
    <line x1="700" y1="0" x2="700" y2="300" stroke="url(#streakGrad)" stroke-width="2"/>
    <line x1="830" y1="0" x2="830" y2="260" stroke="url(#streakGrad)" stroke-width="2"/>
    <line x1="980" y1="0" x2="980" y2="310" stroke="url(#streakGrad)" stroke-width="2"/>
    <line x1="1120" y1="0" x2="1120" y2="240" stroke="url(#streakGrad)" stroke-width="2"/>
    <line x1="1260" y1="0" x2="1260" y2="290" stroke="url(#streakGrad)" stroke-width="2"/>
    <line x1="1400" y1="0" x2="1400" y2="230" stroke="url(#streakGrad)" stroke-width="2"/>
  </g>

  <g id="urlPanel" data-origin="center">
    <rect x="460" y="70" width="1000" height="90" fill="${PANEL}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
    <text id="urlPrefix" x="520" y="126" font-family="${MONO}" font-size="26" fill="${SOFT}">https://chat.podlet.dev/c/</text>
    <text id="urlId" data-split x="860" y="128" font-family="${SERIF}" font-style="italic" font-size="37" fill="${LEAF}">a1b2c3d4</text>
    <ellipse id="idHalo" cx="1005" cy="115" rx="190" ry="80" fill="url(#sunGrad)"/>
    <g id="urlIdLit">
      <rect x="840" y="92" width="290" height="46" fill="${LEAF}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
      <text x="985" y="125" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="30" fill="#140d05">a1b2c3d4</text>
    </g>
  </g>

  <g id="idChip" data-origin="center">
    <g transform="rotate(-0.8 1180 115)">
    <rect x="1070" y="93" width="220" height="44" fill="${WASH}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
    <text x="1180" y="123" text-anchor="middle" font-family="${MONO}" font-size="28" fill="${LEAF}">a1b2c3d4</text>
    </g>
  </g>
  <g id="copyCheck" data-origin="center">
    <rect x="1385" y="95" width="28" height="28" fill="none" stroke="${INK}" stroke-width="2"/>
    <path d="M1391 109 l6 6 l10 -12" fill="none" stroke="${LEAF}" stroke-width="2.5"/>
  </g>
  <g id="copyLabel">
    <rect x="1440" y="92" width="112" height="34" fill="${PANEL}" stroke="${INK}" stroke-width="2"/>
    <text x="1496" y="115" text-anchor="middle" font-family="${MONO}" font-size="20" letter-spacing="3" fill="${INK}">COPIÉ</text>
  </g>

  <g id="treeRoot" data-origin="center">
    <rect x="694" y="254" width="12" height="12" fill="${INK}"/>
    <rect x="726" y="240" width="170" height="48" fill="${WASH}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
    <text x="811" y="273" text-anchor="middle" font-family="${MONO}" font-size="30" fill="${INK}">.podlet/</text>
  </g>
  <path id="connRootArt" d="M700 268 L700 352" fill="none" stroke="${INK}" stroke-width="2"/>
  <g id="treeArtifacts" data-origin="center">
    <rect x="694" y="354" width="12" height="12" fill="${INK}"/>
    <rect x="726" y="340" width="190" height="48" fill="${WASH}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
    <text x="821" y="373" text-anchor="middle" font-family="${MONO}" font-size="30" fill="${INK}">Artifacts/</text>
  </g>
  <path id="connArtId" d="M700 366 L700 462" fill="none" stroke="${INK}" stroke-width="2"/>
  <g id="treeId" data-origin="center">
    <rect x="694" y="464" width="12" height="12" fill="${LEAF}"/>
    <rect x="726" y="450" width="200" height="48" fill="${WASH}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
    <text x="826" y="482" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="32" fill="${LEAF}">a1b2c3d4/</text>
  </g>
  <g id="treeIdLit">
    <ellipse id="idTreeHalo" cx="826" cy="474" rx="170" ry="72" fill="url(#sunGrad)"/>
    <g id="treeIdGlow" data-origin="center">
      <rect x="716" y="442" width="220" height="56" fill="${LEAF}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
      <text x="826" y="480" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="30" fill="#140d05">a1b2c3d4/</text>
    </g>
  </g>

  <path id="connLeaf1" d="M700 476 L775 558" fill="none" stroke="${INK}" stroke-width="2"/>
  <path id="connLeaf2" d="M700 476 L955 570" fill="none" stroke="${INK}" stroke-width="2"/>
  <path id="connLeaf3" d="M700 476 L1135 558" fill="none" stroke="${INK}" stroke-width="2"/>
  <g id="leafPlan" data-origin="center">
    <rect x="700" y="560" width="150" height="40" fill="${WASH}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
    <text x="775" y="587" text-anchor="middle" font-family="${MONO}" font-size="26" fill="${INK}">plan.md</text>
  </g>
  <g id="leafNotes" data-origin="center">
    <rect x="880" y="572" width="150" height="40" fill="${WASH}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
    <text x="955" y="599" text-anchor="middle" font-family="${MONO}" font-size="26" fill="${INK}">notes.md</text>
  </g>
  <g id="leafAssets" data-origin="center">
    <rect x="1060" y="560" width="150" height="40" fill="${WASH}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
    <text x="1135" y="587" text-anchor="middle" font-family="${MONO}" font-size="26" fill="${INK}">assets/</text>
  </g>

  <rect id="codeShadow" x="1266" y="586" width="150" height="42" fill="${INK}"/>
  <g id="folderCode" data-origin="center">
    <rect x="1260" y="544" width="150" height="42" fill="${WASH}" stroke="${INK}" stroke-width="2"/>
    <text id="codeLabel" x="1335" y="574" text-anchor="middle" font-family="${MONO}" font-size="26" fill="${LEAF}">code/</text>
  </g>
  <rect id="impactRing" x="1305" y="535" width="60" height="60" fill="none" stroke="${INK}" stroke-width="2" data-origin="center"/>
  <path id="connCode" d="M712 470 L1258 560" fill="none" stroke="${INK}" stroke-width="2"/>

  <g id="agentIcon" data-origin="center">
    <rect x="1430" y="410" width="270" height="130" fill="${PANEL}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
    <circle cx="1500" cy="452" r="13" fill="none" stroke="${INK}" stroke-width="2"/>
    <path d="M1500 465 v22 M1480 496 h40 M1480 500 l-8 12 M1520 500 l8 12" fill="none" stroke="${INK}" stroke-width="2"/>
    <text x="1565" y="522" text-anchor="middle" font-family="${MONO}" font-size="22" letter-spacing="3" fill="${SOFT}">AGENT PODLET</text>
  </g>
  <path id="cableSeg1" d="M1428 470 L1200 470" fill="none" stroke="${LEAF}" stroke-width="2.5" stroke-dasharray="8 6"/>
  <path id="cableSeg2" d="M1200 470 L1200 420" fill="none" stroke="${LEAF}" stroke-width="2.5" stroke-dasharray="8 6"/>
  <path id="cableSeg3" d="M1200 420 L712 420 L712 462" fill="none" stroke="${LEAF}" stroke-width="2.5" stroke-dasharray="8 6"/>
  <rect id="plugHead" x="700" y="463" width="14" height="14" fill="${LEAF}" data-origin="center"/>
  <ellipse id="agentPulse" cx="1565" cy="475" rx="120" ry="90" fill="url(#sunGrad)" data-origin="center"/>
  <g id="statusLabel">
    <rect x="1440" y="528" width="250" height="36" fill="${INK}"/>
    <text x="1565" y="552" text-anchor="middle" font-family="${MONO}" font-size="22" letter-spacing="3" fill="#140d05">AGENT CONNECTÉ</text>
  </g>

  <path id="branchLine" d="M706 476 L1150 646" fill="none" stroke="${INK}" stroke-width="2"/>
  <g id="forkNode" data-origin="center">
    <rect x="1144" y="634" width="12" height="12" fill="${INK}"/>
  </g>
  <path id="branchPub" d="M1150 646 L1400 764" fill="none" stroke="${INK}" stroke-width="2"/>
  <path id="branchPriv" d="M1150 646 L980 764" fill="none" stroke="${SOFT}" stroke-width="2"/>
  <g id="nodePublic" data-origin="center">
    <rect x="1230" y="736" width="340" height="84" fill="${INK}" stroke="${INK}" stroke-width="2" filter="url(#hardShadow)"/>
    <text x="1400" y="768" text-anchor="middle" font-family="${MONO}" font-size="22" letter-spacing="3" fill="#140d05">● PUBLIC</text>
    <text x="1400" y="802" text-anchor="middle" font-family="${MONO}" font-size="24" fill="#140d05">git clone \u0026lt;url\u0026gt;</text>
  </g>
  <g id="cloneChip">
    <rect x="1250" y="688" width="300" height="40" fill="${PANEL}" stroke="${LEAF}" stroke-width="2" stroke-dasharray="8 6"/>
    <path d="M1290 698 v14 M1284 706 l6 8 l6 -8" fill="none" stroke="${LEAF}" stroke-width="2"/>
    <text x="1420" y="714" text-anchor="middle" font-family="${MONO}" font-size="22" fill="${LEAF}">cloner via URL</text>
  </g>
  <g id="nodePrivate">
    <g transform="rotate(-1.2 980 780)">
      <rect x="830" y="736" width="300" height="80" fill="${PANEL}" stroke="${SOFT}" stroke-width="2" stroke-dasharray="6 6"/>
      <rect x="848" y="774" width="24" height="20" fill="none" stroke="${SOFT}" stroke-width="2"/>
      <path id="lockShackle" d="M852 774 v-6 a8 8 0 0 1 16 0 v6" fill="none" stroke="${SOFT}" stroke-width="2"/>
      <text x="1010" y="788" text-anchor="middle" font-family="${MONO}" font-size="24" fill="${SOFT}">privé — non cloné</text>
      <rect id="privateStrike" x="830" y="777" width="300" height="5" fill="${SOFT}" data-origin="left center"/>
    </g>
  </g>

  <text id="treeCaption" x="700" y="668" font-family="${SERIF}" font-style="italic" font-size="28" fill="${SOFT}">Artefacts de session</text>
</svg>`;

const score = [
  // Ambiance (voix TEMPS, toute la durée)
  { at: 0.0, dur: 'end', target: '#sunHalo', opacity: [0.10, 0.16], loop: 'pingpong', every: 1.8 },

  // Beat 1 — URL + illumination de l'ID
  { at: 0.00, dur: 0.12, target: '#urlPanel', opacity: [0, 1] },
  { at: 0.00, dur: 0.30, target: '#urlPanel', y: [-40, 0], ease: 'easeOutExpo' },
  { at: 0.10, dur: 0.50, target: '#urlPrefix', opacity: [0, 1] },
  { at: 0.30, dur: 0.60, target: '#urlId .ch', stagger: 0.04, opacity: [0, 1], x: [-6, 0] },
  { at: 1.00, dur: 0.08, target: '#urlId', opacity: [1, 0] },
  { at: 1.00, dur: 0.08, target: '#urlIdLit', opacity: [0, 1] },
  { at: 1.00, dur: 0.55, target: '#idHalo', opacity: [0, 0.9], ease: 'easeOutCubic' },
  { at: 1.55, dur: 'end', target: '#idHalo', opacity: [0.9, 0.55], loop: 'pingpong', every: 1.6 },

  // Beat 2 — action « copie »
  { at: 2.20, dur: 0.25, target: '#idChip', opacity: [0, 1], scale: [0.6, 1], ease: 'backOut' },
  { at: 2.45, dur: 0.55, target: '#idChip', x: [0, -330], y: [0, 240], scale: [1, 0.55], ease: 'easeInOutCubic' },
  { at: 2.55, dur: 0.25, target: '#copyCheck', opacity: [0, 1], scale: [0.5, 1], ease: 'backOut' },
  { at: 2.70, dur: 0.30, target: '#copyLabel', opacity: [0, 1], y: [8, 0] },
  { at: 3.05, dur: 0.25, target: '#idChip', opacity: [1, 0], scale: [0.55, 0.4] },

  // Beat 3 — arborescence en cascade
  { at: 3.30, dur: 0.35, target: '#treeRoot', opacity: [0, 1], scale: [0.7, 1], ease: 'backOut' },
  { at: 3.30, dur: 0.90, target: '#treeRoot', rotate: [0, -0.6], ease: 'easeOutCubic' },
  { at: 3.60, dur: 0.30, target: '#connRootArt', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 3.85, dur: 0.35, target: '#treeArtifacts', opacity: [0, 1], scale: [0.7, 1], ease: 'backOut' },
  { at: 3.85, dur: 0.90, target: '#treeArtifacts', rotate: [0, 0.4], ease: 'easeOutCubic' },
  { at: 4.15, dur: 0.30, target: '#connArtId', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 4.40, dur: 0.35, target: '#treeId', opacity: [0, 1], scale: [0.7, 1], ease: 'backOut' },
  { at: 4.75, dur: 0.08, target: '#treeId', opacity: [1, 0] },
  { at: 4.75, dur: 0.08, target: '#treeIdLit', opacity: [0, 1] },
  { at: 4.48, dur: 'end', target: '#idTreeHalo', opacity: [0.55, 0.9], loop: 'pingpong', every: 1.6 },
  { at: 4.85, dur: 0.28, target: '#leafPlan', opacity: [0, 1], x: [-14, 0], ease: 'easeOutCubic' },
  { at: 4.85, dur: 0.90, target: '#leafPlan', rotate: [0, -0.7], ease: 'easeOutCubic' },
  { at: 5.05, dur: 0.28, target: '#leafNotes', opacity: [0, 1], x: [-14, 0], ease: 'easeOutCubic' },
  { at: 5.05, dur: 0.90, target: '#leafNotes', rotate: [0, 0.5], ease: 'easeOutCubic' },
  { at: 5.25, dur: 0.28, target: '#leafAssets', opacity: [0, 1], x: [-14, 0], ease: 'easeOutCubic' },
  { at: 5.25, dur: 0.90, target: '#leafAssets', rotate: [0, -0.5], ease: 'easeOutCubic' },
  { at: 4.80, dur: 0.25, target: '#connLeaf1', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 5.00, dur: 0.25, target: '#connLeaf2', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 5.20, dur: 0.25, target: '#connLeaf3', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 5.60, dur: 0.35, target: '#treeCaption', opacity: [0, 1], y: [10, 0] },

  // Beat 4 — drop du dossier code/
  { at: 6.10, dur: 0.04, target: '#folderCode', opacity: [0, 1] },
  { at: 6.10, dur: 0.60, target: '#folderCode', y: [-260, 0], ease: 'easeInOutCubic' },
  { at: 6.68, dur: 0.04, target: '#codeShadow', opacity: [0, 1] },
  { at: 6.68, dur: 0.50, target: '#folderCode', rotate: [0, 0.5], ease: 'easeOutCubic' },
  { at: 6.68, dur: 0.45, target: '#impactRing', keys: { scale: [[0, 0.3], [1, 1.6]], opacity: [[0, 0], [0.1, 0.8], [1, 0]] } },
  { at: 6.72, dur: 0.25, target: '#connCode', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 6.95, dur: 0.25, target: '#codeLabel', opacity: [0, 1] },

  // Beat 5 — connexion de l'icône agent
  { at: 7.60, dur: 0.50, target: '#agentIcon', opacity: [0, 1], x: [160, 0], ease: 'easeOutExpo' },
  { at: 8.00, dur: 0.30, target: '#cableSeg1', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 8.30, dur: 0.25, target: '#cableSeg2', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 8.55, dur: 0.25, target: '#cableSeg3', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 8.80, dur: 0.20, target: '#plugHead', opacity: [0, 1], x: [10, 0] },
  { at: 9.00, dur: 0.15, target: '#plugHead', keys: { x: [[0, 0], [0.5, -6], [1, 0]] } },
  { at: 9.15, dur: 0.60, target: '#agentPulse',
    keys: {
      opacity: [[0, 0], [0.06, 0.9], [0.49, 0, 'easeOutQuad'], [0.5, 0.9], [1, 0, 'easeOutQuad']],
      scale: [[0, 0.6], [1, 1.5]],
    } },
  { at: 9.15, dur: 0.40, target: '#treeIdGlow', keys: { scale: [[0, 1], [0.5, 1.12], [1, 1]] } },
  { at: 9.40, dur: 0.35, target: '#statusLabel', opacity: [0, 1], y: [8, 0] },

  // Beat 6 — mini-branche GitHub : public vs privé
  { at: 10.20, dur: 0.40, target: '#branchLine', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 10.55, dur: 0.25, target: '#forkNode', opacity: [0, 1], scale: [0.5, 1], ease: 'backOut' },
  { at: 10.80, dur: 0.30, target: '#branchPub', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 11.00, dur: 0.30, target: '#branchPriv', draw: [0, 1], ease: 'easeOutCubic' },
  { at: 11.10, dur: 0.35, target: '#nodePublic', opacity: [0, 1], scale: [0.8, 1], ease: 'backOut' },
  { at: 11.35, dur: 0.30, target: '#cloneChip', opacity: [0, 1], x: [12, 0] },
  { at: 11.55, dur: 0.35, target: '#nodePrivate', opacity: [0, 0.55] },
  { at: 11.80, dur: 0.20, target: '#lockShackle', y: [3, 0], opacity: [0.3, 1] },
  { at: 11.95, dur: 0.05, target: '#privateStrike', scaleX: [0, 1], ease: 'linear' },
];

createMotion({
  size: [1920, 1080],
  duration: 12,
  camera: { distance: 8, elevation: 10 },
  background: ['#241708', '#140d05'],
  bloom: { strength: 0.12, radius: 0.4, threshold: 0.95 },
  vignette: 0.25,
  lights: {
    fill: { type: 'ambient', intensity: 0.5 },
  },
  objects: {
    motes: { type: 'particles', count: 180, spread: 7, seed: 42, color: '#b4dd88', opacity: 0.35, size: 0.8 },
  },
  svg,
  score,
}).then((m) => attachReview(m));
