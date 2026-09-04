import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
const [base, oldStage, newStage] = process.argv.slice(2);
assert(base && oldStage && newStage, 'Usage: verify <origin> <previous stage> <binder stage>');
const overlay = join(newStage, 'release/overlay');
const patch = JSON.parse(readFileSync(join(overlay, 'binder-layout-patch.json')));
const previousOverlay = join(oldStage, 'release/overlay');
const previous = JSON.parse(readFileSync(join(previousOverlay, 'scanner-publication-patch.json')));
const known = new Map(previous.files.map((item) => [item.path, join(previousOverlay, item.path)]));
for (const item of patch.files) known.set(item.path, join(overlay, item.path));
const localFile = (asset) => known.get('client' + asset) ?? join(oldStage, 'runtime/app/dist/client', asset.slice(1));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assets = new Set();
for (const route of ['/', '/app', '/admin/scanner-lab']) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, route);
  const html = await response.text();
  const urls = [...html.matchAll(/(?:src|href)="([^"<>]+(?:\.js|\.css)[^"<>]*)"/g)].map((match) => match[1]);
  assert(urls.includes('/_next/static/css/index.OLhSsBjw-bl1.css'), 'Updated stylesheet reference');
  assert(urls.includes('/_next/static/chunks/index-CxmtnIKp-sp1-bl1.js'), 'Updated bootstrap reference');
  if (route === '/app') assert(urls.includes('/_next/static/chunks/web-app-wBJyCO5H-bl1.js'), 'Updated BinderView reference');
  if (route === '/') {
    assert(!html.includes('class="app-view binder-view"'), 'Binder styles do not target homepage');
    // Compare the rendered landing page against the unchanged preceding revision.
    const before = await fetch('https://scanner-publication-guard-20260903---domidex-web-olqifpb3pa-ew.a.run.app/');
    assert.equal(before.status, 200);
    let normalized = html;
    for (const item of patch.files) if (item.previousPath !== item.path) normalized = normalized.replaceAll(basename(item.path), basename(item.previousPath));
    assert.equal(normalized, await before.text(), 'Homepage HTML unchanged except cache-busted asset names');
  }
  urls.forEach((url) => assets.add(url));
  console.log(`${route}: HTML and exact asset references verified`);
}
for (const item of patch.files) if (item.path.startsWith('client/_next/')) assets.add('/' + item.path.slice(7));
for (const asset of assets) {
  assert(asset.startsWith('/_next/'));
  const response = await fetch(new URL(asset, base), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, asset);
  assert.match(response.headers.get('content-type') || '', asset.endsWith('.css') ? /text\/css/ : /javascript/);
  assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(readFileSync(localFile(asset))), asset);
}
const css = readFileSync(join(overlay, 'client/_next/static/css/index.OLhSsBjw-bl1.css'), 'utf8');
const oldCss = readFileSync(join(oldStage, 'runtime/app/dist/client/_next/static/css/index.OLhSsBjw.css'), 'utf8');
assert(css.startsWith(oldCss), 'All previous stylesheet bytes preserved');
assert.match(css.slice(oldCss.length), /\.binder-view \.binder-book/);
for (const route of ['/api/admin/scanner-profiles', '/api/admin/scan-reports']) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 401, 'Admin access remains protected');
}
console.log(`${assets.size} assets byte-verified; homepage unchanged; binder-only CSS appended; admin access protected.`);
