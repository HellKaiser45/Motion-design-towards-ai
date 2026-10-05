// Applies RFC 6902 JSON Patch suggestions attached to validation errors.
// Patches are suggestions only — never authoritative. The input spec is never
// mutated; repairs run on a deep copy.

function decodePointer(pointer) {
  return pointer
    .split('/')
    .slice(1)
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function resolveParent(doc, tokens) {
  let node = doc;
  for (const t of tokens) {
    if (Array.isArray(node)) {
      const i = t === '-' ? node.length : Number(t);
      if (!Number.isInteger(i) || i < 0 || i >= node.length) {
        throw new Error(`JSON Patch path segment "${t}" not found`);
      }
      node = node[i];
    } else if (node !== null && typeof node === 'object') {
      if (!Object.hasOwn(node, t)) throw new Error(`JSON Patch path segment "${t}" not found`);
      node = node[t];
    } else {
      throw new Error(`JSON Patch path traverses a non-container at "${t}"`);
    }
  }
  return node;
}

function applyOp(doc, op) {
  const tokens = decodePointer(op.path);
  if (tokens.length === 0) throw new Error('JSON Patch cannot target the document root');
  const parent = resolveParent(doc, tokens.slice(0, -1));
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    const i = Number(last);
    if (!Number.isInteger(i) || i < 0 || i > parent.length) {
      throw new Error(`JSON Patch array index "${last}" out of bounds`);
    }
    if (op.op === 'add') {
      parent.splice(i, 0, structuredClone(op.value));
    } else if (op.op === 'remove') {
      if (i >= parent.length) throw new Error(`JSON Patch array index "${last}" not found`);
      parent.splice(i, 1);
    } else if (op.op === 'replace') {
      if (i >= parent.length) throw new Error(`JSON Patch array index "${last}" not found`);
      parent[i] = structuredClone(op.value);
    } else {
      throw new Error(`Unsupported JSON Patch op "${op.op}"`);
    }
    return;
  }
  if (parent === null || typeof parent !== 'object') {
    throw new Error('JSON Patch target parent is not a container');
  }
  if (op.op === 'add' || op.op === 'replace') {
    parent[last] = structuredClone(op.value);
  } else if (op.op === 'remove') {
    delete parent[last];
  } else {
    throw new Error(`Unsupported JSON Patch op "${op.op}"`);
  }
}

/**
 * Apply every error's `patch` (RFC 6902 op array) to a deep copy of the spec,
 * in error order. Errors without a patch are skipped. Returns the repaired
 * spec even if it still fails validation.
 * @returns {{ spec: object, applied: number[], skipped: number[] }}
 */
export function applyErrorPatches(spec, errors) {
  const repaired = JSON.parse(JSON.stringify(spec));
  const applied = [];
  const skipped = [];
  (errors ?? []).forEach((e, i) => {
    if (Array.isArray(e?.patch) && e.patch.length > 0) {
      try {
        for (const op of e.patch) applyOp(repaired, op);
        applied.push(i);
      } catch {
        skipped.push(i);
      }
    } else {
      skipped.push(i);
    }
  });
  return { spec: repaired, applied, skipped };
}
