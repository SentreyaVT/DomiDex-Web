import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const TTL = 600_000;
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('catalog promise metadata preserves the existing cache contract', () => {
  it('exposes the original deadline without changing the loadCard promise API or refreshing hits', async () => {
    let now = 100_000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = vi.fn(async () => Response.json({ id: 'fixture-1' })); vi.stubGlobal('fetch', fetchMock);
    const { loadCard, loadCardWithCacheInfo } = await import('@/lib/tcgdex');
    const snapshot = loadCardWithCacheInfo(' fixture-1 ');
    expect(snapshot.cacheExpiresAt).toBe(100_000 + TTL); expect(loadCard('fixture-1')).toBe(snapshot.promise); await snapshot.promise;
    now += TTL - 1;
    expect(loadCardWithCacheInfo('fixture-1')).toBe(snapshot); expect(fetchMock).toHaveBeenCalledOnce();
    now += 1; const fresh = loadCardWithCacheInfo('fixture-1'); expect(fresh).not.toBe(snapshot);
    expect(fresh.cacheExpiresAt).toBe(now + TTL); await fresh.promise; expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('starts the unchanged TTL at request start, not delayed completion', async () => {
    let now = 100_000; vi.spyOn(Date, 'now').mockImplementation(() => now); let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const { loadCardWithCacheInfo } = await import('@/lib/tcgdex'); const snapshot = loadCardWithCacheInfo('fixture-1');
    now += 10_000; finish(Response.json({ id: 'fixture-1' })); await snapshot.promise;
    expect(snapshot.cacheExpiresAt).toBe(100_000 + TTL);
  });

  it('still evicts FIFO at 600 public cards rather than silently growing the cache', async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 'fixture' })); vi.stubGlobal('fetch', fetchMock);
    const { loadCard, loadCardWithCacheInfo } = await import('@/lib/tcgdex');
    const first = loadCardWithCacheInfo('fixture-0'); await first.promise;
    for (let i = 1; i < 600; i++) await loadCard(`fixture-${i}`);
    expect(loadCardWithCacheInfo('fixture-0')).toBe(first);
    await loadCard('fixture-600'); await loadCard('fixture-0');
    expect(fetchMock).toHaveBeenCalledTimes(602);
  });

  it('does not let rejection of an evicted request remove a newer cache entry for the same ID', async () => {
    let rejectOld!: (error: Error) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectOld = reject; }))
      .mockImplementation(async () => Response.json({ id: 'fixture' })); vi.stubGlobal('fetch', fetchMock);
    const { loadCard, loadCardWithCacheInfo } = await import('@/lib/tcgdex');
    const failed = loadCard('fixture-0').catch(() => undefined);
    for (let i = 1; i <= 600; i++) await loadCard(`fixture-${i}`);
    const current = loadCardWithCacheInfo('fixture-0'); await current.promise; rejectOld(new Error('late failure')); await failed;
    expect(loadCardWithCacheInfo('fixture-0')).toBe(current); expect(fetchMock).toHaveBeenCalledTimes(602);
  });
});
