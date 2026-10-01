import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { cloudClient, firebaseCliToken, project, folder } from './sharing-cloud-context.mjs';

const call = cloudClient(await firebaseCliToken());
const hosting = 'https://firebasehosting.googleapis.com/v1beta1/';
const run = `https://europe-west1-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${project}`;
const tag = process.env.SHARING_RUNTIME_TAG || 'binder-sharing-20260922';
const revisionName = process.env.SHARING_REVISION_NAME || 'domidex-web-sharing-20260922';
async function snapshot() {
  const release = (await call(hosting + 'sites/domidex/releases?pageSize=1')).releases[0];
  const version = await call(hosting + release.version.name);
  const files = {}; let pageToken = '';
  do {
    const page = await call(hosting + version.name + '/files?pageSize=1000' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
    for (const file of page.files || []) files[file.path] = file.hash;
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return { release: release.name, version: version.name, config: version.config, files };
}
const mode = process.argv[2] || 'plan';
await fs.mkdir(folder, { recursive: true });
if (mode === 'plan') {
  const current = await snapshot();
  assert.equal(current.config.rewrites.find(x => x.glob === '**')?.run?.tag, process.env.SHARING_BASELINE_TAG || 'privacy-gate-20260904');
  const before = await call(run + '/revisions/domidex-web-00027-tew');
  const service = await call(run + '/services/domidex-web');
  const baseline = { ...current, service, revision: before };
  await fs.writeFile(folder + '/hosting-runtime-before.json', JSON.stringify(baseline, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ mode, version: current.version, filesPreserved: Object.keys(current.files).length, baseRevision: before.metadata.name }));
} else if (mode === 'candidate') {
  const baseline = JSON.parse(await fs.readFile(folder + '/hosting-runtime-before.json', 'utf8'));
  assert(isDeepStrictEqual(await snapshot(), { release: baseline.release, version: baseline.version, config: baseline.config, files: baseline.files }), 'HOSTING_CHANGED');
  const service = await call(run + '/services/domidex-web');
  assert(isDeepStrictEqual(service.spec.traffic, baseline.service.spec.traffic), 'TRAFFIC_CHANGED');
  const spec = structuredClone(baseline.revision.spec);
  assert.equal(spec.containers.length, 1);
  spec.containers[0].image = process.env.SHARING_IMAGE || 'europe-west1-docker.pkg.dev/cardvault-715ac/cloud-run-source-deploy/domidex-web:binder-sharing-20260922';
  spec.containers[0].env = [...(spec.containers[0].env || []).filter(x => x.name !== 'BINDER_SHARING_READY'), { name: 'BINDER_SHARING_READY', value: 'verified-v1' }];
  const annotationAllowlist = ['autoscaling.knative.dev/maxScale', 'autoscaling.knative.dev/minScale', 'run.googleapis.com/cpu-throttling', 'run.googleapis.com/startup-cpu-boost'];
  const annotations = Object.fromEntries(Object.entries(baseline.revision.metadata.annotations || {}).filter(([key]) => annotationAllowlist.includes(key)));
  service.spec.template = { metadata: { name: revisionName, annotations }, spec };
  service.spec.traffic = [...service.spec.traffic, { tag, revisionName }];
  delete service.status;
  await call(run + '/services/domidex-web', 'PUT', service);
  console.log(JSON.stringify({ mode, revisionName, productionHostingChanged: false }));
} else if (mode === 'promote') {
  const baseline = JSON.parse(await fs.readFile(folder + '/hosting-runtime-before.json', 'utf8'));
  assert(isDeepStrictEqual(await snapshot(), { release: baseline.release, version: baseline.version, config: baseline.config, files: baseline.files }), 'HOSTING_CHANGED');
  const revision = await call(run + '/revisions/' + revisionName);
  assert(revision.status.conditions.some(x => x.type === 'Ready' && x.status === 'True'), 'CANDIDATE_NOT_READY');
  const verified = JSON.parse(await fs.readFile(folder + '/candidate-verification.json', 'utf8'));
  assert.equal(verified.revisionName, revisionName); assert.equal(verified.passed, true);
  assert.equal(revision.status.imageDigest, verified.imageDigest, 'VERIFIED_IMAGE_CHANGED');
  const liveTests = JSON.parse(await fs.readFile(folder + '/candidate-live-results.json', 'utf8'));
  assert.equal(liveTests.cleanup, true); assert(liveTests.checks.length >= 8, 'LIVE_TESTS_INCOMPLETE');
  const rules = JSON.parse(await fs.readFile(folder + '/rules-deployed.json', 'utf8'));
  assert.equal(rules.verified, true);
  const config = structuredClone(baseline.config);
  config.rewrites.find(x => x.glob === '**').run.tag = tag;
  const candidate = await call(hosting + 'sites/domidex/versions', 'POST', { config });
  const populate = await call(hosting + candidate.name + ':populateFiles', 'POST', { files: baseline.files });
  assert.equal(populate.uploadRequiredHashes?.length || 0, 0, 'EXISTING_ASSET_MISSING');
  await call(hosting + candidate.name + '?updateMask=status', 'PATCH', { status: 'FINALIZED' });
  await call(hosting + 'sites/domidex/releases?versionName=' + encodeURIComponent(candidate.name), 'POST', { message: 'Enable explicitly confirmed read-only private binder sharing; preserve all existing site assets and routes' });
  const after = await snapshot();
  assert(isDeepStrictEqual(after.files, baseline.files), 'HOSTING_ASSETS_CHANGED');
  assert(isDeepStrictEqual(after.config, config), 'HOSTING_CONFIG_CHANGED');
  await fs.writeFile(folder + '/hosting-runtime-after.json', JSON.stringify(after, null, 2));
  console.log(JSON.stringify({ mode, version: after.version, filesPreserved: Object.keys(after.files).length, previousVersion: baseline.version }));
} else throw Error('INVALID_MODE');
