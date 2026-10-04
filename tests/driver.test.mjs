// Node-only tests for AgentDriver instance isolation (no DOM).
import { AgentDriver } from '../src/driver/agent-driver.js';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
};
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || 'eq'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeStage() {
  const handlers = Object.create(null);
  return {
    on(n, f) { (handlers[n] ||= []).push(f); },
    off(n, f) { const l = handlers[n]; if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } },
    emit(n, p) { for (const f of [...(handlers[n] || [])]) f(p); },
    frame(dt) { this.emit('tick', { dt }); },
  };
}

function fakeInstance(def, loopOverride) {
  const inst = {
    name: def.name,
    channel: def.channel,
    duration: def.duration,
    loop: loopOverride !== undefined ? loopOverride : def.loop,
    playing: false,
    time: 0,
    playCalls: 0,
    pauseCalls: 0,
    stopCalls: 0,
    seekCalls: [],
    tickCalls: [],
    play() { this.playCalls++; this.playing = true; },
    pause() { this.pauseCalls++; this.playing = false; },
    resume() { this.resumeCalls = (this.resumeCalls || 0) + 1; this.playing = true; },
    stop() { this.stopCalls++; this.playing = false; },
    seek(t2) { this.seekCalls.push(t2); this.time = t2; },
    tick(dt, rate) { this.tickCalls.push([dt, rate ?? 1]); this.time += dt * (rate ?? 1); },
    get finished() { return this._finP; },
    get tracks() { return def.tracks ?? []; },
    get pack() { return this; },
  };
  let resolveFin;
  inst._finP = new Promise((res) => { resolveFin = res; });
  inst.resolveFinished = (result = {}) => resolveFin(result);
  def.instances.push(inst);
  return inst;
}

function fakeDef({ name, channel, loop = false, duration = 2, text } = {}) {
  const def = { name, channel, loop, duration, text, instances: [], createInstanceCalls: [] };
  def.createInstance = (loopOverride) => {
    def.createInstanceCalls.push(loopOverride);
    return fakeInstance(def, loopOverride);
  };
  return def;
}

function makeDriver(defs) {
  const stage = fakeStage();
  const registry = {
    getPack: (n) => {
      const d = defs[n];
      if (!d) throw new Error(`unknown pack ${n}`);
      return d;
    },
    svgLayer: { get: () => ({ querySelector: () => ({ textContent: '' }) }) },
  };
  const driver = new AgentDriver({ stage, timeline: {}, registry, ctx: {} });
  return { stage, registry, driver, defs };
}

function recorder(driver) {
  const events = [];
  for (const n of ['play', 'pause', 'stop', 'finished', 'queued', 'queue-empty']) {
    driver.on(n, (p) => events.push({ n, p }));
  }
  return {
    events,
    of(n) { return events.filter((e) => e.n === n); },
    packs(n, name) { return events.filter((e) => e.n === n && e.p.pack === name); },
  };
}

// (a) same pack played twice concurrently -> two independent instances
await t('same pack on two channels = two independent instances', async () => {
  const d = fakeDef({ name: 'wave', channel: 'body', loop: false, duration: 2 });
  const { stage, driver } = makeDriver({ wave: d });
  const rec = recorder(driver);
  const r1 = driver.play('wave', { channel: 'c1' });
  const r2 = driver.play('wave', { channel: 'c2' });
  eq(d.createInstanceCalls.length, 2, 'createInstance called twice');
  eq(r1.instance === r2.instance, false, 'instances distinct');
  eq(d.instances.length, 2, 'two live instances');
  eq(d.instances[0].pack, d.instances[0], 'pack getter self-ref');

  stage.frame(0.5); // ticks both channels
  eq(d.instances[0].tickCalls.length, 1, 'inst0 ticked once');
  eq(d.instances[1].tickCalls.length, 1, 'inst1 ticked once');
  eq(d.instances[0].time, 0.5, 'inst0 time advanced');
  eq(d.instances[1].time, 0.5, 'inst1 time advanced independently');
  eq(rec.of('play').length, 2, 'two play events');

  driver.stop('c1');
  eq(d.instances[0].stopCalls, 1, 'inst0 stopped');
  eq(d.instances[1].stopCalls, 0, 'inst1 untouched');
  stage.frame(0.5);
  eq(d.instances[0].tickCalls.length, 1, 'stopped instance not ticked further');
  eq(d.instances[1].tickCalls.length, 2, 'other instance keeps ticking');
});

// (b) queued instance finishing: exactly one finished handler / one queue advance
await t('queued chain advances exactly once, single finished handler', async () => {
  const a = fakeDef({ name: 'a', channel: 'q', loop: false, duration: 1 });
  const b = fakeDef({ name: 'b', channel: 'q', loop: false, duration: 1 });
  const { driver } = makeDriver({ a, b });
  const rec = recorder(driver);
  driver.setChannelBlend('q', 'queue');
  driver.play('a');
  driver.play('b'); // queued
  driver.play('b'); // queued again
  eq(rec.of('queued').length, 2, 'two queued events');
  eq(a.instances.length, 1, 'only one live instance before finishes');

  a.instances[0].resolveFinished({ reason: 'end' });
  await flush();
  eq(b.instances.length, 1, 'b started once');
  eq(rec.packs('finished', 'a').length, 1, 'one finished event for a');
  eq(rec.packs('play', 'b').length, 1, 'b play event exactly once');

  b.instances[0].resolveFinished({ reason: 'end' });
  await flush();
  eq(b.instances.length, 2, 'second b started once');
  eq(rec.packs('finished', 'b').length, 1, 'b finished exactly once so far');
  eq(rec.packs('play', 'b').length, 2, 'b play events exactly twice (b1, b2)');

  b.instances[1].resolveFinished({ reason: 'end' });
  await flush();
  eq(rec.packs('finished', 'b').length, 2, 'b finished exactly twice');
  eq(rec.of('queue-empty').length, 1, 'queue-empty exactly once');
  eq(rec.of('finished').length, 3, 'total finished events = 3 (a, b1, b2)');
  // second instance (b) got exactly one finished handler -> only one b finished event
  eq(driver.active('q'), null, 'channel idle after chain drains');
});

// (c) crossfade: dt-based fading, each fading instance ticked once per stage tick
await t('crossfade ticks each fading instance once per dt and stops after fadeTime', async () => {
  const p1 = fakeDef({ name: 'p1', channel: 'cf', loop: false, duration: 10 });
  const p2 = fakeDef({ name: 'p2', channel: 'cf', loop: false, duration: 10 });
  const p3 = fakeDef({ name: 'p3', channel: 'cf', loop: false, duration: 10 });
  const { stage, driver } = makeDriver({ p1, p2, p3 });
  const rec = recorder(driver);
  driver.setChannelBlend('cf', 'crossfade', 0.3);
  driver.play('p1');
  driver.play('p2'); // p1 fading
  driver.play('p3'); // p2 fading
  eq(driver.active('cf'), p3.instances[0], 'p3 is current');

  stage.frame(0.1);
  eq(p1.instances[0].tickCalls.length, 1, 'p1 ticked once');
  eq(p2.instances[0].tickCalls.length, 1, 'p2 ticked once');
  eq(p3.instances[0].tickCalls.length, 1, 'current ticked once');
  eq(p1.instances[0].tickCalls[0][1], 1, 'fade tick uses rate 1');

  stage.frame(0.1);
  stage.frame(0.1); // total 0.3 = fadeTime
  eq(p1.instances[0].stopCalls, 1, 'p1 stopped after fade window');
  eq(p2.instances[0].stopCalls, 1, 'p2 stopped after fade window');
  eq(p3.instances[0].stopCalls, 0, 'current not stopped');
  const stops = rec.packs('stop', 'p1').length + rec.packs('stop', 'p2').length;
  eq(stops, 2, 'two stop events for faded instances');
  stage.frame(0.1);
  eq(p1.instances[0].tickCalls.length, 3, 'p1 not ticked after fade end');
});

// (d) loop override passes through createInstance; no finished handler when looping
await t('loop override reaches createInstance; no finished handler for looping', async () => {
  const d = fakeDef({ name: 'idle', channel: 'state', loop: 'repeat', duration: 4 });
  const { driver } = makeDriver({ idle: d });
  const rec = recorder(driver);
  const { instance } = driver.play('idle', { loop: 'repeat' });
  eq(d.createInstanceCalls[0], 'repeat', 'override passed to createInstance');
  eq(instance.loop, 'repeat', 'instance loop reflects override');
  // simulate a stray resolution: a looping instance must never be processed
  instance.resolveFinished({ reason: 'stray' });
  await flush();
  eq(rec.of('finished').length, 0, 'no finished handler attached for looping instance');
  eq(driver.isPlaying('state'), true, 'still playing');
});

// (e) say() uses an isolated instance and dur-bounds it
await t('say() creates instance and dur-bounds it', async () => {
  const speak = fakeDef({
    name: 'speak', channel: 'speak', loop: false, duration: 3,
    text: { svg: 'face', selector: '#speech' },
  });
  const { stage, driver } = makeDriver({ speak });
  const rec = recorder(driver);
  const r = driver.say('hello', { dur: 0.5 });
  eq(speak.instances.length, 1, 'one instance created');
  eq(r.instance, speak.instances[0], 'say returns the instance');
  eq(speak.instances[0].playCalls, 1, 'instance play called');
  eq(rec.packs('play', 'speak').length, 1, 'play event emitted');

  stage.frame(0.25);
  eq(speak.instances[0].stopCalls, 0, 'not stopped before dur');
  stage.frame(0.25); // time = 0.5 >= dur
  eq(speak.instances[0].stopCalls, 1, 'stopped at dur boundary');
  eq(rec.packs('stop', 'speak').length, 1, 'stop event for say instance');
  eq(driver.active('speak'), null, 'channel cleared');

  // second say: prior instance interrupted, new isolated instance
  driver.say('again', { dur: 1 });
  eq(speak.instances.length, 2, 'second isolated instance');
  eq(speak.instances[0].stopCalls, 1, 'first instance was stopped');
});

// seekAll / isPlaying read instance state
await t('seekAll and isPlaying delegate to instances', async () => {
  const x = fakeDef({ name: 'x', channel: 's', loop: false, duration: 5 });
  const { driver } = makeDriver({ x });
  const { instance } = driver.play('x', { channel: 's' });
  eq(driver.isPlaying('s'), true, 'isPlaying true while playing');
  driver.pause('s');
  eq(instance.pauseCalls, 1, 'pause delegated to instance');
  eq(driver.isPlaying('s'), false, 'isPlaying false when paused');
  driver.resume('s');
  eq(instance.playing, true, 'playing after resume');
  driver.seekAll(2.5);
  eq(instance.seekCalls[0], 2.5, 'seekAll seeks instance');
});

// channel override: finished must resolve against the EFFECTIVE channel
await t('channel override: finished fires, queue advances, active clears on override channel', async () => {
  const a = fakeDef({ name: 'a', channel: 'body', loop: false, duration: 1 });
  const b = fakeDef({ name: 'b', channel: 'body', loop: false, duration: 1 });
  const { driver } = makeDriver({ a, b });
  const rec = recorder(driver);
  driver.setChannelBlend('custom', 'queue');
  const r1 = driver.play('a', { channel: 'custom' });
  driver.play('b', { channel: 'custom' }); // queued
  eq(a.instances[0].channel, 'body', 'instance reports its DEFINITION channel');
  eq(driver.active('custom'), a.instances[0], 'current tracked on override channel');

  a.instances[0].resolveFinished({ reason: 'end' });
  await flush();
  eq(rec.packs('finished', 'a').length, 1, 'finished fired despite channel override');
  eq(rec.packs('finished', 'a')[0].p.channel, 'custom', 'finished payload uses effective channel');
  eq(b.instances.length, 1, 'queue advanced to b');
  eq(driver.active('custom'), b.instances[0], 'b is now current on custom');
  eq(r1.instance.stopCalls, 0, 'a not force-stopped');

  b.instances[0].resolveFinished({ reason: 'end' });
  await flush();
  eq(driver.active('custom'), null, 'custom channel cleared after drain');
  eq(rec.of('queue-empty').length, 1, 'queue-empty exactly once');
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
