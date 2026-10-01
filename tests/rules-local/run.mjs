import { existsSync, mkdirSync, copyFileSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PORTS, projectForSuite, parseOptions, requireFile, readJson, validateMetadata, verifyCache,
  sha256, assertPortsFree, isolatedEnvironment, assertTestEnvironment, firebaseConfiguration, runChild } from '../private-operations-local/safety.mjs';

export const RULE_TESTS = Object.freeze([
  'firebase-tests/firestore.rules.test.mjs',
  'firebase-tests/storage.rules.test.mjs',
  'firebase-tests/release27-security.rules.test.mjs',
]);
// Current source matrix: 11 baseline Firestore + 7 Storage + (62 security + 4 quota).
// No historical Web snapshot suite. Changed counts require explicit source review.
const EXPECTED_TESTS = 84;
const QUOTA_TESTS = Object.freeze(['quota owner', 'foreign app user', 'client admin', 'anonymous']
  .map(role => `deny: private read-quota create/get/list/update/delete stay server-only for ${role}`));

export function parseRulesOptions(args) {
  let androidRoot;
  const common = [];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!value || typeof value !== 'string' || value.startsWith('--')) throw Error('Every option requires one path.');
    if (key === '--android-root') {
      if (androidRoot) throw Error('Duplicate --android-root.');
      androidRoot = path.resolve(value);
    } else common.push(key, value);
  }
  if (!androidRoot) throw Error('Explicit --android-root PATH is required.');
  return { ...parseOptions(common), '--android-root': androidRoot };
}

export function validateRulesTap(tap) {
  const count = name => {
    const values = [...tap.matchAll(new RegExp(`^# ${name} (\\d+)\\r?$`, 'gm'))];
    if (values.length !== 1) throw Error(`Incomplete/ambiguous TAP ${name}.`);
    return Number(values[0][1]);
  };
  const result = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => [name, count(name)]));
  if (result.tests !== EXPECTED_TESTS || result.pass !== EXPECTED_TESTS || result.fail || result.cancelled || result.skipped || result.todo ||
      !new RegExp(`^1\\.\\.${EXPECTED_TESTS}\\r?$`, 'm').test(tap)) throw Error('Incomplete or nonpassing Rules test matrix.');
  const successful = [...tap.matchAll(/^ok \d+ - (.+)\r?$/gm)].map(match => match[1].replace(/\r$/, ''));
  if (successful.length !== EXPECTED_TESTS || QUOTA_TESTS.some(name => successful.filter(value => value === name).length !== 1)) {
    throw Error('Every expected private read-quota role must actually execute once.');
  }
  return { ...result, quotaRoles: [...QUOTA_TESTS] };
}

async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const here = fileURLToPath(new URL('.', import.meta.url));
  const shared = fileURLToPath(new URL('../private-operations-local/', import.meta.url));
  const options = parseRulesOptions(process.argv.slice(2));
  const androidRoot = options['--android-root'];
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Node 24+ required; no installation attempted.');
  for (const name of [...RULE_TESTS, 'firebase-tests/package.json', 'firebase-tests/package-lock.json', 'firebase-tests/emulator-fixtures.mjs']) {
    requireFile(path.join(androidRoot, name));
  }
  requireFile(path.join(androidRoot, 'firebase-tests/node_modules/@firebase/rules-unit-testing/package.json'));
  requireFile(path.join(androidRoot, 'firebase-tests/node_modules/firebase/package.json'));
  for (const name of ['firestore.rules', 'storage.rules']) {
    if (await sha256(requireFile(path.join(androidRoot, name))) !== await sha256(requireFile(path.join(root, name)))) {
      throw Error('Android and Web Rules must be byte-identical before the shared matrix.');
    }
  }

  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const cliCandidates = [options['--firebase-cli'], path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/bin/firebase.js')] : []),
    ...pathEntries.flatMap(entry => [path.join(entry, 'node_modules/firebase-tools/lib/bin/firebase.js'),
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
    [...javaHomes.map(home => path.join(home, 'bin', javaName)), ...pathEntries.map(entry => path.join(entry, javaName))].find(existsSync));
  await assertPortsFree();

  const directory = path.join(root, 'outputs/rules-local', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  mkdirSync(directory, { recursive: true });
  const env = isolatedEnvironment(process.env, { directory, root, java, cache,
    preload: path.join(shared, 'network-preload.cjs'), suite: 'rules' });
  env.DOMIDEX_RULES_ANDROID_ROOT = androidRoot;
  for (const name of ['temp', 'home', 'appdata', 'localappdata', 'xdg', 'cloudsdk']) mkdirSync(path.join(directory, name));
  assertTestEnvironment(env, 'rules');
  const javaVersion = spawnSync(java, ['-version'], { env, encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false });
  if (javaVersion.status !== 0 || !/version "(?:2[1-9]|[3-9]\d)\./.test(javaVersion.stderr + javaVersion.stdout)) throw Error('Working Java 21+ required.');
  const inputPaths = {
    ...Object.fromEntries(['firestore.rules', 'storage.rules', ...RULE_TESTS,
      'firebase-tests/package.json', 'firebase-tests/package-lock.json', 'firebase-tests/emulator-fixtures.mjs']
      .map(name => [`android/${name}`, path.join(androidRoot, name)])),
    ...Object.fromEntries(['firestore.rules', 'storage.rules', 'tests/rules-local/run.mjs', 'tests/rules-local/execute.mjs',
      'tests/private-operations-local/safety.mjs', 'tests/private-operations-local/network-preload.cjs',
      'tests/private-operations-local/safety.test.mjs'].map(name => [`web/${name}`, path.join(root, name)])),
  };
  const inputs = Object.fromEntries(await Promise.all(Object.entries(inputPaths).map(async ([name, file]) => [name, await sha256(requireFile(file))])));
  for (const name of ['firestore.rules', 'storage.rules']) copyFileSync(path.join(root, name), path.join(directory, name));
  copyFileSync(path.join(here, 'execute.mjs'), path.join(directory, 'execute.mjs'));
  const config = firebaseConfiguration();
  delete config.emulators.auth;
  writeFileSync(path.join(directory, 'firebase.json'), JSON.stringify(config, null, 2));
  const project = projectForSuite('rules');
  const manifest = { suite: 'rules', project, startedAt: new Date().toISOString(), node: process.version,
    java: (javaVersion.stderr + javaVersion.stdout).trim(), firebaseCli: cliPackage.version,
    cliMetadataSha256: await sha256(metadataFile), jars: entries, inputs, ports: PORTS,
    startedEmulators: ['firestore', 'storage'], expectedTests: EXPECTED_TESTS,
    beforePortsFree: true, afterPortsFree: false, inputsUnchanged: false, result: null };
  const manifestFile = path.join(directory, 'manifest.json');
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`Local Rules suite: ${directory}`);
  try {
    manifest.result = await runChild(process.execPath, [cli, 'emulators:exec', '--only', 'firestore,storage',
      '--project', project, '--config', path.join(directory, 'firebase.json'), 'node execute.mjs'],
    { cwd: directory, env, timeoutMs: 300_000, onOutput: chunk => {
      appendFileSync(path.join(directory, 'emulator.log'), chunk); process.stdout.write(chunk);
    } });
    process.exitCode = manifest.result.code;
  } finally {
    try { await assertPortsFree(); manifest.afterPortsFree = true; }
    catch (error) { console.error(error.message); process.exitCode = 1; }
    manifest.inputsUnchanged = (await Promise.all(Object.entries(inputPaths).map(async ([name, file]) => await sha256(file) === inputs[name]))).every(Boolean);
    if (!manifest.inputsUnchanged) { console.error('Source inputs changed during the Rules run.'); process.exitCode = 1; }
    try { manifest.tests = validateRulesTap(readFileSync(path.join(directory, 'rules.tap'), 'utf8')); }
    catch (error) { manifest.reportError = error.message; console.error(error.message); process.exitCode = 1; }
    manifest.finishedAt = new Date().toISOString();
    manifest.exitCode = process.exitCode ?? 1;
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    console.log(`Rules evidence manifest: ${manifestFile}`);
  }
}

// Pure exports are imported by safety tests; importing this module never runs tools.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
