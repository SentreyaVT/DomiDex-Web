import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from '@/app/api/admin/testers/route';
import { requestUrl } from './helpers/http-fixture';

const boundary = vi.hoisted(() => ({ authorize: vi.fn(), changeRole: vi.fn() }));
vi.mock('@/lib/server/private-cloud-operations', () => ({ privateOperations: async () => boundary }));

const adminBearer = 'Bearer admin-session-test';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('K_SERVICE', 'test-service');
  vi.stubEnv('FIREBASE_ADMIN_CLIENT_EMAIL', '');
  vi.stubEnv('FIREBASE_ADMIN_PRIVATE_KEY', '');
  boundary.authorize.mockImplementation(async (authorization: string, role: string) => {
    if (authorization !== adminBearer || role !== 'admin') throw new Error('ACCESS_DENIED');
    return { sub: 'admin-actor', admin: true };
  });
  boundary.changeRole.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function patch(body: unknown, authorization: string | null = adminBearer) {
  return PATCH(new Request('https://example.test/api/admin/testers', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify(body),
  }));
}

describe('admin-only Scanner Lab role delegation', () => {
  it.each([true, false])('delegates exactly scannerLabAccess=%s through the private role setter', async (enabled) => {
    const claims = { admin: false, appAccess: true, pretester: true, feature: 'preserved', ...(enabled ? { scannerLabAccess: true } : {}) };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input).endsWith('/instance/service-accounts/default/token')) {
        return Response.json({ access_token: 'server-auth-token', expires_in: 3600 });
      }
      expect(requestUrl(input)).toMatch(/^https:\/\/identitytoolkit\.googleapis\.com\/v1\/projects\/[^/]+\/accounts:lookup$/);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer server-auth-token');
      expect(JSON.parse(init?.body as string)).toEqual({ localId: ['reviewer-uid'] });
      return Response.json({ users: [{ localId: 'reviewer-uid', email: 'reviewer@example.test', customAttributes: JSON.stringify(claims) }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await patch({ uid: 'reviewer-uid', scannerLabAccess: enabled });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      configured: true, tokenRefreshRequired: true,
      user: { uid: 'reviewer-uid', scannerLabAccess: enabled, admin: false, appAccess: true, pretester: true },
    });
    expect(boundary.authorize).toHaveBeenCalledExactlyOnceWith(adminBearer, 'admin');
    expect(boundary.changeRole).toHaveBeenCalledExactlyOnceWith('reviewer-uid', 'scannerLabAccess', enabled, 'admin-actor');
    expect(boundary.authorize.mock.invocationCallOrder[0]).toBeLessThan(boundary.changeRole.mock.invocationCallOrder[0]);
    expect(boundary.changeRole.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it.each(['Bearer scanner-lab-only-session', 'Bearer pretester-only-session', 'Bearer ordinary-session'])('rejects %s before changing roles or loading Auth data', async (authorization) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await patch({ uid: 'reviewer-uid', scannerLabAccess: true }, authorization);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Administratorrechte erforderlich.' });
    expect(boundary.authorize).toHaveBeenCalledExactlyOnceWith(authorization, 'admin');
    expect(boundary.changeRole).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires authentication before processing a role change', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await patch({ uid: 'reviewer-uid', scannerLabAccess: true }, null);
    expect(response.status).toBe(401);
    expect(boundary.authorize).not.toHaveBeenCalled();
    expect(boundary.changeRole).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { scannerLabAccess: true, pretester: false },
    { scannerLabAccess: false, appAccess: true },
    { scannerLabAccess: true, appAccess: false, pretester: true },
    { pretester: true, appAccess: false },
    {},
    { scannerLabAccess: 'true' },
    { scannerLabAccess: 1 },
    { scannerLabAccess: null },
    { admin: true },
  ])('rejects missing, invalid or multiple role changes: %j', async (changes) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await patch({ uid: 'reviewer-uid', ...changes });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Ungültige Rollenänderung.' });
    expect(boundary.changeRole).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
