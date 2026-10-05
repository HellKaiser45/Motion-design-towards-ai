import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import {
  describeTokens,
  validateSpec,
  buildJsonSchema,
  createStage,
  reportSpec,
} from '../index.js';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const PROTOCOL_VERSION = '2024-11-05';

const TOOL_NAMES = ['describe', 'schema', 'validate', 'compile', 'report'];

const EMPTY_ARGS_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const SPEC_ARGS_SCHEMA = {
  type: 'object',
  required: ['spec'],
  properties: {
    spec: { type: 'object', description: 'agent-stage spec object' },
  },
};

const REPORT_ARGS_SCHEMA = {
  type: 'object',
  required: ['spec'],
  properties: {
    spec: { type: 'object', description: 'agent-stage spec object' },
    samples: { type: 'integer', minimum: 1, maximum: 120 },
  },
};

const TOOLS = [
  {
    name: 'describe',
    description:
      'Full agent-stage vocabulary: score verbs, presets, eases, bridge props, object types, and validation rules. Call this first to learn the spec language.',
    inputSchema: EMPTY_ARGS_SCHEMA,
  },
  {
    name: 'schema',
    description: 'The agent-stage JSON Schema (draft 2020-12) for spec objects.',
    inputSchema: EMPTY_ARGS_SCHEMA,
  },
  {
    name: 'validate',
    description:
      'Validate an agent-stage spec. Returns { ok, errors } where mechanical errors carry a suggestion and an RFC-6902 patch to fix them.',
    inputSchema: SPEC_ARGS_SCHEMA,
  },
  {
    name: 'compile',
    description:
      'Headless-compile an agent-stage spec: validates the spec and compiles its score. Returns { ok, errors, warnings, duration, materialWarnings }.',
    inputSchema: SPEC_ARGS_SCHEMA,
  },
  {
    name: 'report',
    description:
      'Sample an agent-stage spec over time and return a full verdict: per-frame snapshots, object stats, and issues (never-animated, invisible, off-screen, overlay collisions).',
    inputSchema: REPORT_ARGS_SCHEMA,
  },
];

function textResult(text, isError = false) {
  const result = { content: [{ type: 'text', text }] };
  if (isError) result.isError = true;
  return result;
}

function errorResult(code, message, id) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

const TOOL_HANDLERS = {
  describe() {
    return describeTokens();
  },
  schema() {
    return buildJsonSchema();
  },
  validate(args) {
    const spec = args.spec;
    if (spec === undefined || spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      return {
        isError: true,
        message: 'Missing or invalid "spec": pass an agent-stage spec object as { spec: {...} }.',
      };
    }
    return validateSpec(spec);
  },
  compile(args) {
    const spec = args.spec;
    if (spec === undefined || spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      return {
        isError: true,
        message: 'Missing or invalid "spec": pass an agent-stage spec object as { spec: {...} }.',
      };
    }
    const stage = createStage(spec, { webgl: false, onValidateError: () => {} });
    if (!stage.ok) {
      return { isError: true, message: JSON.stringify({ ok: false, errors: stage.errors }) };
    }
    try {
      const sc = stage.scoreCompile;
      return {
        ok: sc.ok,
        errors: sc.errors,
        warnings: sc.warnings,
        duration: sc.duration,
        materialWarnings: stage.materialWarnings ?? [],
      };
    } finally {
      stage.dispose();
    }
  },
  report(args) {
    const spec = args.spec;
    if (spec === undefined || spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      return {
        isError: true,
        message: 'Missing or invalid "spec": pass an agent-stage spec object as { spec: {...} }.',
      };
    }
    const samples = args.samples ?? 12;
    return reportSpec(spec, { samples });
  },
};

function dispatchTool(name, args) {
  if (!Object.hasOwn(TOOL_HANDLERS, name)) {
    return textResult(`Unknown tool "${name}". Known tools: ${TOOL_NAMES.join(', ')}.`, true);
  }
  try {
    const result = TOOL_HANDLERS[name](args ?? {});
    if (result && typeof result === 'object' && result.isError) {
      return textResult(result.message ?? JSON.stringify(result), true);
    }
    return textResult(JSON.stringify(result));
  } catch (err) {
    return textResult(`Tool "${name}" failed: ${err && err.message ? err.message : String(err)}`, true);
  }
}

export function handleRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body) || typeof body.method !== 'string') {
    const id = body && typeof body === 'object' && !Array.isArray(body) ? body.id : undefined;
    if (id === undefined || id === null) return null;
    return errorResult(-32602, 'Invalid request: expected an object with a string "method".', id);
  }

  const { id, method } = body;

  if (method === 'initialized' || method.startsWith('notifications/')) {
    return null;
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-stage', version },
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = body.params ?? {};
    return { jsonrpc: '2.0', id, result: dispatchTool(name, args) };
  }

  return errorResult(-32601, `Method not found: ${method}`, id);
}

export function startServer({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(errorResult(-32700, 'Parse error: invalid JSON.', null))}\n`);
      return;
    }
    const response = handleRequest(message);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  });
  return function stop() {
    rl.close();
  };
}
