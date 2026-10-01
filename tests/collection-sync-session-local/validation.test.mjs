// Pure fail-closed contract tests; these do not run Android or establish SDK evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT, SERIAL, AVD, SCENARIOS, OTHER_OWNER, ACCOUNTS, TEST_CLASS, validRunId, parseSessionOptions,
  entryPath, entryFixture, assertEntry, validateInstrumentation, validateReadback, validateReadbacks, validateServerProof,
  assertNoInstrumentation } from './contract.mjs';
import { PORTS, assertTestEnvironment, isolatedEnvironment } from '../private-operations-local/safety.mjs';
const runId = 'a'.repeat(32);
const status = (method, code) => `INSTRUMENTATION_STATUS: class=${TEST_CLASS}\nINSTRUMENTATION_STATUS: test=${method}\nINSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
const instrumentation = method => status(method, 1) + status(method, 0) + '\nOK (1 test)\nINSTRUMENTATION_CODE: -1\n';
const documentScenarios = index => SCENARIOS.slice(0, index + 1).filter(scenario => scenario.key !== 'missing');
const documentFixture = scenario => ({ path: entryPath(scenario),
  data: entryFixture(scenario, runId, { seconds: 1700000100 + SCENARIOS.indexOf(scenario), nanoseconds: 1234 }) });
const readback = index => ({ method: SCENARIOS[index].method, accounts: structuredClone(ACCOUNTS),
  entries: documentScenarios(index).map(documentFixture).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
  collectionPaths: ['users', ...documentScenarios(index).map(value => `users/${value.owner}/collectionEntries`)].sort(),
  documentPaths: documentScenarios(index).flatMap(value => [`users/${value.owner}`, entryPath(value)]).sort(),
});
const proof = () => ({ project: PROJECT, runId, verified: true, accountUnchanged: true, errors: [], readbackErrors: [],
  phases: SCENARIOS.map(({ method }) => ({ passed: 1, method, successEvidence: true })), readbacks: SCENARIOS.map((_, index) => readback(index)),
  seeds: SCENARIOS.filter(scenario => scenario.key === 'malformed' || scenario.key === 'confirmed')
    .map(scenario => ({ method: scenario.method, ...documentFixture(scenario) })) });

void test('exact demo/AVD and path-safe run ID are fixed, with no project/serial/port override', () => {
  assert.equal(PROJECT, 'demo-domidex-privacy'); assert.equal(SERIAL, 'emulator-5554'); assert.equal(AVD, 'DomiDex_R27_Baseline_API36');
  assert.equal(OTHER_OWNER, 'sdk-proof-collection-other'); assert.equal(ACCOUNTS.length, 6);
  assert.deepEqual(SCENARIOS.map(({ key }) => key), ['healthy', 'stale', 'missing', 'malformed', 'confirmed']);
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
    const make = () => entryFixture(scenario, runId, { seconds: 1700000100, nanoseconds: 1234 });
    assert.equal(assertEntry(make(), scenario, runId).revision, 1);
    for (const mutate of [value => { delete value.notes; }, value => { delete value.acquisitionPriceMinor; },
      value => { value.unexpected = true; }, value => { value.ownerUid = OTHER_OWNER; }, value => { value.syncId = 'foreign'; },
      value => { value.revision = 2; }, value => { value.lastMutationId = 'seeded-ack'; }, value => { value.quantity = 1; },
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
    assert.equal(validateReadback(readback(index), index, runId).serverDocuments, documentScenarios(index).length);
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
  assert.equal(validateServerProof(proof(), runId).androidCases, 5);
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
  validateReadbacks(value.readbacks.slice(0, 3), [], runId);
  validateReadbacks(value.readbacks.slice(0, 4), value.seeds.slice(0, 1), runId);
  assert.throws(() => validateReadbacks(value.readbacks.slice(0, 3), value.seeds.slice(0, 1), runId));
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
