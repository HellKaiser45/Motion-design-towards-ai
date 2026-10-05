import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateSpec, reportSpec } from '../src/index.js';
import { normalizeCard, buildPokemonCardSpec, TYPE_COLORS } from '../examples/pokemon-card-builder.js';
import { expandScore } from '../src/index.js';

const fixture = JSON.parse(
  readFileSync(new URL('../examples/pokemon-card.fixture.json', import.meta.url), 'utf8'),
);

const BAD_KINDS = ['never-animated', 'invisible', 'leaves-frame', 'overlay-collision'];

function kindsOf(report) {
  return [...new Set(report.issues.map((i) => i.kind))].sort();
}

test('fixture carries the real Base Set Charizard facts', () => {
  assert.equal(fixture.id, 'base1-4');
  assert.equal(fixture.name, 'Charizard');
  assert.equal(fixture.hp, 120);
  assert.deepEqual(fixture.types, ['Fire']);
  assert.equal(fixture.images.large, 'https://images.pokemontcg.io/base1/4_hires.png');
  assert.equal(fixture.images.small, 'https://images.pokemontcg.io/base1/4.png');
  assert.equal(fixture.attacks.length, 2);
  assert.deepEqual(
    { ...fixture.attacks[0], text: undefined },
    { name: 'Energy Burn', cost: ['Fire'], convertedCost: 1, damage: '30', text: undefined },
  );
  assert.equal(fixture.attacks[1].name, 'Fire Spin');
  assert.equal(fixture.attacks[1].damage, '100');
  assert.deepEqual(fixture.weaknesses, [{ type: 'Water', value: '×2' }]);
  assert.equal(fixture.retreatCost, 3);
  assert.equal(fixture.number, '4/102');
  assert.equal(fixture.rarity, 'Holo Rare');
  assert.equal(fixture.artist, 'Mitsuhiro Arita');
  assert.deepEqual(fixture.set, { id: 'base1', name: 'Base', series: 'Base' });
});

test('normalizeCard maps the fixture onto the demo shape (UPPERCASE types)', () => {
  const c = normalizeCard(fixture);
  assert.equal(c.name, 'Charizard');
  assert.equal(c.hp, 120);
  assert.deepEqual(c.types, ['FIRE']);
  assert.equal(c.image, 'https://images.pokemontcg.io/base1/4_hires.png');
  assert.equal(c.attacks.length, 2);
  assert.deepEqual(c.attacks[0], { name: 'Energy Burn', damage: '30' });
  assert.equal(c.retreat, 3);
  assert.equal(c.rarity, 'Holo Rare');
  assert.equal(c.setName, 'Base');
  assert.equal(c.number, '4/102');
  assert.equal(c.artist, 'Mitsuhiro Arita');
});

test('normalizeCard tolerates raw TCG API payloads and missing fields', () => {
  const raw = {
    name: '  Blastoise ',
    hp: '100',
    types: ['water', 'Psychic'],
    images: { small: 'https://example.com/small.png' },
    attacks: [{ name: 'Hydro Pump', damage: 60 }],
    retreatCost: ['C', 'C', 'C'],
    set: { name: 'Base' },
  };
  const c = normalizeCard(raw);
  assert.deepEqual(c.types, ['WATER', 'PSYCHIC']);
  assert.equal(c.image, 'https://example.com/small.png');
  assert.deepEqual(c.attacks, [{ name: 'Hydro Pump', damage: '60' }]);
  assert.equal(c.retreat, 3);
  assert.equal(normalizeCard(null).name, '');
  assert.equal(normalizeCard(undefined).image, '');
});

test('buildPokemonCardSpec produces a valid spec', () => {
  const spec = buildPokemonCardSpec(normalizeCard(fixture));
  const v = validateSpec(spec);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('spec coverage: meta, materials, parents, camera verbs, presets, move-along', () => {
  const spec = buildPokemonCardSpec(normalizeCard(fixture));

  assert.equal(spec.meta.duration, 12);
  assert.equal(spec.meta.size.width, 1280);
  assert.equal(spec.meta.size.height, 720);

  const byName = Object.fromEntries(spec.objects.map((o) => [o.name, o]));
  assert.ok(Object.values(byName).some((o) => o.parent === 'card'), 'an object has parent card');

  const cardObj = byName.card;
  assert.equal(cardObj.material.map, 'https://images.pokemontcg.io/base1/4_hires.png');

  const cameraCues = spec.score.filter((c) => c.to === 'camera');
  assert.deepEqual(
    [...new Set(cameraCues.map((c) => c.do))].sort(),
    ['dolly', 'orbit', 'zoom'],
  );

  const dos = new Set(spec.score.map((c) => c.do));
  for (const preset of ['entrance', 'reveal-text', 'flip', 'pulse', 'float', 'pop', 'emphasis']) {
    assert.ok(dos.has(preset), `preset ${preset} present`);
  }
  // orbit preset on a non-camera target + camera orbit verb
  assert.ok(spec.score.some((c) => c.do === 'orbit' && c.to !== 'camera'));
  assert.ok(dos.has('move-along'), 'move-along present');

  const targets = new Set(
    spec.score.flatMap((c) => (Array.isArray(c.to) ? c.to : [c.to])),
  );
  for (const o of spec.objects) {
    assert.ok(targets.has(o.name), `object ${o.name} is a cue target`);
  }

  assert.ok(spec.score.length > 25, `score length ${spec.score.length} > 25`);
});

test('arc lock: expanded score lands in the 12.5–16s natural window', () => {
  const spec = buildPokemonCardSpec(normalizeCard(fixture));
  const e = expandScore(spec);
  assert.equal(e.errors.length, 0, JSON.stringify(e.errors));
  assert.ok(
    e.naturalDuration >= 12.5 && e.naturalDuration <= 16,
    `naturalDuration ${e.naturalDuration} outside 12.5..16`,
  );
});

test('reportSpec: ok, duration 12, and clean of hard issue kinds', () => {
  const spec = buildPokemonCardSpec(normalizeCard(fixture));
  const report = reportSpec(spec, { samples: 16 });
  assert.equal(report.ok, true, JSON.stringify(report.errors ?? report.issues));
  assert.ok(Math.abs(report.duration - 12) <= 0.05, `duration ${report.duration}`);

  const kinds = kindsOf(report);
  for (const bad of BAD_KINDS) {
    assert.ok(!kinds.includes(bad), `no ${bad} issue (got ${kinds.join(', ')})`);
  }
  // compile-warning is expected headless (DOM no-ops); it is the only kind.
  assert.deepEqual(kinds, ['compile-warning']);
});

test('long-name card still validates and reports clean', () => {
  const longCard = normalizeCard({
    name: 'Charizard Mega Gigantamax Supreme',
    hp: 999,
    types: ['Dragon'],
    attacks: [
      { name: 'Inferno Mega Blaze Overdrive Crush', damage: '250' },
      { name: 'Astral Radiance Tempest Cataclysm Strike', damage: '999' },
    ],
    retreatCost: 5,
    rarity: 'Ultra Secret Rare Holo',
    number: '999/999',
    artist: 'A Very Long Artist Name Indeed',
    set: { name: 'Mega Gigantamax Collection' },
  });
  const spec = buildPokemonCardSpec(longCard);
  assert.equal(validateSpec(spec).ok, true);

  const report = reportSpec(spec, { samples: 16 });
  assert.equal(report.ok, true, JSON.stringify(report.errors ?? report.issues));
  assert.ok(Math.abs(report.duration - 12) <= 0.05);
  const kinds = kindsOf(report);
  assert.ok(!kinds.includes('overlay-collision'), `no overlay-collision (got ${kinds.join(', ')})`);
  assert.deepEqual(kinds.filter((k) => BAD_KINDS.includes(k)), []);
});

test('reportSpec is deterministic across runs', () => {
  const spec = buildPokemonCardSpec(normalizeCard(fixture));
  const a = reportSpec(spec, { samples: 16 });
  const b = reportSpec(spec, { samples: 16 });
  assert.deepEqual(a, b);
});

test('TYPE_COLORS covers the full game type palette', () => {
  assert.equal(TYPE_COLORS.Fire, '#f08030');
  assert.equal(TYPE_COLORS.Water, '#6890f0');
  assert.equal(TYPE_COLORS.Colorless, '#a8a878');
  assert.equal(Object.keys(TYPE_COLORS).length, 11);
});
