import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildJsonSchema } from '../src/spec/jsonSchema.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docsDir = path.join(root, 'docs');
mkdirSync(docsDir, { recursive: true });
writeFileSync(
  path.join(docsDir, 'spec.schema.json'),
  JSON.stringify(buildJsonSchema(), null, 2) + '\n'
);
console.log('wrote docs/spec.schema.json');
