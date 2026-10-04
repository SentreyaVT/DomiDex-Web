// Pure fixed singleton contract; original18 and consumer-only contracts are unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PROJECT, OTHER_OWNER, validRunId } from './contract.mjs';
import { CONSUMER, startIsActive, validateConsumerInstrumentation } from './consumer-access.mjs';
import { assertRevocationDeviceResult, revocationReadyExists } from './revocation.mjs';
import { assertMutationTime } from './revocation-mutation.mjs';
export const WORKFLOW = Object.freeze({ key: 'knowledge-deletion-workflow',
  owner: 'sdk-proof-collection-knowledge-deletion-workflow',
  method: 'deletionRequestWorkflowInvalidatesSharedKnowledgeConsumer' });
export const KNOWLEDGE = 'scanKnowledge/' + 'a'.repeat(64);
export const ACCESS = 'accountAccess/' + WORKFLOW.owner;
export const LOCK = 'accountDeletionLocks/' + WORKFLOW.owner;
export const BUCKET = PROJECT + '.appspot.com';
const hash = text => createHash('sha256').update(text).digest('hex');
const sort = rows => rows.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
export const ACCOUNTS = Object.freeze([WORKFLOW.owner, OTHER_OWNER].sort().map(uid => ({ uid,
  email: uid + '@example.invalid', emailVerified: true, disabled: false, customClaims: { appAccess: true },
  providerData: [{ providerId: 'google.com', uid: uid + '-google', email: uid + '@example.invalid' }] })));
export const readyPath = run => `files/domidex-knowledge-deletion-workflow-sdk-${validRunId(run)}/ready.txt`;
export const readyText = run => `v1|${validRunId(run)}|${WORKFLOW.owner}|${WORKFLOW.method}|${'a'.repeat(64)}\n`;
export function seedData(run, timestamp) {
  validRunId(run);
  return sort([{ path: KNOWLEDGE, data: { fingerprint: 'a'.repeat(64),
    cardId: `sdk-knowledge-${run}-deletion-workflow-server`, sourceSetId: 'synthetic-server-set',
    cardNumber: '101/202', status: 'STABLE', confidence: 91, confirmations: 7, corrections: 2,
    knowledgeVersion: 1, lastUpdatedAt: timestamp } },
  ...[WORKFLOW.owner, OTHER_OWNER].flatMap(uid => [
    { path: `accountAccess/${uid}`, data: { appAccess: true, pretester: false, fixtureRun: run, label: 'synthetic-preserve-until-owned-cleanup' } },
    { path: `users/${uid}`, data: { fixtureRun: run, label: 'synthetic-root' } },
    { path: `users/${uid}/preferences/proof`, data: { fixtureRun: run, value: 'synthetic-private' } },
  ])]);
}
function tree(entries) {
  const refs = new Set(), collections = new Set();
  for (const { path } of entries) {
    const parts = path.split('/'); assert.ok(parts.length === 2 || parts.length === 4);
    for (let length = 2; length <= parts.length; length += 2) {
      refs.add(parts.slice(0, length).join('/')); collections.add(parts.slice(0, length - 1).join('/'));
    }
  }
  return { documentPaths: [...refs].sort((a, b) => a < b ? -1 : a > b ? 1 : 0), collectionPaths: [...collections].sort((a, b) => a < b ? -1 : a > b ? 1 : 0) };
}
function shape(snapshot) {
  assert.deepEqual(Object.keys(snapshot).sort(), ['accounts', 'collectionPaths', 'documentPaths', 'entries', 'storage']);
  assert.ok(snapshot.entries.length <= 24 && snapshot.collectionPaths.length <= 12 && snapshot.documentPaths.length <= 28);
  assert.deepEqual(snapshot.entries, sort(snapshot.entries));
  assert.equal(new Set(snapshot.entries.map(row => row.path)).size, snapshot.entries.length);
  snapshot.entries.forEach(row => { assert.deepEqual(Object.keys(row).sort(), ['data', 'path', 'writeTime']); assertMutationTime(row.writeTime); });
  assert.deepEqual({ documentPaths: snapshot.documentPaths, collectionPaths: snapshot.collectionPaths }, tree(snapshot.entries));
  // Actual Storage lists are captured separately for three options. Empty only: no soft-delete assertion.
  assert.deepEqual(snapshot.storage, { current: [], versions: [], requestedSoftDeleted: [] });
}
function accountIdentity(account) {
  return Object.fromEntries(['uid', 'email', 'emailVerified', 'disabled', 'customClaims', 'providerData'].map(key => [key, account[key]]));
}
// Canonicalize the complete SDK JSON shape once, including its optional undefined provider fields.
export const canonicalAccount = value => JSON.parse(JSON.stringify(value));
function stableOwner(account) {
  const value = structuredClone(account); delete value.tokensValidAfterTime;
  if (value.metadata) { delete value.metadata.lastSignInTime; delete value.metadata.lastRefreshTime; }
  return value;
}
export function validateSeed(snapshot, run) {
  shape(snapshot);
  const stamp = snapshot.entries.find(row => row.path === KNOWLEDGE)?.data.lastUpdatedAt; assertMutationTime(stamp);
  assert.deepEqual(snapshot.entries.map(({ path, data }) => ({ path, data })), seedData(run, stamp));
  assert.deepEqual(snapshot.accounts.map(accountIdentity).sort((a, b) => a.uid.localeCompare(b.uid)), ACCOUNTS);
  return snapshot;
}
export function ownedInventoryPaths() {
  const uid = WORKFLOW.owner;
  return [`users/${uid}`, `users/${uid}/preferences/proof`, ACCESS,
    ...['reportUpload', 'shareCreate', 'roleGrant'].map(policy => `privateWriteRateLimits/${policy}_${hash(policy + '\0' + uid)}`),
    `privateReadRateLimits/syncTimeAnchor_${hash('syncTimeAnchor\0' + uid)}`].sort();
}
export function pendingData(seed, run, now, jobId) {
  validRunId(run); assert.ok(Number.isSafeInteger(now) && now > 0);
  assert.match(jobId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const job = `accountDeletionJobs/${jobId}`;
  return sort([...seed.entries.filter(row => row.path === KNOWLEDGE || !row.path.includes(WORKFLOW.owner))
    .map(({ path, data }) => ({ path, data })),
    { path: ACCESS, data: { disabled: true, updatedAt: now } },
    { path: LOCK, data: { jobId, startedAt: now } },
    { path: job, data: { uid: WORKFLOW.owner, startedAt: now, status: 'PENDING_SESSION_EXPIRY',
      settleAfter: now + 65 * 60_000, sessionsRevokedAt: now, leaseUntil: 0, lease: null } },
    ...ownedInventoryPaths().map(path => ({ path: job + '/items/' + hash(`document:${path}:`),
      data: path === ACCESS ? { kind: 'document', path, done: false }
        : { kind: 'document', path, done: true, completedAt: now } })),
  ]);
}
export function validatePending(snapshot, seed, run, now, jobId) {
  shape(snapshot); validateSeed(seed, run);
  assert.deepEqual(snapshot.entries.map(({ path, data }) => ({ path, data })), pendingData(seed, run, now, jobId));
  for (const before of seed.entries.filter(row => row.path === KNOWLEDGE || !row.path.includes(WORKFLOW.owner))) {
    assert.deepEqual(snapshot.entries.find(row => row.path === before.path), before, 'Public/foreign bytes or updateTime changed');
  }
  assert.equal(snapshot.accounts.length, 2);
  assert.deepEqual(snapshot.accounts.find(account => account.uid === OTHER_OWNER), seed.accounts.find(account => account.uid === OTHER_OWNER));
  const owner = snapshot.accounts.find(account => account.uid === WORKFLOW.owner);
  assert.deepEqual(accountIdentity(owner), { ...ACCOUNTS.find(account => account.uid === WORKFLOW.owner), disabled: true });
  assert.deepEqual(stableOwner(owner), { ...stableOwner(seed.accounts.find(account => account.uid === WORKFLOW.owner)), disabled: true });
  assert.ok(Number.isFinite(Date.parse(owner.tokensValidAfterTime)), 'Real Auth revocation timestamp required');
  return snapshot;
}
export function validateRetry(first, second, seed, run, now, jobId) {
  validatePending(first, seed, run, now, jobId); validatePending(second, seed, run, now, jobId);
  // Real retry can update only the job lease writeTime. It cannot rewrite fence, lock or items.
  const withoutJobTime = value => ({ ...value, entries: value.entries.map(row => row.path === `accountDeletionJobs/${jobId}`
    ? { ...row, writeTime: null } : row) });
  assert.deepEqual(withoutJobTime(first), withoutJobTime(second));
}
function translated(text) {
  assert.equal(typeof text, 'string'); assert.equal(text.includes(CONSUMER.method), false);
  return text.replaceAll(WORKFLOW.method, CONSUMER.method);
}
export function validateWorkflowInstrumentation(text, method = WORKFLOW.method) {
  assert.equal(method, WORKFLOW.method); const value = validateConsumerInstrumentation(translated(text));
  return { ...value, method: WORKFLOW.method };
}
export function assertActive(lifecycle) {
  assert.equal(lifecycle.cancelled, false);
  assert.equal(startIsActive(translated(lifecycle.output), lifecycle.running), true);
}
export function assertRetryAllowed(lifecycle) {
  assert.equal(lifecycle.cancelled, false);
  assert.equal(lifecycle.running, false, 'Retry only after the exact child is joined');
  validateWorkflowInstrumentation(lifecycle.output);
}
export function validateBeforeRequest(before, seed, run) {
  validateSeed(before, run); validateSeed(seed, run); assert.deepEqual(before.entries, seed.entries);
  for (const account of seed.accounts) {
    const current = before.accounts.find(row => row.uid === account.uid);
    assert.deepEqual(account.uid === WORKFLOW.owner ? stableOwner(current) : current,
      account.uid === WORKFLOW.owner ? stableOwner(account) : account);
  }
}
export function assertReady(value, run) {
  assertRevocationDeviceResult(value); assert.equal(value.result.code, 0);
  assert.equal(value.output, Buffer.from(readyText(run)).toString('base64'));
}
export async function awaitReady(run, lifecycle, io) {
  let deadline = null;
  for (;;) {
    assert.equal(lifecycle.running, true); assert.equal(lifecycle.cancelled, false);
    const active = startIsActive(translated(lifecycle.output), lifecycle.running);
    if (active && deadline === null) deadline = io.now() + 20_000;
    if (deadline !== null) assert.ok(io.now() < deadline, 'Ready deadline');
    if (active && revocationReadyExists(await io.probeReady())) {
      assert.ok(io.now() < deadline, 'Ready probe exceeded deadline');
      assertReady(await io.readReady(), run); assertActive(lifecycle);
      assert.ok(io.now() < deadline, 'Ready read exceeded deadline'); return;
    }
    await io.sleep();
  }
}
export function validatePendingResponse(value, now, jobId = value?.jobId) {
  assert.match(jobId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.deepEqual(value, { jobId, status: 'PENDING_SESSION_EXPIRY', nextActionAt: now + 65 * 60_000 });
  return jobId;
}
export function assertCleanupOwned(proof, current, run) {
  assert.equal(proof.accountsImported, true); assert.equal(proof.seedAcknowledged, true);
  assert.equal(proof.requestAttempts, 1); assert.equal(proof.requestOutcome, 'acknowledged');
  let acknowledged;
  if (proof.retryOutcome === 'not-started') {
    assert.equal(proof.retryAttempts, 0); acknowledged = proof.pending;
  } else {
    assert.equal(proof.retryAttempts, 1); assert.equal(proof.retryOutcome, 'acknowledged'); acknowledged = proof.retried;
  }
  assert.ok(acknowledged); validatePending(current, proof.beforeRequest, run, proof.now, proof.jobId);
  assert.deepEqual(current, acknowledged, 'Changed owned state cannot authorize fixture removal');
  assert.equal(proof.cleanup.firestoreOutcome, 'not-started'); assert.deepEqual(proof.cleanup.authDeleted, []);
}
export function validateWorkflowProof(proof, run) {
  assert.equal(proof.project, PROJECT); assert.equal(proof.runId, validRunId(run));
  assert.equal(proof.verified, true); assert.deepEqual(proof.errors, []); assert.equal(proof.adminClosed, true);
  assert.equal(proof.accountsImported, true); assert.equal(proof.seedAcknowledged, true);
  assert.ok(Number.isSafeInteger(proof.now) && proof.now > 0);
  assert.deepEqual(proof.tokenProof, { uid: WORKFLOW.owner, provider: 'google.com',
    authTime: proof.tokenProof?.authTime, verified: true });
  assert.ok(Number.isSafeInteger(proof.tokenProof.authTime) && proof.tokenProof.authTime > 0 &&
    proof.now - proof.tokenProof.authTime >= 0 && proof.now - proof.tokenProof.authTime < 60_000);
  assert.equal(proof.ready, readyText(run)); assert.equal(proof.requestAttempts, 1); assert.equal(proof.retryAttempts, 1);
  assert.equal(proof.requestOutcome, 'acknowledged'); assert.equal(proof.retryOutcome, 'acknowledged');
  assert.equal(proof.androidJoinedBeforeRetry, true); assert.equal(proof.requestStatus, 202);
  const times = [proof.now, proof.requestStartedAt, proof.requestReturnedAt, proof.retryStartedAt, proof.retryReturnedAt];
  times.forEach((time, index) => assert.ok(Number.isSafeInteger(time) && time > 0 && (index === 0 || time >= times[index - 1])));
  validateBeforeRequest(proof.beforeRequest, proof.seed, run);
  validatePendingResponse(proof.firstResponse, proof.now, proof.jobId); validatePendingResponse(proof.retryResponse, proof.now, proof.jobId);
  validateRetry(proof.pending, proof.retried, proof.beforeRequest, run, proof.now, proof.jobId);
  assert.deepEqual(proof.android, { passed: 1, method: WORKFLOW.method, successEvidence: true });
  assert.equal(proof.cleanup.firestoreOutcome, 'acknowledged'); assert.deepEqual(proof.cleanup.authDeleted, ACCOUNTS.map(a => a.uid));
  assert.deepEqual(proof.cleanup.before, proof.retried);
  assert.equal(proof.cleanup.deleteTimes.length, proof.cleanup.before.entries.length);
  proof.cleanup.deleteTimes.forEach(time => { assertMutationTime(time); assert.deepEqual(time, proof.cleanup.deleteTimes[0]); });
  const commit = proof.cleanup.deleteTimes[0];
  for (const { writeTime: before } of proof.cleanup.before.entries) assert.ok(commit.seconds > before.seconds ||
    (commit.seconds === before.seconds && commit.nanoseconds > before.nanoseconds), 'Cleanup commit must be newer than every CAS target');
  assert.deepEqual(proof.cleanup.after, { entries: [], documentPaths: [], collectionPaths: [], accounts: [],
    storage: { current: [], versions: [], requestedSoftDeleted: [] } });
  assert.equal(proof.realFinalDeletionAttempted, false);
  return { verified: true, pendingFenceAndRetry: true, fixtureRemovalOnly: true,
    productionFinalSweepProved: false, naturalExpiryProved: false, isolatedListenerCauseProved: false };
}
