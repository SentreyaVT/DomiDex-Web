// Pure parser/fixture safety tests only. These are NOT the Android/Web SDK proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT, SERIAL, AVD, OWNER, ENTRY, TEST_CLASS, ANDROID_PHASES, WEB_PHASES, CLEANUP, IDENTITY, NULLABLE,
  validRunId, parentFixture, assertChoice, validateInstrumentation, validateWebResults, validateServerProof, assertNoInstrumentation } from './contract.mjs';
const runId = 'a'.repeat(32);
const status = (method, code) => `INSTRUMENTATION_STATUS: class=${TEST_CLASS}\nINSTRUMENTATION_STATUS: test=${method}\nINSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
const instrumentation = method => status(method, 1) + status(method, 0) + '\nOK (1 test)\nINSTRUMENTATION_CODE: -1\n';
const report = phase => ({ success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ status: 'passed', assertionResults: [{ title: WEB_PHASES[phase], status: 'passed', failureMessages: [] }] }] });
const choice = revision => ({ schemaVersion: 1, ownerUid: OWNER, entrySyncId: ENTRY, revision, lastMutationId: `mutation-${revision}`,
  updatedAt: { seconds: 1700001000 + revision, nanoseconds: 1000 }, updatedAtClient: 1700000001000 + revision,
  cleared: revision === 3, ...(revision === 3 ? Object.fromEntries(NULLABLE.map(field => [field, null])) : {
    ...IDENTITY, metric: revision === 1 ? 'normal_avg_sell' : 'normal_low', amountMinor: revision === 1 ? 532 : 450,
    currency: 'EUR', sourceAt: 1000, selectedAt: revision === 1 ? 2000 : 1700000001000 + revision,
  }) });
const serverProof = () => ({ project: PROJECT, runId, verified: true, accountUnchanged: true,
  parent: parentFixture({ seconds: 1700000000, nanoseconds: 0 }),
  phases: [{ passed: 1, method: ANDROID_PHASES[0], successEvidence: true }, { passed: 1, phase: 'save', name: WEB_PHASES.save },
    { passed: 1, method: ANDROID_PHASES[1], successEvidence: true }, { passed: 1, phase: 'clear', name: WEB_PHASES.clear },
    { passed: 1, method: ANDROID_PHASES[2], successEvidence: true }],
  readbacks: ['android-create-ack', 'web-save', 'android-pull-save', 'web-clear', 'android-pull-clear']
    .map((label, index) => ({ label, choice: choice([1, 2, 2, 3, 3][index]) })),
});

void test('driver identities and fresh path-safe run ID are fixed', () => {
  assert.equal(SERIAL, 'emulator-5554'); assert.equal(AVD, 'DomiDex_R27_Baseline_API36');
  assert.equal(PROJECT, 'demo-domidex-privacy'); assert.equal(Object.isFrozen(ANDROID_PHASES), true);
  assert.equal(validRunId(runId), runId);
  for (const value of ['', '../bad', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), '0'.repeat(31) + '/']) assert.throws(() => validRunId(value));
});
void test('instrumentation requires exact START and PASS once, exact identity and final result', () => {
  const method = ANDROID_PHASES[0]; const valid = instrumentation(method);
  assert.deepEqual(validateInstrumentation(valid, method), { passed: 1, method, successEvidence: true });
  assert.equal(validateInstrumentation(valid.replaceAll('\n', '\r\n'), method).passed, 1);
  for (const broken of ['', valid.replace(status(method, 1), ''), status(method, 1) + valid, status(method, 0) + valid,
    valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -3'), valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -4'),
    valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -2'), valid.replaceAll(method, ANDROID_PHASES[1]),
    valid.replaceAll(TEST_CLASS, 'foreign.Test'), valid.replace('OK (1 test)', 'OK (2 tests)'),
    valid.replace('INSTRUMENTATION_CODE: -1', ''), valid + 'INSTRUMENTATION_CODE: -1\n',
    valid + 'INSTRUMENTATION_CODE: 0\n', valid + 'INSTRUMENTATION_STATUS: test=unfinished\n',
    valid.replace('numtests=1', 'numtests=2'), valid.replace('numtests=1', 'numtests=1\nINSTRUMENTATION_STATUS: numtests=1'),
    valid + 'INSTRUMENTATION_FAILED: Process crashed\n']) assert.throws(() => validateInstrumentation(broken, method));
  assert.equal(validateInstrumentation(instrumentation(CLEANUP), CLEANUP).successEvidence, false);
  assert.throws(() => validateInstrumentation(instrumentation(CLEANUP), method));
});
void test('Web validation rejects skipped, partial, duplicate, wrong or failed actual-operation tests', () => {
  assert.equal(validateWebResults(report('save'), 'save').passed, 1);
  for (const mutate of [value => { value.success = false; }, value => { value.numPassedTests = 0; },
    value => { value.numPendingTests = 1; }, value => { value.numTodoTests = 1; }, value => { value.numTotalTests = 2; },
    value => { value.testResults[0].assertionResults[0].title = WEB_PHASES.clear; },
    value => { value.testResults[0].assertionResults[0].status = 'pending'; },
    value => { value.testResults[0].assertionResults.push(value.testResults[0].assertionResults[0]); },
    value => { value.testResults[0].status = 'failed'; }]) {
    const value = report('save'); mutate(value); assert.throws(() => validateWebResults(value, 'save'));
  }
});
void test('server field checker rejects missing/extra identity, fake clear and altered revision', () => {
  for (const revision of [1, 2, 3]) assert.equal(assertChoice(choice(revision), revision).revision, revision);
  for (const mutate of [value => { delete value.language; }, value => { value.extra = true; },
    value => { value.ownerUid = 'foreign'; }, value => { value.productId = 43; }, value => { value.sourceCardId = 'different'; },
    value => { value.amountMinor = 450; }, value => { value.sourceAt = 1001; }, value => { value.selectedAt = 2001; },
    value => { value.revision = 2; }, value => { value.updatedAt = null; }, value => { value.updatedAt.nanoseconds = 1e9; }]) {
    const value = choice(1); mutate(value); assert.throws(() => assertChoice(value, 1));
  }
  const clear = choice(3); clear.metric = 'normal_low'; assert.throws(() => assertChoice(clear, 3));
});
void test('complete server proof needs ordered real phases and all field-exact readbacks', () => {
  assert.equal(validateServerProof(serverProof(), runId).androidPhases, 3);
  for (const mutate of [value => { value.runId = 'b'.repeat(32); }, value => { value.accountUnchanged = false; },
    value => { value.phases[4].method = CLEANUP; }, value => { value.phases.reverse(); },
    value => { value.readbacks.pop(); }, value => { value.readbacks[2].choice.updatedAtClient++; value.readbacks[2].choice.selectedAt++; },
    value => { value.parent.quantity = 2; }, value => { value.error = 'failed'; },
    value => { value.readbacks[3].choice.lastMutationId = value.readbacks[1].choice.lastMutationId; }]) {
    const value = serverProof(); mutate(value); assert.throws(() => validateServerProof(value, runId));
  }
});
void test('idle probe accepts only recognized API36 processes output without instrumentation', () => {
  const idle = 'ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)\n  All known processes:\n';
  assertNoInstrumentation(idle);
  for (const text of ['', 'ACTIVITY MANAGER INSTRUMENTATION (dumpsys activity instrumentation)',
    idle.replace('All known processes:', 'Unknown'), idle + 'ActiveInstrumentation{foreign/Runner}',
    idle + 'mInstrumentation=Bundle[mParcelledData.dataSize=100]']) assert.throws(() => assertNoInstrumentation(text));
});
