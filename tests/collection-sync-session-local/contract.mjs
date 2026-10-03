import assert from 'node:assert/strict';
import { REVOCATION, REVOCATION_KNOWLEDGE_PATH, revocationKnowledgeFixture, validateRevocationReceipt } from './revocation.mjs';
export { REVOCATION, REVOCATION_KNOWLEDGE_PATH, revocationKnowledgeFixture, validateRevocationReceipt };
import { parseRulesOptions } from '../rules-local/run.mjs';
import { PROJECT, SERIAL, AVD, normalize, validRunId as existingRunId, assertNoInstrumentation } from '../android-web-price-local/contract.mjs';
export { PROJECT, SERIAL, AVD, normalize, assertNoInstrumentation };
export const BASELINE_PROFILE = Object.freeze({ id: 'baseline', serial: SERIAL, avd: AVD });
export const OWNED_REGRESSION_PROFILE = Object.freeze({
  id: 'owned-regression-avd', serial: 'emulator-5556', avd: 'DomiDex_R27_Regression_API36',
});
export function sessionProfile(id) {
  assert.ok(id === BASELINE_PROFILE.id || id === OWNED_REGRESSION_PROFILE.id, 'Exact fixed device profile required');
  return id === OWNED_REGRESSION_PROFILE.id ? OWNED_REGRESSION_PROFILE : BASELINE_PROFILE;
}
export function parseSessionOptions(args) {
  const paths = []; let owned = false;
  for (let index = 0; index < args.length;) {
    if (args[index] === '--owned-regression-avd') {
      assert.equal(owned, false, 'Duplicate owned regression profile'); owned = true; index++;
    } else {
      assert.ok(typeof args[index + 1] === 'string' && !args[index + 1].startsWith('--'), 'Every path option requires its path');
      paths.push(args[index], args[index + 1]); index += 2;
    }
  }
  return { ...parseRulesOptions(paths), deviceProfile: owned ? OWNED_REGRESSION_PROFILE.id : BASELINE_PROFILE.id };
}
export function assertSessionDevice(snapshot, profile) {
  assert.equal(sessionProfile(profile?.id), profile, 'Only the actual frozen fixed profile is accepted');
  assert.deepEqual(Object.keys(snapshot).sort(), ['airplane', 'api', 'avd', 'connectivity', 'qemu', 'state', 'wifi']);
  assert.equal(snapshot.state, 'device'); assert.equal(snapshot.avd, profile.avd);
  assert.equal(snapshot.qemu, '1'); assert.equal(snapshot.api, '36');
  assert.equal(snapshot.airplane, '1'); assert.equal(snapshot.wifi, '0');
  const networks = [...snapshot.connectivity.matchAll(/^\s*Active default network:\s*(.*?)\s*$/gm)].map(match => match[1]);
  assert.deepEqual(networks, ['none'], 'Exactly one observed absent default Android network required');
  return { profile: profile.id, serial: profile.serial, avd: profile.avd, api: 36, qemu: true, offline: true };
}
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
  { key: 'private-two-client', owner: 'sdk-proof-collection-private-two-client', method: 'twoClientPrivateBinderStaleEditConvergesWithoutRemoteRewrite' },
  { key: 'knowledge-listener', owner: 'sdk-proof-collection-knowledge-listener', method: 'knowledgeListenerReplacesCacheRemovesMissingAndInvalidatesOnSignOut' },
  { key: 'knowledge-malformed', owner: 'sdk-proof-collection-knowledge-malformed', method: 'malformedKnowledgeListenerRemovesOnlyExactCacheAndPreservesLocalState' },
  REVOCATION,
  { key: 'private-full-budget', owner: 'sdk-proof-collection-private-full-budget', method: 'largePrivateFullPullContinuesAfterBudgetAndRoomReopen' },
]);
const isReadOnlySession = scenario => ['session-healthy', 'session-offline', 'session-reconnect'].includes(scenario.key);
export const OTHER_OWNER = 'sdk-proof-collection-other';
const lexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export const KNOWLEDGE_PATH = `scanKnowledge/${'1'.repeat(64)}`;
export const KNOWLEDGE_MISSING_PATH = `scanKnowledge/${'2'.repeat(64)}`;
export const KNOWLEDGE_MALFORMED_PATH = `scanKnowledge/${'4'.repeat(64)}`;
export function assertKnowledgeInventoryPath(documentPath, scenario) {
  if (!documentPath.startsWith('scanKnowledge/')) return;
  if (documentPath === REVOCATION_KNOWLEDGE_PATH) {
    assert.ok(scenario === SCENARIOS[15] || scenario === SCENARIOS[16], 'Revocation seed cannot exist before its own case');
  } else if (documentPath === KNOWLEDGE_MALFORMED_PATH) {
    assert.ok(scenario === SCENARIOS[14] || scenario === SCENARIOS[15] || scenario === SCENARIOS[16], 'Malformed knowledge fixture cannot exist before its own case');
  } else {
    assert.ok(scenario === SCENARIOS[13] || scenario === SCENARIOS[14] || scenario === SCENARIOS[15] || scenario === SCENARIOS[16], 'Knowledge fixture cannot exist before its own case');
    assert.equal(documentPath, KNOWLEDGE_PATH, 'Only the exact positive or malformed knowledge seed may exist');
  }
}
export function knowledgeFixture(runId, timestamp) {
  validRunId(runId);
  return { path: KNOWLEDGE_PATH, data: {
    fingerprint: '1'.repeat(64), cardId: `sdk-knowledge-${runId}-server`,
    sourceSetId: 'synthetic-server-set', cardNumber: '101/202', status: 'STABLE',
    confidence: 91, confirmations: 7, corrections: 2, knowledgeVersion: 1, lastUpdatedAt: timestamp,
  } };
}
export function malformedKnowledgeFixture(runId, timestamp) {
  validRunId(runId);
  return { path: KNOWLEDGE_MALFORMED_PATH, data: {
    fingerprint: '4'.repeat(64), cardId: `sdk-knowledge-${runId}-malformed-server`,
    sourceSetId: 'synthetic-server-set', cardNumber: '101/202', status: 'STABLE',
    confidence: 91, confirmations: 7, corrections: 2, knowledgeVersion: '1', lastUpdatedAt: timestamp,
  } };
}
export const FULL_BUDGET_PARENT = 'users/sdk-proof-collection-private-full-budget';
export const FULL_BUDGET_COLLECTION = `${FULL_BUDGET_PARENT}/privateBinders`;
export const FULL_BUDGET_PATHS = Object.freeze(Array.from({ length: 1001 }, (_, index) =>
  `${FULL_BUDGET_COLLECTION}/paging-${String(index).padStart(4, '0')}`));
const fullBudgetDocuments = new Set(FULL_BUDGET_PATHS);
// Only this final scenario may extend the ordinary inventory with these exact
// 1001 references and their still-missing owner parent. Unknown paths are errors,
// not ignored records; the generic 16-collection/32-reference limits stay intact.
export function isFullBudgetInventoryPath(documentPath, scenario) {
  if (documentPath !== FULL_BUDGET_PARENT && !documentPath.startsWith(`${FULL_BUDGET_PARENT}/`)) return false;
  assert.equal(scenario, SCENARIOS[16], 'Large fixture is allowed only during its exact final scenario');
  assert.ok(documentPath === FULL_BUDGET_PARENT || fullBudgetDocuments.has(documentPath), 'Unexpected large-owner reference');
  return true;
}
export function fullBudgetBinderFixture(documentPath, runId, timestamp) {
  validRunId(runId); assert.ok(fullBudgetDocuments.has(documentPath), 'Exact paging identity required');
  const binderId = documentPath.slice(FULL_BUDGET_COLLECTION.length + 1);
  return { path: documentPath, data: {
    binderId, ownerUid: SCENARIOS[16].owner, name: `Synthetic paging binder ${binderId}`,
    description: null, coverStyle: 'DOMIDEX', minimumPageCount: 1,
    createdAtClient: 1700000000000, updatedAtClient: 1700000000000,
    lastOpenedAtClient: null, deleted: false, revision: 1,
    lastMutationId: `private-full-${runId}-${binderId}`, updatedAt: timestamp,
  } };
}
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
export function twoClientPrivateBinderFixture(runId, timestamp) {
  validRunId(runId);
  const ownerUid = SCENARIOS[12].owner;
  return { path: `users/${ownerUid}/privateBinders/private-two-client-binder`, data: {
    binderId: 'private-two-client-binder', ownerUid, name: 'Synthetic pair winner',
    description: 'A revision two', coverStyle: 'DOMIDEX', minimumPageCount: 3,
    createdAtClient: 1700000000000, updatedAtClient: 1700000000010,
    lastOpenedAtClient: 1700000000010, deleted: false, revision: 2,
    lastMutationId: `private-pair-${runId}-a-edit`, updatedAt: timestamp,
  } };
}
export function assertTwoClientPrivateBinder(data, runId) {
  const normalized = normalize(data);
  assert.deepEqual(normalized, twoClientPrivateBinderFixture(runId, confirmedStamp(normalized)).data,
    'Exact real winner revision2; the stale B mutation must never rewrite the binder');
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
  if (scenario.key === 'knowledge-listener') return [knowledgeFixture(runId, timestamp)];
  if (scenario.key === 'knowledge-malformed') return [malformedKnowledgeFixture(runId, timestamp)];
  if (scenario === REVOCATION) return [revocationKnowledgeFixture(runId, timestamp)];
  if (scenario.key === 'private-full-budget') return FULL_BUDGET_PATHS.map(documentPath => fullBudgetBinderFixture(documentPath, runId, timestamp));
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
  assert.notEqual(scenario.key, 'private-two-client', 'Two-client private-only case must never create a collection entry');
  assert.notEqual(scenario.key, 'private-full-budget', 'Read-only paging case must never create a collection entry');
  assert.notEqual(scenario.key, 'knowledge-listener', 'Read-only knowledge case must never create a collection entry');
  assert.notEqual(scenario.key, 'knowledge-malformed', 'Read-only malformed knowledge case must never create a collection entry');
  assert.notEqual(scenario.key, 'knowledge-revoked', 'Revocation listener case must never create a collection entry');
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
  const normalized = normalize(seed.data);
  const stamp = confirmedStamp(['knowledge-listener', 'knowledge-malformed', 'knowledge-revoked'].includes(scenario.key) ? { updatedAt: normalized.lastUpdatedAt } : normalized);
  const expected = scenario.key === 'private-full-budget'
    ? fullBudgetBinderFixture(seed.path, runId, stamp)
    : seedFixtures(scenario, runId, stamp).find(item => item.path === seed.path);
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
    } else if (['deferred-point-read', 'private-full-budget', 'knowledge-listener', 'knowledge-malformed', 'knowledge-revoked'].includes(scenario.key)) {
      records.push(...seedFixtures(scenario, runId, null).map(item => ({ ...item, scenario, seed: true })));
    } else if (scenario.key === 'private-offline-retry') {
      records.push({ ...offlinePrivateBinderFixture(runId, null), scenario, privateBinder: true });
    } else if (scenario.key === 'private-two-client') {
      records.push({ ...twoClientPrivateBinderFixture(runId, null), scenario, twoClientPrivateBinder: true });
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
  assert.deepEqual(item.accounts, ACCOUNTS, 'All eighteen nominal Google accounts and exact claims stay unchanged');
  const expected = expectedDocuments(phaseIndex, before, runId);
  const collections = new Set(); const documents = new Set();
  for (const { path: documentPath } of expected) {
    const parts = documentPath.split('/');
    for (let length = 1; length <= parts.length; length++) {
      (length % 2 === 0 ? documents : collections).add(parts.slice(0, length).join('/'));
    }
  }
  assert.deepEqual(item.collectionPaths, [...collections].sort(lexical));
  assert.deepEqual(item.documentPaths, [...documents].sort(lexical));
  assert.deepEqual(item.entries?.map(value => value.path), expected.map(value => value.path), 'Complete tree; never filter unknown documents');
  for (const expectedRow of expected) {
    const actual = item.entries.find(value => value.path === expectedRow.path);
    assert.deepEqual(Object.keys(actual).sort(lexical), ['data', 'path']);
    if (expectedRow.seed) assertSeed({ method: expectedRow.scenario.method, ...actual }, expectedRow.scenario, runId);
    else if (expectedRow.privateBinder) assertOfflinePrivateBinder(actual.data, runId);
    else if (expectedRow.twoClientPrivateBinder) assertTwoClientPrivateBinder(actual.data, runId);
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
    if (isReadOnlySession(scenario) || ['deferred-point-read', 'private-full-budget', 'knowledge-listener', 'knowledge-malformed', 'knowledge-revoked'].includes(scenario.key)) {
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
  assert.equal(proof.revocations?.length, 1, 'Exactly one complete revocation barrier receipt is mandatory');
  validateRevocationReceipt(proof.revocations[0], runId, proof.preflights[15], proof.readbacks[15]);
  return { verified: true, androidCases: 17, independentAdminReadbacks: 17, independentAdminPreflights: 17,
    unrelatedOwnerUntouched: true, resumedCheckpointCases: 4, actualWorkerCommitCases: 2,
    actualPrivateWorkerLateParentCases: 1,
    readOnlySessionCharacterizationCases: 2,
    readOnlyConnectivityRecoveryCases: 1,
    readOnlyDeferredPointReadCases: 1,
    actualPrivateWorkerOfflineRetryCases: 1,
    actualPrivateWorkerTwoClientConflictCases: 1,
    actualPrivateWorkerFullBudgetCases: 1,
    readOnlyKnowledgeListenerAuthCases: 1,
    readOnlyMalformedKnowledgeListenerCases: 1,
    actualKnowledgeListenerRevocationCases: 1,
    intermediateEvidence: 'Android named control SDK and Room assertions; Admin independently samples before and after each method' };
}
