import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canTransition, createScannerDraft, resolveScannerProfile, scannerProductionActionBlockReason, scannerPublicationBlockReason, validateScannerProfile } from '@/lib/scanner-profile';
import { GET, POST } from '@/app/api/admin/scanner-profiles/route';
import { requireAdminToken, requireScannerLabToken } from '@/lib/server/firebase-token';
import { commitDocuments, getDocument, listDocuments } from '@/lib/server/firestore-rest';
import { privateOperations } from '@/lib/server/private-cloud-operations';

vi.mock('@/lib/server/firebase-token', () => ({ requireAdminToken: vi.fn(), requireScannerLabToken: vi.fn() }));
vi.mock('@/lib/server/private-cloud-operations', () => ({ privateOperations: vi.fn() }));
vi.mock('@/lib/server/firestore-rest', () => ({
  commitDocuments: vi.fn(), getDocument: vi.fn(), listDocuments: vi.fn(),
  setWrite: vi.fn((collection: string, id: string, data: unknown) => ({ collection, id, data })),
}));

describe('scanner profile safety', () => {
  it('validates normalized geometry and independent fallback', () => {
    const profile = createScannerDraft();
    expect(validateScannerProfile(profile)).toEqual({ valid: true, errors: [] });
    profile.zones[0] = { ...profile.zones[0], x: .9, width: .2 };
    expect(validateScannerProfile(profile).valid).toBe(false);
  });

  it('keeps the release flow explicit', () => {
    expect(canTransition('draft', 'testing')).toBe(true);
    expect(canTransition('testing', 'candidate')).toBe(true);
    expect(canTransition('candidate', 'production')).toBe(true);
    expect(canTransition('draft', 'production')).toBe(false);
  });

  it('resolves the most specific production scope deterministically', () => {
    const base = { ...createScannerDraft(), status: 'production' as const, profileVersion: 1 };
    const global = { ...base, profileId: 'global', scope: { level: 'global' as const, value: null } };
    const set = { ...base, profileId: 'set', scope: { level: 'set' as const, value: 'sv03.5' } };
    const card = { ...base, profileId: 'card', scope: { level: 'card' as const, value: 'sv03.5-001' } };
    expect(resolveScannerProfile([global, set, card], { setId: 'sv03.5', cardId: 'sv03.5-001' })?.profileId).toBe('card');
    expect(resolveScannerProfile([global, set], { setId: 'sv03.5' })?.profileId).toBe('set');
  });

  it('does not coerce local collector IDs', () => {
    const ids = ['001', '1', 'BW01', 'DAR', 'n'];
    expect(ids.map((localId) => `${'set'}-${localId}`)).toEqual(['set-001', 'set-1', 'set-BW01', 'set-DAR', 'set-n']);
  });
});

describe('scanner publication without a benchmark runner', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdminToken).mockResolvedValue({ sub: 'test-admin' } as Awaited<ReturnType<typeof requireAdminToken>>);
    vi.mocked(requireScannerLabToken).mockResolvedValue({ sub: 'test-admin' } as Awaited<ReturnType<typeof requireScannerLabToken>>);
    vi.mocked(listDocuments).mockResolvedValue([]);
    vi.mocked(getDocument).mockResolvedValue(null);
    vi.mocked(commitDocuments).mockResolvedValue(undefined);
    vi.mocked(privateOperations).mockResolvedValue({ serverAuthorization: async () => 'Bearer server-only' } as never);
  });

  function request(body: Record<string, unknown>, authenticated = true) {
    return new Request('https://domidex.web.app/api/admin/scanner-profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-only' } : {}) },
      body: JSON.stringify(body),
    });
  }

  it.each([
    ['publish', 'candidate', 'PUBLISH'],
    ['rollback', 'production', 'ROLLBACK'],
    ['rollback', 'deprecated', 'ROLLBACK'],
  ])('blocks confirmed %s from %s before any database changes', async (action, status, confirm) => {
    const source = { ...createScannerDraft(), documentId: 'test-profile--v0001', status };
    vi.mocked(listDocuments).mockResolvedValue([source]);
    const response = await POST(request({ action, sourceDocumentId: source.documentId, confirm, benchmark: { mode: 'REAL', passed: true } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'SCANNER_BENCHMARK_NOT_CONNECTED', error: scannerPublicationBlockReason });
    expect(requireAdminToken).toHaveBeenCalledOnce();
    expect(listDocuments).not.toHaveBeenCalled();
    expect(getDocument).not.toHaveBeenCalled();
    expect(commitDocuments).not.toHaveBeenCalled();
  });

  it('saves even a submitted production profile only as a draft and preserves the active manifest', async () => {
    const profile = { ...createScannerDraft(), status: 'production' };
    const response = await POST(request({ action: 'saveDraft', profile }));
    expect(response.status).toBe(200);
    const result = await response.json() as { version: { status: string } };
    expect(result.version.status).toBe('draft');
    expect(commitDocuments).toHaveBeenCalledOnce();
    const writes = vi.mocked(commitDocuments).mock.calls[0][0];
    expect(writes.map((write) => write.collection)).toEqual(['scannerProfileVersions', 'scannerProfiles', 'scannerAudit']);
    expect(writes[0].data).toMatchObject({ status: 'draft', publishedAt: null, publishedBy: null });
    expect(vi.mocked(commitDocuments).mock.calls[0][1]).toBe('Bearer server-only');
  });

  it('returns a safe correlated server error rather than masking infrastructure failures as bad input', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(listDocuments).mockRejectedValue(new Error('FIRESTORE_403'));
    const response = await GET(new Request('https://domidex.web.app/api/admin/scanner-profiles', { headers: { Authorization: 'Bearer test-only' } }));
    expect(response.status).toBe(503);
    const body = await response.json() as { errorId: string; error: string };
    expect(body.errorId).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers.get('x-request-id')).toBe(body.errorId);
    expect(body.error).not.toContain('FIRESTORE_403');
    expect(log).toHaveBeenCalledWith('DOMIDEX_SERVER_ERROR', expect.objectContaining({ code: 'FIRESTORE_403', errorId: body.errorId }));
    log.mockRestore();
  });

  it.each([
    ['markTesting', 'draft', 'testing'],
    ['createCandidate', 'testing', 'candidate'],
  ])('preserves %s as an unpublished editing stage', async (action, status, expectedStatus) => {
    const source = { ...createScannerDraft(), documentId: 'test-profile--v0001', status };
    vi.mocked(listDocuments).mockResolvedValue([source]);
    const response = await POST(request({ action, sourceDocumentId: source.documentId }));
    expect(response.status).toBe(200);
    const result = await response.json() as { version: { status: string } };
    expect(result.version.status).toBe(expectedStatus);
    const writes = vi.mocked(commitDocuments).mock.calls[0][0];
    expect(writes.map((write) => write.collection)).not.toContain('scannerReleaseManifest');
    expect(writes[0].data).toMatchObject({ status: expectedStatus, publishedAt: null, publishedBy: null });
  });

  it('uses the same production restriction in the interface without blocking review or draft actions', () => {
    expect(scannerProductionActionBlockReason('publish')).toBe(scannerPublicationBlockReason);
    expect(scannerProductionActionBlockReason('rollback')).toBe(scannerPublicationBlockReason);
    for (const action of ['saveDraft', 'markTesting', 'createCandidate', 'review']) {
      expect(scannerProductionActionBlockReason(action)).toBeNull();
    }
  });

  it('still requires sign-in before reporting publication availability', async () => {
    expect((await POST(request({ action: 'publish' }, false))).status).toBe(401);
    expect(commitDocuments).not.toHaveBeenCalled();
  });

  it('still requires administrator rights', async () => {
    vi.mocked(requireAdminToken).mockRejectedValue(new Error('ADMIN_REQUIRED'));
    const response = await POST(request({ action: 'saveDraft', profile: createScannerDraft() }));
    expect(response.status).toBe(403);
    expect(commitDocuments).not.toHaveBeenCalled();
  });
});
