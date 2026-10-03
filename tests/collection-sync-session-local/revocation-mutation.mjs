// Fixed additional data-change scenario. No SDK interception or relaxed completion parser.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { REVOCATION_CLASS, assertRevocationDeviceResult, revocationReadyExists } from './revocation.mjs';
export const MUTATION = Object.freeze({
  key: 'knowledge-revoked-on-data-change', owner: 'sdk-proof-collection-knowledge-revoked-on-data-change',
  method: 'knowledgeListenerPermissionDeniedAfterDataChangeInvalidatesHintAndPreservesLocalState',
});
export const MUTATION_FINGERPRINT = '8'.repeat(64);
export const MUTATION_PATH = 'scanKnowledge/' + MUTATION_FINGERPRINT;
export const MUTATION_LOCK_PATH = 'accountDeletionLocks/' + MUTATION.owner;
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function id(value) { assert.equal(typeof value, 'string'); assert.match(value, /^[a-f0-9]{32}$/); return value; }
export const mutationReadyPath = runId => 'files/domidex-knowledge-revoked-on-data-change-sdk-' + id(runId) + '/ready.txt';
export const mutationReadyText = runId => 'v1|' + id(runId) + '|' + MUTATION.owner + '|' + MUTATION.method + '|' + MUTATION_FINGERPRINT + '\n';
export function assertMutationReadyRead(value, runId) {
  assertRevocationDeviceResult(value); assert.equal(value.result.code, 0);
  const ready = mutationReadyText(runId);
  assert.equal(value.output, Buffer.from(ready, 'utf8').toString('base64'), 'Exact canonical ready encoding only');
  return ready;
}
export function mutationFixture(runId, timestamp) {
  return { path: MUTATION_PATH, data: {
    fingerprint: MUTATION_FINGERPRINT, cardId: 'sdk-knowledge-' + id(runId) + '-revoked-on-data-change-server',
    sourceSetId: 'synthetic-server-set', cardNumber: '101/202', status: 'STABLE',
    confidence: 91, confirmations: 7, corrections: 2, knowledgeVersion: 1, lastUpdatedAt: timestamp,
  } };
}
export const mutationLock = runId => ({ path: MUTATION_LOCK_PATH, data: { jobId: 'sdk-knowledge-revoked-on-data-change-' + id(runId) } });
export function mutationStartIsActive(output, childRunning) {
  assert.equal(typeof output, 'string'); assert.equal(typeof childRunning, 'boolean');
  assert.equal(childRunning, true, 'Owned instrumentation must still be running');
  assert.doesNotMatch(output, /INSTRUMENTATION_FAILED|FAILURES!!!|Process crashed|INSTRUMENTATION_CODE:/);
  const complete = output.slice(0, output.lastIndexOf('\n') + 1);
  let fields = {}; const statuses = [];
  for (const line of complete.split(/\r?\n/)) {
    if (line.startsWith('INSTRUMENTATION_STATUS: ')) {
      const payload = line.slice('INSTRUMENTATION_STATUS: '.length); const equals = payload.indexOf('=');
      assert.ok(equals > 0); const key = payload.slice(0, equals);
      assert.equal(Object.hasOwn(fields, key), false, 'Duplicate instrumentation field');
      fields[key] = payload.slice(equals + 1);
    } else if (line.startsWith('INSTRUMENTATION_STATUS_CODE:')) {
      assert.equal(line, 'INSTRUMENTATION_STATUS_CODE: 1', 'Only the sole active START may precede the lock');
      assert.equal(fields.class, REVOCATION_CLASS); assert.equal(fields.test, MUTATION.method);
      assert.equal(fields.numtests, '1'); statuses.push(1); fields = {};
      assert.equal(statuses.length, 1, 'No duplicate START may authorize a second write');
    }
  }
  if (statuses.length === 0) return false;
  // A second in-progress status group may be a completion/failure split across
  // stdout chunks. Never write while that group is partially buffered.
  return Object.keys(fields).length === 0 && complete.length === output.length;
}


export function assertMutationMayWrite(lifecycle) {
  assert.equal(lifecycle.cancelled, false, 'Stopped instrumentation cannot begin a new fixture write');
  assert.equal(mutationStartIsActive(lifecycle.output, lifecycle.running), true);
}
export function assertMutationTime(value) {
  assert.deepEqual(Object.keys(value ?? {}).sort(lexical), ['nanoseconds', 'seconds']);
  assert.ok(Number.isSafeInteger(value.seconds) && value.seconds > 1700000000);
  assert.ok(Number.isSafeInteger(value.nanoseconds) && value.nanoseconds >= 0 && value.nanoseconds < 1e9);
}
function newer(after, before) {
  assertMutationTime(after); assertMutationTime(before);
  assert.ok(after.seconds > before.seconds || (after.seconds === before.seconds && after.nanoseconds > before.nanoseconds),
    'A changed document must have a strictly newer updateTime');
}
export function mutationSeed(preflight, runId) {
  assert.equal(preflight.method, MUTATION.method); assert.equal(preflight.accounts.length, 19);
  assert.equal(preflight.collectionPaths.length, 15); assert.equal(preflight.documentPaths.length, 27);
  assert.equal(preflight.entries.length, 18);
  assert.equal(preflight.collectionPaths.includes('accountDeletionLocks'), false);
  assert.equal(preflight.documentPaths.some(path => path.startsWith('accountDeletionLocks/')), false);
  assert.equal(preflight.entries.some(row => row.path.startsWith('accountDeletionLocks/')), false);
  const rows = preflight.entries.filter(row => row.path === MUTATION_PATH); assert.equal(rows.length, 1);
  assertMutationTime(rows[0].data.lastUpdatedAt);
  assert.deepEqual(rows[0], mutationFixture(runId, rows[0].data.lastUpdatedAt));
  return structuredClone(rows[0]);
}
export function mutationSnapshot(preflight, runId, changed = false) {
  mutationSeed(preflight, runId); assert.equal(typeof changed, 'boolean');
  const result = structuredClone(preflight);
  result.collectionPaths.push('accountDeletionLocks'); result.collectionPaths.sort(lexical);
  result.documentPaths.push(MUTATION_LOCK_PATH); result.documentPaths.sort(lexical);
  result.entries.push(mutationLock(runId)); result.entries.sort((a, b) => lexical(a.path, b.path));
  if (changed) result.entries.find(row => row.path === MUTATION_PATH).data.confidence = 90;
  assert.equal(result.collectionPaths.length, 16); assert.equal(result.documentPaths.length, 28);
  assert.equal(result.entries.length, 19); return result;
}
export const MUTATION_EVENTS = Object.freeze([
  'ready-consumed', 'before-lock-readback', 'lock-create-succeeded', 'after-lock-readback',
  'seed-update-succeeded', 'after-mutation-readback', 'android-result-joined',
  'locked-android-readback', 'atomic-restore-delete-succeeded', 'restored-readback',
]);
export function createMutationState(runId) {
  return { version: 1, method: MUTATION.method, runId: id(runId), ready: null,
    positiveReadyReads: 0, createAttempts: 0, mutationAttempts: 0, cleanupAttempts: 0,
    createOutcome: 'not-started', mutationOutcome: 'not-started', cleanupOutcome: 'not-started',
    lock: mutationLock(runId), seed: null, seedWriteTime: null, lockWriteTime: null,
    lockObservedWriteTime: null, mutationCheckedSeedTime: null, mutationCheckedLockTime: null,
    mutationWriteTime: null, cleanupCheckedSeedTime: null, cleanupCheckedLockTime: null,
    restoredSeedWriteTime: null, deletedLockWriteTime: null,
    beforeCreate: null, afterCreate: null, afterMutation: null, lockedAndroidReadback: null,
    afterRestore: null, events: [], errors: [] };
}
export function validateMutationReceipt(receipt, runId, preflight, readback) {
  assert.deepEqual(Object.keys(receipt).sort(lexical), Object.keys(createMutationState(runId)).sort(lexical));
  assert.equal(receipt.version, 1); assert.equal(receipt.method, MUTATION.method); assert.equal(receipt.runId, runId);
  assert.equal(receipt.ready, mutationReadyText(runId)); assert.equal(receipt.positiveReadyReads, 1);
  for (const name of ['createAttempts', 'mutationAttempts', 'cleanupAttempts']) assert.equal(receipt[name], 1);
  for (const name of ['createOutcome', 'mutationOutcome', 'cleanupOutcome']) assert.equal(receipt[name], 'acknowledged');
  assert.deepEqual(receipt.lock, mutationLock(runId)); assert.deepEqual(receipt.seed, mutationSeed(preflight, runId));
  assert.deepEqual(receipt.errors, []); assert.deepEqual(receipt.events, MUTATION_EVENTS);
  for (const name of ['seedWriteTime', 'lockWriteTime', 'lockObservedWriteTime', 'mutationCheckedSeedTime',
    'mutationCheckedLockTime', 'mutationWriteTime', 'cleanupCheckedSeedTime', 'cleanupCheckedLockTime',
    'restoredSeedWriteTime', 'deletedLockWriteTime']) assertMutationTime(receipt[name]);
  assert.deepEqual(receipt.lockObservedWriteTime, receipt.lockWriteTime);
  assert.deepEqual(receipt.mutationCheckedLockTime, receipt.lockWriteTime);
  assert.deepEqual(receipt.cleanupCheckedLockTime, receipt.lockWriteTime);
  assert.deepEqual(receipt.mutationCheckedSeedTime, receipt.seedWriteTime);
  assert.deepEqual(receipt.cleanupCheckedSeedTime, receipt.mutationWriteTime);
  newer(receipt.mutationWriteTime, receipt.seedWriteTime); newer(receipt.restoredSeedWriteTime, receipt.mutationWriteTime);
  assert.deepEqual(receipt.restoredSeedWriteTime, receipt.deletedLockWriteTime, 'One atomic commit, not two cleanup writes');
  assert.deepEqual(receipt.beforeCreate, preflight);
  assert.deepEqual(receipt.afterCreate, mutationSnapshot(preflight, runId));
  assert.deepEqual(receipt.afterMutation, mutationSnapshot(preflight, runId, true));
  assert.deepEqual(receipt.lockedAndroidReadback, receipt.afterMutation);
  assert.deepEqual(receipt.afterRestore, preflight); assert.deepEqual(readback, preflight);
  return { method: MUTATION.method, hostBarriers: 1, completeIntermediateAdminSnapshots: 5,
    actualSeedMutations: 1, atomicRestoreAndDelete: true, lockOnlyReevaluationProved: false };
}
function assertDocument(document, expected, time) {
  assert.deepEqual(Object.keys(document).sort(lexical), ['data', 'exists', 'path', 'writeTime']);
  assert.equal(document.exists, true); assert.equal(document.path, expected.path);
  assert.deepEqual(document.data, expected.data); assertMutationTime(document.writeTime);
  if (time !== undefined) assert.deepEqual(document.writeTime, time);
}
const event = (receipt, io, name) => { receipt.events.push(name); io.save(); };
// io is the fixed Admin/device adapter below the launcher; unit tests supply isolated
// in-memory orchestration controls only, never fabricated Android/SDK success.
export async function beginMutation(receipt, preflight, lifecycle, io) {
  receipt.seed = mutationSeed(preflight, receipt.runId); io.save();
  let deadline = null;
  for (;;) {
    assert.equal(lifecycle.running, true); assert.equal(lifecycle.cancelled, false);
    const active = mutationStartIsActive(lifecycle.output, lifecycle.running);
    if (active && deadline === null) deadline = io.now() + 20_000;
    if (deadline !== null) assert.ok(io.now() < deadline, 'Exact data-change ready barrier timed out');
    if (active) {
      const remaining = () => {
        assert.ok(io.now() < deadline, 'Ready barrier expired');
        return Math.max(1, Math.min(1500, Math.floor(deadline - io.now())));
      };
      if (revocationReadyExists(await io.probeReady(remaining()))) {
        receipt.ready = assertMutationReadyRead(await io.readReady(remaining()), receipt.runId);
        receipt.positiveReadyReads++; assert.equal(receipt.positiveReadyReads, 1);
        event(receipt, io, 'ready-consumed'); break;
      }
    }
    await io.sleep();
  }
  assertMutationMayWrite(lifecycle);
  receipt.beforeCreate = await io.snapshot(); io.save(); assert.deepEqual(receipt.beforeCreate, preflight);
  const initial = await io.documents();
  assertDocument(initial.seed, receipt.seed); assert.equal(initial.lock.exists, false);
  assert.equal(initial.lock.path, MUTATION_LOCK_PATH);
  receipt.seedWriteTime = initial.seed.writeTime;
  event(receipt, io, 'before-lock-readback');
  assertMutationMayWrite(lifecycle); assert.equal(receipt.createAttempts, 0);
  receipt.createAttempts++; receipt.createOutcome = 'unknown'; io.save();
  const created = await io.createLock(receipt.lock.data);
  // Acknowledged ownership is retained synchronously before any later read/save/validation.
  receipt.lockWriteTime = created; receipt.createOutcome = 'acknowledged'; io.save(); assertMutationTime(created);
  event(receipt, io, 'lock-create-succeeded');
  const observed = await io.documents();
  assertDocument(observed.lock, receipt.lock, created); assertDocument(observed.seed, receipt.seed, receipt.seedWriteTime);
  receipt.lockObservedWriteTime = observed.lock.writeTime;
  receipt.afterCreate = await io.snapshot(); io.save(); assert.deepEqual(receipt.afterCreate, mutationSnapshot(preflight, receipt.runId));
  event(receipt, io, 'after-lock-readback');
  const checked = await io.documents();
  assertDocument(checked.lock, receipt.lock, created); assertDocument(checked.seed, receipt.seed, receipt.seedWriteTime);
  receipt.mutationCheckedSeedTime = checked.seed.writeTime; receipt.mutationCheckedLockTime = checked.lock.writeTime;
  // No await between this final stop/live/sole-START check and the sole CAS invocation.
  assertMutationMayWrite(lifecycle); assert.equal(receipt.mutationAttempts, 0);
  receipt.mutationAttempts++; receipt.mutationOutcome = 'unknown'; io.save();
  const mutated = await io.mutateSeed(receipt.seedWriteTime);
  receipt.mutationWriteTime = mutated; receipt.mutationOutcome = 'acknowledged'; io.save();
  newer(mutated, receipt.seedWriteTime); event(receipt, io, 'seed-update-succeeded');
  receipt.afterMutation = await io.snapshot(); io.save();
  assert.deepEqual(receipt.afterMutation, mutationSnapshot(preflight, receipt.runId, true));
  event(receipt, io, 'after-mutation-readback');
}
export async function finishMutation(receipt, preflight, io) {
  event(receipt, io, 'android-result-joined');
  const attempt = async (stage, work) => {
    try { await work(); return true; }
    catch (error) { receipt.errors.push({ stage, error: error.message }); io.save(); return false; }
  };
  const owned = receipt.createOutcome === 'acknowledged';
  const mutated = receipt.mutationOutcome === 'acknowledged';
  const unknown = receipt.createOutcome === 'unknown' || receipt.mutationOutcome === 'unknown';
  const captured = await attempt('locked-android-readback', async () => {
    receipt.lockedAndroidReadback = await io.snapshot(); io.save();
    assert.equal(unknown, false, 'Unknown write outcome cannot authorize any compensating write');
    assert.deepEqual(receipt.lockedAndroidReadback, owned ? mutationSnapshot(preflight, receipt.runId, mutated) : preflight);
    event(receipt, io, 'locked-android-readback');
  });
  if (owned && !unknown && captured) await attempt('owned-cleanup', async () => {
    const checked = await io.documents();
    assertDocument(checked.lock, receipt.lock, receipt.lockWriteTime);
    const expectedSeed = structuredClone(receipt.seed); if (mutated) expectedSeed.data.confidence = 90;
    assertDocument(checked.seed, expectedSeed, mutated ? receipt.mutationWriteTime : receipt.seedWriteTime);
    receipt.cleanupCheckedSeedTime = checked.seed.writeTime; receipt.cleanupCheckedLockTime = checked.lock.writeTime;
    assert.equal(receipt.cleanupAttempts, 0); receipt.cleanupAttempts++; receipt.cleanupOutcome = 'unknown'; io.save();
    if (mutated) {
      const times = await io.restoreAndDelete(receipt.seed, receipt.mutationWriteTime, receipt.lockWriteTime);
      // Do not retry an ambiguous commit, even if a following snapshot looks restored.
      receipt.cleanupOutcome = 'acknowledged';
      assert.equal(times.length, 2);
      [receipt.restoredSeedWriteTime, receipt.deletedLockWriteTime] = times; io.save();
      newer(times[0], receipt.mutationWriteTime); assert.deepEqual(times[0], times[1]);
      event(receipt, io, 'atomic-restore-delete-succeeded');
    } else {
      // A cancelled barrier before mutation only owns its acknowledged pristine lock.
      // Never rewrite an unmutated seed just to make an abort look like a full receipt.
      await io.deletePristineLock(receipt.lockWriteTime); receipt.cleanupOutcome = 'acknowledged';
      event(receipt, io, 'pristine-owned-lock-delete-succeeded');
    }
  });
  await attempt('restored-readback', async () => {
    receipt.afterRestore = await io.snapshot(); io.save(); assert.deepEqual(receipt.afterRestore, preflight);
    event(receipt, io, 'restored-readback');
  });
}
