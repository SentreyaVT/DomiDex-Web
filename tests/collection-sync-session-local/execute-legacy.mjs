// Local singleton only: synthetic legacy STARTED job, genuine Auth disable/revoke, no access fence.
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = process.env.DOMIDEX_PRIVATE_TEST_ROOT, directory = process.env.DOMIDEX_PRIVATE_TEST_RUN;
const adb = process.env.DOMIDEX_COLLECTION_SESSION_ADB;
assert.ok(root && directory && path.resolve(directory) === process.cwd() && adb && path.isAbsolute(adb));
assert.equal(process.env.DOMIDEX_COLLECTION_SESSION_LEGACY_ONLY, 'true');
assert.equal(process.env.DOMIDEX_COLLECTION_SESSION_CONSUMER_ONLY, undefined);
assert.equal(process.env.DOMIDEX_COLLECTION_SESSION_DELETION_ONLY, undefined);
const load = name => import(pathToFileURL(path.join(root, name)));
const { assertTestEnvironment, runChild } = await load('tests/private-operations-local/safety.mjs');
const { PROJECT, TEST_CLASS, normalize, validRunId, sessionProfile, assertSessionDevice, assertNoInstrumentation } =
  await load('tests/collection-sync-session-local/contract.mjs');
const { assertRevocationShellV2, revocationReadyExists, assertRevocationDeviceResult } =
  await load('tests/collection-sync-session-local/revocation.mjs');
const C = await load('tests/collection-sync-session-local/legacy-lock.mjs');
const env = { ...process.env }; delete env.FIREBASE_CONFIG; assertTestEnvironment(env); delete process.env.FIREBASE_CONFIG;
const runId = validRunId(env.DOMIDEX_COLLECTION_SESSION_RUN_ID), profile = sessionProfile(env.DOMIDEX_COLLECTION_SESSION_DEVICE_PROFILE);
assert.equal(profile.id, 'owned-regression-avd');
const require = createRequire(path.join(root, 'package.json'));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const app = initializeApp({ projectId: PROJECT, storageBucket: C.BUCKET, credential: applicationDefault() }, `legacy-proof-${runId}`);
const auth = getAuth(app), db = getFirestore(app), bucket = getStorage(app).bucket();
const step = () => ({ attempts: 0, outcome: 'not-started', snapshot: null });
const proof = { project: PROJECT, runId, verified: false, now: null, seed: null, beforeMutation: null, ready: null,
  create: step(), disable: step(), revoke: step(), afterAndroid: null, android: null, accountsImported: false,
  seedAcknowledged: false, cleanup: { firestoreOutcome: 'not-started', deleteTimes: [], authDeleted: [], after: null },
  realDeletionWorkflowInvoked: false, errors: [], adminClosed: false };
const save = () => writeFileSync(path.join(directory, 'server-proof.json'), JSON.stringify(proof, null, 2));
async function deviceRead(args) {
  let output = ''; const result = await runChild(adb, ['-s', profile.serial, ...args], { cwd: directory, env,
    timeoutMs: 15_000, onOutput: chunk => { output += String(chunk); } });
  assert.deepEqual(result, { code: 0, signal: null, stopped: null, error: null }); return output.trim();
}
async function noInstrumentation() {
  assertSessionDevice({ state: await deviceRead(['get-state']), avd: await deviceRead(['shell', 'getprop', 'ro.boot.qemu.avd_name']),
    qemu: await deviceRead(['shell', 'getprop', 'ro.kernel.qemu']), api: await deviceRead(['shell', 'getprop', 'ro.build.version.sdk']),
    airplane: await deviceRead(['shell', 'settings', 'get', 'global', 'airplane_mode_on']),
    wifi: await deviceRead(['shell', 'settings', 'get', 'global', 'wifi_on']), connectivity: await deviceRead(['shell', 'dumpsys', 'connectivity']) }, profile);
  assertNoInstrumentation(await deviceRead(['shell', 'dumpsys', 'activity', 'processes']));
}
async function accounts() {
  const value = await auth.listUsers(10); assert.equal(value.pageToken, undefined); assert.ok(value.users.length <= 2);
  return value.users.map(user => C.canonicalAccount(user.toJSON())).sort((a, b) => a.uid.localeCompare(b.uid));
}
async function snapshot() {
  const entries = [], collectionPaths = [], documentPaths = [];
  async function visit(collection, depth) {
    assert.ok(depth <= 1 && collectionPaths.length < 8); collectionPaths.push(collection.path);
    const references = await collection.listDocuments(); assert.ok(documentPaths.length + references.length <= 8);
    for (const reference of references) {
      documentPaths.push(reference.path); const doc = await reference.get();
      if (doc.exists) entries.push({ path: reference.path, data: normalize(doc.data()), writeTime: normalize(doc.updateTime) });
      for (const child of await reference.listCollections()) await visit(child, depth + 1);
    }
  }
  for (const collection of await db.listCollections()) await visit(collection, 0);
  const storage = {};
  for (const [key, extra] of [['current', {}], ['versions', { versions: true }], ['requestedSoftDeleted', { softDeleted: true }]]) {
    const [files, next] = await bucket.getFiles({ autoPaginate: false, maxResults: 2, ...extra });
    assert.ok(next == null); assert.equal(files.length, 0, 'Only independently empty owned Storage emulator'); storage[key] = [];
  }
  const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return { entries: entries.sort((a, b) => a.path.localeCompare(b.path)), collectionPaths: collectionPaths.sort(lexical),
    documentPaths: documentPaths.sort(lexical), accounts: await accounts(), storage };
}
async function barrierAdb(args) {
  let output = '', bytes = 0;
  const result = await runChild(adb, ['-s', profile.serial, ...args], { cwd: directory, env, timeoutMs: 1500,
    onOutput: chunk => { bytes += chunk.length; assert.ok(bytes <= 1024); output += String(chunk); } });
  return { output, result };
}
const readyDevice = args => barrierAdb(['shell', '-T', 'run-as', 'com.dominik.cardvault', '/system/bin/toybox', ...args]);
async function readyAbsent() {
  assertRevocationShellV2(await barrierAdb(['features']));
  for (const args of [['test', '-d', 'files'], ['test', '-r', 'files']]) {
    const value = await readyDevice(args); assertRevocationDeviceResult(value); assert.equal(value.result.code, 0); assert.equal(value.output, '');
  }
  for (const suffix of ['', '.bak', '.new']) for (const flag of ['-e', '-L'])
    assert.equal(revocationReadyExists(await readyDevice(['test', flag, C.readyPath(runId) + suffix])), false);
}
let lifecycle, execution, barrier;
async function mutate(name, operation) {
  const current = proof[name];
  if (name === 'create') { C.assertActive(lifecycle); current.before = proof.beforeMutation; }
  else {
    // A fast genuine PASS may precede Auth completion. Only that exact joined child,
    // never a failure/cancellation/partial terminal, can authorize continuation.
    try { C.assertActive(lifecycle); } catch { await execution; }
    C.assertMayContinue(lifecycle);
    current.before = await snapshot(); assert.deepEqual(current.before, C.validateStages(proof, runId));
    try { C.assertActive(lifecycle); } catch { await execution; }
  }
  // Last synchronous guard after every await, immediately before EACH new mutation.
  current.authorization = name === 'create' ? (C.assertActive(lifecycle), 'active-start') : C.assertMayContinue(lifecycle);
  current.joinedAndroid = current.authorization === 'joined-pass' ? C.validateLegacyInstrumentation(lifecycle.output) : null;
  current.attempts++; current.outcome = 'unknown';
  current.startedAt = Date.now(); save(); const result = await operation();
  current.returnedAt = Date.now(); current.outcome = 'acknowledged';
  if (name === 'create') current.writeTimes = result.map(row => normalize(row.writeTime));
  save(); current.snapshot = await snapshot(); save(); C.validateStages(proof, runId);
}
try {
  await noInstrumentation(); assert.deepEqual(await snapshot(), C.emptySnapshot());
  const imported = await auth.importUsers(C.ACCOUNTS); assert.deepEqual(imported, { successCount: 2, failureCount: 0, errors: [] });
  proof.accountsImported = true; save();
  const batch = db.batch(); for (const row of C.seedData(runId, FieldValue.serverTimestamp())) batch.create(db.doc(row.path), row.data);
  const writes = await batch.commit(); assert.equal(writes.length, 6); proof.seedAcknowledged = true; save();
  proof.seed = C.validateSeed(await snapshot(), runId); save(); await readyAbsent(); await noInstrumentation();
  lifecycle = { running: true, cancelled: false, output: '' };
  execution = runChild(adb, ['-s', profile.serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
    TEST_CLASS + '#' + C.LEGACY.method, '-e', 'domidexCollectionSessionProof', 'demo-loopback-only',
    '-e', 'domidexCollectionSessionRunId', runId, 'com.dominik.cardvault.test/androidx.test.runner.AndroidJUnitRunner'], {
    cwd: directory, env, timeoutMs: 180_000, onStop: () => { lifecycle.cancelled = true; }, onOutput: chunk => {
      lifecycle.output += String(chunk); appendFileSync(path.join(directory, C.LEGACY.method + '.log'), chunk); process.stdout.write(chunk);
    },
  }).then(value => { lifecycle.running = false; lifecycle.result = value; return value; }, error => { lifecycle.running = false; throw error; });
  barrier = (async () => {
    await C.awaitReady(runId, lifecycle, { now: () => performance.now(), sleep: () => new Promise(resolve => setTimeout(resolve, 100)),
      probeReady: () => readyDevice(['test', '-e', C.readyPath(runId)]), readReady: () => readyDevice(['base64', '-w', '0', C.readyPath(runId)]) });
    proof.ready = C.readyText(runId); proof.beforeMutation = C.validateBeforeMutation(await snapshot(), proof.seed, runId);
    proof.now = Date.now(); save();
    await mutate('create', async () => { const create = db.batch();
      for (const row of C.legacyData(runId, proof.now)) create.create(db.doc(row.path), row.data); return create.commit(); });
    await mutate('disable', () => auth.updateUser(C.LEGACY.owner, { disabled: true }));
    await mutate('revoke', () => auth.revokeRefreshTokens(C.LEGACY.owner));
  })().catch(error => { proof.errors.push({ stage: 'legacy-barrier', error: error.message }); save(); });
  const result = await execution; await barrier;
  proof.afterAndroid = await snapshot(); save();
  assert.deepEqual(result, { code: 0, signal: null, stopped: null, error: null });
  proof.android = C.validateLegacyInstrumentation(lifecycle.output);
  assert.deepEqual(proof.afterAndroid, C.validateStages(proof, runId, true)); assert.deepEqual(proof.errors, []);
  await noInstrumentation(); proof.verified = true;
} catch (error) {
  proof.errors.push({ stage: 'proof', error: error.message }); proof.verified = false; process.exitCode = 1;
} finally {
  if (execution) await execution.catch(() => {}); if (barrier) await barrier;
  try {
    await noInstrumentation(); const before = await snapshot(); proof.afterAndroid ??= before;
    C.assertCleanupOwned(proof, before, runId); proof.cleanup.before = before;
    proof.cleanup.firestoreOutcome = 'unknown'; save();
    const cleanup = db.batch(); before.entries.forEach(row => cleanup.delete(db.doc(row.path), {
      lastUpdateTime: new Timestamp(row.writeTime.seconds, row.writeTime.nanoseconds) }));
    const removed = await cleanup.commit(); assert.equal(removed.length, before.entries.length);
    proof.cleanup.deleteTimes = removed.map(result => normalize(result.writeTime)); proof.cleanup.firestoreOutcome = 'acknowledged'; save();
    // Auth has no cross-service CAS. Recheck the entire exact synthetic inventory before each delete.
    for (const account of before.accounts) {
      assert.deepEqual(await accounts(), before.accounts.filter(a => !proof.cleanup.authDeleted.includes(a.uid)));
      proof.cleanup.authDeleteAttempt = account.uid; save(); await auth.deleteUser(account.uid);
      proof.cleanup.authDeleted.push(account.uid); delete proof.cleanup.authDeleteAttempt; save();
    }
    proof.cleanup.after = await snapshot(); save();
  } catch (error) { proof.verified = false; proof.errors.push({ stage: 'fixture-cleanup', error: error.message }); process.exitCode = 1; }
  try { await db.terminate(); await deleteApp(app); proof.adminClosed = true; }
  catch (error) { proof.verified = false; proof.errors.push({ stage: 'admin-close', error: error.message }); }
  save(); try { C.validateLegacyProof(proof, runId); } catch { process.exitCode = 1; }
}
