import { mkdirSync, copyFileSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PROJECT, PORTS, requireFile, readJson, validateMetadata, verifyCache, sha256,
  assertPortsFree, isolatedEnvironment, assertTestEnvironment, firebaseConfiguration, runChild } from '../private-operations-local/safety.mjs';
import { parseRulesOptions } from '../rules-local/run.mjs';

export const SERIAL = 'emulator-5554';
export const AVD = 'DomiDex_R27_Baseline_API36';
export const TEST_CLASS = 'com.dominik.cardvault.data.sync.PrivatePullSdkCompletenessInstrumentedTest';
export const TEST_NAMES = Object.freeze([
  'actualTransactionCommitDoesNotHideUncommittedDocument',
  'syntheticOptimisticWriteCanHideDocumentUntilSuccessfulAck',
  'syntheticRejectedOverlayIsNotRecoveredByInclusiveTimestampAlone',
]);
export function validateInstrumentation(text) {
  if (!/^OK \(3 tests\)\r?$/m.test(text) || !/^INSTRUMENTATION_CODE: -1\r?$/m.test(text) ||
      /^INSTRUMENTATION_STATUS_CODE: -[1234]\r?$/m.test(text) || /INSTRUMENTATION_FAILED|FAILURES!!!|Process crashed/.test(text)) {
    throw Error('SDK instrumentation did not pass the complete three-case matrix.');
  }
  const blocks = text.split('INSTRUMENTATION_STATUS_CODE:');
  const passed = [];
  for (let index = 1; index < blocks.length; index++) {
    if (!/^ 0\r?\n/.test(blocks[index])) continue;
    const preceding = blocks[index - 1];
    const names = [...preceding.matchAll(/^INSTRUMENTATION_STATUS: test=(.+)\r?$/gm)];
    const classes = [...preceding.matchAll(/^INSTRUMENTATION_STATUS: class=(.+)\r?$/gm)];
    if (names.length !== 1 || classes.length !== 1 || classes[0][1].trim() !== TEST_CLASS) throw Error('Unexpected SDK test status.');
    passed.push(names[0][1].trim());
  }
  if (passed.length !== 3 || TEST_NAMES.some(name => passed.filter(value => value === name).length !== 1)) {
    throw Error('Each actual SDK scenario must pass exactly once; no skipped/partial run.');
  }
  return { passed: 3, names: passed };
}

async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const here = fileURLToPath(new URL('.', import.meta.url));
  const options = parseRulesOptions(process.argv.slice(2));
  const androidRoot = options['--android-root'];
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Preinstalled Node 24+ required.');
  if (PROJECT !== 'demo-domidex-privacy') throw Error('Only the reviewed fixed demo project is allowed.');
  const cli = requireFile(options['--firebase-cli'] ?? path.join(process.env.APPDATA ?? '', 'npm/node_modules/firebase-tools/lib/bin/firebase.js'));
  const cliRoot = path.resolve(path.dirname(cli), '../..');
  const cliPackage = readJson(path.join(cliRoot, 'package.json'));
  if (cliPackage.name !== 'firebase-tools' || path.basename(cli) !== 'firebase.js') throw Error('Expected installed Firebase CLI entry.');
  const metadataFile = path.join(cliRoot, 'lib/emulator/downloadableEmulatorInfo.json');
  const entries = validateMetadata(cliPackage.version, readJson(metadataFile));
  const cache = options['--emulator-cache'] ?? path.join(os.homedir(), '.cache/firebase/emulators');
  await verifyCache(cache, entries);
  const javaHome = options['--java-home'] ?? path.join(process.env.ProgramFiles ?? '', 'Android/Android Studio/jbr');
  const java = requireFile(path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  if (process.platform !== 'win32') throw Error('This reviewed emulator driver currently supports Windows only.');
  const adb = requireFile(path.join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk/platform-tools/adb.exe'));
  const androidInputs = ['firestore.rules', 'storage.rules', 'app/build.gradle.kts',
    'app/src/debug/AndroidManifest.xml', 'app/src/debug/res/xml/debug_emulator_network_security.xml',
    'app/src/androidTest/java/com/dominik/cardvault/data/sync/PrivatePullDemoGrpcGate.kt',
    'app/src/androidTest/java/com/dominik/cardvault/data/sync/PrivatePullSdkCompletenessInstrumentedTest.kt',
    'app/build/outputs/apk/debug/app-debug.apk', 'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'];
  const webInputs = ['firestore.rules', 'storage.rules', 'tests/private-pull-sdk-local/run.mjs',
    'tests/private-pull-sdk-local/execute.mjs', 'tests/private-operations-local/safety.mjs',
    'tests/private-operations-local/network-preload.cjs'];
  const inputs = Object.fromEntries([...androidInputs.map(name => [`android/${name}`, requireFile(path.join(androidRoot, name))]),
    ...webInputs.map(name => [`web/${name}`, requireFile(path.join(root, name))])]);
  const hashes = Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([name, file]) => [name, await sha256(file)])));
  for (const name of ['firestore.rules', 'storage.rules']) {
    if (hashes[`android/${name}`] !== hashes[`web/${name}`]) throw Error('Rules must match across repositories.');
  }
  await assertPortsFree();
  const directory = path.join(root, 'outputs/private-pull-sdk-local', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  mkdirSync(directory, { recursive: true });
  const env = isolatedEnvironment(process.env, { directory, root, java, cache,
    preload: path.join(root, 'tests/private-operations-local/network-preload.cjs') });
  env.DOMIDEX_SDK_PROOF_ADB = adb;
  for (const name of ['temp', 'home', 'appdata', 'localappdata', 'xdg', 'cloudsdk']) mkdirSync(path.join(directory, name));
  assertTestEnvironment(env);
  const adbCommand = args => {
    const result = spawnSync(adb, ['-s', SERIAL, ...args], { env, encoding: 'utf8', timeout: 15_000, windowsHide: true, shell: false });
    if (result.status !== 0) throw Error(`Emulator-only ADB command failed: ${args[0]}`);
    return result.stdout.trim();
  };
  if (adbCommand(['get-state']) !== 'device' || adbCommand(['shell', 'getprop', 'ro.boot.qemu.avd_name']) !== AVD ||
      adbCommand(['shell', 'settings', 'get', 'global', 'airplane_mode_on']) !== '1' ||
      adbCommand(['shell', 'settings', 'get', 'global', 'wifi_on']) !== '0') throw Error('Expected isolated offline AVD required.');
  if (adbCommand(['reverse', '--list']) !== '') throw Error('Existing reverse mappings present; nothing removed.');
  const javaVersion = spawnSync(java, ['-version'], { env, encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false });
  if (javaVersion.status !== 0 || !/version "(?:2[1-9]|[3-9]\d)\./.test(javaVersion.stderr + javaVersion.stdout)) throw Error('Java 21+ required.');
  for (const name of ['firestore.rules', 'storage.rules']) copyFileSync(path.join(root, name), path.join(directory, name));
  copyFileSync(path.join(here, 'execute.mjs'), path.join(directory, 'execute.mjs'));
  const config = firebaseConfiguration(); delete config.emulators.storage;
  writeFileSync(path.join(directory, 'firebase.json'), JSON.stringify(config, null, 2));
  const manifest = { project: PROJECT, serial: SERIAL, avd: AVD, startedAt: new Date().toISOString(), inputs: hashes,
    apkHashScope: 'local files only; separate exact emulator installation proof required',
    node: process.version, firebaseCli: cliPackage.version, cliMetadataSha256: await sha256(metadataFile), jars: entries,
    java: (javaVersion.stderr + javaVersion.stdout).trim(), ports: PORTS, startedEmulators: ['auth', 'firestore'],
    beforePortsFree: true, afterPortsFree: false, beforeReverseEmpty: true, afterReverseEmpty: false,
    inputsUnchanged: false, result: null };
  const manifestFile = path.join(directory, 'manifest.json');
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`Local Android SDK proof: ${directory}`);
  const ownedReverse = [];
  try {
    for (const port of [PORTS.firestore, PORTS.auth]) {
      adbCommand(['reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`]); ownedReverse.push(port);
    }
    manifest.result = await runChild(process.execPath, [cli, 'emulators:exec', '--only', 'auth,firestore',
      '--project', PROJECT, '--config', path.join(directory, 'firebase.json'), 'node execute.mjs'],
    { cwd: directory, env, timeoutMs: 360_000, onOutput: chunk => {
      appendFileSync(path.join(directory, 'emulator.log'), chunk); process.stdout.write(chunk);
    } });
    process.exitCode = manifest.result.code;
  } finally {
    // An interrupted ADB client need not stop instrumentation. End only these test
    // packages in this exact emulator; never stop apps on a physical device.
    if (manifest.result?.code !== 0) {
      for (const target of ['com.dominik.cardvault', 'com.dominik.cardvault.test']) {
        try { adbCommand(['shell', 'am', 'force-stop', target]); } catch { process.exitCode = 1; }
      }
    }
    for (const port of ownedReverse.reverse()) {
      try {
        const records = adbCommand(['reverse', '--list']).split(/\r?\n/).map(line => line.trim().split(/\s+/));
        const mappings = records.filter(parts => parts.length === 3 && parts[1] === `tcp:${port}`);
        if (mappings.length === 1 && mappings[0][2] === `tcp:${port}`) adbCommand(['reverse', '--remove', `tcp:${port}`]);
        else if (mappings.length) { console.error('Reverse mapping changed; not removing another target.'); process.exitCode = 1; }
      } catch { process.exitCode = 1; }
    }
    try { manifest.afterReverseEmpty = adbCommand(['reverse', '--list']) === ''; } catch { process.exitCode = 1; }
    try { await assertPortsFree(); manifest.afterPortsFree = true; } catch (error) { console.error(error.message); process.exitCode = 1; }
    manifest.inputsUnchanged = (await Promise.all(Object.entries(inputs).map(async ([name, file]) => await sha256(file) === hashes[name]))).every(Boolean);
    if (!manifest.afterReverseEmpty || !manifest.inputsUnchanged) process.exitCode = 1;
    try {
      manifest.tests = validateInstrumentation(readFileSync(path.join(directory, 'instrumentation.log'), 'utf8'));
      const serverProof = readJson(path.join(directory, 'server-proof.json'));
      manifest.serverVerified = serverProof.project === PROJECT && serverProof.verified === true;
      if (!manifest.serverVerified) { manifest.reportError = 'Independent server proof missing.'; process.exitCode = 1; }
    } catch (error) { manifest.reportError = error.message; console.error(error.message); process.exitCode = 1; }
    manifest.finishedAt = new Date().toISOString(); manifest.exitCode = process.exitCode ?? 1;
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    console.log(`SDK proof manifest: ${manifestFile}`);
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
