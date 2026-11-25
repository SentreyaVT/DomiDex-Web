import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, encodeBoundedJson } from './contract.mjs';
import { ADMISSION_POLICY, reserveAdmission, validateAdmissionState } from './admission-budget.mjs';
import { STORE_POLICY, publishSnapshot, readCurrentSnapshot } from './snapshot-store.mjs';
import { publishAdmittedSnapshot } from './publisher.mjs';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const record = (id, price) => ({ productId: String(id), categoryId: '51',
  expansionId: '99', metacardId: null, name: 'Synthetic Ä € product',
  normal: { average: price, low: '0', trend: null, average1: '104', average7: '105', average30: '106' },
  reverse: { average: '201', low: null, trend: '203' } });
const snapshot = (price = '101', count = 1, time = '2026-10-04T01:00:00Z', catalog = time) => buildSnapshot({
  sourceTimestamp: time, catalogSourceTimestamp: catalog,
  records: Array.from({ length: count }, (_, index) => record(index + 1, price)),
});
const wireBytes = (value) => encodeBoundedJson(value.manifest).length +
  value.pages.reduce((sum, page) => sum + encodeBoundedJson(page).length, 0);
const publish = (store, value, attemptToken = A) => publishAdmittedSnapshot(store, value, { attemptToken });
const writes = (store) => store.calls.filter(({ operation }) => operation !== 'read');
const uploads = (store) => store.calls.filter(({ operation }) => operation === 'create');
const admissionWrites = (store) => writes(store).filter(({ path }) => path === ADMISSION_POLICY.path);
const pointerWrites = (store) => writes(store).filter(({ path }) => path === STORE_POLICY.pointerPath);
const state = (store) => validateAdmissionState(JSON.parse(store.objects.get(ADMISSION_POLICY.path).bytes));
const entry = (value, attemptToken = A) => ({ generation: value.manifest.generation, wireBytes: wireBytes(value), attemptToken });
const seededEntry = (digit, bytes = 1) => ({ generation: digit.repeat(64), wireBytes: bytes, attemptToken: digit.repeat(32) });
const putReservations = (store, entries) => store.put(ADMISSION_POLICY.path,
  encodeBoundedJson(validateAdmissionState({ schema: 1, reservations: entries.sort((a, b) => a.generation < b.generation ? -1 : 1) })));

// No file, network or provider I/O; versions are unique and CAS is atomic.
function memoryStorage() {
  const objects = new Map();
  const calls = [];
  let version = 0;
  const put = (path, bytes) => objects.set(path, { bytes: Buffer.from(bytes), version: `v${++version}` });
  return { objects, calls, put,
    async read(path, { maxBytes }) {
      calls.push({ operation: 'read', path, maxBytes });
      const value = objects.get(path);
      if (!value) return null;
      if (value.bytes.length > maxBytes) throw Error('oversized synthetic object');
      return { bytes: Buffer.from(value.bytes), version: value.version };
    },
    async createIfAbsent(path, bytes) {
      calls.push({ operation: 'create', path, bytes: Buffer.from(bytes) });
      if (objects.has(path)) return false;
      put(path, bytes);
      return true;
    },
    async compareAndSwap(path, expectedVersion, bytes) {
      calls.push({ operation: 'cas', path, expectedVersion, bytes: Buffer.from(bytes) });
      if ((objects.get(path)?.version ?? null) !== expectedVersion) return false;
      put(path, bytes);
      return true;
    },
  };
}

test('publisher reserves exact final UTF8 manifest and page wire bytes before every upload', async () => {
  const store = memoryStorage(); const value = snapshot('101', 201);
  assert.deepEqual(await publish(store, value), { status: 'ACTIVATED', generation: value.manifest.generation });
  assert.deepEqual(state(store).reservations, [entry(value)]);
  assert.equal(wireBytes(value), uploads(store).reduce((sum, call) => sum + call.bytes.length, 0));
  const wrongDescriptorBudget = encodeBoundedJson(value.manifest).length + value.manifest.pages.reduce((sum, page) => sum + page.bytes, 0);
  assert.ok(wireBytes(value) > wrongDescriptorBudget, 'generation fields must also be charged');
  const firstUpload = store.calls.findIndex(({ operation }) => operation === 'create');
  const before = store.calls.slice(0, firstUpload);
  assert.equal(before.filter(({ operation, path }) => operation === 'cas' && path === ADMISSION_POLICY.path).length, 1);
  assert.equal(before.at(-1).operation, 'read');
  assert.equal(before.at(-1).path, ADMISSION_POLICY.path);
  assert.equal(admissionWrites(store)[0].expectedVersion, null);
  assert.equal(pointerWrites(store).length, 1);
  assert.deepEqual(await readCurrentSnapshot(store), value);
});

test('internal hook receives only frozen owned scalars and a rejection causes zero uploads', async () => {
  const store = memoryStorage(); const value = snapshot();
  const expected = entry(value);
  let calls = 0;
  await assert.rejects(publishSnapshot(store, value, { admitGeneration: (info) => {
    calls++;
    assert.deepEqual(info, { generation: expected.generation, wireBytes: expected.wireBytes });
    assert.equal(Object.isFrozen(info), true);
    assert.throws(() => { info.wireBytes = 1; }, TypeError);
    assert.throws(() => { info.generation = 'f'.repeat(64); }, TypeError);
    throw Error('synthetic admission refused');
  } }), /synthetic admission refused/);
  assert.equal(calls, 1);
  assert.deepEqual(writes(store), []);
  const invalid = memoryStorage();
  await assert.rejects(publishSnapshot(invalid, value, { admitGeneration: true }), /ADMISSION_HOOK/);
  assert.deepEqual(invalid.calls, []);
});

test('invalid token, accessor, extra fields and coercible objects reject before any storage IO', async () => {
  let access = 0;
  const getter = Object.defineProperty({}, 'attemptToken', { enumerable: true, get() { access++; return A; } });
  const objectToken = { toString() { access++; return A; } };
  for (const options of [undefined, null, [], A, {}, { attemptToken: objectToken }, getter,
    { attemptToken: A, extra: true }, { attemptToken: A, [Symbol('extra')]: 1 },
    Object.create({ attemptToken: A }), Object.defineProperty({}, 'attemptToken', { value: A }),
    ...['', 'a'.repeat(31), 'a'.repeat(33), A.toUpperCase(), `${A}\n`, 123, null].map((attemptToken) => ({ attemptToken }))]) {
    const store = memoryStorage();
    await assert.rejects(publishAdmittedSnapshot(store, snapshot(), options), /MARKET_PUBLISHER_ATTEMPT_TOKEN/);
    assert.deepEqual(store.calls, []);
  }
  assert.equal(access, 0);
});

test('caller mutation during first await cannot change the token or already prepared snapshot bytes', async () => {
  const store = memoryStorage(); const value = snapshot(); const original = structuredClone(value);
  const options = { attemptToken: A }; const read = store.read;
  store.read = async (...args) => {
    options.attemptToken = B;
    value.pages[0].records[0].name = 'Changed by caller';
    value.manifest.generation = 'f'.repeat(64);
    return read(...args);
  };
  await publishAdmittedSnapshot(store, value, options);
  assert.deepEqual(state(store).reservations, [entry(original)]);
  assert.deepEqual(await readCurrentSnapshot(store), original);
});

test('invalid snapshot never reserves admission or accesses storage', async () => {
  for (const value of [undefined, {}, { manifest: snapshot().manifest, pages: Array(1) },
    { manifest: snapshot().manifest, pages: [] }, { ...snapshot(), pages: snapshot('999').pages }]) {
    const store = memoryStorage();
    await assert.rejects(publish(store, value));
    assert.deepEqual(store.calls, []);
  }
});

test('already active verified generation makes no admission read or write even with a different valid token', async () => {
  const store = memoryStorage(); const value = snapshot();
  await publish(store, value);
  const before = Buffer.from(store.objects.get(ADMISSION_POLICY.path).bytes);
  store.calls.length = 0;
  assert.deepEqual(await publish(store, value, B), { status: 'ALREADY_ACTIVE', generation: value.manifest.generation });
  assert.deepEqual(writes(store), []);
  assert.equal(store.calls.some(({ path }) => path === ADMISSION_POLICY.path), false);
  assert.deepEqual(store.objects.get(ADMISSION_POLICY.path).bytes, before);
});

test('either independently stale source time rejects before admission and keeps last good active', async () => {
  const store = memoryStorage(); const good = snapshot();
  await publish(store, good);
  for (const [priceTime, catalogTime, code] of [
    ['2026-10-03T00:00:00Z', '2026-10-05T00:00:00Z', 'PRICE_TIME_REGRESSION'],
    ['2026-10-05T00:00:00Z', '2026-10-03T00:00:00Z', 'CATALOG_TIME_REGRESSION'],
  ]) {
    store.calls.length = 0;
    await assert.rejects(publish(store, snapshot('102', 1, priceTime, catalogTime), B), new RegExp(code));
    assert.deepEqual(writes(store), []);
    assert.equal(store.calls.some(({ path }) => path === ADMISSION_POLICY.path), false);
    assert.deepEqual(await readCurrentSnapshot(store), good);
  }
});

test('same source timestamps with corrected content permit a distinct charged generation', async () => {
  const store = memoryStorage(); const original = snapshot(); const correction = snapshot('102');
  await publish(store, original);
  assert.equal((await publish(store, correction, B)).status, 'ACTIVATED');
  assert.equal(state(store).reservations.length, 2);
  assert.deepEqual(await readCurrentSnapshot(store), correction);
});

test('UNKNOWN admission before or after commit permits no snapshot uploads or pointer CAS', async () => {
  for (const commit of [false, true]) {
    const store = memoryStorage(); const cas = store.compareAndSwap; const value = snapshot();
    store.compareAndSwap = async (path, expected, bytes) => {
      assert.equal(path, ADMISSION_POLICY.path);
      if (commit) await cas(path, expected, bytes);
      else store.calls.push({ operation: 'cas', path, expectedVersion: expected });
      throw Error('synthetic lost reservation response');
    };
    await assert.rejects(publish(store, value), /MARKET_ADMISSION_CAS_OUTCOME_UNKNOWN/);
    assert.deepEqual(uploads(store), []);
    assert.deepEqual(pointerWrites(store), []);
    assert.equal(admissionWrites(store).length, 1);
    assert.equal(store.objects.has(ADMISSION_POLICY.path), commit);
    if (commit) assert.deepEqual(state(store).reservations, [entry(value)]);
  }
});

test('acknowledged but unverifiable admission stays UNKNOWN with no generation upload', async () => {
  const store = memoryStorage(); const read = store.read;
  let admissionReads = 0;
  store.read = async (path, options) => {
    const result = await read(path, options);
    if (path === ADMISSION_POLICY.path && ++admissionReads === 2) throw Error('readback unavailable');
    return result;
  };
  const value = snapshot();
  await assert.rejects(publish(store, value), /MARKET_ADMISSION_CAS_OUTCOME_UNKNOWN/);
  assert.deepEqual(state(store).reservations, [entry(value)]);
  assert.deepEqual(uploads(store), []);
  assert.deepEqual(pointerWrites(store), []);
});

test('a known admission CAS conflict cannot begin generation uploads', async () => {
  const store = memoryStorage(); const cas = store.compareAndSwap;
  store.compareAndSwap = async (path, expected, bytes) => {
    assert.equal(path, ADMISSION_POLICY.path);
    putReservations(store, [seededEntry('0')]);
    return cas(path, expected, bytes);
  };
  await assert.rejects(publish(store, snapshot()), /MARKET_ADMISSION_CAS_CONFLICT/);
  assert.deepEqual(uploads(store), []);
  assert.deepEqual(pointerWrites(store), []);
  assert.deepEqual(state(store).reservations, [seededEntry('0')]);
});

test('an already reserved exact generation byte token tuple resumes without another admission CAS', async () => {
  const store = memoryStorage(); const value = snapshot();
  await reserveAdmission(store, entry(value));
  store.calls.length = 0;
  assert.equal((await publish(store, value)).status, 'ACTIVATED');
  assert.deepEqual(admissionWrites(store), []);
  assert.deepEqual(state(store).reservations, [entry(value)]);
  assert.deepEqual(await readCurrentSnapshot(store), value);
});

test('a different attempt or byte budget never adopts an existing generation reservation', async () => {
  const value = snapshot();
  for (const reserved of [{ ...entry(value), attemptToken: B }, { ...entry(value), wireBytes: wireBytes(value) - 1 }]) {
    const store = memoryStorage(); putReservations(store, [reserved]);
    await assert.rejects(publish(store, value), /MARKET_ADMISSION_GENERATION_RESERVATION_CONFLICT/);
    assert.deepEqual(writes(store), []);
    assert.deepEqual(state(store).reservations, [reserved]);
  }
});

test('attempt token reuse for another generation cannot bypass admission', async () => {
  const store = memoryStorage(); const good = snapshot();
  await publish(store, good);
  store.calls.length = 0;
  await assert.rejects(publish(store, snapshot('102')), /MARKET_ADMISSION_ATTEMPT_TOKEN_CONFLICT/);
  assert.deepEqual(writes(store), []);
  assert.deepEqual(await readCurrentSnapshot(store), good);
});

test('four permanent reservations block a fifth with no snapshot write', async () => {
  const store = memoryStorage(); const reserved = ['0', '1', '2', '3'].map((digit) => seededEntry(digit));
  putReservations(store, reserved);
  await assert.rejects(publish(store, snapshot()), /MARKET_ADMISSION_GENERATION_BUDGET/);
  assert.deepEqual(writes(store), []);
  assert.deepEqual(state(store).reservations, reserved);
});

test('exact remaining final-wire budget succeeds and one byte less prevents all uploads', async () => {
  const value = snapshot('101', 201);
  for (const extra of [0, 1]) {
    const store = memoryStorage();
    putReservations(store, [seededEntry('0', ADMISSION_POLICY.maxReservedWireBytes - wireBytes(value) + extra)]);
    if (extra === 0) {
      assert.equal((await publish(store, value)).status, 'ACTIVATED');
      assert.equal(state(store).reservations.reduce((sum, row) => sum + row.wireBytes, 0), ADMISSION_POLICY.maxReservedWireBytes);
    } else {
      await assert.rejects(publish(store, value), /MARKET_ADMISSION_BYTE_BUDGET/);
      assert.deepEqual(writes(store), []);
    }
  }
});

test('malformed persisted admission fails closed without uploading or repairing the control object', async () => {
  const value = snapshot();
  for (const bytes of [Buffer.from('{}'), Buffer.from('{"schema":1,"reservations":[]}'),
    Buffer.from('{"schema":1,"schema":1,"reservations":[]}'), Buffer.alloc(4097),
    encodeBoundedJson({ schema: 2, reservations: [entry(value)] }),
    encodeBoundedJson({ schema: 1, reservations: [{ ...entry(value), wireBytes: -1 }] })]) {
    const store = memoryStorage(); store.put(ADMISSION_POLICY.path, bytes);
    await assert.rejects(publish(store, value));
    assert.deepEqual(writes(store), []);
    assert.deepEqual(store.objects.get(ADMISSION_POLICY.path).bytes, bytes);
  }
});

test('partial immutable failure keeps the full reservation charged and exact last-good pointer', async () => {
  const store = memoryStorage(); const good = snapshot(); const next = snapshot('102', 401);
  await publish(store, good);
  const pointer = structuredClone(store.objects.get(STORE_POLICY.pointerPath));
  const create = store.createIfAbsent;
  store.createIfAbsent = async (path, bytes) => {
    if (path.endsWith('/pages/1.json')) throw Error('synthetic partial upload failure');
    return create(path, bytes);
  };
  store.calls.length = 0;
  await assert.rejects(publish(store, next, B), /MARKET_SNAPSHOT_STORAGE_WRITE/);
  assert.deepEqual(structuredClone(store.objects.get(STORE_POLICY.pointerPath)), pointer);
  assert.ok(uploads(store).some(({ path }) => path.includes(next.manifest.generation)));
  assert.deepEqual(pointerWrites(store), []);
  assert.deepEqual(state(store).reservations.find(({ generation }) => generation === next.manifest.generation), entry(next, B));
  assert.deepEqual(await readCurrentSnapshot(store), good);
  assert.equal(Object.keys(store).some((key) => /delete|release|reset/.test(key)), false);
});

test('unknown pointer activation leaves both reservations charged without rollback or retry', async () => {
  for (const commit of [false, true]) {
    const store = memoryStorage(); const good = snapshot(); const next = snapshot('102');
    await publish(store, good);
    const cas = store.compareAndSwap; store.calls.length = 0;
    store.compareAndSwap = async (path, expected, bytes) => {
      if (path === ADMISSION_POLICY.path) return cas(path, expected, bytes);
      if (commit) await cas(path, expected, bytes);
      else store.calls.push({ operation: 'cas', path, expectedVersion: expected });
      throw Error('synthetic pointer completion unknown');
    };
    await assert.rejects(publish(store, next, B), /MARKET_SNAPSHOT_ACTIVATION_OUTCOME_UNKNOWN/);
    assert.equal(state(store).reservations.length, 2);
    assert.equal(pointerWrites(store).length, 1);
    assert.equal(admissionWrites(store).length, 1);
    assert.deepEqual(await readCurrentSnapshot(store), commit ? next : good);
  }
});

test('a newer concurrent activation fences the already admitted older publisher without reversion or release', async () => {
  const store = memoryStorage();
  const old = snapshot('101', 1, '2026-10-01T00:00:00Z');
  const middle = snapshot('102', 1, '2026-10-02T00:00:00Z');
  const newer = snapshot('103', 1, '2026-10-03T00:00:00Z');
  await publish(store, old);
  const create = store.createIfAbsent;
  let raced = false;
  store.createIfAbsent = async (path, bytes) => {
    if (!raced && path.includes(middle.manifest.generation)) {
      raced = true;
      assert.ok(state(store).reservations.some(({ generation }) => generation === middle.manifest.generation));
      assert.equal((await publish(store, newer, C)).status, 'ACTIVATED');
    }
    return create(path, bytes);
  };
  store.calls.length = 0;
  await assert.rejects(publish(store, middle, B), /MARKET_SNAPSHOT_CAS_CONFLICT/);
  assert.equal(raced, true);
  assert.deepEqual(await readCurrentSnapshot(store), newer);
  assert.equal(state(store).reservations.length, 3);
  assert.equal(pointerWrites(store).length, 2);
  assert.equal(admissionWrites(store).length, 2);
});

test('two concurrent publishers for the last slot allow only the admitted winner to upload', async () => {
  const store = memoryStorage();
  putReservations(store, ['0', '1', '2'].map((digit) => seededEntry(digit)));
  const read = store.read;
  let reads = 0; let release;
  const gate = new Promise((resolve) => { release = resolve; });
  store.read = async (path, options) => {
    const result = await read(path, options);
    if (path === ADMISSION_POLICY.path && reads < 2) {
      if (++reads === 2) release();
      await gate;
    }
    return result;
  };
  const values = [snapshot('101'), snapshot('102')];
  const results = await Promise.allSettled(values.map((value, index) => publish(store, value, index ? B : A)));
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.match(results.find(({ status }) => status === 'rejected').reason.message, /MARKET_ADMISSION_CAS_CONFLICT/);
  const winning = results.find(({ status }) => status === 'fulfilled').value.generation;
  assert.equal(state(store).reservations.length, 4);
  assert.equal(uploads(store).every(({ path }) => path.includes(winning)), true);
  assert.equal(pointerWrites(store).length, 1);
});
