import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT, TEST_CLASS, OTHER_OWNER, SCENARIOS } from './contract.mjs';
import { CONSUMER } from './consumer-access.mjs';
import { WORKFLOW } from './deletion-workflow.mjs';
import * as C from './legacy-lock.mjs';
const RUN = '123456781234423482341234567890ab', NOW = 1791201600000;
const SEED = { seconds: NOW / 1000 - 1, nanoseconds: 1 }, CREATED = { seconds: NOW / 1000, nanoseconds: 2 };
const clone = value => structuredClone(value), outcome = code => ({ code, signal: null, stopped: null, error: null });
function block(code, method = C.LEGACY.method) {
  return `INSTRUMENTATION_STATUS: class=${TEST_CLASS}\nINSTRUMENTATION_STATUS: test=${method}\n` +
    `INSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
}
const START = block(1), PASS = START + block(0) + 'OK (1 test)\nINSTRUMENTATION_CODE: -1\n';
function snapshot(data, accounts) {
  const documents = new Set(), collections = new Set();
  for (const row of data) { const parts = row.path.split('/'); for (let n = 2; n <= parts.length; n += 2) {
    documents.add(parts.slice(0, n).join('/')); collections.add(parts.slice(0, n - 1).join('/'));
  } }
  const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return { entries: data.map(row => ({ ...clone(row), writeTime: clone(row.writeTime ?? SEED) })),
    documentPaths: [...documents].sort(lexical), collectionPaths: [...collections].sort(lexical), accounts: clone(accounts), storage: C.emptySnapshot().storage };
}
function fixture() {
  const accounts = C.ACCOUNTS.map(a => ({ ...clone(a), metadata: { creationTime: new Date(NOW - 1000).toUTCString() },
    tokensValidAfterTime: new Date(NOW - 1000).toUTCString() }));
  const seed = snapshot(C.seedData(RUN, SEED), accounts);
  const create = snapshot([...seed.entries, ...C.legacyData(RUN, NOW).map(row => ({ ...row, writeTime: CREATED }))]
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), accounts);
  const disable = clone(create); disable.accounts.find(a => a.uid === C.LEGACY.owner).disabled = true;
  const revoke = clone(disable); revoke.accounts.find(a => a.uid === C.LEGACY.owner).tokensValidAfterTime = new Date(NOW).toUTCString();
  const step = (value, before, offset) => ({ attempts: 1, outcome: 'acknowledged', startedAt: NOW + offset,
    returnedAt: NOW + offset + 1, snapshot: value, before: clone(before), authorization: 'active-start', joinedAndroid: null });
  return { project: PROJECT, runId: RUN, verified: true, now: NOW, seed, beforeMutation: clone(seed), ready: C.readyText(RUN),
    accountsImported: true, seedAcknowledged: true, create: { ...step(create, seed, 1), writeTimes: [clone(CREATED), clone(CREATED)] },
    disable: step(disable, create, 3), revoke: step(revoke, disable, 5), afterAndroid: clone(revoke),
    android: { passed: 1, method: C.LEGACY.method, successEvidence: true }, errors: [], adminClosed: true,
    realDeletionWorkflowInvoked: false, cleanup: { before: clone(revoke), firestoreOutcome: 'acknowledged',
      deleteTimes: revoke.entries.map(() => ({ seconds: CREATED.seconds + 1, nanoseconds: 0 })),
      authDeleted: C.ACCOUNTS.map(a => a.uid), after: C.emptySnapshot() } };
}
const cleanupPending = proof => { proof.cleanup = { firestoreOutcome: 'not-started', authDeleted: [] }; return proof; };
function rejects(changes) { for (const change of changes) { const proof = fixture(); change(proof); assert.throws(() => C.validateLegacyProof(proof, RUN)); } }
await test('separate identity and canonical ready preserve original18 and both existing singletons', () => {
  assert.equal(SCENARIOS.length, 18); assert.ok(SCENARIOS.every(s => s.method !== C.LEGACY.method));
  assert.equal(new Set([C.LEGACY.owner, CONSUMER.owner, WORKFLOW.owner]).size, 3);
  assert.equal(C.jobId(RUN), '12345678-1234-4234-8234-1234567890ab');
  assert.equal(C.readyPath(RUN), `files/domidex-knowledge-legacy-lock-sdk-${RUN}/ready.txt`);
  assert.equal(C.readyText(RUN), `v1|${RUN}|${C.LEGACY.owner}|${C.LEGACY.method}|${'a'.repeat(64)}\n`);
});
await test('complete synthetic legacy fixture and acknowledged genuine Auth-shaped receipt validate', () => {
  const proof = fixture(); C.validateSeed(proof.seed, RUN); assert.equal(proof.seed.entries.length, 6);
  assert.equal(proof.revoke.snapshot.entries.length, 8); assert.equal(C.validateLegacyProof(proof, RUN).accessFenceAbsent, true);
  assert.equal(C.validateLegacyProof(proof, RUN).productionDeletionWorkflowProved, false);
});
await test('missing access is strict before readiness and unexpected disabled fence is rejected', () => {
  for (const target of ['seed', 'beforeMutation']) {
    const p = fixture(); p[target].entries.push({ path: C.ACCESS, data: { disabled: true }, writeTime: CREATED });
    assert.throws(() => C.validateBeforeMutation(p.beforeMutation, p.seed, RUN));
  }
  rejects(['create', 'disable', 'revoke'].map(name => p => p[name].snapshot.entries.push({ path: C.ACCESS, data: { disabled: true }, writeTime: CREATED })));
});
await test('Knowledge payload or even same-payload updateTime changes reject at every stage', () => {
  for (const name of ['create', 'disable', 'revoke']) rejects([
    p => { p[name].snapshot.entries.find(r => r.path === C.KNOWLEDGE).data.confidence--; },
    p => { p[name].snapshot.entries.find(r => r.path === C.KNOWLEDGE).writeTime.nanoseconds++; },
  ]);
});
await test('foreign account metadata and private data or updateTime cannot change', () => {
  rejects([p => { p.revoke.snapshot.accounts.find(a => a.uid === OTHER_OWNER).metadata.creationTime = 'changed'; },
    p => { p.disable.snapshot.entries.find(r => r.path === `users/${OTHER_OWNER}/preferences/proof`).data.value = 'changed'; },
    p => { p.create.snapshot.entries.find(r => r.path === `users/${C.LEGACY.owner}`).writeTime.nanoseconds++; }]);
});
await test('own login metadata may change only before readiness; never foreign metadata or creation', () => {
  const p = fixture(); p.beforeMutation.accounts.find(a => a.uid === C.LEGACY.owner).metadata.lastSignInTime = 'new login';
  C.validateBeforeMutation(p.beforeMutation, p.seed, RUN);
  p.beforeMutation.accounts.find(a => a.uid === OTHER_OWNER).metadata.lastSignInTime = 'foreign login';
  assert.throws(() => C.validateBeforeMutation(p.beforeMutation, p.seed, RUN));
  rejects([value => { value.beforeMutation.accounts.find(a => a.uid === C.LEGACY.owner).metadata.creationTime = 'changed'; }]);
});
await test('legacy job and lock require exact run ownership and STARTED payload', () => {
  rejects([p => { p.create.snapshot.entries.find(r => r.path === C.LOCK).data.jobId = C.jobId('2'.repeat(32)); },
    p => { p.create.snapshot.entries.find(r => r.path === C.jobPath(RUN)).data.uid = OTHER_OWNER; },
    p => { p.create.snapshot.entries.find(r => r.path === C.jobPath(RUN)).data.status = 'COMPLETE'; },
    p => { p.create.snapshot.entries.find(r => r.path === C.jobPath(RUN)).data.settleAfter--; }]);
});
await test('atomic create acknowledgments and unmodified job-lock writeTimes are mandatory', () => {
  rejects([p => { p.create.writeTimes.pop(); }, p => { p.create.writeTimes[1].nanoseconds++; },
    p => { p.disable.snapshot.entries.find(r => r.path === C.LOCK).writeTime.nanoseconds++; },
    p => { p.revoke.snapshot.entries.find(r => r.path === C.jobPath(RUN)).writeTime.nanoseconds++; }]);
});
await test('each mutation is acknowledged once in order, unknown outcome cannot clean or pass', () => {
  for (const name of ['create', 'disable', 'revoke']) {
    rejects([p => { p[name].outcome = 'unknown'; }, p => { p[name].attempts = 2; }, p => { p[name].snapshot = null; }]);
    const p = cleanupPending(fixture()); p[name].outcome = 'unknown';
    assert.throws(() => C.assertCleanupOwned(p, p.revoke.snapshot, RUN));
  }
  rejects([p => { p.disable.startedAt = p.create.startedAt - 1; }, p => { p.revoke.returnedAt = p.revoke.startedAt - 1; }]);
});
await test('Auth disabled and fresh server revocation time are distinct mandatory evidence', () => {
  rejects([p => { p.disable.snapshot.accounts.find(a => a.uid === C.LEGACY.owner).disabled = false; },
    p => { p.revoke.snapshot.accounts.find(a => a.uid === C.LEGACY.owner).tokensValidAfterTime = new Date(NOW - 1000).toUTCString(); },
    p => { p.revoke.snapshot.accounts.find(a => a.uid === C.LEGACY.owner).tokensValidAfterTime = new Date(NOW + 1000).toUTCString(); },
    p => { p.revoke.snapshot.accounts.find(a => a.uid === C.LEGACY.owner).customClaims.admin = true; }]);
});
await test('strict singleton accepts preserved result diagnostics but never an old method failure or skip', () => {
  assert.equal(C.validateLegacyInstrumentation(PASS.replace('INSTRUMENTATION_CODE', 'INSTRUMENTATION_RESULT: legacyG9Snapshot={"synthetic":true}\nINSTRUMENTATION_CODE')).passed, 1);
  for (const text of [PASS.replaceAll(C.LEGACY.method, WORKFLOW.method), PASS.replaceAll(C.LEGACY.method, CONSUMER.method),
    PASS.replace('STATUS_CODE: 0', 'STATUS_CODE: -2'), PASS.replace('STATUS_CODE: 0', 'STATUS_CODE: -3'),
    PASS.replace('OK (1 test)', 'OK (2 tests)'), PASS + block(0), PASS + 'INSTRUMENTATION_FAILED: crash\n'])
    assert.throws(() => C.validateLegacyInstrumentation(text));
});
await test('live-start guard rejects cancellation terminal and wrong test before every new write', () => {
  C.assertActive({ output: START, running: true, cancelled: false });
  for (const state of [{ output: PASS, running: true, cancelled: false }, { output: START, running: false, cancelled: false },
    { output: START, running: true, cancelled: true }, { output: block(1, WORKFLOW.method), running: true, cancelled: false }])
    assert.throws(() => C.assertActive(state));
});
await test('only exact joined PASS permits later Auth writes, never first create or partial terminal', () => {
  assert.equal(C.assertMayContinue({ output: START, running: true, cancelled: false }), 'active-start');
  assert.equal(C.assertMayContinue({ output: PASS, running: false, cancelled: false, result: outcome(0) }), 'joined-pass');
  for (const state of [{ output: PASS, running: true, cancelled: false, result: outcome(0) },
    { output: PASS, running: false, cancelled: true, result: outcome(0) },
    { output: PASS, running: false, cancelled: false },
    { output: PASS, running: false, cancelled: false, result: outcome(1) },
    { output: PASS, running: false, cancelled: false, result: { ...outcome(0), stopped: 'timeout' } },
    { output: START, running: false, cancelled: false, result: outcome(0) },
    { output: PASS.replace('STATUS_CODE: 0', 'STATUS_CODE: -2'), running: false, cancelled: false, result: outcome(0) },
    { output: PASS.replaceAll(C.LEGACY.method, WORKFLOW.method), running: false, cancelled: false, result: outcome(0) }])
    assert.throws(() => C.assertMayContinue(state));
  const p = fixture(); for (const name of ['disable', 'revoke']) {
    p[name].authorization = 'joined-pass'; p[name].joinedAndroid = clone(p.android);
  }
  assert.deepEqual(C.validateLegacyProof(p, RUN).authWritesAfterAndroidJoin, { disable: true, revoke: true });
  p.create.authorization = 'joined-pass'; p.create.joinedAndroid = clone(p.android);
  assert.throws(() => C.validateLegacyProof(p, RUN));
});
await test('joined PASS never bypasses fresh owned inventories or full continuation receipt', () => {
  rejects([p => { p.disable.before.entries[0].writeTime.nanoseconds++; },
    p => { p.revoke.before.accounts.find(a => a.uid === OTHER_OWNER).metadata.creationTime = 'foreign'; },
    p => { p.disable.authorization = 'joined-pass'; },
    p => { p.revoke.authorization = 'joined-pass'; p.revoke.joinedAndroid = { passed: 1, method: WORKFLOW.method, successEvidence: true }; }]);
});
await test('canonical readiness rejects wrong run CRLF remote failure and late probe or read', async () => {
  const invoke = async ({ text = C.readyText(RUN), code = 0, late = null } = {}) => {
    let clock = 0;
    return C.awaitReady(RUN, { output: START, running: true, cancelled: false }, { now: () => clock,
      sleep: async () => { throw Error('Unexpected poll'); }, probeReady: async () => {
        if (late === 'probe') clock = 20_000; return { output: '', result: outcome(0) }; },
      readReady: async () => { if (late === 'read') clock = 20_001;
        return { output: Buffer.from(text).toString('base64'), result: outcome(code) }; } });
  };
  await invoke();
  for (const options of [{ text: C.readyText('2'.repeat(32)) }, { text: C.readyText(RUN).replace('\n', '\r\n') },
    { code: 1 }, { late: 'probe' }, { late: 'read' }]) await assert.rejects(invoke(options));
});
await test('cleaning acknowledged partial fixture after joined RED never changes its outcome to PASS', () => {
  const p = cleanupPending(fixture()); p.verified = false;
  p.revoke = { attempts: 0, outcome: 'not-started', snapshot: null };
  C.assertCleanupOwned(p, p.disable.snapshot, RUN); assert.throws(() => C.validateLegacyProof(p, RUN));
  p.disable = { attempts: 0, outcome: 'not-started', snapshot: null };
  C.assertCleanupOwned(p, p.create.snapshot, RUN);
  p.create = { attempts: 0, outcome: 'not-started', snapshot: null }; C.assertCleanupOwned(p, p.beforeMutation, RUN);
});
await test('changed same-payload state does not grant cleanup; unknown cleanup is never retried', () => {
  const p = cleanupPending(fixture()); C.assertCleanupOwned(p, p.revoke.snapshot, RUN);
  const changed = clone(p.revoke.snapshot); changed.entries[0].writeTime.nanoseconds++;
  assert.throws(() => C.assertCleanupOwned(p, changed, RUN));
  p.cleanup.firestoreOutcome = 'unknown'; assert.throws(() => C.assertCleanupOwned(p, p.revoke.snapshot, RUN));
});
await test('complete proof requires all post-Android cleanup targets and timestamps plus closed resources', () => {
  rejects([p => { p.verified = false; }, p => { p.android.passed = 0; }, p => { p.adminClosed = false; },
    p => { p.errors.push({ stage: 'android', error: 'timeout' }); }, p => { p.accountsImported = false; },
    p => { p.seedAcknowledged = false; }, p => { p.realDeletionWorkflowInvoked = true; },
    p => { p.afterAndroid.entries[0].writeTime.nanoseconds++; }, p => { p.cleanup.before.accounts[0].disabled = false; },
    p => { p.cleanup.deleteTimes.pop(); }, p => { p.cleanup.deleteTimes[0].nanoseconds++; },
    p => { p.cleanup.deleteTimes = p.cleanup.deleteTimes.map(() => clone(CREATED)); },
    p => { p.cleanup.authDeleted.pop(); }, p => { p.cleanup.after.storage.current.push('unowned'); }]);
});
await test('unknown document trees storage or accounts fail the bounded inventory', () => {
  rejects([p => { p.seed.collectionPaths.push('unknown'); }, p => { p.seed.documentPaths.pop(); },
    p => { p.create.snapshot.storage.versions.push('unexpected'); }, p => { p.revoke.snapshot.accounts.reverse(); }]);
});
await test('canonical full Auth JSON drops only undefined fields, retaining all populated metadata', () => {
  const value = clone(C.ACCOUNTS[0]); value.providerData[0].displayName = undefined; value.metadata = { creationTime: 'kept' };
  assert.deepEqual(C.canonicalAccount(value), { ...clone(C.ACCOUNTS[0]), metadata: { creationTime: 'kept' } });
  assert.equal(Object.hasOwn(value.providerData[0], 'displayName'), true);
});
