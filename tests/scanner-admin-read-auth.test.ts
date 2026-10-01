import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getReports, PATCH as patchReport } from '@/app/api/admin/scan-reports/route';
import { GET as getProfiles } from '@/app/api/admin/scanner-profiles/route';

const privateAuth = vi.hoisted(() => ({
  authorize: vi.fn(),
  serverAuthorization: vi.fn(),
}));

vi.mock('@/lib/server/private-cloud-operations', () => ({
  privateOperations: async () => privateAuth,
}));

const adminBearer = 'Bearer admin-session-test';
const serverBearer = 'Bearer server-credential-test';
const routes = [
  { path: '/api/admin/scan-reports', get: getReports },
  { path: '/api/admin/scanner-profiles', get: getProfiles },
];

describe('scanner admin reads use authorized server credentials', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    privateAuth.authorize.mockResolvedValue({ sub: 'admin-test', admin: true });
    privateAuth.serverAuthorization.mockResolvedValue(serverBearer);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads stored reports with the server credential after checking the current admin session', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(serverBearer);
      if (String(input).endsWith(':runAggregationQuery')) {
        return Response.json([{ result: { aggregateFields: { total: { integerValue: '1' } } } }]);
      }
      expect(new URL(String(input)).pathname).toMatch(/\/documents\/scannerReports$/);
      return Response.json({ documents: [storedReport()] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await getReports(request('/api/admin/scan-reports?pageSize=48', adminBearer));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      reports: [{ documentId: 'scan-test', scanId: 'scan-test', reviewStatus: 'NEW' }],
      total: 1,
    });
    expect(privateAuth.authorize).toHaveBeenCalledExactlyOnceWith(adminBearer, 'scannerLab');
    expect(privateAuth.serverAuthorization).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(privateAuth.authorize.mock.invocationCallOrder[0]).toBeLessThan(privateAuth.serverAuthorization.mock.invocationCallOrder[0]);
    expect(privateAuth.serverAuthorization.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it('also authorizes legacy full-list reads before using the server credential', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(serverBearer);
      expect(new URL(String(input)).pathname).toMatch(/\/documents\/scannerReports$/);
      return Response.json({ documents: [storedReport()] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await getReports(request('/api/admin/scan-reports', adminBearer));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reports: [{ documentId: 'scan-test' }], total: 1 });
    expect(privateAuth.authorize).toHaveBeenCalledExactlyOnceWith(adminBearer, 'scannerLab');
    expect(privateAuth.serverAuthorization).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(privateAuth.authorize.mock.invocationCallOrder[0]).toBeLessThan(privateAuth.serverAuthorization.mock.invocationCallOrder[0]);
    expect(privateAuth.serverAuthorization.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it('loads every profile collection and the manifest with the server credential', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(serverBearer);
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/scannerReleaseManifest/production')) {
        return Response.json({ name: 'projects/test/databases/(default)/documents/scannerReleaseManifest/production', fields: {} });
      }
      return Response.json({ documents: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await getProfiles(request('/api/admin/scanner-profiles', adminBearer));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ profiles: [], versions: [], benchmarks: [], manifest: { documentId: 'production' } });
    expect(privateAuth.authorize).toHaveBeenCalledExactlyOnceWith(adminBearer, 'scannerLab');
    expect(privateAuth.serverAuthorization).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname.split('/documents/')[1]).sort()).toEqual([
      'scannerBenchmarks', 'scannerProfileVersions', 'scannerProfiles', 'scannerReleaseManifest/production',
    ]);
    expect(privateAuth.authorize.mock.invocationCallOrder[0]).toBeLessThan(privateAuth.serverAuthorization.mock.invocationCallOrder[0]);
    expect(privateAuth.serverAuthorization.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  for (const route of routes) {
    it(`${route.path} rejects anonymous reads before obtaining a server credential`, async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const response = await route.get(request(route.path));

      expect(response.status).toBe(401);
      expect(privateAuth.authorize).not.toHaveBeenCalled();
      expect(privateAuth.serverAuthorization).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it(`${route.path} rejects sessions without Lab access before obtaining a server credential`, async () => {
      privateAuth.authorize.mockRejectedValue(new Error('ACCESS_DENIED'));
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const response = await route.get(request(route.path, 'Bearer ordinary-session-test'));

      expect(response.status).toBe(403);
      expect(privateAuth.authorize).toHaveBeenCalledExactlyOnceWith('Bearer ordinary-session-test', 'scannerLab');
      expect(privateAuth.serverAuthorization).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it(`${route.path} rejects expired or revoked sessions before accessing Firestore`, async () => {
      privateAuth.authorize.mockRejectedValue(new Error('AUTH_REQUIRED'));
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const response = await route.get(request(route.path, 'Bearer expired-session-test'));

      expect(response.status).toBe(401);
      expect(privateAuth.serverAuthorization).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('preserves report ownership and image metadata when an authorized admin reviews it', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(serverBearer);
      if (String(input).endsWith('/scannerReports/scan-test')) return Response.json(storedReport());
      expect(String(input)).toMatch(/\/documents:commit$/);
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body.writes[0].update.fields).toMatchObject({
        ownerUid: { stringValue: 'original-owner-test' },
        captureImagePath: { stringValue: 'scanner-report-images/scan-test/capture.jpg' },
        imageSha256: { stringValue: 'a'.repeat(64) },
        reviewStatus: { stringValue: 'IN_REVIEW' },
        reviewedBy: { stringValue: 'admin-test' },
      });
      expect(body.writes[1].update.fields.actor).toEqual({ stringValue: 'admin-test' });
      return Response.json({ writeResults: [{}, {}] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await patchReport(new Request('https://domidex.web.app/api/admin/scan-reports', {
      method: 'PATCH',
      headers: { Authorization: adminBearer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: 'scan-test', reviewStatus: 'IN_REVIEW', reviewNote: 'Review test' }),
    }));

    expect(response.status).toBe(200);
    expect(privateAuth.authorize).toHaveBeenCalledExactlyOnceWith(adminBearer, 'scannerLab');
    expect(privateAuth.serverAuthorization).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function request(path: string, authorization?: string) {
  return new Request(`https://domidex.web.app${path}`, { headers: authorization ? { Authorization: authorization } : {} });
}

function storedReport() {
  return {
    name: 'projects/test/databases/(default)/documents/scannerReports/scan-test',
    updateTime: '2026-09-24T00:00:00.000000Z',
    fields: {
      scanId: { stringValue: 'scan-test' },
      createdAt: { stringValue: '2026-09-24T10:00:00.000Z' },
      captureType: { stringValue: 'MANUAL_CAPTURE' },
      reviewStatus: { stringValue: 'NEW' },
      ownerUid: { stringValue: 'original-owner-test' },
      captureImagePath: { stringValue: 'scanner-report-images/scan-test/capture.jpg' },
      imageSha256: { stringValue: 'a'.repeat(64) },
      imageContentType: { stringValue: 'image/jpeg' },
      imageSizeBytes: { integerValue: '1234' },
    },
  };
}
