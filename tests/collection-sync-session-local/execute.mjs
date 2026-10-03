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
const { PROJECT, SERIAL, TEST_CLASS, SCENARIOS, ACCOUNTS, validRunId, normalize, validateInstrumentation,
  assertNoInstrumentation, seedFixtures, assertSeed, validatePreflight, validateReadbacks,
  FULL_BUDGET_PARENT, FULL_BUDGET_COLLECTION, FULL_BUDGET_PATHS, isFullBudgetInventoryPath,
  KNOWLEDGE_PATH, KNOWLEDGE_MISSING_PATH, assertKnowledgeInventoryPath,
  validateServerProof } = await import(pathToFileURL(path.join(root, 'tests/collection-sync-session-local/contract.mjs')));
const env = { ...process.env }; delete env.FIREBASE_CONFIG;
assertTestEnvironment(env); delete process.env.FIREBASE_CONFIG;
const runId = validRunId(env.DOMIDEX_COLLECTION_SESSION_RUN_ID);
const require = createRequire(path.join(root, 'package.json'));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth'); const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, `collection-session-admin-${runId}`);
const db = getFirestore(app); const auth = getAuth(app);
const proof = { project: PROJECT, runId, verified: false, phases: [], seeds: [], preflights: [], readbacks: [], accountUnchanged: false, errors: [], readbackErrors: [] };
function saveProof() { writeFileSync(path.join(directory, 'server-proof.json'), JSON.stringify(proof, null, 2)); }
async function noInstrumentation() {
  let output = '';
  const result = await runChild(adb, ['-s', SERIAL, 'shell', 'dumpsys', 'activity', 'processes'], {
    cwd: directory, env, timeoutMs: 15_000, onOutput: chunk => { output += String(chunk); } });
  assert.equal(result.code, 0); assertNoInstrumentation(output);
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
      assert.ok(scenario === SCENARIOS[13] || scenario === SCENARIOS[14], 'No knowledge inventory before its own case');
      assert.equal(collection.path, 'scanKnowledge', 'No knowledge child collections');
    }
    if (collection.path.startsWith(`${FULL_BUDGET_PARENT}/`)) {
      assert.equal(scenario, SCENARIOS[14], 'No paging-owner inventory before its own case');
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
  if (scenario === SCENARIOS[14]) assert.deepEqual([...largeReferences].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    [FULL_BUDGET_PARENT, ...FULL_BUDGET_PATHS].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    'Only the complete fixed paging-owner inventory may exceed the ordinary reference bound');
  if (scenario === SCENARIOS[13] || scenario === SCENARIOS[14]) {
    assert.ok(documentPaths.includes(KNOWLEDGE_PATH), 'Require the exact knowledge seed in the complete inventory');
    assert.equal((await db.doc(KNOWLEDGE_MISSING_PATH).get()).exists, false, 'The second knowledge fingerprint must remain absent');
  }
  return { entries: entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    collectionPaths: collectionPaths.sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    documentPaths: documentPaths.sort((left, right) => left < right ? -1 : left > right ? 1 : 0) };
}
async function android(method) {
  await noInstrumentation(); let output = '';
  const result = await runChild(adb, ['-s', SERIAL, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', `${TEST_CLASS}#${method}`,
    '-e', 'domidexCollectionSessionProof', 'demo-loopback-only', '-e', 'domidexCollectionSessionRunId', runId,
    'com.dominik.cardvault.test/androidx.test.runner.AndroidJUnitRunner'], {
    cwd: directory, env, timeoutMs: 180_000, onOutput: chunk => {
      output += String(chunk); appendFileSync(path.join(directory, `${method}.log`), chunk); process.stdout.write(chunk);
    } });
  if (result.code !== 0) throw Error(`Android collection session failed: ${method} (${result.stopped ?? result.error ?? result.code})`);
  return validateInstrumentation(output, method);
}
try {
  await noInstrumentation();
  assert.deepEqual(await accountsSnapshot(), [], 'Require fresh empty Auth emulator');
  assert.deepEqual(await databaseSnapshot(), { entries: [], collectionPaths: [], documentPaths: [] }, 'Require fresh empty Firestore emulator');
  const imported = await auth.importUsers(ACCOUNTS);
  assert.equal(imported.successCount, 16); assert.equal(imported.failureCount, 0); assert.deepEqual(imported.errors, []);
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
    if (scenario === SCENARIOS[14]) {
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
    try { proof.phases.push(await android(method)); }
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
