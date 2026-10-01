import { expect, it, vi } from 'vitest';
import { GET, runtime } from '@/app/api/private-sync/time-anchor/route';

const fixture = vi.hoisted(() => ({ read: vi.fn<(request: Request) => Promise<Response>>() }));
vi.mock('@/lib/server/private-cloud-operations', () => ({
  privateOperations: async () => ({ readPrivateSyncTimeAnchor: fixture.read }),
}));

it('keeps the exact authenticated Request at the Node-only route boundary', async () => {
  const request = new Request('https://local.invalid/api/private-sync/time-anchor', { headers: { Authorization: 'Bearer opaque-test-only' } });
  const response = Response.json({ schemaVersion: 1, ownerUid: 'owner-a', seconds: 1_800_000_000, nanoseconds: 123 });
  fixture.read.mockResolvedValueOnce(response);
  expect(runtime).toBe('nodejs');
  expect(await GET(request)).toBe(response);
  expect(fixture.read).toHaveBeenCalledExactlyOnceWith(request);
});
