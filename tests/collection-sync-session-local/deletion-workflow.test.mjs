import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT, SCENARIOS, TEST_CLASS, OTHER_OWNER } from './contract.mjs';
import { CONSUMER } from './consumer-access.mjs';
import * as C from './deletion-workflow.mjs';
const RUN = '1'.repeat(32), NOW = 1791201600000, JOB = '11111111-2222-4333-8444-555555555555';
const STAMP = { seconds: 1791201600, nanoseconds: 1 }, WRITE = { seconds: 1791201601, nanoseconds: 2 };
const copy = value => structuredClone(value);
const result = code => ({ code, signal: null, stopped: null, error: null });
function block(code, method = C.WORKFLOW.method) {
  return `INSTRUMENTATION_STATUS: class=${TEST_CLASS}\nINSTRUMENTATION_STATUS: test=${method}\n` +
    `INSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
}
const START = block(1), PASS = START + block(0) + 'OK (1 test)\nINSTRUMENTATION_CODE: -1\n';
function snapshot(data, accounts) {
  const refs = new Set(), collections = new Set();
  data.forEach(row => { const parts = row.path.split('/'); for (let n = 2; n <= parts.length; n += 2) {
    refs.add(parts.slice(0, n).join('/')); collections.add(parts.slice(0, n - 1).join('/'));
  } });
  return { entries: data.map(row => ({ ...copy(row), writeTime: copy(WRITE) })), accounts: copy(accounts),
    documentPaths: [...refs].sort((a, b) => a < b ? -1 : a > b ? 1 : 0), collectionPaths: [...collections].sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
    storage: { current: [], versions: [], requestedSoftDeleted: [] } };
}
function fixture() {
  const seed = snapshot(C.seedData(RUN, STAMP), C.ACCOUNTS.map(a => ({ ...a,
    metadata: { creationTime: 'Sun, 04 Oct 2026 12:00:00 GMT' }, tokensValidAfterTime: 'Sun, 04 Oct 2026 12:00:00 GMT' })));
  const accounts = copy(seed.accounts); accounts.find(a => a.uid === C.WORKFLOW.owner).disabled = true;
  const pending = snapshot(C.pendingData(seed, RUN, NOW, JOB), accounts);
  const retry = copy(pending); retry.entries.find(row => row.path === 'accountDeletionJobs/' + JOB).writeTime.nanoseconds++;
  const proof = { accountsImported: true, seedAcknowledged: true, requestAttempts: 1, retryAttempts: 1,
    requestOutcome: 'acknowledged', retryOutcome: 'acknowledged', beforeRequest: seed, now: NOW, jobId: JOB,
    pending, retried: retry, cleanup: { firestoreOutcome: 'not-started', authDeleted: [] } };
  return { seed, pending, retry, proof };
}
function completeProof() {
  const { seed, pending, retry, proof } = fixture();
  return { ...proof, project: PROJECT, runId: RUN, verified: true, errors: [], adminClosed: true, seed,
    tokenProof: { uid: C.WORKFLOW.owner, provider: 'google.com', authTime: NOW - 1000, verified: true },
    ready: C.readyText(RUN), androidJoinedBeforeRetry: true, requestStatus: 202,
    requestStartedAt: NOW + 1, requestReturnedAt: NOW + 2, retryStartedAt: NOW + 3, retryReturnedAt: NOW + 4,
    firstResponse: { jobId: JOB, status: 'PENDING_SESSION_EXPIRY', nextActionAt: NOW + 65 * 60_000 },
    retryResponse: { jobId: JOB, status: 'PENDING_SESSION_EXPIRY', nextActionAt: NOW + 65 * 60_000 },
    pending, retried: retry, android: { passed: 1, method: C.WORKFLOW.method, successEvidence: true },
    cleanup: { before: copy(retry), firestoreOutcome: 'acknowledged', authDeleted: C.ACCOUNTS.map(a => a.uid),
      deleteTimes: retry.entries.map(() => ({ seconds: WRITE.seconds + 1, nanoseconds: 0 })),
      after: { entries: [], documentPaths: [], collectionPaths: [], accounts: [],
        storage: { current: [], versions: [], requestedSoftDeleted: [] } } }, realFinalDeletionAttempted: false };
}
await test('new singleton leaves original eighteen and old consumer identity distinct', () => {
  assert.equal(SCENARIOS.length, 18); assert.ok(SCENARIOS.every(row => row.method !== C.WORKFLOW.method));
  assert.notEqual(CONSUMER.method, C.WORKFLOW.method); assert.notEqual(CONSUMER.owner, C.WORKFLOW.owner);
  assert.match(C.readyPath(RUN), /^files\/domidex-knowledge-deletion-workflow-sdk-[1-9a-f0-9]{32}\/ready.txt$/);
});
await test('exact complete seed and pending retry preserve foreign/public updates', () => {
  const { seed, pending, retry } = fixture(); C.validateSeed(seed, RUN); C.validatePending(pending, seed, RUN, NOW, JOB);
  C.validateRetry(pending, retry, seed, RUN, NOW, JOB);
  assert.equal(pending.entries.length, 14); assert.equal(C.ownedInventoryPaths().length, 7);
});
await test('unknown or extra roots, missing parent refs and unexpected storage reject', () => {
  const { seed } = fixture();
  for (const alter of [s => s.entries.push({ path: 'foreign/extra', data: {}, writeTime: WRITE }),
    s => s.documentPaths.pop(), s => s.collectionPaths.push('foreign'), s => s.storage.current.push('unknown')]) {
    const changed = copy(seed); alter(changed); assert.throws(() => C.validateSeed(changed, RUN));
  }
});
await test('fence must remain minimal disabled and inventoried unfinished through retry', () => {
  const { seed, pending } = fixture();
  for (const alter of [s => { s.entries.find(r => r.path === C.ACCESS).data.disabled = false; },
    s => { s.entries.find(r => r.path === C.ACCESS).data.admin = true; },
    s => { s.entries.find(r => r.data.kind === 'document' && r.data.path === C.ACCESS).data.done = true; },
    s => { s.entries.find(r => r.path === C.LOCK).data.jobId = RUN; }]) {
    const changed = copy(pending); alter(changed); assert.throws(() => C.validatePending(changed, seed, RUN, NOW, JOB));
  }
});
await test('foreign account field and same-payload foreign/public writeTime changes reject', () => {
  const { seed, pending } = fixture();
  for (const alter of [s => { s.accounts.find(a => a.uid === OTHER_OWNER).metadata.creationTime = 'changed'; },
    s => { s.entries.find(r => r.path === C.KNOWLEDGE).writeTime.nanoseconds++; },
    s => { s.entries.find(r => r.path === 'accountAccess/' + OTHER_OWNER).writeTime.nanoseconds++; }]) {
    const changed = copy(pending); alter(changed); assert.throws(() => C.validatePending(changed, seed, RUN, NOW, JOB));
  }
});
await test('retry permits only job lease writeTime and rejects fence rewriting', () => {
  const { seed, pending, retry } = fixture(); retry.entries.find(r => r.path === C.ACCESS).writeTime.nanoseconds++;
  assert.throws(() => C.validateRetry(pending, retry, seed, RUN, NOW, JOB));
});
await test('only exact canonical ready LF bytes accepted, not old method/run/CRLF', () => {
  const value = text => ({ output: Buffer.from(text).toString('base64'), result: result(0) });
  C.assertReady(value(C.readyText(RUN)), RUN);
  for (const text of [C.readyText(RUN).replace('\n', '\r\n'), C.readyText('2'.repeat(32)),
    C.readyText(RUN).replace(C.WORKFLOW.method, CONSUMER.method)]) assert.throws(() => C.assertReady(value(text), RUN));
  assert.throws(() => C.assertReady({ ...value(C.readyText(RUN)), result: result(1) }, RUN));
});
await test('active barrier cannot accept stopped/cancelled/ended/foreign instrumentation', () => {
  C.assertActive({ running: true, cancelled: false, output: START });
  for (const value of [{ running: false, cancelled: false, output: START }, { running: true, cancelled: true, output: START },
    { running: true, cancelled: false, output: PASS }, { running: true, cancelled: false, output: block(1, CONSUMER.method) }])
    assert.throws(() => C.assertActive(value));
});
await test('preexpiry retry after terminal requires exact success and no cancellation', () => {
  C.assertRetryAllowed({ running: false, cancelled: false, output: PASS });
  assert.throws(() => C.assertRetryAllowed({ running: true, cancelled: false, output: START }));
  assert.throws(() => C.assertRetryAllowed({ running: false, cancelled: true, output: PASS }));
  assert.throws(() => C.assertRetryAllowed({ running: false, cancelled: false, output: PASS.replace('STATUS_CODE: 0', 'STATUS_CODE: -2') }));
});
await test('strict singleton does not accept old19, skips, failure, duplicate or extra method', () => {
  assert.equal(C.validateWorkflowInstrumentation(PASS).passed, 1);
  for (const log of [PASS.replaceAll(C.WORKFLOW.method, CONSUMER.method), PASS + block(0),
    PASS.replace('STATUS_CODE: 0', 'STATUS_CODE: -3'), PASS.replace('OK (1 test)', 'OK (2 tests)'),
    PASS + 'INSTRUMENTATION_FAILED: crash\n']) assert.throws(() => C.validateWorkflowInstrumentation(log));
});
await test('only pending response at same fixed clock accepted, never COMPLETE or near-expiry mutation', () => {
  const response = { jobId: JOB, status: 'PENDING_SESSION_EXPIRY', nextActionAt: NOW + 65 * 60_000 };
  C.validatePendingResponse(response, NOW);
  assert.throws(() => C.validatePendingResponse({ ...response, status: 'COMPLETE' }, NOW));
  assert.throws(() => C.validatePendingResponse({ ...response, nextActionAt: response.nextActionAt - 1 }, NOW));
});
await test('unknown write outcome or changed owned state never authorizes cleanup', () => {
  const { proof, retry } = fixture(); C.assertCleanupOwned(proof, retry, RUN);
  for (const field of ['requestOutcome', 'retryOutcome']) {
    const changed = copy(proof); changed[field] = 'unknown'; assert.throws(() => C.assertCleanupOwned(changed, retry, RUN));
  }
  const changed = copy(retry); changed.entries.find(r => r.path === C.LOCK).writeTime.nanoseconds++;
  assert.throws(() => C.assertCleanupOwned(proof, changed, RUN));
  proof.cleanup.firestoreOutcome = 'unknown'; assert.throws(() => C.assertCleanupOwned(proof, retry, RUN));
});
await test('full Auth JSON canonicalization omits only undefined provider fields without mutating input', () => {
  const source = copy(C.ACCOUNTS[0]); source.providerData[0].displayName = undefined;
  source.providerData[0].photoURL = undefined; source.providerData[0].phoneNumber = undefined;
  source.metadata = { creationTime: 'preserved', lastSignInTime: 'preserved' }; source.extra = { retained: null };
  const expected = copy(C.ACCOUNTS[0]); expected.metadata = copy(source.metadata); expected.extra = { retained: null };
  assert.deepEqual(C.canonicalAccount(source), expected); assert.equal(Object.hasOwn(source.providerData[0], 'displayName'), true);
});
await test('Android setup may change named owner sign-in fields but never adopt foreign metadata', () => {
  const { seed } = fixture(); const before = copy(seed);
  before.accounts.find(a => a.uid === C.WORKFLOW.owner).metadata.lastSignInTime = 'new owner login';
  C.validateBeforeRequest(before, seed, RUN);
  before.accounts.find(a => a.uid === OTHER_OWNER).metadata.lastSignInTime = 'foreign login';
  assert.throws(() => C.validateBeforeRequest(before, seed, RUN));
  const ownerChanged = copy(seed); ownerChanged.accounts.find(a => a.uid === C.WORKFLOW.owner).metadata.creationTime = 'changed';
  assert.throws(() => C.validateBeforeRequest(ownerChanged, seed, RUN));
});
await test('saved proof binds verified fresh actual token, seed/import acknowledgments and joined success', () => {
  assert.equal(C.validateWorkflowProof(completeProof(), RUN).verified, true);
  for (const change of [p => { delete p.tokenProof; }, p => { p.tokenProof.uid = OTHER_OWNER; },
    p => { p.tokenProof.provider = 'password'; }, p => { p.tokenProof.verified = false; },
    p => { p.tokenProof.authTime = NOW + 1; }, p => { p.tokenProof.authTime = NOW - 60_000; },
    p => { p.tokenProof.authTime = 1.5; }, p => { p.tokenProof.unexpected = true; },
    p => { p.accountsImported = false; }, p => { p.seedAcknowledged = false; },
    p => { p.androidJoinedBeforeRetry = false; }, p => { p.requestStatus = 200; },
    p => { p.retryStartedAt = p.requestStartedAt - 1; }]) {
    const changed = completeProof(); change(changed); assert.throws(() => C.validateWorkflowProof(changed, RUN));
  }
});
await test('saved cleanup must bind retried CAS targets and acknowledged atomic commit timestamps', () => {
  for (const change of [p => { delete p.cleanup.before; }, p => { p.cleanup.before.entries[0].writeTime.nanoseconds++; },
    p => { p.cleanup.deleteTimes.pop(); }, p => { p.cleanup.deleteTimes[0].nanoseconds++; },
    p => { p.cleanup.deleteTimes = p.cleanup.deleteTimes.map(() => copy(WRITE)); },
    p => { p.cleanup.firestoreOutcome = 'unknown'; }, p => { p.cleanup.authDeleted.pop(); },
    p => { p.cleanup.after.storage.current.push('foreign'); }]) {
    const changed = completeProof(); change(changed); assert.throws(() => C.validateWorkflowProof(changed, RUN));
  }
});
await test('late ready probe or read cannot overrun the original twenty second host deadline', async () => {
  for (const late of ['probe', 'read']) {
    let clock = 0;
    await assert.rejects(C.awaitReady(RUN, { running: true, cancelled: false, output: START }, {
      now: () => clock, sleep: async () => { throw Error('Unexpected poll'); },
      probeReady: async () => { if (late === 'probe') clock = 20_000; return { output: '', result: result(0) }; },
      readReady: async () => { if (late === 'read') clock = 20_001;
        return { output: Buffer.from(C.readyText(RUN)).toString('base64'), result: result(0) }; },
    }), /deadline/);
  }
});
await test('joined RED may remove only acknowledged pending fixtures without proving a retry or PASS', () => {
  const { proof, pending } = fixture(); proof.retryAttempts = 0; proof.retryOutcome = 'not-started'; proof.retried = null;
  C.assertCleanupOwned(proof, pending, RUN);
  assert.throws(() => C.validateWorkflowProof({ ...proof, verified: false }, RUN));
  for (const change of [p => { p.retryOutcome = 'unknown'; }, p => { p.retryAttempts = 1; },
    p => { p.pending = null; }, p => { p.requestOutcome = 'unknown'; }]) {
    const changed = copy(proof); change(changed); assert.throws(() => C.assertCleanupOwned(changed, pending, RUN));
  }
});
