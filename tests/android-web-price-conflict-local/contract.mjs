import assert from 'node:assert/strict';
import { parseRulesOptions } from '../rules-local/run.mjs';
import { PROJECT, SERIAL, AVD, CLEANUP, IDENTITY, NULLABLE, normalize, validRunId,
  parentFixture as roundTripParent, assertNoInstrumentation } from '../android-web-price-local/contract.mjs';
export { PROJECT, SERIAL, AVD, CLEANUP, IDENTITY, NULLABLE, normalize, validRunId, assertNoInstrumentation };

export const OWNER = 'price-conflict-owner';
export const EMAIL = 'price-conflict@example.invalid';
export const GOOGLE_UID = 'price-conflict-google';
export const ENTRY = 'entry';
export const TEST_CLASS = 'com.dominik.cardvault.data.sync.AndroidWebPriceConflictInstrumentedTest';
export const ANDROID_PHASES = Object.freeze([
  'androidCreatesAndAcknowledgesPriceChoice', 'androidHoldsStaleBaseConflict', 'androidResolvesExplicitConflict',
]);
export const WEB_PHASES = Object.freeze({
  save: 'actual Web subscription sees Android ACK and save produces the conflicting revision two',
  verify: 'actual Web subscription sees the explicitly resolved Android price choice without another write',
});
export const PARENT_PATH = `users/${OWNER}/collectionEntries/${ENTRY}`;
export const CHOICE_PATH = `users/${OWNER}/collectionPriceSelections/${ENTRY}`;
export const ACCOUNT = Object.freeze({ uid: OWNER, email: EMAIL, emailVerified: true, disabled: false,
  customClaims: { appAccess: true }, providerData: [{ providerId: 'google.com', uid: GOOGLE_UID, email: EMAIL }] });

export function validResolution(value) {
  assert.ok(value === 'cloud' || value === 'local', 'Explicit --resolution cloud|local required');
  return value;
}
export function parseConflictOptions(args) {
  let resolution; const common = [];
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === '--resolution') {
      assert.equal(resolution, undefined, 'Duplicate resolution'); resolution = validResolution(args[index + 1]);
    } else common.push(args[index], args[index + 1]);
  }
  return { ...parseRulesOptions(common), '--resolution': validResolution(resolution) };
}
export function parentFixture(timestamp) { return { ...roundTripParent(timestamp), ownerUid: OWNER }; }

/** All three revisions remain live choices. Revision 3 is NOT the older clear fixture. */
export function assertChoice(data, revision) {
  assert.ok(data && [1, 2, 3].includes(revision));
  assert.deepEqual(Object.keys(data).sort(), ['schemaVersion', 'ownerUid', 'entrySyncId', 'revision', 'lastMutationId',
    'updatedAt', 'updatedAtClient', 'cleared', ...NULLABLE].sort());
  assert.equal(data.schemaVersion, 1); assert.equal(data.ownerUid, OWNER); assert.equal(data.entrySyncId, ENTRY);
  assert.equal(data.revision, revision); assert.equal(data.cleared, false);
  assert.match(data.lastMutationId, /^[A-Za-z0-9._-]{1,128}$/);
  assert.ok(Number.isSafeInteger(data.updatedAtClient) && data.updatedAtClient > 0);
  const stamp = normalize(data.updatedAt);
  assert.deepEqual(Object.keys(stamp ?? {}).sort(), ['nanoseconds', 'seconds']);
  assert.ok(Number.isSafeInteger(stamp.seconds) && stamp.seconds > 1700000000);
  assert.ok(Number.isSafeInteger(stamp.nanoseconds) && stamp.nanoseconds >= 0 && stamp.nanoseconds < 1e9);
  for (const [key, value] of Object.entries(IDENTITY)) assert.equal(data[key], value, `Exact identity: ${key}`);
  assert.equal(data.metric, ['normal_avg_sell', 'normal_low', 'normal_avg_1d'][revision - 1]);
  assert.equal(data.amountMinor, [532, 450, 500][revision - 1]);
  assert.equal(data.currency, 'EUR'); assert.equal(data.sourceAt, 1000);
  if (revision !== 2) assert.equal(data.selectedAt, revision === 1 ? 2000 : 3000);
  else {
    assert.ok(Number.isSafeInteger(data.selectedAt) && data.selectedAt > 3000);
    assert.equal(data.selectedAt, data.updatedAtClient, 'Actual Web save uses one Date.now value');
  }
  return normalize(data);
}

// Class/method-bound parser is intentionally independent of the old clear-roundtrip validator.
export function validateInstrumentation(text, method) {
  assert.ok([...ANDROID_PHASES, CLEANUP].includes(method));
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
      if (Object.hasOwn(fields, 'numtests')) assert.equal(fields.numtests, '1');
      statuses.push(Number(match[1])); fields = {};
    } else if (line.startsWith('INSTRUMENTATION_CODE:')) endings.push(line);
  }
  assert.deepEqual(fields, {}); assert.deepEqual(statuses, [1, 0]); assert.deepEqual(endings, ['INSTRUMENTATION_CODE: -1']);
  return { passed: 1, method, successEvidence: method !== CLEANUP };
}
export function validateWebResults(report, phase) {
  assert.ok(Object.hasOwn(WEB_PHASES, phase));
  assert.equal(report.success, true); assert.equal(report.numTotalTests, 1); assert.equal(report.numPassedTests, 1);
  assert.equal(report.numFailedTests, 0); assert.equal(report.numPendingTests, 0); assert.equal(report.numTodoTests ?? 0, 0);
  assert.equal(report.testResults?.length, 1); const suite = report.testResults[0]; assert.equal(suite.status, 'passed');
  assert.equal(suite.assertionResults?.length, 1); const result = suite.assertionResults[0];
  assert.equal(result.status, 'passed'); assert.equal(result.title, WEB_PHASES[phase]); assert.deepEqual(result.failureMessages ?? [], []);
  return { passed: 1, phase, name: result.title };
}
export function validateServerProof(proof, runId, resolution) {
  validRunId(runId); validResolution(resolution);
  assert.equal(proof.project, PROJECT); assert.equal(proof.runId, runId); assert.equal(proof.resolution, resolution);
  assert.equal(proof.verified, true); assert.equal(proof.accountUnchanged, true); assert.equal(proof.error, undefined);
  assert.deepEqual(proof.phases, [
    { passed: 1, method: ANDROID_PHASES[0], successEvidence: true }, { passed: 1, phase: 'save', name: WEB_PHASES.save },
    { passed: 1, method: ANDROID_PHASES[1], successEvidence: true }, { passed: 1, method: ANDROID_PHASES[2], successEvidence: true },
    { passed: 1, phase: 'verify', name: WEB_PHASES.verify },
  ]);
  assert.deepEqual(proof.readbacks?.map(value => value.label),
    ['android-create-ack', 'web-save', 'android-held-conflict', 'android-explicit-resolution', 'web-verify']);
  const finalRevision = resolution === 'cloud' ? 2 : 3;
  proof.readbacks.forEach((item, index) => {
    assertChoice(item.choice, [1, 2, 2, finalRevision, finalRevision][index]);
    assert.deepEqual(item.parent, parentFixture({ seconds: 1700000000, nanoseconds: 0 }));
    assert.deepEqual(item.account, ACCOUNT); assert.equal(item.accessOverrideAbsent, true);
    assert.deepEqual(item.sidecarIds, [ENTRY]);
  });
  const choices = proof.readbacks.map(value => value.choice);
  assert.deepEqual(choices[1], choices[2], 'Two conflict-holding Android passes must not rewrite Web');
  assert.deepEqual(choices[3], choices[4], 'Final Web subscription must not write');
  assert.notEqual(choices[0].lastMutationId, choices[1].lastMutationId);
  if (resolution === 'cloud') assert.deepEqual(choices[1], choices[3], 'Cloud decision must not write');
  else assert.notEqual(choices[1].lastMutationId, choices[3].lastMutationId);
  return { verified: true, resolution, androidPhases: 3, webPhases: 2, independentServerReadbacks: 5 };
}
