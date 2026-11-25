import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { LIMITS, buildSnapshot } from './contract.mjs';
import { STORE_POLICY, publishSnapshot, readCurrentSnapshot } from './snapshot-store.mjs';
import { GCS_POLICY, createGcsStorage } from './gcs-storage.mjs';
import { ADMISSION_POLICY } from './admission-budget.mjs';
import { publishAdmittedSnapshot } from './publisher.mjs';

const ROOT = `${STORE_POLICY.namespace}/generations/${'a'.repeat(64)}`;
const PAGE = `${ROOT}/pages/0.json`;
const MANIFEST = `${ROOT}/manifest.json`;
const POINTER = STORE_POLICY.pointerPath;
const BODY = Buffer.from('{"synthetic":true}');
const md5 = (bytes) => createHash('md5').update(bytes).digest('base64');
const httpError = (code) => Object.assign(Error('synthetic upstream error; never disclose'), { code });
const rejects = (promise, code) => assert.rejects(promise, new RegExp(`MARKET_GCS_${code}`));

// API-shaped local test double; no real Bucket, credentials, SDK client or IO.
// Generation history intentionally supports an overwrite between metadata and
// stream. crc32c here is a fixture header, not a claim of running SDK CRC code.
function fakeBucket() {
  const objects = new Map();
  const generations = new Map();
  const calls = [];
  const streams = [];
  const hooks = {};
  const forbidden = [];
  let generation = 100n;
  const put = (path, bytes, forcedVersion) => {
    const version = forcedVersion ?? String(++generation);
    const value = { name: path, bytes: Buffer.from(bytes), version, crc32c: 'AAAAAA==' };
    objects.set(path, value);
    generations.set(`${path}@${version}`, value);
    return value;
  };
  const bucket = {
    storage: { retryOptions: { autoRetry: false, maxRetries: 3 }, timeout: 30_000 },
    file(path, options = {}) {
      calls.push({ method: 'file', path, options: structuredClone(options) });
      const methods = {
        async getMetadata() {
          calls.push({ method: 'metadata', path });
          if (hooks.metadataError) throw hooks.metadataError;
          const value = objects.get(path);
          if (!value) throw httpError(404);
          const metadata = { name: path, generation: value.version, size: String(value.bytes.length), crc32c: value.crc32c };
          hooks.metadata?.(metadata, value);
          return [metadata, {}];
        },
        createReadStream(readOptions) {
          calls.push({ method: 'stream', path, fileOptions: structuredClone(options), options: structuredClone(readOptions) });
          const value = generations.get(`${path}@${options.generation}`);
          let started = false;
          const stream = new Readable({ read() {
            if (started) return;
            started = true;
            queueMicrotask(() => {
              if (stream.destroyed) return;
              if (!value) { stream.destroy(httpError(404)); return; }
              if (hooks.streamError) { stream.destroy(hooks.streamError); return; }
              const response = { statusCode: 200, headers: {
                'x-goog-generation': value.version, 'content-length': String(value.bytes.length),
                'x-goog-stored-content-length': String(value.bytes.length),
                'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': `crc32c=${value.crc32c}`,
              } };
              hooks.response?.(response);
              if (!hooks.omitResponse) stream.emit('response', response);
              if (hooks.repeatResponse) stream.emit('response', response);
              if (stream.destroyed) return;
              if (hooks.closeEarly) { stream.destroy(); return; }
              if (hooks.hang) return;
              const chunks = hooks.chunks ?? [value.bytes];
              for (const chunk of chunks) {
                if (stream.destroyed) return;
                stream.push(chunk);
              }
              stream.push(null);
            });
          } });
          streams.push(stream);
          return stream;
        },
        async save(bytes, saveOptions) {
          calls.push({ method: 'save', path, bytes: Buffer.from(bytes), options: structuredClone(saveOptions) });
          if (hooks.saveError) throw hooks.saveError;
          assert.equal(md5(bytes), saveOptions.metadata.md5Hash, 'server-side checksum must match the exact supplied bytes');
          const expected = saveOptions.preconditionOpts.ifGenerationMatch;
          const current = objects.get(path);
          if ((expected === 0 && current) || (expected !== 0 && current?.version !== expected)) throw httpError(412);
          put(path, bytes);
          if (hooks.afterCommitError) throw hooks.afterCommitError;
        },
      };
      return new Proxy(methods, { get(target, property) {
        if (['delete', 'download', 'request', 'requestStream', 'setMetadata', 'getSignedUrl'].includes(property)) {
          forbidden.push(property);
          throw Error(`forbidden SDK operation ${property}`);
        }
        return target[property];
      } });
    },
  };
  return { bucket, objects, generations, calls, streams, hooks, forbidden, put };
}

test('factory performs no IO, never changes client options and exposes only the three storage methods', () => {
  const f = fakeBucket();
  const before = structuredClone(f.bucket.storage.retryOptions);
  const adapter = createGcsStorage(f.bucket);
  assert.deepEqual(Object.keys(adapter).sort(), ['compareAndSwap', 'createIfAbsent', 'read']);
  assert.equal(Object.isFrozen(adapter), true);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.bucket.storage.retryOptions, before);
});

test('retry-enabled, missing or later-reconfigured clients fail without being reconfigured', async () => {
  for (const value of [undefined, true, 0, 'false']) {
    const f = fakeBucket(); f.bucket.storage.retryOptions.autoRetry = value;
    assert.throws(() => createGcsStorage(f.bucket), /MARKET_GCS_RETRY_POLICY/);
    assert.equal(f.bucket.storage.retryOptions.autoRetry, value);
    assert.deepEqual(f.calls, []);
  }
  for (const value of [null, {}, { file() {} }]) assert.throws(() => createGcsStorage(value), /MARKET_GCS_RETRY_POLICY/);
  const f = fakeBucket();
  const adapter = createGcsStorage(f.bucket);
  f.bucket.storage.retryOptions.autoRetry = true;
  await rejects(adapter.read(PAGE, { maxBytes: 512 }), 'RETRY_POLICY');
  await rejects(adapter.createIfAbsent(PAGE, BODY), 'RETRY_POLICY');
  await rejects(adapter.compareAndSwap(POINTER, null, BODY), 'RETRY_POLICY');
  assert.deepEqual(f.calls, []);
  assert.equal(f.bucket.storage.retryOptions.autoRetry, true);
});

test('explicit bounded Storage.timeout is required without changing the injected client', async () => {
  for (const timeout of [undefined, null, 0, -1, 0.5, NaN, Infinity, '30000', 30_001, Number.MAX_SAFE_INTEGER]) {
    const f = fakeBucket(); f.bucket.storage.timeout = timeout;
    assert.throws(() => createGcsStorage(f.bucket), /MARKET_GCS_TIMEOUT_POLICY/);
    assert.equal(f.bucket.storage.timeout, timeout);
    assert.deepEqual(f.calls, []);
  }
  for (const timeout of [1, 15_000, 30_000]) {
    const f = fakeBucket(); f.bucket.storage.timeout = timeout;
    const before = structuredClone(f.bucket.storage);
    assert.equal(await createGcsStorage(f.bucket).createIfAbsent(PAGE, BODY), true);
    assert.deepEqual(f.bucket.storage, before);
  }
});

test('a removed or enlarged client timeout blocks every later operation before SDK access', async () => {
  for (const timeout of [undefined, 30_001]) {
    const f = fakeBucket(); const adapter = createGcsStorage(f.bucket);
    f.bucket.storage.timeout = timeout;
    await rejects(adapter.read(PAGE, { maxBytes: 512 }), 'TIMEOUT_POLICY');
    await rejects(adapter.createIfAbsent(PAGE, BODY), 'TIMEOUT_POLICY');
    await rejects(adapter.compareAndSwap(POINTER, null, BODY), 'TIMEOUT_POLICY');
    assert.deepEqual(f.calls, []);
    assert.equal(f.bucket.storage.timeout, timeout);
  }
});

test('client timeout is rechecked after metadata before the pinned media request', async () => {
  const f = fakeBucket(); f.put(PAGE, BODY);
  f.hooks.metadata = () => { delete f.bucket.storage.timeout; };
  await rejects(createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 }), 'TIMEOUT_POLICY');
  assert.equal(f.streams.length, 0);
  assert.equal(Object.hasOwn(f.bucket.storage, 'timeout'), false);
});

test('valid read binds exact metadata version to bounded uncompressed SDK stream and returned bytes', async () => {
  const f = fakeBucket();
  f.put(PAGE, BODY, '9007199254740991');
  const result = await createGcsStorage(f.bucket).read(PAGE, { maxBytes: BODY.length });
  assert.deepEqual(result, { bytes: BODY, version: '9007199254740991' });
  const stream = f.calls.find(({ method }) => method === 'stream');
  assert.deepEqual(stream.fileOptions, { generation: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(stream.options, { decompress: false, validation: 'crc32c' });
  assert.equal(f.calls.filter(({ method }) => method === 'metadata').length, 1);
  assert.deepEqual(f.forbidden, []);
  result.bytes[0] = 0;
  assert.deepEqual(f.objects.get(PAGE).bytes, BODY);
});

test('only actual metadata 404 returns null; other status and message lookalikes remain errors', async () => {
  const f = fakeBucket();
  const adapter = createGcsStorage(f.bucket);
  assert.equal(await adapter.read(PAGE, { maxBytes: 512 }), null);
  assert.equal(f.streams.length, 0);
  for (const cause of [httpError(403), httpError(429), httpError(500), httpError('404'), Error('404')]) {
    f.hooks.metadataError = cause;
    await rejects(adapter.read(PAGE, { maxBytes: 512 }), 'METADATA_READ');
  }
});

test('overwrite after metadata returns only the inspected old version, never newly labelled bytes', async () => {
  const f = fakeBucket();
  const old = f.put(PAGE, BODY);
  f.hooks.metadata = () => f.put(PAGE, Buffer.from('{"different":true}'));
  const result = await createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 });
  assert.equal(result.version, old.version);
  assert.deepEqual(result.bytes, BODY);
  assert.notEqual(f.objects.get(PAGE).version, result.version);
});

test('generation lost between metadata and stream is an error, not missing-current or a live-version fallback', async () => {
  const f = fakeBucket();
  const old = f.put(PAGE, BODY);
  f.hooks.metadata = () => {
    f.put(PAGE, Buffer.from('{"different":true}'));
    f.generations.delete(`${PAGE}@${old.version}`);
  };
  await rejects(createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 }), 'READ_STREAM');
  assert.equal(f.calls.filter(({ method }) => method === 'stream').length, 1);
});

test('unsafe, numeric, zero or noncanonical generations reject before any stream', async () => {
  for (const version of ['9007199254740992', '9007199254740993', '18446744073709551615', '0', '01',
    '-1', '+1', '1e3', '1.0', '1\n', '', 101, null, undefined]) {
    const f = fakeBucket(); f.put(PAGE, BODY);
    f.hooks.metadata = (metadata) => { metadata.generation = version; };
    await rejects(createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 }), 'GENERATION');
    assert.equal(f.streams.length, 0);
  }
});

test('oversized, zero or malformed metadata size rejects before streaming or buffering the object', async () => {
  for (const size of ['0', '513', '9999999', '-1', '01', '2\n', 17, undefined]) {
    const f = fakeBucket(); f.put(PAGE, BODY);
    f.hooks.metadata = (metadata) => { metadata.size = size; };
    await rejects(createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 }), 'SIZE');
    assert.equal(f.streams.length, 0);
  }
});

test('metadata identity, compression and checksum shape must be exact before stream start', async () => {
  for (const mutate of [
    (m) => { m.name = POINTER; }, (m) => { delete m.name; },
    (m) => { m.contentEncoding = 'gzip'; }, (m) => { m.contentEncoding = null; },
    (m) => { delete m.crc32c; }, (m) => { m.crc32c = 'AAAAAB=='; },
    (m) => { m.crc32c = 'AAAAAA==\n'; },
  ]) {
    const f = fakeBucket(); f.put(PAGE, BODY); f.hooks.metadata = mutate;
    await rejects(createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 }), 'METADATA');
    assert.equal(f.streams.length, 0);
  }
});

test('retry policy is rechecked after metadata await before starting the pinned stream', async () => {
  const f = fakeBucket(); f.put(PAGE, BODY);
  f.hooks.metadata = () => { f.bucket.storage.retryOptions.autoRetry = true; };
  await rejects(createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 }), 'RETRY_POLICY');
  assert.equal(f.streams.length, 0);
});

test('changed response generation, length, encoding, checksum or non-200 response destroys the stream', async () => {
  for (const mutate of [
    (r) => { r.statusCode = 206; }, (r) => { r.statusCode = 404; }, (r) => { r.statusCode = 412; },
    (r) => { r.headers['x-goog-generation'] = '102'; },
    (r) => { r.headers['content-length'] = String(BODY.length + 1); },
    (r) => { r.headers['content-length'] = BODY.length; },
    (r) => { r.headers['content-encoding'] = 'gzip'; },
    (r) => { r.headers['x-goog-stored-content-encoding'] = 'gzip'; },
    (r) => { delete r.headers['x-goog-stored-content-encoding']; },
    (r) => { r.headers['x-goog-stored-content-length'] = '999'; },
    (r) => { r.headers['x-goog-hash'] = 'md5=other'; },
    (r) => { r.headers['x-goog-hash'] = 'crc32c=AAAAAA==,crc32c=AAAAAA=='; },
  ]) {
    const f = fakeBucket(); f.put(PAGE, BODY); f.hooks.response = mutate;
    await rejects(createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 }), 'READ_RESPONSE');
    assert.equal(f.streams[0].destroyed, true);
  }
});

test('running byte limit rejects a single oversized chunk or cumulative overflow, never truncates', async () => {
  for (const chunks of [[Buffer.alloc(513)], [BODY, Buffer.from('x')], [BODY.subarray(0, 8), Buffer.alloc(BODY.length - 7)]]) {
    const f = fakeBucket(); f.put(PAGE, BODY); f.hooks.chunks = chunks;
    await rejects(createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 }), 'BODY_LIMIT');
    assert.equal(f.streams[0].destroyed, true);
  }
});

test('arbitrary chunk boundaries succeed only at exact declared EOF', async () => {
  const f = fakeBucket(); f.put(PAGE, BODY);
  f.hooks.chunks = [BODY.subarray(0, 1), BODY.subarray(1, 7), BODY.subarray(7)];
  assert.deepEqual((await createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 })).bytes, BODY);
  f.hooks.chunks = [BODY.subarray(0, BODY.length - 1)];
  await rejects(createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 }), 'READ_INCOMPLETE');
});

test('SDK errors, premature close, missing and duplicate response events never yield partial success', async () => {
  for (const [hook, value, code] of [
    ['streamError', httpError('CONTENT_DOWNLOAD_MISMATCH'), 'READ_STREAM'],
    ['closeEarly', true, 'READ_INCOMPLETE'], ['omitResponse', true, 'READ_RESPONSE'],
    ['repeatResponse', true, 'READ_RESPONSE'],
  ]) {
    const f = fakeBucket(); f.put(PAGE, BODY); f.hooks[hook] = value;
    await rejects(createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 }), code);
  }
});

test('a stalled media stream has a fixed finite deadline and is destroyed without fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fakeBucket(); f.put(PAGE, BODY); f.hooks.hang = true;
  const pending = createGcsStorage(f.bucket).read(PAGE, { maxBytes: 512 });
  const checked = rejects(pending, 'READ_TIMEOUT');
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(GCS_POLICY.readStreamTimeoutMs);
  await checked;
  assert.equal(f.streams[0].destroyed, true);
});

test('whitelisted paths, operation types and per-kind limits reject before Bucket.file', async () => {
  const f = fakeBucket(); const adapter = createGcsStorage(f.bucket);
  for (const path of ['users/u/private', 'https://storage.googleapis.com/x', 'gs://bucket/x',
    `${ROOT}/../current.json`, `${ROOT}/pages/00.json`, `${ROOT}/pages/1000.json`,
    `${ROOT}/pages/-1.json`, `${PAGE}\n`, PAGE.replace('/a', '/A'), `${ROOT}/pages/0.json?alt=media`]) {
    await rejects(adapter.read(path, { maxBytes: 512 }), 'PATH');
    await rejects(adapter.createIfAbsent(path, BODY), 'PATH');
    await rejects(adapter.compareAndSwap(path, null, BODY), 'PATH');
  }
  await rejects(adapter.createIfAbsent(POINTER, BODY), 'WRITE_PATH');
  await rejects(adapter.compareAndSwap(PAGE, null, BODY), 'WRITE_PATH');
  for (const options of [{}, { maxBytes: 0 }, { maxBytes: -1 }, { maxBytes: 1.5 },
    { maxBytes: LIMITS.pageBytes + 1 }, { maxBytes: 512, extra: true }, { maxBytes: '512' }]) {
    await rejects(adapter.read(PAGE, options), 'READ_LIMIT');
  }
  await rejects(adapter.read(POINTER, { maxBytes: 513 }), 'READ_LIMIT');
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(LIMITS.pageBytes + 1), 'text', null]) {
    await rejects(adapter.createIfAbsent(PAGE, bytes), 'BODY_LIMIT');
  }
  await rejects(adapter.compareAndSwap(POINTER, null, Buffer.alloc(513)), 'BODY_LIMIT');
  assert.deepEqual(f.calls, []);
});

test('immutable create uses exact conditional simple upload options and server MD5, without SDK delete access', async () => {
  const f = fakeBucket(); const adapter = createGcsStorage(f.bucket);
  assert.equal(await adapter.createIfAbsent(PAGE, BODY), true);
  assert.equal(await adapter.createIfAbsent(PAGE, Buffer.from('{}')), false);
  assert.deepEqual(f.objects.get(PAGE).bytes, BODY);
  const saves = f.calls.filter(({ method }) => method === 'save');
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[0].options, {
    resumable: false, gzip: false, validation: false, timeout: GCS_POLICY.writeTimeoutMs,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store', md5Hash: md5(BODY) },
  });
  assert.deepEqual(f.forbidden, []);
  assert.equal(f.bucket.storage.retryOptions.autoRetry, false);
});

test('pointer CAS uses zero only for missing and exact generation strings for existing state', async () => {
  const f = fakeBucket(); const adapter = createGcsStorage(f.bucket);
  assert.equal(await adapter.compareAndSwap(POINTER, null, BODY), true);
  const old = f.objects.get(POINTER);
  assert.equal(await adapter.compareAndSwap(POINTER, null, Buffer.from('{}')), false);
  assert.equal(await adapter.compareAndSwap(POINTER, old.version, Buffer.from('{}')), true);
  assert.equal(await adapter.compareAndSwap(POINTER, old.version, BODY), false);
  const expected = f.calls.filter(({ method }) => method === 'save').map(({ options }) => options.preconditionOpts.ifGenerationMatch);
  assert.deepEqual(expected, [0, 0, old.version, old.version]);
  assert.deepEqual(f.forbidden, []);
});

test('invalid or unsafe CAS versions never reach the SDK', async () => {
  const f = fakeBucket(); const adapter = createGcsStorage(f.bucket);
  for (const value of [undefined, 1, '', '0', '01', '1\n', '9007199254740992', '18446744073709551615']) {
    await rejects(adapter.compareAndSwap(POINTER, value, BODY), 'GENERATION');
  }
  assert.deepEqual(f.calls, []);
});

test('only numeric SDK 412 is known false; every ambiguous write error throws with no retry or delete', async () => {
  for (const cause of [httpError('412'), httpError(400), httpError(403), httpError(429), httpError(500),
    httpError('ETIMEDOUT'), httpError('FILE_NO_UPLOAD'), Error('412 Precondition Failed')]) {
    for (const pointer of [false, true]) {
      const f = fakeBucket(); f.hooks.saveError = cause;
      const adapter = createGcsStorage(f.bucket);
      await rejects(pointer ? adapter.compareAndSwap(POINTER, null, BODY) : adapter.createIfAbsent(PAGE, BODY), 'WRITE_OUTCOME_UNKNOWN');
      assert.equal(f.calls.filter(({ method }) => method === 'save').length, 1);
      assert.deepEqual(f.forbidden, []);
      assert.equal(f.objects.size, 0);
    }
  }
});

test('a lost success response reports unknown while preserving the possibly committed object', async () => {
  const f = fakeBucket(); f.hooks.afterCommitError = httpError('ECONNRESET');
  const adapter = createGcsStorage(f.bucket);
  await rejects(adapter.compareAndSwap(POINTER, null, BODY), 'WRITE_OUTCOME_UNKNOWN');
  assert.deepEqual(f.objects.get(POINTER).bytes, BODY);
  assert.equal(f.calls.filter(({ method }) => method === 'save').length, 1);
  assert.deepEqual(f.forbidden, []);
});

test('snapshot-store composes with adapter: exact publish/read and a transport error never masquerades as CAS conflict', async () => {
  const value = buildSnapshot({ sourceTimestamp: '2026-10-04T01:00:00Z', catalogSourceTimestamp: '2026-10-04T01:00:00Z',
    records: [{ productId: '1', categoryId: '51', expansionId: null, metacardId: null, name: 'Synthetic',
      normal: { average: '1', low: null, trend: '3', average1: '4', average7: '5', average30: '6' },
      reverse: { average: '7', low: '8', trend: '9' } }] });
  const f = fakeBucket(); const adapter = createGcsStorage(f.bucket);
  assert.equal((await publishSnapshot(adapter, value)).status, 'ACTIVATED');
  assert.deepEqual(await readCurrentSnapshot(adapter), value);
  assert.deepEqual(f.forbidden, []);
  const failed = fakeBucket();
  const originalFile = failed.bucket.file;
  failed.bucket.file = (path, options) => {
    const file = originalFile(path, options);
    if (path !== POINTER) return file;
    return { getMetadata: file.getMetadata, createReadStream: file.createReadStream,
      save: async (...args) => { await file.save(...args); throw httpError('ECONNRESET'); } };
  };
  const failedAdapter = createGcsStorage(failed.bucket);
  await assert.rejects(publishSnapshot(failedAdapter, value), /MARKET_SNAPSHOT_ACTIVATION_OUTCOME_UNKNOWN/);
  assert.deepEqual(await readCurrentSnapshot(failedAdapter), value);
  assert.deepEqual(failed.forbidden, []);
});

test('admission is an exact CAS-only 4KiB path with immutable pointer and generation limits', async () => {
  const f = fakeBucket(); const adapter = createGcsStorage(f.bucket);
  const path = ADMISSION_POLICY.path;
  for (const invalid of [`${path}\n`, `${path}/extra`, path.replace('admission', 'Admission'),
    `${STORE_POLICY.namespace}/other.json`, `${ROOT}/admission.json`]) {
    await rejects(adapter.read(invalid, { maxBytes: 4096 }), 'PATH');
    await rejects(adapter.compareAndSwap(invalid, null, BODY), 'PATH');
    await rejects(adapter.createIfAbsent(invalid, BODY), 'PATH');
  }
  await rejects(adapter.createIfAbsent(path, BODY), 'WRITE_PATH');
  await rejects(adapter.read(path, { maxBytes: 4097 }), 'READ_LIMIT');
  await rejects(adapter.compareAndSwap(path, null, Buffer.alloc(4097)), 'BODY_LIMIT');
  await rejects(adapter.compareAndSwap(path, null, Buffer.alloc(0)), 'BODY_LIMIT');
  await rejects(adapter.compareAndSwap(POINTER, null, Buffer.alloc(513)), 'BODY_LIMIT');
  await rejects(adapter.compareAndSwap(PAGE, null, BODY), 'WRITE_PATH');
  assert.deepEqual(f.calls, []);
  const full = Buffer.alloc(4096, 32);
  assert.equal(await adapter.compareAndSwap(path, null, full), true);
  const first = f.objects.get(path).version;
  assert.deepEqual(await adapter.read(path, { maxBytes: 4096 }), { bytes: full, version: first });
  assert.equal(await adapter.compareAndSwap(path, null, BODY), false);
  assert.equal(await adapter.compareAndSwap(path, first, BODY), true);
  assert.equal(await adapter.compareAndSwap(path, first, full), false);
  assert.deepEqual(f.calls.filter(({ method }) => method === 'save').map(({ options }) => options.preconditionOpts.ifGenerationMatch),
    [0, 0, first, first]);
  assert.deepEqual(f.forbidden, []);
});

test('admission read enforces metadata and running byte limits without delete or fallback', async () => {
  for (const mode of ['metadata', 'stream']) {
    const f = fakeBucket(); const adapter = createGcsStorage(f.bucket);
    f.put(ADMISSION_POLICY.path, Buffer.alloc(mode === 'metadata' ? 4097 : 4096, 32));
    if (mode === 'stream') f.hooks.chunks = [Buffer.alloc(4096, 32), Buffer.from('x')];
    await rejects(adapter.read(ADMISSION_POLICY.path, { maxBytes: 4096 }), mode === 'metadata' ? 'SIZE' : 'BODY_LIMIT');
    assert.equal(f.streams.length, mode === 'metadata' ? 0 : 1);
    assert.deepEqual(f.forbidden, []);
  }
});

test('admitted publisher composes with GCS adapter and ambiguous admission prevents every immutable upload', async () => {
  const value = buildSnapshot({ sourceTimestamp: '2026-10-04T01:00:00Z', catalogSourceTimestamp: '2026-10-04T01:00:00Z',
    records: [{ productId: '1', categoryId: '51', expansionId: null, metacardId: null, name: 'Synthetic admission',
      normal: { average: '1', low: null, trend: '3', average1: '4', average7: '5', average30: '6' },
      reverse: { average: '7', low: '8', trend: '9' } }] });
  const options = { attemptToken: 'a'.repeat(32) };
  const good = fakeBucket(); const adapter = createGcsStorage(good.bucket);
  assert.equal((await publishAdmittedSnapshot(adapter, value, options)).status, 'ACTIVATED');
  const saves = good.calls.filter(({ method }) => method === 'save');
  assert.equal(saves[0].path, ADMISSION_POLICY.path);
  assert.equal(saves.at(-1).path, POINTER);
  const reserved = JSON.parse(good.objects.get(ADMISSION_POLICY.path).bytes).reservations[0];
  assert.equal(reserved.wireBytes, saves.filter(({ path }) => path !== ADMISSION_POLICY.path && path !== POINTER)
    .reduce((sum, { bytes }) => sum + bytes.length, 0));
  assert.deepEqual(await readCurrentSnapshot(adapter), value);
  assert.deepEqual(good.forbidden, []);
  const failed = fakeBucket(); failed.hooks.afterCommitError = httpError('ETIMEDOUT');
  await assert.rejects(publishAdmittedSnapshot(createGcsStorage(failed.bucket), value, options), /MARKET_ADMISSION_CAS_OUTCOME_UNKNOWN/);
  assert.deepEqual([...failed.objects.keys()], [ADMISSION_POLICY.path]);
  assert.equal(failed.calls.filter(({ method }) => method === 'save').length, 1);
  assert.deepEqual(failed.forbidden, []);
});
