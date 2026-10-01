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
  { key: 'pending-overlay', owner: 'sdk-proof-collection-pending-overlay', method: 'pendingOverlayRereadRetainsCheckpointUntilActualAck' },
  { key: 'late-parent', owner: 'sdk-proof-collection-late-parent', method: 'lateParentPlacementIsRecoveredWithoutRemoteRewrite' },
  { key: 'session-healthy', owner: 'sdk-proof-collection-session-healthy', method: 'sessionHealthyStartConfirmsAccessWithoutRunningWorkers' },
  { key: 'session-offline', owner: 'sdk-proof-collection-session-offline', method: 'offlineSessionNeedsExplicitRecheckWithinObservedReconnectWindow' },
  { key: 'session-reconnect', owner: 'sdk-proof-collection-session-reconnect', method: 'usableConnectivitySignalRechecksActualEntitlementWithoutManualSync' },
  { key: 'deferred-point-read', owner: 'sdk-proof-collection-deferred-point-read', method: 'deferredPlacementPointReadSurvivesRoomReopenUntilParentDelivery' },
  { key: 'private-offline-retry', owner: 'sdk-proof-collection-private-offline-retry', method: 'offlinePrivateMutationSurvivesRoomReopenAndCompletesFullPull' },
]);
const isReadOnlySession = scenario => ['session-healthy', 'session-offline', 'session-reconnect'].includes(scenario.key);
export const OTHER_OWNER = 'sdk-proof-collection-other';
const lexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export const ACCOUNTS = Object.freeze([...SCENARIOS.map(item => item.owner), OTHER_OWNER].sort(lexical).map(uid => ({
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
export function finalEntryFixture(scenario, runId, timestamp) {
  const entry = entryFixture(scenario, runId, timestamp);
  return scenario.key === 'pending-overlay' ? { ...entry, revision: 2,
    lastMutationId: `collection-session-${runId}-pending-overlay-write`, quantity: 3,
    notes: 'isolated collection pending overlay', updatedAtClient: 1700000000001 } : entry;
}
export function offlinePrivateBinderFixture(runId, timestamp) {
  validRunId(runId);
  const ownerUid = SCENARIOS[11].owner;
  return { path: `users/${ownerUid}/privateBinders/offline-retry-binder`, data: {
    binderId: 'offline-retry-binder', ownerUid, name: 'Synthetic offline retry binder',
    description: null, coverStyle: 'DOMIDEX', minimumPageCount: 1,
    createdAtClient: 1700000000000, updatedAtClient: 1700000000000,
    lastOpenedAtClient: null, deleted: false, revision: 1,
    lastMutationId: `private-offline-${runId}-binder`, updatedAt: timestamp,
  } };
}
export function assertOfflinePrivateBinder(data, runId) {
  const normalized = normalize(data);
  assert.deepEqual(normalized, offlinePrivateBinderFixture(runId, confirmedStamp(normalized)).data,
    'Full worker-created binder payload, exact mutation/revision and real server timestamp');
  return normalized;
}
export function lateParentSeedFixtures(runId, timestamp) {
  validRunId(runId);
  const ownerUid = SCENARIOS[6].owner;
  const documents = ['late-parent-binder', 'late-parent-control'].map(binderId => ({
    path: `users/${ownerUid}/privateBinders/${binderId}`,
    data: { binderId, ownerUid, name: `Synthetic ${binderId}`, description: null,
      coverStyle: 'DOMIDEX', minimumPageCount: 1, createdAtClient: 1700000000000,
      updatedAtClient: 1700000000000, lastOpenedAtClient: null, deleted: false,
      revision: 1, lastMutationId: `late-parent-${runId}-${binderId}`, updatedAt: timestamp },
  }));
  documents.push({ path: `users/${ownerUid}/privateBinderPlacements/late-parent-placement`,
    data: { placementId: 'late-parent-placement', ownerUid, binderId: 'late-parent-binder',
      entrySyncId: 'entry', slotPosition: 4, holoEffectId: 'rainbow', holoIntensity: 0.5,
      createdAtClient: 1700000000000, updatedAtClient: 1700000000000, deleted: false,
      revision: 1, lastMutationId: `late-parent-${runId}-placement`, updatedAt: timestamp } });
  return documents.sort((left, right) => lexical(left.path, right.path));
}
export function deferredPointReadSeedFixtures(runId, timestamp) {
  validRunId(runId);
  const scenario = SCENARIOS[10]; const ownerUid = scenario.owner;
  return [
    { path: entryPath(scenario), data: entryFixture(scenario, runId, timestamp) },
    { path: `users/${ownerUid}/privateBinders/deferred-binder`,
      data: { binderId: 'deferred-binder', ownerUid, name: 'Synthetic deferred binder', description: null,
        coverStyle: 'DOMIDEX', minimumPageCount: 1, createdAtClient: 1700000000000,
        updatedAtClient: 1700000000000, lastOpenedAtClient: null, deleted: false,
        revision: 1, lastMutationId: `deferred-${runId}-binder`, updatedAt: timestamp } },
    { path: `users/${ownerUid}/privateBinderPlacements/deferred-placement`,
      data: { placementId: 'deferred-placement', ownerUid, binderId: 'deferred-binder',
        entrySyncId: 'entry', slotPosition: 4, holoEffectId: 'rainbow', holoIntensity: 0.5,
        createdAtClient: 1700000000000, updatedAtClient: 1700000000000, deleted: false,
        revision: 1, lastMutationId: `deferred-${runId}-placement`, updatedAt: timestamp } },
  ].sort((left, right) => lexical(left.path, right.path));
}
export function seedFixtures(scenario, runId, timestamp) {
  entryPath(scenario);
  if (scenario.key === 'late-parent') return lateParentSeedFixtures(runId, timestamp);
  if (scenario.key === 'deferred-point-read') return deferredPointReadSeedFixtures(runId, timestamp);
  return ['malformed', 'confirmed', 'pending-overlay'].includes(scenario.key)
    ? [{ path: entryPath(scenario), data: entryFixture(scenario, runId, timestamp) }] : [];
}
function confirmedStamp(data) {
  const stamp = data?.updatedAt;
  assert.deepEqual(Object.keys(stamp ?? {}).sort(lexical), ['nanoseconds', 'seconds']);
  assert.ok(Number.isSafeInteger(stamp.seconds) && stamp.seconds > 1700000000);
  assert.ok(Number.isSafeInteger(stamp.nanoseconds) && stamp.nanoseconds >= 0 && stamp.nanoseconds < 1e9);
  return stamp;
}
export function assertEntry(data, scenario, runId, stage = 'final') {
  assert.notEqual(scenario.key, 'missing', 'Missing owner must have no server document');
  assert.notEqual(scenario.key, 'private-offline-retry', 'Private-only case must never create a collection entry');
  assert.equal(isReadOnlySession(scenario), false, 'Session-only owners must never create a server entry');
  assert.ok(stage === 'seed' || stage === 'final');
  const normalized = normalize(data); const stamp = confirmedStamp(normalized);
  assert.deepEqual(normalized, stage === 'seed' ? entryFixture(scenario, runId, stamp) : finalEntryFixture(scenario, runId, stamp),
    'Full actual server payload, no extra or missing fields');
  return normalized;
}
export function assertSeed(seed, scenario, runId) {
  assert.deepEqual(Object.keys(seed).sort(lexical), ['data', 'method', 'path']);
  assert.equal(seed.method, scenario.method);
  const normalized = normalize(seed.data); const stamp = confirmedStamp(normalized);
  const expected = seedFixtures(scenario, runId, stamp).find(item => item.path === seed.path);
  assert.ok(expected, 'Only exact just-in-time seed paths are allowed');
  assert.deepEqual({ path: seed.path, data: normalized }, expected);
}
export function validateInstrumentation(text, method) {
  assert.ok(SCENARIOS.some(item => item.method === method));
  assert.equal((text.match(/^OK \(1 test\)\r?$/gm) ?? []).length, 1);
  assert.ok(!/^INSTRUMENTATION_STATUS_CODE: -[1234]\r?$/m.test(text) && !/INSTRUMENTATION_FAILED|FAILURES!!!|Process crashed/.test(text));
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
function expectedDocuments(phaseIndex, before, runId) {
  const records = [];
  for (let index = 0; index <= phaseIndex; index++) {
    const scenario = SCENARIOS[index];
    if (before && index === phaseIndex) {
      records.push(...seedFixtures(scenario, runId, null).map(item => ({ ...item, scenario, seed: true })));
    } else if (scenario.key === 'deferred-point-read') {
      records.push(...seedFixtures(scenario, runId, null).map(item => ({ ...item, scenario, seed: true })));
    } else if (scenario.key === 'private-offline-retry') {
      records.push({ ...offlinePrivateBinderFixture(runId, null), scenario, privateBinder: true });
    } else if (scenario.key !== 'missing' && !isReadOnlySession(scenario)) {
      if (scenario.key === 'late-parent') records.push(...lateParentSeedFixtures(runId, null).map(item => ({ ...item, scenario, seed: true })));
      records.push({ path: entryPath(scenario), scenario, seed: false });
    }
  }
  return records.sort((left, right) => lexical(left.path, right.path));
}
function validateTree(item, phaseIndex, runId, before) {
  assert.ok(Number.isInteger(phaseIndex) && phaseIndex >= 0 && phaseIndex < SCENARIOS.length); validRunId(runId);
  assert.equal(item.method, SCENARIOS[phaseIndex].method);
  assert.deepEqual(item.accounts, ACCOUNTS, 'All thirteen nominal Google accounts and exact claims stay unchanged');
  const expected = expectedDocuments(phaseIndex, before, runId);
  const collections = new Set(); const documents = new Set();
  for (const { path: documentPath } of expected) {
    const parts = documentPath.split('/');
    collections.add(parts[0]); collections.add(parts.slice(0, 3).join('/'));
    documents.add(parts.slice(0, 2).join('/')); documents.add(documentPath);
  }
  assert.deepEqual(item.collectionPaths, [...collections].sort(lexical));
  assert.deepEqual(item.documentPaths, [...documents].sort(lexical));
  assert.deepEqual(item.entries?.map(value => value.path), expected.map(value => value.path), 'Complete tree; never filter unknown documents');
  for (const expectedRow of expected) {
    const actual = item.entries.find(value => value.path === expectedRow.path);
    assert.deepEqual(Object.keys(actual).sort(lexical), ['data', 'path']);
    if (expectedRow.seed) assertSeed({ method: expectedRow.scenario.method, ...actual }, expectedRow.scenario, runId);
    else if (expectedRow.privateBinder) assertOfflinePrivateBinder(actual.data, runId);
    else assertEntry(actual.data, expectedRow.scenario, runId);
  }
  return { method: item.method, serverDocuments: expected.length, unrelatedOwnerUntouched: true };
}
export function validateReadback(item, phaseIndex, runId) { return validateTree(item, phaseIndex, runId, false); }
function assertPreviousEntriesUnchanged(item, previous) {
  if (previous) for (const row of previous.entries) {
    assert.deepEqual(item.entries.find(value => value.path === row.path), row, 'Earlier owners stay fully unchanged');
  }
}
export function validatePreflight(item, phaseIndex, runId, previous, seeds) {
  const result = validateTree(item, phaseIndex, runId, true);
  assertPreviousEntriesUnchanged(item, previous);
  const scenario = SCENARIOS[phaseIndex];
  assert.deepEqual(seeds?.map(value => value.path), seedFixtures(scenario, runId, null).map(value => value.path));
  for (const seed of seeds) {
    assertSeed(seed, scenario, runId);
    assert.deepEqual(item.entries.find(value => value.path === seed.path), { path: seed.path, data: seed.data });
  }
  return result;
}
export function validateReadbacks(readbacks, seeds, runId, preflights) {
  assert.ok(Array.isArray(readbacks) && readbacks.length > 0 && readbacks.length <= SCENARIOS.length);
  assert.equal(preflights?.length, readbacks.length, 'One complete Admin preflight per attempted method');
  const expectedSeeds = SCENARIOS.slice(0, readbacks.length).flatMap(scenario =>
    seedFixtures(scenario, runId, null).map(item => ({ method: scenario.method, path: item.path })));
  assert.deepEqual(seeds?.map(({ method, path }) => ({ method, path })), expectedSeeds, 'Exact seed registry and order');
  for (const [index, item] of readbacks.entries()) {
    const scenario = SCENARIOS[index];
    const currentSeeds = seeds.filter(value => value.method === scenario.method);
    validatePreflight(preflights[index], index, runId, readbacks[index - 1], currentSeeds);
    validateReadback(item, index, runId);
    assertPreviousEntriesUnchanged(item, readbacks[index - 1]);
    if (isReadOnlySession(scenario) || scenario.key === 'deferred-point-read') {
      // Includes method, all accounts, every collection/document reference,
      // and every field/timestamp in every existing document. No filter drops
      // an unexpected owner, sidecar or access override before comparison.
      assert.deepEqual(item, preflights[index], 'Read-only case must leave the complete Admin tree and identities unchanged');
    }
    for (const seed of currentSeeds) {
      const observed = item.entries.find(value => value.path === seed.path);
      if (scenario.key === 'pending-overlay') {
        const before = confirmedStamp(seed.data); const after = confirmedStamp(observed.data);
        assert.ok(after.seconds > before.seconds || (after.seconds === before.seconds && after.nanoseconds >= before.nanoseconds),
          'ACK timestamp must not predate the actual seed');
        // Full final payload has already been checked; only six agreed fields differ.
        assert.deepEqual(observed.data, finalEntryFixture(scenario, runId, after));
      } else assert.deepEqual(observed, { path: seed.path, data: seed.data }, 'Seeds including timestamps are immutable');
    }
  }
}
export function validateServerProof(proof, runId) {
  validRunId(runId); assert.equal(proof.project, PROJECT); assert.equal(proof.runId, runId);
  assert.equal(proof.verified, true); assert.equal(proof.accountUnchanged, true);
  assert.deepEqual(proof.errors, []); assert.deepEqual(proof.readbackErrors, []); assert.equal(proof.error, undefined);
  assert.deepEqual(proof.phases, SCENARIOS.map(({ method }) => ({ passed: 1, method, successEvidence: true })));
  assert.deepEqual(proof.readbacks?.map(item => item.method), SCENARIOS.map(item => item.method));
  assert.deepEqual(proof.preflights?.map(item => item.method), SCENARIOS.map(item => item.method));
  validateReadbacks(proof.readbacks, proof.seeds, runId, proof.preflights);
  return { verified: true, androidCases: 12, independentAdminReadbacks: 12, independentAdminPreflights: 12,
    unrelatedOwnerUntouched: true, resumedCheckpointCases: 4, actualWorkerCommitCases: 2,
    actualPrivateWorkerLateParentCases: 1,
    readOnlySessionCharacterizationCases: 2,
    readOnlyConnectivityRecoveryCases: 1,
    readOnlyDeferredPointReadCases: 1,
    actualPrivateWorkerOfflineRetryCases: 1,
    intermediateEvidence: 'Android named control SDK and Room assertions; Admin independently samples before and after each method' };
}
