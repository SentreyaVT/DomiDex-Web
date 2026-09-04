import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const base = process.argv[2];
const stage = process.argv[3];
assert(base && stage, 'Usage: verify <candidate or live origin> <deployment stage>');
const original = join(stage, 'runtime/app/dist');
const overlay = join(stage, 'release/overlay');
const patch = JSON.parse(readFileSync(join(overlay, 'scanner-publication-patch.json'), 'utf8'));
const changedClient = new Map(patch.files.filter((item) => item.path.startsWith('client/')).map((item) => ['/' + item.path.slice(7), item]));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const seen = new Set();
for (const route of ['/', '/app', '/admin/scanner-lab']) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `${route}: response`);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="([^"<>]+(?:\.js|\.css)[^"<>]*)"/g)].map((match) => match[1]);
  assert(assets.includes('/_next/static/css/index.OLhSsBjw.css'), `${route}: original stylesheet reference preserved`);
  assert(assets.includes('/_next/static/chunks/index-CxmtnIKp-sp1.js'), `${route}: new bootstrap`);
  if (route === '/admin/scanner-lab') assert(assets.includes('/_next/static/chunks/scanner-lab-BouSWTFK-sp1.js'));
  for (const asset of assets) seen.add(asset);
  console.log(`${route}: HTML 200, stylesheet and bootstrap references verified`);
}
// Vinext's build manifests are read internally and deliberately not served.
for (const path of changedClient.keys()) if (path.startsWith('/_next/')) seen.add(path);
for (const asset of seen) {
  assert(asset.startsWith('/_next/') || asset === '/vinext-client-entry-manifest.json', 'Unexpected asset origin');
  const response = await fetch(new URL(asset, base), { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `${asset}: response`);
  const contentType = response.headers.get('content-type') || '';
  assert(!contentType.includes('text/html'), `${asset}: must not be an HTML fallback`);
  if (asset.endsWith('.css')) assert.match(contentType, /text\/css/);
  if (asset.endsWith('.js')) assert.match(contentType, /javascript/);
  const bytes = Buffer.from(await response.arrayBuffer());
  const local = changedClient.has(asset) ? join(overlay, changedClient.get(asset).path) : join(original, 'client', asset.slice(1));
  assert.equal(digest(bytes), digest(readFileSync(local)), `${asset}: exact expected bytes`);
}
for (const path of ['/api/admin/scanner-profiles', '/api/admin/scan-reports']) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 401, `${path}: anonymous access remains blocked`);
}
const post = await fetch(new URL('/api/admin/scanner-profiles', base), {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'publish', confirm: 'PUBLISH' }), signal: AbortSignal.timeout(30_000),
});
assert.equal(post.status, 401, 'Anonymous publication remains blocked');
console.log(`${seen.size} assets byte-verified; anonymous scanner API access and publication rejected.`);
