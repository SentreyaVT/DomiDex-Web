// Pure helpers; no I/O, SDK initialization, monkeypatch or relaxed result parser.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

export const REVOCATION = Object.freeze({
  key: 'knowledge-revoked', owner: 'sdk-proof-collection-knowledge-revoked',
  method: 'knowledgeListenerPermissionDeniedInvalidatesHintAndPreservesLocalState',
});
export const REVOCATION_CLASS = 'com.dominik.cardvault.data.sync.CollectionSyncSessionSdkInstrumentedTest';
export const REVOCATION_FINGERPRINT = '6'.repeat(64);
export const REVOCATION_KNOWLEDGE_PATH = `scanKnowledge/${REVOCATION_FINGERPRINT}`;
export const REVOCATION_LOCK_PATH = `accountDeletionLocks/${REVOCATION.owner}`;
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function runId(value) {
  assert.equal(typeof value, 'string'); assert.match(value, /^[a-f0-9]{32}$/); return value;
}
export function revocationReadyPath(id) {
  return `files/domidex-knowledge-revoked-sdk-${runId(id)}/ready.txt`;
}
export function revocationReadyText(id) {
  return `v1|${runId(id)}|${REVOCATION.owner}|${REVOCATION.method}|${REVOCATION_FINGERPRINT}\n`;
}
export function assertRevocationReady(value, id) {
  assert.equal(typeof value, 'string');
  // No trim, coercion, partial matching or tolerance of CRLF/BOM/extra lines.
  assert.equal(value, revocationReadyText(id), 'One exact newly owned ready record required');
  return value;
}
export function assertRevocationDeviceResult(value) {
  assert.equal(typeof value.output, 'string');
  assert.equal(value.result.stopped, null, 'Stopped device probe is never absence');
  assert.equal(value.result.error, null, 'Failed device probe is never absence');
  assert.equal(value.result.signal, null, 'Signalled device probe is never absence');
}
export function revocationReadyExists(value) {
  assertRevocationDeviceResult(value);
  assert.equal(value.output, '', 'Unknown run-as/test output is never absence');
  assert.ok(value.result.code === 0 || value.result.code === 1, 'Only clean shell-v2 test true/false is valid');
  return value.result.code === 0;
}
export function assertRevocationReadyRead(value, id) {
  assertRevocationDeviceResult(value);
  assert.equal(value.result.code, 0, 'A ready file that existed must be read successfully');
  const ready = revocationReadyText(id);
  // Exact no-wrap Base64 avoids Windows adb stdout newline translation.
  // Compare canonical encoding directly; never trim or permissively decode.
  assert.equal(value.output, Buffer.from(ready, 'utf8').toString('base64'), 'Exact encoded ready bytes required');
  return ready;
}
export function assertRevocationShellV2(value) {
  assertRevocationDeviceResult(value); assert.equal(value.result.code, 0);
  assert.match(value.output, /^(?:[a-z0-9_]+\r?\n)+$/);
  const features = value.output.trimEnd().split(/\r?\n/);
  assert.equal(features.filter(feature => feature === 'shell_v2').length, 1, 'Remote exit status requires shell_v2');
}
export function assertRevocationMayCreate(lifecycle) {
  assert.equal(lifecycle.cancelled, false, 'A stopped invocation cannot create a new lock');
  assert.equal(revocationStartIsActive(lifecycle.output, lifecycle.running), true);
}
export function revocationLockFixture(id) {
  return { path: REVOCATION_LOCK_PATH, data: { jobId: `sdk-knowledge-revoked-${runId(id)}` } };
}
export function revocationKnowledgeFixture(id, timestamp) {
  runId(id);
  return { path: REVOCATION_KNOWLEDGE_PATH, data: {
    fingerprint: REVOCATION_FINGERPRINT, cardId: `sdk-knowledge-${id}-revoked-server`,
    sourceSetId: 'synthetic-server-set', cardNumber: '101/202', status: 'STABLE',
    confidence: 91, confirmations: 7, corrections: 2, knowledgeVersion: 1, lastUpdatedAt: timestamp,
  } };
}

// Separate launch/readiness observer. It NEVER replaces or alters the existing
// validateInstrumentation() full completion parser, which must still pass later.
// Return false only while a complete START group has not yet arrived. Every
// complete unknown/duplicate/terminal status rejects the possibility of a write.
export function revocationStartIsActive(output, childRunning) {
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
      assert.equal(fields.class, REVOCATION_CLASS); assert.equal(fields.test, REVOCATION.method);
      assert.equal(fields.numtests, '1'); statuses.push(1); fields = {};
      assert.equal(statuses.length, 1, 'No duplicate START may authorize a second write');
    }
  }
  if (statuses.length === 0) return false;
  // A second in-progress status group may be a completion/failure split across
  // stdout chunks. Never write while that group is partially buffered.
  return Object.keys(fields).length === 0 && complete.length === output.length;
}

export function expectedLockedSnapshot(preflight, id) {
  assert.equal(preflight.method, REVOCATION.method);
  assert.equal(preflight.accounts.length, 19, 'All nineteen nominal accounts required');
  assert.equal(preflight.collectionPaths.includes('accountDeletionLocks'), false, 'No pre-existing lock collection');
  assert.equal(preflight.documentPaths.includes(REVOCATION_LOCK_PATH), false);
  assert.equal(preflight.entries.some(item => item.path.startsWith('accountDeletionLocks/')), false);
  const result = structuredClone(preflight);
  result.collectionPaths.push('accountDeletionLocks'); result.collectionPaths.sort(lexical);
  result.documentPaths.push(REVOCATION_LOCK_PATH); result.documentPaths.sort(lexical);
  result.entries.push(revocationLockFixture(id)); result.entries.sort((a, b) => lexical(a.path, b.path));
  assert.ok(result.collectionPaths.length <= 16, 'No global collection bound increase');
  assert.ok(result.documentPaths.length <= 32, 'No paging exemption in the revocation phase');
  return result;
}
function assertWriteTime(value) {
  assert.deepEqual(Object.keys(value ?? {}).sort(lexical), ['nanoseconds', 'seconds']);
  assert.ok(Number.isSafeInteger(value.seconds) && value.seconds > 1700000000);
  assert.ok(Number.isSafeInteger(value.nanoseconds) && value.nanoseconds >= 0 && value.nanoseconds < 1e9);
}
export const REVOCATION_EVENTS = Object.freeze([
  'ready-consumed', 'before-lock-readback', 'lock-create-succeeded', 'after-lock-readback',
  'android-result-joined', 'locked-android-readback', 'owned-lock-delete-succeeded', 'restored-readback',
]);
export function validateRevocationReceipt(receipt, id, preflight, finalReadback) {
  runId(id);
  assert.deepEqual(Object.keys(receipt).sort(lexical), [
    'afterCreate', 'afterDelete', 'beforeCreate', 'createAttempts', 'deleteAttempts', 'deleteCheckedWriteTime',
    'errors', 'events', 'lock', 'lockObservedWriteTime', 'lockWriteTime', 'lockedAndroidReadback',
    'method', 'positiveReadyReads', 'ready', 'runId', 'version',
  ].sort(lexical));
  assert.equal(receipt.version, 1); assert.equal(receipt.runId, id); assert.equal(receipt.method, REVOCATION.method);
  assertRevocationReady(receipt.ready, id); assert.equal(receipt.positiveReadyReads, 1);
  assert.equal(receipt.createAttempts, 1); assert.equal(receipt.deleteAttempts, 1);
  assert.deepEqual(receipt.lock, revocationLockFixture(id)); assert.deepEqual(receipt.errors, []);
  assert.deepEqual(receipt.events, REVOCATION_EVENTS);
  assertWriteTime(receipt.lockWriteTime); assertWriteTime(receipt.lockObservedWriteTime);
  assertWriteTime(receipt.deleteCheckedWriteTime);
  assert.deepEqual(receipt.lockObservedWriteTime, receipt.lockWriteTime);
  assert.deepEqual(receipt.deleteCheckedWriteTime, receipt.lockWriteTime);
  const expectedLocked = expectedLockedSnapshot(preflight, id);
  assert.deepEqual(receipt.beforeCreate, preflight, 'No premature lock or other mutation before barrier');
  assert.deepEqual(receipt.afterCreate, expectedLocked, 'Only the one exact lock may be introduced');
  assert.deepEqual(receipt.lockedAndroidReadback, expectedLocked, 'Complete post-Android sample is required before cleanup');
  assert.deepEqual(receipt.afterDelete, preflight, 'Owned lock cleanup must restore the complete original tree/accounts');
  assert.deepEqual(finalReadback, receipt.afterDelete, 'Normal readback cannot replace the separate locked readback');
  return { method: REVOCATION.method, hostBarriers: 1, completeIntermediateAdminSnapshots: 4,
    rulesUnchanged: true, claimsUnchanged: true, ownedLockRestored: true };
}
