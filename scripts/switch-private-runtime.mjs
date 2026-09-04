import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { accessToken, cloudCall } from './privacy-live-context.mjs';

const api = 'https://firebasehosting.googleapis.com/v1beta1/';
const token = accessToken();
const call = async (resource, method = 'GET', body) => (await cloudCall(token, `${api}${resource}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
async function snapshot() {
  const release = (await call('sites/domidex/releases?pageSize=1')).releases[0];
  const version = await call(release.version.name);
  const files = []; let pageToken = '';
  do {
    const page = await call(`${version.name}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    files.push(...page.files); pageToken = page.nextPageToken || '';
  } while (pageToken);
  return { release: release.name, version: version.name, config: version.config, files: Object.fromEntries(files.map((file) => [file.path, file.hash])) };
}
const baseline = await snapshot();
const config = structuredClone(baseline.config);
const rule = config.rewrites.find((item) => item.glob === '**');
assert.equal(rule.run?.serviceId, 'domidex-web');
assert.equal(rule.run?.tag, 'binder-layout-20260904');
rule.run.tag = 'privacy-gate-20260904';
const plan = { baseline, config };
const planFile = '.domidex/security-gate/runtime-switch-plan.json';
if (!process.argv.includes('--publish')) {
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ mode: 'read-only', preservedFiles: Object.keys(baseline.files).length, onlyChange: 'pinned server revision' }));
} else {
  assert(isDeepStrictEqual(plan, JSON.parse(fs.readFileSync(planFile, 'utf8'))), 'LIVE_STATE_CHANGED');
  const candidate = await call('sites/domidex/versions', 'POST', { config });
  const populated = await call(`${candidate.name}:populateFiles`, 'POST', { files: baseline.files });
  assert.equal(populated.uploadRequiredHashes?.length || 0, 0, 'EXISTING_ASSETS_MISSING');
  await call(`${candidate.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
  await call(`sites/domidex/releases?versionName=${encodeURIComponent(candidate.name)}`, 'POST', { message: 'Private image authorization; existing design and all assets preserved' });
  const after = await snapshot();
  assert(isDeepStrictEqual(after.files, baseline.files), 'ASSET_HASHES_CHANGED');
  assert(isDeepStrictEqual(after.config, config), 'CONFIG_CHANGED');
  fs.writeFileSync('.domidex/security-gate/runtime-switch-result.json', JSON.stringify({ previous: baseline.version, current: after.version, preservedFiles: Object.keys(after.files).length }, null, 2));
  console.log(JSON.stringify({ version: after.version, preservedFiles: Object.keys(after.files).length, cssChanged: false }));
}
