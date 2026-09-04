import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync('/tmp/private-manifest.json', 'utf8'));
for (const file of manifest) assert.equal(createHash('sha256').update(readFileSync(`/app/dist/${file.path}`)).digest('hex'), file.before, `Unexpected live base: ${file.path}`);
