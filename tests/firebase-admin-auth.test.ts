import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedPageSize, firebaseAdminConfigured, listManagedUsers, withAppAccessClaim, withPretesterClaim } from '@/lib/server/firebase-admin-auth';

afterEach(() => {
  delete process.env.K_SERVICE;
  delete process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  delete process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  vi.restoreAllMocks();
});
describe('Firebase pretester claim management', () => {
  it('preserves unrelated and admin claims when granting pretester', () => {
    expect(withPretesterClaim({ admin: true, feature: 'keep' }, true)).toEqual({ admin: true, feature: 'keep', pretester: true });
  });

  it('removes only pretester and preserves all other claims', () => {
    expect(withPretesterClaim({ admin: true, pretester: true, feature: 7 }, false)).toEqual({ admin: true, feature: 7 });
  });

  it('changes only appAccess and preserves admin/pretester claims', () => {
    expect(withAppAccessClaim({ admin: true, pretester: true, feature: 7 }, true)).toEqual({ admin: true, pretester: true, feature: 7, appAccess: true });
    expect(withAppAccessClaim({ admin: true, pretester: true, appAccess: true }, false)).toEqual({ admin: true, pretester: true });
  });

  it('bounds Auth list pages', () => {
    expect(boundedPageSize(-3)).toBe(1);
    expect(boundedPageSize(5_000)).toBe(1_000);
    expect(boundedPageSize('invalid')).toBe(100);
  });

  it('uses the attached Cloud Run identity without exporting a private key', async () => {
    process.env.K_SERVICE = 'domidex-web';
    expect(firebaseAdminConfigured()).toBe(true);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'metadata-token', expires_in: 3_600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ users: [] }), { status: 200 }));

    await expect(listManagedUsers(100)).resolves.toEqual({ users: [], nextPageToken: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Metadata-Flavor')).toBe('Google');
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer metadata-token');
  });
});
