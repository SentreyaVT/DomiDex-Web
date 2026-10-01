// Pure fail-closed contract tests; these do not run Android or establish SDK evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT, SERIAL, AVD, SCENARIOS, OTHER_OWNER, ACCOUNTS, TEST_CLASS, validRunId, parseSessionOptions,
  entryPath, entryFixture, finalEntryFixture, seedFixtures, lateParentSeedFixtures, assertEntry, assertSeed,
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
const finalDocuments = index => SCENARIOS.slice(0, index + 1).flatMap(scenario => scenario.key === 'missing' ? [] :
  [...(scenario.key === 'late-parent' ? lateParentSeedFixtures(runId, seedStamp(scenario)) : []), documentFixture(scenario)]);
const snapshot = (index, before = false) => {
  const current = SCENARIOS[index];
  const entries = (before
    ? [...(index === 0 ? [] : finalDocuments(index - 1)), ...seedFixtures(current, runId, seedStamp(current))]
    : finalDocuments(index)).sort((left, right) => lexical(left.path, right.path));
  const collectionPaths = new Set(); const documentPaths = new Set();
  for (const item of entries) {
    const fields = item.path.split('/');
    collectionPaths.add('users'); collectionPaths.add(fields.slice(0, 3).join('/'));
    documentPaths.add(fields.slice(0, 2).join('/')); documentPaths.add(item.path);
  }
  return { method: current.method, accounts: structuredClone(ACCOUNTS), entries,
    collectionPaths: [...collectionPaths].sort(lexical), documentPaths: [...documentPaths].sort(lexical) };
};
const readback = index => snapshot(index);
const preflight = index => snapshot(index, true);
const proof = () => ({ project: PROJECT, runId, verified: true, accountUnchanged: true, errors: [], readbackErrors: [],
  phases: SCENARIOS.map(({ method }) => ({ passed: 1, method, successEvidence: true })),
  readbacks: SCENARIOS.map((_, index) => readback(index)),
  preflights: SCENARIOS.map((_, index) => preflight(index)),
  seeds: SCENARIOS.flatMap(scenarioSeeds) });

void test('exact demo/AVD and path-safe run ID are fixed, with no project/serial/port override', () => {
  assert.equal(PROJECT, 'demo-domidex-privacy'); assert.equal(SERIAL, 'emulator-5554'); assert.equal(AVD, 'DomiDex_R27_Baseline_API36');
  assert.equal(OTHER_OWNER, 'sdk-proof-collection-other'); assert.equal(ACCOUNTS.length, 8);
  assert.deepEqual(SCENARIOS.map(({ key }) => key), ['healthy', 'stale', 'missing', 'malformed', 'confirmed', 'pending-overlay', 'late-parent']);
  assert.deepEqual(PORTS, { auth: 9097, firestore: 8187, storage: 9297, hub: 4407, logging: 4507, websocket: 9150 });
  assert.equal(validRunId(runId), runId); assert.ok(parseSessionOptions(['--android-root', '.'])['--android-root']);
  for (const value of ['', '../bad', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), undefined, 1e31, {}]) assert.throws(() => validRunId(value));
  for (const args of [[], ['--android-root'], ['--android-root', '--project'], ['--android-root', '.', '--android-root', '.'],
    ['--android-root', '.', '--project', PROJECT], ['--android-root', '.', '--serial', SERIAL],
    ['--android-root', '.', '--port', '8187'], ['--android-root', '.', '--run-id', runId]]) assert.throws(() => parseSessionOptions(args));
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
  for (const scenario of SCENARIOS.filter(value => value.key !== 'missing')) {
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
  assert.equal(validateServerProof(proof(), runId).androidCases, 7);
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
  for (const item of [...equal.readbacks.slice(5), equal.preflights[6]])
    item.entries.find(row => row.path === entryPath(scenario)).data.updatedAt = structuredClone(seed.data.updatedAt);
  assert.equal(validateServerProof(equal, runId).androidCases, 7);
});
void test('late parent preserves all three orphan seeds, requires only the client-created parent and rejects extras', () => {
  const scenario = SCENARIOS[6]; const valid = proof();
  const seeds = valid.seeds.filter(item => item.method === scenario.method);
  assert.equal(seeds.length, 3);
  assert.equal(valid.preflights[6].entries.some(item => item.path === entryPath(scenario)), false);
  const placementPath = `users/${scenario.owner}/privateBinderPlacements/late-parent-placement`;
  for (const mutate of [
    value => { value.seeds.pop(); }, value => { value.seeds.push(structuredClone(value.seeds[3])); },
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
