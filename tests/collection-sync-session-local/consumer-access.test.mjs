import assert from 'node:assert/strict';
import test from 'node:test';
import { TEST_CLASS, SCENARIOS } from './contract.mjs';
import { CONSUMER, ACCOUNTS, KNOWLEDGE, LOCK, ACCESS, ACCESS_DATA, readyText, fixture, expectedSnapshot,
  newReceipt, beginConsumer, finishConsumer, validateConsumerReceipt, validateConsumerProof,
  validateConsumerInstrumentation, startIsActive, assertReadyRead } from './consumer-access.mjs';

const RUN = 'a'.repeat(32);
const STAMP = { seconds: 1791115200, nanoseconds: 1 };
const WRITE = { seconds: 1791115201, nanoseconds: 2 };
const DELETE = { seconds: 1791115202, nanoseconds: 3 };
const result = code => ({ code, stopped: null, error: null, signal: null });
function block(code, method = CONSUMER.method) {
  return `INSTRUMENTATION_STATUS: class=${TEST_CLASS}\nINSTRUMENTATION_STATUS: test=${method}\n` +
    `INSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
}
const START = block(1), PASS = START + block(0) + 'OK (1 test)\nINSTRUMENTATION_CODE: -1\n';
function harness() {
  const seed = fixture(RUN, STAMP), receipt = newReceipt(RUN);
  const lifecycle = { running: true, cancelled: false, output: START };
  const state = { locked: false, creates: 0, deletes: 0, snapshots: 0, documentReads: 0 };
  const io = {
    now: () => 0, sleep: async () => {}, save: () => {},
    probeReady: async () => ({ output: '', result: result(0) }),
    readReady: async () => ({ output: Buffer.from(readyText(RUN)).toString('base64'), result: result(0) }),
    snapshot: async () => { state.snapshots++; return expectedSnapshot(seed, RUN, state.locked); },
    documents: async () => {
      state.documentReads++;
      return state.locked ? [
        { path: LOCK, exists: true, data: { jobId: `sdk-knowledge-session-access-${RUN}` }, writeTime: WRITE },
        { path: ACCESS, exists: true, data: { ...ACCESS_DATA }, writeTime: WRITE },
      ] : [{ path: LOCK, exists: false }, { path: ACCESS, exists: false }];
    },
    createBoth: async (lock, access) => {
      assert.equal(state.locked, false); assert.deepEqual(access, ACCESS_DATA);
      assert.deepEqual(lock, { jobId: `sdk-knowledge-session-access-${RUN}` });
      state.creates++; state.locked = true; return [WRITE, WRITE];
    },
    deleteBoth: async times => {
      assert.deepEqual(times, [WRITE, WRITE]); assert.equal(state.locked, true);
      state.deletes++; state.locked = false; return [DELETE, DELETE];
    },
  };
  return { seed, receipt, lifecycle, state, io };
}
async function complete(h = harness()) {
  await beginConsumer(h.receipt, h.seed, h.lifecycle, h.io);
  h.lifecycle.running = false;
  await finishConsumer(h.receipt, h.seed, h.io); return h;
}

await test('fixed singleton never alters original eighteen registry or thirty-second rules', () => {
  assert.equal(SCENARIOS.length, 18); assert.equal(SCENARIOS.some(row => row.method === CONSUMER.method), false);
  assert.equal(ACCOUNTS.length, 2); assert.ok(ACCOUNTS.every(row => row.customClaims.appAccess && !row.disabled));
});
await test('one ready atomic pair and exact CAS cleanup give full independent receipt', async () => {
  const h = await complete(); assert.equal(h.state.creates, 1); assert.equal(h.state.deletes, 1);
  assert.equal(validateConsumerReceipt(h.receipt, RUN, h.seed).verified, true);
  assert.equal(h.receipt.afterCreate.entries.length, 3); assert.equal(h.receipt.afterDelete.entries.length, 1);
  assert.equal(h.receipt.afterCreate.entries.find(row => row.path === KNOWLEDGE).data.confidence, 91);
});
await test('canonical encoded marker rejects actualCRLF stale identity and extra byte', () => {
  for (const text of [readyText(RUN).replace('\n', '\r\n'), readyText('b'.repeat(32)), readyText(RUN) + 'x'])
    assert.throws(() => assertReadyRead({ output: Buffer.from(text).toString('base64'), result: result(0) }, RUN));
});
await test('probe transport uncertainty fails immediately before any write', async () => {
  for (const value of [{ output: 'run-as: failure', result: result(1) },
    { output: '', result: { ...result(1), stopped: 'timeout' } }, { output: '', result: result(2) }]) {
    const h = harness(); h.io.probeReady = async () => value;
    await assert.rejects(beginConsumer(h.receipt, h.seed, h.lifecycle, h.io)); assert.equal(h.state.creates, 0);
  }
});
await test('sole exact complete START needed and partial terminal cannot authorize write', () => {
  assert.equal(startIsActive(START, true), true);
  assert.equal(startIsActive(START + 'INSTRUMENTATION_STATUS:', true), false);
  assert.equal(startIsActive(START + 'INSTRUMENTATION_STATUS: class=' + TEST_CLASS + '\n', true), false);
  for (const bad of [START + START, block(1, 'foreign'), PASS]) assert.throws(() => startIsActive(bad, true));
  assert.throws(() => startIsActive(START, false));
});
await test('stop while final absence-read is pending prevents newly initiated atomic create', async () => {
  const h = harness(), original = h.io.documents;
  h.io.documents = async () => { const value = await original(); h.lifecycle.cancelled = true; return value; };
  await assert.rejects(beginConsumer(h.receipt, h.seed, h.lifecycle, h.io)); assert.equal(h.state.creates, 0);
});
await test('foreign account claims fulltree or preexisting access doc prevent create', async () => {
  for (const kind of ['claims', 'extra', 'access']) {
    const h = harness(), snapshot = h.io.snapshot, documents = h.io.documents;
    if (kind === 'access') h.io.documents = async () => { const rows = await documents(); rows[1].exists = true; return rows; };
    else h.io.snapshot = async () => { const value = await snapshot();
      if (kind === 'claims') value.accounts[0].customClaims.admin = true;
      else value.entries.push({ path: 'foreign/document', data: {} }); return value; };
    await assert.rejects(beginConsumer(h.receipt, h.seed, h.lifecycle, h.io)); assert.equal(h.state.creates, 0);
  }
});
await test('UNKNOWN create remains charged and never compensated even with visible atomic effect', async () => {
  const h = harness(), create = h.io.createBoth;
  h.io.createBoth = async (...args) => { await create(...args); throw Error('lost create response'); };
  await assert.rejects(beginConsumer(h.receipt, h.seed, h.lifecycle, h.io));
  await finishConsumer(h.receipt, h.seed, h.io);
  assert.equal(h.receipt.createOutcome, 'unknown'); assert.equal(h.state.deletes, 0); assert.equal(h.state.locked, true);
  assert.throws(() => validateConsumerReceipt(h.receipt, RUN, h.seed));
});
await test('known acknowledged create survives later readback error and can safely cleanup', async () => {
  const h = harness(), snapshot = h.io.snapshot;
  h.io.snapshot = async () => { if (h.state.snapshots === 1) { h.state.snapshots++; throw Error('read failed'); } return snapshot(); };
  await assert.rejects(beginConsumer(h.receipt, h.seed, h.lifecycle, h.io));
  await finishConsumer(h.receipt, h.seed, h.io);
  assert.equal(h.state.deletes, 1); assert.throws(() => validateConsumerReceipt(h.receipt, RUN, h.seed));
});
await test('same payload foreign updateTime cannot authorize either deletion', async () => {
  const h = harness(); await beginConsumer(h.receipt, h.seed, h.lifecycle, h.io);
  const original = h.io.documents;
  h.io.documents = async () => { const rows = await original(); rows[1].writeTime = DELETE; return rows; };
  await finishConsumer(h.receipt, h.seed, h.io); assert.equal(h.state.deletes, 0);
  assert.throws(() => validateConsumerReceipt(h.receipt, RUN, h.seed));
});
await test('failed locked fulltree readback cannot authorize cleanup writes', async () => {
  const h = harness(); await beginConsumer(h.receipt, h.seed, h.lifecycle, h.io);
  h.io.snapshot = async () => { throw Error('unverified full tree'); };
  await finishConsumer(h.receipt, h.seed, h.io); assert.equal(h.state.deletes, 0);
});
await test('UNKNOWN cleanup never becomes acknowledged after apparently restored fulltree', async () => {
  const h = harness(); await beginConsumer(h.receipt, h.seed, h.lifecycle, h.io);
  const original = h.io.deleteBoth;
  h.io.deleteBoth = async (...args) => { await original(...args); throw Error('lost cleanup response'); };
  await finishConsumer(h.receipt, h.seed, h.io);
  assert.equal(h.state.deletes, 1); assert.equal(h.receipt.deleteOutcome, 'unknown'); assert.equal(h.state.locked, false);
  assert.throws(() => validateConsumerReceipt(h.receipt, RUN, h.seed));
});
await test('non-atomic acknowledged write times and changed restored seed are rejected', async () => {
  const h = await complete();
  const changed = structuredClone(h.receipt); changed.createTimes[1] = DELETE;
  assert.throws(() => validateConsumerReceipt(changed, RUN, h.seed));
  const stale = structuredClone(h.receipt); stale.deleteTimes = stale.createTimes;
  assert.throws(() => validateConsumerReceipt(stale, RUN, h.seed));
  h.receipt.afterDelete.entries[0].data.confidence = 90;
  assert.throws(() => validateConsumerReceipt(h.receipt, RUN, h.seed));
});
await test('strict singleton requires START PASS exact identity no skip crash or duplicate terminal', () => {
  assert.deepEqual(validateConsumerInstrumentation(PASS), { passed: 1, method: CONSUMER.method, successEvidence: true });
  for (const wrong of [PASS.replace('STATUS_CODE: 0', 'STATUS_CODE: -3'), PASS.replace('numtests=1', 'numtests=2'),
    PASS + 'INSTRUMENTATION_CODE: -1\n', PASS.replace('OK (1 test)', 'OK (1 tests)'),
    PASS.replace(CONSUMER.method, 'foreign'), PASS + 'Process crashed\n']) assert.throws(() => validateConsumerInstrumentation(wrong));
});
await test('terminal proof binds Android success account preservation resources and receipt', async () => {
  const h = await complete();
  const proof = { project: 'demo-domidex-privacy', runId: RUN, verified: true, seed: h.seed,
    preflight: expectedSnapshot(h.seed, RUN), readback: expectedSnapshot(h.seed, RUN),
    android: validateConsumerInstrumentation(PASS), barrier: h.receipt, accountUnchanged: true, errors: [], adminClosed: true };
  assert.equal(validateConsumerProof(proof, RUN).verified, true);
  for (const key of ['verified', 'accountUnchanged', 'adminClosed']) {
    const bad = structuredClone(proof); bad[key] = false; assert.throws(() => validateConsumerProof(bad, RUN));
  }
  proof.android.passed = 0; assert.throws(() => validateConsumerProof(proof, RUN));
});
