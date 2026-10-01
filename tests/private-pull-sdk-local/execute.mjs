import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = process.env.DOMIDEX_PRIVATE_TEST_ROOT;
const directory = process.env.DOMIDEX_PRIVATE_TEST_RUN;
const adb = process.env.DOMIDEX_SDK_PROOF_ADB;
if (!root || !directory || path.resolve(directory) !== process.cwd() || !adb || !path.isAbsolute(adb)) throw Error('Isolated SDK proof context required.');
const { PROJECT, assertTestEnvironment, runChild } = await import(pathToFileURL(path.join(root, 'tests/private-operations-local/safety.mjs')));
const { SERIAL, TEST_CLASS, validateInstrumentation } = await import(pathToFileURL(path.join(root, 'tests/private-pull-sdk-local/run.mjs')));
const env = { ...process.env }; delete env.FIREBASE_CONFIG;
assertTestEnvironment(env);
// Admin SDK reads process.env when constructed; remove the CLI-only generated
// config after validating the explicit demo hosts and fixed project.
delete process.env.FIREBASE_CONFIG;
if (PROJECT !== 'demo-domidex-privacy') throw Error('Unexpected demo project.');
const require = createRequire(path.join(root, 'package.json'));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, 'private-pull-sdk-control');
const db = getFirestore(app); const auth = getAuth(app);
const owners = ['sdk-proof-commit', 'sdk-proof-write-ack', 'sdk-proof-write-reject'];
// Persisted Firestore timestamps have microsecond precision; keep nonzero nanos
// without relying on unpersistable sub-microsecond fixture values.
const timestamps = { a: new Timestamp(1700000000, 1000), b: new Timestamp(1700000001, 2000) };
const seed = (uid, id) => ({ binderId: id, ownerUid: uid, name: `SDK proof ${id.toUpperCase()}`,
  description: null, coverStyle: 'default', minimumPageCount: 1, createdAtClient: 1, updatedAtClient: 1,
  lastOpenedAtClient: null, deleted: false, revision: 1, lastMutationId: 'sdk-proof-seed', updatedAt: timestamps[id] });
try {
  assert.equal((await auth.listUsers()).users.length, 0, 'Require newly started empty Auth emulator');
  assert.equal((await db.listCollections()).length, 0, 'Require newly started empty Firestore emulator');
  for (const uid of owners) {
    await auth.createUser({ uid, email: `${uid}@example.invalid`, password: 'Demo-only-private-pull-proof-2026' });
    await auth.setCustomUserClaims(uid, { appAccess: true });
    for (const id of ['a', 'b']) {
      const reference = db.doc(`users/${uid}/privateBinders/${id}`);
      await reference.set(seed(uid, id));
      assert.deepEqual((await reference.get()).data(), seed(uid, id), 'Persisted fixture must match before Android starts');
    }
  }
  let output = '';
  const result = await runChild(adb, ['-s', SERIAL, 'shell', 'am', 'instrument', '-w', '-r',
    '-e', 'class', TEST_CLASS, '-e', 'domidexPrivatePullSdkProof', 'demo-loopback-only',
    'com.dominik.cardvault.test/androidx.test.runner.AndroidJUnitRunner'],
  { cwd: directory, env, timeoutMs: 240_000, onOutput: chunk => {
    output += String(chunk); appendFileSync(path.join(directory, 'instrumentation.log'), chunk); process.stdout.write(chunk);
  } });
  if (result.code !== 0) throw Error('Android SDK instrumentation process failed.');
  validateInstrumentation(output);
  const proof = [];
  for (const uid of owners) {
    const a = (await db.doc(`users/${uid}/privateBinders/a`).get()).data();
    const b = (await db.doc(`users/${uid}/privateBinders/b`).get()).data();
    assert.deepEqual(b, seed(uid, 'b'), 'Control document must remain byte-field equivalent');
    if (uid === 'sdk-proof-write-reject') assert.deepEqual(a, seed(uid, 'a'), 'Denied mutation must not change server state');
    else {
      assert.equal(a.revision, 2); assert.equal(a.name, 'Controlled pending change');
      assert.equal(a.ownerUid, uid); assert.equal(a.lastMutationId, 'sdk-proof-mutation');
      assert.ok(a.updatedAt instanceof Timestamp && a.updatedAt.seconds > timestamps.b.seconds);
      assert.deepEqual({ ...a, revision: 1, name: `SDK proof A`, lastMutationId: 'sdk-proof-seed', updatedAt: timestamps.a }, seed(uid, 'a'));
    }
    proof.push({ owner: uid, revision: a.revision, updatedAt: { seconds: a.updatedAt.seconds, nanoseconds: a.updatedAt.nanoseconds } });
  }
  writeFileSync(path.join(directory, 'server-proof.json'), JSON.stringify({ project: PROJECT, verified: true, proof }, null, 2));
} finally { await db.terminate(); await deleteApp(app); }
