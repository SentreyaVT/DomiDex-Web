import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { accessToken, cloudCall, projectId } from './privacy-live-context.mjs';
const token = accessToken();
const call = async (url) => (await cloudCall(token, url)).json();
const api = 'https://firebasehosting.googleapis.com/v1beta1/';
const release = (await call(`${api}sites/domidex/releases?pageSize=1`)).releases[0];
const version = await call(`${api}${release.version.name}`);
const before = JSON.parse(fs.readFileSync('.domidex/security-gate/runtime-switch-plan.json', 'utf8')).baseline;
const page = await call(`${api}${version.name}/files?pageSize=1000`);
assert(!page.nextPageToken);
const currentFiles = Object.fromEntries(page.files.map((file) => [file.path, file.hash]));
assert.equal(Object.keys(currentFiles).length, Object.keys(before.files).length);
const changed = Object.keys(currentFiles).filter((path) => currentFiles[path] !== before.files[path]);
assert(changed.every((path) => ['/legal/datenschutz.html', '/legal/konto-loeschen.html'].includes(path)), 'UNEXPECTED_DESIGN_CHANGE');
const expectedConfig = structuredClone(before.config);
expectedConfig.rewrites.find((item) => item.glob === '**').run.tag = 'privacy-gate-20260904';
assert(isDeepStrictEqual(version.config, expectedConfig));
const pages = {};
for (const route of ['/', '/app', '/datenschutz', '/konto-loeschen', '/kontakt', '/impressum']) {
  const response = await fetch(`https://domidex.web.app${route}`, { signal: AbortSignal.timeout(30_000) });
  pages[route] = response.status; assert.equal(response.status, 200);
  if (['/datenschutz', '/konto-loeschen', '/kontakt', '/impressum'].includes(route)) {
    const text = await response.text();
    assert(!/localhost|127\.0\.0\.1|<script\b|rechtliche Zertifizierung/.test(text));
    if (route === '/datenschutz') assert(text.includes('Dauerhafte öffentliche Firebase-Downloadtokens werden für diese Bilder nicht verwendet'));
    if (route === '/konto-loeschen') assert(text.includes('siebentägige technische Wiederherstellungsfrist'));
  }
}
const fn = await call(`https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/europe-west1/functions/aggregateScanKnowledge`);
assert.equal(fn.state, 'ACTIVE');
const result = { hostingVersion: version.name, changedHostingFiles: changed, allOtherAssetsPreserved: true, pages, evidenceFunction: fn.state, evidenceFunctionUpdatedAt: fn.updateTime };
fs.writeFileSync('.domidex/security-gate/final-release-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
