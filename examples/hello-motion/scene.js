// The smallest complete animation: copy this file, change the objects + score.
import { createMotion } from 'agent-stage/kit/index.js';

createMotion({
  size: [1280, 720],
  camera: { distance: 8, elevation: 12 },
  lights: {
    key: { type: 'directional', intensity: 2.5, pos: [4, 6, 5] },
    fill: { type: 'ambient', intensity: 0.3 },
  },
  objects: {
    orb:  { type: 'icosahedron', radius: 1, detail: 3, material: { preset: 'neon', color: '#4de2ff', glow: 1.1 } },
    ring: { type: 'torus', radius: 1.8, tube: 0.025, rot: [75, 0, 0], material: { preset: 'basic', color: '#ffffff', glow: 1.6 } },
    dust: { type: 'particles', count: 1500, spread: 7, color: '#8fd8ff', size: 1.1 },
  },
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
    <text id="title" data-split x="640" y="640" text-anchor="middle" fill="#dff6ff"
          font-family="Helvetica, Arial, sans-serif" font-size="46" font-weight="200" letter-spacing="14">HELLO MOTION</text>
  </svg>`,
  score: [
    { at: 0.0, dur: 1.2, target: 'orb',  scale: [0, 1], ease: 'backOut' },
    { at: 0.0, dur: 6,   target: 'orb',  'rotation.y': [0, 360], ease: 'linear' },
    { at: 0.4, dur: 1.0, target: 'ring', scale: [0, 1], opacity: [0, 1], ease: 'easeOutExpo' },
    { at: 0.0, dur: 6,   target: 'ring', 'rotation.z': [0, 360], ease: 'linear' },
    { at: 0.0, dur: 6,   target: 'camera', azimuth: [-25, 25], distance: [9, 7], ease: 'easeInOutSine' },
    { at: 1.0, dur: 0.8, target: '#title .ch', stagger: 0.06, opacity: [0, 1], y: [24, 0], blur: [8, 0] },
  ],
}).then((m) => m.play());
