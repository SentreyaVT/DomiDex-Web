import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const card = { id: 'sv1-001', localId: '001', name: 'Bisasam' };
const set = { id: 'sv1', name: 'Karmesin & Purpur', cards: [card] };
const MAX_BYTES = 8 * 1024 * 1024;

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bounded catalog client', () => {
  it('rejects after 15 seconds even when response headers never arrive', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => {});
    }));
    const { loadCard } = await import('@/lib/tcgdex');
    let outcome = 'pending';
    void loadCard(card.id).then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(outcome).toBe('rejected');
  });

  it('keeps the same deadline while a response body stalls and cancels it', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"id":')); },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const { loadCard } = await import('@/lib/tcgdex');
    let outcome = 'pending';
    void loadCard(card.id).then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('rejected');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects a chunked body above 8 MiB and cancels its reader', async () => {
    const cancel = vi.fn(); let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const { loadCard } = await import('@/lib/tcgdex');
    await expect(loadCard(card.id)).rejects.toThrow('Größenlimit');
    expect(cancel).toHaveBeenCalledOnce();
    expect(reads).toBeLessThanOrEqual(10);
  });

  it('accepts exactly 8 MiB and clears its timeout after success', async () => {
    vi.useFakeTimers();
    const prefix = '{"id":"sv1-001","pad":"'; const suffix = '"}';
    const json = prefix + 'a'.repeat(MAX_BYTES - prefix.length - suffix.length) + suffix;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(json)));
    const { loadCard } = await import('@/lib/tcgdex');
    await expect(loadCard(card.id)).resolves.toMatchObject({ id: card.id });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a stalled cancellation hook delay oversized-body rejection', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_BYTES + 1)); }, cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const { loadCard } = await import('@/lib/tcgdex');
    await expect(loadCard(card.id)).rejects.toThrow('Größenlimit');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('a timed-out card request can be loaded again successfully', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => new Response(new ReadableStream()))
      .mockImplementationOnce(async () => Response.json(card));
    vi.stubGlobal('fetch', fetchMock);
    const { loadCard } = await import('@/lib/tcgdex');
    const failure = loadCard(card.id).catch(error => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await failure).toBeInstanceOf(Error);
    await expect(loadCard(card.id)).resolves.toEqual(card);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['http', 'network', 'json'] as const)('retries a failed card request (%s), then coalesces its successful cache entry', async (failure) => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => {
        if (failure === 'network') throw new Error('Offline');
        return failure === 'http' ? new Response(null, { status: 503 }) : new Response('{invalid');
      })
      .mockImplementationOnce(async () => Response.json(card));
    vi.stubGlobal('fetch', fetchMock);
    const { loadCard } = await import('@/lib/tcgdex');
    await expect(loadCard(card.id)).rejects.toBeInstanceOf(Error);
    const retry = loadCard(card.id);
    expect(loadCard(` ${card.id} `)).toBe(retry);
    await expect(retry).resolves.toEqual(card);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('optional set metadata', () => {
  it.each(['missing', 'network', 'invalid-json', 'invalid-shape'] as const)('keeps a valid set when optional manifest is %s', async (failure) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/sets/')) return Response.json(set);
      if (failure === 'network') throw new Error('Offline');
      if (failure === 'missing') return new Response(null, { status: 404 });
      if (failure === 'invalid-json') return new Response('<html>Hosting error</html>');
      return Response.json({ cards: 'unavailable' });
    }));
    const { loadSet } = await import('@/lib/tcgdex');
    await expect(loadSet('SV1')).resolves.toEqual(set);
  });

  it('returns the valid set after the optional manifest body times out', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/sets/')
      ? Response.json(set) : new Response(new ReadableStream({ cancel }))));
    const { loadSet } = await import('@/lib/tcgdex');
    let result: unknown;
    void loadSet('sv1').then(value => { result = value; }, error => { result = error; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(result).toEqual(set);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('preserves card identity when enriching and reuses successful set requests', async () => {
    const fetchMock = vi.fn(async (url: string) => url.startsWith('/api/sets/')
      ? Response.json(set)
      : Response.json({ cards: [{ ...card, id: card.id.toUpperCase(), variants: ['Holo'], rarity: 'Rare' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { loadSet } = await import('@/lib/tcgdex');
    const request = loadSet('SV1');
    expect(loadSet(' sv1 ')).toBe(request);
    await expect(request).resolves.toMatchObject({ cards: [{ ...card, printVariants: ['Holo'], rarity: 'Rare' }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a failed primary set instead of caching its rejection', async () => {
    let primaryCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.startsWith('/api/sets/')) return new Response(null, { status: 404 });
      return ++primaryCalls === 1 ? new Response(null, { status: 503 }) : Response.json(set);
    }));
    const { loadSet } = await import('@/lib/tcgdex');
    await expect(loadSet('sv1')).rejects.toThrow('Set');
    await expect(loadSet('sv1')).resolves.toEqual(set);
    expect(primaryCalls).toBe(2);
  });
});
