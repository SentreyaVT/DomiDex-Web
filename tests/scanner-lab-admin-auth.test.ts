import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const privateAuth = vi.hoisted(() => ({ changeRole: vi.fn() }));
vi.mock('@/lib/server/private-cloud-operations', () => ({ privateOperations: async () => privateAuth }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('K_SERVICE', 'test-only');
  vi.stubEnv('FIREBASE_ADMIN_CLIENT_EMAIL', '');
  vi.stubEnv('FIREBASE_ADMIN_PRIVATE_KEY', '');
  vi.stubEnv('GCE_METADATA_HOST', 'metadata.test.invalid');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function stubIdentity(users: Array<Record<string, unknown>>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://metadata.test.invalid/')) return Response.json({ access_token: 'test-iam', expires_in: 3600 });
    expect(url).toContain('https://identitytoolkit.googleapis.com/v1/projects/');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-iam');
    return Response.json({ users });
  });
  vi.stubGlobal('fetch', fetchMock); return fetchMock;
}

describe('Scanner Lab role administration summary and setter', () => {
  it('changes only the separate claim without granting any other access', async () => {
    const { withScannerLabAccessClaim } = await import('@/lib/server/firebase-admin-auth');
    const claims = { pretester: true, appAccess: false, feature: 'keep' };
    expect(withScannerLabAccessClaim(claims, true)).toEqual({ ...claims, scannerLabAccess: true });
    expect(withScannerLabAccessClaim({ ...claims, scannerLabAccess: true }, false)).toEqual(claims);
    expect(claims).not.toHaveProperty('scannerLabAccess');
  });

  it('lists lab-only users and uses strict boolean summaries', async () => {
    stubIdentity([
      { localId: 'reviewer', customAttributes: JSON.stringify({ scannerLabAccess: true }) },
      { localId: 'tester', customAttributes: JSON.stringify({ pretester: true }) },
      { localId: 'app-user', customAttributes: JSON.stringify({ appAccess: true }) },
      { localId: 'false-reviewer', customAttributes: JSON.stringify({ scannerLabAccess: 'true' }) },
      { localId: 'ordinary', customAttributes: '{}' },
    ]);
    const { listManagedUsers } = await import('@/lib/server/firebase-admin-auth');
    const { users } = await listManagedUsers(100);
    expect(users.map(user=>user.uid)).toEqual(['reviewer', 'tester', 'app-user']);
    expect(users[0]).toMatchObject({ admin: false, pretester: false, appAccess: false, scannerLabAccess: true });
    expect(users[1].scannerLabAccess).toBe(false);
  });

  it.each([true, false])('delegates scannerLabAccess=%s to the leased role setter and returns the verified account', async (enabled) => {
    const fetchMock = stubIdentity([{ localId: 'reviewer', customAttributes: JSON.stringify({ scannerLabAccess: enabled, pretester: true }) }]);
    const { setScannerLabAccessClaim } = await import('@/lib/server/firebase-admin-auth');
    await expect(setScannerLabAccessClaim('reviewer', enabled, 'operator')).resolves.toMatchObject({ uid: 'reviewer', scannerLabAccess: enabled, pretester: true, admin: false, appAccess: false });
    expect(privateAuth.changeRole).toHaveBeenCalledExactlyOnceWith('reviewer', 'scannerLabAccess', enabled, 'operator');
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ localId: ['reviewer'] }));
    expect(privateAuth.changeRole.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it('propagates grant failures without pretending the role changed', async () => {
    const fetchMock = stubIdentity([]); privateAuth.changeRole.mockRejectedValueOnce(new Error('ACCESS_CHANGE_BUSY'));
    const { setScannerLabAccessClaim } = await import('@/lib/server/firebase-admin-auth');
    await expect(setScannerLabAccessClaim('reviewer', true, 'operator')).rejects.toThrow('ACCESS_CHANGE_BUSY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
