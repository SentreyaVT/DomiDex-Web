// Separate singleton runtime. Actual backend Auth/Firestore/Storage; NO final expiry or policy stub.
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = process.env.DOMIDEX_PRIVATE_TEST_ROOT, directory = process.env.DOMIDEX_PRIVATE_TEST_RUN;
const adb = process.env.DOMIDEX_COLLECTION_SESSION_ADB;
assert.ok(root && directory && path.resolve(directory) === process.cwd() && adb && path.isAbsolute(adb));
assert.equal(process.env.DOMIDEX_COLLECTION_SESSION_DELETION_ONLY, 'true');
assert.equal(process.env.DOMIDEX_COLLECTION_SESSION_CONSUMER_ONLY, undefined);
const load = name => import(pathToFileURL(path.join(root, name)));
const { assertTestEnvironment, runChild, PORTS } = await load('tests/private-operations-local/safety.mjs');
const { PROJECT, TEST_CLASS, normalize, validRunId, sessionProfile, assertSessionDevice, assertNoInstrumentation } =
  await load('tests/collection-sync-session-local/contract.mjs');
const { assertRevocationShellV2, revocationReadyExists, assertRevocationDeviceResult } =
  await load('tests/collection-sync-session-local/revocation.mjs');
const C = await load('tests/collection-sync-session-local/deletion-workflow.mjs');
const env = { ...process.env }; delete env.FIREBASE_CONFIG; assertTestEnvironment(env); delete process.env.FIREBASE_CONFIG;
const runId = validRunId(env.DOMIDEX_COLLECTION_SESSION_RUN_ID), profile = sessionProfile(env.DOMIDEX_COLLECTION_SESSION_DEVICE_PROFILE);
assert.equal(profile.id, 'owned-regression-avd');
const { deletionRequest, advanceDeletion } = await load('backend/security/deletion.mjs');
const require = createRequire(path.join(root, 'package.json'));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const app = initializeApp({ projectId: PROJECT, storageBucket: C.BUCKET, credential: applicationDefault() }, `deletion-proof-${runId}`);
const auth = getAuth(app), db = getFirestore(app), bucket = getStorage(app).bucket();
const proof = { project: PROJECT, runId, verified: false, now: null, jobId: null, seed: null, beforeRequest: null,
  ready: null, requestAttempts: 0, requestOutcome: 'not-started', retryAttempts: 0, retryOutcome: 'not-started',
  firstResponse: null, retryResponse: null, pending: null, retried: null, android: null, androidJoinedBeforeRetry: false,
  cleanup: { firestoreOutcome: 'not-started', deleteTimes: [], authDeleted: [], after: null }, realFinalDeletionAttempted: false,
  errors: [], adminClosed: false, tokenProof: null, accountsImported: false, seedAcknowledged: false };
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
async function accountSnapshot() {
  const value = await auth.listUsers(10); assert.equal(value.pageToken, undefined); assert.ok(value.users.length <= 2);
  return value.users.map(user => C.canonicalAccount(user.toJSON())).sort((a, b) => a.uid.localeCompare(b.uid));
}
async function storageSnapshot() {
  const result = {};
  for (const [key, extra] of [['current', {}], ['versions', { versions: true }], ['requestedSoftDeleted', { softDeleted: true }]]) {
    const [files, next] = await bucket.getFiles({ autoPaginate: false, maxResults: 2, ...extra });
    assert.ok(next == null); assert.equal(files.length, 0, 'Only independently empty owned Storage emulator'); result[key] = [];
  }
  return result;
}
async function snapshot() {
  const entries = [], collectionPaths = [], documentPaths = [];
  async function visit(collection, depth) {
    assert.ok(depth <= 1 && collectionPaths.length < 12); collectionPaths.push(collection.path);
    const references = await collection.listDocuments(); assert.ok(documentPaths.length + references.length <= 28);
    for (const reference of references) {
      documentPaths.push(reference.path); const doc = await reference.get();
      if (doc.exists) entries.push({ path: reference.path, data: normalize(doc.data()), writeTime: normalize(doc.updateTime) });
      for (const child of await reference.listCollections()) await visit(child, depth + 1);
    }
  }
  for (const collection of await db.listCollections()) await visit(collection, 0);
  return { entries: entries.sort((a, b) => a.path.localeCompare(b.path)), collectionPaths: collectionPaths.sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
    documentPaths: documentPaths.sort((a, b) => a < b ? -1 : a > b ? 1 : 0), accounts: await accountSnapshot(), storage: await storageSnapshot() };
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
async function actualToken() {
  const owner = C.WORKFLOW.owner;
  const postBody = new URLSearchParams({ providerId: 'google.com', id_token: JSON.stringify({
    sub: owner + '-google', email: owner + '@example.invalid', email_verified: true }) }).toString();
  const response = await fetch(`http://127.0.0.1:${PORTS.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=emulator-only`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody, requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: false }),
  });
  assert.equal(response.status, 200); let bytes = 0; const chunks = [];
  for await (const chunk of response.body) { bytes += chunk.length; assert.ok(bytes <= 16384); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(value.localId, owner); assert.equal(typeof value.idToken, 'string');
  const decoded = await auth.verifyIdToken(value.idToken, true);
  assert.equal(decoded.uid, owner); assert.equal(decoded.appAccess, true); assert.equal(decoded.firebase.sign_in_provider, 'google.com');
  assert.equal(decoded.admin, undefined); assert.equal(decoded.pretester, undefined);
  proof.now = Date.now(); assert.ok(Number.isSafeInteger(decoded.auth_time) && proof.now - decoded.auth_time * 1000 >= 0 && proof.now - decoded.auth_time * 1000 < 60_000);
  proof.tokenProof = { uid: decoded.uid, provider: decoded.firebase.sign_in_provider, authTime: decoded.auth_time * 1000, verified: true }; save();
  return value.idToken; // Tokens/refresh credentials are never persisted or logged.
}
let lifecycle, execution, barrier, context;
try {
  await noInstrumentation();
  assert.deepEqual(await snapshot(), { entries: [], collectionPaths: [], documentPaths: [], accounts: [],
    storage: { current: [], versions: [], requestedSoftDeleted: [] } });
  const imported = await auth.importUsers(C.ACCOUNTS); assert.deepEqual(imported, { successCount: 2, failureCount: 0, errors: [] });
  proof.accountsImported = true; save();
  const batch = db.batch(); for (const row of C.seedData(runId, FieldValue.serverTimestamp())) batch.create(db.doc(row.path), row.data);
  const writes = await batch.commit(); assert.equal(writes.length, 7); proof.seedAcknowledged = true; save();
  const token = await actualToken(); proof.seed = C.validateSeed(await snapshot(), runId); save();
  context = { auth, db, bucket, deletionEnabled: true, now: () => proof.now,
    beforeDelete: async item => { assert.equal(item.kind, 'document'); assert.ok(C.ownedInventoryPaths().includes(item.path)); } };
  await readyAbsent(); await noInstrumentation();
  lifecycle = { running: true, cancelled: false, output: '' };
  execution = runChild(adb, ['-s', profile.serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
    TEST_CLASS + '#' + C.WORKFLOW.method, '-e', 'domidexCollectionSessionProof', 'demo-loopback-only',
    '-e', 'domidexCollectionSessionRunId', runId, 'com.dominik.cardvault.test/androidx.test.runner.AndroidJUnitRunner'], {
    cwd: directory, env, timeoutMs: 180_000, onStop: () => { lifecycle.cancelled = true; }, onOutput: chunk => {
      lifecycle.output += String(chunk); appendFileSync(path.join(directory, C.WORKFLOW.method + '.log'), chunk); process.stdout.write(chunk);
    },
  }).then(value => { lifecycle.running = false; return value; }, error => { lifecycle.running = false; throw error; });
  barrier = (async () => {
    await C.awaitReady(runId, lifecycle, { now: () => performance.now(), sleep: () => new Promise(resolve => setTimeout(resolve, 100)),
      probeReady: () => readyDevice(['test', '-e', C.readyPath(runId)]), readReady: () => readyDevice(['base64', '-w', '0', C.readyPath(runId)]) });
    proof.ready = C.readyText(runId); proof.beforeRequest = C.validateSeed(await snapshot(), runId); save();
    C.validateBeforeRequest(proof.beforeRequest, proof.seed, runId);
    // Last synchronous guard after every preflight await; real backend operation runs to a joined outcome.
    C.assertActive(lifecycle); proof.requestAttempts++; proof.requestOutcome = 'unknown';
    proof.requestStartedAt = Date.now(); save();
    const response = await deletionRequest(new Request('http://localhost/api/account/delete', { method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE_DOMIDEX_ACCOUNT' }) }), context);
    proof.requestReturnedAt = Date.now(); proof.requestStatus = response.status; save();
    assert.equal(response.status, 202); proof.firstResponse = await response.json();
    proof.jobId = C.validatePendingResponse(proof.firstResponse, proof.now); proof.requestOutcome = 'acknowledged'; save();
    proof.pending = C.validatePending(await snapshot(), proof.beforeRequest, runId, proof.now, proof.jobId); save();
    // This is the same independent child promise, not a second wait/command or a circular join.
    const joined = await execution; assert.deepEqual(joined, { code: 0, signal: null, stopped: null, error: null });
    proof.android = C.validateWorkflowInstrumentation(lifecycle.output); C.assertRetryAllowed(lifecycle);
    proof.androidJoinedBeforeRetry = true; save();
    // Same frozen clock after joined PASS: before expiry; no new token/actor or fake session state.
    C.assertRetryAllowed(lifecycle); proof.retryAttempts++; proof.retryOutcome = 'unknown';
    proof.retryStartedAt = Date.now(); save();
    proof.retryResponse = await advanceDeletion(context, C.WORKFLOW.owner, proof.jobId);
    proof.retryReturnedAt = Date.now(); save();
    C.validatePendingResponse(proof.retryResponse, proof.now, proof.jobId); proof.retryOutcome = 'acknowledged'; save();
    proof.retried = await snapshot(); C.validateRetry(proof.pending, proof.retried, proof.beforeRequest, runId, proof.now, proof.jobId); save();
  })().catch(error => { proof.errors.push({ stage: 'workflow', error: error.message }); save(); });
  const result = await execution; await barrier;
  assert.deepEqual(result, { code: 0, signal: null, stopped: null, error: null });
  proof.android = C.validateWorkflowInstrumentation(lifecycle.output); save();
  assert.equal(proof.requestOutcome, 'acknowledged'); assert.equal(proof.retryOutcome, 'acknowledged');
  assert.deepEqual(proof.errors, []); await noInstrumentation(); proof.verified = true;
} catch (error) {
  proof.errors.push({ stage: 'proof', error: error.message }); proof.verified = false; process.exitCode = 1;
} finally {
  // Join before any cleanup; no detached backend writes and no final production expiry sweep.
  if (execution) await execution.catch(() => {}); if (barrier) await barrier;
  try {
    await noInstrumentation();
    // Unknown request/retry/seed outcomes or changed state authorize NO destructive cleanup.
    const before = await snapshot(); C.assertCleanupOwned(proof, before, runId);
    proof.cleanup.before = before; proof.cleanup.firestoreOutcome = 'unknown'; save();
    const cleanup = db.batch(); before.entries.forEach(row => cleanup.delete(db.doc(row.path), {
      lastUpdateTime: new Timestamp(row.writeTime.seconds, row.writeTime.nanoseconds) }));
    const removed = await cleanup.commit(); assert.equal(removed.length, before.entries.length);
    proof.cleanup.deleteTimes = removed.map(result => normalize(result.writeTime));
    proof.cleanup.firestoreOutcome = 'acknowledged'; save();
    // Auth has no CAS API. Only this sole-writer freshly owned emulator is in scope;
    // recheck exact complete remaining synthetic account inventory before EACH delete.
    for (const account of before.accounts) {
      assert.deepEqual(await accountSnapshot(), before.accounts.filter(a => !proof.cleanup.authDeleted.includes(a.uid)));
      proof.cleanup.authDeleteAttempt = account.uid; save(); await auth.deleteUser(account.uid);
      proof.cleanup.authDeleted.push(account.uid); delete proof.cleanup.authDeleteAttempt; save();
    }
    proof.cleanup.after = await snapshot(); save();
  } catch (error) {
    proof.verified = false; proof.errors.push({ stage: 'fixture-cleanup', error: error.message }); process.exitCode = 1;
  }
  try { await db.terminate(); await deleteApp(app); proof.adminClosed = true; }
  catch (error) { proof.verified = false; proof.errors.push({ stage: 'admin-close', error: error.message }); }
  save(); try { C.validateWorkflowProof(proof, runId); } catch { process.exitCode = 1; }
}
