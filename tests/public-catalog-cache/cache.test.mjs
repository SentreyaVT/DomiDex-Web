import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicCatalogCache } from '../../backend/security/public-catalog-cache.mjs';
const card = (id = 'sv1-001', extra = {}) => ({ id, localId: id.split('-').at(-1), name: 'Public card',
  set: { id: 'sv1', name: 'Public set' }, image: 'https://assets.tcgdex.net/de/sv/sv1/001',
  variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: {
    idProduct: 42, trend: 2.5, unit: 'EUR', updated: '2026-10-01T00:00:00Z',
  } } }], ...extra });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });

describe('bounded public catalog cache (no Firebase or network)', () => {
  it('shares a positive cold load with warm callers without changing provider timestamps', async () => {
    const load = vi.fn(async (id) => card(id)), cache = createPublicCatalogCache({ load });
    const first = await cache.get('sv1-001'); const second = await cache.get('sv1-001');
    expect(second).toEqual(first); expect(load).toHaveBeenCalledTimes(1);
    expect(second.variants_detailed[0].pricing.cardmarket.updated).toBe('2026-10-01T00:00:00Z');
    expect(cache.stats().entries).toBe(1);
  });

  it('copies only public consumed fields, so caller/source mutation cannot poison the cache', async () => {
    const source = card('sv1-001', { ownerUid: 'private-owner', notes: 'private-notes', quantity: 12 });
    source.set.ownerUid = 'private-set-owner'; source.variants_detailed[0].privateNote = 'private-variant';
    source.variants_detailed[0].pricing.cardmarket.ownerUid = 'private-price-owner';
    const load = vi.fn(async () => source), cache = createPublicCatalogCache({ load });
    const first = await cache.get('sv1-001');
    expect(JSON.stringify(first)).not.toMatch(/private|ownerUid|quantity|notes/);
    first.name = 'caller'; first.variants_detailed[0].pricing.cardmarket.trend = 999;
    source.name = 'source mutation';
    const second = await cache.get('sv1-001');
    expect(second.name).toBe('Public card'); expect(second.variants_detailed[0].pricing.cardmarket.trend).toBe(2.5);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not extend original TTL on a hit or reuse expired data after a failed refresh', async () => {
    let now = 1_000;
    const load = vi.fn(async (id) => card(id)), cache = createPublicCatalogCache({ load, now: () => now, ttlMs: 60 });
    await cache.get('sv1-001'); now += 59; await cache.get('sv1-001'); expect(load).toHaveBeenCalledTimes(1);
    now++; load.mockResolvedValueOnce(null); expect(await cache.get('sv1-001')).toBeNull();
    expect(await cache.get('sv1-001')).not.toBeNull(); expect(load).toHaveBeenCalledTimes(3);
  });

  it('evicts least recently used entries without extending their TTL', async () => {
    const load = vi.fn(async (id) => card(id)), cache = createPublicCatalogCache({ load, maxEntries: 2 });
    await cache.get('sv1-001'); await cache.get('sv1-002'); await cache.get('sv1-001'); await cache.get('sv1-003');
    expect(cache.stats().entries).toBe(2); await cache.get('sv1-002'); expect(load).toHaveBeenCalledTimes(4);
  });

  it('bounds serialized bytes and serves oversized valid cards uncached instead of losing them', async () => {
    const load = vi.fn(async (id) => card(id, { name: id.endsWith('003') ? 'X'.repeat(2_000) : 'Public card' }));
    const cache = createPublicCatalogCache({ load, maxEntries: 10, maxBytes: 700, maxEntryBytes: 600 });
    await cache.get('sv1-001'); await cache.get('sv1-002');
    expect(cache.stats().bytes).toBeGreaterThan(0); expect(cache.stats().bytes).toBeLessThanOrEqual(700);
    expect((await cache.get('sv1-003')).name).toHaveLength(2_000);
    expect((await cache.get('sv1-003')).name).toHaveLength(2_000);
    expect(cache.stats().bytes).toBeLessThanOrEqual(700);
    expect(load.mock.calls.filter(([id]) => id === 'sv1-003')).toHaveLength(2);
  });

  it('never retains absent, thrown or mismatched-ID results', async () => {
    const load = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(Error('temporary'))
      .mockResolvedValueOnce(card('sv1-002')).mockResolvedValue(card());
    const cache = createPublicCatalogCache({ load });
    for (let n = 0; n < 3; n++) expect(await cache.get('sv1-001')).toBeNull();
    expect(await cache.get('sv1-001')).toEqual(card());
    await cache.get('sv1-001'); expect(load).toHaveBeenCalledTimes(4);
  });

  it('rejects invalid public keys before any provider work', async () => {
    const load = vi.fn(), cache = createPublicCatalogCache({ load });
    for (const id of ['', '../private', 'https://private.invalid', 'x'.repeat(121), null]) expect(await cache.get(id)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('coalesces concurrent public-ID consumers and keeps their returned objects independent', async () => {
    const work = deferred(), load = vi.fn(() => work.promise), cache = createPublicCatalogCache({ load });
    const a = cache.get('sv1-001'), b = cache.get('sv1-001'); await tick();
    work.resolve(card()); const [first, second] = await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(1); expect(first).toEqual(second); expect(first).not.toBe(second);
    expect(cache.stats().inFlight).toBe(0);
  });

  it('a single consumer abort cannot abort another consumer or the shared provider signal', async () => {
    const work = deferred(), signals = [], load = vi.fn((id, signal) => { signals.push(signal); return work.promise; });
    const cache = createPublicCatalogCache({ load }), a = new AbortController(), b = new AbortController();
    const first = cache.get('sv1-001', a.signal), second = cache.get('sv1-001', b.signal);
    await tick(); a.abort(); await tick(); work.resolve(card());
    expect(await first).toBeNull(); expect(await second).toEqual(card());
    expect(load).toHaveBeenCalledTimes(1); expect(signals[0]).not.toBe(a.signal); expect(signals[0].aborted).toBe(false);
  });

  it('already aborted consumers do not load or populate anything', async () => {
    const load = vi.fn(async () => card()), cache = createPublicCatalogCache({ load }), abort = new AbortController();
    abort.abort(); expect(await cache.get('sv1-001', abort.signal)).toBeNull(); expect(load).not.toHaveBeenCalled();
  });

  it('inflight-cap overflow preserves valid uncached results instead of returning new nulls', async () => {
    const firstWork = deferred(), load = vi.fn((id) => id === 'sv1-001' ? firstWork.promise : Promise.resolve(card(id)));
    const cache = createPublicCatalogCache({ load, maxInFlight: 1 });
    const first = cache.get('sv1-001'); await tick();
    expect(cache.stats().inFlight).toBe(1);
    expect(await cache.get('sv1-002')).toEqual(card('sv1-002')); expect(cache.stats().inFlight).toBe(1);
    firstWork.resolve(card()); expect(await first).toEqual(card());
  });

  it('provider deadline releases the slot and late data cannot overwrite a replacement job', async () => {
    vi.useFakeTimers(); const old = deferred(), fresh = deferred();
    const load = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
    const cache = createPublicCatalogCache({ load, jobTimeoutMs: 12_000 });
    let settled = false; const first = cache.get('sv1-001').then((value) => { settled = true; return value; });
    await tick(); await vi.advanceTimersByTimeAsync(12_000);
    try {
      expect(settled).toBe(true); expect(await first).toBeNull(); expect(cache.stats().inFlight).toBe(0);
      const second = cache.get('sv1-001'); await tick();
      old.resolve(card('sv1-001', { name: 'stale' })); await tick();
      expect(cache.stats().inFlight).toBe(1);
      fresh.resolve(card('sv1-001', { name: 'fresh' })); expect((await second).name).toBe('fresh');
      expect((await cache.get('sv1-001')).name).toBe('fresh');
    } finally { old.resolve(card()); fresh.resolve(card()); await tick(); }
  });

  it('does not repair a malformed declared price identity through JSON null conversion', async () => {
    const malformed = card();
    malformed.variants_detailed[0].pricing.cardmarket.idProduct = Infinity;
    malformed.variants_detailed[0].thirdParty = { cardmarket: 42 };
    const load = vi.fn(async () => malformed), cache = createPublicCatalogCache({ load });
    const first = await cache.get('sv1-001');
    expect(first.variants_detailed[0].pricing.cardmarket.idProduct).toBe(Infinity);
    expect(first.variants_detailed[0].thirdParty.cardmarket).toBe(42);
    expect(cache.stats().entries).toBe(0);
    await cache.get('sv1-001'); expect(load).toHaveBeenCalledTimes(2);
  });

  it('last-consumer cancellation releases the job and cannot later populate its replacement', async () => {
    const old = deferred(), replacement = deferred(), signals = [];
    const load = vi.fn((id, signal) => { signals.push(signal); return signals.length === 1 ? old.promise : replacement.promise; });
    const cache = createPublicCatalogCache({ load }), consumer = new AbortController();
    const first = cache.get('sv1-001', consumer.signal); await tick(); consumer.abort();
    expect(await first).toBeNull(); expect(signals[0].aborted).toBe(true); expect(cache.stats().inFlight).toBe(0);
    const second = cache.get('sv1-001'); await tick(); old.resolve(card('sv1-001', { name: 'late' })); await tick();
    expect(cache.stats().inFlight).toBe(1);
    replacement.resolve(card('sv1-001', { name: 'replacement' }));
    expect((await second).name).toBe('replacement'); expect((await cache.get('sv1-001')).name).toBe('replacement');
  });

  it('uses the byte budget as an independent LRU limit', async () => {
    const load = vi.fn(async (id) => card(id, { name: 'X'.repeat(300) }));
    const cache = createPublicCatalogCache({ load, maxEntries: 100, maxBytes: 900, maxEntryBytes: 900 });
    await cache.get('sv1-001'); await cache.get('sv1-002');
    expect(cache.stats().entries).toBe(1); expect(cache.stats().bytes).toBeLessThanOrEqual(900);
    await cache.get('sv1-001'); expect(load).toHaveBeenCalledTimes(3);
  });
});
