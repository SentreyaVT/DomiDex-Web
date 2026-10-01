import { mkdirSync, copyFileSync, writeFileSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PROJECT as SAFETY_PROJECT, PORTS, requireFile, readJson, validateMetadata, verifyCache, sha256,
  assertPortsFree, isolatedEnvironment, assertTestEnvironment, firebaseConfiguration, runChild } from '../private-operations-local/safety.mjs';
import { PROJECT, SERIAL, AVD, SCENARIOS, validRunId, parseSessionOptions, validateInstrumentation,
  assertNoInstrumentation, validateServerProof } from './contract.mjs';

function kotlinFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? kotlinFiles(path.join(directory, entry.name)) :
    entry.isFile() && entry.name.endsWith('.kt') ? [path.join(directory, entry.name)] : []);
}
async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url)); const here = fileURLToPath(new URL('.', import.meta.url));
  const options = parseSessionOptions(process.argv.slice(2)); const androidRoot = options['--android-root'];
  if (Number(process.versions.node.split('.')[0]) < 24 || process.platform !== 'win32') throw Error('Preinstalled Node 24+ on Windows required');
  if (PROJECT !== SAFETY_PROJECT || PROJECT !== 'demo-domidex-privacy') throw Error('Unexpected project');
  const cli = requireFile(options['--firebase-cli'] ?? path.join(process.env.APPDATA ?? '', 'npm/node_modules/firebase-tools/lib/bin/firebase.js'));
  const cliRoot = path.resolve(path.dirname(cli), '../..'); const cliPackage = readJson(path.join(cliRoot, 'package.json'));
  if (cliPackage.name !== 'firebase-tools' || path.basename(cli) !== 'firebase.js') throw Error('Expected preinstalled Firebase CLI');
  const metadataFile = path.join(cliRoot, 'lib/emulator/downloadableEmulatorInfo.json');
  const entries = validateMetadata(cliPackage.version, readJson(metadataFile));
  const cache = options['--emulator-cache'] ?? path.join(os.homedir(), '.cache/firebase/emulators'); await verifyCache(cache, entries);
  const java = requireFile(path.join(options['--java-home'] ?? path.join(process.env.ProgramFiles ?? '', 'Android/Android Studio/jbr'), 'bin/java.exe'));
  const adb = requireFile(path.join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk/platform-tools/adb.exe'));
  requireFile(path.join(root, 'node_modules/firebase-admin/package.json'));
  const androidInputs = ['firestore.rules', 'storage.rules', 'app/build.gradle.kts', 'build.gradle.kts', 'settings.gradle.kts',
    'gradle/libs.versions.toml', 'app/src/main/AndroidManifest.xml', 'app/src/debug/AndroidManifest.xml',
    'app/src/debug/res/xml/debug_emulator_network_security.xml',
    'app/src/androidTest/java/com/dominik/cardvault/data/sync/PrivatePullDemoGrpcGate.kt',
    'app/src/androidTest/java/com/dominik/cardvault/data/sync/CollectionSyncSessionSdkInstrumentedTest.kt',
    'app/build/outputs/apk/debug/app-debug.apk', 'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
    ...kotlinFiles(path.join(androidRoot, 'app/src/main')).map(file => path.relative(androidRoot, file).replaceAll('\\', '/'))];
  const webInputs = ['firestore.rules', 'storage.rules', 'package.json', 'package-lock.json',
    'tests/private-operations-local/safety.mjs', 'tests/private-operations-local/network-preload.cjs',
    'tests/rules-local/run.mjs', 'tests/android-web-price-local/contract.mjs',
    ...['run.mjs', 'execute.mjs', 'contract.mjs', 'validation.test.mjs', 'README.md'].map(name => `tests/collection-sync-session-local/${name}`)];
  const inputs = Object.fromEntries([...androidInputs.map(name => [`android/${name}`, requireFile(path.join(androidRoot, name))]),
    ...webInputs.map(name => [`web/${name}`, requireFile(path.join(root, name))])]);
  const hashes = Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([name, file]) => [name, await sha256(file)])));
  for (const file of ['firestore.rules', 'storage.rules']) if (hashes[`android/${file}`] !== hashes[`web/${file}`]) throw Error('Rules must match byte-for-byte');
  await assertPortsFree(); const runId = validRunId(randomUUID().replaceAll('-', ''));
  const directory = path.join(root, 'outputs/collection-sync-session-local', `${new Date().toISOString().replace(/[:.]/g, '-')}-${runId}`);
  mkdirSync(directory, { recursive: true });
  const env = isolatedEnvironment(process.env, { directory, root, java, cache, preload: path.join(root, 'tests/private-operations-local/network-preload.cjs') });
  env.DOMIDEX_COLLECTION_SESSION_ADB = adb; env.DOMIDEX_COLLECTION_SESSION_RUN_ID = runId;
  for (const name of ['temp', 'home', 'appdata', 'localappdata', 'xdg', 'cloudsdk']) mkdirSync(path.join(directory, name));
  assertTestEnvironment(env);
  const adbCommand = args => {
    const result = spawnSync(adb, ['-s', SERIAL, ...args], { env, encoding: 'utf8', timeout: 15_000, windowsHide: true, shell: false });
    if (result.status !== 0) throw Error(`Emulator-only command failed: ${args[0]}`); return result.stdout.trim();
  };
  if (adbCommand(['get-state']) !== 'device' || adbCommand(['shell', 'getprop', 'ro.boot.qemu.avd_name']) !== AVD ||
      adbCommand(['shell', 'settings', 'get', 'global', 'airplane_mode_on']) !== '1' ||
      adbCommand(['shell', 'settings', 'get', 'global', 'wifi_on']) !== '0') throw Error('Exact isolated offline AVD required');
  assertNoInstrumentation(adbCommand(['shell', 'dumpsys', 'activity', 'processes']));
  if (adbCommand(['reverse', '--list']) !== '') throw Error('Existing reverse mapping present; nothing removed');
  const javaVersion = spawnSync(java, ['-version'], { env, encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false });
  if (javaVersion.status !== 0 || !/version "(?:2[1-9]|[3-9]\d)\./.test(javaVersion.stderr + javaVersion.stdout)) throw Error('Java 21+ required');
  for (const file of ['firestore.rules', 'storage.rules']) copyFileSync(path.join(root, file), path.join(directory, file));
  copyFileSync(path.join(here, 'execute.mjs'), path.join(directory, 'execute.mjs'));
  const config = firebaseConfiguration(); delete config.emulators.storage;
  writeFileSync(path.join(directory, 'firebase.json'), JSON.stringify(config, null, 2));
  const manifest = { project: PROJECT, runId, serial: SERIAL, avd: AVD, startedAt: new Date().toISOString(), inputs: hashes,
    apkHashScope: 'Local APK files only; operator must separately verify exact installed APKs on this AVD',
    roomCleanupScope: 'In-memory Room owned and closed by Android @After; PASS includes teardown, RED alone does not prove teardown',
    node: process.version, java: (javaVersion.stderr + javaVersion.stdout).trim(), firebaseCli: cliPackage.version,
    cliMetadataSha256: await sha256(metadataFile), jars: entries, ports: PORTS, startedEmulators: ['auth', 'firestore'],
    beforePortsFree: true, afterPortsFree: false, beforeReverseEmpty: true, afterReverseEmpty: false,
    beforeInstrumentationEmpty: true, afterInstrumentationEmpty: false, inputsUnchanged: false,
    serverVerified: false, result: null };
  const manifestFile = path.join(directory, 'manifest.json'); writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`Collection session proof: ${directory}`); const ownedReverse = [];
  try {
    for (const port of [PORTS.firestore, PORTS.auth]) { adbCommand(['reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`]); ownedReverse.push(port); }
    manifest.result = await runChild(process.execPath, [cli, 'emulators:exec', '--only', 'auth,firestore', '--project', PROJECT,
      '--config', path.join(directory, 'firebase.json'), 'node execute.mjs'], {
      cwd: directory, env, timeoutMs: 600_000, onOutput: chunk => {
        appendFileSync(path.join(directory, 'emulator.log'), chunk); process.stdout.write(chunk);
      } });
    process.exitCode = manifest.result.code;
  } finally {
    // No package force-stop, no deletion of a persistent Room database or user data.
    try { assertNoInstrumentation(adbCommand(['shell', 'dumpsys', 'activity', 'processes'])); manifest.afterInstrumentationEmpty = true; }
    catch (error) { manifest.instrumentationError = error.message; process.exitCode = 1; }
    for (const port of ownedReverse.reverse()) {
      try {
        const mappings = adbCommand(['reverse', '--list']).split(/\r?\n/).map(line => line.trim().split(/\s+/))
          .filter(parts => parts.length === 3 && parts[1] === `tcp:${port}`);
        if (mappings.length === 1 && mappings[0][2] === `tcp:${port}`) adbCommand(['reverse', '--remove', `tcp:${port}`]);
        else if (mappings.length) { manifest.reverseError = 'Reverse mapping changed; not removing another target'; process.exitCode = 1; }
      } catch (error) { manifest.reverseError = error.message; process.exitCode = 1; }
    }
    try { manifest.afterReverseEmpty = adbCommand(['reverse', '--list']) === ''; } catch { process.exitCode = 1; }
    try { await assertPortsFree(); manifest.afterPortsFree = true; } catch (error) { manifest.portError = error.message; process.exitCode = 1; }
    try { manifest.inputsUnchanged = (await Promise.all(Object.entries(inputs).map(async ([name, file]) => await sha256(file) === hashes[name]))).every(Boolean); }
    catch (error) { manifest.inputError = error.message; process.exitCode = 1; }
    // Evaluate Admin evidence even when Android failed, preserving useful RED readbacks.
    try { manifest.serverProof = validateServerProof(readJson(path.join(directory, 'server-proof.json')), runId); manifest.serverVerified = true; }
    catch (error) { manifest.serverError = error.message; process.exitCode = 1; }
    try { manifest.android = SCENARIOS.map(({ method }) => validateInstrumentation(readFileSync(path.join(directory, `${method}.log`), 'utf8'), method)); }
    catch (error) { manifest.androidError = error.message; process.exitCode = 1; }
    if (!manifest.afterPortsFree || !manifest.afterReverseEmpty || !manifest.afterInstrumentationEmpty || !manifest.inputsUnchanged || !manifest.serverVerified) process.exitCode = 1;
    manifest.finishedAt = new Date().toISOString(); manifest.exitCode = process.exitCode ?? 1;
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2)); console.log(`Collection session manifest: ${manifestFile}`);
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
