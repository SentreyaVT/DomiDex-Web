// Pure contract/parser tests, not a substitute for the genuine local SDK run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT, SERIAL, AVD, OWNER, ACCOUNT, ENTRY, TEST_CLASS, ANDROID_PHASES, WEB_PHASES, CLEANUP, IDENTITY, NULLABLE,
  validRunId, validResolution, parseConflictOptions, parentFixture, assertChoice, validateInstrumentation,
  validateWebResults, validateServerProof, assertNoInstrumentation } from './contract.mjs';
const runId = 'a'.repeat(32);
const status = (method, code) => `INSTRUMENTATION_STATUS: class=${TEST_CLASS}\nINSTRUMENTATION_STATUS: test=${method}\nINSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
const instrumentation = method => status(method, 1) + status(method, 0) + '\nOK (1 test)\nINSTRUMENTATION_CODE: -1\n';
const report = phase => ({ success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ status: 'passed', assertionResults: [{ title: WEB_PHASES[phase], status: 'passed', failureMessages: [] }] }] });
const choice = revision => ({ schemaVersion: 1, ownerUid: OWNER, entrySyncId: ENTRY, revision, lastMutationId: `mutation-${revision}`,
  updatedAt: { seconds: 1700001000 + revision, nanoseconds: 1000 }, updatedAtClient: 1700000001000 + revision,
  cleared: false, ...IDENTITY, metric: ['normal_avg_sell', 'normal_low', 'normal_avg_1d'][revision - 1],
  amountMinor: [532, 450, 500][revision - 1], currency: 'EUR', sourceAt: 1000,
  selectedAt: [2000, 1700000001002, 3000][revision - 1] });
const serverProof = resolution => ({ project: PROJECT, runId, resolution, verified: true, accountUnchanged: true,
  phases: [{ passed: 1, method: ANDROID_PHASES[0], successEvidence: true }, { passed: 1, phase: 'save', name: WEB_PHASES.save },
    { passed: 1, method: ANDROID_PHASES[1], successEvidence: true }, { passed: 1, method: ANDROID_PHASES[2], successEvidence: true },
    { passed: 1, phase: 'verify', name: WEB_PHASES.verify }],
  readbacks: ['android-create-ack', 'web-save', 'android-held-conflict', 'android-explicit-resolution', 'web-verify']
    .map((label, index) => ({ label, choice: choice([1, 2, 2, resolution === 'cloud' ? 2 : 3, resolution === 'cloud' ? 2 : 3][index]),
      parent: parentFixture({ seconds: 1700000000, nanoseconds: 0 }), account: structuredClone(ACCOUNT),
      accessOverrideAbsent: true, sidecarIds: [ENTRY] })),
});

void test('conflict run requires explicit exact resolution and fresh path-safe run ID', () => {
  assert.equal(SERIAL, 'emulator-5554'); assert.equal(AVD, 'DomiDex_R27_Baseline_API36'); assert.equal(PROJECT, 'demo-domidex-privacy');
  assert.equal(OWNER, 'price-conflict-owner'); assert.equal(validRunId(runId), runId);
  for (const value of ['', '../bad', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32)]) assert.throws(() => validRunId(value));
  for (const value of [undefined, '', 'both', 'CLOUD', 'local ', '../local']) assert.throws(() => validResolution(value));
  for (const mode of ['cloud', 'local']) assert.equal(parseConflictOptions(['--resolution', mode, '--android-root', '.'])['--resolution'], mode);
  for (const args of [['--android-root', '.'], ['--resolution', 'cloud'], ['--resolution', 'both', '--android-root', '.'],
    ['--resolution', 'local', '--resolution', 'cloud', '--android-root', '.'],
    ['--resolution', 'local', '--android-root', '.', '--project', 'production'],
    ['--resolution', 'local', '--android-root', '.', '--unknown']]) assert.throws(() => parseConflictOptions(args));
});
void test('Android proof requires exact conflict class, START+PASS once and no skipped/partial cases', () => {
  const method = ANDROID_PHASES[1]; const valid = instrumentation(method);
  assert.deepEqual(validateInstrumentation(valid, method), { passed: 1, method, successEvidence: true });
  assert.equal(validateInstrumentation(valid.replaceAll('\n', '\r\n'), method).passed, 1);
  for (const broken of ['', valid.replace(status(method, 1), ''), status(method, 1) + valid, status(method, 0) + valid,
    valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -3'), valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -4'),
    valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -2'), valid.replaceAll(method, ANDROID_PHASES[0]),
    valid.replaceAll(TEST_CLASS, 'com.dominik.cardvault.data.sync.AndroidWebPriceRoundTripInstrumentedTest'),
    valid.replace('OK (1 test)', 'OK (2 tests)'), valid.replace('INSTRUMENTATION_CODE: -1', ''),
    valid + 'INSTRUMENTATION_CODE: -1\n', valid + 'INSTRUMENTATION_CODE: 0\n',
    valid + 'INSTRUMENTATION_STATUS: test=unfinished\n', valid.replace('numtests=1', 'numtests=2'),
    valid.replace('numtests=1', 'numtests=1\nINSTRUMENTATION_STATUS: numtests=1'),
    valid + 'INSTRUMENTATION_FAILED: Process crashed\n']) assert.throws(() => validateInstrumentation(broken, method));
  assert.equal(validateInstrumentation(instrumentation(CLEANUP), CLEANUP).successEvidence, false);
  assert.throws(() => validateInstrumentation(instrumentation(CLEANUP), method));
});
void test('Web proof rejects wrong, skipped, partial, duplicate or failed product phases', () => {
  assert.equal(validateWebResults(report('verify'), 'verify').passed, 1);
  for (const mutate of [value => { value.success = false; }, value => { value.numPassedTests = 0; },
    value => { value.numPendingTests = 1; }, value => { value.numTodoTests = 1; }, value => { value.numTotalTests = 2; },
    value => { value.testResults[0].assertionResults[0].title = WEB_PHASES.save; },
    value => { value.testResults[0].assertionResults[0].status = 'pending'; },
    value => { value.testResults[0].assertionResults.push(value.testResults[0].assertionResults[0]); },
    value => { value.testResults[0].status = 'failed'; }]) {
    const value = report('verify'); mutate(value); assert.throws(() => validateWebResults(value, 'verify'));
  }
  assert.throws(() => validateWebResults(report('verify'), 'clear'));
});
void test('live local revision three is exact and cannot pass as an old clear fixture', () => {
  for (const revision of [1, 2, 3]) assert.equal(assertChoice(choice(revision), revision).revision, revision);
  for (const mutate of [value => { delete value.language; }, value => { value.extra = true; },
    value => { value.ownerUid = 'price-roundtrip-owner'; }, value => { value.productId = 43; },
    value => { value.sourceCardId = 'foreign'; }, value => { value.amountMinor = 450; }, value => { value.metric = 'normal_low'; },
    value => { value.sourceAt = 1001; }, value => { value.selectedAt = value.updatedAtClient; },
    value => { value.revision = 2; }, value => { value.updatedAt = null; }, value => { value.updatedAt.nanoseconds = 1e9; },
    value => { value.cleared = true; }, value => { for (const field of NULLABLE) value[field] = null; }]) {
    const value = choice(3); mutate(value); assert.throws(() => assertChoice(value, 3));
  }
});
void test('both ordered conflict proofs include exact parent/account/sidecar evidence at EVERY stage', () => {
  for (const resolution of ['cloud', 'local']) {
    assert.equal(validateServerProof(serverProof(resolution), runId, resolution).androidPhases, 3);
    for (const mutate of [value => { value.runId = 'b'.repeat(32); }, value => { value.resolution = resolution === 'cloud' ? 'local' : 'cloud'; },
      value => { value.accountUnchanged = false; }, value => { value.phases[2].method = CLEANUP; },
      value => { value.phases.reverse(); }, value => { value.readbacks.pop(); }, value => { value.error = 'failed'; },
      value => { value.readbacks[2].choice.updatedAtClient++; value.readbacks[2].choice.selectedAt++; },
      value => { value.readbacks[4].choice.lastMutationId = 'unexpected-write'; }]) {
      const value = serverProof(resolution); mutate(value); assert.throws(() => validateServerProof(value, runId, resolution));
    }
    for (let stage = 0; stage < 5; stage++) for (const mutate of [item => { item.parent.quantity = 2; },
      item => { item.account.customClaims.admin = true; }, item => { item.account.providerData[0].providerId = 'password'; },
      item => { item.account.emailVerified = false; }, item => { item.accessOverrideAbsent = false; },
      item => { item.sidecarIds.push('other'); }, item => { delete item.account; }]) {
      const value = serverProof(resolution); mutate(value.readbacks[stage]); assert.throws(() => validateServerProof(value, runId, resolution));
    }
  }
});
void test('held conflict and cloud resolution may not silently ACK/rebase or rewrite any server fields', () => {
  const held = serverProof('local'); held.readbacks[2].choice = choice(3);
  assert.throws(() => validateServerProof(held, runId, 'local'));
  const cloud = serverProof('cloud');
  for (const index of [3, 4]) { cloud.readbacks[index].choice.lastMutationId = 'rewritten'; }
  assert.throws(() => validateServerProof(cloud, runId, 'cloud'));
  const local = serverProof('local');
  for (const index of [3, 4]) { local.readbacks[index].choice.lastMutationId = local.readbacks[1].choice.lastMutationId; }
  assert.throws(() => validateServerProof(local, runId, 'local'));
});
void test('reused idle guard fails closed and never authorizes stopping other instrumentation', () => {
  const idle = 'ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)\n  All known processes:\n';
  assertNoInstrumentation(idle);
  for (const value of ['', idle.replace('All known processes:', 'Unknown'), idle + 'ActiveInstrumentation{foreign/Runner}'])
    assert.throws(() => assertNoInstrumentation(value));
});
