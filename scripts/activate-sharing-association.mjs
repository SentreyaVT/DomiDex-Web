import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { cloudClient, firebaseCliToken } from './sharing-cloud-context.mjs';

// Hosting AUTO serves its generated association before the Cloud Run rewrite.
// Disable that generator only after supplying an explicit Android association
// and preserving the two currently-empty Apple associations byte-for-byte.
const folder = '.domidex/sharing-activation/native';
const before = JSON.parse(await fs.readFile(folder + '/hosting-runtime-after.json', 'utf8'));
const token = await firebaseCliToken(), call = cloudClient(token);
const api = 'https://firebasehosting.googleapis.com/v1beta1/';
async function latest() {
  return (await call(api + 'sites/domidex/releases?pageSize=1')).releases[0];
}
assert.equal((await latest()).version.name, before.version, 'HOSTING_CHANGED');
const newFiles = new Map();
newFiles.set('/.well-known/assetlinks.json', await fs.readFile('sharing-entry/assetlinks.json'));
for (const path of ['/apple-app-site-association', '/.well-known/apple-app-site-association']) {
  const response = await fetch('https://domidex.web.app' + path, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(JSON.parse(bytes.toString()), { applinks: { apps: [], details: [] } }, 'APPLE_ASSOCIATION_CHANGED');
  newFiles.set(path, bytes);
}
const config = structuredClone(before.config);
config.appAssociation = 'NONE';
for (const path of newFiles.keys()) {
  assert(!(path in before.files), 'EXISTING_STATIC_FILE_WOULD_CHANGE');
  config.headers.push({ glob: path, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' } });
}
const files = { ...before.files }, content = new Map();
for (const [path, bytes] of newFiles) {
  const compressed = gzipSync(bytes, { level: 9 });
  const hash = createHash('sha256').update(compressed).digest('hex');
  files[path] = hash; content.set(hash, compressed);
}
const version = await call(api + 'sites/domidex/versions', 'POST', { config });
assert(isDeepStrictEqual((await call(api + version.name)).config, config), 'CONFIG_NOT_ACCEPTED');
const populate = await call(api + version.name + ':populateFiles', 'POST', { files });
for (const hash of populate.uploadRequiredHashes || []) {
  assert(content.has(hash), 'EXISTING_ASSET_MISSING');
  const url = new URL(populate.uploadUrl + '/' + hash);
  assert(url.protocol === 'https:' && url.hostname.endsWith('.googleapis.com'));
  const result = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: content.get(hash), signal: AbortSignal.timeout(30000) });
  assert(result.ok, 'ASSOCIATION_UPLOAD_FAILED');
}
assert.equal((await latest()).version.name, before.version, 'HOSTING_CHANGED');
await call(api + version.name + '?updateMask=status', 'PATCH', { status: 'FINALIZED' });
await call(api + 'sites/domidex/releases?versionName=' + encodeURIComponent(version.name), 'POST', { message: 'Use explicit DomiDex Android link association; preserve existing web files and empty Apple associations' });
const association = await fetch('https://domidex.web.app/.well-known/assetlinks.json', { signal: AbortSignal.timeout(15000) });
assert.equal(association.status, 200); assert(!association.redirected);
assert.deepEqual(await association.json(), JSON.parse(newFiles.get('/.well-known/assetlinks.json').toString()));
const report = { previousVersion: before.version, version: version.name, config, files, existingFilesUnchanged: Object.keys(before.files).length, addedAssociationFiles: [...newFiles.keys()], verified: true };
await fs.writeFile(folder + '/association-hosting-after.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ version: version.name, existingFilesUnchanged: report.existingFilesUnchanged, associationVerified: true }));
