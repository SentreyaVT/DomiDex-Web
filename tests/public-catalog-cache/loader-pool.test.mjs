import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicCatalogCache } from '../../backend/security/public-catalog-cache.mjs';

// Contract for one cache instance's actual load() promises, not physical network
// sockets, total heap, Cloud Run replicas, or globally admitted HTTP requests.
const card = (id, extra = {}) => ({ id, localId: id.split('-').at(-1), name: `Public ${id}`,
  set: { id: 'sv1', name: 'Public set' }, image: 'https://assets.tcgdex.net/de/sv/sv1/001',
  variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: {
    idProduct: 42, trend: 2.5, unit: 'EUR', updated: '2026-10-01T00:00:00Z',
  } } }], ...extra });
const controllers = [], providers = [], requests = [];
const tick = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  try {
    // Every consumer and deliberately uncooperative provider belongs to this test.
    // Abort consumers, then settle actual promises even after an assertion fails.
    for (const controller of controllers.splice(0)) controller.abort();
    for (const provider of providers.splice(0)) provider.close();
    await tick();
    expect(requests.every(request => request.done), 'Fixture must leave no public promise pending').toBe(true);
    expect(vi.getTimerCount(), 'Completed/aborted jobs must release their deadlines').toBe(0);
  } finally { requests.length = 0; vi.clearAllTimers(); vi.useRealTimers(); }
});

function controlledProvider() {
  const calls = [];
  let active = 0, peak = 0, closing = false;
  const load = vi.fn((id, signal, mode = 'raw') => {
    active++; peak = Math.max(peak, active);
    let finish, fail, settled = false;
    const promise = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const call = { id, signal, mode,
      resolve(value = card(id)) { if (!settled) { settled = true; finish(value); } },
      reject(error = Error('DELIBERATE_LATE_PROVIDER_REJECTION')) { if (!settled) { settled = true; fail(error); } },
    };
    calls.push(call);
    if (closing) call.resolve();
    // Deliberately ignores AbortSignal. The returned promise is handled ONLY by
    // the product; a lost late-rejection handler remains visible to Vitest.
    return promise.finally(() => { active--; });
  });
  const provider = { load, calls, get active() { return active; }, get peak() { return peak; },
    close() { closing = true; for (const call of calls) call.resolve(); } };
  providers.push(provider); return provider;
}

function request(cache, id, { controller = new AbortController(), mode = 'raw' } = {}) {
  controllers.push(controller);
  const state = { done: false, value: undefined, error: undefined, controller };
  // Observe consumer promises immediately, but never swallow a test assertion or
  // add a catch to the underlying provider promise under investigation.
  cache.get(id, controller.signal, mode).then(value => { state.done = true; state.value = value; }, error => {
    state.done = true; state.error = error;
  });
  requests.push(state); return state;
}
function result(state) {
  expect(state.done, 'Expected settlement without advancing a future deadline').toBe(true);
  expect(state.error).toBeUndefined(); return state.value;
}
function pending(state) { expect(state.done).toBe(false); }
function starts(provider) { return provider.calls.map(({ id }) => id); }

describe('bounded actual public-catalog loader pool (isolated, no provider/network)', () => {
  it.each(['maxActiveLoads', 'maxQueuedLoads'])('requires a positive safe integer for %s', (option) => {
    for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      expect(() => createPublicCatalogCache({ load: async id => card(id), [option]: value })).toThrow();
    }
    expect(() => createPublicCatalogCache({ load: async id => card(id), [option]: 1 })).not.toThrow();
  });

  it('defaults to 32 actual loads and exactly 512 queued jobs, then rejects without loading', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load });
    const active = Array.from({ length: 32 }, (_, i) => request(cache, `sv1-active-${i}`));
    await tick(); expect(provider.calls).toHaveLength(32); expect(provider.active).toBe(32);
    const queued = Array.from({ length: 512 }, (_, i) => request(cache, `sv1-queued-${i}`));
    await tick(); expect(provider.calls).toHaveLength(32);
    for (const state of [...active, ...queued]) pending(state);
    const overflow = request(cache, 'sv1-overflow'); await tick();
    expect(result(overflow)).toBeNull(); expect(provider.calls).toHaveLength(32);
    expect(provider.peak).toBe(32); expect(cache.stats().entries).toBe(0);
  });

  it('starts a normal miss immediately and returns the same valid public value', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load, maxActiveLoads: 2, maxQueuedLoads: 2 });
    const a = request(cache, 'sv1-001'); await tick();
    expect(starts(provider)).toEqual(['sv1-001']); expect(provider.active).toBe(1); pending(a);
    expect(provider.calls[0].signal.aborted).toBe(false);
    provider.calls[0].resolve(); await tick(); expect(result(a)).toEqual(card('sv1-001'));
    const warm = request(cache, 'sv1-001'); await tick();
    expect(result(warm)).toEqual(card('sv1-001')); expect(provider.calls).toHaveLength(1);
    expect(provider.active).toBe(0);
  });

  it('shares active and queued capacity between tracked and uncached overflow jobs', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load,
      maxInFlight: 1, maxActiveLoads: 2, maxQueuedLoads: 2 });
    const a = request(cache, 'sv1-001'), b = request(cache, 'sv1-002'), c = request(cache, 'sv1-003'), d = request(cache, 'sv1-004');
    await tick(); expect(starts(provider)).toEqual(['sv1-001', 'sv1-002']);
    expect(cache.stats().inFlight).toBe(1); pending(c); pending(d);
    const full = request(cache, 'sv1-005'); await tick(); expect(result(full)).toBeNull();
    provider.calls[1].resolve(); await tick();
    expect(result(b)).toEqual(card('sv1-002')); expect(cache.stats().entries).toBe(0);
    expect(starts(provider)).toEqual(['sv1-001', 'sv1-002', 'sv1-003']);
    provider.calls[0].resolve(); await tick();
    expect(result(a)).toEqual(card('sv1-001')); expect(starts(provider)).toEqual(['sv1-001', 'sv1-002', 'sv1-003', 'sv1-004']);
    provider.calls[2].resolve(); provider.calls[3].resolve(); await tick();
    expect(result(c)).toEqual(card('sv1-003')); expect(result(d)).toEqual(card('sv1-004'));
    expect(provider.peak).toBe(2); expect(provider.active).toBe(0);
  });

  it('starts queued jobs FIFO regardless of which active job settles first', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load, maxActiveLoads: 2, maxQueuedLoads: 3 });
    const states = ['a', 'b', 'c', 'd', 'e'].map(suffix => request(cache, `sv1-${suffix}`));
    await tick(); expect(starts(provider)).toEqual(['sv1-a', 'sv1-b']);
    provider.calls[1].resolve(); await tick(); expect(starts(provider)).toEqual(['sv1-a', 'sv1-b', 'sv1-c']);
    provider.calls[0].resolve(); await tick(); expect(starts(provider)).toEqual(['sv1-a', 'sv1-b', 'sv1-c', 'sv1-d']);
    provider.calls[2].resolve(); await tick(); expect(starts(provider)).toEqual(['sv1-a', 'sv1-b', 'sv1-c', 'sv1-d', 'sv1-e']);
    provider.calls[3].resolve(); provider.calls[4].resolve(); await tick();
    states.forEach((state, i) => expect(result(state)).toEqual(card(`sv1-${['a', 'b', 'c', 'd', 'e'][i]}`)));
    expect(provider.peak).toBe(2); expect(provider.active).toBe(0);
  });

  it('full queue yields uncached null and a later fresh request can load that same key', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load, maxActiveLoads: 1, maxQueuedLoads: 1 });
    const a = request(cache, 'sv1-a'), b = request(cache, 'sv1-b'), rejected = request(cache, 'sv1-c');
    await tick(); expect(result(rejected)).toBeNull(); expect(starts(provider)).toEqual(['sv1-a']);
    expect(cache.stats().entries).toBe(0);
    provider.calls[0].resolve(); await tick(); expect(result(a)).toEqual(card('sv1-a'));
    provider.calls[1].resolve(); await tick(); expect(result(b)).toEqual(card('sv1-b'));
    const retry = request(cache, 'sv1-c'); await tick();
    expect(starts(provider)).toEqual(['sv1-a', 'sv1-b', 'sv1-c']); pending(retry);
    provider.calls[2].resolve(); await tick(); expect(result(retry)).toEqual(card('sv1-c'));
  });

  it('same-key queued consumers deduplicate without taking a second queue slot', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load, maxActiveLoads: 1, maxQueuedLoads: 1 });
    const a = request(cache, 'sv1-a'), first = request(cache, 'sv1-b'), second = request(cache, 'sv1-b');
    await tick(); expect(starts(provider)).toEqual(['sv1-a']); pending(first); pending(second);
    const full = request(cache, 'sv1-c'); await tick(); expect(result(full)).toBeNull();
    provider.calls[0].resolve(); await tick(); expect(result(a)).toEqual(card('sv1-a'));
    expect(starts(provider)).toEqual(['sv1-a', 'sv1-b']);
    provider.calls[1].resolve(); await tick();
    expect(result(first)).toEqual(card('sv1-b')); expect(result(second)).toEqual(result(first));
    expect(result(second)).not.toBe(result(first)); expect(provider.peak).toBe(1);
  });

  it('raw and prices remain separate keys but share the same actual pool', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load, maxActiveLoads: 1, maxQueuedLoads: 1 });
    const raw = request(cache, 'sv1-a'), prices = request(cache, 'sv1-a', { mode: 'prices' });
    const full = request(cache, 'sv1-b'); await tick();
    expect(result(full)).toBeNull(); expect(provider.calls.map(({ mode }) => mode)).toEqual(['raw']); pending(prices);
    provider.calls[0].resolve(card('sv1-a', { name: 'Raw card' })); await tick();
    expect(result(raw).name).toBe('Raw card'); expect(provider.calls.map(({ mode }) => mode)).toEqual(['raw', 'prices']);
    provider.calls[1].resolve(card('sv1-a', { name: 'Priced card' })); await tick();
    expect(result(prices).name).toBe('Priced card'); expect(provider.peak).toBe(1);
    const rawWarm = request(cache, 'sv1-a'), pricesWarm = request(cache, 'sv1-a', { mode: 'prices' }); await tick();
    expect(result(rawWarm).name).toBe('Raw card'); expect(result(pricesWarm).name).toBe('Priced card');
    expect(provider.calls).toHaveLength(2);
  });

  it('one active consumer abort does not cancel another reader or free the occupied slot', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load, maxActiveLoads: 1, maxQueuedLoads: 1 });
    const a = request(cache, 'sv1-a'), shared = request(cache, 'sv1-a'), queued = request(cache, 'sv1-b');
    await tick(); a.controller.abort(); await tick();
    expect(result(a)).toBeNull(); pending(shared); pending(queued);
    expect(provider.calls[0].signal.aborted).toBe(false); expect(starts(provider)).toEqual(['sv1-a']);
    provider.calls[0].resolve(); await tick(); expect(result(shared)).toEqual(card('sv1-a'));
    expect(starts(provider)).toEqual(['sv1-a', 'sv1-b']);
    provider.calls[1].resolve(); await tick(); expect(result(queued)).toEqual(card('sv1-b'));
  });

  it('last queued consumer abort removes only its job and preserves FIFO for survivors', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load, maxActiveLoads: 1, maxQueuedLoads: 3 });
    const a = request(cache, 'sv1-a'), b = request(cache, 'sv1-b'), c = request(cache, 'sv1-c'), cShared = request(cache, 'sv1-c'), d = request(cache, 'sv1-d');
    await tick(); c.controller.abort(); await tick(); expect(result(c)).toBeNull(); pending(cShared);
    const stillFull = request(cache, 'sv1-e'); await tick(); expect(result(stillFull)).toBeNull();
    cShared.controller.abort(); await tick(); expect(result(cShared)).toBeNull();
    const e = request(cache, 'sv1-e'); await tick(); pending(e); expect(starts(provider)).toEqual(['sv1-a']);
    provider.calls[0].resolve(); await tick(); expect(result(a)).toEqual(card('sv1-a'));
    provider.calls[1].resolve(); await tick(); expect(result(b)).toEqual(card('sv1-b'));
    expect(starts(provider)).toEqual(['sv1-a', 'sv1-b', 'sv1-d']);
    provider.calls[2].resolve(); await tick(); expect(result(d)).toEqual(card('sv1-d'));
    expect(starts(provider)).toEqual(['sv1-a', 'sv1-b', 'sv1-d', 'sv1-e']);
    provider.calls[3].resolve(); await tick(); expect(result(e)).toEqual(card('sv1-e')); expect(provider.peak).toBe(1);
  });

  it.each(['resolve', 'reject'])('keeps an aborted uncooperative load permit until its late %s settles', async (outcome) => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load, maxActiveLoads: 1, maxQueuedLoads: 1 });
    const old = request(cache, 'sv1-a'), next = request(cache, 'sv1-b'); await tick();
    old.controller.abort(); await tick(); expect(result(old)).toBeNull();
    expect(provider.calls[0].signal.aborted).toBe(true); expect(provider.active).toBe(1);
    pending(next); expect(starts(provider)).toEqual(['sv1-a']);
    const full = request(cache, 'sv1-c'); await tick(); expect(result(full)).toBeNull();
    if (outcome === 'resolve') provider.calls[0].resolve(card('sv1-a', { name: 'Late discarded card' }));
    else provider.calls[0].reject();
    await tick(); expect(starts(provider)).toEqual(['sv1-a', 'sv1-b']); expect(provider.peak).toBe(1);
    expect(cache.stats().entries).toBe(0); // Cancelled generations cannot warm the cache.
    provider.calls[1].resolve(); await tick(); expect(result(next)).toEqual(card('sv1-b'));
    const fresh = request(cache, 'sv1-a'); await tick();
    expect(starts(provider)).toEqual(['sv1-a', 'sv1-b', 'sv1-a']); pending(fresh);
    provider.calls[2].resolve(card('sv1-a', { name: 'Fresh card' })); await tick(); expect(result(fresh).name).toBe('Fresh card');
    expect(provider.active).toBe(0);
  });

  it('queued time counts in the original deadline, and neither dequeue nor a new reader extends it', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load,
      maxActiveLoads: 1, maxQueuedLoads: 1, jobTimeoutMs: 12_000 });
    const old = request(cache, 'sv1-a'); await tick();
    await vi.advanceTimersByTimeAsync(1_000); const queued = request(cache, 'sv1-b'); await tick();
    await vi.advanceTimersByTimeAsync(11_000); expect(result(old)).toBeNull();
    expect(starts(provider)).toEqual(['sv1-a']); pending(queued);
    const joined = request(cache, 'sv1-b'); await tick(); pending(joined);
    await vi.advanceTimersByTimeAsync(500); provider.calls[0].resolve(); await tick();
    expect(starts(provider)).toEqual(['sv1-a', 'sv1-b']); pending(queued);
    await vi.advanceTimersByTimeAsync(499); pending(queued); pending(joined);
    await vi.advanceTimersByTimeAsync(1); expect(result(queued)).toBeNull(); expect(result(joined)).toBeNull();
    expect(provider.calls[1].signal.aborted).toBe(true); expect(provider.active).toBe(1);
    provider.calls[1].resolve(); await tick(); expect(provider.active).toBe(0); expect(cache.stats().entries).toBe(0);
  });

  it('a queued job can expire without ever starting, without freeing an uncooperative active permit', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load,
      maxActiveLoads: 1, maxQueuedLoads: 1, jobTimeoutMs: 12_000 });
    const active = request(cache, 'sv1-a'), expired = request(cache, 'sv1-b'); await tick();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(result(active)).toBeNull(); expect(result(expired)).toBeNull(); expect(starts(provider)).toEqual(['sv1-a']);
    expect(provider.active).toBe(1); const fresh = request(cache, 'sv1-c'); await tick(); pending(fresh);
    expect(starts(provider)).toEqual(['sv1-a']); provider.calls[0].resolve(); await tick();
    expect(starts(provider)).toEqual(['sv1-a', 'sv1-c']); provider.calls[1].resolve(); await tick();
    expect(result(fresh)).toEqual(card('sv1-c')); expect(provider.peak).toBe(1);
  });

  it.each(['throw', 'reject', 'invalid-projection'])('releases an actual completed %s load exactly once and drains the queue', async (kind) => {
    const provider = controlledProvider(), started = [];
    const load = vi.fn((id, signal, mode) => {
      started.push(id);
      if (id !== 'sv1-a') return provider.load(id, signal, mode);
      if (kind === 'throw') throw Error('EXPECTED_SYNC_PROVIDER_FAILURE');
      if (kind === 'reject') return Promise.reject(Error('EXPECTED_ASYNC_PROVIDER_FAILURE'));
      return Promise.resolve(card(id, { variants_detailed: [null] }));
    });
    const cache = createPublicCatalogCache({ load, maxActiveLoads: 1, maxQueuedLoads: 1 });
    const failed = request(cache, 'sv1-a'), next = request(cache, 'sv1-b'); await tick();
    expect(result(failed)).toBeNull(); expect(started).toEqual(['sv1-a', 'sv1-b']); pending(next);
    const queued = request(cache, 'sv1-c'); await tick();
    pending(queued); expect(started).toEqual(['sv1-a', 'sv1-b']);
    expect(provider.active).toBe(1); expect(provider.peak).toBe(1);
    provider.calls[0].resolve(); await tick(); expect(result(next)).toEqual(card('sv1-b'));
    expect(started).toEqual(['sv1-a', 'sv1-b', 'sv1-c']); pending(queued);
    expect(provider.active).toBe(1); expect(provider.peak).toBe(1);
    provider.calls[1].resolve(); await tick(); expect(result(queued)).toEqual(card('sv1-c'));
    expect(provider.active).toBe(0); expect(cache.stats().inFlight).toBe(0);
  });

  it('warm hits bypass a full pool and queue without changing the cached price or source date', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load, maxActiveLoads: 1, maxQueuedLoads: 1 });
    const first = request(cache, 'sv1-warm'); await tick(); provider.calls[0].resolve(); await tick();
    expect(result(first)).toEqual(card('sv1-warm'));
    const active = request(cache, 'sv1-a'), queued = request(cache, 'sv1-b'); await tick();
    const warm = request(cache, 'sv1-warm'); await tick();
    expect(result(warm)).toEqual(result(first)); expect(result(warm)).not.toBe(result(first));
    expect(starts(provider)).toEqual(['sv1-warm', 'sv1-a']); pending(active); pending(queued);
    expect(provider.peak).toBe(1);
  });

  it('already-aborted readers neither start a load nor consume the available queue slot', async () => {
    const provider = controlledProvider(), cache = createPublicCatalogCache({ load: provider.load, maxActiveLoads: 1, maxQueuedLoads: 1 });
    const active = request(cache, 'sv1-a'); await tick();
    const controller = new AbortController(); controller.abort();
    const cancelled = request(cache, 'sv1-b', { controller }); const queued = request(cache, 'sv1-c'); await tick();
    expect(result(cancelled)).toBeNull(); pending(queued); expect(starts(provider)).toEqual(['sv1-a']);
    provider.calls[0].resolve(); await tick(); expect(result(active)).toEqual(card('sv1-a'));
    expect(starts(provider)).toEqual(['sv1-a', 'sv1-c']); provider.calls[1].resolve(); await tick();
    expect(result(queued)).toEqual(card('sv1-c'));
  });
});
