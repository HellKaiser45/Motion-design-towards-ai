// Pokemon card showcase spec builder. Pure data module: no imports, so it
// runs in the browser (examples/pokemon-card.html) and in Node tests alike.

export const TYPE_COLORS = Object.freeze({
  Fire: '#f08030',
  Water: '#6890f0',
  Grass: '#78c850',
  Lightning: '#f8d030',
  Psychic: '#f85888',
  Fighting: '#c03028',
  Darkness: '#705898',
  Metal: '#b8b8d0',
  Dragon: '#7038f8',
  Fairy: '#ee99ac',
  Colorless: '#a8a878',
});

function cap(type) {
  return type ? type[0].toUpperCase() + type.slice(1).toLowerCase() : '';
}

export function typeColor(type) {
  return TYPE_COLORS[cap(type)] ?? TYPE_COLORS.Colorless;
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Tolerant normalizer: accepts a raw TCG API v2 card, the local fixture, or
// an already-normalized card. Types are normalized to UPPERCASE.
export function normalizeCard(card) {
  const c = card ?? {};
  const types = (Array.isArray(c.types) ? c.types : [])
    .filter((t) => typeof t === 'string' && t.trim() !== '')
    .map((t) => t.trim().toUpperCase());
  const image =
    c.images?.large ?? c.images?.small ?? (typeof c.image === 'string' ? c.image : '');
  const attacks = (Array.isArray(c.attacks) ? c.attacks : []).map((a) => ({
    name: String(a?.name ?? ''),
    damage: a?.damage != null ? String(a.damage) : '',
  }));
  const retreat = Array.isArray(c.retreatCost)
    ? c.retreatCost.length
    : toNumber(c.retreatCost, 0);
  return {
    name: String(c.name ?? ''),
    hp: toNumber(c.hp, 0),
    types,
    image,
    attacks,
    retreat,
    rarity: String(c.rarity ?? ''),
    setName: String(c.set?.name ?? c.setName ?? ''),
    number: String(c.number ?? ''),
    artist: String(c.artist ?? ''),
  };
}

// reportSpec's overlay-collision estimate: bbox width = size * 0.6 * len.
const CHAR_W = 0.6;

// Shrink font-size until the estimated width fits maxW (never grows).
function fitSize(content, size, maxW, min = 24) {
  const len = Math.max(1, content.length);
  if (size * CHAR_W * len <= maxW) return size;
  return Math.max(min, Math.floor(maxW / (CHAR_W * len)));
}

export function buildPokemonCardSpec(card) {
  const c = normalizeCard(card);
  const primary = c.types[0] ?? 'Colorless';
  const accent = typeColor(primary);
  const rim = accent === '#f08030' ? '#6890f0' : '#f08030';

  // ---- SVG overlay text (all start opacity 0; revealed by reveal-text) ----
  const hpContent = `HP ${c.hp}`;
  const titleContent = c.name;
  const typeContent = c.types.join(' · ');
  const setContent = `${c.setName} · #${c.number} · ${c.rarity}`;
  const creditContent = `art. ${c.artist}`;

  const hpSize = fitSize(hpContent, 28, 220, 12);
  const hpW = hpSize * CHAR_W * hpContent.length;
  // Title (x 640, middle) must clear the right-aligned hp pill (x 1180).
  const titleMaxW = Math.min(900, 2 * (1180 - hpW - 12 - 640));
  const titleSize = fitSize(titleContent, 44, titleMaxW, 24);

  const text = [
    { id: 'title', content: titleContent, split: 'word', x: 640, y: 70, size: titleSize, weight: 800, align: 'middle', color: '#f8fafc', opacity: 0 },
    { id: 'hp', content: hpContent, split: 'char', x: 1180, y: 70, size: hpSize, weight: 700, align: 'end', color: accent, opacity: 0 },
    { id: 'typeLine', content: typeContent, split: 'char', x: 640, y: 112, size: fitSize(typeContent, 20, 500, 12), align: 'middle', color: '#94a3b8', opacity: 0 },
    { id: 'atkLabel', content: 'ATTACKS', split: 'char', x: 130, y: 430, size: 18, color: '#64748b', opacity: 0 },
  ];

  const attackCues = [];
  c.attacks.slice(0, 3).forEach((atk, i) => {
    const content = `${atk.name} — ${atk.damage}`.trim();
    text.push({
      id: `attack${i + 1}`,
      content,
      split: 'char',
      x: 130,
      y: 470 + i * 64,
      size: fitSize(content, 26, 600, 12),
      color: '#e2e8f0',
      opacity: 0,
    });
    attackCues.push({ id: `atk${i + 1}`, do: 'reveal-text', to: `#attack${i + 1}`, after: i === 0 ? 'atkLabel' : `atk${i}`, offset: 0.2, dur: 0.7, with: { of: 'chars' } });
  });

  text.push(
    { id: 'setInfo', content: setContent, split: 'char', x: 640, y: 660, size: fitSize(setContent, 16, 600, 10), align: 'middle', color: '#94a3b8', opacity: 0 },
    { id: 'credit', content: creditContent, split: 'char', x: 640, y: 690, size: fitSize(creditContent, 14, 600, 10), align: 'middle', color: '#64748b', opacity: 0 },
  );

  // Corner brackets: 8 short LINES (zero-area bboxes — no overlay collisions).
  const B = '#334155';
  const shapes = [
    { id: 'br-tl-h', type: 'line', x1: 40, y1: 40, x2: 120, y2: 40, stroke: B, strokeWidth: 2 },
    { id: 'br-tl-v', type: 'line', x1: 40, y1: 40, x2: 40, y2: 120, stroke: B, strokeWidth: 2 },
    { id: 'br-tr-h', type: 'line', x1: 1160, y1: 40, x2: 1240, y2: 40, stroke: B, strokeWidth: 2 },
    { id: 'br-tr-v', type: 'line', x1: 1240, y1: 40, x2: 1240, y2: 120, stroke: B, strokeWidth: 2 },
    { id: 'br-bl-h', type: 'line', x1: 40, y1: 680, x2: 120, y2: 680, stroke: B, strokeWidth: 2 },
    { id: 'br-bl-v', type: 'line', x1: 40, y1: 680, x2: 40, y2: 600, stroke: B, strokeWidth: 2 },
    { id: 'br-br-h', type: 'line', x1: 1160, y1: 680, x2: 1240, y2: 680, stroke: B, strokeWidth: 2 },
    { id: 'br-br-v', type: 'line', x1: 1240, y1: 680, x2: 1240, y2: 600, stroke: B, strokeWidth: 2 },
  ];

  // ---- 3D objects ----
  const cardMaterial = { preset: 'standard', color: '#cccccc' };
  if (c.image) cardMaterial.map = c.image;

  const orbs = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    orbs.push({
      name: `orb${i + 1}`,
      type: 'icosahedron',
      params: { radius: 0.12 },
      material: { preset: 'neon', color: i % 2 === 0 ? accent : '#ffffff' },
      position: [2.4 * Math.cos(a), 0.3, -0.4 + 2.4 * Math.sin(a)],
    });
  }

  const objects = [
    { name: 'card', type: 'plane', params: { width: 2.4, height: 3.36 }, material: cardMaterial, position: [0, 0.3, 0] },
    { name: 'cardBack', type: 'plane', params: { width: 2.4, height: 3.36 }, material: { preset: 'standard', color: '#101020' }, position: [0, 0.3, -0.02], rotation: [0, Math.PI, 0], parent: 'card' },
    { name: 'sheen', type: 'plane', params: { width: 2.4, height: 3.36 }, material: { preset: 'glass', color: '#ffffff', opacity: 0.18 }, position: [0, 0.3, 0.015], parent: 'card' },
    { name: 'energyRing', type: 'torus', params: { radius: 1.8, tube: 0.03 }, material: { preset: 'neon', color: accent }, position: [0, 0.3, -1.4] },
    ...orbs,
    { name: 'spark1', type: 'sphere', params: { radius: 0.05 }, material: { preset: 'neon', color: '#ffffff' }, position: [2.6, 0.5, -0.4] },
    { name: 'spark2', type: 'sphere', params: { radius: 0.05 }, material: { preset: 'neon', color: '#ffffff' }, position: [0, 0.5, 1.6] },
    { name: 'spark3', type: 'sphere', params: { radius: 0.05 }, material: { preset: 'neon', color: '#ffffff' }, position: [-2.6, 0.5, -0.4] },
  ];

  // ---- Score: ~12s arc, every object targeted ----
  const orbNames = orbs.map((o) => o.name);
  const lastAttackId = attackCues.length > 0 ? `atk${attackCues.length}` : 'atkLabel';

  const sparksPoints = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    sparksPoints.push([2.6 * Math.cos(a), 0.5, -0.4 + 2.0 * Math.sin(a)]);
  }

  const score = [
    { id: 'intro', do: 'entrance', to: 'card', at: 0, dur: 1.2, ease: 'power3.out', with: { from: 'front', distance: 4 } },
    { id: 'ring', do: 'pop', to: 'energyRing', alongside: 'intro', offset: 0.3, dur: 0.8 },
    { id: 'orbs', do: 'entrance', to: orbNames, alongside: 'intro', dur: 1, stagger: 0.08, with: { from: 'below', distance: 1.5 } },
    { id: 'orbFloat', do: 'float', to: orbNames, alongside: 'intro', dur: 1.8, with: { height: 0.25, count: 2 } },
    { id: 'orbSpin', do: 'orbit', to: orbNames, alongside: 'intro', dur: 10, with: { center: [0, 0.3, -0.4], radius: 2.4, revolutions: 0.8, steps: 24 } },
    { id: 'orbTwinkle', do: 'pulse', to: orbNames, alongside: 'orbFloat', dur: 2, stagger: 0.1, with: { amount: 1.15, count: 2 } },
    { id: 'ringSpin', do: 'spin', to: 'energyRing', alongside: 'intro', dur: 12, with: { axis: 'z', speed: 0.5 } },
    { id: 'cardIdle', do: 'float', to: 'card', alongside: 'intro', dur: 1.5, with: { height: 0.12, count: 3 } },
    { id: 'title', do: 'reveal-text', to: '#title', after: 'intro', dur: 1.0, with: { of: 'words', stagger: 0.08 } },
    { id: 'hp', do: 'reveal-text', to: '#hp', after: 'title', dur: 0.8, with: { of: 'chars' } },
    { id: 'typeLine', do: 'reveal-text', to: '#typeLine', after: 'title', dur: 0.8, with: { of: 'chars' } },
    { id: 'atkLabel', do: 'reveal-text', to: '#atkLabel', after: 'hp', dur: 0.8, with: { of: 'chars' } },
    ...attackCues,
    { id: 'setInfo', do: 'reveal-text', to: '#setInfo', after: lastAttackId, dur: 0.6, with: { of: 'chars' } },
    { id: 'credit', do: 'reveal-text', to: '#credit', alongside: 'setInfo', dur: 0.6, with: { of: 'chars' } },
    { id: 'sparks', do: 'move-along', to: ['spark1', 'spark2', 'spark3'], alongside: 'atkLabel', dur: 4, stagger: 0.8, ease: 'sine.inOut', with: { points: sparksPoints, closed: true } },
    { id: 'sparksFade', do: 'fade', to: ['spark1', 'spark2', 'spark3'], after: 'sparks', dur: 1, stagger: 0.2, with: { opacity: 0 } },
    { id: 'sheenPulse', do: 'pulse', to: 'sheen', alongside: 'sparks', dur: 0.5, with: { amount: 1.05, count: 3 } },
    { id: 'flip', do: 'flip', to: ['card', 'cardBack'], after: 'sparks', dur: 1.4, ease: 'power2.inOut', with: { axis: 'y', turns: 1 } },
    { id: 'sheenOut', do: 'fade', to: 'sheen', alongside: 'flip', dur: 1, with: { opacity: 0 } },
    { id: 'camOrbit', do: 'orbit', to: 'camera', alongside: 'flip', dur: 2.4, ease: 'sine.inOut', with: { center: [0, 0.3, 0], to: 1.0, radius: 7, height: 0.6 } },
    { id: 'camDolly', do: 'dolly', to: 'camera', after: 'camOrbit', dur: 1.6, ease: 'power2.inOut', with: { center: [0, 0.3, 0], to: 5.8 } },
    { id: 'camZoom', do: 'zoom', to: 'camera', alongside: 'camDolly', dur: 1.6, ease: 'power2.inOut', with: { to: 44 } },
    { id: 'finale', do: 'emphasis', to: 'card', after: 'camDolly', dur: 0.9, with: { amount: 1.12 } },
    { id: 'glow', do: 'color-to', to: 'energyRing', alongside: 'finale', dur: 1, with: { hex: accent } },
  ];

  return {
    meta: {
      title: `${c.name} — 3D card demo`,
      background: '#07080f',
      duration: 12,
      size: { width: 1280, height: 720 },
    },
    camera: { fov: 40, position: [0, 0.6, 7], lookAt: [0, 0.3, 0] },
    lights: [
      { name: 'key', type: 'spot', color: '#ffffff', intensity: 1.6, position: [0, 4, 6], target: [0, 0, 0] },
      { name: 'fill', type: 'ambient', color: '#ffffff', intensity: 0.25, position: [0, 0, 0] },
      { name: 'accent', type: 'point', color: accent, intensity: 2, position: [-3, 1, 2] },
      { name: 'rim', type: 'point', color: rim, intensity: 1.5, position: [3, -1, -2] },
    ],
    objects,
    svg: { fit: 'cover', text, shapes },
    score,
  };
}
