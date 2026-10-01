import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdminToken, requireScannerLabToken, requirePretesterToken, requireAppAccessToken } from '@/lib/server/firebase-token';

const backend = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('@/lib/server/private-cloud-operations', () => ({ privateOperations: async () => backend }));
beforeEach(() => { vi.resetAllMocks(); backend.authorize.mockResolvedValue({ sub: 'test-actor' }); });
describe('original request forwarding through framework authorization', () => {
  const cases = [
    [requireAdminToken, 'admin'], [requireScannerLabToken, 'scannerLab'],
    [requirePretesterToken, 'tester'], [requireAppAccessToken, 'app'],
  ] as const;
  it.each(cases)('preserves original Request object and separate headers for %s', async (check, role) => {
    const input = new Request('https://domidex.web.app/api/admin/testers', {
      method: 'PATCH', headers: { authorization: 'Bearer test-session', 'X-Firebase-AppCheck': 'header.payload.signature' }, body: '{}',
    });
    await check('Bearer test-session', input);
    expect(backend.authorize).toHaveBeenCalledExactlyOnceWith('Bearer test-session', role, undefined, input);
    expect(input.bodyUsed).toBe(false);
  });
  it('preserves legacy string-only server caller compatibility', async () => {
    await requireAdminToken('Bearer test-session');
    expect(backend.authorize).toHaveBeenCalledExactlyOnceWith('Bearer test-session', 'admin');
  });
  it('does not delegate unauthenticated requests even with an App Check header', async () => {
    const input = new Request('https://domidex.web.app/api/admin/testers', { headers: { 'X-Firebase-AppCheck': 'header.payload.signature' } });
    await expect(requireAdminToken(null, input)).rejects.toThrow('AUTH_REQUIRED');
    expect(backend.authorize).not.toHaveBeenCalled();
  });
});
