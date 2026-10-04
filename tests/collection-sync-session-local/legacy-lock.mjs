// Separate synthetic legacy state, not the production fresh-deletion workflow.
import assert from 'node:assert/strict';
import { PROJECT, OTHER_OWNER, validRunId } from './contract.mjs';
import { CONSUMER, startIsActive, validateConsumerInstrumentation } from './consumer-access.mjs';
import { canonicalAccount } from './deletion-workflow.mjs';
import { assertRevocationDeviceResult, revocationReadyExists } from './revocation.mjs';
import { assertMutationTime } from './revocation-mutation.mjs';
export { canonicalAccount };
export const LEGACY = Object.freeze({ key: 'knowledge-legacy-lock', owner: 'sdk-proof-collection-knowledge-legacy-lock',
  method: 'legacyDeletionLockWithoutAccessFenceInvalidatesSharedKnowledgeConsumer' });
export const KNOWLEDGE = 'scanKnowledge/' + 'a'.repeat(64), ACCESS = 'accountAccess/' + LEGACY.owner;
export const LOCK = 'accountDeletionLocks/' + LEGACY.owner, BUCKET = PROJECT + '.appspot.com';
export const ACCOUNTS = Object.freeze([LEGACY.owner, OTHER_OWNER].sort().map(uid => ({ uid,
  email: uid + '@example.invalid', emailVerified: true, disabled: false, customClaims: { appAccess: true },
  providerData: [{ providerId: 'google.com', uid: uid + '-google', email: uid + '@example.invalid' }] })));
export const readyPath = run => `files/domidex-knowledge-legacy-lock-sdk-${validRunId(run)}/ready.txt`;
export const readyText = run => `v1|${validRunId(run)}|${LEGACY.owner}|${LEGACY.method}|${'a'.repeat(64)}\n`;
export const jobId = run => { validRunId(run); return [run.slice(0, 8), run.slice(8, 12), run.slice(12, 16), run.slice(16, 20), run.slice(20)].join('-'); };
export const jobPath = run => 'accountDeletionJobs/' + jobId(run);
const sorted = rows => rows.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
export const emptySnapshot = () => ({ entries: [], documentPaths: [], collectionPaths: [], accounts: [],
  storage: { current: [], versions: [], requestedSoftDeleted: [] } });
export function seedData(run, timestamp) {
  validRunId(run);
  return sorted([{ path: KNOWLEDGE, data: { fingerprint: 'a'.repeat(64), cardId: `sdk-knowledge-${run}-legacy-lock-server`,
    sourceSetId: 'synthetic-server-set', cardNumber: '101/202', status: 'STABLE', confidence: 91,
    confirmations: 7, corrections: 2, knowledgeVersion: 1, lastUpdatedAt: timestamp } },
  { path: 'accountAccess/' + OTHER_OWNER, data: { appAccess: true, pretester: false, fixtureRun: run } },
  ...[LEGACY.owner, OTHER_OWNER].flatMap(uid => [
    { path: `users/${uid}`, data: { fixtureRun: run, label: 'synthetic-root' } },
    { path: `users/${uid}/preferences/proof`, data: { fixtureRun: run, value: 'synthetic-private' } },
  ])]);
}
export function legacyData(run, now) {
  assert.ok(Number.isSafeInteger(now) && now > 0 && Number.isSafeInteger(now + 65 * 60_000));
  return sorted([{ path: LOCK, data: { jobId: jobId(run), startedAt: now } },
    { path: jobPath(run), data: { uid: LEGACY.owner, startedAt: now, status: 'STARTED',
      settleAfter: now + 65 * 60_000, leaseUntil: 0 } }]);
}
function shape(value) {
  assert.deepEqual(Object.keys(value).sort(), ['accounts', 'collectionPaths', 'documentPaths', 'entries', 'storage']);
  assert.ok(value.entries.length <= 8 && value.documentPaths.length <= 8 && value.collectionPaths.length <= 8);
  assert.deepEqual(value.entries, sorted(value.entries)); assert.equal(new Set(value.entries.map(r => r.path)).size, value.entries.length);
  const documents = new Set(), collections = new Set();
  for (const row of value.entries) {
    assert.deepEqual(Object.keys(row).sort(), ['data', 'path', 'writeTime']); assertMutationTime(row.writeTime);
    const parts = row.path.split('/'); assert.ok(parts.length === 2 || parts.length === 4);
    for (let n = 2; n <= parts.length; n += 2) { documents.add(parts.slice(0, n).join('/')); collections.add(parts.slice(0, n - 1).join('/')); }
  }
  const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  assert.deepEqual(value.documentPaths, [...documents].sort(lexical)); assert.deepEqual(value.collectionPaths, [...collections].sort(lexical));
  assert.deepEqual(value.storage, emptySnapshot().storage);
  assert.equal(value.accounts.length, 2); assert.deepEqual(value.accounts.map(a => a.uid), ACCOUNTS.map(a => a.uid));
  assert.equal(value.entries.some(r => r.path === ACCESS), false, 'Own access document must remain absent throughout');
}
const identity = value => Object.fromEntries(['uid', 'email', 'emailVerified', 'disabled', 'customClaims', 'providerData'].map(k => [k, value[k]]));
function stableOwner(value, allowSignIn = false) {
  const result = structuredClone(value); delete result.tokensValidAfterTime;
  if (allowSignIn && result.metadata) { delete result.metadata.lastSignInTime; delete result.metadata.lastRefreshTime; }
  return result;
}
export function validateSeed(value, run) {
  shape(value); const stamp = value.entries.find(r => r.path === KNOWLEDGE)?.data.lastUpdatedAt; assertMutationTime(stamp);
  assert.deepEqual(value.entries.map(({ path, data }) => ({ path, data })), seedData(run, stamp));
  assert.deepEqual(value.accounts.map(identity), ACCOUNTS); return value;
}
export function validateBeforeMutation(value, seed, run) {
  validateSeed(value, run); validateSeed(seed, run); assert.deepEqual(value.entries, seed.entries);
  for (const before of seed.accounts) {
    const after = value.accounts.find(a => a.uid === before.uid);
    assert.deepEqual(before.uid === LEGACY.owner ? stableOwner(after, true) : after,
      before.uid === LEGACY.owner ? stableOwner(before, true) : before);
  }
  return value;
}
export function validateMutation(value, before, run, now, disabled) {
  shape(value); validateSeed(before, run); assert.equal(typeof disabled, 'boolean');
  assert.deepEqual(value.entries.map(({ path, data }) => ({ path, data })),
    sorted([...before.entries.map(({ path, data }) => ({ path, data })), ...legacyData(run, now)]));
  for (const row of before.entries) assert.deepEqual(value.entries.find(r => r.path === row.path), row, 'Seed/foreign/Knowledge data or updateTime changed');
  assert.deepEqual(value.accounts.find(a => a.uid === OTHER_OWNER), before.accounts.find(a => a.uid === OTHER_OWNER));
  const owner = value.accounts.find(a => a.uid === LEGACY.owner), old = before.accounts.find(a => a.uid === LEGACY.owner);
  if (!disabled) assert.deepEqual(owner, old);
  else {
    assert.deepEqual(stableOwner(owner), { ...stableOwner(old), disabled: true });
    assert.ok(Number.isFinite(Date.parse(owner.tokensValidAfterTime)), 'Actual Auth timestamp required');
  }
  return value;
}
function translated(text) {
  assert.equal(typeof text, 'string'); assert.equal(text.includes(CONSUMER.method), false);
  return text.replaceAll(LEGACY.method, CONSUMER.method);
}
export function validateLegacyInstrumentation(text, method = LEGACY.method) {
  assert.equal(method, LEGACY.method); return { ...validateConsumerInstrumentation(translated(text)), method: LEGACY.method };
}
export function assertActive(lifecycle) {
  assert.equal(lifecycle.cancelled, false); assert.equal(startIsActive(translated(lifecycle.output), lifecycle.running), true);
}
export function assertMayContinue(lifecycle) {
  assert.equal(lifecycle.cancelled, false);
  if (lifecycle.running === true) {
    assert.equal(startIsActive(translated(lifecycle.output), true), true); return 'active-start';
  }
  assert.equal(lifecycle.running, false, 'A terminal must really be joined before it authorizes continuation');
  assert.deepEqual(lifecycle.result, { code: 0, signal: null, stopped: null, error: null });
  validateLegacyInstrumentation(lifecycle.output); return 'joined-pass';
}
export async function awaitReady(run, lifecycle, io) {
  let deadline = null;
  for (;;) {
    assert.equal(lifecycle.running, true); assert.equal(lifecycle.cancelled, false);
    const active = startIsActive(translated(lifecycle.output), lifecycle.running);
    if (active && deadline === null) deadline = io.now() + 20_000;
    if (deadline !== null) assert.ok(io.now() < deadline, 'Ready deadline');
    if (active && revocationReadyExists(await io.probeReady())) {
      assert.ok(io.now() < deadline, 'Ready probe deadline'); const value = await io.readReady();
      assertRevocationDeviceResult(value); assert.equal(value.result.code, 0);
      assert.equal(value.output, Buffer.from(readyText(run)).toString('base64'));
      assertActive(lifecycle); assert.ok(io.now() < deadline, 'Ready read deadline'); return;
    }
    await io.sleep();
  }
}
const STAGES = ['create', 'disable', 'revoke'];
export function validateStages(proof, run, requireAll = false) {
  assert.equal(proof.accountsImported, true); assert.equal(proof.seedAcknowledged, true);
  validateBeforeMutation(proof.beforeMutation, proof.seed, run); assert.equal(proof.ready, readyText(run));
  let last = proof.beforeMutation, stopped = false, previousEnd = proof.now;
  for (const name of STAGES) {
    const step = proof[name]; assert.ok(step); assert.ok(['not-started', 'acknowledged'].includes(step.outcome), 'Unknown write is not cleanup authority');
    assert.equal(step.attempts, step.outcome === 'acknowledged' ? 1 : 0);
    if (step.outcome === 'not-started') { stopped = true; assert.equal(step.snapshot, null); continue; }
    assert.equal(stopped, false, 'Mutation stages cannot be skipped');
    assert.deepEqual(step.before, last, 'Every new mutation requires a fresh exact inventory');
    assert.ok(['active-start', 'joined-pass'].includes(step.authorization));
    if (name === 'create') assert.equal(step.authorization, 'active-start');
    assert.deepEqual(step.joinedAndroid, step.authorization === 'joined-pass'
      ? { passed: 1, method: LEGACY.method, successEvidence: true } : null);
    assert.ok(Number.isSafeInteger(step.startedAt) && Number.isSafeInteger(step.returnedAt) && step.startedAt >= previousEnd && step.returnedAt >= step.startedAt);
    previousEnd = step.returnedAt; validateMutation(step.snapshot, proof.beforeMutation, run, proof.now, name !== 'create');
    if (name === 'create') {
      assert.equal(step.writeTimes.length, 2); step.writeTimes.forEach(t => { assertMutationTime(t); assert.deepEqual(t, step.writeTimes[0]); });
      for (const { path } of legacyData(run, proof.now)) assert.deepEqual(step.snapshot.entries.find(r => r.path === path).writeTime, step.writeTimes[0]);
    } else assert.deepEqual(step.snapshot.entries, last.entries);
    if (name === 'revoke') {
      const revoked = Date.parse(step.snapshot.accounts.find(a => a.uid === LEGACY.owner).tokensValidAfterTime);
      assert.ok(revoked >= Math.floor(step.startedAt / 1000) * 1000 && revoked <= Math.floor(step.returnedAt / 1000) * 1000,
        'Revocation timestamp must correspond to the real acknowledged operation');
    }
    last = step.snapshot;
  }
  if (requireAll) assert.equal(stopped, false);
  return last;
}
export function assertCleanupOwned(proof, current, run) {
  const last = validateStages(proof, run); assert.deepEqual(current, last, 'Changed fixture is not cleanup authority');
  assert.equal(proof.cleanup.firestoreOutcome, 'not-started'); assert.deepEqual(proof.cleanup.authDeleted, []);
  return last;
}
export function validateLegacyProof(proof, run) {
  assert.equal(proof.project, PROJECT); assert.equal(proof.runId, validRunId(run)); assert.equal(proof.verified, true);
  assert.deepEqual(proof.errors, []); assert.equal(proof.adminClosed, true); assert.equal(proof.realDeletionWorkflowInvoked, false);
  const last = validateStages(proof, run, true); assert.deepEqual(proof.afterAndroid, last);
  assert.deepEqual(proof.android, { passed: 1, method: LEGACY.method, successEvidence: true });
  assert.deepEqual(proof.cleanup.before, last); assert.equal(proof.cleanup.firestoreOutcome, 'acknowledged');
  assert.deepEqual(proof.cleanup.authDeleted, ACCOUNTS.map(a => a.uid));
  assert.equal(proof.cleanup.deleteTimes.length, last.entries.length);
  for (const time of proof.cleanup.deleteTimes) { assertMutationTime(time); assert.deepEqual(time, proof.cleanup.deleteTimes[0]); }
  const commit = proof.cleanup.deleteTimes[0];
  for (const row of last.entries) assert.ok(commit.seconds > row.writeTime.seconds ||
    (commit.seconds === row.writeTime.seconds && commit.nanoseconds > row.writeTime.nanoseconds));
  assert.deepEqual(proof.cleanup.after, emptySnapshot());
  return { verified: true, legacyFixtureAndRealAuthRevocation: true, accessFenceAbsent: true, knowledgeUnchanged: true,
    authWritesAfterAndroidJoin: { disable: proof.disable.authorization === 'joined-pass', revoke: proof.revoke.authorization === 'joined-pass' },
    fixtureRemovalOnly: true, productionDeletionWorkflowProved: false, naturalExpiryProved: false, isolatedListenerCauseProved: false };
}
