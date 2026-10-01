import assert from 'node:assert/strict';
import { parseRulesOptions } from '../rules-local/run.mjs';
import { PROJECT, SERIAL, AVD, normalize, validRunId as existingRunId, assertNoInstrumentation } from '../android-web-price-local/contract.mjs';
export { PROJECT, SERIAL, AVD, normalize, assertNoInstrumentation };
export const parseSessionOptions = parseRulesOptions;
export const TEST_CLASS = 'com.dominik.cardvault.data.sync.CollectionSyncSessionSdkInstrumentedTest';
export const SCENARIOS = Object.freeze([
  { key: 'healthy', owner: 'sdk-proof-collection-healthy', method: 'healthyCollectionPushAcknowledgesAndRereads' },
  { key: 'stale', owner: 'sdk-proof-collection-stale', method: 'staleSessionCannotAcknowledgeCommittedMutation' },
  { key: 'missing', owner: 'sdk-proof-collection-missing', method: 'missingRereadRetainsCheckpoint' },
  { key: 'malformed', owner: 'sdk-proof-collection-malformed', method: 'malformedRereadRetainsCheckpoint' },
  { key: 'confirmed', owner: 'sdk-proof-collection-confirmed', method: 'confirmedRereadCompletesCheckpoint' },
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
  const entry = { syncId: 'entry', ownerUid: scenario.owner, revision: 1,
    lastMutationId: `collection-session-${runId}-${scenario.key}`, updatedAt: timestamp,
    updatedAtClient: 1700000000000, deleted: false, deletedAtClient: null,
    name: 'Synthetic collection card', setId: 'synthetic-set', setName: 'Synthetic collection set',
    collectorNumber: '001/001', language: 'GERMAN', finish: 'Normal', variant: 'Standard', rarity: 'UNKNOWN',
    quantity: 2, condition: 'Near Mint', notes: 'isolated collection session proof',
    acquisitionPriceMinor: null, acquisitionCurrency: null, acquisitionDateEpochDay: null,
    externalProductSource: null, externalProductId: null, imageUrl: null, effectOverride: null,
    sourceSetId: 'synthetic-set', sourceCardId: 'synthetic-set-001',
    binderId: 'inbox', binderSetKey: 'tcgdex-synthetic-set', binderName: 'Synthetic collection set', binderHeroAsset: null };
  if (scenario.key === 'malformed') delete entry.name;
  return entry;
}
export function assertEntry(data, scenario, runId) {
  assert.notEqual(scenario.key, 'missing', 'The missing reread owner must have no server document');
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
  assert.ok(Number.isInteger(phaseIndex) && phaseIndex >= 0 && phaseIndex < SCENARIOS.length); validRunId(runId);
  const expected = SCENARIOS.slice(0, phaseIndex + 1).filter(value => value.key !== 'missing');
  assert.equal(item.method, SCENARIOS[phaseIndex].method);
  assert.deepEqual(item.accounts, ACCOUNTS, 'All six nominal Google accounts and their exact claims stay unchanged');
  assert.deepEqual(item.collectionPaths, ['users', ...expected.map(value => `users/${value.owner}/collectionEntries`)].sort());
  assert.deepEqual(item.documentPaths, expected.flatMap(value => [`users/${value.owner}`, entryPath(value)]).sort());
  assert.deepEqual(item.entries?.map(value => value.path), expected.map(entryPath).sort());
  for (const scenario of expected) assertEntry(item.entries.find(value => value.path === entryPath(scenario)).data, scenario, runId);
  return { method: item.method, serverDocuments: expected.length, unrelatedOwnerUntouched: true };
}
export function validateReadbacks(readbacks, seeds, runId) {
  assert.ok(Array.isArray(readbacks) && readbacks.length > 0 && readbacks.length <= SCENARIOS.length);
  const seeded = SCENARIOS.slice(0, readbacks.length).filter(value => value.key === 'malformed' || value.key === 'confirmed');
  assert.deepEqual(seeds?.map(value => value.method), seeded.map(value => value.method), 'Exactly the just-in-time resumed-checkpoint seeds');
  for (const [index, item] of readbacks.entries()) {
    validateReadback(item, index, runId);
    if (index > 0) for (const previous of readbacks[index - 1].entries) {
      assert.deepEqual(item.entries.find(value => value.path === previous.path), previous, 'Earlier owner documents must stay byte-for-field unchanged');
    }
  }
  for (const [index, scenario] of seeded.entries()) {
    const seed = seeds[index];
    assert.deepEqual(Object.keys(seed).sort(), ['data', 'method', 'path']);
    assert.equal(seed.path, entryPath(scenario)); assertEntry(seed.data, scenario, runId);
    const readback = readbacks.find(value => value.method === scenario.method);
    assert.deepEqual(readback.entries.find(value => value.path === seed.path), { path: seed.path, data: seed.data },
      'Resumed-checkpoint reread must not rewrite the actual Admin seed, including its server timestamp');
  }
}
export function validateServerProof(proof, runId) {
  validRunId(runId); assert.equal(proof.project, PROJECT); assert.equal(proof.runId, runId);
  assert.equal(proof.verified, true); assert.equal(proof.accountUnchanged, true);
  assert.deepEqual(proof.errors, []); assert.deepEqual(proof.readbackErrors, []);
  assert.equal(proof.error, undefined);
  assert.deepEqual(proof.phases, SCENARIOS.map(({ method }) => ({ passed: 1, method, successEvidence: true })));
  assert.deepEqual(proof.readbacks?.map(item => item.method), SCENARIOS.map(item => item.method));
  validateReadbacks(proof.readbacks, proof.seeds, runId);
  return { verified: true, androidCases: 5, independentAdminReadbacks: 5, unrelatedOwnerUntouched: true,
    resumedCheckpointCases: 3, actualWorkerCommitCases: 2,
    intermediateStaleAndFreshIdempotencyEvidence: 'Android named control SDK assertions; final state independently read by Admin' };
}
