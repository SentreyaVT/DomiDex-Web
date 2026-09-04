// Firebase Hosting only. Preserve every live asset and the pinned Cloud Run rewrite.
// Default: read-only plan. --publish requires that exact plan still matches live.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, '.domidex/legal-gate');
const api = 'https://firebasehosting.googleapis.com/v1beta1';
const site = 'sites/domidex';
const routes = ['datenschutz', 'kontakt', 'impressum', 'konto-loeschen', 'pre-beta'];
const digest = (value) => createHash('sha256').update(value).digest('hex');

export function legalHostingPlan(config, existingFiles, addedFiles, updateLegalPages = false) {
  if (addedFiles.length !== routes.length || routes.some((route) => !addedFiles.some((file) => file.route === `/${route}` && file.path === `/legal/${route}.html`))) throw new Error('Unexpected public pages');
  const originalFiles = Object.fromEntries(existingFiles.map((file) => [file.path, file.hash]));
  if (!config.rewrites?.some((rule) => rule.glob === '**' && rule.run?.serviceId === 'domidex-web' && rule.run?.tag)) throw new Error('Missing pinned existing runtime');
  if (updateLegalPages) {
    if (addedFiles.some((file) => !Object.hasOwn(originalFiles, file.path) || !config.rewrites.some((rule) => rule.path === file.path && rule.regex === `^${file.route}/?$`))) throw new Error('Existing legal deployment required for update');
    return { config: structuredClone(config), files: { ...originalFiles, ...Object.fromEntries(addedFiles.map((file) => [file.path, file.hash])) }, preserved: existingFiles.length - addedFiles.length, added: 0, updated: addedFiles.length };
  }
  const security = { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
  const nextConfig = structuredClone(config);
  nextConfig.rewrites = [...addedFiles.map((file) => ({ regex: `^${file.route}/?$`, path: file.path })), ...config.rewrites];
  nextConfig.headers = [...(config.headers ?? []), ...addedFiles.flatMap((file) => [{ regex: `^${file.route}/?$`, headers: security }, { glob: file.path, headers: security }])];
  const files = { ...originalFiles };
  for (const file of addedFiles) {
    if (Object.hasOwn(files, file.path)) throw new Error('Existing asset collision');
    files[file.path] = file.hash;
  }
  return { config: nextConfig, files, preserved: existingFiles.length, added: addedFiles.length };
}

async function main() {
  // No token is printed, persisted, passed in argv or included in error output.
  let token;
  try { token = execFileSync('pwsh.exe', ['-NoProfile', '-Command', '& gcloud auth print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new Error('Google CLI authentication unavailable'); }
  if (!token) throw new Error('Google CLI authentication unavailable');
  async function call(resource, method = 'GET', body) {
    const options = { method, headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'cardvault-715ac', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) };
    if (method !== 'GET' && body !== undefined) options.body = JSON.stringify(body);
    const response = await fetch(`${api}/${resource}`, options);
    if (!response.ok) throw new Error(`Hosting API ${method}: HTTP ${response.status}`);
    return response.status === 204 ? {} : response.json();
  }
  async function current() {
    const releases = await call(`${site}/releases?pageSize=1`);
    const release = releases.releases?.[0];
    if (!release?.version?.name) throw new Error('No existing live version');
    const version = await call(release.version.name);
    const files = [];
    let cursor = '';
    do {
      const page = await call(`${version.name}/files?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`);
      files.push(...(page.files ?? []));
      cursor = page.nextPageToken ?? '';
    } while (cursor);
    return { release: release.name, version: version.name, config: version.config, files };
  }
  const baseline = await current();
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'hosting/manifest.json'), 'utf8'));
  const uploadBytes = new Map();
  const addedFiles = manifest.files.map((file) => {
    if (!routes.some((route) => file.path === `/legal/${route}.html` && file.route === `/${route}`)) throw new Error('Unexpected artifact path');
    const raw = fs.readFileSync(path.join(work, 'hosting', file.path));
    if (digest(raw) !== file.sha256 || raw.includes('<script')) throw new Error('Artifact integrity failed');
    const compressed = gzipSync(raw, { level: 9 });
    const hash = digest(compressed);
    uploadBytes.set(hash, compressed);
    return { ...file, hash };
  });
  const plan = legalHostingPlan(baseline.config, baseline.files, addedFiles, process.argv.includes('--update'));
  const snapshot = { baseline, plan, addedFiles };
  const planFile = path.join(work, 'hosting-plan.json');
  if (!process.argv.includes('--publish')) {
    fs.writeFileSync(planFile, JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify({ mode: 'read-only', baseline: baseline.version, preserved: plan.preserved, added: plan.added, updated: plan.updated ?? 0, runtimePreserved: true }));
    return;
  }
  const approved = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  // API header maps have no key order; rewrite arrays deliberately remain ordered.
  if (!isDeepStrictEqual(approved, snapshot)) throw new Error('Live deployment or artifacts changed since plan; stop for review');
  const created = await call(`${site}/versions`, 'POST', { config: plan.config });
  fs.writeFileSync(path.join(work, 'hosting-pending.json'), JSON.stringify({ previous: baseline.version, pending: created.name }, null, 2));
  const populated = await call(`${created.name}:populateFiles`, 'POST', { files: plan.files });
  for (const hash of populated.uploadRequiredHashes ?? []) {
    if (!uploadBytes.has(hash)) throw new Error('An existing asset would need replacement; stopped');
    const url = new URL(`${populated.uploadUrl}/${hash}`);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleapis.com')) throw new Error('Unexpected upload destination');
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'cardvault-715ac', 'Content-Type': 'application/octet-stream' }, body: uploadBytes.get(hash), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Hosting file upload: HTTP ${response.status}`);
  }
  await call(`${created.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
  const stillLive = await current();
  if (stillLive.version !== baseline.version || stillLive.release !== baseline.release) throw new Error('Concurrent deployment detected; finalized version NOT released');
  const released = await call(`${site}/releases?versionName=${encodeURIComponent(created.name)}`, 'POST', { message: 'DomiDex public privacy, contact, account request and pre-beta pages; existing app assets/runtime preserved' });
  const after = await current();
  const afterFiles = Object.fromEntries(after.files.map((file) => [file.path, file.hash]));
  if (after.version !== created.name || Object.keys(afterFiles).length !== Object.keys(plan.files).length || Object.entries(plan.files).some(([file, hash]) => afterFiles[file] !== hash)) throw new Error('Published metadata verification failed; inspect before proceeding');
  const result = { previous: baseline.version, version: created.name, release: released.name, preserved: plan.preserved, added: plan.added, updated: plan.updated ?? 0, runtimePreserved: isDeepStrictEqual(after.config.rewrites.slice(plan.added), baseline.config.rewrites) };
  fs.writeFileSync(path.join(work, 'hosting-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : 'Legal Hosting operation failed'); process.exitCode = 1; });
