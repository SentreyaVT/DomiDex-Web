// Pure fail-closed contract tests; these do not run Android or establish SDK evidence.
import test from 'node:test';
import { MUTATION, MUTATION_PATH, MUTATION_LOCK_PATH, MUTATION_EVENTS, mutationFixture, mutationLock,
  mutationReadyText, mutationReadyPath, assertMutationReadyRead, mutationStartIsActive, assertMutationMayWrite,
  mutationSeed, mutationSnapshot, createMutationState, validateMutationReceipt, beginMutation, finishMutation } from './revocation-mutation.mjs';
import { Buffer } from 'node:buffer';
import { REVOCATION, REVOCATION_CLASS, REVOCATION_KNOWLEDGE_PATH, REVOCATION_LOCK_PATH, REVOCATION_EVENTS,
  revocationKnowledgeFixture, revocationLockFixture, revocationReadyText, revocationReadyPath, assertRevocationReady,
  revocationStartIsActive, expectedLockedSnapshot, validateRevocationReceipt,
  assertRevocationDeviceResult, revocationReadyExists, assertRevocationReadyRead,
  assertRevocationShellV2, assertRevocationMayCreate } from './revocation.mjs';
import assert from 'node:assert/strict';
import { PROJECT, SERIAL, AVD, SCENARIOS, OTHER_OWNER, ACCOUNTS, TEST_CLASS, validRunId, parseSessionOptions,
  BASELINE_PROFILE, OWNED_REGRESSION_PROFILE, sessionProfile, assertSessionDevice,
  entryPath, entryFixture, finalEntryFixture, seedFixtures, lateParentSeedFixtures, assertEntry, assertSeed,
  offlinePrivateBinderFixture, assertOfflinePrivateBinder,
  twoClientPrivateBinderFixture, assertTwoClientPrivateBinder,
  FULL_BUDGET_PARENT, FULL_BUDGET_COLLECTION, FULL_BUDGET_PATHS, fullBudgetBinderFixture, isFullBudgetInventoryPath,
  KNOWLEDGE_PATH, KNOWLEDGE_MISSING_PATH, KNOWLEDGE_MALFORMED_PATH, knowledgeFixture, malformedKnowledgeFixture, assertKnowledgeInventoryPath,
  validateInstrumentation, validateReadback, validatePreflight, validateReadbacks, validateServerProof,
  assertNoInstrumentation } from './contract.mjs';
import { PORTS, assertTestEnvironment, isolatedEnvironment } from '../private-operations-local/safety.mjs';
const lexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const runId = 'a'.repeat(32);
const status = (method, code) => `INSTRUMENTATION_STATUS: class=${TEST_CLASS}\nINSTRUMENTATION_STATUS: test=${method}\nINSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
const instrumentation = method => status(method, 1) + status(method, 0) + '\nOK (1 test)\nINSTRUMENTATION_CODE: -1\n';
const seedStamp = scenario => ({ seconds: 1700000100 + SCENARIOS.indexOf(scenario), nanoseconds: 123000 });
const finalStamp = scenario => scenario.key === 'pending-overlay'
  ? { seconds: 1700000200 + SCENARIOS.indexOf(scenario), nanoseconds: 124000 } : seedStamp(scenario);
const documentFixture = scenario => ({ path: entryPath(scenario), data: finalEntryFixture(scenario, runId, finalStamp(scenario)) });
const scenarioSeeds = scenario => seedFixtures(scenario, runId, seedStamp(scenario))
  .map(item => ({ method: scenario.method, ...item }));
const finalDocuments = index => SCENARIOS.slice(0, index + 1).flatMap(scenario => ['missing', 'session-healthy', 'session-offline', 'session-reconnect'].includes(scenario.key) ? [] :
  ['deferred-point-read', 'private-full-budget', 'knowledge-listener', 'knowledge-malformed', 'knowledge-revoked', 'knowledge-revoked-on-data-change'].includes(scenario.key) ? seedFixtures(scenario, runId, seedStamp(scenario)) :
  scenario.key === 'private-offline-retry' ? [offlinePrivateBinderFixture(runId, finalStamp(scenario))] :
  scenario.key === 'private-two-client' ? [twoClientPrivateBinderFixture(runId, finalStamp(scenario))] :
  [...(scenario.key === 'late-parent' ? lateParentSeedFixtures(runId, seedStamp(scenario)) : []), documentFixture(scenario)]);
const snapshot = (index, before = false) => {
  const current = SCENARIOS[index];
  const entries = (before
    ? [...(index === 0 ? [] : finalDocuments(index - 1)), ...seedFixtures(current, runId, seedStamp(current))]
    : finalDocuments(index)).sort((left, right) => lexical(left.path, right.path));
  const collectionPaths = new Set(); const documentPaths = new Set();
  for (const item of entries) {
    const fields = item.path.split('/');
    for (let length = 1; length <= fields.length; length++) {
      (length % 2 === 0 ? documentPaths : collectionPaths).add(fields.slice(0, length).join('/'));
    }
  }
  return { method: current.method, accounts: structuredClone(ACCOUNTS), entries,
    collectionPaths: [...collectionPaths].sort(lexical), documentPaths: [...documentPaths].sort(lexical) };
};
const readback = index => snapshot(index);
const preflight = index => snapshot(index, true);
const revocationReceipt = before => ({
  version: 1, method: REVOCATION.method, runId, ready: revocationReadyText(runId),
  positiveReadyReads: 1, createAttempts: 1, deleteAttempts: 1, lock: revocationLockFixture(runId),
  lockWriteTime: { seconds: 1700000500, nanoseconds: 1000 },
  lockObservedWriteTime: { seconds: 1700000500, nanoseconds: 1000 },
  deleteCheckedWriteTime: { seconds: 1700000500, nanoseconds: 1000 },
  beforeCreate: structuredClone(before), afterCreate: expectedLockedSnapshot(before, runId),
  lockedAndroidReadback: expectedLockedSnapshot(before, runId), afterDelete: structuredClone(before),
  events: [...REVOCATION_EVENTS], errors: [],
});
const mutationReceipt = before => ({
  ...createMutationState(runId), ready: mutationReadyText(runId), positiveReadyReads: 1,
  createAttempts: 1, mutationAttempts: 1, cleanupAttempts: 1,
  createOutcome: 'acknowledged', mutationOutcome: 'acknowledged', cleanupOutcome: 'acknowledged',
  seed: mutationSeed(before, runId),
  seedWriteTime: { seconds: 1700000500, nanoseconds: 1000 },
  lockWriteTime: { seconds: 1700000501, nanoseconds: 1000 },
  lockObservedWriteTime: { seconds: 1700000501, nanoseconds: 1000 },
  mutationCheckedSeedTime: { seconds: 1700000500, nanoseconds: 1000 },
  mutationCheckedLockTime: { seconds: 1700000501, nanoseconds: 1000 },
  mutationWriteTime: { seconds: 1700000502, nanoseconds: 1000 },
  cleanupCheckedSeedTime: { seconds: 1700000502, nanoseconds: 1000 },
  cleanupCheckedLockTime: { seconds: 1700000501, nanoseconds: 1000 },
  restoredSeedWriteTime: { seconds: 1700000503, nanoseconds: 1000 },
  deletedLockWriteTime: { seconds: 1700000503, nanoseconds: 1000 },
  beforeCreate: structuredClone(before), afterCreate: mutationSnapshot(before, runId),
  afterMutation: mutationSnapshot(before, runId, true), lockedAndroidReadback: mutationSnapshot(before, runId, true),
  afterRestore: structuredClone(before), events: [...MUTATION_EVENTS], errors: [],
});
const proof = () => ({ project: PROJECT, runId, verified: true, accountUnchanged: true, errors: [], readbackErrors: [],
  phases: SCENARIOS.map(({ method }) => ({ passed: 1, method, successEvidence: true })),
  revocations: [revocationReceipt(preflight(15))],
  mutations: [mutationReceipt(preflight(16))],
  readbacks: SCENARIOS.map((_, index) => readback(index)),
  preflights: SCENARIOS.map((_, index) => preflight(index)),
  seeds: SCENARIOS.flatMap(scenarioSeeds) });

void test('exact demo/AVD and path-safe run ID are fixed, with no project/serial/port override', () => {
  assert.equal(PROJECT, 'demo-domidex-privacy'); assert.equal(SERIAL, 'emulator-5554'); assert.equal(AVD, 'DomiDex_R27_Baseline_API36');
  assert.equal(OTHER_OWNER, 'sdk-proof-collection-other'); assert.equal(ACCOUNTS.length, 19);
  assert.deepEqual(SCENARIOS.map(({ key }) => key), ['healthy', 'stale', 'missing', 'malformed', 'confirmed', 'pending-overlay', 'late-parent', 'session-healthy', 'session-offline', 'session-reconnect', 'deferred-point-read', 'private-offline-retry', 'private-two-client', 'knowledge-listener', 'knowledge-malformed', 'knowledge-revoked', 'knowledge-revoked-on-data-change', 'private-full-budget']);
  assert.deepEqual(PORTS, { auth: 9097, firestore: 8187, storage: 9297, hub: 4407, logging: 4507, websocket: 9150 });
  assert.equal(validRunId(runId), runId); assert.ok(parseSessionOptions(['--android-root', '.'])['--android-root']);
  for (const value of ['', '../bad', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), undefined, 1e31, {}]) assert.throws(() => validRunId(value));
  for (const args of [[], ['--android-root'], ['--android-root', '--project'], ['--android-root', '.', '--android-root', '.'],
    ['--android-root', '.', '--project', PROJECT], ['--android-root', '.', '--serial', SERIAL],
    ['--android-root', '.', '--port', '8187'], ['--android-root', '.', '--run-id', runId]]) assert.throws(() => parseSessionOptions(args));
});
void test('explicit owned AVD selects only the fixed second profile and cannot override device or project', () => {
  assert.equal(parseSessionOptions(['--android-root', '.']).deviceProfile, 'baseline');
  for (const args of [
    ['--owned-regression-avd', '--android-root', '.'],
    ['--android-root', '.', '--owned-regression-avd'],
  ]) assert.equal(sessionProfile(parseSessionOptions(args).deviceProfile), OWNED_REGRESSION_PROFILE);
  assert.deepEqual(OWNED_REGRESSION_PROFILE, {
    id: 'owned-regression-avd', serial: 'emulator-5556', avd: 'DomiDex_R27_Regression_API36',
  });
  assert.deepEqual(BASELINE_PROFILE, { id: 'baseline', serial: 'emulator-5554', avd: 'DomiDex_R27_Baseline_API36' });
  for (const args of [
    ['--android-root', '.', '--owned-regression-avd', '--owned-regression-avd'],
    ['--android-root', '.', '--owned-regression'],
    ['--android-root', '.', '--owned-regression-avd=true'],
    ['--android-root', '.', '--owned-regression-avd', 'false'],
    ['--android-root', '--owned-regression-avd', '.'],
    ['--android-root', '.', '--owned-regression-avd', '--serial', 'emulator-5554'],
    ['--android-root', '.', '--owned-regression-avd', '--avd', 'DomiDex_R27_Baseline_API36'],
    ['--android-root', '.', '--owned-regression-avd', '--project', 'production'],
    ['--android-root', '.', '--owned-regression-avd', '--port', '8080'],
  ]) assert.throws(() => parseSessionOptions(args));
  for (const id of [undefined, null, true, 'emulator-5556', 'owned-regression-avd ', 'production'])
    assert.throws(() => sessionProfile(id));
});
void test('owned AVD identity remains exact and offline without fallback to the user baseline', () => {
  const good = () => ({ state: 'device', avd: 'DomiDex_R27_Regression_API36', qemu: '1', api: '36',
    airplane: '1', wifi: '0', connectivity: 'Active default network: none' });
  assert.deepEqual(assertSessionDevice(good(), OWNED_REGRESSION_PROFILE), {
    profile: 'owned-regression-avd', serial: 'emulator-5556', avd: 'DomiDex_R27_Regression_API36', api: 36, qemu: true, offline: true,
  });
  for (const change of [
    value => { value.state = 'offline'; }, value => { value.avd = AVD; },
    value => { value.qemu = '0'; }, value => { value.api = '35'; },
    value => { value.airplane = '0'; }, value => { value.wifi = '1'; },
    value => { value.connectivity = 'Active default network: 100'; },
    value => { value.connectivity = ''; },
    value => { value.connectivity = 'Active default network: none\nActive default network: 100'; },
  ]) { const value = good(); change(value); assert.throws(() => assertSessionDevice(value, OWNED_REGRESSION_PROFILE)); }
  assert.throws(() => assertSessionDevice(good(), BASELINE_PROFILE));
  assert.throws(() => assertSessionDevice(good(), { ...OWNED_REGRESSION_PROFILE }));
});
void test('each SDK method requires exact START+PASS, mandatory numtests and final completion', () => {
  for (const { method } of SCENARIOS) {
    const valid = instrumentation(method);
    assert.deepEqual(validateInstrumentation(valid, method), { passed: 1, method, successEvidence: true });
    assert.equal(validateInstrumentation(valid.replaceAll('\n', '\r\n'), method).passed, 1);
    for (const broken of ['', valid.replace(status(method, 1), ''), valid.replace(status(method, 0), ''),
      status(method, 1) + valid, status(method, 0) + valid, valid.replaceAll('INSTRUMENTATION_STATUS: numtests=1\n', ''),
      valid.replace('numtests=1', 'numtests=2'), valid.replace('numtests=1', 'numtests=1\nINSTRUMENTATION_STATUS: numtests=1'),
      valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -1'), valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -2'),
      valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -3'), valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -4'),
      valid.replaceAll(TEST_CLASS, 'com.dominik.cardvault.data.sync.AndroidWebPriceConflictInstrumentedTest'),
      valid.replaceAll(method, 'cleanupOwnedFixture'), valid.replace('OK (1 test)', 'OK (2 tests)'),
      valid.replace('INSTRUMENTATION_CODE: -1', ''), valid + 'INSTRUMENTATION_CODE: -1\n',
      valid + 'INSTRUMENTATION_CODE: 0\n', valid + 'INSTRUMENTATION_STATUS: test=unfinished\n',
      valid + 'INSTRUMENTATION_FAILED: Process crashed\n', valid + 'FAILURES!!!\n']) assert.throws(() => validateInstrumentation(broken, method));
  }
  assert.throws(() => validateInstrumentation(instrumentation('cleanupOwnedFixture'), 'cleanupOwnedFixture'));
  assert.throws(() => validateInstrumentation(instrumentation(SCENARIOS[0].method), SCENARIOS[1].method));
});
void test('exact server fixtures reject extra/missing fields, changed identity and fabricated ACK revision', () => {
  for (const scenario of SCENARIOS.filter(value => !['missing', 'session-healthy', 'session-offline', 'session-reconnect', 'private-offline-retry', 'private-two-client', 'knowledge-listener', 'knowledge-malformed', 'knowledge-revoked', 'knowledge-revoked-on-data-change', 'private-full-budget'].includes(value.key))) {
    const make = () => finalEntryFixture(scenario, runId, { seconds: 1700000100, nanoseconds: 1234 });
    assert.equal(assertEntry(make(), scenario, runId).revision, scenario.key === 'pending-overlay' ? 2 : 1);
    for (const mutate of [value => { delete value.notes; }, value => { delete value.acquisitionPriceMinor; },
      value => { value.unexpected = true; }, value => { value.ownerUid = OTHER_OWNER; }, value => { value.syncId = 'foreign'; },
      value => { value.revision = 99; }, value => { value.lastMutationId = 'seeded-ack'; }, value => { value.quantity = 1; },
      value => { value.updatedAtClient++; }, value => { value.sourceCardId = 'foreign'; }, value => { value.binderSetKey = 'inbox'; },
      value => { value.externalProductId = 42; }, value => { value.deleted = true; }, value => { value.notes = ''; },
      value => { value.updatedAt = null; }, value => { value.updatedAt.seconds = 0; },
      value => { value.updatedAt.nanoseconds = 1e9; }, value => { value.updatedAt.extra = true; }]) {
      const value = make(); mutate(value); assert.throws(() => assertEntry(value, scenario, runId));
    }
  }
});
void test('every independent readback checks exact Google accounts, no access overrides, no other owner documents', () => {
  for (const index of SCENARIOS.keys()) {
    assert.equal(validateReadback(readback(index), index, runId).serverDocuments, finalDocuments(index).length);
    for (const mutate of [value => { value.accounts[0].customClaims.admin = true; },
      value => { value.accounts[1].customClaims = {}; }, value => { value.accounts[2].emailVerified = false; },
      value => { value.accounts[2].providerData[0].providerId = 'password'; },
      value => { value.accounts[0].providerData[0].uid = 'foreign'; }, value => { value.accounts.pop(); },
      value => { value.entries.push({ path: `users/${OTHER_OWNER}/collectionEntries/entry`, data: {} }); },
      value => { value.entries.push(documentFixture(SCENARIOS[2])); },
      value => { value.documentPaths.push(`users/${SCENARIOS[2].owner}`); },
      value => { value.collectionPaths.push('accountAccess'); }, value => { value.documentPaths.push(`accountAccess/${OTHER_OWNER}`); },
      value => { value.collectionPaths.push(`users/${OTHER_OWNER}/collectionPriceSelections`); },
      value => { value.entries[0].data.quantity = 3; }, value => { value.entries = []; },
      value => { value.documentPaths.pop(); }, value => { value.method = 'cleanupOwnedFixture'; }]) {
      const value = readback(index); mutate(value); assert.throws(() => validateReadback(value, index, runId));
    }
  }
});
void test('remote commit alone, RED, missing teardown PASS or missing readback never count as a passing session proof', () => {
  assert.equal(validateServerProof(proof(), runId).androidCases, 18);
  for (const mutate of [value => { value.verified = false; }, value => { value.accountUnchanged = false; },
    value => { value.project = 'production'; }, value => { value.runId = 'b'.repeat(32); },
    value => { value.errors.push({ method: SCENARIOS[1].method, error: 'STALE_SESSION_ACKED_COMMITTED_MUTATION' }); },
    value => { value.errors.push({ method: SCENARIOS[2].method, error: 'UNCONFIRMED_REREAD_DISCARDED_CHECKPOINT' }); },
    value => { value.readbackErrors.push({ method: SCENARIOS[1].method, error: 'server unavailable' }); },
    value => { value.error = 'Fixture cleanup failed'; }, value => { value.phases = []; },
    value => { value.phases.pop(); }, value => { value.phases.reverse(); }, value => { value.phases[1].successEvidence = false; },
    value => { value.phases[1].method = 'cleanupOwnedFixture'; }, value => { value.readbacks.pop(); },
    value => { value.readbacks.reverse(); }, value => { value.readbacks[1].entries[0].data.updatedAt.nanoseconds++; }]) {
    const value = proof(); mutate(value); assert.throws(() => validateServerProof(value, runId));
  }
});
void test('resumed-checkpoint seeds are exact, just-in-time, unchanged, and never substitute for worker-created commits', () => {
  const value = proof();
  validateReadbacks(value.readbacks.slice(0, 3), [], runId, value.preflights.slice(0, 3));
  validateReadbacks(value.readbacks.slice(0, 4), value.seeds.slice(0, 1), runId, value.preflights.slice(0, 4));
  assert.throws(() => validateReadbacks(value.readbacks.slice(0, 3), value.seeds.slice(0, 1), runId, value.preflights.slice(0, 3)));
  assert.throws(() => assertEntry(documentFixture(SCENARIOS[2]).data, SCENARIOS[2], runId));
  assert.equal(Object.hasOwn(value.seeds[0].data, 'name'), false);
  for (const mutate of [item => { delete item.seeds; }, item => { item.seeds = []; },
    item => { item.seeds.pop(); }, item => { item.seeds.reverse(); }, item => { item.seeds.push(item.seeds[0]); },
    item => { item.seeds[0].method = SCENARIOS[0].method; }, item => { item.seeds[0].path = entryPath(SCENARIOS[0]); },
    item => { item.seeds[0].extra = true; }, item => { item.seeds[0].data.name = 'Synthetic collection card'; },
    item => { item.seeds[0].data.name = null; }, item => { delete item.seeds[1].data.name; },
    item => { item.seeds[1].data.updatedAt.nanoseconds++; },
    item => { item.readbacks[3].entries.find(entry => entry.path === entryPath(SCENARIOS[3])).data.name = null; },
    item => { item.readbacks[4].entries.find(entry => entry.path === entryPath(SCENARIOS[3])).data.updatedAt.nanoseconds++; },
    item => { item.readbacks[4].entries.find(entry => entry.path === entryPath(SCENARIOS[0])).data.updatedAt.nanoseconds++; }]) {
    const broken = proof(); mutate(broken); assert.throws(() => validateServerProof(broken, runId));
  }
});
void test('reused environment and idle gates fail closed instead of inheriting credentials or authorizing force-stop', () => {
  const env = isolatedEnvironment({ GOOGLE_APPLICATION_CREDENTIALS: 'never-use', FIREBASE_TOKEN: 'never-use' },
    { directory: '/isolated/run', root: '/isolated/root', java: '/installed/java', cache: '/installed/cache', preload: '/installed/preload.cjs' });
  assertTestEnvironment(env); assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined); assert.equal(env.FIREBASE_TOKEN, undefined);
  for (const extra of [{ GCLOUD_PROJECT: 'production' }, { FIRESTORE_EMULATOR_HOST: 'remote:8187' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, { GOOGLE_APPLICATION_CREDENTIALS: 'bad' }, { HTTPS_PROXY: 'remote' }])
    assert.throws(() => assertTestEnvironment({ ...env, ...extra }));
  const idle = 'ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)\n  All known processes:\n';
  assertNoInstrumentation(idle);
  for (const text of ['', idle.replace('All known processes:', 'Unknown'), idle + 'ActiveInstrumentation{foreign/Runner}'])
    assert.throws(() => assertNoInstrumentation(text));
});
void test('every method requires a complete preflight with exact earlier owners and no premature late parent', () => {
  const valid = proof();
  for (const [index, scenario] of SCENARIOS.entries())
    validatePreflight(valid.preflights[index], index, runId, valid.readbacks[index - 1], scenarioSeeds(scenario));
  for (const mutate of [
    value => { delete value.preflights; }, value => { value.preflights.pop(); },
    value => { value.preflights.reverse(); }, value => { value.preflights[6].method = SCENARIOS[5].method; },
    value => { value.preflights[6].accounts[0].customClaims.admin = true; },
    value => { value.preflights[6].entries[0].data.updatedAt.nanoseconds++; },
    value => { value.preflights[6].entries.push(documentFixture(SCENARIOS[6])); },
    value => { value.preflights[6].collectionPaths.push(`users/${SCENARIOS[6].owner}/collectionEntries`); },
    value => { value.preflights[0].entries.push(documentFixture(SCENARIOS[0])); },
    value => { value.preflights[6].documentPaths.push('accountAccess/unexpected'); },
    value => { value.preflights[5].entries.find(item => item.path === entryPath(SCENARIOS[5])).data.revision = 2; },
  ]) {
    const broken = proof(); mutate(broken); assert.throws(() => validateServerProof(broken, runId));
  }
});
void test('pending overlay requires the exact rev1 seed and actual agreed rev2 with non-regressing confirmed time', () => {
  const scenario = SCENARIOS[5];
  const valid = proof();
  const seed = valid.seeds.find(item => item.method === scenario.method);
  assertSeed(seed, scenario, runId);
  assert.equal(assertEntry(seed.data, scenario, runId, 'seed').revision, 1);
  assert.throws(() => assertEntry(seed.data, scenario, runId));
  assert.equal(assertEntry(documentFixture(scenario).data, scenario, runId).revision, 2);
  const mutations = [
    data => { data.revision = 1; }, data => { data.lastMutationId = `collection-session-${runId}-pending-overlay`; },
    data => { data.quantity = 2; }, data => { data.notes = 'isolated collection session proof'; },
    data => { data.updatedAtClient = 1700000000000; },
    data => { data.updatedAt = { seconds: seed.data.updatedAt.seconds, nanoseconds: seed.data.updatedAt.nanoseconds - 1 }; },
    data => { data.updatedAt.seconds = seed.data.updatedAt.seconds - 1; },
    data => { data.ownerUid = OTHER_OWNER; }, data => { delete data.imageUrl; }, data => { data.extra = true; },
  ];
  for (const mutate of mutations) {
    const broken = proof();
    mutate(broken.readbacks[5].entries.find(item => item.path === entryPath(scenario)).data);
    assert.throws(() => validateServerProof(broken, runId));
  }
  for (const mutate of [
    value => { value.seeds.find(item => item.method === scenario.method).data.revision = 2; },
    value => { value.seeds.find(item => item.method === scenario.method).data.lastMutationId += '-write'; },
    value => { value.preflights[5].entries.find(item => item.path === entryPath(scenario)).data.quantity = 3; },
    value => { value.readbacks[6].entries.find(item => item.path === entryPath(scenario)).data.updatedAt.nanoseconds++; },
    value => { value.errors.push({ method: scenario.method, error: 'pending checkpoint lost' }); },
  ]) {
    const broken = proof(); mutate(broken); assert.throws(() => validateServerProof(broken, runId));
  }
  // Timestamp equality at emulator resolution is legal; it is not claimed to be
  // an independently unique clock tick. All six payload changes are still exact.
  const equal = proof();
  for (const item of [...equal.readbacks.slice(5), ...equal.preflights.slice(6),
    ...['beforeCreate', 'afterCreate', 'lockedAndroidReadback', 'afterDelete'].map(key => equal.revocations[0][key]),
    ...['beforeCreate', 'afterCreate', 'afterMutation', 'lockedAndroidReadback', 'afterRestore'].map(key => equal.mutations[0][key])])
    item.entries.find(row => row.path === entryPath(scenario)).data.updatedAt = structuredClone(seed.data.updatedAt);
  assert.equal(validateServerProof(equal, runId).androidCases, 18);
});
void test('late parent preserves all three orphan seeds, requires only the client-created parent and rejects extras', () => {
  const scenario = SCENARIOS[6]; const valid = proof();
  const seeds = valid.seeds.filter(item => item.method === scenario.method);
  assert.equal(seeds.length, 3);
  assert.equal(valid.preflights[6].entries.some(item => item.path === entryPath(scenario)), false);
  const placementPath = `users/${scenario.owner}/privateBinderPlacements/late-parent-placement`;
  for (const mutate of [
    value => { value.seeds = value.seeds.filter(item => !(item.method === scenario.method && item.path === placementPath)); },
    value => { value.seeds.push(structuredClone(value.seeds[3])); },
    value => { value.seeds[3].method = SCENARIOS[5].method; },
    value => { value.seeds[3].data.updatedAt.nanoseconds++; },
    value => { value.seeds[3].data.lastMutationId = 'unknown'; },
    value => { value.readbacks[6].entries.find(item => item.path === placementPath).data.slotPosition = 5; },
    value => { value.readbacks[6].entries.find(item => item.path === placementPath).data.revision = 2; },
    value => { value.readbacks[6].entries.find(item => item.path === placementPath).data.holoIntensity = 1; },
    value => { value.readbacks[6].entries.find(item => item.path === placementPath).data.updatedAt.nanoseconds++; },
    value => { value.readbacks[6].entries = value.readbacks[6].entries.filter(item => item.path !== entryPath(scenario)); },
    value => { value.readbacks[6].entries.find(item => item.path === entryPath(scenario)).data.quantity = 3; },
    value => { value.readbacks[6].entries.find(item => item.path === entryPath(scenario)).data.lastMutationId = 'admin-parent'; },
    value => { value.readbacks[6].entries.push({ path: `users/${scenario.owner}/collectionEntries/extra`, data: entryFixture(scenario, runId, finalStamp(scenario)) }); },
    value => { value.readbacks[6].collectionPaths.push(`users/${scenario.owner}/collectionPriceSelections`); },
    value => { value.errors.push({ method: scenario.method, error: 'second worker lost placement despite committed parent' }); },
  ]) {
    const broken = proof(); mutate(broken); assert.throws(() => validateServerProof(broken, runId));
  }
});

void test('three session-only cases are exact nominal Google owners, unseeded and entirely server-read-only', () => {
  assert.deepEqual(SCENARIOS.slice(7, 10), [
    { key: 'session-healthy', owner: 'sdk-proof-collection-session-healthy', method: 'sessionHealthyStartConfirmsAccessWithoutRunningWorkers' },
    { key: 'session-offline', owner: 'sdk-proof-collection-session-offline', method: 'offlineSessionNeedsExplicitRecheckWithinObservedReconnectWindow' },
    { key: 'session-reconnect', owner: 'sdk-proof-collection-session-reconnect', method: 'usableConnectivitySignalRechecksActualEntitlementWithoutManualSync' },
  ]);
  const valid = proof();
  assert.equal(validateServerProof(valid, runId).readOnlySessionCharacterizationCases, 2);
  assert.equal(validateServerProof(valid, runId).readOnlyConnectivityRecoveryCases, 1);
  for (const index of [7, 8, 9]) {
    const scenario = SCENARIOS[index];
    assert.deepEqual(seedFixtures(scenario, runId, seedStamp(scenario)), []);
    assert.equal(valid.seeds.some(seed => seed.method === scenario.method), false);
    assert.equal(valid.preflights[index].documentPaths.includes(`users/${scenario.owner}`), false);
    assert.equal(valid.readbacks[index].documentPaths.includes(`users/${scenario.owner}`), false);
    assert.deepEqual(valid.readbacks[index], valid.preflights[index]);
    assert.deepEqual(valid.readbacks[index].entries, valid.readbacks[6].entries);
    assert.throws(() => assertEntry(documentFixture(scenario).data, scenario, runId));
    assert.throws(() => assertSeed({ method: scenario.method, ...documentFixture(scenario) }, scenario, runId));
    const account = ACCOUNTS.find(item => item.uid === scenario.owner);
    assert.deepEqual(account, { uid: scenario.owner, email: `${scenario.owner}@example.invalid`,
      emailVerified: true, disabled: false, customClaims: { appAccess: true },
      providerData: [{ providerId: 'google.com', uid: `${scenario.owner}-google`, email: `${scenario.owner}@example.invalid` }] });
  }
});

void test('session-only proof rejects server writes, new claims, missing phases and altered complete readbacks', () => {
  for (const index of [7, 8, 9]) {
    const scenario = SCENARIOS[index];
    const addDocument = (snapshot, documentPath, data) => {
      snapshot.entries.push({ path: documentPath, data });
      snapshot.entries.sort((a, b) => lexical(a.path, b.path));
      const segments = documentPath.split('/');
      for (let length = 1; length <= segments.length; length++) {
        const inventory = length % 2 === 0 ? snapshot.documentPaths : snapshot.collectionPaths;
        const current = segments.slice(0, length).join('/');
        if (!inventory.includes(current)) inventory.push(current);
        inventory.sort(lexical);
      }
    };
    for (const mutate of [
      value => addDocument(value.readbacks[index], entryPath(scenario), documentFixture(scenario).data),
      value => addDocument(value.preflights[index], entryPath(scenario), documentFixture(scenario).data),
      value => addDocument(value.readbacks[index], `users/${scenario.owner}/collectionPriceSelections/entry`, { ownerUid: scenario.owner }),
      value => addDocument(value.readbacks[index], `users/${scenario.owner}/privateBinders/binder`, { ownerUid: scenario.owner }),
      value => addDocument(value.readbacks[index], `accountAccess/${scenario.owner}`, { appAccess: true }),
      value => { value.readbacks[index].entries[0].data.updatedAt.nanoseconds++; },
      value => { value.preflights[index].entries[0].data.updatedAt.nanoseconds++; },
      value => { value.readbacks[index].entries[0].data.lastMutationId = 'readonly-method-rewrote-an-old-owner'; },
      value => { value.readbacks[index].accounts.find(item => item.uid === scenario.owner).customClaims.admin = true; },
      value => { value.readbacks[index].accounts.find(item => item.uid === scenario.owner).providerData[0].uid = 'wrong-google'; },
      value => { value.readbacks[index].accounts = value.readbacks[index].accounts.filter(item => item.uid !== scenario.owner); },
      value => { value.seeds.push({ method: scenario.method, ...documentFixture(scenario) }); },
      value => { value.phases.splice(index, 1); },
      value => { value.phases[index] = structuredClone(value.phases[0]); },
      value => { value.readbacks.splice(index, 1); },
      value => { value.preflights.splice(index, 1); },
      value => { value.errors.push({ method: scenario.method, error: 'NOT_REPRODUCED: late auth event' }); },
      value => { value.readbackErrors.push({ method: scenario.method, error: 'Admin snapshot incomplete' }); },
    ]) {
      const broken = proof(); mutate(broken);
      assert.throws(() => validateServerProof(broken, runId));
    }
  }
});

void test('offline private retry has no Admin seed and only one exact worker-created binder', () => {
  const scenario = SCENARIOS[11];
  assert.deepEqual(scenario, { key: 'private-offline-retry', owner: 'sdk-proof-collection-private-offline-retry',
    method: 'offlinePrivateMutationSurvivesRoomReopenAndCompletesFullPull' });
  assert.deepEqual(seedFixtures(scenario, runId, seedStamp(scenario)), []);
  const expected = { path: `users/${scenario.owner}/privateBinders/offline-retry-binder`, data: {
    binderId: 'offline-retry-binder', ownerUid: scenario.owner, name: 'Synthetic offline retry binder',
    description: null, coverStyle: 'DOMIDEX', minimumPageCount: 1, createdAtClient: 1700000000000,
    updatedAtClient: 1700000000000, lastOpenedAtClient: null, deleted: false, revision: 1,
    lastMutationId: `private-offline-${runId}-binder`, updatedAt: finalStamp(scenario),
  } };
  assert.deepEqual(offlinePrivateBinderFixture(runId, finalStamp(scenario)), expected);
  assert.deepEqual(assertOfflinePrivateBinder(expected.data, runId), expected.data);
  assert.throws(() => assertEntry(entryFixture(scenario, runId, finalStamp(scenario)), scenario, runId));
  const valid = proof();
  assert.deepEqual(valid.seeds.filter(item => item.method === scenario.method), []);
  assert.deepEqual(valid.preflights[11].entries, valid.readbacks[10].entries);
  assert.deepEqual(valid.preflights[11].documentPaths, valid.readbacks[10].documentPaths);
  assert.deepEqual(valid.readbacks[11].entries,
    [...valid.readbacks[10].entries, expected].sort((a, b) => lexical(a.path, b.path)));
  assert.equal(valid.readbacks[11].collectionPaths.length, 13);
  assert.equal(valid.readbacks[11].documentPaths.length, 21);
  const summary = validateServerProof(valid, runId);
  assert.equal(summary.androidCases, 18);
  assert.equal(summary.actualPrivateWorkerOfflineRetryCases, 1);
});

void test('offline private retry rejects fabricated ACKs, extra writes, missing phases and altered prior owners', () => {
  const scenario = SCENARIOS[11];
  const fixture = () => offlinePrivateBinderFixture(runId, finalStamp(scenario));
  for (const change of [
    data => { data.binderId = 'other'; }, data => { data.ownerUid = OTHER_OWNER; },
    data => { data.name = 'other'; }, data => { delete data.description; },
    data => { data.description = ''; }, data => { data.coverStyle = 'other'; },
    data => { data.minimumPageCount = 2; }, data => { data.createdAtClient++; },
    data => { data.updatedAtClient++; }, data => { delete data.lastOpenedAtClient; },
    data => { data.lastOpenedAtClient = 1700000000000; }, data => { data.deleted = true; },
    data => { data.revision = 0; }, data => { data.revision = 2; },
    data => { data.lastMutationId = 'admin-ack'; }, data => { data.extra = true; },
    data => { data.updatedAt = null; }, data => { data.updatedAt.seconds = 0; },
    data => { data.updatedAt.nanoseconds = 1e9; }, data => { data.updatedAt.extra = true; },
  ]) {
    const document = fixture(); change(document.data);
    assert.throws(() => assertOfflinePrivateBinder(document.data, runId));
    const broken = proof();
    change(broken.readbacks[11].entries.find(item => item.path === document.path).data);
    assert.throws(() => validateServerProof(broken, runId));
  }
  for (const change of [
    value => { value.readbacks[11].entries = value.readbacks[11].entries.filter(item => item.path !== fixture().path); },
    value => { value.preflights[11].entries.push(fixture()); },
    value => { value.seeds.push({ method: scenario.method, ...fixture() }); },
    value => { value.readbacks[11].entries.push({ path: entryPath(scenario), data: {} }); },
    value => { value.readbacks[11].collectionPaths.push(`users/${scenario.owner}/collectionPriceSelections`); },
    value => { value.readbacks[11].documentPaths.push(`accountAccess/${scenario.owner}`); },
    value => { value.readbacks[11].documentPaths.push(`users/${OTHER_OWNER}/privateBinders/other`); },
    value => { value.readbacks[11].entries[0].data.updatedAt.nanoseconds++; },
    value => { value.preflights[11].entries[0].data.updatedAt.nanoseconds++; },
    value => { value.readbacks[11].accounts.find(item => item.uid === scenario.owner).customClaims.admin = true; },
    value => { value.phases.pop(); }, value => { value.preflights.pop(); }, value => { value.readbacks.pop(); },
    value => { value.errors.push({ method: scenario.method, error: 'offline outbox lost' }); },
  ]) {
    const broken = proof(); change(broken);
    assert.throws(() => validateServerProof(broken, runId));
  }
});

void test('deferred point-read appends one nominal owner with exactly three immutable valid server seeds', () => {
  const scenario = SCENARIOS[10];
  assert.deepEqual(scenario, { key: 'deferred-point-read', owner: 'sdk-proof-collection-deferred-point-read',
    method: 'deferredPlacementPointReadSurvivesRoomReopenUntilParentDelivery' });
  assert.equal(SCENARIOS.length, 18); assert.equal(ACCOUNTS.length, 19);
  assert.deepEqual(ACCOUNTS.find(item => item.uid === scenario.owner), {
    uid: scenario.owner, email: `${scenario.owner}@example.invalid`, emailVerified: true,
    disabled: false, customClaims: { appAccess: true },
    providerData: [{ providerId: 'google.com', uid: `${scenario.owner}-google`, email: `${scenario.owner}@example.invalid` }],
  });
  const expected = [
    { path: entryPath(scenario), data: entryFixture(scenario, runId, seedStamp(scenario)) },
    { path: `users/${scenario.owner}/privateBinders/deferred-binder`, data: {
      binderId: 'deferred-binder', ownerUid: scenario.owner, name: 'Synthetic deferred binder', description: null,
      coverStyle: 'DOMIDEX', minimumPageCount: 1, createdAtClient: 1700000000000,
      updatedAtClient: 1700000000000, lastOpenedAtClient: null, deleted: false,
      revision: 1, lastMutationId: `deferred-${runId}-binder`, updatedAt: seedStamp(scenario),
    } },
    { path: `users/${scenario.owner}/privateBinderPlacements/deferred-placement`, data: {
      placementId: 'deferred-placement', ownerUid: scenario.owner, binderId: 'deferred-binder',
      entrySyncId: 'entry', slotPosition: 4, holoEffectId: 'rainbow', holoIntensity: 0.5,
      createdAtClient: 1700000000000, updatedAtClient: 1700000000000, deleted: false,
      revision: 1, lastMutationId: `deferred-${runId}-placement`, updatedAt: seedStamp(scenario),
    } },
  ].sort((left, right) => lexical(left.path, right.path));
  assert.deepEqual(seedFixtures(scenario, runId, seedStamp(scenario)), expected);
  const valid = proof();
  assert.deepEqual(valid.seeds.filter(item => item.method === scenario.method), expected.map(item => ({ method: scenario.method, ...item })));
  assert.deepEqual(valid.preflights[10], valid.readbacks[10]);
  assert.deepEqual(valid.preflights[10].entries,
    [...valid.readbacks[9].entries, ...expected].sort((left, right) => lexical(left.path, right.path)));
  assert.equal(valid.readbacks[10].collectionPaths.length, 12);
  assert.equal(valid.readbacks[10].documentPaths.length, 19);
  const summary = validateServerProof(valid, runId);
  assert.equal(summary.androidCases, 18);
  assert.equal(summary.readOnlyDeferredPointReadCases, 1);
  for (const prior of valid.readbacks[9].entries)
    assert.deepEqual(valid.readbacks[10].entries.find(item => item.path === prior.path), prior);
});

void test('deferred point-read rejects changed seeds, all client writes, owner changes and incomplete proof', () => {
  const scenario = SCENARIOS[10];
  const parent = entryPath(scenario);
  const binder = `users/${scenario.owner}/privateBinders/deferred-binder`;
  const placement = `users/${scenario.owner}/privateBinderPlacements/deferred-placement`;
  const paths = [parent, binder, placement];
  const row = (snapshot, path) => snapshot.entries.find(item => item.path === path);
  const seed = (value, path) => value.seeds.find(item => item.method === scenario.method && item.path === path);
  const addDocument = (snapshot, path, data) => {
    snapshot.entries.push({ path, data }); snapshot.entries.sort((a, b) => lexical(a.path, b.path));
    const parts = path.split('/');
    for (let length = 1; length <= parts.length; length++) {
      const inventory = length % 2 === 0 ? snapshot.documentPaths : snapshot.collectionPaths;
      const item = parts.slice(0, length).join('/');
      if (!inventory.includes(item)) inventory.push(item);
      inventory.sort(lexical);
    }
  };
  const removeDocument = (snapshot, path) => {
    snapshot.entries = snapshot.entries.filter(item => item.path !== path);
    snapshot.documentPaths = snapshot.documentPaths.filter(item => item !== path);
  };
  for (const path of paths) {
    for (const change of [
      data => { data.ownerUid = OTHER_OWNER; },
      data => { data.revision = 2; },
      data => { data.lastMutationId = 'unexpected-client-write'; },
      data => { data.updatedAtClient++; },
      data => { data.deleted = true; },
      data => { data.extra = 'unexpected'; },
      data => { delete data.revision; },
    ]) {
      // Mutating seed plus BOTH complete snapshots cannot bless another valid-looking identity/revision.
      const broken = proof();
      change(seed(broken, path).data);
      change(row(broken.preflights[10], path).data);
      change(row(broken.readbacks[10], path).data);
      assert.throws(() => validateServerProof(broken, runId));
    }
    for (const change of [
      value => { seed(value, path).data.updatedAt.nanoseconds++; },
      value => { row(value.preflights[10], path).data.updatedAt.nanoseconds++; },
      value => { row(value.readbacks[10], path).data.updatedAt.nanoseconds++; },
      value => { seed(value, path).method = SCENARIOS[9].method; },
      value => { seed(value, path).path += '-wrong'; },
      value => { removeDocument(value.preflights[10], path); },
      value => { removeDocument(value.readbacks[10], path); },
      value => { value.seeds = value.seeds.filter(item => !(item.method === scenario.method && item.path === path)); },
      value => { value.seeds.push(structuredClone(seed(value, path))); },
    ]) {
      const broken = proof(); change(broken);
      assert.throws(() => validateServerProof(broken, runId));
    }
  }
  for (const change of [
    value => { row(value.readbacks[10], parent).data.quantity++; },
    value => { row(value.readbacks[10], binder).data.name = 'Client changed binder'; },
    value => { row(value.readbacks[10], placement).data.entrySyncId = 'other-entry'; },
    value => { row(value.preflights[10], placement).data.binderId = 'other-binder'; },
    value => { row(value.readbacks[10], placement).data.slotPosition++; },
    value => { row(value.readbacks[10], placement).data.holoIntensity = 1; },
    value => { row(value.readbacks[10], placement).data.holoEffectId = 'other'; },
    value => { addDocument(value.readbacks[10], `users/${scenario.owner}/collectionEntries/extra`, entryFixture(scenario, runId, finalStamp(scenario))); },
    value => { addDocument(value.preflights[10], `users/${scenario.owner}/collectionPriceSelections/entry`, { ownerUid: scenario.owner }); },
    value => { addDocument(value.readbacks[10], `users/${OTHER_OWNER}/collectionEntries/entry`, { ownerUid: OTHER_OWNER }); },
    value => { addDocument(value.readbacks[10], `accountAccess/${scenario.owner}`, { appAccess: true }); },
    value => { value.readbacks[10].documentPaths.push(`users/${scenario.owner}/privateBinders/empty-reference`); },
    value => { value.readbacks[10].collectionPaths.push(`users/${scenario.owner}/unknown`); },
    value => { value.preflights[10].entries[0].data.updatedAt.nanoseconds++; },
    value => { value.readbacks[10].entries[0].data.updatedAt.nanoseconds++; },
    value => { value.readbacks[10].accounts.find(item => item.uid === scenario.owner).customClaims.admin = true; },
    value => { value.preflights[10].accounts.find(item => item.uid === scenario.owner).customClaims = {}; },
    value => { value.readbacks[10].accounts.find(item => item.uid === scenario.owner).providerData[0].providerId = 'password'; },
    value => { value.preflights[10].accounts.find(item => item.uid === scenario.owner).providerData[0].uid = 'wrong-google'; },
    value => { value.readbacks[10].accounts.find(item => item.uid === scenario.owner).disabled = true; },
    value => { value.readbacks[10].accounts = value.readbacks[10].accounts.filter(item => item.uid !== scenario.owner); },
    value => { value.phases.pop(); },
    value => { value.phases[10] = structuredClone(value.phases[9]); },
    value => { value.preflights.pop(); },
    value => { value.readbacks.pop(); },
    value => { value.errors.push({ method: scenario.method, error: 'deferred marker lost after Room reopen' }); },
    value => { value.readbackErrors.push({ method: scenario.method, error: 'incomplete Admin tree' }); },
  ]) {
    const broken = proof(); change(broken);
    assert.throws(() => validateServerProof(broken, runId));
  }
});

// REVIEW DRAFT: append to validation.test.mjs after applying the matching host patch.
// Pure validator fixtures only. No Android/SDK/runtime result is claimed here.

void test('two-client private conflict appends one nominal owner, no seed and exact winner revision2', () => {
  const scenario = SCENARIOS[12];
  assert.deepEqual(scenario, { key: 'private-two-client', owner: 'sdk-proof-collection-private-two-client',
    method: 'twoClientPrivateBinderStaleEditConvergesWithoutRemoteRewrite' });
  assert.equal(SCENARIOS.length, 18); assert.equal(ACCOUNTS.length, 19);
  assert.deepEqual(ACCOUNTS.find(item => item.uid === scenario.owner), {
    uid: scenario.owner, email: `${scenario.owner}@example.invalid`, emailVerified: true,
    disabled: false, customClaims: { appAccess: true },
    providerData: [{ providerId: 'google.com', uid: `${scenario.owner}-google`, email: `${scenario.owner}@example.invalid` }],
  });
  assert.deepEqual(seedFixtures(scenario, runId, seedStamp(scenario)), []);
  const expected = { path: `users/${scenario.owner}/privateBinders/private-two-client-binder`, data: {
    binderId: 'private-two-client-binder', ownerUid: scenario.owner,
    name: 'Synthetic pair winner', description: 'A revision two', coverStyle: 'DOMIDEX',
    minimumPageCount: 3, createdAtClient: 1700000000000, updatedAtClient: 1700000000010,
    lastOpenedAtClient: 1700000000010, deleted: false, revision: 2,
    lastMutationId: `private-pair-${runId}-a-edit`, updatedAt: finalStamp(scenario),
  } };
  assert.deepEqual(twoClientPrivateBinderFixture(runId, finalStamp(scenario)), expected);
  assert.deepEqual(assertTwoClientPrivateBinder(expected.data, runId), expected.data);
  assert.throws(() => assertEntry(entryFixture(scenario, runId, finalStamp(scenario)), scenario, runId));
  assert.throws(() => assertSeed({ method: scenario.method, ...expected }, scenario, runId));
  const valid = proof();
  assert.deepEqual(valid.seeds.filter(item => item.method === scenario.method), []);
  assert.deepEqual(valid.preflights[12], { ...valid.readbacks[11], method: scenario.method });
  assert.deepEqual(valid.readbacks[12].entries,
    [...valid.readbacks[11].entries, expected].sort((left, right) => lexical(left.path, right.path)));
  assert.equal(valid.readbacks[11].collectionPaths.length, 13);
  assert.equal(valid.readbacks[11].documentPaths.length, 21);
  assert.equal(valid.readbacks[11].entries.length, 13);
  assert.equal(valid.readbacks[12].collectionPaths.length, 14);
  assert.equal(valid.readbacks[12].documentPaths.length, 23);
  assert.equal(valid.readbacks[12].entries.length, 14);
  // Fits the unchanged actual Admin traversal bounds; these are not new larger limits.
  assert.ok(valid.readbacks[12].collectionPaths.length < 16);
  assert.ok(valid.readbacks[12].documentPaths.length < 32);
  const summary = validateServerProof(valid, runId);
  assert.equal(summary.androidCases, 18);
  assert.equal(summary.independentAdminReadbacks, 18);
  assert.equal(summary.independentAdminPreflights, 18);
  assert.equal(summary.actualPrivateWorkerOfflineRetryCases, 1);
  assert.equal(summary.actualPrivateWorkerTwoClientConflictCases, 1);
  for (const prior of valid.readbacks[11].entries)
    assert.deepEqual(valid.readbacks[12].entries.find(item => item.path === prior.path), prior);
});

void test('two-client proof rejects stale B or revision3, premature seeding, extra authority and incomplete evidence', () => {
  const scenario = SCENARIOS[12];
  const fixture = () => twoClientPrivateBinderFixture(runId, finalStamp(scenario));
  const finalRow = value => value.readbacks[12].entries.find(item => item.path === fixture().path);
  for (const change of [
    data => { data.binderId = 'other'; }, data => { data.ownerUid = OTHER_OWNER; },
    data => { data.name = 'Synthetic pair stale'; }, data => { data.description = 'B stale revision one'; },
    data => { delete data.description; }, data => { data.description = null; },
    data => { data.coverStyle = 'other'; }, data => { data.minimumPageCount = 7; },
    data => { data.createdAtClient++; }, data => { data.updatedAtClient = 1700000000020; },
    data => { data.lastOpenedAtClient = 1700000000020; }, data => { data.lastOpenedAtClient = null; },
    data => { delete data.lastOpenedAtClient; }, data => { data.deleted = true; },
    data => { data.revision = 1; }, data => { data.revision = 3; },
    data => { data.lastMutationId = `private-pair-${runId}-b-stale`; },
    data => { data.lastMutationId = `private-pair-${runId}-initial`; },
    data => { data.extra = true; }, data => { data.updatedAt = null; },
    data => { data.updatedAt.seconds = 0; }, data => { data.updatedAt.nanoseconds = 1e9; },
    data => { data.updatedAt.extra = true; },
  ]) {
    const document = fixture(); change(document.data);
    assert.throws(() => assertTwoClientPrivateBinder(document.data, runId));
    const broken = proof(); change(finalRow(broken).data);
    assert.throws(() => validateServerProof(broken, runId));
  }
  const addDocument = (snapshot, path, data) => {
    snapshot.entries.push({ path, data }); snapshot.entries.sort((a, b) => lexical(a.path, b.path));
    const parts = path.split('/');
    for (let length = 1; length <= parts.length; length++) {
      const inventory = length % 2 === 0 ? snapshot.documentPaths : snapshot.collectionPaths;
      const item = parts.slice(0, length).join('/');
      if (!inventory.includes(item)) inventory.push(item);
      inventory.sort(lexical);
    }
  };
  for (const change of [
    value => { value.readbacks[12].entries = value.readbacks[12].entries.filter(item => item.path !== fixture().path); },
    value => { addDocument(value.preflights[12], fixture().path, fixture().data); },
    value => { value.seeds.push({ method: scenario.method, ...fixture() }); },
    value => { addDocument(value.readbacks[12], entryPath(scenario), entryFixture(scenario, runId, finalStamp(scenario))); },
    value => { addDocument(value.readbacks[12], `users/${scenario.owner}/privateBinders/extra`, fixture().data); },
    value => { addDocument(value.readbacks[12], `users/${OTHER_OWNER}/privateBinders/other`, fixture().data); },
    value => { addDocument(value.readbacks[12], `accountAccess/${scenario.owner}`, { appAccess: true }); },
    value => { value.readbacks[12].entries.push(structuredClone(finalRow(value))); },
    value => { value.readbacks[12].collectionPaths.push(`users/${scenario.owner}/collectionPriceSelections`); },
    value => { value.readbacks[12].documentPaths.push(`users/${scenario.owner}/privateBinders/empty-reference`); },
    value => { value.readbacks[12].entries[0].data.updatedAt.nanoseconds++; },
    value => { value.preflights[12].entries[0].data.updatedAt.nanoseconds++; },
    value => { value.readbacks[12].accounts.find(item => item.uid === scenario.owner).customClaims.admin = true; },
    value => { value.preflights[12].accounts.find(item => item.uid === scenario.owner).customClaims = {}; },
    value => { value.readbacks[12].accounts.find(item => item.uid === scenario.owner).providerData[0].uid = 'wrong-google'; },
    value => { value.preflights[12].accounts.find(item => item.uid === scenario.owner).emailVerified = false; },
    value => { value.readbacks[12].accounts = value.readbacks[12].accounts.filter(item => item.uid !== scenario.owner); },
    value => { value.phases.pop(); }, value => { value.preflights.pop(); }, value => { value.readbacks.pop(); },
    value => { value.phases[12] = structuredClone(value.phases[11]); },
    value => { value.phases[12].successEvidence = false; },
    value => { value.errors.push({ method: scenario.method, error: 'stale private edit overwrote winner' }); },
    value => { value.readbackErrors.push({ method: scenario.method, error: 'independent readback incomplete' }); },
    value => { value.error = 'Exact owned private-pair Room cleanup failed'; },
  ]) {
    const broken = proof(); change(broken);
    assert.throws(() => validateServerProof(broken, runId));
  }
});

void test('knowledge listener case is read-only, just-in-time and before the final budget fixture', () => {
  const scenario = SCENARIOS[13];
  assert.deepEqual(scenario, { key: 'knowledge-listener', owner: 'sdk-proof-collection-knowledge-listener',
    method: 'knowledgeListenerReplacesCacheRemovesMissingAndInvalidatesOnSignOut' });
  assert.equal(SCENARIOS[14].key, 'knowledge-malformed');
  assert.equal(SCENARIOS[15], REVOCATION); assert.equal(SCENARIOS[17].key, 'private-full-budget');
  assert.equal(SCENARIOS.length, 18); assert.equal(ACCOUNTS.length, 19);
  assert.deepEqual(ACCOUNTS.find(item => item.uid === scenario.owner), {
    uid: scenario.owner, email: scenario.owner + '@example.invalid', emailVerified: true, disabled: false,
    customClaims: { appAccess: true },
    providerData: [{ providerId: 'google.com', uid: scenario.owner + '-google', email: scenario.owner + '@example.invalid' }],
  });
  const expected = { path: 'scanKnowledge/' + '1'.repeat(64), data: {
    fingerprint: '1'.repeat(64), cardId: 'sdk-knowledge-' + runId + '-server',
    sourceSetId: 'synthetic-server-set', cardNumber: '101/202', status: 'STABLE',
    confidence: 91, confirmations: 7, corrections: 2, knowledgeVersion: 1, lastUpdatedAt: seedStamp(scenario),
  } };
  assert.equal(KNOWLEDGE_PATH, expected.path);
  assert.equal(KNOWLEDGE_MISSING_PATH, 'scanKnowledge/' + '2'.repeat(64));
  assert.deepEqual(knowledgeFixture(runId, seedStamp(scenario)), expected);
  assert.deepEqual(seedFixtures(scenario, runId, seedStamp(scenario)), [expected]);
  assert.throws(() => assertEntry(entryFixture(scenario, runId, seedStamp(scenario)), scenario, runId));
  const valid = proof();
  assert.deepEqual(valid.seeds.filter(item => item.method === scenario.method), [{ method: scenario.method, ...expected }]);
  assert.deepEqual(valid.preflights[13], valid.readbacks[13]);
  assert.deepEqual(valid.readbacks[13].entries,
    [...valid.readbacks[12].entries, expected].sort((left, right) => lexical(left.path, right.path)));
  assert.equal(valid.readbacks[13].collectionPaths.length, 15);
  assert.equal(valid.readbacks[13].documentPaths.length, 24);
  assert.equal(valid.readbacks[13].entries.length, 15);
  for (const index of [13, 14, 15, 16, 17]) {
    assert.equal(valid.readbacks[index].entries.filter(item => item.path === KNOWLEDGE_PATH).length, 1);
    assert.equal(valid.readbacks[index].documentPaths.includes(KNOWLEDGE_MISSING_PATH), false);
    assert.equal(valid.readbacks[index].documentPaths.includes('users/' + scenario.owner), false);
  }
  const summary = validateServerProof(valid, runId);
  assert.equal(summary.androidCases, 18);
  assert.equal(summary.independentAdminReadbacks, 18);
  assert.equal(summary.independentAdminPreflights, 18);
  assert.equal(summary.readOnlyKnowledgeListenerAuthCases, 1);
});

void test('positive knowledge inventory accepts one exact root document at its exact four allowed phases', () => {
  for (const scenario of [SCENARIOS[13], SCENARIOS[14], SCENARIOS[15], MUTATION, SCENARIOS[17]]) {
    assertKnowledgeInventoryPath(KNOWLEDGE_PATH, scenario);
    for (const path of [KNOWLEDGE_MISSING_PATH, 'scanKnowledge/' + '3'.repeat(64),
      KNOWLEDGE_PATH + '/extra/document', 'scanKnowledge/invalid'])
      assert.throws(() => assertKnowledgeInventoryPath(path, scenario));
  }
  for (const scenario of [undefined, ...SCENARIOS.slice(0, 13), { ...SCENARIOS[13] }, { ...SCENARIOS[14] }, { ...SCENARIOS[15] }, { ...SCENARIOS[17] }])
    assert.throws(() => assertKnowledgeInventoryPath(KNOWLEDGE_PATH, scenario));
  assertKnowledgeInventoryPath(entryPath(SCENARIOS[0]), undefined);
  assertKnowledgeInventoryPath('accountAccess/unknown', undefined); // Other complete-inventory checks reject it.
});

void test('knowledge seed rejects every changed field, malformed timestamp and coordinated forgery', () => {
  const scenario = SCENARIOS[13];
  const make = () => ({ method: scenario.method, ...knowledgeFixture(runId, seedStamp(scenario)) });
  assertSeed(make(), scenario, runId);
  for (const change of [
    data => { data.fingerprint = '2'.repeat(64); }, data => { data.cardId = 'local-hint'; },
    data => { data.sourceSetId = null; }, data => { data.cardNumber = '1/1'; },
    data => { data.status = 'CANDIDATE'; }, data => { data.status = 'DISPUTED'; },
    data => { data.confidence++; }, data => { data.confirmations++; }, data => { data.corrections++; },
    data => { data.knowledgeVersion = 2; }, data => { data.knowledgeVersion = 1.5; },
    data => { data.knowledgeVersion = '1'; }, data => { delete data.knowledgeVersion; },
    data => { data.extra = true; }, data => { delete data.sourceSetId; },
    data => { data.lastUpdatedAt = null; }, data => { data.lastUpdatedAt.seconds = 0; },
    data => { data.lastUpdatedAt.nanoseconds = 1e9; }, data => { data.lastUpdatedAt.extra = true; },
  ]) {
    const seed = make(); change(seed.data); assert.throws(() => assertSeed(seed, scenario, runId));
  }
  const forged = proof();
  for (const item of [forged.seeds.find(item => item.path === KNOWLEDGE_PATH),
    forged.preflights[13].entries.find(item => item.path === KNOWLEDGE_PATH),
    forged.readbacks[13].entries.find(item => item.path === KNOWLEDGE_PATH)])
    item.data.cardId = 'matching-forged-value';
  assert.throws(() => validateServerProof(forged, runId));
});

void test('knowledge proof rejects missing readback, changes to cache source or identities, and any extra server path', () => {
  const scenario = SCENARIOS[13];
  const row = value => value.readbacks[13].entries.find(item => item.path === KNOWLEDGE_PATH);
  for (const change of [
    value => { value.seeds = value.seeds.filter(item => item.path !== KNOWLEDGE_PATH); },
    value => { value.preflights[13].entries = value.preflights[13].entries.filter(item => item.path !== KNOWLEDGE_PATH); },
    value => { row(value).data.lastUpdatedAt.nanoseconds++; },
    value => { value.preflights[13].entries.find(item => item.path === KNOWLEDGE_PATH).data.lastUpdatedAt.nanoseconds++; },
    value => { row(value).data.cardId = 'client-write'; },
    value => { value.readbacks[13].documentPaths.push(KNOWLEDGE_MISSING_PATH); },
    value => { value.readbacks[13].entries.push({ path: KNOWLEDGE_MISSING_PATH, data: row(value).data }); },
    value => { value.readbacks[13].documentPaths.push('users/' + scenario.owner); },
    value => { value.readbacks[13].collectionPaths.push('accountAccess'); },
    value => { value.readbacks[13].documentPaths.push('accountAccess/' + scenario.owner); },
    value => { value.readbacks[13].entries.find(item => item.path === entryPath(SCENARIOS[0])).data.quantity++; },
    value => { value.preflights[13].accounts.find(item => item.uid === scenario.owner).customClaims.admin = true; },
    value => { value.readbacks[13].accounts.find(item => item.uid === scenario.owner).providerData[0].uid = 'foreign'; },
    value => { value.readbacks[13].accounts.find(item => item.uid === scenario.owner).customClaims = {}; },
    value => { value.phases[13].successEvidence = false; },
    value => { value.readbacks.splice(13, 1); }, value => { value.preflights.splice(13, 1); },
    value => { value.errors.push({ method: scenario.method, error: 'Missing local AtomicFile survived' }); },
    value => { value.readbackErrors.push({ method: scenario.method, error: 'Admin tree incomplete' }); },
    value => { value.error = 'Owned preference cleanup failed'; },
  ]) {
    const broken = proof(); change(broken); assert.throws(() => validateServerProof(broken, runId));
  }
});

void test('malformed knowledge is an exact read-only phase before the still-final full-budget case', () => {
  const scenario = SCENARIOS[14];
  assert.deepEqual(scenario, { key: 'knowledge-malformed', owner: 'sdk-proof-collection-knowledge-malformed',
    method: 'malformedKnowledgeListenerRemovesOnlyExactCacheAndPreservesLocalState' });
  assert.equal(SCENARIOS.length, 18); assert.equal(ACCOUNTS.length, 19);
  assert.equal(SCENARIOS[13].key, 'knowledge-listener'); assert.equal(SCENARIOS[15], REVOCATION); assert.equal(SCENARIOS[17].key, 'private-full-budget');
  assert.deepEqual(ACCOUNTS.find(item => item.uid === scenario.owner), {
    uid: scenario.owner, email: scenario.owner + '@example.invalid', emailVerified: true, disabled: false,
    customClaims: { appAccess: true },
    providerData: [{ providerId: 'google.com', uid: scenario.owner + '-google', email: scenario.owner + '@example.invalid' }],
  });
  const expected = { path: 'scanKnowledge/' + '4'.repeat(64), data: {
    fingerprint: '4'.repeat(64), cardId: 'sdk-knowledge-' + runId + '-malformed-server',
    sourceSetId: 'synthetic-server-set', cardNumber: '101/202', status: 'STABLE',
    confidence: 91, confirmations: 7, corrections: 2, knowledgeVersion: '1', lastUpdatedAt: seedStamp(scenario),
  } };
  assert.equal(KNOWLEDGE_MALFORMED_PATH, expected.path);
  assert.deepEqual(malformedKnowledgeFixture(runId, seedStamp(scenario)), expected);
  assert.deepEqual(seedFixtures(scenario, runId, seedStamp(scenario)), [expected]);
  assert.throws(() => assertEntry(entryFixture(scenario, runId, seedStamp(scenario)), scenario, runId));
  const valid = proof();
  assert.deepEqual(valid.seeds.filter(item => item.method === scenario.method), [{ method: scenario.method, ...expected }]);
  assert.deepEqual(valid.preflights[14], valid.readbacks[14]);
  assert.deepEqual(valid.readbacks[14].entries,
    [...valid.readbacks[13].entries, expected].sort((left, right) => lexical(left.path, right.path)));
  assert.equal(valid.readbacks[14].collectionPaths.length, 15);
  assert.equal(valid.readbacks[14].documentPaths.length, 25);
  assert.equal(valid.readbacks[14].entries.length, 16);
  for (const index of [14, 15, 16, 17]) {
    assert.equal(valid.readbacks[index].documentPaths.includes('users/' + scenario.owner), false);
    assert.equal(valid.readbacks[index].documentPaths.includes(KNOWLEDGE_MISSING_PATH), false);
    assert.equal(valid.readbacks[index].documentPaths.includes('scanKnowledge/' + '5'.repeat(64)), false);
    assert.deepEqual(valid.readbacks[index].entries.find(item => item.path === expected.path), expected);
  }
  const summary = validateServerProof(valid, runId);
  assert.equal(summary.androidCases, 18);
  assert.equal(summary.independentAdminPreflights, 18);
  assert.equal(summary.independentAdminReadbacks, 18);
  assert.equal(summary.readOnlyKnowledgeListenerAuthCases, 1);
  assert.equal(summary.readOnlyMalformedKnowledgeListenerCases, 1);
});
void test('malformed knowledge inventory is exact and never broadens the final large-owner exception', () => {
  for (const scenario of [SCENARIOS[14], SCENARIOS[15], MUTATION, SCENARIOS[17]]) {
    assertKnowledgeInventoryPath(KNOWLEDGE_MALFORMED_PATH, scenario);
    for (const path of [KNOWLEDGE_MISSING_PATH, 'scanKnowledge/' + '5'.repeat(64),
      KNOWLEDGE_MALFORMED_PATH + '/extra/document', 'scanKnowledge/invalid'])
      assert.throws(() => assertKnowledgeInventoryPath(path, scenario));
  }
  for (const scenario of [undefined, ...SCENARIOS.slice(0, 14), { ...SCENARIOS[14] }, { ...SCENARIOS[15] }, { ...SCENARIOS[17] }])
    assert.throws(() => assertKnowledgeInventoryPath(KNOWLEDGE_MALFORMED_PATH, scenario));
  for (const path of [FULL_BUDGET_PARENT, ...FULL_BUDGET_PATHS])
    assert.throws(() => isFullBudgetInventoryPath(path, SCENARIOS[14]));
});
void test('malformed seed rejects schema repair, every changed field and coordinated before/after forgery', () => {
  const scenario = SCENARIOS[14];
  const make = () => ({ method: scenario.method, ...malformedKnowledgeFixture(runId, seedStamp(scenario)) });
  assertSeed(make(), scenario, runId);
  for (const change of [
    data => { data.fingerprint = '5'.repeat(64); }, data => { data.cardId = 'local-hint'; },
    data => { data.sourceSetId = null; }, data => { data.cardNumber = '1/1'; },
    data => { data.status = 'PROVISIONAL'; }, data => { data.confidence = 90; },
    data => { data.confirmations = 8; }, data => { data.corrections = 3; },
    data => { data.knowledgeVersion = 1; }, data => { data.knowledgeVersion = '2'; },
    data => { delete data.knowledgeVersion; }, data => { data.extra = true; },
    data => { data.lastUpdatedAt = null; }, data => { data.lastUpdatedAt.seconds = 0; },
    data => { data.lastUpdatedAt.nanoseconds = 1e9; }, data => { data.lastUpdatedAt.extra = true; },
  ]) { const seed = make(); change(seed.data); assert.throws(() => assertSeed(seed, scenario, runId)); }
  const forged = proof();
  for (const item of [forged.seeds.find(item => item.path === KNOWLEDGE_MALFORMED_PATH),
    forged.preflights[14].entries.find(item => item.path === KNOWLEDGE_MALFORMED_PATH),
    forged.readbacks[14].entries.find(item => item.path === KNOWLEDGE_MALFORMED_PATH),
    forged.preflights[15].entries.find(item => item.path === KNOWLEDGE_MALFORMED_PATH),
    forged.readbacks[15].entries.find(item => item.path === KNOWLEDGE_MALFORMED_PATH)])
    item.data.knowledgeVersion = 1;
  assert.throws(() => validateServerProof(forged, runId));
});
void test('malformed proof rejects missing readback, early seed, any remote write and altered identity', () => {
  const scenario = SCENARIOS[14];
  const row = value => value.readbacks[14].entries.find(item => item.path === KNOWLEDGE_MALFORMED_PATH);
  for (const change of [
    value => { value.seeds = value.seeds.filter(item => item.path !== KNOWLEDGE_MALFORMED_PATH); },
    value => { value.seeds.push(structuredClone(value.seeds.find(item => item.path === KNOWLEDGE_MALFORMED_PATH))); },
    value => { value.preflights[13].entries.push(structuredClone(row(value))); },
    value => { value.preflights[14].entries = value.preflights[14].entries.filter(item => item.path !== KNOWLEDGE_MALFORMED_PATH); },
    value => { value.readbacks[14].entries = value.readbacks[14].entries.filter(item => item.path !== KNOWLEDGE_MALFORMED_PATH); },
    value => { value.preflights[14].entries.find(item => item.path === KNOWLEDGE_MALFORMED_PATH).data.lastUpdatedAt.nanoseconds++; },
    value => { row(value).data.lastUpdatedAt.nanoseconds++; },
    value => { row(value).data.knowledgeVersion = 1; },
    value => { value.readbacks[14].documentPaths.push('scanKnowledge/' + '5'.repeat(64)); },
    value => { value.readbacks[14].entries.push(structuredClone(row(value))); },
    value => { value.readbacks[14].documentPaths.push('users/' + scenario.owner); },
    value => { value.readbacks[14].collectionPaths.push('accountAccess'); },
    value => { value.readbacks[14].documentPaths.push('accountAccess/' + scenario.owner); },
    value => { value.readbacks[14].entries.find(item => item.path === KNOWLEDGE_PATH).data.confidence++; },
    value => { value.readbacks[14].entries.find(item => item.path === entryPath(SCENARIOS[0])).data.quantity++; },
    value => { value.preflights[14].accounts.find(item => item.uid === scenario.owner).customClaims.admin = true; },
    value => { value.readbacks[14].accounts.find(item => item.uid === scenario.owner).providerData[0].uid = 'foreign'; },
    value => { value.readbacks[14].accounts.find(item => item.uid === scenario.owner).customClaims = {}; },
    value => { value.readbacks[14].accounts = value.readbacks[14].accounts.filter(item => item.uid !== scenario.owner); },
    value => { value.phases.splice(14, 1); }, value => { value.phases[14].successEvidence = false; },
    value => { value.readbacks.splice(14, 1); }, value => { value.preflights.splice(14, 1); },
    value => { value.errors.push({ method: scenario.method, error: 'Listener did not remove exact cache' }); },
    value => { value.readbackErrors.push({ method: scenario.method, error: 'Admin tree incomplete' }); },
    value => { value.error = 'Owned local fixture teardown failed'; },
  ]) { const broken = proof(); change(broken); assert.throws(() => validateServerProof(broken, runId)); }
});

void test('large full pull appends exactly 1001 immutable seeds and one absent owner parent', () => {
  const scenario = SCENARIOS[17];
  assert.deepEqual(scenario, { key: 'private-full-budget', owner: 'sdk-proof-collection-private-full-budget',
    method: 'largePrivateFullPullContinuesAfterBudgetAndRoomReopen' });
  assert.equal(SCENARIOS.length, 18); assert.equal(ACCOUNTS.length, 19);
  assert.deepEqual(ACCOUNTS.find(item => item.uid === scenario.owner), {
    uid: scenario.owner, email: `${scenario.owner}@example.invalid`, emailVerified: true,
    disabled: false, customClaims: { appAccess: true },
    providerData: [{ providerId: 'google.com', uid: `${scenario.owner}-google`, email: `${scenario.owner}@example.invalid` }],
  });
  assert.equal(FULL_BUDGET_PARENT, `users/${scenario.owner}`);
  assert.equal(FULL_BUDGET_COLLECTION, `${FULL_BUDGET_PARENT}/privateBinders`);
  const paths = Array.from({ length: 1001 }, (_, index) =>
    `users/sdk-proof-collection-private-full-budget/privateBinders/paging-${String(index).padStart(4, '0')}`);
  assert.deepEqual(FULL_BUDGET_PATHS, paths);
  const timestamp = seedStamp(scenario);
  const expected = paths.map((path, index) => {
    const binderId = `paging-${String(index).padStart(4, '0')}`;
    return { path, data: {
      binderId, ownerUid: 'sdk-proof-collection-private-full-budget', name: `Synthetic paging binder ${binderId}`,
      description: null, coverStyle: 'DOMIDEX', minimumPageCount: 1,
      createdAtClient: 1700000000000, updatedAtClient: 1700000000000,
      lastOpenedAtClient: null, deleted: false, revision: 1,
      lastMutationId: `private-full-${runId}-${binderId}`, updatedAt: timestamp,
    } };
  });
  assert.deepEqual(seedFixtures(scenario, runId, timestamp), expected);
  for (const fixture of expected) assert.deepEqual(fullBudgetBinderFixture(fixture.path, runId, timestamp), fixture);
  assert.throws(() => assertEntry(entryFixture(scenario, runId, timestamp), scenario, runId));
  const valid = proof();
  assert.deepEqual(valid.seeds.filter(item => item.method === scenario.method), expected.map(item => ({ method: scenario.method, ...item })));
  assert.deepEqual(valid.preflights[17], valid.readbacks[17]);
  assert.deepEqual(valid.readbacks[17].entries,
    [...valid.readbacks[16].entries, ...expected].sort((left, right) => lexical(left.path, right.path)));
  assert.equal(valid.readbacks[16].collectionPaths.length, 15);
  assert.equal(valid.readbacks[16].documentPaths.length, 27);
  assert.equal(valid.readbacks[16].entries.length, 18);
  assert.equal(valid.readbacks[17].collectionPaths.length, 16);
  assert.equal(valid.readbacks[17].documentPaths.length, 1029);
  assert.equal(valid.readbacks[17].entries.length, 1019);
  assert.equal(valid.readbacks[17].documentPaths.filter(path => path === FULL_BUDGET_PARENT).length, 1);
  assert.equal(valid.readbacks[17].entries.some(item => item.path === FULL_BUDGET_PARENT), false);
  for (const prior of valid.readbacks[16].entries)
    assert.deepEqual(valid.readbacks[17].entries.find(item => item.path === prior.path), prior);
  const summary = validateServerProof(valid, runId);
  assert.equal(summary.androidCases, 18);
  assert.equal(summary.independentAdminPreflights, 18);
  assert.equal(summary.independentAdminReadbacks, 18);
  assert.equal(summary.actualPrivateWorkerFullBudgetCases, 1);
  assert.equal(summary.actualPrivateWorkerTwoClientConflictCases, 1);
});

void test('large inventory exception is exact-path and exact-scenario only, never a global bound lift', () => {
  const scenario = SCENARIOS[17];
  for (const path of [FULL_BUDGET_PARENT, ...FULL_BUDGET_PATHS]) {
    assert.equal(isFullBudgetInventoryPath(path, scenario), true);
    for (const wrong of [undefined, SCENARIOS[0], SCENARIOS[13], SCENARIOS[14], SCENARIOS[15], { ...scenario }])
      assert.throws(() => isFullBudgetInventoryPath(path, wrong));
  }
  for (const path of [
    `${FULL_BUDGET_COLLECTION}/paging-1001`, `${FULL_BUDGET_COLLECTION}/paging-00000`,
    `${FULL_BUDGET_COLLECTION}/paging-1`, `${FULL_BUDGET_COLLECTION}/extra`,
    `${FULL_BUDGET_COLLECTION}/paging-0000/child/entry`,
    `${FULL_BUDGET_PARENT}/collectionEntries/entry`, `${FULL_BUDGET_PARENT}/collectionPriceSelections/entry`,
    `${FULL_BUDGET_PARENT}/privateBinderPlacements/entry`,
  ]) {
    assert.throws(() => isFullBudgetInventoryPath(path, scenario));
    assert.throws(() => fullBudgetBinderFixture(path, runId, seedStamp(scenario)));
  }
  for (const ordinaryPath of [
    `users/${OTHER_OWNER}`, `users/${OTHER_OWNER}/privateBinders/paging-0000`,
    'users/sdk-proof-collection-private-full-budget-other/privateBinders/paging-0000',
    `accountAccess/${scenario.owner}`, entryPath(SCENARIOS[0]),
  ]) assert.equal(isFullBudgetInventoryPath(ordinaryPath, scenario), false);
  const value = proof();
  assert.equal(value.readbacks[17].documentPaths.filter(path => !isFullBudgetInventoryPath(path, scenario)).length, 27);
  // Generic traversal still separately enforces <32 ordinary references and
  // <16 collection references. This helper never exempts another owner's paths.
});

void test('paging seeds reject every payload substitution even if its forged before/after copies agree', () => {
  const scenario = SCENARIOS[17];
  const path = FULL_BUDGET_PATHS[500];
  const makeSeed = () => ({ method: scenario.method, ...fullBudgetBinderFixture(path, runId, seedStamp(scenario)) });
  assertSeed(makeSeed(), scenario, runId);
  for (const change of [
    data => { data.binderId = 'paging-0501'; }, data => { data.ownerUid = OTHER_OWNER; },
    data => { data.name = 'other'; }, data => { delete data.description; }, data => { data.description = ''; },
    data => { data.coverStyle = 'other'; }, data => { data.minimumPageCount = 2; },
    data => { data.createdAtClient++; }, data => { data.updatedAtClient++; },
    data => { delete data.lastOpenedAtClient; }, data => { data.lastOpenedAtClient = 1700000000000; },
    data => { data.deleted = true; }, data => { data.revision = 0; }, data => { data.revision = 2; },
    data => { data.lastMutationId = `private-full-${runId}-paging-0501`; }, data => { data.extra = true; },
    data => { data.updatedAt = null; }, data => { data.updatedAt.seconds = 0; },
    data => { data.updatedAt.nanoseconds = 1e9; }, data => { data.updatedAt.extra = true; },
  ]) {
    const seed = makeSeed(); change(seed.data); assert.throws(() => assertSeed(seed, scenario, runId));
  }
  // Full proof case: coordinated forged identity must not become legal simply
  // because every copy is identical. The independent exact fixture still rules.
  const forged = proof();
  for (const item of [forged.seeds.find(item => item.path === path),
    forged.preflights[17].entries.find(item => item.path === path), forged.readbacks[17].entries.find(item => item.path === path)])
    item.data.lastMutationId = 'forged-client-write';
  assert.throws(() => validateServerProof(forged, runId));
});

void test('full-budget proof rejects missing/extra paths, client writes, privilege changes and partial completion', () => {
  const scenario = SCENARIOS[17]; const path = FULL_BUDGET_PATHS[1000];
  const row = value => value.readbacks[17].entries.find(item => item.path === path);
  const addDocument = (snapshot, path, data) => {
    snapshot.entries.push({ path, data }); snapshot.entries.sort((left, right) => lexical(left.path, right.path));
    const parts = path.split('/');
    for (let length = 1; length <= parts.length; length++) {
      const inventory = length % 2 === 0 ? snapshot.documentPaths : snapshot.collectionPaths;
      const item = parts.slice(0, length).join('/');
      if (!inventory.includes(item)) inventory.push(item);
      inventory.sort(lexical);
    }
  };
  for (const change of [
    value => { value.seeds = value.seeds.filter(item => item.path !== path); },
    value => { value.seeds.push(structuredClone(value.seeds.find(item => item.path === path))); },
    value => { value.seeds.find(item => item.path === path).method = SCENARIOS[13].method; },
    value => { value.seeds.find(item => item.path === path).data.updatedAt.nanoseconds++; },
    value => { value.preflights[17].entries.find(item => item.path === path).data.updatedAt.nanoseconds++; },
    value => { row(value).data.updatedAt.nanoseconds++; },
    value => { row(value).data.revision = 2; }, value => { row(value).data.name = 'client rewrite'; },
    value => { value.preflights[17].entries = value.preflights[17].entries.filter(item => item.path !== path); },
    value => { value.readbacks[17].entries = value.readbacks[17].entries.filter(item => item.path !== path); },
    value => { value.readbacks[17].documentPaths = value.readbacks[17].documentPaths.filter(item => item !== path); },
    value => { value.readbacks[17].entries.push(structuredClone(row(value))); },
    value => { addDocument(value.readbacks[17], `${FULL_BUDGET_COLLECTION}/paging-1001`, row(value).data); },
    value => { addDocument(value.readbacks[17], FULL_BUDGET_PARENT, { ownerUid: scenario.owner }); },
    value => { addDocument(value.preflights[17], `accountAccess/${scenario.owner}`, { appAccess: true }); },
    value => { addDocument(value.readbacks[17], `${FULL_BUDGET_PARENT}/collectionEntries/entry`, entryFixture(scenario, runId, finalStamp(scenario))); },
    value => { value.readbacks[17].collectionPaths.push(`${FULL_BUDGET_PARENT}/collectionPriceSelections`); },
    value => { value.readbacks[17].documentPaths.push(`${FULL_BUDGET_COLLECTION}/paging-0000/child/empty`); },
    value => { value.readbacks[17].entries.find(item => item.path === entryPath(SCENARIOS[0])).data.updatedAt.nanoseconds++; },
    value => { value.preflights[17].accounts.find(item => item.uid === scenario.owner).customClaims.admin = true; },
    value => { value.readbacks[17].accounts.find(item => item.uid === scenario.owner).providerData[0].uid = 'wrong-google'; },
    value => { value.phases.pop(); }, value => { value.phases[17].successEvidence = false; },
    value => { value.preflights.pop(); }, value => { value.readbacks.pop(); },
    value => { value.errors.push({ method: scenario.method, error: 'FULL checkpoint lost after Room reopen' }); },
    value => { value.readbackErrors.push({ method: scenario.method, error: 'Admin inventory incomplete' }); },
    value => { value.error = 'Owned Room teardown failed'; },
  ]) {
    const broken = proof(); change(broken); assert.throws(() => validateServerProof(broken, runId));
  }
});
void test('revocation barrier path and ready bytes reject every stale or malformed identity', () => {
  assert.equal(revocationReadyPath(runId), 'files/domidex-knowledge-revoked-sdk-' + runId + '/ready.txt');
  const ready = 'v1|' + runId + '|sdk-proof-collection-knowledge-revoked|' +
    'knowledgeListenerPermissionDeniedInvalidatesHintAndPreservesLocalState|' + '6'.repeat(64) + '\n';
  assert.equal(revocationReadyText(runId), ready); assert.equal(assertRevocationReady(ready, runId), ready);
  for (const wrong of ['', ready.trimEnd(), ready + '\n', '\ufeff' + ready, ready.replace('\n', '\r\n'),
    ready.replace(runId, 'b'.repeat(32)), ready.replace(REVOCATION.owner, OTHER_OWNER),
    ready.replace(REVOCATION.method, SCENARIOS[14].method), ready.replace('6'.repeat(64), '5'.repeat(64)), {}, null])
    assert.throws(() => assertRevocationReady(wrong, runId));
  for (const id of ['../bad', 'A'.repeat(32), 'a'.repeat(31), '', null, 123])
    assert.throws(() => revocationReadyPath(id));
});
void test('sole live exact START authorizes readiness but partial terminal or duplicate statuses do not', () => {
  const start = status(REVOCATION.method, 1);
  assert.equal(REVOCATION_CLASS, TEST_CLASS);
  assert.equal(revocationStartIsActive('', true), false);
  for (let length = 0; length < start.length; length++)
    assert.equal(revocationStartIsActive(start.slice(0, length), true), false);
  assert.equal(revocationStartIsActive(start, true), true);
  assert.equal(revocationStartIsActive(start.replaceAll('\n', '\r\n'), true), true);
  assert.equal(revocationStartIsActive(start + 'INSTRUMENTATION_STATUS: test=', true), false);
  assert.equal(revocationStartIsActive(start + 'INSTRUMENTATION_STATUS: test=partial\n', true), false);
  for (const bad of [start + start, start + status(REVOCATION.method, 0),
    start.replace('numtests=1', 'numtests=2'), start.replace('numtests=1', 'numtests=1\nINSTRUMENTATION_STATUS: numtests=1'),
    start.replace(TEST_CLASS, 'foreign'), start.replace(REVOCATION.method, SCENARIOS[0].method),
    start.replace('STATUS_CODE: 1', 'STATUS_CODE: 2'), start.replace('STATUS_CODE: 1', 'STATUS_CODE: -2'),
    start + 'INSTRUMENTATION_FAILED', start + 'FAILURES!!!', start + 'Process crashed', start + 'INSTRUMENTATION_CODE:'])
    assert.throws(() => revocationStartIsActive(bad, true));
  assert.throws(() => revocationStartIsActive(start, false)); // Recheck after an awaited Admin read.
  assertRevocationMayCreate({ running: true, cancelled: false, output: start });
  assert.throws(() => assertRevocationMayCreate({ running: true, cancelled: true, output: start }));
  assert.throws(() => assertRevocationMayCreate({ running: false, cancelled: false, output: start }));
  assert.throws(() => validateInstrumentation(start.replace('STATUS_CODE: 1', 'STATUS_CODE: 2') + instrumentation(REVOCATION.method), REVOCATION.method));
});
void test('revocation inserts one exact positive knowledge seed while the large exception stays final only', () => {
  assert.equal(SCENARIOS[15], REVOCATION); assert.equal(SCENARIOS[17].key, 'private-full-budget');
  assert.equal(SCENARIOS.length, 18); assert.equal(ACCOUNTS.length, 19);
  const expected = { path: 'scanKnowledge/' + '6'.repeat(64), data: {
    fingerprint: '6'.repeat(64), cardId: 'sdk-knowledge-' + runId + '-revoked-server',
    sourceSetId: 'synthetic-server-set', cardNumber: '101/202', status: 'STABLE',
    confidence: 91, confirmations: 7, corrections: 2, knowledgeVersion: 1, lastUpdatedAt: seedStamp(REVOCATION),
  } };
  assert.equal(REVOCATION_KNOWLEDGE_PATH, expected.path);
  assert.deepEqual(revocationKnowledgeFixture(runId, seedStamp(REVOCATION)), expected);
  assert.deepEqual(seedFixtures(REVOCATION, runId, seedStamp(REVOCATION)), [expected]);
  assertSeed({ method: REVOCATION.method, ...expected }, REVOCATION, runId);
  assert.throws(() => assertEntry(entryFixture(REVOCATION, runId, seedStamp(REVOCATION)), REVOCATION, runId));
  for (const scenario of [REVOCATION, MUTATION, SCENARIOS[17]]) assertKnowledgeInventoryPath(expected.path, scenario);
  for (const scenario of [undefined, ...SCENARIOS.slice(0, 15), { ...REVOCATION }, { ...SCENARIOS[17] }])
    assert.throws(() => assertKnowledgeInventoryPath(expected.path, scenario));
  for (const path of [FULL_BUDGET_PARENT, ...FULL_BUDGET_PATHS])
    assert.throws(() => isFullBudgetInventoryPath(path, REVOCATION));
  for (const change of [data => { data.knowledgeVersion = '1'; }, data => { data.fingerprint = '5'.repeat(64); },
    data => { data.cardId = 'local'; }, data => { data.sourceSetId = null; }, data => { data.cardNumber = ''; },
    data => { data.confidence++; }, data => { data.confirmations++; }, data => { data.corrections++; },
    data => { data.status = 'CANDIDATE'; }, data => { data.lastUpdatedAt.seconds = 0; }, data => { data.extra = true; }]) {
    const seed = { method: REVOCATION.method, ...structuredClone(expected) }; change(seed.data);
    assert.throws(() => assertSeed(seed, REVOCATION, runId));
  }
});
void test('one owned lock fits existing bounds and full independent snapshots prove complete restoration', () => {
  const valid = proof(); const before = valid.preflights[15]; const locked = expectedLockedSnapshot(before, runId);
  assert.deepEqual(before, valid.readbacks[15]);
  assert.equal(before.collectionPaths.length, 15); assert.equal(before.documentPaths.length, 26); assert.equal(before.entries.length, 17);
  assert.equal(locked.collectionPaths.length, 16); assert.equal(locked.documentPaths.length, 27); assert.equal(locked.entries.length, 18);
  assert.deepEqual(locked.entries.find(item => item.path === REVOCATION_LOCK_PATH),
    { path: 'accountDeletionLocks/sdk-proof-collection-knowledge-revoked', data: { jobId: 'sdk-knowledge-revoked-' + runId } });
  assert.equal(validateRevocationReceipt(valid.revocations[0], runId, before, valid.readbacks[15]).hostBarriers, 1);
  assert.equal(validateServerProof(valid, runId).actualKnowledgeListenerRevocationCases, 1);
  assert.equal(valid.readbacks[17].collectionPaths.length, 16); assert.equal(valid.readbacks[17].documentPaths.length, 1029);
  assert.equal(valid.readbacks[17].entries.length, 1019);
  assert.equal(valid.readbacks[17].collectionPaths.includes('accountDeletionLocks'), false);
});
void test('revocation receipt rejects false causality, foreign mutation, changed ownership and incomplete restoration', () => {
  for (const change of [
    item => { item.ready = item.ready.trimEnd(); }, item => { item.positiveReadyReads = 2; },
    item => { item.createAttempts = 2; }, item => { item.deleteAttempts = 0; },
    item => { item.events.reverse(); }, item => { item.events.splice(5, 1); },
    item => { item.lock.path = 'accountDeletionLocks/' + OTHER_OWNER; }, item => { item.lock.data.jobId = 'foreign'; },
    item => { item.lock.data.extra = true; }, item => { item.lockWriteTime.seconds = 0; },
    item => { item.lockWriteTime.nanoseconds = 1e9; }, item => { item.lockWriteTime = 'fake'; },
    item => { item.lockObservedWriteTime.nanoseconds++; }, item => { item.deleteCheckedWriteTime.nanoseconds++; },
    item => { item.beforeCreate = item.afterCreate; }, item => { item.afterCreate = item.beforeCreate; },
    item => { item.lockedAndroidReadback = item.afterDelete; }, item => { delete item.lockedAndroidReadback; },
    item => { item.afterDelete = item.afterCreate; },
    item => { item.lockedAndroidReadback.accounts[0].customClaims.admin = true; },
    item => { item.afterCreate.entries[0].data.extra = true; },
    item => { item.afterDelete.documentPaths.push('accountAccess/' + REVOCATION.owner); },
    item => { item.errors.push({ stage: 'barrier', error: 'timed out' }); }, item => { item.extra = true; },
  ]) {
    const valid = proof(); change(valid.revocations[0]);
    assert.throws(() => validateServerProof(valid, runId));
  }
});
void test('seventeenth proof cannot pass from Android completion or cleaned tree alone', () => {
  for (const change of [
    value => { delete value.revocations; }, value => { value.revocations = []; },
    value => { value.revocations.push(structuredClone(value.revocations[0])); },
    value => { value.phases.splice(15, 1); }, value => { value.phases[15].successEvidence = false; },
    value => { value.preflights.splice(15, 1); }, value => { value.readbacks.splice(15, 1); },
    value => { value.errors.push({ method: REVOCATION.method, error: 'SDK did not report PERMISSION_DENIED' }); },
    value => { value.readbackErrors.push({ method: REVOCATION.method, error: 'owned lock cleanup failed' }); },
  ]) { const broken = proof(); change(broken); assert.throws(() => validateServerProof(broken, runId)); }
});

void test('ready probes require shell-v2 exit status and reject every unknown result immediately', () => {
  const response = (code = 0, output = '') => ({ result: { code, stopped: null, signal: null, error: null }, output });
  assertRevocationDeviceResult(response());
  assertRevocationShellV2(response(0, 'stat_v2\nshell_v2\ncmd\n'));
  assertRevocationShellV2(response(0, 'shell_v2\r\n'));
  assert.equal(revocationReadyExists(response()), true);
  assert.equal(revocationReadyExists(response(1)), false);
  const encode = value => Buffer.from(value, 'utf8').toString('base64');
  const encodedReady = encode(revocationReadyText(runId));
  assert.equal(assertRevocationReadyRead(response(0, encodedReady), runId), revocationReadyText(runId));
  for (const code of [2, -1, null, '1', undefined])
    assert.throws(() => revocationReadyExists({ ...response(), result: { ...response().result, code } }));
  for (const output of ['run-as: package not debuggable\n', 'error: device offline\n', ' ', '\n'])
    assert.throws(() => revocationReadyExists(response(1, output)));
  for (const change of [
    item => { item.result.stopped = 'timeout'; }, item => { item.result.stopped = 'interrupted'; },
    item => { item.result.stopped = 'output-limit'; }, item => { item.result.stopped = 'output-handler-failed'; },
    item => { item.result.error = 'ENOENT'; }, item => { item.result.signal = 'SIGTERM'; },
  ]) {
    const probe = response(1); change(probe); assert.throws(() => revocationReadyExists(probe));
    const read = response(0, encodedReady); change(read);
    assert.throws(() => assertRevocationReadyRead(read, runId));
    const feature = response(0, 'shell_v2\n'); change(feature);
    assert.throws(() => assertRevocationShellV2(feature));
  }
  for (const bad of [response(1, encodedReady), response(0), response(0, 'partial'),
    response(0, revocationReadyText(runId))])
    assert.throws(() => assertRevocationReadyRead(bad, runId));
  for (const malformed of [
    encodedReady + '\n', encodedReady + '\r\n', '\ufeff' + encodedReady, ' ' + encodedReady,
    encodedReady + ' ', encodedReady.slice(0, 64) + '\n' + encodedReady.slice(64),
    encodedReady.slice(0, -1), encodedReady + encodedReady,
    encode(revocationReadyText(runId).replace('\n', '\r\n')),
    encode(revocationReadyText(runId).replace('\n', '\r\r\n')),
    encode(revocationReadyText(runId).trimEnd()), encode(revocationReadyText(runId) + '\n'),
    encode('\ufeff' + revocationReadyText(runId)), encode(revocationReadyText('b'.repeat(32))),
  ]) assert.throws(() => assertRevocationReadyRead(response(0, malformed), runId));
  for (const bad of [response(1, 'shell_v2\n'), response(0, 'cmd\nstat_v2\n'), response(0, 'shell_v2\nshell_v2\n'),
    response(0, 'stat_v2,shell_v2,cmd\n'),
    response(0, 'shell_v2\nnot a feature\n'), response(0, ' shell_v2\n'), response(0, 'shell_v2')])
    assert.throws(() => assertRevocationShellV2(bad));
});

void test('eighteenth fixed scenario adds one valid seed and one nominal account without changing original ordering', () => {
  assert.equal(SCENARIOS[15], REVOCATION); assert.equal(SCENARIOS[16], MUTATION);
  assert.equal(SCENARIOS[17].key, 'private-full-budget'); assert.equal(SCENARIOS.length, 18);
  assert.equal(ACCOUNTS.length, 19);
  const expected = { path: 'scanKnowledge/' + '8'.repeat(64), data: {
    fingerprint: '8'.repeat(64), cardId: 'sdk-knowledge-' + runId + '-revoked-on-data-change-server',
    sourceSetId: 'synthetic-server-set', cardNumber: '101/202', status: 'STABLE',
    confidence: 91, confirmations: 7, corrections: 2, knowledgeVersion: 1, lastUpdatedAt: seedStamp(MUTATION),
  } };
  assert.deepEqual(mutationFixture(runId, seedStamp(MUTATION)), expected);
  assert.deepEqual(seedFixtures(MUTATION, runId, seedStamp(MUTATION)), [expected]);
  assertSeed({ method: MUTATION.method, ...expected }, MUTATION, runId);
  assert.throws(() => assertEntry(entryFixture(MUTATION, runId, seedStamp(MUTATION)), MUTATION, runId));
  for (const scenario of [MUTATION, SCENARIOS[17]]) assertKnowledgeInventoryPath(MUTATION_PATH, scenario);
  for (const wrong of [undefined, ...SCENARIOS.slice(0, 16), { ...MUTATION }, { ...SCENARIOS[17] }])
    assert.throws(() => assertKnowledgeInventoryPath(MUTATION_PATH, wrong));
  for (const path of [FULL_BUDGET_PARENT, ...FULL_BUDGET_PATHS])
    assert.throws(() => isFullBudgetInventoryPath(path, MUTATION));
  const account = ACCOUNTS.find(item => item.uid === MUTATION.owner);
  assert.deepEqual(account, { uid: MUTATION.owner, email: MUTATION.owner + '@example.invalid', emailVerified: true,
    disabled: false, customClaims: { appAccess: true },
    providerData: [{ providerId: 'google.com', uid: MUTATION.owner + '-google', email: MUTATION.owner + '@example.invalid' }] });
  const value = proof(); assert.equal(validateServerProof(value, runId).actualKnowledgeListenerDataChangeRevocationCases, 1);
  assert.deepEqual(value.preflights[16], value.readbacks[16]);
  assert.deepEqual(value.readbacks[17].entries.find(row => row.path === MUTATION_PATH), expected);
});
void test('new barrier keeps exact marker bytes, original strict START and hard stopped-state rejection', () => {
  const text = 'v1|' + runId + '|sdk-proof-collection-knowledge-revoked-on-data-change|' +
    'knowledgeListenerPermissionDeniedAfterDataChangeInvalidatesHintAndPreservesLocalState|' + '8'.repeat(64) + '\n';
  assert.equal(mutationReadyText(runId), text);
  assert.equal(mutationReadyPath(runId), 'files/domidex-knowledge-revoked-on-data-change-sdk-' + runId + '/ready.txt');
  const response = value => ({ output: Buffer.from(value, 'utf8').toString('base64'),
    result: { code: 0, stopped: null, signal: null, error: null } });
  assert.equal(assertMutationReadyRead(response(text), runId), text);
  for (const wrong of [text.trimEnd(), text + '\n', text.replace('\n', '\r\n'), text.replace('\n', '\r\r\n'),
    '\ufeff' + text, text.replace(runId, 'b'.repeat(32)), text.replace(MUTATION.owner, REVOCATION.owner),
    text.replace(MUTATION.method, REVOCATION.method), text.replace('8'.repeat(64), '6'.repeat(64))])
    assert.throws(() => assertMutationReadyRead(response(wrong), runId));
  for (const alter of [
    value => { value.output += '\n'; }, value => { value.output = ' ' + value.output; },
    value => { value.result.code = 1; }, value => { value.result.stopped = 'timeout'; },
    value => { value.result.error = 'run-as failure'; }, value => { value.result.signal = 'SIGTERM'; },
  ]) { const value = response(text); alter(value); assert.throws(() => assertMutationReadyRead(value, runId)); }
  const start = status(MUTATION.method, 1);
  for (let i = 0; i < start.length; i++) assert.equal(mutationStartIsActive(start.slice(0, i), true), false);
  assert.equal(mutationStartIsActive(start, true), true);
  assert.equal(mutationStartIsActive(start + 'INSTRUMENTATION_STATUS: test=', true), false);
  for (const output of [start + start, status(REVOCATION.method, 1), start + status(MUTATION.method, 0),
    start.replace('numtests=1', 'numtests=2'), start.replace(TEST_CLASS, 'foreign'), start + 'FAILURES!!!',
    start + 'INSTRUMENTATION_CODE:'])
    assert.throws(() => assertMutationMayWrite({ running: true, cancelled: false, output }));
  for (const lifecycle of [{ running: false, cancelled: false, output: start }, { running: true, cancelled: true, output: start }])
    assert.throws(() => assertMutationMayWrite(lifecycle));
});
void test('data-change receipt requires five complete snapshots, original version ownership and a single atomic cleanup', () => {
  const value = proof(); const receipt = value.mutations[0]; const before = value.preflights[16];
  assert.deepEqual([before.collectionPaths.length, before.documentPaths.length, before.entries.length], [15, 27, 18]);
  assert.deepEqual([receipt.afterMutation.collectionPaths.length, receipt.afterMutation.documentPaths.length,
    receipt.afterMutation.entries.length], [16, 28, 19]);
  assert.equal(validateMutationReceipt(receipt, runId, before, value.readbacks[16]).atomicRestoreAndDelete, true);
  for (const change of [
    r => { r.ready = revocationReadyText(runId); }, r => { r.positiveReadyReads = 2; },
    r => { r.createAttempts = 2; }, r => { r.mutationAttempts = 0; }, r => { r.cleanupAttempts = 2; },
    r => { r.createOutcome = 'unknown'; }, r => { r.mutationOutcome = 'unknown'; }, r => { r.cleanupOutcome = 'unknown'; },
    r => { r.seed.data.confidence = 90; }, r => { r.seed.path = REVOCATION_KNOWLEDGE_PATH; },
    r => { r.lock.data.jobId = 'foreign'; }, r => { r.lock.path = REVOCATION_LOCK_PATH; },
    r => { r.seedWriteTime.seconds = 0; }, r => { r.lockObservedWriteTime.nanoseconds++; },
    r => { r.mutationCheckedLockTime.nanoseconds++; }, r => { r.mutationCheckedSeedTime.nanoseconds++; },
    r => { r.mutationWriteTime = r.seedWriteTime; }, r => { r.cleanupCheckedSeedTime.nanoseconds++; },
    r => { r.cleanupCheckedLockTime.nanoseconds++; }, r => { r.restoredSeedWriteTime = r.mutationWriteTime; },
    r => { r.deletedLockWriteTime.nanoseconds++; }, r => { r.beforeCreate = r.afterCreate; },
    r => { r.afterCreate = r.afterMutation; }, r => { r.afterMutation = r.afterCreate; },
    r => { r.lockedAndroidReadback = r.afterRestore; }, r => { r.afterRestore = r.afterMutation; },
    r => { r.afterMutation.entries.find(item => item.path === MUTATION_PATH).data.lastUpdatedAt.nanoseconds++; },
    r => { r.afterMutation.entries.find(item => item.path === MUTATION_PATH).data.knowledgeVersion = '1'; },
    r => { r.lockedAndroidReadback.accounts[0].customClaims.admin = true; },
    r => { r.events.reverse(); }, r => { r.events.splice(4, 1); }, r => { r.errors.push({ stage: 'commit', error: 'unknown' }); },
    r => { delete r.afterMutation; }, r => { r.extra = true; },
  ]) { const broken = proof(); change(broken.mutations[0]); assert.throws(() => validateServerProof(broken, runId)); }
  for (const change of [
    p => { delete p.mutations; }, p => { p.mutations = []; }, p => { p.mutations.push(p.mutations[0]); },
    p => { p.phases.splice(16, 1); }, p => { p.readbacks.splice(16, 1); },
    p => { p.preflights.splice(16, 1); }, p => { p.errors.push({ method: REVOCATION.method, error: 'original lock-only RED' }); },
    p => { p.errors.push({ method: MUTATION.method, error: 'missing actual SDK denial' }); },
    p => { p.readbacks[17].entries.find(row => row.path === MUTATION_PATH).data.confidence = 90; },
  ]) { const broken = proof(); change(broken); assert.throws(() => validateServerProof(broken, runId)); }
});
// These controls exercise only host orchestration. They never fabricate a passing Android log.
function mutationDriverControl() {
  const before = preflight(16); const receipt = createMutationState(runId);
  const lifecycle = { running: true, cancelled: false, output: status(MUTATION.method, 1) };
  const calls = { snapshots: 0, documents: 0, create: 0, mutate: 0, restore: 0, delete: 0, sleeps: 0 };
  const state = { tree: structuredClone(before), seedTime: { seconds: 1700000600, nanoseconds: 1000 }, lockTime: null,
    onSnapshot: null, onDocuments: null, unknownCreate: false, unknownMutation: false, unknownRestore: false,
    rejectRestore: false, now: 0 };
  const next = () => ({ seconds: ++state.clock, nanoseconds: 1000 }); state.clock = 1700000600;
  const io = {
    now: () => state.now, sleep: async () => { calls.sleeps++; state.now += 100; }, save: () => {},
    probeReady: async () => ({ output: '', result: { code: 0, stopped: null, signal: null, error: null } }),
    readReady: async () => ({ output: Buffer.from(mutationReadyText(runId), 'utf8').toString('base64'),
      result: { code: 0, stopped: null, signal: null, error: null } }),
    snapshot: async () => { calls.snapshots++; state.onSnapshot?.(calls.snapshots); return structuredClone(state.tree); },
    documents: async () => {
      calls.documents++; state.onDocuments?.(calls.documents);
      return {
        seed: { ...structuredClone(state.tree.entries.find(row => row.path === MUTATION_PATH)), exists: true, writeTime: structuredClone(state.seedTime) },
        lock: state.lockTime
          ? { ...mutationLock(runId), exists: true, writeTime: structuredClone(state.lockTime) }
          : { path: MUTATION_LOCK_PATH, exists: false },
      };
    },
    createLock: async data => {
      calls.create++; assert.equal(state.lockTime, null); assert.deepEqual(data, mutationLock(runId).data);
      state.tree = mutationSnapshot(before, runId); state.lockTime = next();
      if (state.unknownCreate) throw Error('unknown create acknowledgement');
      return structuredClone(state.lockTime);
    },
    mutateSeed: async seedTime => {
      calls.mutate++; assert.deepEqual(seedTime, state.seedTime);
      assert.ok(state.lockTime); state.tree = mutationSnapshot(before, runId, true); state.seedTime = next();
      if (state.unknownMutation) throw Error('unknown mutation acknowledgement');
      return structuredClone(state.seedTime);
    },
    restoreAndDelete: async (seed, seedTime, lockTime) => {
      calls.restore++; assert.deepEqual(seed, mutationSeed(before, runId));
      assert.deepEqual(seedTime, state.seedTime); assert.deepEqual(lockTime, state.lockTime);
      if (state.rejectRestore) throw Error('one CAS failed; whole batch rejected');
      state.tree = structuredClone(before); state.seedTime = next(); state.lockTime = null;
      if (state.unknownRestore) throw Error('unknown atomic acknowledgement');
      return [structuredClone(state.seedTime), structuredClone(state.seedTime)];
    },
    deletePristineLock: async time => {
      calls.delete++; assert.deepEqual(time, state.lockTime);
      assert.equal(state.tree.entries.find(row => row.path === MUTATION_PATH).data.confidence, 91);
      state.tree = structuredClone(before); state.lockTime = null;
    },
  };
  return { before, receipt, lifecycle, calls, state, io };
}
void test('host driver performs one create, one CAS and one atomic restoration, retaining complete intermediate evidence', async () => {
  const x = mutationDriverControl();
  await beginMutation(x.receipt, x.before, x.lifecycle, x.io);
  x.lifecycle.running = false;
  await finishMutation(x.receipt, x.before, x.io);
  validateMutationReceipt(x.receipt, runId, x.before, x.receipt.afterRestore);
  assert.deepEqual([x.calls.create, x.calls.mutate, x.calls.restore, x.calls.delete], [1, 1, 1, 0]);
});
void test('stop or terminal in the Admin-await window forbids a new lock create', async () => {
  for (const stop of [
    x => { x.lifecycle.cancelled = true; }, x => { x.lifecycle.running = false; },
    x => { x.lifecycle.output += status(MUTATION.method, 0); },
  ]) {
    const x = mutationDriverControl(); x.state.onDocuments = n => { if (n === 1) stop(x); };
    await assert.rejects(beginMutation(x.receipt, x.before, x.lifecycle, x.io));
    await finishMutation(x.receipt, x.before, x.io);
    assert.deepEqual([x.calls.create, x.calls.mutate, x.calls.restore, x.calls.delete], [0, 0, 0, 0]);
  }
});
void test('stop after the full lock snapshot forbids the seed CAS but permits exact known-lock-only cleanup', async () => {
  for (const stop of [
    x => { x.lifecycle.cancelled = true; }, x => { x.lifecycle.running = false; },
    x => { x.lifecycle.output += 'INSTRUMENTATION_STATUS: test=partial\n'; },
  ]) {
    const x = mutationDriverControl(); x.state.onDocuments = n => { if (n === 3) stop(x); };
    await assert.rejects(beginMutation(x.receipt, x.before, x.lifecycle, x.io));
    await finishMutation(x.receipt, x.before, x.io);
    assert.deepEqual([x.calls.create, x.calls.mutate, x.calls.restore, x.calls.delete], [1, 0, 0, 1]);
    assert.deepEqual(x.receipt.afterRestore, x.before);
    assert.throws(() => validateMutationReceipt(x.receipt, runId, x.before, x.before));
  }
});
void test('unknown create or mutation result authorizes no compensating writes even when the server effect is visible', async () => {
  for (const flag of ['unknownCreate', 'unknownMutation']) {
    const x = mutationDriverControl(); x.state[flag] = true;
    await assert.rejects(beginMutation(x.receipt, x.before, x.lifecycle, x.io));
    await finishMutation(x.receipt, x.before, x.io);
    assert.equal(x.calls.restore, 0); assert.equal(x.calls.delete, 0);
    assert.ok(x.receipt.errors.some(error => error.stage === 'locked-android-readback'));
    assert.throws(() => validateMutationReceipt(x.receipt, runId, x.before, x.receipt.afterRestore));
  }
});
void test('unknown atomic outcome remains RED without retry even if the complete restored tree is readable', async () => {
  const x = mutationDriverControl(); await beginMutation(x.receipt, x.before, x.lifecycle, x.io);
  x.state.unknownRestore = true; x.lifecycle.running = false;
  await finishMutation(x.receipt, x.before, x.io);
  assert.equal(x.calls.restore, 1); assert.equal(x.calls.delete, 0);
  assert.equal(x.receipt.cleanupOutcome, 'unknown'); assert.deepEqual(x.receipt.afterRestore, x.before);
  assert.throws(() => validateMutationReceipt(x.receipt, runId, x.before, x.before));
});
void test('atomic CAS failure retains both documents and cannot degrade to individual cleanup writes', async () => {
  const x = mutationDriverControl(); await beginMutation(x.receipt, x.before, x.lifecycle, x.io);
  x.state.rejectRestore = true; await finishMutation(x.receipt, x.before, x.io);
  assert.equal(x.calls.restore, 1); assert.equal(x.calls.delete, 0);
  assert.deepEqual(x.state.tree, mutationSnapshot(x.before, runId, true));
  assert.throws(() => validateMutationReceipt(x.receipt, runId, x.before, x.receipt.afterRestore));
});
void test('foreign payload, inventory or updateTime changes forbid restoration rather than overwriting them', async () => {
  for (const change of [
    x => { x.state.tree.entries.find(row => row.path === MUTATION_PATH).data.confidence = 89; },
    x => { x.state.tree.accounts[0].customClaims.admin = true; },
    x => { x.state.tree.documentPaths.push('unexpected/foreign'); },
    x => { x.state.seedTime.nanoseconds++; }, x => { x.state.lockTime.nanoseconds++; },
  ]) {
    const x = mutationDriverControl(); await beginMutation(x.receipt, x.before, x.lifecycle, x.io); change(x);
    await finishMutation(x.receipt, x.before, x.io);
    assert.equal(x.calls.restore, 0); assert.equal(x.calls.delete, 0);
    assert.throws(() => validateMutationReceipt(x.receipt, runId, x.before, x.receipt.afterRestore));
  }
});
void test('known acknowledged mutation remains safely cleanable after stop, without a new experimental write', async () => {
  const x = mutationDriverControl(); await beginMutation(x.receipt, x.before, x.lifecycle, x.io);
  x.lifecycle.cancelled = true; x.lifecycle.running = false;
  await finishMutation(x.receipt, x.before, x.io);
  assert.equal(x.calls.mutate, 1); assert.equal(x.calls.restore, 1); assert.equal(x.calls.delete, 0);
  validateMutationReceipt(x.receipt, runId, x.before, x.receipt.afterRestore);
  // A valid host-only receipt still cannot replace the mandatory Android PASS/parser.
  const value = proof(); value.errors.push({ method: MUTATION.method, error: 'cancelled Android' });
  assert.throws(() => validateServerProof(value, runId));
});
void test('ready timeout and unknown transport failure cannot create a lock', async () => {
  for (const kind of ['pending', 'failed']) {
    const x = mutationDriverControl();
    x.io.probeReady = async () => ({ output: '', result: { code: 1,
      stopped: kind === 'failed' ? 'timeout' : null, signal: null, error: null } });
    await assert.rejects(beginMutation(x.receipt, x.before, x.lifecycle, x.io));
    assert.equal(x.calls.create, 0); assert.equal(x.calls.mutate, 0);
    assert.equal(x.calls.sleeps, kind === 'pending' ? 200 : 0);
  }
});

void test('failed complete locked readback cannot authorize partial cleanup', async () => {
  const x = mutationDriverControl(); await beginMutation(x.receipt, x.before, x.lifecycle, x.io);
  x.state.onSnapshot = n => { if (n === 4) throw Error('Admin inventory unavailable'); };
  await finishMutation(x.receipt, x.before, x.io);
  assert.equal(x.calls.restore, 0); assert.equal(x.calls.delete, 0);
  assert.ok(x.receipt.errors.some(error => error.stage === 'locked-android-readback'));
  assert.throws(() => validateMutationReceipt(x.receipt, runId, x.before, x.receipt.afterRestore));
});
