import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { handleRequest, startServer } from '../src/mcp/server.js';
import { describeTokens, buildJsonSchema } from '../src/index.js';

const SPEC = {
  meta: { title: 'mcp test', background: '#0a0a0f' },
  camera: { position: [3, 2, 5], lookAt: [0, 0, 0] },
  lights: [{ name: 'key', type: 'directional' }],
  objects: [
    { name: 'hero', type: 'box', material: { preset: 'neon', color: '#22d3ee' } },
  ],
  score: [
    { do: 'spin', to: 'hero', at: 0, with: { axis: 'y', speed: 1.2 } },
    { do: 'move-to', to: 'hero', at: 0, dur: 1, ease: 'power2.out', with: { x: 0, y: 2, z: 0 } },
  ],
};

function call(name, args, id = 1) {
  return handleRequest({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
}

function resultPayload(res) {
  return JSON.parse(res.result.content[0].text);
}

test('initialize returns protocol version, capabilities, and server info', () => {
  const res = handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(res.jsonrpc, '2.0');
  assert.equal(res.id, 1);
  assert.equal(res.result.protocolVersion, '2024-11-05');
  assert.ok(res.result.capabilities.tools);
  assert.equal(res.result.serverInfo.name, 'agent-stage');
  assert.ok(res.result.serverInfo.version);
});

test('notifications produce no response', () => {
  assert.equal(handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(handleRequest({ jsonrpc: '2.0', method: 'initialized' }), null);
  assert.equal(handleRequest({ jsonrpc: '2.0', method: 'notifications/anything', params: {} }), null);
});

test('tools/list exposes exactly the 5 tools with descriptions and schemas', () => {
  const res = handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = res.result.tools;
  assert.deepEqual(
    tools.map((t) => t.name),
    ['describe', 'schema', 'validate', 'compile', 'report'],
  );
  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 0);
    assert.equal(tool.inputSchema.type, 'object');
  }
});

test('tools/call describe matches describeTokens', () => {
  const res = call('describe', {});
  assert.ok(!res.result.isError);
  assert.deepEqual(resultPayload(res), describeTokens());
});

test('tools/call schema matches buildJsonSchema', () => {
  const res = call('schema', {});
  assert.ok(!res.result.isError);
  assert.deepEqual(resultPayload(res), buildJsonSchema());
});

test('tools/call validate returns suggestion and patch for a bad ease', () => {
  const bad = JSON.parse(JSON.stringify(SPEC));
  bad.score[1].ease = 'power2.oout';
  const res = call('validate', { spec: bad });
  const payload = resultPayload(res);
  assert.equal(payload.ok, false);
  assert.ok(Array.isArray(payload.errors) && payload.errors.length > 0);
  assert.equal(payload.errors[0].suggestion, 'power2.out');
  assert.ok(Array.isArray(payload.errors[0].patch));
});

test('tools/call compile compiles a valid spec headlessly', () => {
  const res = call('compile', { spec: SPEC });
  const payload = resultPayload(res);
  assert.equal(payload.ok, true);
  assert.ok(payload.duration > 0);
  assert.deepEqual(payload.errors, []);
});

test('tools/call compile reports invalid spec as error, never throws', () => {
  const bad = JSON.parse(JSON.stringify(SPEC));
  bad.objects[0].type = 'nonexistent-shape';
  const res = call('compile', { spec: bad });
  assert.equal(res.result.isError, true);
});

test('tools/call report samples frames and issues', () => {
  const res = call('report', { spec: SPEC, samples: 4 });
  const payload = resultPayload(res);
  assert.equal(payload.ok, true);
  assert.equal(payload.frames.length, 5);
  assert.ok(Array.isArray(payload.issues));
});

test('tools/call with unknown tool returns an error result naming known tools', () => {
  const res = call('frobnicate', {}, 9);
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /describe/);
  assert.match(res.result.content[0].text, /report/);
});

test('malformed request handling: bad shape with id is -32602, without id is null', () => {
  assert.equal(handleRequest('nope'), null);
  assert.equal(handleRequest(null), null);
  const res = handleRequest({ jsonrpc: '2.0', id: 5, method: 42 });
  assert.equal(res.error.code, -32602);
  const noId = handleRequest({ method: 42 });
  assert.equal(noId, null);
  const unknown = handleRequest({ jsonrpc: '2.0', id: 6, method: 'no/such/method' });
  assert.equal(unknown.error.code, -32601);
});

test('startServer pipes lines to responses over in-memory streams', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const stop = startServer({ input, output });

  const responses = [];
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  let buffer = '';
  output.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim() !== '') responses.push(JSON.parse(line));
    }
    if (responses.length >= 2) resolveDone();
  });

  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);

  await Promise.race([
    done,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout waiting for responses')), 5000)),
  ]);

  assert.equal(responses.length, 2);
  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.serverInfo.name, 'agent-stage');
  assert.equal(responses[1].id, 2);
  assert.equal(responses[1].result.tools.length, 5);

  stop();
});

test('spawned server speaks newline-delimited JSON-RPC and reports parse errors', async () => {
  const child = spawn(process.execPath, ['bin/mcp-server.mjs'], { cwd: process.cwd() });
  const responses = [];
  try {
    let buffer = '';
    let resolveDone;
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim() !== '') responses.push(JSON.parse(line));
      }
      if (responses.length >= 3) resolveDone();
    });

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    child.stdin.write('this is not json\n');

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout waiting for child responses')), 10000),
    );
    await Promise.race([done, timeout]);
  } finally {
    child.kill();
  }

  assert.equal(responses.length, 3);
  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.protocolVersion, '2024-11-05');
  assert.equal(responses[1].id, 2);
  assert.equal(responses[1].result.tools.length, 5);
  assert.equal(responses[2].id, null);
  assert.equal(responses[2].error.code, -32700);
});
