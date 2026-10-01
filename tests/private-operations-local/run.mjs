import { existsSync, mkdirSync, copyFileSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PROJECT, PORTS, parseOptions, requireFile, readJson, validateMetadata, verifyCache,
  sha256, assertPortsFree, isolatedEnvironment, assertTestEnvironment, firebaseConfiguration, runChild } from './safety.mjs';

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
    if (!results.success || results.numTotalTests !== 27 || results.numPassedTests !== 27 || results.numPendingTests !== 0) process.exitCode = 1;
  } else process.exitCode = 1;
  manifest.finishedAt = new Date().toISOString();
  manifest.exitCode = process.exitCode ?? 1;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`Evidence manifest: ${manifestFile}`);
}
