import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Actual handler/cache, synthetic database/provider only. These tests prove that
// observed request cancellation prevents subsequent work, not that an active
// Firestore RPC, provider socket, or shared anniversary guide stops billing.
const originalFetch = globalThis.fetch;
const sourceAt = Date.parse('2026-09-24T00:00:00Z');
const cleanups = [], controllers = [], handlers = [], unexpectedFetches = [];
let readBinderShare;

beforeEach(async () => {
  vi.resetModules();
  ({ readBinderShare } = await import('../backend/security/sharing.mjs'));
  vi.useFakeTimers();
});
afterEach(async () => {
  const errors = [];
  try {
    for (const controller of controllers.splice(0)) controller.abort();
    // Resolve deliberately abort-ignoring SDK/provider work even when RED fails
    // before the normal release point. No test leaves an unobserved rejection.
    for (const cleanup of cleanups.splice(0)) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(handlers.splice(0));
    try {
      expect(unexpectedFetches.splice(0), 'No unexpected provider URL may be hidden by a product fallback').toEqual([]);
      expect(vi.getTimerCount(), 'Settled cache jobs and owned timers must be released').toBe(0);
    } catch (error) { errors.push(error); }
  } finally {
    globalThis.fetch = originalFetch;
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  if (errors.length) throw new AggregateError(errors, 'Request-abort fixture cleanup failed');
});

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}
function controller() {
  const value = new AbortController(); controllers.push(value); return value;
}
const tick = () => vi.advanceTimersByTimeAsync(0);
function publicCard(index = 0, manual = false) {
  const localId = String(index + 1).padStart(3, '0');
  return { id: `sv1-${localId}`, localId, name: `Public ${localId}`, set: { id: 'sv1', name: 'Public set' },
    image: `https://assets.tcgdex.net/de/sv/sv1/${localId}`,
    variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: {
      idProduct: 42, trend: manual ? null : 2.5, avg: 3.25, unit: 'EUR', updated: '2026-09-24T00:00:00Z',
    } } }] };
}
function fixture({ count = 1, owner = 'request-abort-owner', manual = false, defaultCatalog = false } = {}) {
  const token = createHash('sha256').update(owner).digest('base64url');
  const sharePath = `privateBinderShares/${createHash('sha256').update(token).digest('hex')}`;
  const binderPath = `users/${owner}/privateBinders/binder`;
  const documents = new Map([
    [sharePath, { ownerUid: owner, binderId: 'binder', revokedAt: null, showPrices: true, showTotal: true }],
    [binderPath, { ownerUid: owner, binderId: 'binder', name: 'Request-abort fixture', coverStyle: 'galaxy', deleted: false }],
  ]);
  const placements = [], cards = new Map();
  for (let index = 0; index < count; index++) {
    const card = publicCard(index, manual), syncId = `entry-${String(index).padStart(3, '0')}`;
    const entry = { ownerUid: owner, syncId, deleted: false, quantity: 1, sourceCardId: card.id, sourceSetId: 'sv1', setId: 'sv1',
      collectorNumber: card.localId, language: 'DE', finish: 'Normal', variant: 'Standard',
      externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: 42, notes: 'PRIVATE_ABORT_FIXTURE_NOTE' };
    documents.set(`users/${owner}/collectionEntries/${syncId}`, entry);
    documents.set(`users/${owner}/collectionPriceSelections/${syncId}`, {
      schemaVersion: 1, ownerUid: owner, entrySyncId: syncId, revision: 1, lastMutationId: `choice-${syncId}`,
      updatedAtClient: sourceAt, cleared: false, sourceSetId: 'sv1', sourceCardId: card.id, collectorNumber: card.localId,
      language: 'DE', finish: 'Normal', variant: 'Standard', productId: 42, metric: 'normal_avg_sell',
      amountMinor: 325, currency: 'EUR', sourceAt, selectedAt: sourceAt + 1000,
    });
    placements.push({ id: `placement-${index}`, data: { ownerUid: owner, binderId: 'binder', entrySyncId: syncId, slotPosition: index, deleted: false } });
    cards.set(card.id, card);
  }
  const stats = { singlePaths: [], entryBatches: [], selectionBatches: [], authReads: 0 };
  const snapshot = (path, mask = null) => {
    const source = documents.get(path);
    const value = source === undefined || mask === null ? source
      : Object.fromEntries(mask.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]));
    return { id: path.split('/').at(-1), exists: source !== undefined, data: () => structuredClone(value) };
  };
  const context = { sharingEnabled: true,
    auth: { getUser: vi.fn(async () => { stats.authReads++; return { disabled: false, customClaims: { appAccess: true } }; }) },
    db: {
      doc: (path) => ({ path, get: async () => { stats.singlePaths.push(path); return snapshot(path); } }),
      collection: (path) => {
        expect(path).toBe(`users/${owner}/privateBinderPlacements`);
        return { where: (field, operator, value) => {
          expect([field, operator, value]).toEqual(['binderId', '==', 'binder']);
          return { select: (...mask) => ({ limit: (limit) => ({ get: async () => ({ size: Math.min(limit, placements.length),
            docs: placements.slice(0, limit).map(({ id, data }) => ({ id, data: () => structuredClone(Object.fromEntries(
              mask.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]))) })),
          }) }) }) };
        } };
      },
      getAll: vi.fn(async (...args) => {
        const mask = Array.isArray(args.at(-1)?.fieldMask) ? args.pop().fieldMask : null;
        const paths = args.map(({ path }) => path);
        expect(paths.length).toBeGreaterThan(0);
        if (paths.every((path) => path.startsWith(`users/${owner}/collectionEntries/`))) stats.entryBatches.push(paths);
        else {
          expect(paths.every((path) => path.startsWith(`users/${owner}/collectionPriceSelections/`))).toBe(true);
          expect(mask).toBeNull(); stats.selectionBatches.push(paths);
        }
        return paths.map((path) => snapshot(path, mask));
      }),
    },
  };
  if (!defaultCatalog) context.cardFor = vi.fn(async (id) => structuredClone(cards.get(id) ?? null));
  return { context, stats, cards, binderPath, sharePath,
    read: (signal) => readBinderShare(new Request(`https://synthetic.invalid/api/shared-binders/${token}`, { signal }),
      { params: Promise.resolve({ token }) }, context),
  };
}
function start(f, signal) {
  const state = { done: false, response: undefined, error: undefined };
  const completion = f.read(signal).then(
    (response) => { state.done = true; state.response = response; },
    (error) => { state.done = true; state.error = error; },
  );
  handlers.push(completion);
  return state;
}
async function abortedResult(state) {
  expect(state.done, 'The stopped handler must settle once its already-started fixture work settles').toBe(true);
  expect(state.error).toBeUndefined(); expect(state.response.status).toBe(503);
  expect(state.response.headers.get('Cache-Control')).toContain('no-store');
  expect(await state.response.json()).toEqual({ ok: false, error: 'SERVER_OPERATION_FAILED' });
}
function holdFirstBatch(f, collection) {
  const gate = deferred(), state = { entered: false };
  const original = f.context.db.getAll.getMockImplementation();
  f.context.db.getAll.mockImplementation(async (...args) => {
    const snapshots = await original(...args);
    if (!state.entered && args.some((ref) => typeof ref.path === 'string' && ref.path.includes(`/${collection}/`))) {
      state.entered = true; await gate.promise;
    }
    return snapshots;
  });
  cleanups.push(() => gate.resolve());
  return { state, release: () => gate.resolve() };
}
function provider(implementation) {
  const fetch = vi.fn((url, options) => {
    const valid = String(url) === 'https://api.tcgdex.net/v2/de/cards/sv1-001'
      && options?.signal instanceof AbortSignal && options?.headers?.Accept === 'application/json';
    if (!valid) { unexpectedFetches.push(String(url)); throw Error('UNEXPECTED_REQUEST_ABORT_PROVIDER'); }
    return implementation(options.signal);
  });
  globalThis.fetch = fetch;
  return fetch;
}
function expectedSingleCard() {
  return { title: 'Request-abort fixture', coverStyle: 'galaxy', page: 0, pageCount: 1,
    cards: [{ slot: 0, cardId: 'sv1-001', name: 'Public 001', setName: 'Public set', collectorNumber: '001',
      image: 'https://assets.tcgdex.net/de/sv/sv1/001/high.webp', finish: 'Normal', holoEffectId: 'none', holoIntensity: 0,
      price: { amount: 2.5, currency: 'EUR', source: 'Cardmarket', asOf: '2026-09-24T00:00:00Z' } }],
    unavailableSlots: [], total: { amount: 2.5, currency: 'EUR', complete: true, pricedCards: 1, visibleCards: 1 } };
}

describe('actual shared-binder request cancellation (synthetic boundaries, no real network)', () => {
  it('does not start any database, authorization or catalog reads for an already-aborted request', async () => {
    const f = fixture(), abort = controller(); abort.abort();
    const result = start(f, abort.signal); await tick();
    expect(f.stats.singlePaths).toEqual([]); expect(f.stats.authReads).toBe(0);
    expect(f.stats.entryBatches).toEqual([]); expect(f.stats.selectionBatches).toEqual([]);
    expect(f.context.cardFor).not.toHaveBeenCalled();
    await abortedResult(result);
  });

  it('does not start a second entry batch or catalog work after cancellation during the first 100 reads', async () => {
    const f = fixture({ count: 101, manual: true }), abort = controller(), held = holdFirstBatch(f, 'collectionEntries');
    const result = start(f, abort.signal);
    await tick(); expect(held.state.entered).toBe(true); expect(f.stats.entryBatches.map((paths) => paths.length)).toEqual([100]);
    abort.abort(); held.release(); await tick();
    expect(f.stats.entryBatches.map((paths) => paths.length)).toEqual([100]);
    expect(f.context.cardFor).not.toHaveBeenCalled(); expect(f.stats.selectionBatches).toEqual([]);
    expect(f.stats.authReads).toBe(1);
    await abortedResult(result);
  });

  it('does not expose a caller-controlled abort reason or reuse its HTTP status', async () => {
    const f = fixture(), abort = controller();
    abort.abort(Object.assign(new Error('AUTH_REQUIRED'), { status: 401, privateDetail: 'PRIVATE_ABORT_REASON' }));
    const result = start(f, abort.signal); await tick();
    expect(f.stats.singlePaths).toEqual([]); expect(f.stats.authReads).toBe(0);
    await abortedResult(result);
  });

  it('does not start a second price-selection batch or final reads after cancellation during its first 100 reads', async () => {
    const f = fixture({ count: 101, manual: true }), abort = controller(), held = holdFirstBatch(f, 'collectionPriceSelections');
    const result = start(f, abort.signal);
    await tick(); expect(held.state.entered).toBe(true);
    expect(f.stats.entryBatches.map((paths) => paths.length)).toEqual([100, 1]);
    expect(f.context.cardFor).toHaveBeenCalledTimes(101);
    expect(f.stats.selectionBatches.map((paths) => paths.length)).toEqual([100]);
    const beforeAbort = [...f.stats.singlePaths];
    abort.abort(); held.release(); await tick();
    expect(f.stats.selectionBatches.map((paths) => paths.length)).toEqual([100]);
    expect(f.stats.singlePaths).toEqual(beforeAbort); expect(f.stats.authReads).toBe(1);
    await abortedResult(result);
  });

  it('passes cancellation to six active cardFor consumers and never starts the seventh after they settle', async () => {
    const f = fixture({ count: 7, manual: true }), abort = controller(), gate = deferred(), signals = [];
    cleanups.push(() => gate.resolve());
    f.context.cardFor.mockImplementation(async (id, signal) => {
      signals.push(signal); await gate.promise; // Deliberately ignores abort until explicitly released.
      return structuredClone(f.cards.get(id));
    });
    const result = start(f, abort.signal);
    await tick(); expect(f.context.cardFor).toHaveBeenCalledTimes(6);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    abort.abort(); await tick();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    gate.resolve(); await tick();
    expect(f.context.cardFor).toHaveBeenCalledTimes(6); expect(f.stats.selectionBatches).toEqual([]);
    expect(f.stats.authReads).toBe(1);
    await abortedResult(result);
  });

  it('does not return a binder DTO or start the final binder read after cancellation during the final authorization read', async () => {
    const f = fixture(), abort = controller(), gate = deferred();
    let entered = false;
    cleanups.push(() => gate.resolve());
    const original = f.context.auth.getUser.getMockImplementation();
    f.context.auth.getUser.mockImplementation(async (...args) => {
      const user = await original(...args);
      if (f.stats.authReads === 2) { entered = true; await gate.promise; }
      return user;
    });
    const result = start(f, abort.signal); await tick();
    expect(entered).toBe(true); expect(f.stats.authReads).toBe(2);
    expect(f.stats.singlePaths.filter((path) => path === f.binderPath)).toHaveLength(1);
    abort.abort(); gate.resolve(); await tick();
    expect(f.stats.singlePaths.filter((path) => path === f.binderPath)).toHaveLength(1);
    await abortedResult(result);
  });

  it('cleans up its remaining catalog consumers after one worker fails without starting the seventh', async () => {
    const f = fixture({ count: 7 }), gate = deferred(), signals = [];
    cleanups.push(() => gate.resolve());
    f.context.cardFor.mockImplementation(async (id, signal) => {
      signals.push(signal);
      if (id === 'sv1-001') throw new Error('PRIVATE_PROVIDER_FAILURE');
      await gate.promise;
      return structuredClone(f.cards.get(id));
    });
    const result = start(f); await tick();
    await abortedResult(result);
    expect(f.context.cardFor).toHaveBeenCalledTimes(6);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    gate.resolve(); await tick();
    expect(f.context.cardFor).toHaveBeenCalledTimes(6);
    expect(f.stats.selectionBatches).toEqual([]); expect(f.stats.authReads).toBe(1);
  });

  it('cancels only reader A while reader B completes the same actual public-cache job unchanged', async () => {
    const a = fixture({ owner: 'request-owner-a', defaultCatalog: true }), b = fixture({ owner: 'request-owner-b', defaultCatalog: true });
    const abort = controller(), work = deferred(), signals = [];
    cleanups.push(() => work.resolve(Response.json(publicCard())));
    const fetch = provider((signal) => { signals.push(signal); return work.promise; });
    const first = start(a, abort.signal); await tick(); expect(fetch).toHaveBeenCalledTimes(1);
    const second = start(b); await tick();
    expect(b.stats.entryBatches).toHaveLength(1); expect(second.done).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
    abort.abort(); await tick();
    await abortedResult(first);
    expect(signals[0].aborted).toBe(false); expect(second.done).toBe(false); expect(a.stats.authReads).toBe(1);
    work.resolve(Response.json(publicCard())); await tick();
    expect(second.done).toBe(true); expect(second.error).toBeUndefined(); expect(second.response.status).toBe(200);
    expect(await second.response.json()).toEqual(expectedSingleCard()); expect(b.stats.authReads).toBe(2);
    expect(second.response.headers.get('Cache-Control')).toContain('no-store');
    const warm = start(b); await tick();
    expect(warm.done).toBe(true); expect(warm.error).toBeUndefined(); expect(warm.response.status).toBe(200);
    expect(await warm.response.json()).toEqual(expectedSingleCard()); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts the last cache consumer and prevents an abort-ignoring late provider from warming the next read', async () => {
    const f = fixture({ defaultCatalog: true }), abort = controller(), work = deferred();
    let oldSignal;
    cleanups.push(() => work.resolve(Response.json({ ...publicCard(), name: 'Late stale provider' })));
    const fetch = provider((signal) => {
      if (!oldSignal) { oldSignal = signal; return work.promise; }
      return Promise.resolve(Response.json(publicCard()));
    });
    const first = start(f, abort.signal); await tick();
    expect(fetch).toHaveBeenCalledTimes(1); expect(oldSignal.aborted).toBe(false);
    abort.abort(); await tick();
    await abortedResult(first); expect(oldSignal.aborted).toBe(true);
    work.resolve(Response.json({ ...publicCard(), name: 'Late stale provider' })); await tick();
    const fresh = start(f); await tick();
    expect(fresh.done).toBe(true); expect(fresh.error).toBeUndefined(); expect(fresh.response.status).toBe(200);
    expect(await fresh.response.json()).toEqual(expectedSingleCard()); expect(fetch).toHaveBeenCalledTimes(2);
    const warm = start(f); await tick();
    expect(warm.done).toBe(true); expect(warm.error).toBeUndefined(); expect(warm.response.status).toBe(200);
    expect(await warm.response.json()).toEqual(expectedSingleCard()); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the normal 12-second catalog deadline as a partial 200 response, not a request cancellation', async () => {
    const f = fixture({ defaultCatalog: true }), request = controller(), work = deferred();
    let providerSignal;
    cleanups.push(() => work.resolve(Response.json(publicCard())));
    const fetch = provider((signal) => { providerSignal = signal; return work.promise; });
    const result = start(f, request.signal); await tick();
    expect(fetch).toHaveBeenCalledTimes(1); expect(providerSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(11_999); expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(request.signal.aborted).toBe(false); expect(providerSignal.aborted).toBe(true);
    expect(result.done).toBe(true); expect(result.error).toBeUndefined(); expect(result.response.status).toBe(200);
    expect(result.response.headers.get('Cache-Control')).toContain('no-store');
    expect(await result.response.json()).toEqual({ title: 'Request-abort fixture', coverStyle: 'galaxy', page: 0, pageCount: 1,
      cards: [], unavailableSlots: [0], total: { amount: null, currency: 'EUR', complete: false, pricedCards: 0, visibleCards: 1 } });
    expect(f.stats.authReads).toBe(2); expect(f.stats.selectionBatches).toEqual([]);
    expect(f.stats.singlePaths.filter((path) => path === f.binderPath)).toHaveLength(2);
  });
});
