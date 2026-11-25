import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Storage, CRC32C } from '@google-cloud/storage';
import { createGcsStorage } from './gcs-storage.mjs';
import { STORE_POLICY } from './snapshot-store.mjs';

// Actual installed SDK + real loopback HTTP, not a Bucket/File/transport mock.
// This proves this SDK's local transport behavior, NOT GCS IAM/server behavior,
// ADC/authentication, Linux deployment or a whole-operation/auth time bound.
const PROJECT = 'demo-market-data-loopback';
const BUCKET = 'demo-market-data-loopback-bucket';
const PAGE = `${STORE_POLICY.namespace}/generations/${'a'.repeat(64)}/pages/0.json`;
const POINTER = STORE_POLICY.pointerPath;
const BODY = Buffer.from('{"synthetic":"Grüße","value":1}');
const FORBIDDEN_ENV = ['STORAGE_EMULATOR_HOST', 'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY',
  'https_proxy', 'ALL_PROXY', 'all_proxy'];
const digest = (bytes) => createHash('md5').update(bytes).digest('base64');
const crc = (bytes) => { const result = new CRC32C(); result.update(bytes); return result.toString(); };

function assertNoEndpointOverrides() {
  // Presence only: no credential/proxy values are read, printed, changed or cleared.
  for (const key of FORBIDDEN_ENV) assert.equal(Object.hasOwn(process.env, key), false, `unsupported loopback environment key: ${key}`);
}

function multipart(contentType, body) {
  const match = /^multipart\/related; boundary=([A-Za-z0-9-]+)$/.exec(contentType ?? '');
  assert.ok(match, 'real SDK must send the documented multipart upload');
  const parts = body.toString('latin1').split(`--${match[1]}`);
  assert.equal(parts.length, 4);
  assert.equal(parts[0], '');
  assert.match(parts[3], /^--\r?\n?$/);
  const decoded = parts.slice(1, 3).map((part) => {
    assert.ok(part.startsWith('\r\n') && part.endsWith('\r\n'));
    const split = part.indexOf('\r\n\r\n');
    assert.ok(split > 2);
    return { headers: part.slice(2, split), body: Buffer.from(part.slice(split + 4, -2), 'latin1') };
  });
  assert.match(decoded[0].headers, /^Content-Type: application\/json$/i);
  assert.match(decoded[1].headers, /^Content-Type: application\/json; charset=utf-8$/i);
  return { metadata: JSON.parse(decoded[0].body.toString('utf8')), bytes: decoded[1].body };
}

async function fixture(t, { timeout = 2000 } = {}) {
  assertNoEndpointOverrides();
  const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.resolve('@google-cloud/storage')), 'utf8')).version;
  assert.equal(version, '7.22.0', 'SDK source-reviewed version must not silently change');
  const environmentKeys = Object.keys(process.env).sort();
  const globals = { fetch: globalThis.fetch, httpAgent: http.globalAgent, httpsAgent: https.globalAgent };
  const requests = [];
  const failures = [];
  const intercepted = [];
  const authAttempts = [];
  const objects = new Map();
  const versions = new Map();
  const sockets = new Set();
  const hooks = {};
  let counter = 100n;
  let origin;
  const put = (name, bytes) => {
    const value = { name, bytes: Buffer.from(bytes), generation: String(++counter) };
    objects.set(name, value);
    versions.set(`${name}@${value.generation}`, value);
    return value;
  };
  const metadata = (value) => ({ name: value.name, bucket: BUCKET, generation: value.generation,
    size: String(value.bytes.length), contentType: 'application/json; charset=utf-8',
    crc32c: crc(value.bytes), md5Hash: digest(value.bytes) });
  const json = (response, status, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length });
    response.end(bytes);
  };
  const reject = (response, code, reason) => json(response, code,
    { error: { code, message: reason, errors: [{ domain: 'global', reason, message: reason }] } });
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.socket.remoteAddress, '127.0.0.1');
      assert.equal(request.headers.host, new URL(origin).host);
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers['proxy-authorization'], undefined);
      assert.match(request.headers['x-goog-api-client'] ?? '', /\bgccl\/7\.22\.0\b/);
      const url = new URL(request.url, origin);
      assert.equal(url.origin, origin);
      const receipt = { method: request.method, pathname: url.pathname, query: Object.fromEntries(url.searchParams) };
      requests.push(receipt);
      assert.notEqual(request.method, 'DELETE', 'SDK must never issue hidden checksum-cleanup DELETE');
      const objectPrefix = `/storage/v1/b/${BUCKET}/o/`;
      if (request.method === 'GET' && url.pathname.startsWith(objectPrefix)) {
        const name = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        assert.ok(name === PAGE || name === POINTER);
        receipt.name = name;
        if (url.searchParams.get('alt') === 'media') {
          assert.deepEqual([...url.searchParams.keys()].sort(), ['alt', 'generation']);
          const value = versions.get(`${name}@${url.searchParams.get('generation')}`);
          if (!value) { reject(response, 404, 'notFound'); return; }
          let bytes = Buffer.from(value.bytes);
          if (hooks.corruptMedia) bytes[0] ^= 1;
          const headers = {
            'content-type': 'application/json; charset=utf-8', 'content-length': String(bytes.length),
            'x-goog-generation': value.generation, 'x-goog-stored-content-length': String(value.bytes.length),
            'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': `crc32c=${crc(value.bytes)},md5=${digest(value.bytes)}`,
          };
          if (hooks.hangMedia) return;
          response.writeHead(200, headers);
          response.end(bytes);
          return;
        }
        assert.deepEqual([...url.searchParams.keys()], []);
        if (hooks.hangMetadata) return;
        const value = objects.get(name);
        if (!value) { reject(response, 404, 'notFound'); return; }
        const result = metadata(value);
        hooks.afterMetadata?.(value);
        json(response, 200, result);
        return;
      }
      if (request.method === 'POST' && url.pathname === `/upload/storage/v1/b/${BUCKET}/o`) {
        assert.deepEqual([...url.searchParams.keys()].sort(), ['ifGenerationMatch', 'name', 'uploadType']);
        assert.equal(url.searchParams.get('uploadType'), 'multipart');
        const name = url.searchParams.get('name');
        assert.ok(name === PAGE || name === POINTER);
        receipt.name = name;
        let length = 0;
        const chunks = [];
        for await (const chunk of request) {
          length += chunk.length;
          assert.ok(length <= 320 * 1024, 'loopback upload has its own finite input cap');
          chunks.push(chunk);
        }
        const parsed = multipart(request.headers['content-type'], Buffer.concat(chunks));
        receipt.upload = parsed;
        assert.equal(parsed.metadata.contentType, 'application/json; charset=utf-8');
        assert.equal(parsed.metadata.cacheControl, 'no-store');
        assert.equal(parsed.metadata.contentEncoding, undefined);
        assert.equal(parsed.metadata.md5Hash, digest(parsed.bytes));
        assert.deepEqual(Object.keys(parsed.metadata).sort(), ['cacheControl', 'contentType', 'md5Hash']);
        if (hooks.hangUpload) return;
        const expected = url.searchParams.get('ifGenerationMatch');
        const current = objects.get(name);
        if ((expected === '0' && current) || (expected !== '0' && current?.generation !== expected)) {
          reject(response, 412, 'conditionNotMet'); return;
        }
        const serverBytes = Buffer.from(parsed.bytes);
        if (hooks.corruptUpload) serverBytes[0] ^= 1;
        if (digest(serverBytes) !== parsed.metadata.md5Hash) { reject(response, 400, 'md5HashMismatch'); return; }
        const saved = put(name, serverBytes);
        const result = metadata(saved);
        if (hooks.corruptUploadResponseHashes) { result.crc32c = 'AAAAAA=='; result.md5Hash = 'AAAAAAAAAAAAAAAAAAAAAA=='; }
        json(response, 200, result);
        return;
      }
      assert.fail('unexpected loopback SDK request');
    } catch (failure) {
      failures.push(failure);
      if (!response.headersSent) reject(response, 500, 'loopbackAssertion');
      else response.destroy();
    }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let storage;
  let clientPolicy;
  t.after(async () => {
    // Only this fixture's owned ephemeral server/sockets; no process/global stop.
    const closed = new Promise((resolve, rejectClose) => server.close((failure) => failure ? rejectClose(failure) : resolve()));
    for (const socket of sockets) socket.destroy();
    await closed;
    assert.deepEqual(failures, []);
    assert.deepEqual(authAttempts, []);
    assertNoEndpointOverrides();
    assert.deepEqual(Object.keys(process.env).sort(), environmentKeys);
    assert.equal(globalThis.fetch, globals.fetch);
    assert.equal(http.globalAgent, globals.httpAgent);
    assert.equal(https.globalAgent, globals.httpsAgent);
    if (clientPolicy) {
      assert.equal(storage.timeout, clientPolicy.timeout);
      assert.deepEqual(storage.retryOptions, clientPolicy.retryOptions);
    }
    assert.equal(requests.some(({ method }) => method === 'DELETE'), false);
    assert.equal(intercepted.every((entry) => entry.origin === origin && entry.timeout === timeout), true);
    assert.equal(intercepted.length, requests.length, 'no missing/external or automatically retried SDK requests');
  });
  const address = server.address();
  assert.equal(address.address, '127.0.0.1');
  assert.equal(address.family, 'IPv4');
  origin = `http://127.0.0.1:${address.port}`;
  storage = new Storage({ projectId: PROJECT, apiEndpoint: origin,
    useAuthWithCustomEndpoint: false, retryOptions: { autoRetry: false }, timeout });
  assert.equal(storage.apiEndpoint, origin);
  assert.equal(storage.baseUrl, `${origin}/storage/v1`);
  assert.equal(storage.customEndpoint, true);
  assert.equal(storage.useAuthWithCustomEndpoint, false);
  assert.equal(storage.projectId, PROJECT);
  clientPolicy = { timeout: storage.timeout, retryOptions: { ...storage.retryOptions } };
  // These instance-only deny guards do not fake authentication. Authentication is
  // explicitly disabled for this endpoint; an unexpected attempt fails BEFORE
  // ADC, key-file, token or metadata-server access. No global prototype is patched.
  for (const name of ['authorizeRequest', 'getProjectId', 'getClient', 'getApplicationDefault', 'getCredentials', 'getAccessToken']) {
    Object.defineProperty(storage.authClient, name, { configurable: true, value() {
      authAttempts.push(name);
      throw Error(`unexpected auth operation: ${name}`);
    } });
  }
  storage.interceptors.push({ request(options) {
    assertNoEndpointOverrides();
    const target = new URL(options.uri);
    assert.equal(target.origin, origin, 'deny any non-loopback SDK destination before auth/transport');
    assert.ok(target.pathname.startsWith(`/storage/v1/b/${BUCKET}/o/`) ||
      target.pathname === `/upload/storage/v1/b/${BUCKET}/o`);
    assert.equal(options.headers?.Authorization, undefined);
    assert.equal(options.headers?.authorization, undefined);
    intercepted.push({ method: options.method ?? 'GET', origin: target.origin, timeout: options.timeout });
    return options;
  } });
  const bucket = storage.bucket(BUCKET);
  return { adapter: createGcsStorage(bucket), bucket, put, objects, versions, requests, hooks };
}

test('actual SDK metadata, pinned generation stream and CRC32C return exact owned bytes without auth', { timeout: 10_000 }, async (t) => {
  assert.equal(crc(Buffer.from('123456789')), '4waSgw==', 'published CRC32C check vector');
  const f = await fixture(t);
  const old = f.put(PAGE, BODY);
  f.hooks.afterMetadata = () => f.put(PAGE, Buffer.from('{"new":true}'));
  assert.deepEqual(await f.adapter.read(PAGE, { maxBytes: 512 }), { bytes: BODY, version: old.generation });
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[1].query, { alt: 'media', generation: old.generation });
  assert.notEqual(f.objects.get(PAGE).generation, old.generation);
});

test('actual SDK metadata 404 is null, but a vanished pinned generation is an error without relisten', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  assert.equal(await f.adapter.read(PAGE, { maxBytes: 512 }), null);
  const old = f.put(PAGE, BODY);
  f.hooks.afterMetadata = () => { f.put(PAGE, BODY); f.versions.delete(`${PAGE}@${old.generation}`); };
  await assert.rejects(f.adapter.read(PAGE, { maxBytes: 512 }), /MARKET_GCS_READ_(?:RESPONSE|STREAM)/);
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests.at(-1).query.generation, old.generation);
});

test('actual SDK multipart sends server-checkable MD5 and exact create/CAS generation preconditions with real 412', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  assert.equal(await f.adapter.createIfAbsent(PAGE, BODY), true);
  assert.equal(await f.adapter.createIfAbsent(PAGE, Buffer.from('{}')), false);
  assert.deepEqual(f.objects.get(PAGE).bytes, BODY);
  assert.equal(await f.adapter.compareAndSwap(POINTER, null, BODY), true);
  const first = f.objects.get(POINTER).generation;
  assert.equal(await f.adapter.compareAndSwap(POINTER, first, Buffer.from('{}')), true);
  assert.equal(await f.adapter.compareAndSwap(POINTER, first, BODY), false);
  assert.deepEqual(f.requests.map(({ query }) => query.ifGenerationMatch), ['0', '0', '0', first, first]);
  assert.deepEqual(f.requests[0].upload.bytes, BODY);
  assert.equal(f.requests[0].upload.metadata.md5Hash, digest(BODY));
  assert.equal(f.requests.length, 5);
});

test('actual SDK CRC32C rejects same-length corrupted media and issues no DELETE', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const old = f.put(PAGE, BODY);
  f.hooks.corruptMedia = true;
  // Observe the real SDK error separately, then prove adapter propagation. No
  // File method is stubbed and the body has the correct size/generation headers.
  const stream = f.bucket.file(PAGE, { generation: Number(old.generation) })
    .createReadStream({ decompress: false, validation: 'crc32c' });
  const sdkFailure = new Promise((resolve, reject) => {
    stream.on('data', () => {});
    stream.on('error', resolve);
    stream.on('end', () => reject(Error('corrupt SDK stream unexpectedly ended successfully')));
  });
  assert.equal((await sdkFailure).code, 'CONTENT_DOWNLOAD_MISMATCH');
  await assert.rejects(f.adapter.read(PAGE, { maxBytes: 512 }), /MARKET_GCS_READ_STREAM/);
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.objects.get(PAGE).bytes, BODY);
});

test('actual SDK checksum-rejected upload stays unknown, and disabled client validation never deletes on response mismatch', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  f.hooks.corruptUpload = true;
  await assert.rejects(f.adapter.createIfAbsent(PAGE, BODY), /MARKET_GCS_WRITE_OUTCOME_UNKNOWN/);
  assert.equal(f.objects.has(PAGE), false);
  f.hooks.corruptUpload = false;
  f.hooks.corruptUploadResponseHashes = true;
  assert.equal(await f.adapter.createIfAbsent(PAGE, BODY), true);
  assert.deepEqual(f.objects.get(PAGE).bytes, BODY);
  assert.deepEqual((await f.adapter.read(PAGE, { maxBytes: 512 })).bytes, BODY);
  assert.equal(f.requests.length, 4);
});

test('actual SDK honors dedicated HTTP timeout for metadata and write without retry or DELETE', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, { timeout: 150 });
  f.put(PAGE, BODY);
  f.hooks.hangMetadata = true;
  const startRead = performance.now();
  await assert.rejects(f.adapter.read(PAGE, { maxBytes: 512 }), /MARKET_GCS_METADATA_READ/);
  assert.ok(performance.now() - startRead < 5000, 'real HTTP read must not wait for adapter stream deadline');
  f.hooks.hangMetadata = false;
  f.hooks.hangUpload = true;
  const startWrite = performance.now();
  await assert.rejects(f.adapter.compareAndSwap(POINTER, null, BODY), /MARKET_GCS_WRITE_OUTCOME_UNKNOWN/);
  assert.ok(performance.now() - startWrite < 5000, 'real HTTP write must respect dedicated client timeout');
  assert.equal(f.objects.has(POINTER), false, 'loopback intentionally never committed, not a general timeout guarantee');
  assert.equal(f.requests.length, 2);
});

test('actual metadata byte budget rejects an oversized object before any media request', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  f.put(PAGE, Buffer.alloc(513, 32));
  await assert.rejects(f.adapter.read(PAGE, { maxBytes: 512 }), /MARKET_GCS_SIZE/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].query.alt, undefined);
});
