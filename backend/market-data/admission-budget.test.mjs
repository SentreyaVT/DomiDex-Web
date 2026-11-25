import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { encodeBoundedJson } from './contract.mjs';
import { ADMISSION_POLICY, reserveAdmission, validateAdmissionState } from './admission-budget.mjs';

const test = (...args) => { void nodeTest(...args); };

const entry = (id, wireBytes = 1, token = id) => ({ generation: id.toString(16).padStart(64, '0'),
  wireBytes, attemptToken: token.toString(16).padStart(32, '0') });
const state = (...reservations) => ({ schema: 1, reservations });
const rejects = (promise, code) => assert.rejects(promise, new RegExp(`MARKET_ADMISSION_${code}`));
const writeCalls = (storage) => storage.calls.filter(({ operation }) => operation === 'cas');

// No filesystem, network, credentials, real storage or clock. Unknown commits
// are explicitly applied by the test later, never guessed settled from a timer.
function memoryStorage() {
  let sequence = 0;
  const storage = {
    value: null, calls: [],
    put(bytes) { storage.value = { bytes: Buffer.from(bytes), version: `v${++sequence}` }; },
    async read(path, options) {
      assert.equal(path, ADMISSION_POLICY.path);
      assert.deepEqual(options, { maxBytes: ADMISSION_POLICY.controlBytes });
      storage.calls.push({ operation: 'read', path });
      return storage.value === null ? null : { bytes: Buffer.from(storage.value.bytes), version: storage.value.version };
    },
    async compareAndSwap(path, expectedVersion, bytes) {
      assert.equal(path, ADMISSION_POLICY.path);
      storage.calls.push({ operation: 'cas', path, expectedVersion, bytes: Buffer.from(bytes) });
      if ((storage.value?.version ?? null) !== expectedVersion) return false;
      storage.put(bytes);
      return true;
    },
  };
  return storage;
}

test('first reservation uses only CAS(null), fixed control path and final caller-supplied wire budget', async () => {
  const storage = memoryStorage();
  const requested = entry(1, 123456);
  assert.deepEqual(await reserveAdmission(storage, requested), { status: 'RESERVED', ...requested,
    reservedGenerations: 1, reservedWireBytes: 123456 });
  assert.equal(writeCalls(storage).length, 1);
  assert.equal(writeCalls(storage)[0].expectedVersion, null);
  assert.deepEqual(JSON.parse(storage.value.bytes), state(requested));
  assert.equal(storage.calls.length, 3, 'read, one CAS, verified readback');
  assert.equal(Object.hasOwn(storage, 'delete'), false);
});

test('subsequent reservations use the exact prior version and keep all old tuples sorted', async () => {
  const storage = memoryStorage();
  await reserveAdmission(storage, entry(3, 300));
  const previous = storage.value.version;
  const result = await reserveAdmission(storage, entry(1, 100));
  assert.equal(writeCalls(storage)[1].expectedVersion, previous);
  assert.deepEqual(JSON.parse(storage.value.bytes), state(entry(1, 100), entry(3, 300)));
  assert.equal(result.reservedWireBytes, 400);
  assert.equal(result.reservedGenerations, 2);
});

test('exactly four generations may reserve exactly 1GiB; both boundaries are hard', async () => {
  const storage = memoryStorage();
  const quarter = ADMISSION_POLICY.maxReservedWireBytes / 4;
  for (let id = 1; id <= 4; id++) await reserveAdmission(storage, entry(id, quarter));
  const before = structuredClone(storage.value);
  assert.equal(JSON.parse(storage.value.bytes).reservations.reduce((total, row) => total + row.wireBytes, 0), 1024 ** 3);
  await rejects(reserveAdmission(storage, entry(5)), 'GENERATION_BUDGET');
  assert.deepEqual(structuredClone(storage.value), before);
  assert.equal(writeCalls(storage).length, 4);
  assert.equal((await reserveAdmission(storage, entry(4, quarter))).status, 'ALREADY_RESERVED');
});

test('one-byte remaining budget is admissible but one byte over is not, without clamping or overflow', async () => {
  const storage = memoryStorage();
  await reserveAdmission(storage, entry(1, ADMISSION_POLICY.maxReservedWireBytes - 1));
  await rejects(reserveAdmission(storage, entry(2, 2)), 'BYTE_BUDGET');
  assert.equal(writeCalls(storage).length, 1);
  assert.equal((await reserveAdmission(storage, entry(2, 1))).reservedWireBytes, ADMISSION_POLICY.maxReservedWireBytes);
  await rejects(reserveAdmission(storage, entry(3, 1)), 'BYTE_BUDGET');
  assert.equal(writeCalls(storage).length, 2);
});

test('same tuple is idempotent without a write; another token or size cannot adopt the generation', async () => {
  const storage = memoryStorage();
  await reserveAdmission(storage, entry(1, 123));
  const original = structuredClone(storage.value);
  assert.equal((await reserveAdmission(storage, entry(1, 123))).status, 'ALREADY_RESERVED');
  await rejects(reserveAdmission(storage, entry(1, 123, 2)), 'GENERATION_RESERVATION_CONFLICT');
  await rejects(reserveAdmission(storage, entry(1, 124)), 'GENERATION_RESERVATION_CONFLICT');
  await rejects(reserveAdmission(storage, entry(1, 124, 2)), 'GENERATION_RESERVATION_CONFLICT');
  await rejects(reserveAdmission(storage, entry(2, 123, 1)), 'ATTEMPT_TOKEN_CONFLICT');
  assert.deepEqual(structuredClone(storage.value), original);
  assert.equal(writeCalls(storage).length, 1);
});

test('invalid identities, tokens, numbers and extra fields fail before any control IO', async () => {
  const invalid = [undefined, null, {}, [], { ...entry(1), extra: true }];
  for (const generation of ['../private', 'https://example.invalid', 'A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(64)}\n`, 1]) {
    invalid.push({ ...entry(1), generation });
  }
  for (const attemptToken of ['', 'A'.repeat(32), 'a'.repeat(31), `${'a'.repeat(32)}\n`, 1, null]) {
    invalid.push({ ...entry(1), attemptToken });
  }
  for (const wireBytes of [0, -0, -1, 1.5, NaN, Infinity, '1', 1n, undefined,
    ADMISSION_POLICY.maxReservedWireBytes + 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
    invalid.push({ ...entry(1), wireBytes });
  }
  const accessor = entry(1);
  Object.defineProperty(accessor, 'wireBytes', { enumerable: true, get() { throw Error('must not execute'); } });
  invalid.push(accessor);
  for (const input of invalid) {
    const storage = memoryStorage();
    await assert.rejects(reserveAdmission(storage, input));
    assert.deepEqual(storage.calls, []);
  }
});

test('malformed persisted schema, missing/extra fields, empty/sparse state and counters reject', () => {
  const invalid = [null, {}, [], { ...state(entry(1)), schema: 2 }, state(),
    { ...state(entry(1)), totalBytes: 1 }, { schema: 1, reservations: {} },
    state(entry(2), entry(1)), state(entry(1), entry(1)), state(entry(1), entry(2, 1, 1)),
    state(entry(1, ADMISSION_POLICY.maxReservedWireBytes), entry(2)),
    state(...Array.from({ length: 5 }, (_, index) => entry(index + 1))),
    { schema: 1, reservations: Array(1) },
  ];
  const sparse = []; sparse.length = 2; sparse[1] = entry(2); invalid.push({ schema: 1, reservations: sparse });
  const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { throw Error('must not execute'); } });
  invalid.push({ schema: 1, reservations: accessor });
  for (const value of invalid) assert.throws(() => validateAdmissionState(value));
  const original = state(entry(1));
  const clone = validateAdmissionState(original); clone.reservations[0].wireBytes = 999;
  assert.equal(original.reservations[0].wireBytes, 1);
});

test('all corrupted persisted bodies fail closed without replacing a last-known control record', async () => {
  const bodies = [Buffer.from('{}'), Buffer.from('null'), Buffer.from(' {"schema":1}'), Buffer.from([255]),
    Buffer.from('{"schema":1,"schema":1,"reservations":[]}'), Buffer.alloc(ADMISSION_POLICY.controlBytes + 1),
    encodeBoundedJson(state()), encodeBoundedJson({ ...state(entry(1)), schema: 2 }),
    encodeBoundedJson(state(entry(1), entry(2, 1, 1))),
    encodeBoundedJson(state(entry(1, ADMISSION_POLICY.maxReservedWireBytes), entry(2))),
    encodeBoundedJson(state(entry(2), entry(1))),
  ];
  for (const body of bodies) {
    const storage = memoryStorage(); storage.put(body);
    const original = structuredClone(storage.value);
    await assert.rejects(reserveAdmission(storage, entry(3)));
    assert.deepEqual(writeCalls(storage), []);
    assert.deepEqual(structuredClone(storage.value), original);
  }
});

test('storage response bounds, version and fields are mandatory; read errors cannot initialize fresh state', async () => {
  for (const value of [undefined, {}, { bytes: Buffer.alloc(0), version: 'v1' },
    { bytes: Buffer.from('{}'), version: '' }, { bytes: Buffer.from('{}'), version: 'v\n' },
    { bytes: Buffer.from('{}'), version: 'v'.repeat(257) },
    { bytes: Buffer.from('{}'), version: 'v', extra: true }, { bytes: '{}', version: 'v' }]) {
    const storage = memoryStorage(); storage.read = async () => value;
    await assert.rejects(reserveAdmission(storage, entry(1)));
    assert.deepEqual(writeCalls(storage), []);
  }
  const storage = memoryStorage(); storage.read = async () => { throw Error('read failed'); };
  await rejects(reserveAdmission(storage, entry(1)), 'CONTROL_READ');
  assert.deepEqual(writeCalls(storage), []);
  await rejects(reserveAdmission({}, entry(1)), 'ADAPTER');
});

async function race(storage, left, right) {
  const read = storage.read;
  let initial = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  storage.read = async (...args) => {
    const value = await read(...args);
    if (initial < 2) {
      initial++;
      if (initial === 2) release();
      await ready;
    }
    return value;
  };
  return Promise.allSettled([reserveAdmission(storage, left), reserveAdmission(storage, right)]);
}

test('concurrent first reservations both expect null and admit only one winning state', async () => {
  const storage = memoryStorage();
  const results = await race(storage, entry(1), entry(2));
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.match(results.find(({ status }) => status === 'rejected').reason.message, /CAS_CONFLICT/);
  assert.deepEqual(writeCalls(storage).map(({ expectedVersion }) => expectedVersion), [null, null]);
  assert.equal(JSON.parse(storage.value.bytes).reservations.length, 1);
});

test('two concurrent publishers competing for the last generation slot cannot both be admitted', async () => {
  const storage = memoryStorage();
  for (let id = 1; id <= 3; id++) await reserveAdmission(storage, entry(id));
  const previous = storage.value.version;
  const results = await race(storage, entry(4), entry(5));
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.match(results.find(({ status }) => status === 'rejected').reason.message, /CAS_CONFLICT/);
  assert.deepEqual(writeCalls(storage).slice(-2).map(({ expectedVersion }) => expectedVersion), [previous, previous]);
  assert.equal(JSON.parse(storage.value.bytes).reservations.length, 4);
});

test('two concurrent publishers competing for the last byte cannot exceed total logical budget', async () => {
  const storage = memoryStorage();
  await reserveAdmission(storage, entry(1, ADMISSION_POLICY.maxReservedWireBytes - 1));
  const results = await race(storage, entry(2), entry(3));
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const current = validateAdmissionState(JSON.parse(storage.value.bytes));
  assert.equal(current.reservations.reduce((total, row) => total + row.wireBytes, 0), ADMISSION_POLICY.maxReservedWireBytes);
});

test('concurrent same tuple is idempotent, but different writer tokens never adopt each other', async () => {
  for (const sameToken of [true, false]) {
    const storage = memoryStorage();
    const results = await race(storage, entry(1), entry(1, 1, sameToken ? 1 : 2));
    if (sameToken) {
      assert.equal(results.every(({ status }) => status === 'fulfilled'), true);
      assert.deepEqual(results.map(({ value }) => value.status).sort((left, right) => left.localeCompare(right)), ['ALREADY_RESERVED', 'RESERVED']);
    } else {
      assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
      assert.match(results.find(({ status }) => status === 'rejected').reason.message, /GENERATION_RESERVATION_CONFLICT/);
    }
    assert.equal(writeCalls(storage).length, 2);
    assert.equal(JSON.parse(storage.value.bytes).reservations.length, 1);
  }
});

test('CAS exceptions before or after commit remain unknown, and any committed orphan stays fully charged', async () => {
  for (const committed of [false, true]) {
    const storage = memoryStorage(); const cas = storage.compareAndSwap.bind(storage);
    storage.compareAndSwap = async (...args) => {
      if (committed) await cas(...args);
      else storage.calls.push({ operation: 'cas', path: args[0], expectedVersion: args[1] });
      throw Error('unknown commit');
    };
    await rejects(reserveAdmission(storage, entry(1, ADMISSION_POLICY.maxReservedWireBytes)), 'CAS_OUTCOME_UNKNOWN');
    assert.equal(writeCalls(storage).length, 1);
    storage.compareAndSwap = cas;
    if (committed) {
      await rejects(reserveAdmission(storage, entry(2)), 'BYTE_BUDGET');
      assert.equal((await reserveAdmission(storage, entry(1, ADMISSION_POLICY.maxReservedWireBytes))).status, 'ALREADY_RESERVED');
      assert.equal(writeCalls(storage).length, 1);
    } else assert.equal(storage.value, null);
  }
});

test('a late-applied unknown first CAS still consumes budget and never gains a timeout release', async () => {
  const storage = memoryStorage(); const cas = storage.compareAndSwap.bind(storage);
  let applyLate;
  storage.compareAndSwap = async (...args) => { applyLate = () => cas(...args); throw Error('lost completion'); };
  await rejects(reserveAdmission(storage, entry(1, ADMISSION_POLICY.maxReservedWireBytes)), 'CAS_OUTCOME_UNKNOWN');
  assert.equal(storage.value, null);
  assert.equal(await applyLate(), true);
  storage.compareAndSwap = cas;
  await rejects(reserveAdmission(storage, entry(2)), 'BYTE_BUDGET');
  assert.equal(JSON.parse(storage.value.bytes).reservations[0].wireBytes, ADMISSION_POLICY.maxReservedWireBytes);
  assert.equal(writeCalls(storage).length, 1);
});

test('a late unknown CAS cannot overwrite a newer reservation made before its delayed application', async () => {
  const storage = memoryStorage(); const cas = storage.compareAndSwap.bind(storage);
  let applyLate;
  storage.compareAndSwap = async (...args) => { applyLate = () => cas(...args); throw Error('lost completion'); };
  await rejects(reserveAdmission(storage, entry(1)), 'CAS_OUTCOME_UNKNOWN');
  storage.compareAndSwap = cas;
  await reserveAdmission(storage, entry(2));
  const current = structuredClone(storage.value);
  assert.equal(await applyLate(), false);
  assert.deepEqual(structuredClone(storage.value), current);
});

test('non-boolean CAS and missing/corrupt post-commit readback never authorize an upload', async () => {
  for (const value of [undefined, null, 0, 1, 'true', {}]) {
    const storage = memoryStorage(); storage.compareAndSwap = async () => value;
    await rejects(reserveAdmission(storage, entry(1)), 'CAS_OUTCOME_UNKNOWN');
  }
  for (const kind of ['missing', 'corrupt', 'read-error']) {
    const storage = memoryStorage(); const cas = storage.compareAndSwap.bind(storage);
    storage.compareAndSwap = async (...args) => {
      const applied = await cas(...args);
      if (kind === 'missing') storage.read = async () => null;
      if (kind === 'corrupt') storage.read = async () => ({ bytes: Buffer.from('{}'), version: 'v2' });
      if (kind === 'read-error') storage.read = async () => { throw Error('read failed'); };
      return applied;
    };
    await rejects(reserveAdmission(storage, entry(1)), 'CAS_OUTCOME_UNKNOWN');
    assert.deepEqual(JSON.parse(storage.value.bytes), state(entry(1)), 'actual reservation remains charged');
    assert.equal(writeCalls(storage).length, 1);
  }
});

test('post-CAS removal/mutation of an old tuple or changed bytes under an old version fail closed', async () => {
  for (const kind of ['removed', 'changed', 'reused-version']) {
    const storage = memoryStorage();
    await reserveAdmission(storage, entry(1));
    const version = storage.value.version;
    const cas = storage.compareAndSwap.bind(storage);
    storage.compareAndSwap = async (...args) => {
      await cas(...args);
      if (kind === 'removed') storage.put(encodeBoundedJson(state(entry(2))));
      if (kind === 'changed') storage.put(encodeBoundedJson(state(entry(1, 2), entry(2))));
      if (kind === 'reused-version') storage.value.version = version;
      return true;
    };
    await rejects(reserveAdmission(storage, entry(2)), kind === 'reused-version' ? 'STATE_VERSION' : 'STATE_REGRESSION');
  }
});

test('input mutation during first read cannot alter the owned reservation tuple', async () => {
  const storage = memoryStorage(); const requested = entry(1, 123);
  const expected = structuredClone(requested); const read = storage.read.bind(storage);
  storage.read = async (...args) => {
    requested.wireBytes = 1;
    requested.generation = 'f'.repeat(64);
    requested.attemptToken = 'f'.repeat(32);
    return read(...args);
  };
  await reserveAdmission(storage, requested);
  assert.deepEqual(JSON.parse(storage.value.bytes), state(expected));
});
