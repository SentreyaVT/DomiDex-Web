import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setImmediate as turn } from 'node:timers/promises';
import { LIMITS, buildSnapshot, encodeBoundedJson } from './contract.mjs';
import { STORE_POLICY, publishSnapshot, readCurrentManifest, readSnapshotPage,
  readCurrentSnapshot } from './snapshot-store.mjs';

const record = (id, price = '101') => ({ productId: String(id), categoryId: '51',
  expansionId: '99', metacardId: null, name: 'Synthetic product',
  normal: { average: price, low: '0', trend: null, average1: '104', average7: '105', average30: '106' },
  reverse: { average: '201', low: null, trend: '203' } });
const snapshot = (count = 1, price = '101') => buildSnapshot({
  sourceTimestamp: '2026-10-04T02:48:57+0200', catalogSourceTimestamp: '2026-10-03T11:44:53+0200',
  records: Array.from({ length: count }, (_, i) => record(i + 1, price)),
});
const withTimes = (priceTime, catalogTime, price = '101') => buildSnapshot({
  sourceTimestamp: priceTime, catalogSourceTimestamp: catalogTime, records: [record(1, price)],
});
const manifestPath = (generation) => `${STORE_POLICY.namespace}/generations/${generation}/manifest.json`;
const pagePath = (generation, index) => `${STORE_POLICY.namespace}/generations/${generation}/pages/${index}.json`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rejects = (promise, code) => assert.rejects(promise, new RegExp(`MARKET_(?:SNAPSHOT|DATA)_${code}`));
const writes = (store) => store.calls.filter(({ operation }) => operation !== 'read');

// The only adapter in these tests is in memory. There is no filesystem, network,
// Firebase or provider client, and no delete/overwrite API for generation objects.
function memoryStorage() {
  const objects = new Map();
  const calls = [];
  let version = 0;
  const put = (path, bytes) => objects.set(path, { bytes: Buffer.from(bytes), version: `v${++version}` });
  return {
    objects, calls, put,
    async read(path, { maxBytes }) {
      calls.push({ operation: 'read', path, maxBytes });
      const value = objects.get(path);
      if (!value) return null;
      if (value.bytes.length > maxBytes) throw new Error('adapter refuses oversized response');
      return { bytes: Buffer.from(value.bytes), version: value.version };
    },
    async createIfAbsent(path, bytes) {
      calls.push({ operation: 'create', path });
      if (objects.has(path)) return false;
      put(path, bytes);
      return true;
    },
    async compareAndSwap(path, expectedVersion, bytes) {
      calls.push({ operation: 'cas', path, expectedVersion });
      if ((objects.get(path)?.version ?? null) !== expectedVersion) return false;
      put(path, bytes);
      return true;
    },
  };
}

function pointerBytes(value) {
  return encodeBoundedJson({ schema: 1, generation: value.manifest.generation,
    manifestSha256: sha256(encodeBoundedJson(value.manifest)) });
}

test('publish verifies every immutable object before its sole activation and full read preserves nine fields', async () => {
  const value = snapshot(201);
  const store = memoryStorage();
  assert.deepEqual(await publishSnapshot(store, value), { status: 'ACTIVATED', generation: value.manifest.generation });
  assert.equal(store.calls.at(-1).operation, 'cas');
  assert.equal(store.calls.at(-1).expectedVersion, null);
  const operations = writes(store);
  assert.equal(operations.filter(({ operation }) => operation === 'cas').length, 1);
  assert.equal(operations.at(-2).path, manifestPath(value.manifest.generation));
  for (const { path } of operations.filter(({ operation }) => operation === 'create')) {
    assert.equal(store.calls.filter((call) => call.operation === 'read' && call.path === path).length, 2);
  }
  assert.deepEqual(await readCurrentSnapshot(store), value);
  assert.deepEqual(JSON.parse(store.objects.get(STORE_POLICY.pointerPath).bytes), {
    schema: 1, generation: value.manifest.generation,
    manifestSha256: sha256(encodeBoundedJson(value.manifest)),
  });
});

test('invalid schema, sparse/empty pages, cross-generation data and over-budget input do no storage IO', async () => {
  const original = snapshot();
  const invalid = [
    undefined, {}, { manifest: {}, pages: [] },
    { ...original, pages: [] }, { ...original, pages: Array(1) },
    { ...original, pages: snapshot(1, '999').pages },
  ];
  const schema = structuredClone(original); schema.manifest.schema = 2; invalid.push(schema);
  const oversized = structuredClone(original); oversized.pages[0].records[0].name = 'x'.repeat(LIMITS.pageBytes + 1); invalid.push(oversized);
  const empty = structuredClone(original); empty.manifest.totalItems = 0; invalid.push(empty);
  for (const value of invalid) {
    const store = memoryStorage();
    await assert.rejects(publishSnapshot(store, value));
    assert.deepEqual(store.calls, []);
  }
});

test('at most four immutable creates overlap and manifest waits for all pages', async () => {
  const value = snapshot(801);
  const store = memoryStorage();
  const create = store.createIfAbsent;
  let active = 0;
  let maximum = 0;
  let completedPages = 0;
  store.createIfAbsent = async (path, bytes) => {
    if (path.endsWith('/manifest.json')) assert.equal(completedPages, 5);
    active++;
    maximum = Math.max(maximum, active);
    try { await turn(); return await create(path, bytes); }
    finally { active--; if (path.includes('/pages/')) completedPages++; }
  };
  await publishSnapshot(store, value);
  assert.equal(maximum, 4);
  assert.equal(active, 0);
  assert.deepEqual(await readCurrentSnapshot(store), value);
});

test('partial immutable write failure settles in-flight work and preserves the exact last-good pointer', async () => {
  const store = memoryStorage();
  const good = snapshot();
  await publishSnapshot(store, good);
  const before = structuredClone(store.objects.get(STORE_POLICY.pointerPath));
  const create = store.createIfAbsent;
  const next = snapshot(801, '102');
  let active = 0;
  store.calls.length = 0;
  store.createIfAbsent = async (path, bytes) => {
    active++;
    try {
      await turn();
      if (path === pagePath(next.manifest.generation, 2)) throw Error('synthetic storage failure');
      return await create(path, bytes);
    } finally { active--; }
  };
  await rejects(publishSnapshot(store, next), 'STORAGE_WRITE');
  assert.equal(active, 0);
  assert.deepEqual(structuredClone(store.objects.get(STORE_POLICY.pointerPath)), before);
  assert.equal(store.objects.has(manifestPath(next.manifest.generation)), false);
  assert.equal(store.calls.some(({ operation }) => operation === 'cas'), false);
  assert.equal([...store.objects.keys()].some((path) => path.startsWith(`${STORE_POLICY.namespace}/generations/${next.manifest.generation}/pages/`)), true);
  assert.deepEqual(await readCurrentSnapshot(store), good);
});

test('existing-generation collisions never overwrite the object or activate a pointer', async () => {
  const store = memoryStorage();
  const value = snapshot();
  const path = pagePath(value.manifest.generation, 0);
  const bad = Buffer.from('{"unrelated":true}');
  store.put(path, bad);
  await rejects(publishSnapshot(store, value), 'IMMUTABLE_COLLISION');
  assert.deepEqual(store.objects.get(path).bytes, bad);
  assert.equal(store.objects.has(STORE_POLICY.pointerPath), false);
  assert.equal(store.calls.some(({ operation }) => operation === 'cas'), false);
});

test('acknowledged but missing or corrupt immutable writes fail their readback', async () => {
  for (const mode of ['missing', 'corrupt']) {
    const store = memoryStorage();
    store.createIfAbsent = async (path) => {
      store.calls.push({ operation: 'create', path });
      if (mode === 'corrupt') store.put(path, Buffer.from('{}'));
      return true;
    };
    await rejects(publishSnapshot(store, snapshot()), mode === 'missing' ? 'MISSING_OBJECT' : 'IMMUTABLE_COLLISION');
    assert.equal(store.objects.has(STORE_POLICY.pointerPath), false);
  }
});

test('a corrupt second full-generation verification cannot activate even after successful individual readbacks', async () => {
  const store = memoryStorage();
  const value = snapshot();
  const read = store.read;
  let pageReads = 0;
  store.read = async (path, options) => {
    const result = await read(path, options);
    if (path.includes('/pages/') && ++pageReads === 2) return { ...result, bytes: Buffer.from('{}') };
    return result;
  };
  await assert.rejects(publishSnapshot(store, value));
  assert.equal(store.objects.has(STORE_POLICY.pointerPath), false);
  assert.equal(store.calls.some(({ operation }) => operation === 'cas'), false);
});

test('same-generation publish is verified idempotence without any creates or CAS', async () => {
  const value = snapshot(201);
  const store = memoryStorage();
  await publishSnapshot(store, value);
  store.calls.length = 0;
  assert.deepEqual(await publishSnapshot(store, value), { status: 'ALREADY_ACTIVE', generation: value.manifest.generation });
  assert.deepEqual(writes(store), []);
  assert.equal(store.calls.filter(({ path }) => path.includes('/pages/')).length, 2);
  store.put(pagePath(value.manifest.generation, 0), Buffer.from('{}'));
  await assert.rejects(publishSnapshot(store, value));
  assert.deepEqual(writes(store), []);
});

async function racePublishers(left, right) {
  const store = memoryStorage();
  const read = store.read;
  let initialReads = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  store.read = async (path, options) => {
    const result = await read(path, options);
    if (path === STORE_POLICY.pointerPath && initialReads < 2) {
      initialReads++;
      if (initialReads === 2) release();
      await ready;
    }
    return result;
  };
  return { store, results: await Promise.allSettled([publishSnapshot(store, left), publishSnapshot(store, right)]) };
}

test('concurrent different publishers have one CAS winner and never roll back its pointer', async () => {
  const left = snapshot(201, '101');
  const right = snapshot(201, '102');
  const { store, results } = await racePublishers(left, right);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const failed = results.find(({ status }) => status === 'rejected');
  assert.match(failed.reason.message, /MARKET_SNAPSHOT_CAS_CONFLICT/);
  assert.equal(store.calls.filter(({ operation }) => operation === 'cas').length, 2);
  const active = await readCurrentSnapshot(store);
  assert.equal(active.manifest.generation, results.find(({ status }) => status === 'fulfilled').value.generation);
  for (const value of [left, right]) assert.equal(store.objects.has(manifestPath(value.manifest.generation)), true);
});

test('concurrent same-generation publishers verify the winner without a blind CAS retry', async () => {
  const value = snapshot(201);
  const { store, results } = await racePublishers(value, value);
  assert.equal(results.every(({ status }) => status === 'fulfilled'), true);
  assert.deepEqual(results.map(({ value: result }) => result.status).sort(), ['ACTIVATED', 'ALREADY_ACTIVE']);
  assert.equal(store.calls.filter(({ operation }) => operation === 'cas').length, 2);
  assert.deepEqual(await readCurrentSnapshot(store), value);
});

test('failed CAS never reverts a newer pointer or retries an earlier expected version', async () => {
  const store = memoryStorage();
  const old = snapshot();
  const next = snapshot(1, '102');
  const winner = snapshot(1, '103');
  await publishSnapshot(store, old);
  const winnerStore = memoryStorage();
  await publishSnapshot(winnerStore, winner);
  for (const [path, value] of winnerStore.objects) if (path !== STORE_POLICY.pointerPath) store.put(path, value.bytes);
  const cas = store.compareAndSwap;
  store.calls.length = 0;
  store.compareAndSwap = async (path, expected, bytes) => {
    store.put(STORE_POLICY.pointerPath, pointerBytes(winner));
    return cas(path, expected, bytes);
  };
  await rejects(publishSnapshot(store, next), 'CAS_CONFLICT');
  assert.equal(store.calls.filter(({ operation }) => operation === 'cas').length, 1);
  assert.deepEqual(await readCurrentSnapshot(store), winner);
  assert.deepEqual(await readSnapshotPage(store, old.manifest.generation, 0), old.pages[0]);
});

test('CAS exceptions before and after commit both report unknown outcome without rollback or retry', async () => {
  for (const committed of [false, true]) {
    const store = memoryStorage();
    const old = snapshot();
    const next = snapshot(1, '102');
    await publishSnapshot(store, old);
    store.calls.length = 0;
    const cas = store.compareAndSwap;
    store.compareAndSwap = async (path, expected, bytes) => {
      if (committed) await cas(path, expected, bytes);
      else store.calls.push({ operation: 'cas', path, expectedVersion: expected });
      throw Error('synthetic ambiguous completion');
    };
    await rejects(publishSnapshot(store, next), 'ACTIVATION_OUTCOME_UNKNOWN');
    assert.equal(store.calls.filter(({ operation }) => operation === 'cas').length, 1);
    assert.deepEqual(await readCurrentSnapshot(store), committed ? next : old);
  }
});

test('non-boolean create and CAS responses cannot manufacture successful publication', async () => {
  for (const returned of [undefined, null, 1, 'true', {}]) {
    const createStore = memoryStorage();
    createStore.createIfAbsent = async () => returned;
    await rejects(publishSnapshot(createStore, snapshot()), 'STORAGE_RESPONSE');
    assert.equal(createStore.objects.has(STORE_POLICY.pointerPath), false);
    const casStore = memoryStorage();
    casStore.compareAndSwap = async () => returned;
    await rejects(publishSnapshot(casStore, snapshot()), 'ACTIVATION_OUTCOME_UNKNOWN');
  }
});

test('manifest-only and pinned page reads stay bounded to three and two objects respectively', async () => {
  const value = snapshot(401);
  const store = memoryStorage();
  await publishSnapshot(store, value);
  store.calls.length = 0;
  assert.deepEqual(await readCurrentManifest(store), value.manifest);
  assert.deepEqual(store.calls.map(({ path }) => path), [STORE_POLICY.pointerPath,
    manifestPath(value.manifest.generation), STORE_POLICY.pointerPath]);
  store.calls.length = 0;
  assert.deepEqual(await readSnapshotPage(store, value.manifest.generation, 1), value.pages[1]);
  assert.deepEqual(store.calls.map(({ path }) => path), [manifestPath(value.manifest.generation), pagePath(value.manifest.generation, 1)]);
  assert.deepEqual(store.calls.map(({ maxBytes }) => maxBytes), [LIMITS.manifestBytes, LIMITS.pageBytes]);
});

test('old immutable generation page remains pinned after current activation changes', async () => {
  const store = memoryStorage();
  const old = snapshot();
  const next = snapshot(1, '102');
  await publishSnapshot(store, old);
  await publishSnapshot(store, next);
  store.calls.length = 0;
  assert.deepEqual(await readSnapshotPage(store, old.manifest.generation, 0), old.pages[0]);
  assert.equal(store.calls.some(({ path }) => path === STORE_POLICY.pointerPath), false);
  assert.deepEqual(await readCurrentSnapshot(store), next);
});

test('current reads reject pointer change even if bytes are identical but version changed', async () => {
  for (const reader of [readCurrentManifest, readCurrentSnapshot]) {
    for (const sameBytes of [true, false]) {
      const store = memoryStorage();
      const value = snapshot();
      await publishSnapshot(store, value);
      const read = store.read;
      let pointerReads = 0;
      store.read = async (path, options) => {
        if (path === STORE_POLICY.pointerPath && ++pointerReads === 2) {
          store.put(path, sameBytes ? pointerBytes(value) : pointerBytes(snapshot(1, '102')));
        }
        return read(path, options);
      };
      await rejects(reader(store), 'CURRENT_CHANGED');
      assert.equal(pointerReads, 2);
    }
  }
});

test('invalid generation and index cannot select private, URL or traversal paths', async () => {
  const store = memoryStorage();
  const valid = snapshot().manifest.generation;
  for (const generation of [null, '', '../users/private', 'https://example.invalid/a',
    valid.toUpperCase(), `${valid}\n`, `${valid}/../current.json`, 'a'.repeat(63)]) {
    await rejects(readSnapshotPage(store, generation, 0), 'GENERATION');
  }
  for (const index of [-1, -0, 0.5, NaN, Infinity, '0', null, STORE_POLICY.maxPages]) {
    await rejects(readSnapshotPage(store, valid, index), 'PAGE_INDEX');
  }
  assert.deepEqual(store.calls, []);
  const value = snapshot();
  await publishSnapshot(store, value);
  store.calls.length = 0;
  await rejects(readSnapshotPage(store, valid, 1), 'PAGE_INDEX');
  assert.deepEqual(store.calls.map(({ path }) => path), [manifestPath(valid)]);
});

test('all storage paths are fixed public schema namespace plus digest and bounded page index', async () => {
  const store = memoryStorage();
  await publishSnapshot(store, snapshot(201));
  const expected = /^public-market-data\/schema-1\/(?:current\.json|generations\/[a-f0-9]{64}\/(?:manifest\.json|pages\/(?:0|[1-9][0-9]{0,2})\.json))$/;
  for (const { path } of store.calls) assert.match(path, expected);
  assert.equal(Object.hasOwn(store, 'delete'), false);
  assert.deepEqual(Object.keys(JSON.parse(store.objects.get(STORE_POLICY.pointerPath).bytes)).sort(), ['generation', 'manifestSha256', 'schema']);
});

test('no active pointer returns null, but missing immutable generation/page is an error', async () => {
  const store = memoryStorage();
  assert.equal(await readCurrentManifest(store), null);
  assert.equal(await readCurrentSnapshot(store), null);
  await rejects(readSnapshotPage(store, snapshot().manifest.generation, 0), 'MISSING_OBJECT');
  const value = snapshot();
  store.put(manifestPath(value.manifest.generation), encodeBoundedJson(value.manifest));
  await rejects(readSnapshotPage(store, value.manifest.generation, 0), 'MISSING_OBJECT');
});

test('untrusted adapter responses cannot evade byte bounds or omit valid opaque versions', async () => {
  for (const response of [undefined, {}, [], { bytes: Buffer.from('{}'), version: '' },
    { bytes: Buffer.from('{}'), version: 'bad\n' }, { bytes: Buffer.from('{}'), version: 'v', extra: true },
    { bytes: '{}', version: 'v' }, { bytes: Buffer.alloc(0), version: 'v' },
    { bytes: Buffer.alloc(STORE_POLICY.pointerBytes + 1), version: 'v' },
    { bytes: Buffer.from('{}'), version: 'v'.repeat(257) }]) {
    await rejects(readCurrentManifest({ read: async () => response }), 'STORAGE_RESPONSE');
  }
  await rejects(readCurrentManifest({ read: async () => { throw Error('sensitive adapter detail'); } }), 'STORAGE_READ');
  for (const reader of [readCurrentManifest, readCurrentSnapshot]) {
    await rejects(reader(null), 'ADAPTER');
  }
  await rejects(publishSnapshot({ read: async () => null }, snapshot()), 'ADAPTER');
});

test('noncanonical pointer, invalid UTF8 and pointer/manifest digest mismatch fail closed', async () => {
  const value = snapshot();
  for (const bytes of [Buffer.from(' {"schema":1}'), Buffer.from([0xff]),
    encodeBoundedJson({ schema: 2, generation: value.manifest.generation, manifestSha256: '0'.repeat(64) }),
    encodeBoundedJson({ schema: 1, generation: value.manifest.generation, manifestSha256: '0'.repeat(64), url: 'https://example.invalid/' })]) {
    const store = memoryStorage();
    store.put(STORE_POLICY.pointerPath, bytes);
    await assert.rejects(readCurrentManifest(store));
  }
  const store = memoryStorage();
  await publishSnapshot(store, value);
  store.put(STORE_POLICY.pointerPath, encodeBoundedJson({ schema: 1, generation: value.manifest.generation, manifestSha256: '0'.repeat(64) }));
  await rejects(readCurrentManifest(store), 'MANIFEST_DIGEST');
  await rejects(publishSnapshot(store, value), 'POINTER_CONFLICT');
});

test('manifest path generation and page payload generation/digest must both agree', async () => {
  const value = snapshot();
  const other = snapshot(1, '102');
  const store = memoryStorage();
  await publishSnapshot(store, value);
  store.put(manifestPath(value.manifest.generation), encodeBoundedJson(other.manifest));
  await rejects(readSnapshotPage(store, value.manifest.generation, 0), 'MANIFEST_GENERATION');
  store.put(manifestPath(value.manifest.generation), encodeBoundedJson(value.manifest));
  store.put(pagePath(value.manifest.generation, 0), encodeBoundedJson(other.pages[0]));
  await rejects(readSnapshotPage(store, value.manifest.generation, 0), 'PAGE_GENERATION');
  other.pages[0].generation = value.manifest.generation;
  store.put(pagePath(value.manifest.generation, 0), encodeBoundedJson(other.pages[0]));
  await rejects(readSnapshotPage(store, value.manifest.generation, 0), 'PAGE_DIGEST');
});

test('oversized stored page fails bounded read and is never truncated into a passing body', async () => {
  const value = snapshot();
  const store = memoryStorage();
  await publishSnapshot(store, value);
  store.put(pagePath(value.manifest.generation, 0), Buffer.alloc(LIMITS.pageBytes + 1));
  await rejects(readSnapshotPage(store, value.manifest.generation, 0), 'STORAGE_READ');
  const read = store.read;
  store.read = async (path, options) => path.includes('/pages/')
    ? { bytes: Buffer.alloc(LIMITS.pageBytes + 1), version: 'lying-adapter' } : read(path, options);
  await rejects(readSnapshotPage(store, value.manifest.generation, 0), 'STORAGE_RESPONSE');
});

test('prepared bytes are owned before the first await and caller mutation cannot change publication', async () => {
  const value = snapshot();
  const expected = structuredClone(value);
  const store = memoryStorage();
  const read = store.read;
  let mutated = false;
  store.read = async (path, options) => {
    if (!mutated) {
      mutated = true;
      value.pages[0].records[0].normal.average = '999';
      value.manifest.generation = '0'.repeat(64);
      value.pages.length = 0;
    }
    return read(path, options);
  };
  await publishSnapshot(store, value);
  assert.deepEqual(await readCurrentSnapshot(store), expected);
});

test('either older source rejects before immutable writes even when the other source is newer', async () => {
  const at = '2026-10-04T12:00:00Z';
  const older = '2026-10-04T11:59:59.999999999Z';
  const newer = '2026-10-04T12:00:00.000000001Z';
  for (const [prices, products, code] of [
    [older, newer, 'PRICE_TIME_REGRESSION'],
    [newer, older, 'CATALOG_TIME_REGRESSION'],
    [older, older, 'PRICE_TIME_REGRESSION'],
    [at, older, 'CATALOG_TIME_REGRESSION'],
    [older, at, 'PRICE_TIME_REGRESSION'],
  ]) {
    const store = memoryStorage();
    const current = withTimes(at, at);
    await publishSnapshot(store, current);
    const pointer = structuredClone(store.objects.get(STORE_POLICY.pointerPath));
    store.calls.length = 0;
    await rejects(publishSnapshot(store, withTimes(prices, products, '102')), code);
    assert.deepEqual(writes(store), []);
    assert.deepEqual(structuredClone(store.objects.get(STORE_POLICY.pointerPath)), pointer);
    assert.deepEqual(await readCurrentSnapshot(store), current);
  }
});

test('equal or individually newer source instants allow a correction, preserving exact offset spelling', async () => {
  const at = '2026-10-04T12:00:00.123456789Z';
  for (const [prices, products] of [
    [at, at],
    ['2026-10-04T14:00:00.123456789+0200', '2026-10-04T07:00:00.123456789-05:00'],
    ['2026-10-04T12:00:00.123456790Z', at],
    [at, '2026-10-04T12:00:00.123456790Z'],
  ]) {
    const store = memoryStorage();
    const current = withTimes(at, at);
    const corrected = withTimes(prices, products, '102');
    await publishSnapshot(store, current);
    assert.notEqual(current.manifest.generation, corrected.manifest.generation);
    assert.equal((await publishSnapshot(store, corrected)).status, 'ACTIVATED');
    assert.deepEqual(await readCurrentSnapshot(store), corrected);
  }
});

test('nanosecond comparison handles leap days, century boundaries and four-digit year limits', async () => {
  for (const [before, equalOrLater] of [
    ['0001-01-01T00:00:00Z', '0001-01-01T18:00:00+1800'],
    ['0099-12-31T23:59:59.999999999Z', '0100-01-01T00:00:00Z'],
    ['1900-02-28T23:59:59.999999999Z', '1900-03-01T00:00:00Z'],
    ['2000-02-29T23:59:59.999999999Z', '2000-03-01T00:00:00Z'],
    ['2026-12-31T23:59:59.999999999Z', '2027-01-01T00:00:00Z'],
    ['9999-12-31T05:59:59.999999999Z', '9999-12-31T23:59:59.999999999+18:00'],
  ]) {
    const store = memoryStorage();
    await publishSnapshot(store, withTimes(before, before));
    const next = withTimes(equalOrLater, equalOrLater, '102');
    assert.equal((await publishSnapshot(store, next)).status, 'ACTIVATED');
    assert.deepEqual(await readCurrentSnapshot(store), next);
  }
  const store = memoryStorage();
  await publishSnapshot(store, withTimes('2026-10-04T12:00:00.123456789Z', '2026-10-04T12:00:00Z'));
  await rejects(publishSnapshot(store, withTimes('2026-10-04T14:00:00.123456788+02:00',
    '2026-10-04T12:00:00Z', '102')), 'PRICE_TIME_REGRESSION');
});

test('a missing or corrupt active manifest cannot silently remove the source-time rollback guard', async () => {
  for (const corrupt of [false, true]) {
    const store = memoryStorage();
    const old = snapshot();
    // Deliberately incomplete adapter state, not a published successful generation.
    store.put(STORE_POLICY.pointerPath, pointerBytes(old));
    if (corrupt) store.put(manifestPath(old.manifest.generation), Buffer.from('{}'));
    await rejects(publishSnapshot(store, snapshot(1, '102')), corrupt ? 'MANIFEST_DIGEST' : 'MISSING_OBJECT');
    assert.deepEqual(writes(store), []);
  }
});
