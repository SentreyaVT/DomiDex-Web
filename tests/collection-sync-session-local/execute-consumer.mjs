// Additive fixed singleton, copied to the existing isolated demo output by run.mjs.
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = process.env.DOMIDEX_PRIVATE_TEST_ROOT;
const directory = process.env.DOMIDEX_PRIVATE_TEST_RUN;
const adb = process.env.DOMIDEX_COLLECTION_SESSION_ADB;
assert.ok(root && directory && path.resolve(directory) === process.cwd() && adb && path.isAbsolute(adb));
assert.equal(process.env.DOMIDEX_COLLECTION_SESSION_CONSUMER_ONLY, 'true');
const { assertTestEnvironment, runChild } = await import(pathToFileURL(path.join(root, 'tests/private-operations-local/safety.mjs')));
const { PROJECT, TEST_CLASS, validRunId, normalize, sessionProfile, assertSessionDevice, assertNoInstrumentation } =
  await import(pathToFileURL(path.join(root, 'tests/collection-sync-session-local/contract.mjs')));
const { assertRevocationDeviceResult, revocationReadyExists, assertRevocationShellV2 } =
  await import(pathToFileURL(path.join(root, 'tests/collection-sync-session-local/revocation.mjs')));
const { CONSUMER, ACCOUNTS, KNOWLEDGE, LOCK, ACCESS, readyPath, fixture, expectedSnapshot,
  newReceipt, beginConsumer, finishConsumer, validateSeed, validateConsumerInstrumentation,
  validateConsumerReceipt, validateConsumerProof } =
  await import(pathToFileURL(path.join(root, 'tests/collection-sync-session-local/consumer-access.mjs')));
const env = { ...process.env }; delete env.FIREBASE_CONFIG;
assertTestEnvironment(env); delete process.env.FIREBASE_CONFIG;
const runId = validRunId(env.DOMIDEX_COLLECTION_SESSION_RUN_ID);
const profile = sessionProfile(env.DOMIDEX_COLLECTION_SESSION_DEVICE_PROFILE);
assert.equal(profile.id, 'owned-regression-avd', 'Only fixed owned5556 profile');
const require = createRequire(path.join(root, 'package.json'));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, `consumer-access-admin-${runId}`);
const db = getFirestore(app); const auth = getAuth(app);
const proof = { project: PROJECT, runId, verified: false, seed: null, preflight: null, readback: null,
  android: null, barrier: newReceipt(runId), accountUnchanged: false, errors: [], adminClosed: false };
const save = () => writeFileSync(path.join(directory, 'server-proof.json'), JSON.stringify(proof, null, 2));

async function deviceRead(args) {
  let output = '';
  const result = await runChild(adb, ['-s', profile.serial, ...args], {
    cwd: directory, env, timeoutMs: 15_000, onOutput: chunk => { output += String(chunk); } });
  assert.equal(result.code, 0); assert.equal(result.stopped, null); assert.equal(result.error, null);
  return output.trim();
}
async function noInstrumentation() {
  assertSessionDevice({ state: await deviceRead(['get-state']), avd: await deviceRead(['shell', 'getprop', 'ro.boot.qemu.avd_name']),
    qemu: await deviceRead(['shell', 'getprop', 'ro.kernel.qemu']), api: await deviceRead(['shell', 'getprop', 'ro.build.version.sdk']),
    airplane: await deviceRead(['shell', 'settings', 'get', 'global', 'airplane_mode_on']),
    wifi: await deviceRead(['shell', 'settings', 'get', 'global', 'wifi_on']),
    connectivity: await deviceRead(['shell', 'dumpsys', 'connectivity']) }, profile);
  assertNoInstrumentation(await deviceRead(['shell', 'dumpsys', 'activity', 'processes']));
}
async function accountsSnapshot() {
  const value = await auth.listUsers(); assert.equal(value.pageToken, undefined);
  return value.users.map(user => ({ uid: user.uid, email: user.email, emailVerified: user.emailVerified,
    disabled: user.disabled, customClaims: user.customClaims,
    providerData: user.providerData.map(({ providerId, uid, email }) => ({ providerId, uid, email }))
  })).sort((a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
}
async function snapshot() {
  const entries = [], collectionPaths = [], documentPaths = [];
  async function visit(collection, depth) {
    assert.ok(depth <= 1 && collectionPaths.length < 4, 'Fixed three-document tree only');
    collectionPaths.push(collection.path);
    for (const reference of await collection.listDocuments()) {
      assert.ok(documentPaths.length < 4, 'Bounded complete reference inventory');
      documentPaths.push(reference.path);
      const document = await reference.get();
      if (document.exists) entries.push({ path: reference.path, data: normalize(document.data()) });
      for (const child of await reference.listCollections()) await visit(child, depth + 1);
    }
  }
  for (const collection of await db.listCollections()) await visit(collection, 0);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return { entries: entries.sort((a, b) => compare(a.path, b.path)), collectionPaths: collectionPaths.sort(compare),
    documentPaths: documentPaths.sort(compare), accounts: await accountsSnapshot() };
}
async function barrierAdb(args, timeoutMs = 1500) {
  let output = '', bytes = 0;
  const result = await runChild(adb, ['-s', profile.serial, ...args], { cwd: directory, env, timeoutMs, onOutput: chunk => {
    bytes += chunk.length; assert.ok(bytes <= 1024); output += String(chunk);
  } });
  return { output, result };
}
const readyDevice = (args, timeout) => barrierAdb([
  'shell', '-T', 'run-as', 'com.dominik.cardvault', '/system/bin/toybox', ...args], timeout);
async function readyAbsent() {
  assertRevocationShellV2(await barrierAdb(['features']));
  for (const args of [['test', '-d', 'files'], ['test', '-r', 'files']]) {
    const value = await readyDevice(args); assertRevocationDeviceResult(value);
    assert.equal(value.result.code, 0); assert.equal(value.output, '');
  }
  for (const flag of ['-e', '-L']) assert.equal(revocationReadyExists(await readyDevice(['test', flag, readyPath(runId)])), false);
}
const references = [db.doc(LOCK), db.doc(ACCESS)];
const timestamp = value => new Timestamp(value.seconds, value.nanoseconds);
const io = {
  now: () => performance.now(), sleep: () => new Promise(resolve => setTimeout(resolve, 100)), save, snapshot,
  probeReady: timeout => readyDevice(['test', '-e', readyPath(runId)], timeout),
  readReady: timeout => readyDevice(['base64', '-w', '0', readyPath(runId)], timeout),
  documents: async () => {
    const documents = await db.getAll(...references); assert.equal(documents.length, 2);
    return documents.map(document => document.exists
      ? { path: document.ref.path, exists: true, data: normalize(document.data()), writeTime: normalize(document.updateTime) }
      : { path: document.ref.path, exists: false });
  },
  createBoth: async (lock, access) => {
    const batch = db.batch(); batch.create(references[0], lock); batch.create(references[1], access);
    return (await batch.commit()).map(result => normalize(result.writeTime));
  },
  deleteBoth: async times => {
    const batch = db.batch();
    references.forEach((reference, index) => batch.delete(reference, { lastUpdateTime: timestamp(times[index]) }));
    return (await batch.commit()).map(result => normalize(result.writeTime));
  },
};
try {
  await noInstrumentation();
  assert.deepEqual(await snapshot(), { entries: [], collectionPaths: [], documentPaths: [], accounts: [] });
  const imported = await auth.importUsers(ACCOUNTS);
  assert.equal(imported.successCount, 2); assert.equal(imported.failureCount, 0); assert.deepEqual(imported.errors, []);
  assert.deepEqual(await accountsSnapshot(), ACCOUNTS);
  await db.doc(KNOWLEDGE).create(fixture(runId, FieldValue.serverTimestamp()).data);
  const seed = await db.doc(KNOWLEDGE).get(); assert.equal(seed.exists, true);
  proof.seed = validateSeed({ path: seed.ref.path, data: normalize(seed.data()) }, runId); save();
  proof.preflight = await snapshot(); save(); assert.deepEqual(proof.preflight, expectedSnapshot(proof.seed, runId));
  await readyAbsent(); await noInstrumentation();
  const lifecycle = { running: true, cancelled: false, output: '' };
  const execution = runChild(adb, ['-s', profile.serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
    TEST_CLASS + '#' + CONSUMER.method, '-e', 'domidexCollectionSessionProof', 'demo-loopback-only',
    '-e', 'domidexCollectionSessionRunId', runId, 'com.dominik.cardvault.test/androidx.test.runner.AndroidJUnitRunner'], {
    cwd: directory, env, timeoutMs: 180_000, onStop: () => { lifecycle.cancelled = true; },
    onOutput: chunk => {
      lifecycle.output += String(chunk); appendFileSync(path.join(directory, CONSUMER.method + '.log'), chunk);
      process.stdout.write(chunk);
    },
  }).then(value => { lifecycle.running = false; return value; }, error => { lifecycle.running = false; throw error; });
  const barrier = beginConsumer(proof.barrier, proof.seed, lifecycle, io).catch(error => {
    proof.barrier.errors.push({ stage: 'barrier', error: error.message }); save();
  });
  let result;
  try { result = await execution; }
  finally { await barrier; await finishConsumer(proof.barrier, proof.seed, io); }
  validateConsumerReceipt(proof.barrier, runId, proof.seed);
  assert.equal(result.code, 0); assert.equal(result.stopped, null); assert.equal(result.error, null);
  proof.android = validateConsumerInstrumentation(lifecycle.output); save();
  proof.readback = await snapshot(); save(); assert.deepEqual(proof.readback, proof.preflight);
  assert.deepEqual(await accountsSnapshot(), ACCOUNTS); proof.accountUnchanged = true;
  await noInstrumentation(); proof.verified = true;
} catch (error) {
  proof.verified = false; proof.errors.push({ stage: 'consumer-access', error: error.message }); process.exitCode = 1;
} finally {
  // Retain independent state even on Android/receipt failure. No destructive retry.
  try { proof.readback = await snapshot(); } catch (error) { proof.errors.push({ stage: 'readback', error: error.message }); proof.verified = false; }
  save(); let closed = true;
  try { await db.terminate(); } catch (error) { closed = false; proof.errors.push({ stage: 'terminate', error: error.message }); }
  try { await deleteApp(app); } catch (error) { closed = false; proof.errors.push({ stage: 'delete-admin-app', error: error.message }); }
  proof.adminClosed = closed;
  if (!closed) proof.verified = false;
  save();
  try { validateConsumerProof(proof, runId); } catch { process.exitCode = 1; }
}
