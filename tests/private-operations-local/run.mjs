import { existsSync, mkdirSync, copyFileSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PROJECT, PORTS, parseOptions, requireFile, readJson, validateMetadata, verifyCache,
  sha256, assertPortsFree, isolatedEnvironment, assertTestEnvironment, firebaseConfiguration, runChild } from './safety.mjs';

async function verifyWebAddProofs(directory) {
  const proofs = {};
  for (const [caseName, phases] of Object.entries({
    'create-increment': ['signed-in-empty', 'created', 'incremented'],
    collision: ['signed-in-empty', 'created', 'rejected-empty', 'rejected-stale'],
  })) {
    const filename = `web-add-${caseName}-proof.json`;
    const proof = readJson(requireFile(path.join(directory, filename)));
    if (proof.caseName !== caseName || proof.project !== PROJECT || proof.owner !== 'web-add-sdk-owner'
        || proof.actualProductFunction !== 'addExactCard' || proof.rpcMocked !== false
        || proof.passed !== true || proof.cleanupComplete !== true
        || !isDeepStrictEqual(proof.stages?.map(stage => stage.phase), phases)
        || !isDeepStrictEqual(proof.initial, proof.cleaned)) throw Error('Missing/incomplete actual Web-add SDK proof');
    // The test checks every schema field and every complete Admin readback;
    // here additionally prevent a detached success flag / changed conflict.
    const created = proof.stages[1].server;
    if (caseName === 'collision' && proof.stages.slice(2).some(stage => !isDeepStrictEqual(stage.server, created))) {
      throw Error('Rejected collision modified independent server readback');
    }
    proofs[caseName] = { file: filename, sha256: await sha256(path.join(directory, filename)),
      phases, cleanupComplete: true };
  }
  return proofs;
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const options = parseOptions(process.argv.slice(2));
if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Node 24+ required; no installation attempted.');
const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
const cliCandidates = [options['--firebase-cli'], path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'),
  ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/bin/firebase.js')] : []),
  ...pathEntries.flatMap((entry) => [path.join(entry, 'node_modules/firebase-tools/lib/bin/firebase.js'),
    path.resolve(entry, '../lib/node_modules/firebase-tools/lib/bin/firebase.js')])].filter(Boolean);
const cli = requireFile(options['--firebase-cli'] ?? cliCandidates.find(existsSync));
const cliRoot = path.resolve(path.dirname(cli), '../..');
const cliPackage = readJson(path.join(cliRoot, 'package.json'));
if (cliPackage.name !== 'firebase-tools' || path.basename(cli) !== 'firebase.js') throw Error('Expected installed Firebase CLI JS entry point.');
const metadataFile = path.join(cliRoot, 'lib/emulator/downloadableEmulatorInfo.json');
const entries = validateMetadata(cliPackage.version, readJson(metadataFile));
const cache = options['--emulator-cache'] ?? path.join(os.homedir(), '.cache/firebase/emulators');
await verifyCache(cache, entries);
const javaName = process.platform === 'win32' ? 'java.exe' : 'java';
const javaHomes = [options['--java-home'], process.env.JAVA_HOME,
  ...(process.env.ProgramFiles ? [path.join(process.env.ProgramFiles, 'Android/Android Studio/jbr')] : [])].filter(Boolean);
const java = requireFile(options['--java-home'] ? path.join(options['--java-home'], 'bin', javaName) :
  [...javaHomes.map((home) => path.join(home, 'bin', javaName)), ...pathEntries.map((entry) => path.join(entry, javaName))].find(existsSync));
requireFile(path.join(root, 'node_modules/vitest/vitest.mjs'));
await assertPortsFree();

const directory = path.join(root, 'outputs/private-operations-local', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
mkdirSync(directory, { recursive: true });
const env = isolatedEnvironment(process.env, { directory, root, java, cache, preload: path.join(here, 'network-preload.cjs') });
for (const name of ['temp', 'home', 'appdata', 'localappdata', 'xdg', 'cloudsdk']) mkdirSync(path.join(directory, name));
assertTestEnvironment(env);
const javaVersion = spawnSync(java, ['-version'], { env, encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false });
if (javaVersion.status !== 0 || !/version "(?:2[1-9]|[3-9]\d)\./.test(javaVersion.stderr + javaVersion.stdout)) throw Error('Working Java 21+ required.');

const inputs = ['firestore.rules', 'storage.rules', 'tests/private-operations.test.mjs',
  'lib/collection.ts', 'lib/domain.ts', 'lib/cardmarket-identity.ts',
  'lib/sync-id.ts', 'lib/tcgdex.ts', 'lib/owner-document-state.ts',
  'lib/firebase-client.ts', 'package.json', 'package-lock.json',
  'backend/scan-knowledge/index.js', 'backend/scan-knowledge/current-evidence.js',
  'backend/scan-knowledge/knowledge-aggregate.js', 'backend/scan-knowledge/package.json',
  'backend/scan-knowledge/package-lock.json',
  ...['run.mjs', 'safety.mjs', 'execute.mjs', 'config.mjs', 'network-preload.cjs', 'safety.test.mjs', 'README.md']
    .map((name) => `tests/private-operations-local/${name}`)];
const inputHashes = Object.fromEntries(await Promise.all(inputs.map(async (name) => [name, await sha256(requireFile(path.join(root, name)))])));
for (const name of ['firestore.rules', 'storage.rules']) copyFileSync(path.join(root, name), path.join(directory, name));
copyFileSync(path.join(here, 'execute.mjs'), path.join(directory, 'execute.mjs'));
writeFileSync(path.join(directory, 'firebase.json'), JSON.stringify(firebaseConfiguration(), null, 2));
const manifest = { project: PROJECT, startedAt: new Date().toISOString(), node: process.version,
  java: (javaVersion.stderr + javaVersion.stdout).trim(), firebaseCli: cliPackage.version,
  cliMetadataSha256: await sha256(metadataFile), jars: entries, inputs: inputHashes, ports: PORTS,
  beforePortsFree: true, afterPortsFree: false, inputsUnchanged: false, result: null };
const manifestFile = path.join(directory, 'manifest.json');
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log(`Local demo suite: ${directory}`);
try {
  manifest.result = await runChild(process.execPath, [cli, 'emulators:exec', '--only', 'auth,firestore,storage',
    '--project', PROJECT, '--config', path.join(directory, 'firebase.json'), 'node execute.mjs'],
  { cwd: directory, env, timeoutMs: 300_000, onOutput: (chunk) => {
    appendFileSync(path.join(directory, 'emulator.log'), chunk);
    process.stdout.write(chunk);
  } });
  process.exitCode = manifest.result.code;
} finally {
  try { await assertPortsFree(); manifest.afterPortsFree = true; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  manifest.inputsUnchanged = (await Promise.all(inputs.map(async (name) => await sha256(path.join(root, name)) === inputHashes[name]))).every(Boolean);
  if (!manifest.inputsUnchanged) { console.error('Inputs changed during run; result is not a frozen-source verification.'); process.exitCode = 1; }
  const report = path.join(directory, 'vitest-results.json');
  if (existsSync(report)) {
    const results = readJson(report);
    manifest.tests = { total: results.numTotalTests, passed: results.numPassedTests, failed: results.numFailedTests, pending: results.numPendingTests };
    const expectedTitles = [
      'persists concurrent canonical knowledge votes and makes exact redelivery a server no-op',
      'uses real evidence versions and deletion locks before changing persisted knowledge',
      'preserves the exact real absent-lock snapshot readTime and authenticated identity',
      'enforces the shared 60+1 budget across independent SDK instances and isolates another owner',
      'denies revoked/disabled access and both early and post-auth deletion fences without quota writes',
      'is off by default and requires explicit owner confirmation and app access',
      'issues 256-bit tokens and returns only the DTO without default owner or price data',
      'keeps pricing and total opt-ins independent, with quantity excluded from market total',
      'uses genuine SDK field masks for shared entries without fetching private payload or losing missing snapshots',
      'only allows the owner to list/revoke and makes revocation immediately effective',
      'lists only the calling owners private binder summaries without unrelated metadata',
      'rechecks a revocation during catalog work and owner revocation without refreshing client tokens',
      'fails closed on corrupt placement ownership and unavailable exact prices',
      'does not treat a malformed explicit deletion target as the calling admin',
      'denies and cleans in-flight a uploads revoked before final commit',
      'denies and cleans in-flight admin uploads revoked before final commit',
      'fences stale role tokens, preserves unrelated claims and records an attribution-only access audit',
      'leaves the affected role denied if the Auth update fails',
      'never serves an image whose owner/hash no longer matches its report',
      'preserves upload contract and permits only a current admin to read bytes',
      'returns original bytes unchanged and creates only view=thumb as a private bounded WebP',
      'keeps interrupted upload ownership and refuses a deleting account',
      'deletes exactly one admin-selected report and image while preserving global scanner data',
      'fails closed on mismatched image metadata without deleting either resource',
      'reports a partial deletion truthfully and completes safely on retry',
      'denies anonymous and foreign user deletion without modifying either account',
      'deletes all owned classes, recalculates contributions, preserves global/foreign data and is repeatable',
      'records partial failure, retries safely, and never reports provider retention as complete',
      'blocks protected attribution before disabling or deleting the account',
      'starts the token expiry interval only after a successful disable/revoke',
      'tracks old soft-deleted versions even with a current zero-retention policy',
      'does not publish COMPLETE when final job cleanup fails',
      'does not replay stale/deleted Evidence, even if a trigger arrived before deletion',
      'creates then increments the same printing through the actual Web SDK and unchanged Rules',
      'rejects a colliding positive product for empty and stale current without any server mutation',
    ];
    const assertions = results.testResults?.flatMap(suite => suite.assertionResults ?? []) ?? [];
    if (results.success !== true || results.numTotalTests !== 35 || results.numPassedTests !== 35
        || results.numFailedTests !== 0 || results.numPendingTests !== 0 || (results.numTodoTests ?? 0) !== 0
        || assertions.length !== 35 || assertions.some(test => test.status !== 'passed')
        || !isDeepStrictEqual(assertions.map(test => test.title).sort(), [...expectedTitles].sort())) process.exitCode = 1;
    try { manifest.webAdd = await verifyWebAddProofs(directory); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  } else process.exitCode = 1;
  manifest.finishedAt = new Date().toISOString();
  manifest.exitCode = process.exitCode ?? 1;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`Evidence manifest: ${manifestFile}`);
}
