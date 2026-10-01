import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from './helpers/http-fixture';

const privateAuth = vi.hoisted(() => ({ authorize: vi.fn(), serverAuthorization: vi.fn(), changeRole: vi.fn(), uploadReport: vi.fn(), deleteReport: vi.fn() }));
vi.mock('@/lib/server/private-cloud-operations', () => ({ privateOperations: async () => privateAuth }));

const session = 'Bearer lab-session-test';
const iam = 'Bearer server-iam-test';
const bucket = 'scanner-route-test.firebasestorage.app';
const indexObject = 'scanner-reference/master-index.json';
const imageObject = 'scanner-reference/images/test-001.webp';
const index = { schemaVersion: 1, generatedAt: '2026-09-24T00:00:00Z', stats: { total: 1 }, cards: [{ id: 'test-001', cardKey: 'test-001', nameDe: 'Testkarte', setId: 'test', setName: 'Testset', localId: '001', layoutFamily: 'EX', category: 'Pokemon', imageFile: 'test-001.webp', sourceImageUrl: 'https://assets.tcgdex.net/de/test/test/001', variants: ['normal'] }] };
type RouteName = 'index' | 'image';

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', bucket);
  vi.stubEnv('DOMIDEX_SCANNER_MASTER_INDEX_PATH', '');
  vi.stubEnv('DOMIDEX_SCANNER_REFERENCE_DIR', '');
  vi.stubEnv('DOMIDEX_LOCAL_SCANNER_BRIDGE_URL', '');
  vi.stubEnv('DOMIDEX_LOCAL_SCANNER_BRIDGE_SECRET', '');
  privateAuth.authorize.mockResolvedValue({ sub: 'reviewer-test', admin: false, scannerLabAccess: true });
  privateAuth.serverAuthorization.mockResolvedValue(iam);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  expect(privateAuth.changeRole).not.toHaveBeenCalled();
  expect(privateAuth.uploadReport).not.toHaveBeenCalled();
  expect(privateAuth.deleteReport).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

async function get(route: RouteName, authorization: string | null = session, query = '') {
  if (route === 'index') {
    const { GET } = await import('@/app/api/admin/scanner-references/route');
    return GET(new Request(`https://domidex.web.app/api/admin/scanner-references${query}`, { headers: authorization ? { Authorization: authorization } : {} }));
  }
  const { GET } = await import('@/app/api/admin/scanner-reference-image/[file]/route');
  return GET(new Request('https://domidex.web.app/api/admin/scanner-reference-image/test-001.webp', { headers: authorization ? { Authorization: authorization } : {} }), { params: Promise.resolve({ file: 'test-001.webp' }) });
}

function readOnlyGcsFetch(handler: (object: string, url: URL) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    expect(url.origin).toBe('https://storage.googleapis.com');
    expect(url.pathname).toMatch(new RegExp(`^/storage/v1/b/${bucket.replaceAll('.', '\\.')}/o/`));
    expect(new Headers(init?.headers).get('Authorization')).toBe(iam);
    expect(init?.method ?? 'GET').toBe('GET'); expect(init?.body).toBeUndefined(); expect(init?.redirect).toBe('error');
    expect(privateAuth.authorize.mock.invocationCallOrder[0]).toBeLessThan(privateAuth.serverAuthorization.mock.invocationCallOrder[0]);
    expect(privateAuth.serverAuthorization.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder.at(-1)!);
    return handler(decodeURIComponent(url.pathname.split('/o/')[1]), url);
  });
  vi.stubGlobal('fetch', fetchMock); return fetchMock;
}

describe('Scanner Lab reference routes use the verified server read boundary', () => {
  it('a non-admin Lab reviewer reads the reference index with OAuth after authorization', async () => {
    const fetchMock = readOnlyGcsFetch(object => { expect(object).toBe(indexObject); return Response.json(index); });
    const response = await get('index', session, '?q=Testkarte');
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ connected: true, total: 1, cards: [{ id: 'test-001' }] });
    expect(privateAuth.authorize).toHaveBeenCalledExactlyOnceWith(session, 'scannerLab', undefined, expect.any(Request));
    expect(privateAuth.serverAuthorization).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a non-admin Lab reviewer reads reference image bytes through GCS OAuth', async () => {
    const fetchMock = readOnlyGcsFetch(object => { expect(object).toBe(imageObject); return new Response(new Uint8Array([1,2,3])); });
    const response = await get('image');
    expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('image/webp'); expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1,2,3]));
    expect(privateAuth.authorize).toHaveBeenCalledExactlyOnceWith(session, 'scannerLab', undefined, expect.any(Request)); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  for (const route of ['index', 'image'] as const) {
    it(`${route}: anonymous request returns 401 before IAM or storage`, async () => {
      const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
      const response = await get(route, null);
      expect(response.status).toBe(401); expect(privateAuth.authorize).not.toHaveBeenCalled(); expect(privateAuth.serverAuthorization).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['ACCESS_DENIED', 'ACCOUNT_DELETING'])(`${route}: %s returns 403 before IAM or storage`, async (reason) => {
      privateAuth.authorize.mockRejectedValueOnce(new Error(reason)); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
      const response = await get(route);
      expect(response.status).toBe(403); expect(response.headers.get('Cache-Control')).toBe('private, no-store'); expect(privateAuth.authorize).toHaveBeenCalledExactlyOnceWith(session, 'scannerLab', undefined, expect.any(Request)); expect(privateAuth.serverAuthorization).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });

    it(`${route}: expired or revoked session returns 401 before server credential`, async () => {
      privateAuth.authorize.mockRejectedValueOnce(new Error('AUTH_REQUIRED')); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
      const response = await get(route);
      expect(response.status).toBe(401); expect(privateAuth.serverAuthorization).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });

    it(`${route}: IAM acquisition failure returns 503, not an authentication error`, async () => {
      privateAuth.serverAuthorization.mockRejectedValueOnce(new Error('TEST_IAM_FAILURE')); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
      const response = await get(route); const body = await response.json() as { error: string; errorId: string };
      expect(response.status).toBe(503); expect(body).toMatchObject({ error: expect.any(String), errorId: expect.any(String) }); expect(response.headers.get('X-Request-Id')).toBe(body.errorId); expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([401,403,500,503])(`${route}: storage HTTP %s is a visible 503 with no empty-success or auth retry`, async (status) => {
      const fetchMock = readOnlyGcsFetch(() => new Response('PRIVATE_CLOUD_DETAIL', { status }));
      const response = await get(route); const body = await response.json();
      expect(response.status).toBe(503); expect(body).toMatchObject({ error: expect.any(String), errorId: expect.any(String) }); expect(body).not.toHaveProperty('cards'); expect(body).not.toHaveProperty('connected'); expect(JSON.stringify(body)).not.toContain('PRIVATE_CLOUD_DETAIL'); expect(response.headers.get('Cache-Control')).toBe('private, no-store'); expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it(`${route}: network failure is 503, not 401`, async () => {
      readOnlyGcsFetch(() => { throw new Error('PRIVATE_NETWORK_DETAIL'); });
      const response = await get(route); const body = await response.json() as { error: string; errorId: string };
      expect(response.status).toBe(503); expect(body.errorId).toEqual(expect.any(String)); expect(JSON.stringify(body)).not.toContain('PRIVATE_NETWORK_DETAIL');
    });
  }

  it('a missing index retains the explicit disconnected result', async () => {
    readOnlyGcsFetch(object => { expect(object).toBe(indexObject); return new Response('', { status: 404 }); });
    const response = await get('index'); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ connected: false, cards: [], total: 0 });
  });

  it('missing image and missing fallback index return 404, never 401', async () => {
    const fetchMock = readOnlyGcsFetch(() => new Response('', { status: 404 }));
    const response = await get('image'); expect(response.status).toBe(404); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalid server index content becomes visible 503 in the list route', async () => {
    readOnlyGcsFetch(() => new Response('PRIVATE_INVALID_INDEX'));
    const response = await get('index'); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_INVALID_INDEX');
  });

  it('fallback index failure remains 503 after a missing image', async () => {
    const fetchMock = readOnlyGcsFetch(object => object === imageObject ? new Response('', { status: 404 }) : new Response('', { status: 403 }));
    const response = await get('image'); expect(response.status).toBe(503); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('TCGdex fallback uses the server index but receives no bearer credentials', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input); expect(init?.method ?? 'GET').toBe('GET'); expect(init?.body).toBeUndefined();
      if (url.startsWith('https://storage.googleapis.com/')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe(iam);
        return decodeURIComponent(url).includes(imageObject) ? new Response('', { status: 404 }) : Response.json(index);
      }
      expect(url).toBe('https://assets.tcgdex.net/de/test/test/001/high.webp'); expect(new Headers(init?.headers).has('Authorization')).toBe(false); return new Response(new Uint8Array([4,5,6]));
    }); vi.stubGlobal('fetch', fetchMock);
    const response = await get('image'); expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([4,5,6])); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
