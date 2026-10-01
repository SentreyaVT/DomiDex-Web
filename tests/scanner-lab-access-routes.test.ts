import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getReports, PATCH as patchReport } from '@/app/api/admin/scan-reports/route';
import { GET as getProfiles, POST as postProfile } from '@/app/api/admin/scanner-profiles/route';
import { GET as getReferences } from '@/app/api/admin/scanner-references/route';
import { GET as getReferenceImage } from '@/app/api/admin/scanner-reference-image/[file]/route';

const boundary = vi.hoisted(() => ({ authorize: vi.fn(), serverAuthorization: vi.fn() }));
const referenceReads = vi.hoisted(() => ({
  loadScannerIndex: vi.fn(), loadLocalScannerBridge: vi.fn(), loadReferenceImage: vi.fn(),
  loadRemoteReferenceImage: vi.fn(), loadUpstreamReferenceImage: vi.fn(),
}));
vi.mock('@/lib/server/private-cloud-operations', () => ({ privateOperations: async () => boundary }));
vi.mock('@/lib/server/scanner-references', () => referenceReads);

const labBearer = 'Bearer scanner-lab-only-session';
const serverBearer = 'Bearer server-credential-test';

beforeEach(() => {
  vi.resetAllMocks();
  boundary.authorize.mockImplementation(async (authorization: string, role: string) => {
    if (authorization !== labBearer || role !== 'scannerLab') throw new Error('ACCESS_DENIED');
    return { sub: 'lab-reviewer', admin: false, appAccess: false, pretester: false, scannerLabAccess: true };
  });
  boundary.serverAuthorization.mockResolvedValue(serverBearer);
});
afterEach(() => vi.unstubAllGlobals());

function request(path: string, authorization: string | null = labBearer, method = 'GET', body?: unknown) {
  return new Request(`https://example.test${path}`, {
    method, headers: { ...(authorization ? { Authorization: authorization } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function storedReport() {
  return {
    name: 'projects/test/databases/(default)/documents/scannerReports/scan-test',
    updateTime: '2026-09-24T00:00:00.000000Z',
    fields: {
      scanId: { stringValue: 'scan-test' }, createdAt: { stringValue: '2026-09-24T10:00:00.000Z' },
      captureType: { stringValue: 'MANUAL_CAPTURE' }, reviewStatus: { stringValue: 'NEW' },
      ownerUid: { stringValue: 'original-owner' }, captureImagePath: { stringValue: 'scanner-report-images/scan-test/capture.jpg' },
      imageSha256: { stringValue: 'a'.repeat(64) }, imageContentType: { stringValue: 'image/jpeg' },
    },
  };
}

describe('Scanner Lab route role boundaries', () => {
  it('lets a lab-only reviewer read reports through the server credential', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(serverBearer);
      return Response.json({ documents: [storedReport()] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await getReports(request('/api/admin/scan-reports'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reports: [{ documentId: 'scan-test' }], total: 1 });
    expect(boundary.authorize).toHaveBeenCalledExactlyOnceWith(labBearer, 'scannerLab');
    expect(boundary.authorize.mock.invocationCallOrder[0]).toBeLessThan(boundary.serverAuthorization.mock.invocationCallOrder[0]);
    expect(boundary.serverAuthorization.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it('lets a lab-only reviewer update review status while preserving the original owner and image metadata', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(serverBearer);
      if (String(input).endsWith('/scannerReports/scan-test')) return Response.json(storedReport());
      expect(String(input)).toMatch(/\/documents:commit$/);
      const body = JSON.parse(init?.body as string);
      expect(body.writes[0].update.fields).toMatchObject({
        ownerUid: { stringValue: 'original-owner' }, captureImagePath: { stringValue: 'scanner-report-images/scan-test/capture.jpg' },
        imageSha256: { stringValue: 'a'.repeat(64) }, reviewStatus: { stringValue: 'IN_REVIEW' }, reviewedBy: { stringValue: 'lab-reviewer' },
      });
      expect(body.writes[1].update.fields.actor).toEqual({ stringValue: 'lab-reviewer' });
      return Response.json({ writeResults: [{}, {}] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await patchReport(request('/api/admin/scan-reports', labBearer, 'PATCH', {
      reportId: 'scan-test', reviewStatus: 'IN_REVIEW', reviewNote: 'Review by delegated user',
    }));
    expect(response.status).toBe(200);
    expect(boundary.authorize).toHaveBeenCalledExactlyOnceWith(labBearer, 'scannerLab');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('allows profile reads for lab-only users', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(serverBearer);
      return String(input).endsWith('/scannerReleaseManifest/production')
        ? Response.json({ name: 'projects/test/databases/(default)/documents/scannerReleaseManifest/production', fields: {} })
        : Response.json({ documents: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await getProfiles(request('/api/admin/scanner-profiles'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ profiles: [], versions: [], benchmarks: [] });
    expect(boundary.authorize).toHaveBeenCalledExactlyOnceWith(labBearer, 'scannerLab');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('denies profile changes for a lab-only user before acquiring server credentials or writing data', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await postProfile(request('/api/admin/scanner-profiles', labBearer, 'POST', { action: 'saveDraft' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Administratorrechte erforderlich.' });
    expect(boundary.authorize).toHaveBeenCalledExactlyOnceWith(labBearer, 'admin');
    expect(boundary.serverAuthorization).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const route of [
    { path: '/api/admin/scanner-references', read: (input: Request) => getReferences(input) },
    { path: '/api/admin/scanner-reference-image/sv3-125.webp', read: (input: Request) => getReferenceImage(input, { params: Promise.resolve({ file: 'sv3-125.webp' }) }) },
  ]) {
    it.each([null, 'Bearer ordinary-session', 'Bearer pretester-only-session', 'Bearer app-only-session'])(`${route.path} denies %s before any reference source is read`, async (authorization) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const response = await route.read(request(route.path, authorization));
      expect(response.status).toBe(authorization ? 403 : 401);
      if (authorization) expect(boundary.authorize).toHaveBeenCalledExactlyOnceWith(authorization, 'scannerLab');
      else expect(boundary.authorize).not.toHaveBeenCalled();
      for (const read of Object.values(referenceReads)) expect(read).not.toHaveBeenCalled();
      expect(boundary.serverAuthorization).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});
