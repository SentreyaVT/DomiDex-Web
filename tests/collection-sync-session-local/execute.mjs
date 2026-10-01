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
  assertNoInstrumentation, entryPath, entryFixture, assertEntry, validateReadbacks,
  validateServerProof } = await import(pathToFileURL(path.join(root, 'tests/collection-sync-session-local/contract.mjs')));
const env = { ...process.env }; delete env.FIREBASE_CONFIG;
assertTestEnvironment(env); delete process.env.FIREBASE_CONFIG;
const runId = validRunId(env.DOMIDEX_COLLECTION_SESSION_RUN_ID);
const require = createRequire(path.join(root, 'package.json'));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth'); const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, `collection-session-admin-${runId}`);
const db = getFirestore(app); const auth = getAuth(app);
const proof = { project: PROJECT, runId, verified: false, phases: [], seeds: [], readbacks: [], accountUnchanged: false, errors: [], readbackErrors: [] };
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
  })).sort((left, right) => left.uid.localeCompare(right.uid));
}
// Enumerate this fresh demo DB, including missing parent references. Bounded traversal
// detects extra owners, root/access documents and sidecars rather than silently omitting them.
async function databaseSnapshot() {
  const entries = []; const collectionPaths = []; const documentPaths = [];
  async function visit(collection, depth) {
    assert.ok(depth <= 4 && collectionPaths.length < 16, 'Unexpected emulator collection tree');
    collectionPaths.push(collection.path);
    for (const reference of await collection.listDocuments()) {
      assert.ok(documentPaths.length < 32, 'Unexpected emulator document count'); documentPaths.push(reference.path);
      const document = await reference.get();
      if (document.exists) entries.push({ path: reference.path, data: normalize(document.data()) });
      for (const child of await reference.listCollections()) await visit(child, depth + 1);
    }
  }
  for (const collection of await db.listCollections()) await visit(collection, 0);
  return { entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
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
  assert.equal(imported.successCount, 6); assert.equal(imported.failureCount, 0); assert.deepEqual(imported.errors, []);
  assert.deepEqual(await accountsSnapshot(), ACCOUNTS);
  for (let index = 0; index < SCENARIOS.length; index++) {
    const scenario = SCENARIOS[index]; const { method } = scenario;
    if (scenario.key === 'malformed' || scenario.key === 'confirmed') {
      // Only these resumed-checkpoint fixtures are seeded. Healthy/stale remain
      // genuine Android-created commits; missing must remain absent throughout.
      await noInstrumentation();
      const reference = db.doc(entryPath(scenario));
      await reference.create(entryFixture(scenario, runId, FieldValue.serverTimestamp()));
      const document = await reference.get(); assert.equal(document.exists, true);
      const seed = { method, path: reference.path, data: normalize(document.data()) };
      proof.seeds.push(seed); saveProof(); assertEntry(seed.data, scenario, runId);
    }
    try { proof.phases.push(await android(method)); }
    catch (error) { proof.errors.push({ method, error: error.message }); process.exitCode = 1; console.error(error); }
    // Always retain independent readback after a failed assertion too. A real remote
    // commit followed by a forbidden local ACK is RED, never a server-write success.
    try {
      const readback = { method, ...await databaseSnapshot(), accounts: await accountsSnapshot() };
      proof.readbacks.push(readback); saveProof(); validateReadbacks(proof.readbacks, proof.seeds, runId);
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
