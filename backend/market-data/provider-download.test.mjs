import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { downloadProviderFile, downloadProviderSnapshot, PROVIDER_URLS, DOWNLOAD_POLICY } from './provider-download.mjs';

// Real loopback HTTP transport. The test-only request seam checks the exact
// production HTTPS URL/options before mapping it to one ephemeral local server.
// No DNS, provider, proxy, credentials, environment mutation or Cloud access.
async function fixture(t, handler) {
  const requests = [];
  const closedSockets = [];
  const server = createServer((req, res) => {
    requests.push({ path: req.url, method: req.method, headers: req.headers });
    handler(req, res);
  });
  server.on('connection', (socket) => closedSockets.push(new Promise((resolve) => socket.once('close', resolve))));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const req of requests) {
      assert.equal(req.method, 'GET');
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, undefined);
      assert.equal(req.headers['accept-encoding'], 'identity');
    }
  });
  const options = { request(url, config) {
    assert.ok(Object.values(PROVIDER_URLS).includes(url));
    assert.deepEqual(config, { method: 'GET', agent: false, rejectUnauthorized: true,
      maxHeaderSize: DOWNLOAD_POLICY.headerBytes,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' } });
    return httpRequest({ ...config, hostname: '127.0.0.1', port, path: new URL(url).pathname });
  } };
  const assertSocketsClosed = async () => {
    assert.ok(closedSockets.length > 0, 'must observe a real connected socket');
    let timer;
    try {
      await Promise.race([Promise.all(closedSockets), new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(Error('download left its real socket open')), 2000);
      })]);
    } finally { clearTimeout(timer); }
  };
  return { options, requests, assertSocketsClosed };
}
const send = (res, body, headers = {}) => {
  res.writeHead(200, { 'Content-Type': 'application/json', ...headers });
  res.end(body);
};
const body = Buffer.from('{"only":"fixture"}');

test('complete fixed-source body and immutable receipt preserve exact bytes', async (t) => {
  const { options, requests } = await fixture(t, (_req, res) => send(res, body, { 'Content-Length': String(body.length) }));
  const result = await downloadProviderFile('products', options);
  assert.deepEqual(result.bytes, body);
  assert.deepEqual(result.receipt, { kind: 'products', url: PROVIDER_URLS.products, bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex') });
  assert.ok(Object.isFrozen(result.receipt));
  assert.equal(requests.length, 1);
});

test('bounded chunked identity response is accepted without declared length', async (t) => {
  const { options } = await fixture(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.write(body.subarray(0, 4)); res.end(body.subarray(4)); });
  assert.deepEqual((await downloadProviderFile('prices', { ...options, maxBytes: body.length })).bytes, body);
});

for (const status of [204, 301, 302, 307, 404, 429, 500]) {
  test(`HTTP ${status} does not redirect, retry or return partial truth`, async (t) => {
    const { options, requests } = await fixture(t, (_req, res) => { res.writeHead(status, { Location: 'https://outside.invalid/secret' }); res.end('private upstream message'); });
    await assert.rejects(downloadProviderFile('prices', options), /^Error: MARKET_DOWNLOAD_STATUS$/);
    assert.equal(requests.length, 1);
  });
}

test('declared oversize rejected before buffering; actual chunked oversize rejected', async (t) => {
  let declared = true;
  const { options } = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', ...(declared ? { 'Content-Length': '10000' } : {}) });
    res.write(body); res.end();
  });
  await assert.rejects(downloadProviderFile('prices', { ...options, maxBytes: 8 }), /MARKET_DOWNLOAD_LENGTH/);
  declared = false;
  await assert.rejects(downloadProviderFile('prices', { ...options, maxBytes: 8 }), /MARKET_DOWNLOAD_BODY_LIMIT/);
});

test('compressed content is rejected without decoding', async (t) => {
  const { options } = await fixture(t, (_req, res) => send(res, body, { 'Content-Encoding': 'gzip' }));
  await assert.rejects(downloadProviderFile('products', options), /MARKET_DOWNLOAD_ENCODING/);
});

test('HTML errors, even HTTP200, are rejected', async (t) => {
  const { options } = await fixture(t, (_req, res) => send(res, body, { 'Content-Type': 'text/html' }));
  await assert.rejects(downloadProviderFile('products', options), /MARKET_DOWNLOAD_CONTENT_TYPE/);
});

test('empty and truncated responses are not usable source files', async (t) => {
  let truncate = false;
  const { options } = await fixture(t, (_req, res) => {
    if (!truncate) { send(res, ''); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '9999' });
    res.write(body); res.end();
  });
  await assert.rejects(downloadProviderFile('products', options), /MARKET_DOWNLOAD_(INCOMPLETE|LENGTH)/);
  truncate = true;
  await assert.rejects(downloadProviderFile('products', { ...options, idleMs: 100 }), /MARKET_DOWNLOAD_(INCOMPLETE|IDLE|RESPONSE)/);
});

test('absolute deadline destroys a real stalled response and does not retry', async (t) => {
  const { options, requests, assertSocketsClosed } = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{');
  });
  await assert.rejects(downloadProviderFile('products', { ...options, deadlineMs: 150, idleMs: 1000 }), /MARKET_DOWNLOAD_DEADLINE/);
  assert.equal(requests.length, 1);
  await assertSocketsClosed(); // BEFORE fixture teardown can forcibly close anything.
});

test('socket inactivity terminates request before its total deadline', async (t) => {
  const { options, assertSocketsClosed } = await fixture(t, () => {});
  await assert.rejects(downloadProviderFile('products', { ...options, deadlineMs: 2000, idleMs: 100 }), /MARKET_DOWNLOAD_IDLE/);
  await assertSocketsClosed();
});

test('caller cancellation destroys in-flight HTTP and pre-abort makes zero requests', async (t) => {
  const controller = new AbortController();
  const { options, requests, assertSocketsClosed } = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); controller.abort();
  });
  await assert.rejects(downloadProviderFile('prices', { ...options, signal: controller.signal }), /MARKET_DOWNLOAD_ABORTED/);
  assert.equal(requests.length, 1);
  await assertSocketsClosed();
  await assert.rejects(downloadProviderFile('prices', { ...options, signal: controller.signal }), /MARKET_DOWNLOAD_ABORTED/);
  assert.equal(requests.length, 1);
});

test('no caller URL, unsafe limits, unknown option or invalid signal can start IO', async () => {
  let calls = 0;
  const request = () => { calls++; throw Error('must not run'); };
  const changingKind = { [Symbol.toPrimitive]() { throw Error('must not coerce caller object'); } };
  for (const kind of ['https://outside.invalid', '__proto__', 'constructor', '', null, ['products'], new String('products'), changingKind]) {
    await assert.rejects(downloadProviderFile(kind, { request }), /MARKET_DOWNLOAD_KIND/);
  }
  for (const extra of [{ maxBytes: 0 }, { maxBytes: 128 * 1024 * 1024 + 1 }, { deadlineMs: 120001 },
    { idleMs: Infinity }, { idleMs: -1 }, { signal: {} }, { url: 'https://outside.invalid' }]) {
    await assert.rejects(downloadProviderFile('products', { request, ...extra }), /MARKET_DOWNLOAD_OPTIONS/);
  }
  assert.equal(calls, 0);
});

test('oversized HTTP headers fail with a sanitized error', async (t) => {
  const { options } = await fixture(t, (_req, res) => send(res, body, { 'X-Too-Large': 's'.repeat(DOWNLOAD_POLICY.headerBytes + 1) }));
  await assert.rejects(downloadProviderFile('products', options), /^Error: MARKET_DOWNLOAD_REQUEST$/);
});

const products = JSON.stringify({ version: 1, createdAt: '2026-10-03T11:44:53+0200', products: [
  { idProduct: 123, name: 'Synthetic fixture card', idCategory: 51 },
] });
const prices = '{"version":1,"createdAt":"2026-10-03T02:41:55+0200","priceGuides":[{"idProduct":123,"idCategory":51,"trend":1.005}]}';

test('two complete sequential feeds normalize exact ID, money and original timestamps', async (t) => {
  const { options, requests } = await fixture(t, (req, res) => send(res,
    req.url === new URL(PROVIDER_URLS.products).pathname ? products : prices));
  const result = await downloadProviderSnapshot(options);
  assert.deepEqual(requests.map((r) => r.path), Object.values(PROVIDER_URLS).map((url) => new URL(url).pathname));
  assert.equal(result.snapshot.pages[0].records[0].productId, '123');
  assert.equal(result.snapshot.pages[0].records[0].normal.trend, '101');
  assert.equal(result.snapshot.manifest.sourceTimestamp, '2026-10-03T02:41:55+0200');
  assert.equal(result.snapshot.manifest.catalogSourceTimestamp, '2026-10-03T11:44:53+0200');
  assert.equal(result.downloads.length, 2);
  assert.equal(result.downloads[0].sha256, result.receipt.products.sha256);
  assert.equal(result.downloads[1].sha256, result.receipt.prices.sha256);
});

test('second-feed failure never returns a snapshot or retries', async (t) => {
  const { options, requests } = await fixture(t, (req, res) => {
    if (req.url === new URL(PROVIDER_URLS.products).pathname) send(res, products);
    else { res.writeHead(503); res.end(); }
  });
  await assert.rejects(downloadProviderSnapshot(options), /MARKET_DOWNLOAD_STATUS/);
  assert.equal(requests.length, 2);
});

test('first-feed failure does not request a second feed', async (t) => {
  const { options, requests } = await fixture(t, (_req, res) => { res.writeHead(503); res.end(); });
  await assert.rejects(downloadProviderSnapshot(options), /MARKET_DOWNLOAD_STATUS/);
  assert.equal(requests.length, 1);
});
