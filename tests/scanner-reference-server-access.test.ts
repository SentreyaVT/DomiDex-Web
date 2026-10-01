import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'scanner-test.firebasestorage.app');
  vi.stubEnv('DOMIDEX_SCANNER_MASTER_INDEX_PATH', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const index = { schemaVersion: 1, generatedAt: '2026-09-24T00:00:00Z', stats: {}, cards: [{ id: 'test-001', imageFile: 'test-001.webp', sourceImageUrl: 'https://assets.tcgdex.net/de/test/test/001', variants: ['normal', 'Fire'] }] };

describe('server-only scanner reference archive reads', () => {
  it.each(['scanner-reference/master-index.json', 'scanner-reference/images/test-001.webp'])('uses GCS and OAuth Bearer for allowlisted %s', async (objectName) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('test-only', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    const { readServerScannerReferenceObject } = await import('@/lib/server/firebase-storage-rest');
    expect((await readServerScannerReferenceObject(objectName, 'Bearer test-iam'))?.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://storage.googleapis.com/storage/v1/b/scanner-test.firebasestorage.app/o/${encodeURIComponent(objectName)}?alt=media`);
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer test-iam' }, redirect: 'error', cache: 'no-store' });
    expect(init.method ?? 'GET').toBe('GET'); expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    'scanner-report-images/id/capture.jpg', 'users/uid/private.png', 'scanner-reference/other.json',
    'scanner-reference/images/../master-index.json', 'scanner-reference/images/..secret.webp',
    'scanner-reference/images/a..webp', 'scanner-reference/images/%2e%2e.webp',
    'scanner-reference/images/folder/card.webp', 'scanner-reference/images/card.webp?alt=media',
    'scanner-reference/images/card.webp#fragment', 'scanner-reference/images/card.webp\r\nAuthorization: x',
    'scanner-reference/images/card\\secret.webp', 'scanner-reference/images/card.png',
    '/scanner-reference/master-index.json', 'https://attacker.invalid/scanner-reference/images/a.webp',
  ])('rejects non-reference or unsafe object %s before any request', async (objectName) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const { readServerScannerReferenceObject } = await import('@/lib/server/firebase-storage-rest');
    expect(await readServerScannerReferenceObject(objectName, 'Bearer test-iam')).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 500, 503])('propagates Storage %s rather than returning an empty reference', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PRIVATE_UPSTREAM_BODY', { status })));
    const { readServerScannerReferenceObject } = await import('@/lib/server/firebase-storage-rest');
    await expect(readServerScannerReferenceObject('scanner-reference/master-index.json', 'Bearer test-iam')).rejects.toThrow(`STORAGE_${status}`);
  });

  it('returns null for missing objects and a safe error for network failure', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockRejectedValueOnce(new Error('PRIVATE_NETWORK_DETAILS')); vi.stubGlobal('fetch', fetchMock);
    const { readServerScannerReferenceObject } = await import('@/lib/server/firebase-storage-rest');
    expect(await readServerScannerReferenceObject('scanner-reference/images/test.webp', 'Bearer test-iam')).toBeNull();
    await expect(readServerScannerReferenceObject('scanner-reference/images/test.webp', 'Bearer test-iam')).rejects.toThrow('STORAGE_UNAVAILABLE');
  });

  it.each(['', 'Firebase test-id', 'Bearer token with spaces'])('does not send an invalid credential %s', async (authorization) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const { readServerScannerReferenceObject } = await import('@/lib/server/firebase-storage-rest');
    await expect(readServerScannerReferenceObject('scanner-reference/master-index.json', authorization)).rejects.toThrow('STORAGE_NOT_CONFIGURED'); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed for a missing bucket', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', ''); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const { readServerScannerReferenceObject } = await import('@/lib/server/firebase-storage-rest');
    await expect(readServerScannerReferenceObject('scanner-reference/master-index.json', 'Bearer test-iam')).rejects.toThrow('STORAGE_NOT_CONFIGURED'); expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('reference loaders preserve Firebase defaults and explicitly opt into server IAM', () => {
  it('keeps the existing Firebase endpoint and scheme as default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('image', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    const { loadRemoteReferenceImage } = await import('@/lib/server/scanner-references');
    expect((await loadRemoteReferenceImage('test.webp', 'Bearer test-id'))?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://firebasestorage.googleapis.com/v0/b/scanner-test.firebasestorage.app/o/scanner-reference%2Fimages%2Ftest.webp?alt=media', expect.objectContaining({ headers: { Authorization: 'Firebase test-id' } }));
  });

  it('uses server IAM explicitly for index and reference images', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(index)).mockResolvedValueOnce(new Response('image')); vi.stubGlobal('fetch', fetchMock);
    const { loadScannerIndex, loadRemoteReferenceImage } = await import('@/lib/server/scanner-references');
    expect((await loadScannerIndex('Bearer test-iam', 'server'))?.cards[0].variants).toEqual(['normal']);
    expect((await loadRemoteReferenceImage('test-001.webp', 'Bearer test-iam', 'server'))?.status).toBe(200);
    for (const [url, init] of fetchMock.mock.calls) { expect(url).toContain('https://storage.googleapis.com/storage/v1/'); expect(init.headers.Authorization).toBe('Bearer test-iam'); }
  });

  it('never serves a server-cached index to the Firebase access mode', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(index)).mockResolvedValueOnce(new Response('', { status: 403 })); vi.stubGlobal('fetch', fetchMock);
    const { loadScannerIndex } = await import('@/lib/server/scanner-references');
    expect(await loadScannerIndex('Bearer test-iam', 'server')).not.toBeNull();
    expect(await loadScannerIndex('Bearer test-id')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Firebase test-id');
  });

  it('propagates server index and image IAM denial while keeping Firebase null behavior', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    const { loadScannerIndex, loadRemoteReferenceImage, loadUpstreamReferenceImage } = await import('@/lib/server/scanner-references');
    await expect(loadScannerIndex('Bearer test-iam', 'server')).rejects.toThrow('STORAGE_403');
    await expect(loadRemoteReferenceImage('test-001.webp', 'Bearer test-iam', 'server')).rejects.toThrow('STORAGE_403');
    await expect(loadUpstreamReferenceImage('test-001.webp', 'Bearer test-iam', 'server')).rejects.toThrow('STORAGE_403');
    expect(await loadScannerIndex('Bearer test-id')).toBeNull();
  });

  it('reports invalid server index content without exposing response details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('PRIVATE_INVALID_CONTENT')));
    const { loadScannerIndex } = await import('@/lib/server/scanner-references');
    await expect(loadScannerIndex('Bearer test-iam', 'server')).rejects.toThrow('SCANNER_REFERENCE_INDEX_INVALID');
    expect(await loadScannerIndex('Bearer test-id')).toBeNull();
  });

  it('uses server mode for fallback index lookup but never forwards IAM credentials upstream', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(index)).mockResolvedValueOnce(new Response('upstream-image')); vi.stubGlobal('fetch', fetchMock);
    const { loadUpstreamReferenceImage } = await import('@/lib/server/scanner-references');
    expect((await loadUpstreamReferenceImage('test-001.webp', 'Bearer test-iam', 'server'))?.status).toBe(200);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-iam');
    expect(fetchMock.mock.calls[1][0]).toBe('https://assets.tcgdex.net/de/test/test/001/high.webp');
    expect(new Headers(fetchMock.mock.calls[1][1].headers).has('Authorization')).toBe(false);
  });
});
