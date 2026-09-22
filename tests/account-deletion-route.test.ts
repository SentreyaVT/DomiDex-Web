import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/account/delete/route';
import { privateOperations } from '@/lib/server/private-cloud-operations';

vi.mock('@/lib/server/private-cloud-operations', () => ({ privateOperations: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe('self-service deletion boundary', () => {
  it('rejects an oversized request before dispatching any private operation', async () => {
    const response = await POST(new Request('https://domidex.web.app/api/account/delete', { method: 'POST', body: JSON.stringify({ data: 'x'.repeat(3000) }) }));
    expect(response.status).toBe(413);
    expect(privateOperations).not.toHaveBeenCalled();
  });
  it('cannot forward an attacker-selected UID or existing job to the admin-capable backend', async () => {
    const deletionRequest = vi.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer owner');
      expect(await request.json()).toEqual({ confirm: 'DELETE_DOMIDEX_ACCOUNT' });
      return Response.json({ status: 'STARTED', jobId: 'example' }, { status: 202 });
    });
    vi.mocked(privateOperations).mockResolvedValue({ deletionRequest } as never);
    const response = await POST(new Request('https://domidex.web.app/api/account/delete', {
      method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: 'somebody-else', jobId: 'somebody-elses-job', confirm: 'DELETE_DOMIDEX_ACCOUNT' }),
    }));
    expect(response.status).toBe(202);
    expect(deletionRequest).toHaveBeenCalledOnce();
  });
});
