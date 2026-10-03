// Copied byte-for-byte to the isolated output directory by run.mjs. No .env loading.
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = process.env.DOMIDEX_PRIVATE_TEST_ROOT;
const directory = process.env.DOMIDEX_PRIVATE_TEST_RUN;
const adb = process.env.DOMIDEX_COLLECTION_SESSION_ADB;
if (!root || !directory || path.resolve(directory) !== process.cwd() || !adb || !path.isAbsolute(adb)) throw Error('Isolated driver context required');
const { assertTestEnvironment, runChild } = await import(pathToFileURL(path.join(root, 'tests/private-operations-local/safety.mjs')));
const { PROJECT, TEST_CLASS, SCENARIOS, ACCOUNTS, validRunId, normalize, validateInstrumentation, sessionProfile, assertSessionDevice,
  assertNoInstrumentation, seedFixtures, assertSeed, validatePreflight, validateReadbacks,
  FULL_BUDGET_PARENT, FULL_BUDGET_COLLECTION, FULL_BUDGET_PATHS, isFullBudgetInventoryPath,
  KNOWLEDGE_PATH, KNOWLEDGE_MISSING_PATH, KNOWLEDGE_MALFORMED_PATH, assertKnowledgeInventoryPath,
  validateServerProof } = await import(pathToFileURL(path.join(root, 'tests/collection-sync-session-local/contract.mjs')));
const { REVOCATION, REVOCATION_LOCK_PATH, revocationReadyPath, assertRevocationDeviceResult,
  revocationReadyExists, assertRevocationReadyRead, assertRevocationShellV2, assertRevocationMayCreate,
  revocationLockFixture, revocationStartIsActive, expectedLockedSnapshot, validateRevocationReceipt } =
  await import(pathToFileURL(path.join(root, 'tests/collection-sync-session-local/revocation.mjs')));
const { MUTATION, MUTATION_PATH, MUTATION_LOCK_PATH, mutationReadyPath, mutationFixture,
  createMutationState, beginMutation, finishMutation, validateMutationReceipt } =
  await import(pathToFileURL(path.join(root, 'tests/collection-sync-session-local/revocation-mutation.mjs')));
const env = { ...process.env }; delete env.FIREBASE_CONFIG;
assertTestEnvironment(env); delete process.env.FIREBASE_CONFIG;
const runId = validRunId(env.DOMIDEX_COLLECTION_SESSION_RUN_ID);
const profile = sessionProfile(env.DOMIDEX_COLLECTION_SESSION_DEVICE_PROFILE);
const require = createRequire(path.join(root, 'package.json'));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth'); const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, `collection-session-admin-${runId}`);
const db = getFirestore(app); const auth = getAuth(app);
const proof = { project: PROJECT, runId, verified: false, phases: [], seeds: [], preflights: [], readbacks: [], revocations: [], mutations: [], accountUnchanged: false, errors: [], readbackErrors: [] };
function saveProof() { writeFileSync(path.join(directory, 'server-proof.json'), JSON.stringify(proof, null, 2)); }
async function deviceRead(args) {
  let output = '';
  const result = await runChild(adb, ['-s', profile.serial, ...args], {
    cwd: directory, env, timeoutMs: 15_000, onOutput: chunk => { output += String(chunk); } });
  assert.equal(result.code, 0); return output.trim();
}
async function noInstrumentation() {
  assertSessionDevice({
    state: await deviceRead(['get-state']), avd: await deviceRead(['shell', 'getprop', 'ro.boot.qemu.avd_name']),
    qemu: await deviceRead(['shell', 'getprop', 'ro.kernel.qemu']), api: await deviceRead(['shell', 'getprop', 'ro.build.version.sdk']),
    airplane: await deviceRead(['shell', 'settings', 'get', 'global', 'airplane_mode_on']),
    wifi: await deviceRead(['shell', 'settings', 'get', 'global', 'wifi_on']),
    connectivity: await deviceRead(['shell', 'dumpsys', 'connectivity']),
  }, profile);
  assertNoInstrumentation(await deviceRead(['shell', 'dumpsys', 'activity', 'processes']));
}
async function accountsSnapshot() {
  const accounts = await auth.listUsers(); assert.equal(accounts.pageToken, undefined);
  return accounts.users.map(user => ({ uid: user.uid, email: user.email, emailVerified: user.emailVerified,
    disabled: user.disabled, customClaims: user.customClaims,
    providerData: user.providerData.map(({ providerId, uid, email }) => ({ providerId, uid, email }))
  })).sort((left, right) => left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : 0);
}
// Enumerate this fresh demo DB, including missing parent references. Bounded traversal
// detects extra owners, root/access documents and sidecars rather than silently omitting them.
async function databaseSnapshot(scenario) {
  const entries = []; const collectionPaths = []; const documentPaths = [];
  let ordinaryDocumentCount = 0;
  const largeReferences = new Set();
  async function visit(collection, depth) {
    assert.ok(depth <= 4 && collectionPaths.length < 16, 'Unexpected emulator collection tree');
    if (collection.path === 'scanKnowledge' || collection.path.startsWith('scanKnowledge/')) {
      assert.ok(scenario === SCENARIOS[13] || scenario === SCENARIOS[14] || scenario === SCENARIOS[15] || scenario === MUTATION || scenario === SCENARIOS[17], 'No knowledge inventory before its own case');
      assert.equal(collection.path, 'scanKnowledge', 'No knowledge child collections');
    }
    if (collection.path.startsWith(`${FULL_BUDGET_PARENT}/`)) {
      assert.equal(scenario, SCENARIOS[17], 'No paging-owner inventory before its own case');
      assert.equal(collection.path, FULL_BUDGET_COLLECTION, 'No additional large-owner collections');
    }
    collectionPaths.push(collection.path);
    for (const reference of await collection.listDocuments()) {
      assertKnowledgeInventoryPath(reference.path, scenario);
      if (isFullBudgetInventoryPath(reference.path, scenario)) {
        assert.equal(largeReferences.has(reference.path), false, 'Duplicate large-owner reference');
        largeReferences.add(reference.path);
      } else {
        assert.ok(ordinaryDocumentCount < 32, 'Unexpected emulator document count'); ordinaryDocumentCount++;
      }
      documentPaths.push(reference.path);
      const document = await reference.get();
      if (reference.path === FULL_BUDGET_PARENT) assert.equal(document.exists, false, 'Owner parent must remain absent');
      else if (largeReferences.has(reference.path)) assert.equal(document.exists, true, 'Each expected paging seed must exist');
      if (document.exists) entries.push({ path: reference.path, data: normalize(document.data()) });
      for (const child of await reference.listCollections()) await visit(child, depth + 1);
    }
  }
  for (const collection of await db.listCollections()) await visit(collection, 0);
  if (scenario === SCENARIOS[17]) assert.deepEqual([...largeReferences].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    [FULL_BUDGET_PARENT, ...FULL_BUDGET_PATHS].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    'Only the complete fixed paging-owner inventory may exceed the ordinary reference bound');
  if (scenario === SCENARIOS[13] || scenario === SCENARIOS[14] || scenario === SCENARIOS[15] || scenario === MUTATION || scenario === SCENARIOS[17]) {
    assert.ok(documentPaths.includes(KNOWLEDGE_PATH), 'Require the exact knowledge seed in the complete inventory');
    assert.equal((await db.doc(KNOWLEDGE_MISSING_PATH).get()).exists, false, 'The second knowledge fingerprint must remain absent');
  }
  if (scenario === SCENARIOS[14] || scenario === SCENARIOS[15] || scenario === MUTATION || scenario === SCENARIOS[17]) {
    assert.ok(documentPaths.includes(KNOWLEDGE_MALFORMED_PATH), 'Require the exact malformed knowledge seed in the complete inventory');
  }
  if (scenario === REVOCATION || scenario === MUTATION || scenario === SCENARIOS[17]) {
    assert.ok(documentPaths.includes('scanKnowledge/' + '6'.repeat(64)), 'Exact revocation knowledge seed required');
  }
  if (scenario === MUTATION || scenario === SCENARIOS[17]) {
    assert.ok(documentPaths.includes(MUTATION_PATH), 'Exact data-change seed required');
  }
  return { entries: entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    collectionPaths: collectionPaths.sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    documentPaths: documentPaths.sort((left, right) => left < right ? -1 : left > right ? 1 : 0) };
}
async function revocationAdb(args, timeoutMs = 1500) {
  assert.equal(profile.id, 'owned-regression-avd', 'New host barrier requires the exact owned5556 profile');
  let output = ''; let bytes = 0;
  const result = await runChild(adb, ['-s', profile.serial, ...args], { cwd: directory, env, timeoutMs, onOutput: chunk => {
      bytes += chunk.length; assert.ok(bytes <= 1024, 'Bounded exact barrier-file read only'); output += String(chunk);
    } });
  return { result, output };
}
const revocationDevice = (args, timeoutMs) => revocationAdb([
  'shell', '-T', 'run-as', 'com.dominik.cardvault', '/system/bin/toybox', ...args,
], timeoutMs);
async function assertRevocationReadyAbsent(readyPath = revocationReadyPath(runId)) {
  assertRevocationShellV2(await revocationAdb(['features']));
  for (const args of [['test', '-d', 'files'], ['test', '-r', 'files']]) {
    const value = await revocationDevice(args);
    assert.equal(value.result.code, 0, 'Known readable app-private files directory required');
    assert.equal(value.output, ''); assertRevocationDeviceResult(value);
  }
  const absent = await revocationDevice(['test', '-e', readyPath]);
  assert.equal(revocationReadyExists(absent), false, 'Exact ready file must not exist before launch');
}
const revocationTree = async () => ({
  method: REVOCATION.method, ...await databaseSnapshot(REVOCATION), accounts: await accountsSnapshot(),
});
function revocationState() {
  const receipt = { version: 1, method: REVOCATION.method, runId,
    ready: null, positiveReadyReads: 0, createAttempts: 0, deleteAttempts: 0,
    lock: revocationLockFixture(runId), lockWriteTime: null, lockObservedWriteTime: null,
    deleteCheckedWriteTime: null, beforeCreate: null, afterCreate: null,
    lockedAndroidReadback: null, afterDelete: null, events: [], errors: [] };
  proof.revocations.push(receipt); saveProof();
  return { receipt, writeTime: null, created: false };
}
async function beginRevocation(state, preflight, lifecycle) {
  const receipt = state.receipt; let deadline = null; let lastRead = 'No exact ready file yet';
  for (;;) {
    assert.equal(lifecycle.running, true, 'Android ended before the ready barrier');
    assert.equal(lifecycle.cancelled, false, 'Android stopped before the ready barrier');
    const active = revocationStartIsActive(lifecycle.output, lifecycle.running);
    if (active && deadline === null) deadline = performance.now() + 20_000;
    if (deadline !== null) assert.ok(performance.now() < deadline, 'Ready barrier timed out: ' + lastRead);
    if (active) {
      const remaining = () => {
        assert.ok(performance.now() < deadline, 'Ready barrier timed out');
        return Math.max(1, Math.min(1500, Math.floor(deadline - performance.now())));
      };
      const probe = await revocationDevice(['test', '-e', revocationReadyPath(runId)], remaining());
      // Only a clean shell-v2 false result means pending. Transport, run-as,
      // timeout, signal, output-limit and unexpected output fail immediately.
      const exists = revocationReadyExists(probe);
      lastRead = exists ? 'Exact ready file exists' : 'Exact ready file absent';
      if (exists) {
        const value = await revocationDevice(['base64', '-w', '0', revocationReadyPath(runId)], remaining());
        receipt.ready = assertRevocationReadyRead(value, runId); receipt.positiveReadyReads++;
        assert.equal(receipt.positiveReadyReads, 1);
        receipt.events.push('ready-consumed'); saveProof(); break;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assertRevocationMayCreate(lifecycle);
  receipt.beforeCreate = await revocationTree(); saveProof();
  assert.deepEqual(receipt.beforeCreate, preflight, 'Complete Admin state must be unchanged after ready and before lock');
  receipt.events.push('before-lock-readback'); saveProof();
  // A completed invocation cannot start a deferred write after the Admin read.
  assertRevocationMayCreate(lifecycle);
  assert.equal(receipt.createAttempts, 0); receipt.createAttempts++; saveProof();
  const reference = db.doc(REVOCATION_LOCK_PATH);
  const created = await reference.create(receipt.lock.data);
  state.created = true; state.writeTime = created.writeTime;
  receipt.lockWriteTime = normalize(created.writeTime);
  receipt.events.push('lock-create-succeeded'); saveProof();
  const observed = await reference.get(); assert.equal(observed.exists, true);
  assert.deepEqual(normalize(observed.data()), receipt.lock.data);
  receipt.lockObservedWriteTime = normalize(observed.updateTime); saveProof();
  assert.deepEqual(receipt.lockObservedWriteTime, receipt.lockWriteTime);
  receipt.afterCreate = await revocationTree(); saveProof();
  assert.deepEqual(receipt.afterCreate, expectedLockedSnapshot(preflight, runId));
  receipt.events.push('after-lock-readback'); saveProof();
}
async function finishRevocation(state, preflight) {
  const receipt = state.receipt;
  receipt.events.push('android-result-joined'); saveProof();
  async function attempt(label, work) {
    try { await work(); }
    catch (error) { receipt.errors.push({ stage: label, error: error.message }); saveProof(); }
  }
  // Attempt independent post-Android capture BEFORE cleanup even on Android FAIL.
  await attempt('locked-android-readback', async () => {
    receipt.lockedAndroidReadback = await revocationTree(); saveProof();
    assert.deepEqual(receipt.lockedAndroidReadback, state.created ? expectedLockedSnapshot(preflight, runId) : preflight);
    receipt.events.push('locked-android-readback'); saveProof();
  });
  if (state.created) await attempt('owned-lock-delete', async () => {
    const reference = db.doc(REVOCATION_LOCK_PATH); const current = await reference.get();
    assert.equal(current.exists, true); assert.deepEqual(normalize(current.data()), receipt.lock.data);
    receipt.deleteCheckedWriteTime = normalize(current.updateTime); saveProof();
    assert.deepEqual(receipt.deleteCheckedWriteTime, receipt.lockWriteTime);
    assert.equal(receipt.deleteAttempts, 0); receipt.deleteAttempts++; saveProof();
    await reference.delete({ lastUpdateTime: state.writeTime });
    receipt.events.push('owned-lock-delete-succeeded'); saveProof();
  });
  await attempt('restored-readback', async () => {
    receipt.afterDelete = await revocationTree(); saveProof();
    assert.deepEqual(receipt.afterDelete, preflight);
    receipt.events.push('restored-readback'); saveProof();
  });
}
function mutationIo() {
  const seedReference = db.doc(MUTATION_PATH); const lockReference = db.doc(MUTATION_LOCK_PATH);
  const timestamp = value => new Timestamp(value.seconds, value.nanoseconds);
  return {
    now: () => performance.now(), sleep: () => new Promise(resolve => setTimeout(resolve, 100)), save: saveProof,
    probeReady: timeout => revocationDevice(['test', '-e', mutationReadyPath(runId)], timeout),
    readReady: timeout => revocationDevice(['base64', '-w', '0', mutationReadyPath(runId)], timeout),
    snapshot: async () => ({ method: MUTATION.method, ...await databaseSnapshot(MUTATION), accounts: await accountsSnapshot() }),
    documents: async () => {
      const documents = await db.getAll(seedReference, lockReference);
      assert.equal(documents.length, 2);
      const value = document => document.exists
        ? { path: document.ref.path, exists: true, data: normalize(document.data()), writeTime: normalize(document.updateTime) }
        : { path: document.ref.path, exists: false };
      return { seed: value(documents[0]), lock: value(documents[1]) };
    },
    createLock: async data => normalize((await lockReference.create(data)).writeTime),
    mutateSeed: async seedTime => normalize((await seedReference.update({ confidence: 90 },
      { lastUpdateTime: timestamp(seedTime) })).writeTime),
    restoreAndDelete: async (seed, seedTime, lockTime) => {
      assert.equal(seed.path, MUTATION_PATH);
      const data = mutationFixture(runId, timestamp(seed.data.lastUpdatedAt)).data;
      assert.deepEqual(normalize(data), seed.data);
      const batch = db.batch();
      batch.update(seedReference, data, { lastUpdateTime: timestamp(seedTime) });
      batch.delete(lockReference, { lastUpdateTime: timestamp(lockTime) });
      return (await batch.commit()).map(result => normalize(result.writeTime));
    },
    deletePristineLock: async lockTime => lockReference.delete({ lastUpdateTime: timestamp(lockTime) }),
  };
}
async function android(method, preflight) {
  await noInstrumentation(); let output = '';
  const isRevocation = method === REVOCATION.method;
  const isMutation = method === MUTATION.method;
  if (isRevocation) await assertRevocationReadyAbsent();
  if (isMutation) await assertRevocationReadyAbsent(mutationReadyPath(runId));
  const state = isRevocation ? revocationState() : null;
  const mutation = isMutation ? createMutationState(runId) : null;
  const mutationAdapter = isMutation ? mutationIo() : null;
  if (mutation) { proof.mutations.push(mutation); saveProof(); }
  const lifecycle = { running: true, cancelled: false, output: '' };
  const execution = runChild(adb, ['-s', profile.serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', TEST_CLASS + '#' + method,
    '-e', 'domidexCollectionSessionProof', 'demo-loopback-only', '-e', 'domidexCollectionSessionRunId', runId,
    'com.dominik.cardvault.test/androidx.test.runner.AndroidJUnitRunner'], {
    cwd: directory, env, timeoutMs: 180_000,
    ...(isRevocation || isMutation ? { onStop: () => { lifecycle.cancelled = true; } } : {}),
    onOutput: chunk => {
      output += String(chunk); lifecycle.output = output;
      appendFileSync(path.join(directory, method + '.log'), chunk); process.stdout.write(chunk);
    } }).then(result => { lifecycle.running = false; return result; },
      error => { lifecycle.running = false; throw error; });
  // Catch immediately, then join: no unhandled or detached barrier promise.
  const barrier = state ? beginRevocation(state, preflight, lifecycle).catch(error => {
    state.receipt.errors.push({ stage: 'barrier', error: error.message }); saveProof();
  }) : null;
  const mutationBarrier = mutation ? beginMutation(mutation, preflight, lifecycle, mutationAdapter).catch(error => {
    mutation.errors.push({ stage: 'barrier', error: error.message }); saveProof();
  }) : null;
  let result;
  try { result = await execution; }
  finally {
    if (state) { await barrier; await finishRevocation(state, preflight); }
    if (mutation) { await mutationBarrier; await finishMutation(mutation, preflight, mutationAdapter); }
  }
  if (state) validateRevocationReceipt(state.receipt, runId, preflight, state.receipt.afterDelete);
  if (mutation) validateMutationReceipt(mutation, runId, preflight, mutation.afterRestore);
  if (result.code !== 0) throw Error('Android collection session failed: ' + method + ' (' + (result.stopped ?? result.error ?? result.code) + ')');
  return validateInstrumentation(output, method);
}
try {
  await noInstrumentation();
  assert.deepEqual(await accountsSnapshot(), [], 'Require fresh empty Auth emulator');
  assert.deepEqual(await databaseSnapshot(), { entries: [], collectionPaths: [], documentPaths: [] }, 'Require fresh empty Firestore emulator');
  const imported = await auth.importUsers(ACCOUNTS);
  assert.equal(imported.successCount, 19); assert.equal(imported.failureCount, 0); assert.deepEqual(imported.errors, []);
  assert.deepEqual(await accountsSnapshot(), ACCOUNTS);
  for (let index = 0; index < SCENARIOS.length; index++) {
    const scenario = SCENARIOS[index]; const { method } = scenario;
    await noInstrumentation();
    const currentSeeds = [];
    // Original healthy/stale remain genuine worker commits. Missing stays empty.
    // Late-parent Admin seeds ONLY an existing structural orphan + two binders;
    // its actual collection parent is created by the second nominal SDK client.
    // The three session-only scenarios get no server seeds and never run workers.
    // Their original pending mutations exist only inside the Android Room fixture.
    // Deferred point-read seeds a valid parent/binder/placement. Its Android
    // client may only read: all three seed documents remain fully unchanged.
    // Private offline retry starts remotely empty; only the genuine Android
    // worker may create its final binder after transport is enabled again.
    // Two-client private conflict also starts empty; Android workers alone create
    // initial revision1 and winner revision2. Host never seeds or changes that owner.
    // Knowledge-listener uses the normal create-only branch below: one complete
    // aggregate, with lastUpdatedAt supplied by the real emulator server clock.
    // Knowledge-malformed also gets exactly one create-only Admin seed. Its sole
    // schema violation is knowledgeVersion string "1"; Android's real listener
    // must decode/reject it. Admin preserves the exact malformed payload.
    if (scenario === SCENARIOS[17]) {
      // Bounded create-only fixture setup, not an SDK commit/ACK. Only this new
      // owner has 1001 seeds. Every complete payload is independently read back;
      // no existing scenario's seed or execution semantics are changed.
      const fixtures = seedFixtures(scenario, runId, FieldValue.serverTimestamp());
      for (let offset = 0; offset < fixtures.length; offset += 100) {
        const chunk = fixtures.slice(offset, offset + 100); const batch = db.batch();
        for (const fixture of chunk) batch.create(db.doc(fixture.path), fixture.data);
        await batch.commit();
        const documents = await db.getAll(...chunk.map(fixture => db.doc(fixture.path)));
        documents.sort((left, right) => left.ref.path < right.ref.path ? -1 : left.ref.path > right.ref.path ? 1 : 0);
        assert.deepEqual(documents.map(document => document.ref.path), chunk.map(fixture => fixture.path));
        for (const document of documents) {
          assert.equal(document.exists, true);
          const seed = { method, path: document.ref.path, data: normalize(document.data()) };
          currentSeeds.push(seed); proof.seeds.push(seed); assertSeed(seed, scenario, runId);
        }
        saveProof();
      }
    } else for (const fixture of seedFixtures(scenario, runId, FieldValue.serverTimestamp())) {
      const reference = db.doc(fixture.path);
      await reference.create(fixture.data);
      const document = await reference.get(); assert.equal(document.exists, true);
      const seed = { method, path: reference.path, data: normalize(document.data()) };
      currentSeeds.push(seed); proof.seeds.push(seed); saveProof(); assertSeed(seed, scenario, runId);
    }
    const preflight = { method, ...await databaseSnapshot(scenario), accounts: await accountsSnapshot() };
    proof.preflights.push(preflight); saveProof();
    // Full preflight rejects unexpected roots/access docs, earlier-owner changes,
    // and a prematurely existing late parent before any Android call can begin.
    validatePreflight(preflight, index, runId, proof.readbacks[index - 1], currentSeeds);
    try { proof.phases.push(await android(method, preflight)); }
    catch (error) { proof.errors.push({ method, error: error.message }); process.exitCode = 1; console.error(error); }
    // Always retain independent readback after a failed assertion too. A real remote
    // commit followed by a forbidden local ACK is RED, never a server-write success.
    try {
      const readback = { method, ...await databaseSnapshot(scenario), accounts: await accountsSnapshot() };
      proof.readbacks.push(readback); saveProof(); validateReadbacks(proof.readbacks, proof.seeds, runId, proof.preflights);
    } catch (error) { proof.readbackErrors.push({ method, error: error.message }); process.exitCode = 1; console.error(error); }
    saveProof(); await noInstrumentation(); // Never start another case while one may still be running.
  }
  assert.deepEqual(await accountsSnapshot(), ACCOUNTS); proof.accountUnchanged = true;
  assert.deepEqual(proof.errors, []); assert.deepEqual(proof.readbackErrors, []);
  proof.verified = true; validateServerProof(proof, runId);
} catch (error) { proof.verified = false; proof.error = error.message; process.exitCode = 1; console.error(error); }
finally {
  saveProof();
  try { await db.terminate(); }
  catch (error) { proof.verified = false; proof.errors.push({ method: 'admin-cleanup', error: error.message }); process.exitCode = 1; }
  try { await deleteApp(app); }
  catch (error) { proof.verified = false; proof.errors.push({ method: 'admin-cleanup', error: error.message }); process.exitCode = 1; }
  saveProof();
}
