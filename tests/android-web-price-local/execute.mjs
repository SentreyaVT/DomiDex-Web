// Copied unchanged into a fresh isolated output directory. No env file is loaded.
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = process.env.DOMIDEX_PRIVATE_TEST_ROOT;
const directory = process.env.DOMIDEX_PRIVATE_TEST_RUN;
const adb = process.env.DOMIDEX_PRICE_ADB;
if (!root || !directory || path.resolve(directory) !== process.cwd() || !adb || !path.isAbsolute(adb)) throw Error('Isolated driver context required');
const { assertTestEnvironment, runChild, readJson, requireFile } = await import(pathToFileURL(path.join(root, 'tests/private-operations-local/safety.mjs')));
const { PROJECT, SERIAL, OWNER, EMAIL, GOOGLE_UID, PARENT_PATH, CHOICE_PATH, TEST_CLASS, ANDROID_PHASES, CLEANUP,
  validRunId, parentFixture, normalize, assertChoice, validateInstrumentation, validateWebResults, assertNoInstrumentation, validateServerProof } =
  await import(pathToFileURL(path.join(root, 'tests/android-web-price-local/contract.mjs')));
const env = { ...process.env }; delete env.FIREBASE_CONFIG;
assertTestEnvironment(env); delete process.env.FIREBASE_CONFIG;
const runId = validRunId(env.DOMIDEX_PRICE_RUN_ID);
const require = createRequire(path.join(root, 'package.json'));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, `price-admin-${runId}`);
const db = getFirestore(app); const auth = getAuth(app);
const parent = parentFixture(new Timestamp(1700000000, 0));
const proof = { project: PROJECT, runId, verified: false, parent: normalize(parent), phases: [], readbacks: [], accountUnchanged: false };
const cleanup = { project: PROJECT, runId, attempted: false, completed: false, successEvidence: false, error: null };

function saveProof() { writeFileSync(path.join(directory, 'server-proof.json'), JSON.stringify(proof, null, 2)); }
async function adbOutput(args, timeoutMs = 15_000) {
  let output = '';
  const result = await runChild(adb, ['-s', SERIAL, ...args], { cwd: directory, env, timeoutMs,
    onOutput: chunk => { output += String(chunk); } });
  if (result.code !== 0) throw Error(`Emulator command failed: ${args[0]} (${result.stopped ?? result.error ?? result.code})`);
  return output;
}
async function noInstrumentation() { assertNoInstrumentation(await adbOutput(['shell', 'dumpsys', 'activity', 'processes'])); }
async function android(method) {
  await noInstrumentation();
  let output = '';
  const result = await runChild(adb, ['-s', SERIAL, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', `${TEST_CLASS}#${method}`,
    '-e', 'domidexAndroidWebPriceProof', 'demo-loopback-only', '-e', 'domidexPriceRunId', runId,
    'com.dominik.cardvault.test/androidx.test.runner.AndroidJUnitRunner'],
  { cwd: directory, env, timeoutMs: method === CLEANUP ? 60_000 : 180_000, onOutput: chunk => {
    output += String(chunk); appendFileSync(path.join(directory, `${method}.log`), chunk); process.stdout.write(chunk);
  } });
  if (result.code !== 0) throw Error(`Android phase failed: ${method} (${result.stopped ?? result.error ?? result.code})`);
  const validation = validateInstrumentation(output, method);
  await noInstrumentation();
  return validation;
}
async function assertAccount() {
  const accounts = await auth.listUsers(); assert.equal(accounts.users.length, 1); assert.equal(accounts.pageToken, undefined);
  const user = accounts.users[0]; assert.equal(user.uid, OWNER); assert.equal(user.email, EMAIL);
  assert.equal(user.emailVerified, true); assert.equal(user.disabled, false);
  assert.deepEqual(user.customClaims, { appAccess: true });
  assert.deepEqual(user.providerData.map(({ providerId, uid, email }) => ({ providerId, uid, email })),
    [{ providerId: 'google.com', uid: GOOGLE_UID, email: EMAIL }]);
}
async function readback(label, revision) {
  const actualParent = (await db.doc(PARENT_PATH).get()).data(); assert.deepEqual(actualParent, parent, 'Parent must remain exactly unchanged');
  const choice = assertChoice((await db.doc(CHOICE_PATH).get()).data(), revision);
  const sidecars = await db.collection(`users/${OWNER}/collectionPriceSelections`).get();
  assert.deepEqual(sidecars.docs.map(document => document.id), ['entry']);
  assert.equal((await db.doc(`accountAccess/${OWNER}`).get()).exists, false, 'No access override may be invented');
  await assertAccount();
  proof.readbacks.push({ label, choice }); saveProof(); return choice;
}
async function web(phase, expectedChoice) {
  const resultFile = path.join(directory, `web-${phase}-results.json`);
  const result = await runChild(process.execPath, [requireFile(path.join(root, 'node_modules/vitest/vitest.mjs')), 'run',
    '--config', requireFile(path.join(root, 'tests/android-web-price-local/config.mjs')),
    '--reporter=default', '--reporter=json', '--outputFile', resultFile],
  { cwd: root, env: { ...env, DOMIDEX_PRICE_WEB_PHASE: phase }, timeoutMs: 90_000, onOutput: chunk => {
    appendFileSync(path.join(directory, `web-${phase}.log`), chunk); process.stdout.write(chunk);
  } });
  if (result.code !== 0) throw Error(`Actual Web ${phase} failed (${result.stopped ?? result.error ?? result.code})`);
  proof.phases.push(validateWebResults(readJson(resultFile), phase));
  const evidence = readJson(path.join(directory, `web-${phase}-proof.json`));
  assert.equal(evidence.project, PROJECT); assert.equal(evidence.runId, runId); assert.equal(evidence.phase, phase);
  assert.equal(evidence.verified, true); assert.equal(evidence.actualProductFunctions, true);
  assert.equal(evidence.rpcMocked, false); assert.equal(evidence.defaultAppInitialized, false);
  assert.deepEqual(evidence.before, expectedChoice); assert.deepEqual(evidence.parent, normalize(parent));
  const revision = phase === 'save' ? 2 : 3;
  assert.deepEqual(evidence.subscribedRevisions, [revision - 1, revision]);
  const actual = await readback(`web-${phase}`, revision);
  assert.deepEqual(evidence.choice, actual, 'Web-confirmed and independent Admin readback must match every field');
  assert.notEqual(actual.lastMutationId, expectedChoice.lastMutationId);
  return actual;
}

try {
  await noInstrumentation();
  const initialUsers = await auth.listUsers(); assert.equal(initialUsers.users.length, 0); assert.equal(initialUsers.pageToken, undefined);
  assert.equal((await db.listCollections()).length, 0, 'Require newly started empty Firestore emulator');
  const imported = await auth.importUsers([{ uid: OWNER, email: EMAIL, emailVerified: true, disabled: false,
    providerData: [{ providerId: 'google.com', uid: GOOGLE_UID, email: EMAIL }], customClaims: { appAccess: true } }]);
  assert.equal(imported.successCount, 1); assert.equal(imported.failureCount, 0); assert.deepEqual(imported.errors, []);
  await assertAccount(); await db.doc(PARENT_PATH).set(parent);
  assert.deepEqual((await db.doc(PARENT_PATH).get()).data(), parent);
  assert.equal((await db.doc(CHOICE_PATH).get()).exists, false);
  proof.phases.push(await android(ANDROID_PHASES[0]));
  const first = await readback('android-create-ack', 1);
  const second = await web('save', first);
  proof.phases.push(await android(ANDROID_PHASES[1]));
  assert.deepEqual(await readback('android-pull-save', 2), second, 'Android pull must not rewrite Web selection');
  const third = await web('clear', second);
  proof.phases.push(await android(ANDROID_PHASES[2]));
  assert.deepEqual(await readback('android-pull-clear', 3), third, 'Android pull must not rewrite Web clear');
  await assertAccount(); proof.accountUnchanged = true; proof.verified = true; validateServerProof(proof, runId);
} catch (error) {
  proof.error = error.message; process.exitCode = 1; console.error(error);
} finally {
  saveProof();
  try {
    // Do NOT force-stop by package. If a timed-out instrumentation is still alive,
    // another phase could race its Room writes: refuse cleanup and report it.
    await noInstrumentation(); cleanup.attempted = true;
    await android(CLEANUP); cleanup.completed = true;
  } catch (error) { cleanup.error = error.message; process.exitCode = 1; }
  writeFileSync(path.join(directory, 'cleanup-proof.json'), JSON.stringify(cleanup, null, 2));
  try { await db.terminate(); } finally { await deleteApp(app); }
}
