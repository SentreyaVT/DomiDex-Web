import assert from 'node:assert/strict';
import { parseRulesOptions } from '../rules-local/run.mjs';
import { PROJECT, SERIAL, AVD, normalize, validRunId as existingRunId, assertNoInstrumentation } from '../android-web-price-local/contract.mjs';
export { PROJECT, SERIAL, AVD, normalize, assertNoInstrumentation };
export const parseSessionOptions = parseRulesOptions;
export const TEST_CLASS = 'com.dominik.cardvault.data.sync.CollectionSyncSessionSdkInstrumentedTest';
export const SCENARIOS = Object.freeze([
  { key: 'healthy', owner: 'sdk-proof-collection-healthy', method: 'healthyCollectionPushAcknowledgesAndRereads' },
  { key: 'stale', owner: 'sdk-proof-collection-stale', method: 'staleSessionCannotAcknowledgeCommittedMutation' },
]);
export const OTHER_OWNER = 'sdk-proof-collection-other';
export const ACCOUNTS = Object.freeze([...SCENARIOS.map(item => item.owner), OTHER_OWNER].sort().map(uid => ({
  uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: false,
  customClaims: { appAccess: true },
  providerData: [{ providerId: 'google.com', uid: `${uid}-google`, email: `${uid}@example.invalid` }],
})));
export function validRunId(value) {
  assert.equal(typeof value, 'string', 'Run ID must be a string'); return existingRunId(value);
}
export function entryPath(scenario) {
  assert.ok(SCENARIOS.includes(scenario)); return `users/${scenario.owner}/collectionEntries/entry`;
}
export function entryFixture(scenario, runId, timestamp) {
  validRunId(runId); entryPath(scenario);
  return { syncId: 'entry', ownerUid: scenario.owner, revision: 1,
    lastMutationId: `collection-session-${runId}-${scenario.key}`, updatedAt: timestamp,
    updatedAtClient: 1700000000000, deleted: false, deletedAtClient: null,
    name: 'Synthetic collection card', setId: 'synthetic-set', setName: 'Synthetic collection set',
    collectorNumber: '001/001', language: 'GERMAN', finish: 'Normal', variant: 'Standard', rarity: 'UNKNOWN',
    quantity: 2, condition: 'Near Mint', notes: 'isolated collection session proof',
    acquisitionPriceMinor: null, acquisitionCurrency: null, acquisitionDateEpochDay: null,
    externalProductSource: null, externalProductId: null, imageUrl: null, effectOverride: null,
    sourceSetId: 'synthetic-set', sourceCardId: 'synthetic-set-001',
    binderId: 'inbox', binderSetKey: 'tcgdex-synthetic-set', binderName: 'Synthetic collection set', binderHeroAsset: null };
}
export function assertEntry(data, scenario, runId) {
  const normalized = normalize(data); const stamp = normalized?.updatedAt;
  assert.deepEqual(Object.keys(stamp ?? {}).sort(), ['nanoseconds', 'seconds']);
  assert.ok(Number.isSafeInteger(stamp.seconds) && stamp.seconds > 1700000000);
  assert.ok(Number.isSafeInteger(stamp.nanoseconds) && stamp.nanoseconds >= 0 && stamp.nanoseconds < 1e9);
  assert.deepEqual(normalized, entryFixture(scenario, runId, stamp), 'Full actual server payload, no extra or missing fields');
  return normalized;
}
export function validateInstrumentation(text, method) {
  assert.ok(SCENARIOS.some(item => item.method === method));
  assert.equal((text.match(/^OK \(1 test\)\r?$/gm) ?? []).length, 1);
  assert.ok(!/^INSTRUMENTATION_STATUS_CODE: -[1234]\r?$/m.test(text) &&
    !/INSTRUMENTATION_FAILED|FAILURES!!!|Process crashed/.test(text));
  let fields = {}; const statuses = []; const endings = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('INSTRUMENTATION_STATUS: ')) {
      const payload = line.slice('INSTRUMENTATION_STATUS: '.length); const equals = payload.indexOf('=');
      assert.ok(equals > 0); const key = payload.slice(0, equals);
      assert.ok(!Object.hasOwn(fields, key), 'Duplicate instrumentation field'); fields[key] = payload.slice(equals + 1);
    } else if (line.startsWith('INSTRUMENTATION_STATUS_CODE:')) {
      const match = /^INSTRUMENTATION_STATUS_CODE: (0|1)$/.exec(line); assert.ok(match);
      assert.equal(fields.class, TEST_CLASS); assert.equal(fields.test, method);
      assert.equal(fields.numtests, '1', 'Exact test count is mandatory in each status');
      statuses.push(Number(match[1])); fields = {};
    } else if (line.startsWith('INSTRUMENTATION_CODE:')) endings.push(line);
  }
  assert.deepEqual(fields, {}); assert.deepEqual(statuses, [1, 0]); assert.deepEqual(endings, ['INSTRUMENTATION_CODE: -1']);
  return { passed: 1, method, successEvidence: true };
}
export function validateReadback(item, phaseIndex, runId) {
  assert.ok(phaseIndex === 0 || phaseIndex === 1); validRunId(runId);
  const expected = SCENARIOS.slice(0, phaseIndex + 1);
  assert.equal(item.method, SCENARIOS[phaseIndex].method);
  assert.deepEqual(item.accounts, ACCOUNTS, 'All three nominal Google accounts and their exact claims stay unchanged');
  assert.deepEqual(item.collectionPaths, ['users', ...expected.map(value => `users/${value.owner}/collectionEntries`)].sort());
  assert.deepEqual(item.documentPaths, expected.flatMap(value => [`users/${value.owner}`, entryPath(value)]).sort());
  assert.deepEqual(item.entries?.map(value => value.path), expected.map(entryPath).sort());
  for (const scenario of expected) assertEntry(item.entries.find(value => value.path === entryPath(scenario)).data, scenario, runId);
  return { method: item.method, confirmedEntries: expected.length, unrelatedOwnerUntouched: true };
}
export function validateServerProof(proof, runId) {
  validRunId(runId); assert.equal(proof.project, PROJECT); assert.equal(proof.runId, runId);
  assert.equal(proof.verified, true); assert.equal(proof.accountUnchanged, true);
  assert.deepEqual(proof.errors, []); assert.deepEqual(proof.readbackErrors, []);
  assert.equal(proof.error, undefined);
  assert.deepEqual(proof.phases, SCENARIOS.map(({ method }) => ({ passed: 1, method, successEvidence: true })));
  assert.deepEqual(proof.readbacks?.map(item => item.method), SCENARIOS.map(item => item.method));
  proof.readbacks.forEach((item, index) => validateReadback(item, index, runId));
  assert.deepEqual(proof.readbacks[1].entries[0], proof.readbacks[0].entries[0], 'Stale-owner test must not rewrite healthy owner');
  return { verified: true, androidCases: 2, independentAdminReadbacks: 2, unrelatedOwnerUntouched: true,
    intermediateStaleAndFreshIdempotencyEvidence: 'Android named control SDK assertions; final state independently read by Admin' };
}
