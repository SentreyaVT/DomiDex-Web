// Additive fixed singleton contract. Existing eighteen scenarios/parsers stay unchanged.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { PROJECT, TEST_CLASS, OTHER_OWNER, validRunId } from './contract.mjs';
import { assertRevocationDeviceResult, revocationReadyExists } from './revocation.mjs';
import { assertMutationTime } from './revocation-mutation.mjs';

export const CONSUMER = Object.freeze({ key: 'knowledge-session-access',
  owner: 'sdk-proof-collection-knowledge-session-access',
  method: 'sessionAccessDisabledInvalidatesSharedKnowledgeConsumerWithoutPolling' });
export const FINGERPRINT = 'a'.repeat(64);
export const KNOWLEDGE = 'scanKnowledge/' + FINGERPRINT;
export const LOCK = 'accountDeletionLocks/' + CONSUMER.owner;
export const ACCESS = 'accountAccess/' + CONSUMER.owner;
export const ACCESS_DATA = Object.freeze({ disabled: true, updatedAt: 1791115200000 });
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const ACCOUNTS = Object.freeze([CONSUMER.owner, OTHER_OWNER].sort(lexical).map(uid => ({
  uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: false,
  customClaims: { appAccess: true },
  providerData: [{ providerId: 'google.com', uid: `${uid}-google`, email: `${uid}@example.invalid` }],
})));
export const readyPath = run => `files/domidex-knowledge-session-access-sdk-${validRunId(run)}/ready.txt`;
export const readyText = run => `v1|${validRunId(run)}|${CONSUMER.owner}|${CONSUMER.method}|${FINGERPRINT}\n`;
export const lockData = run => ({ jobId: `sdk-knowledge-session-access-${validRunId(run)}` });
export const fixture = (run, timestamp) => ({ path: KNOWLEDGE, data: {
  fingerprint: FINGERPRINT, cardId: `sdk-knowledge-${validRunId(run)}-session-access-server`,
  sourceSetId: 'synthetic-server-set', cardNumber: '101/202', status: 'STABLE',
  confidence: 91, confirmations: 7, corrections: 2, knowledgeVersion: 1, lastUpdatedAt: timestamp,
} });

export function validateSeed(seed, run) {
  assertMutationTime(seed?.data?.lastUpdatedAt);
  assert.deepEqual(seed, fixture(run, seed.data.lastUpdatedAt)); return seed;
}
export function expectedSnapshot(seed, run, locked = false) {
  validateSeed(seed, run); assert.equal(typeof locked, 'boolean');
  const entries = [structuredClone(seed)];
  if (locked) entries.push({ path: LOCK, data: lockData(run) }, { path: ACCESS, data: { ...ACCESS_DATA } });
  entries.sort((a, b) => lexical(a.path, b.path));
  return { entries, collectionPaths: entries.map(row => row.path.split('/')[0]).sort(lexical),
    documentPaths: entries.map(row => row.path), accounts: structuredClone(ACCOUNTS) };
}
export function assertReadyRead(value, run) {
  assertRevocationDeviceResult(value); assert.equal(value.result.code, 0);
  const ready = readyText(run);
  assert.equal(value.output, Buffer.from(ready, 'utf8').toString('base64'), 'Exact canonical ready bytes only');
  return ready;
}
// Exact original singleton grammar, specialized only to this one new method.
export function validateConsumerInstrumentation(text, method = CONSUMER.method) {
  assert.equal(method, CONSUMER.method);
  assert.equal((text.match(/^OK \(1 test\)\r?$/gm) ?? []).length, 1);
  assert.doesNotMatch(text, /INSTRUMENTATION_FAILED|FAILURES!!!|Process crashed|AssumptionViolated|shortMsg=/);
  let fields = {}; const statuses = []; const endings = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('INSTRUMENTATION_STATUS: ')) {
      const payload = line.slice('INSTRUMENTATION_STATUS: '.length); const equals = payload.indexOf('=');
      assert.ok(equals > 0); const key = payload.slice(0, equals);
      assert.equal(Object.hasOwn(fields, key), false); fields[key] = payload.slice(equals + 1);
    } else if (line.startsWith('INSTRUMENTATION_STATUS_CODE:')) {
      const match = /^INSTRUMENTATION_STATUS_CODE: (0|1)$/.exec(line); assert.ok(match);
      assert.equal(fields.class, TEST_CLASS); assert.equal(fields.test, method); assert.equal(fields.numtests, '1');
      statuses.push(Number(match[1])); fields = {};
    } else if (line.startsWith('INSTRUMENTATION_CODE:')) endings.push(line);
  }
  assert.deepEqual(fields, {}); assert.deepEqual(statuses, [1, 0]); assert.deepEqual(endings, ['INSTRUMENTATION_CODE: -1']);
  return { passed: 1, method, successEvidence: true };
}
export function startIsActive(output, running) {
  assert.equal(typeof output, 'string'); assert.equal(running, true);
  assert.doesNotMatch(output, /INSTRUMENTATION_FAILED|FAILURES!!!|Process crashed|INSTRUMENTATION_CODE:/);
  const complete = output.slice(0, output.lastIndexOf('\n') + 1);
  let fields = {}; let count = 0;
  for (const line of complete.split(/\r?\n/)) {
    if (line.startsWith('INSTRUMENTATION_STATUS: ')) {
      const payload = line.slice('INSTRUMENTATION_STATUS: '.length); const equals = payload.indexOf('=');
      assert.ok(equals > 0); const key = payload.slice(0, equals);
      assert.equal(Object.hasOwn(fields, key), false); fields[key] = payload.slice(equals + 1);
    } else if (line.startsWith('INSTRUMENTATION_STATUS_CODE:')) {
      assert.equal(line, 'INSTRUMENTATION_STATUS_CODE: 1');
      assert.equal(fields.class, TEST_CLASS); assert.equal(fields.test, CONSUMER.method); assert.equal(fields.numtests, '1');
      assert.equal(++count, 1); fields = {};
    }
  }
  return count === 1 && Object.keys(fields).length === 0 && complete.length === output.length;
}
export function assertMayCreate(lifecycle) {
  assert.equal(lifecycle.cancelled, false); assert.equal(startIsActive(lifecycle.output, lifecycle.running), true);
}
export const EVENTS = Object.freeze(['ready-consumed', 'before-create-readback', 'atomic-create-acknowledged',
  'after-create-readback', 'android-result-joined', 'locked-readback', 'atomic-delete-acknowledged', 'restored-readback']);
export function newReceipt(run) {
  return { version: 1, runId: validRunId(run), method: CONSUMER.method, ready: null, positiveReadyReads: 0,
    createAttempts: 0, createOutcome: 'not-started', createTimes: null,
    deleteAttempts: 0, deleteOutcome: 'not-started', deleteTimes: null,
    beforeCreate: null, afterCreate: null, lockedReadback: null, afterDelete: null,
    observedTimes: null, checkedDeleteTimes: null, events: [], errors: [] };
}
const event = (receipt, io, name) => { receipt.events.push(name); io.save(); };
function times(value) {
  assert.equal(value?.length, 2); value.forEach(assertMutationTime);
  assert.deepEqual(value[0], value[1], 'Both writes must be one atomic commit');
}
function documents(value, run, expectedTimes) {
  assert.equal(value?.length, 2);
  for (const [index, path, data] of [[0, LOCK, lockData(run)], [1, ACCESS, ACCESS_DATA]]) {
    assert.deepEqual(Object.keys(value[index]).sort(lexical), ['data', 'exists', 'path', 'writeTime']);
    assert.equal(value[index].path, path); assert.equal(value[index].exists, true);
    assert.deepEqual(value[index].data, data); assert.deepEqual(value[index].writeTime, expectedTimes[index]);
  }
}
export async function beginConsumer(receipt, seed, lifecycle, io) {
  const preflight = expectedSnapshot(seed, receipt.runId); let deadline = null;
  for (;;) {
    assert.equal(lifecycle.running, true); assert.equal(lifecycle.cancelled, false);
    const active = startIsActive(lifecycle.output, lifecycle.running);
    if (active && deadline === null) deadline = io.now() + 20_000;
    if (deadline !== null) assert.ok(io.now() < deadline, 'Consumer readiness timed out');
    if (active) {
      const remaining = () => { assert.ok(io.now() < deadline); return Math.max(1, Math.min(1500, Math.floor(deadline - io.now()))); };
      if (revocationReadyExists(await io.probeReady(remaining()))) {
        receipt.ready = assertReadyRead(await io.readReady(remaining()), receipt.runId);
        assert.equal(++receipt.positiveReadyReads, 1); event(receipt, io, 'ready-consumed'); break;
      }
    }
    await io.sleep();
  }
  assertMayCreate(lifecycle);
  receipt.beforeCreate = await io.snapshot(); io.save(); assert.deepEqual(receipt.beforeCreate, preflight);
  assert.deepEqual(await io.documents(), [{ path: LOCK, exists: false }, { path: ACCESS, exists: false }]);
  event(receipt, io, 'before-create-readback');
  // Last lifecycle check follows every await; no new fixture write after stop began.
  assertMayCreate(lifecycle); assert.equal(receipt.createAttempts, 0);
  receipt.createAttempts++; receipt.createOutcome = 'unknown'; io.save();
  const created = await io.createBoth(lockData(receipt.runId), ACCESS_DATA);
  // Unknown outcomes never authorize compensation, even when state looks committed.
  receipt.createTimes = created; times(created); receipt.createOutcome = 'acknowledged'; io.save();
  event(receipt, io, 'atomic-create-acknowledged');
  const observed = await io.documents(); documents(observed, receipt.runId, created);
  receipt.observedTimes = observed.map(row => row.writeTime); io.save();
  receipt.afterCreate = await io.snapshot(); io.save();
  assert.deepEqual(receipt.afterCreate, expectedSnapshot(seed, receipt.runId, true));
  event(receipt, io, 'after-create-readback');
}
export async function finishConsumer(receipt, seed, io) {
  event(receipt, io, 'android-result-joined');
  const attempt = async (stage, fn) => {
    try { await fn(); return true; }
    catch (error) { receipt.errors.push({ stage, error: error.message }); io.save(); return false; }
  };
  const owned = receipt.createOutcome === 'acknowledged';
  const captured = await attempt('locked-readback', async () => {
    receipt.lockedReadback = await io.snapshot(); io.save();
    assert.notEqual(receipt.createOutcome, 'unknown', 'Unknown create cannot authorize cleanup');
    assert.deepEqual(receipt.lockedReadback, expectedSnapshot(seed, receipt.runId, owned));
    event(receipt, io, 'locked-readback');
  });
  if (owned && captured) await attempt('owned-atomic-delete', async () => {
    const checked = await io.documents(); documents(checked, receipt.runId, receipt.createTimes);
    receipt.checkedDeleteTimes = checked.map(row => row.writeTime);
    assert.equal(receipt.deleteAttempts, 0); receipt.deleteAttempts++; receipt.deleteOutcome = 'unknown'; io.save();
    const deleted = await io.deleteBoth(receipt.createTimes);
    receipt.deleteTimes = deleted; times(deleted); receipt.deleteOutcome = 'acknowledged'; io.save();
    event(receipt, io, 'atomic-delete-acknowledged');
  });
  await attempt('restored-readback', async () => {
    receipt.afterDelete = await io.snapshot(); io.save();
    assert.deepEqual(receipt.afterDelete, expectedSnapshot(seed, receipt.runId)); event(receipt, io, 'restored-readback');
  });
}
export function validateConsumerReceipt(receipt, run, seed) {
  assert.deepEqual(Object.keys(receipt).sort(lexical), Object.keys(newReceipt(run)).sort(lexical));
  assert.equal(receipt.version, 1); assert.equal(receipt.runId, run); assert.equal(receipt.method, CONSUMER.method);
  assert.equal(receipt.ready, readyText(run)); assert.equal(receipt.positiveReadyReads, 1);
  for (const key of ['createAttempts', 'deleteAttempts']) assert.equal(receipt[key], 1);
  for (const key of ['createOutcome', 'deleteOutcome']) assert.equal(receipt[key], 'acknowledged');
  times(receipt.createTimes); times(receipt.deleteTimes);
  assert.ok(receipt.deleteTimes[0].seconds > receipt.createTimes[0].seconds ||
    (receipt.deleteTimes[0].seconds === receipt.createTimes[0].seconds &&
      receipt.deleteTimes[0].nanoseconds > receipt.createTimes[0].nanoseconds), 'Cleanup commit must follow creation');
  assert.deepEqual(receipt.observedTimes, receipt.createTimes); assert.deepEqual(receipt.checkedDeleteTimes, receipt.createTimes);
  assert.deepEqual(receipt.beforeCreate, expectedSnapshot(seed, run));
  assert.deepEqual(receipt.afterCreate, expectedSnapshot(seed, run, true));
  assert.deepEqual(receipt.lockedReadback, receipt.afterCreate); assert.deepEqual(receipt.afterDelete, receipt.beforeCreate);
  assert.deepEqual(receipt.events, EVENTS); assert.deepEqual(receipt.errors, []);
  return { verified: true, atomicOwnDisableAndLock: true, atomicCasCleanup: true, lockOnlyReevaluationProved: false };
}
export function validateConsumerProof(proof, run) {
  assert.deepEqual(Object.keys(proof).sort(lexical), ['project', 'runId', 'verified', 'seed', 'preflight', 'readback',
    'android', 'barrier', 'accountUnchanged', 'errors', 'adminClosed'].sort(lexical));
  assert.equal(proof.project, PROJECT); assert.equal(proof.runId, validRunId(run));
  assert.equal(proof.verified, true); assert.equal(proof.accountUnchanged, true); assert.equal(proof.adminClosed, true);
  assert.deepEqual(proof.errors, []); validateSeed(proof.seed, run);
  assert.deepEqual(proof.preflight, expectedSnapshot(proof.seed, run)); assert.deepEqual(proof.readback, proof.preflight);
  assert.deepEqual(proof.android, { passed: 1, method: CONSUMER.method, successEvidence: true });
  return validateConsumerReceipt(proof.barrier, run, proof.seed);
}
