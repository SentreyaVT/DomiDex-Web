import assert from 'node:assert/strict';

export const PROJECT = 'demo-domidex-privacy';
export const SERIAL = 'emulator-5554';
export const AVD = 'DomiDex_R27_Baseline_API36';
export const OWNER = 'price-roundtrip-owner';
export const EMAIL = 'price-roundtrip@example.invalid';
export const GOOGLE_UID = 'price-roundtrip-google';
export const ENTRY = 'entry';
export const TEST_CLASS = 'com.dominik.cardvault.data.sync.AndroidWebPriceRoundTripInstrumentedTest';
export const ANDROID_PHASES = Object.freeze([
  'androidCreatesAndAcknowledgesPriceChoice', 'androidPullsWebPriceChoice', 'androidPullsWebClear',
]);
export const CLEANUP = 'cleanupOwnedFixture';
export const WEB_PHASES = Object.freeze({
  save: 'actual Web subscription observes Android ACK and actual save commits revision two',
  clear: 'actual Web clear commits complete revision three tombstone',
});
export const NULLABLE = Object.freeze(['sourceSetId', 'sourceCardId', 'collectorNumber', 'language', 'finish',
  'variant', 'productId', 'metric', 'amountMinor', 'currency', 'sourceAt', 'selectedAt']);
export const IDENTITY = Object.freeze({ sourceSetId: 'me03', sourceCardId: 'me03-090', collectorNumber: '090/088',
  language: 'GERMAN', finish: 'Holo', variant: 'Holo', productId: 42 });
export const PARENT_PATH = `users/${OWNER}/collectionEntries/${ENTRY}`;
export const CHOICE_PATH = `users/${OWNER}/collectionPriceSelections/${ENTRY}`;

export function validRunId(value) {
  assert.match(value ?? '', /^[a-f0-9]{32}$/, 'Exact fresh run ID required');
  return value;
}

export function parentFixture(timestamp) {
  return { syncId: ENTRY, ownerUid: OWNER, revision: 1, lastMutationId: 'seed-parent', updatedAt: timestamp,
    updatedAtClient: 1700000000000, deleted: false, deletedAtClient: null, name: 'Bauz', setId: 'me03',
    setName: 'Optimale Ordnung', collectorNumber: '090/088', language: 'GERMAN', finish: 'Holo', variant: 'Holo',
    rarity: 'UNKNOWN', quantity: 1, condition: 'Near Mint', notes: '', acquisitionPriceMinor: null,
    acquisitionCurrency: null, acquisitionDateEpochDay: null, externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD',
    externalProductId: 42, imageUrl: null, effectOverride: null, sourceSetId: 'me03', sourceCardId: 'me03-090',
    binderId: 'inbox', binderSetKey: 'inbox', binderName: 'Ohne Setzuordnung', binderHeroAsset: null };
}

/** Normalizes SDK timestamps only; no field omission or tolerance of extra data. */
export function normalize(value) {
  if (value && typeof value === 'object' && typeof value.toMillis === 'function' &&
      Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)) {
    return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}

export function assertChoice(data, revision) {
  assert.ok(data && [1, 2, 3].includes(revision));
  assert.deepEqual(Object.keys(data).sort(), ['schemaVersion', 'ownerUid', 'entrySyncId', 'revision', 'lastMutationId',
    'updatedAt', 'updatedAtClient', 'cleared', ...NULLABLE].sort(), 'Exact sidecar field set required');
  assert.equal(data.schemaVersion, 1); assert.equal(data.ownerUid, OWNER); assert.equal(data.entrySyncId, ENTRY);
  assert.equal(data.revision, revision); assert.equal(data.cleared, revision === 3);
  assert.match(data.lastMutationId, /^[A-Za-z0-9._-]{1,128}$/);
  assert.ok(Number.isSafeInteger(data.updatedAtClient) && data.updatedAtClient > 0);
  const stamp = normalize(data.updatedAt);
  assert.deepEqual(Object.keys(stamp).sort(), ['nanoseconds', 'seconds']);
  assert.ok(Number.isSafeInteger(stamp.seconds) && stamp.seconds > 1700000000);
  assert.ok(Number.isSafeInteger(stamp.nanoseconds) && stamp.nanoseconds >= 0 && stamp.nanoseconds < 1e9);
  if (revision === 3) for (const field of NULLABLE) assert.equal(data[field], null, `Clear must explicitly null ${field}`);
  else {
    for (const [key, value] of Object.entries(IDENTITY)) assert.equal(data[key], value, `Exact identity: ${key}`);
    assert.equal(data.metric, revision === 1 ? 'normal_avg_sell' : 'normal_low');
    assert.equal(data.amountMinor, revision === 1 ? 532 : 450);
    assert.equal(data.currency, 'EUR'); assert.equal(data.sourceAt, 1000);
    if (revision === 1) assert.equal(data.selectedAt, 2000);
    else {
      assert.ok(Number.isSafeInteger(data.selectedAt) && data.selectedAt > 2000);
      assert.equal(data.selectedAt, data.updatedAtClient, 'Actual Web save uses one Date.now value');
    }
  }
  return normalize(data);
}

export function validateInstrumentation(text, method) {
  assert.ok([...ANDROID_PHASES, CLEANUP].includes(method), 'Unknown Android phase');
  assert.equal((text.match(/^OK \(1 test\)\r?$/gm) ?? []).length, 1, 'Exactly one Android test must pass');
  assert.ok(!/^INSTRUMENTATION_STATUS_CODE: -[1234]\r?$/m.test(text) &&
    !/INSTRUMENTATION_FAILED|FAILURES!!!|Process crashed/.test(text), 'No failure, skip, ignored or crashed test');
  let fields = {}; const statuses = []; const endings = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('INSTRUMENTATION_STATUS: ')) {
      const payload = line.slice('INSTRUMENTATION_STATUS: '.length); const equals = payload.indexOf('=');
      assert.ok(equals > 0, 'Malformed instrumentation field');
      const key = payload.slice(0, equals); assert.ok(!Object.hasOwn(fields, key), 'Duplicate instrumentation field');
      fields[key] = payload.slice(equals + 1);
    } else if (line.startsWith('INSTRUMENTATION_STATUS_CODE:')) {
      const match = /^INSTRUMENTATION_STATUS_CODE: (0|1)$/.exec(line); assert.ok(match, 'Unexpected instrumentation status');
      assert.equal(fields.class, TEST_CLASS); assert.equal(fields.test, method);
      if (Object.hasOwn(fields, 'numtests')) assert.equal(fields.numtests, '1');
      statuses.push(Number(match[1])); fields = {};
    } else if (line.startsWith('INSTRUMENTATION_CODE:')) endings.push(line);
  }
  assert.deepEqual(fields, {}, 'Unfinished instrumentation status');
  assert.deepEqual(statuses, [1, 0], 'Exact START then PASS required once');
  assert.deepEqual(endings, ['INSTRUMENTATION_CODE: -1']);
  return { passed: 1, method, successEvidence: method !== CLEANUP };
}

export function validateWebResults(report, phase) {
  assert.ok(Object.hasOwn(WEB_PHASES, phase), 'Unknown Web phase');
  assert.equal(report.success, true); assert.equal(report.numTotalTests, 1); assert.equal(report.numPassedTests, 1);
  assert.equal(report.numFailedTests, 0); assert.equal(report.numPendingTests, 0); assert.equal(report.numTodoTests ?? 0, 0);
  assert.equal(report.testResults?.length, 1);
  const suite = report.testResults[0]; assert.equal(suite.status, 'passed');
  assert.equal(suite.assertionResults?.length, 1);
  const result = suite.assertionResults[0]; assert.equal(result.status, 'passed');
  assert.equal(result.title, WEB_PHASES[phase]); assert.deepEqual(result.failureMessages ?? [], []);
  return { passed: 1, phase, name: result.title };
}

/** Fail closed on unknown output; never force-stop an unowned instrumentation. */
export function assertNoInstrumentation(output) {
  const lines = output.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  assert.equal(lines[0], 'ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)');
  assert.ok(lines.includes('All known processes:') && !/instrumentation/i.test(output),
    'An instrumentation is active or its state is not recognized; do not stop it');
}

export function validateServerProof(proof, runId) {
  validRunId(runId); assert.equal(proof.project, PROJECT); assert.equal(proof.runId, runId);
  assert.equal(proof.verified, true); assert.equal(proof.accountUnchanged, true); assert.equal(proof.error, undefined);
  assert.deepEqual(proof.parent, parentFixture({ seconds: 1700000000, nanoseconds: 0 }));
  assert.deepEqual(proof.phases, [
    { passed: 1, method: ANDROID_PHASES[0], successEvidence: true }, { passed: 1, phase: 'save', name: WEB_PHASES.save },
    { passed: 1, method: ANDROID_PHASES[1], successEvidence: true }, { passed: 1, phase: 'clear', name: WEB_PHASES.clear },
    { passed: 1, method: ANDROID_PHASES[2], successEvidence: true },
  ], 'Exact sequenced product phases; cleanup is not success evidence');
  assert.deepEqual(proof.readbacks?.map(item => item.label),
    ['android-create-ack', 'web-save', 'android-pull-save', 'web-clear', 'android-pull-clear']);
  proof.readbacks.forEach((item, index) => assertChoice(item.choice, [1, 2, 2, 3, 3][index]));
  assert.deepEqual(proof.readbacks[1].choice, proof.readbacks[2].choice);
  assert.deepEqual(proof.readbacks[3].choice, proof.readbacks[4].choice);
  assert.notEqual(proof.readbacks[0].choice.lastMutationId, proof.readbacks[1].choice.lastMutationId);
  assert.notEqual(proof.readbacks[1].choice.lastMutationId, proof.readbacks[3].choice.lastMutationId);
  return { verified: true, androidPhases: 3, webPhases: 2, independentServerReadbacks: 5 };
}
