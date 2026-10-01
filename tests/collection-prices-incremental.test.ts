// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useCollectionPrices } from '@/components/use-collection-prices';
import { resolveCollectionPrice } from '@/lib/collection-prices';
import * as catalog from '@/lib/tcgdex';
import type { CollectionEntry, TcgCardDetail } from '@/lib/domain';
import type { CollectionPriceSelection } from '@/lib/price-alternatives';

type Listener = { owner: string; next: (values: Record<string, CollectionPriceSelection>) => void; fail: (error: Error) => void; stop: ReturnType<typeof vi.fn> };
const subscription = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock('@/lib/collection-price-selections', () => ({ subscribeCollectionPriceSelections: subscription.subscribe }));
vi.mock('@/lib/collection-prices', { spy: true });
vi.mock('@/lib/tcgdex', { spy: true });

let serial = 0, prefix: string, now: number;
let listeners: Listener[], fetchMock: ReturnType<typeof vi.fn>;
const details = new Map<string, TcgCardDetail>();
const TTL = 600_000;
beforeEach(() => {
  vi.clearAllMocks(); details.clear(); listeners = []; prefix = `incremental-${++serial}`; now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  fetchMock = vi.fn(async (url: string) => Response.json(details.get(decodeURIComponent(url.slice('/api/cards/'.length)))));
  vi.stubGlobal('fetch', fetchMock);
  subscription.subscribe.mockImplementation(async (owner: string, next: Listener['next'], fail: Listener['fail']) => {
    const listener = { owner, next, fail, stop: vi.fn() }; listeners.push(listener); next({}); return listener.stop;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function entry(index = 0): CollectionEntry {
  const id = `${prefix}-${index}`;
  details.set(id, { id, localId: String(index), name: 'Synthetic card', set: { id: prefix, name: 'Synthetic set' },
    variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: { idProduct: index + 1, trend: 1.23, unit: 'EUR', updated: '2026-09-25T08:00:00Z' } } }],
  });
  return { syncId: id, ownerUid: 'owner-a', revision: 1, lastMutationId: 'fixture', updatedAtClient: 1, deleted: false, deletedAtClient: null,
    name: 'Synthetic card', setId: prefix, setName: 'Synthetic set', collectorNumber: String(index), language: 'GERMAN', finish: 'Normal', variant: 'Standard', rarity: '',
    quantity: 1, condition: 'NEAR_MINT', notes: '', acquisitionPriceMinor: null, acquisitionCurrency: null, acquisitionDateEpochDay: null,
    externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: index + 1, imageUrl: null, effectOverride: null, binderId: '',
    sourceSetId: prefix, sourceCardId: id, binderSetKey: prefix, binderName: 'Synthetic set', binderHeroAsset: null,
  };
}
function selection(row: CollectionEntry, amountMinor = 444): CollectionPriceSelection {
  return { schemaVersion: 1, ownerUid: row.ownerUid, entrySyncId: row.syncId, revision: 1, lastMutationId: 'selection-fixture', updatedAtClient: 1,
    cleared: false, sourceSetId: row.sourceSetId, sourceCardId: row.sourceCardId, collectorNumber: row.collectorNumber, language: row.language,
    finish: row.finish, variant: row.variant, productId: row.externalProductId, metric: 'normal_avg_sell', amountMinor, currency: 'EUR',
    sourceAt: 1_790_323_200_000, selectedAt: 1_790_323_300_000 };
}
function withoutTrend(row: CollectionEntry) { details.get(row.sourceCardId!)!.variants_detailed![0].pricing!.cardmarket!.trend = null; }
const counts = () => ({ resolver: vi.mocked(resolveCollectionPrice).mock.calls.length,
  loader: vi.mocked(catalog.loadCard).mock.calls.length + (catalog.loadCardWithCacheInfo ? vi.mocked(catalog.loadCardWithCacheInfo).mock.calls.length : 0), fetch: fetchMock.mock.calls.length });
function hook(rows: CollectionEntry[], owner: string | undefined = 'owner-a') {
  const initialProps: { entries: CollectionEntry[]; uid: string | undefined } = { entries: rows, uid: owner };
  return renderHook(({ entries, uid }: typeof initialProps) => useCollectionPrices(entries, uid), { initialProps });
}
async function done(result: { current: ReturnType<typeof useCollectionPrices> }) { await waitFor(() => expect(result.current.pending).toBe(0)); }
async function flush() { await act(async () => {}); }

describe('incremental collection pricing with the actual catalog cache and mocked fetch only', () => {
  it.each([18, 601])('does not revisit %i unchanged prices for a quantity/notes/order-only update', async (size) => {
    const rows = Array.from({ length: size }, (_, i) => entry(i)); const view = hook(rows); await done(view.result);
    expect(counts()).toEqual({ resolver: size, loader: size, fetch: size });
    view.rerender({ entries: rows.map((row, i) => i === 7 ? { ...row, quantity: 2, notes: 'Changed', revision: 2, binderId: 'elsewhere' } : row), uid: 'owner-a' });
    await done(view.result);
    // Counters deliberately distinguish local resolution from actual fetch invocations, not wire traffic.
    expect(counts()).toEqual({ resolver: size, loader: size, fetch: size });
    expect(Object.keys(view.result.current.prices)).toHaveLength(size);
    view.rerender({ entries: [...rows].reverse(), uid: 'owner-a' }); await done(view.result);
    expect(counts()).toEqual({ resolver: size, loader: size, fetch: size });
  });

  it('re-evaluates only the selected entry and preserves other displayed prices', async () => {
    const rows = Array.from({ length: 18 }, (_, i) => entry(i)); withoutTrend(rows[7]); const view = hook(rows); await done(view.result);
    await act(async () => listeners[0].next({ [rows[7].syncId]: selection(rows[7]) })); await done(view.result);
    expect(counts()).toEqual({ resolver: 19, loader: 19, fetch: 18 });
    expect(view.result.current.prices[rows[7].syncId]).toBe(4.44);
    expect(view.result.current.prices[rows[0].syncId]).toBe(1.23);
    await act(async () => listeners[0].next({})); await done(view.result);
    expect(counts()).toEqual({ resolver: 20, loader: 20, fetch: 18 });
    expect(view.result.current.prices[rows[7].syncId]).toBeNull();
  });

  it('does not temporarily erase unaffected prices while one changed selection is still resolving', async () => {
    const rows = [entry(0), entry(1)]; withoutTrend(rows[0]); const view = hook(rows); await done(view.result);
    const actual = (await vi.importActual<typeof import('@/lib/collection-prices')>('@/lib/collection-prices')).resolveCollectionPrice;
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(resolveCollectionPrice).mockImplementationOnce(async (...args) => { await gate; return actual(...args); });
    act(() => listeners[0].next({ [rows[0].syncId]: selection(rows[0]) }));
    expect(view.result.current.pending).toBe(1); expect(view.result.current.prices[rows[0].syncId]).toBeUndefined();
    expect(view.result.current.prices[rows[1].syncId]).toBe(1.23);
    await act(async () => release()); await done(view.result);
    expect(view.result.current.prices[rows[0].syncId]).toBe(4.44);
  });

  it.each([
    ['schemaVersion', 2], ['ownerUid', 'other-owner'], ['entrySyncId', 'other-entry'], ['revision', 2],
    ['lastMutationId', 'another-mutation'], ['updatedAtClient', 2], ['cleared', true], ['sourceSetId', 'other-set'],
    ['sourceCardId', 'other-card'], ['collectorNumber', 'other-number'], ['language', 'ENGLISH'],
    ['finish', 'Holo'], ['variant', 'other-variant'], ['productId', 999], ['metric', 'normal_low'],
    ['amountMinor', 555], ['currency', 'USD'], ['sourceAt', 1_790_323_100_000], ['selectedAt', 1_790_323_400_000],
  ] as const)('includes sidecar %s in the complete result fingerprint', async (field, value) => {
    const rows = [entry(0), entry(1)]; withoutTrend(rows[0]); const view = hook(rows); await done(view.result);
    const chosen = selection(rows[0]); await act(async () => listeners[0].next({ [rows[0].syncId]: chosen })); await done(view.result);
    const before = vi.mocked(resolveCollectionPrice).mock.calls.length;
    await act(async () => listeners[0].next({ [rows[0].syncId]: { ...chosen, [field]: value } as CollectionPriceSelection })); await done(view.result);
    expect(vi.mocked(resolveCollectionPrice)).toHaveBeenCalledTimes(before + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(view.result.current.prices[rows[1].syncId]).toBe(1.23);
  });

  it('retains fresh results for equivalent snapshots and unrelated sidecar documents', async () => {
    const rows = [entry(0), entry(1)]; const view = hook(rows); await done(view.result);
    view.rerender({ entries: rows.map(row => ({ ...row })), uid: 'owner-a' }); await done(view.result);
    await act(async () => listeners[0].next({ unrelated: selection({ ...rows[0], syncId: 'unrelated' }) })); await done(view.result);
    expect(counts()).toEqual({ resolver: 2, loader: 2, fetch: 2 });
  });

  it('only loads an added entry and removes a deleted row without revisiting survivors', async () => {
    const rows = [entry(0), entry(1)]; const view = hook(rows); await done(view.result);
    const added = entry(2); view.rerender({ entries: [...rows, added], uid: 'owner-a' }); await done(view.result);
    expect(counts()).toEqual({ resolver: 3, loader: 3, fetch: 3 });
    view.rerender({ entries: [rows[1], added], uid: 'owner-a' }); await done(view.result);
    expect(view.result.current.prices[rows[0].syncId]).toBeUndefined();
    expect(counts()).toEqual({ resolver: 3, loader: 3, fetch: 3 });
  });

  it.each([
    ['ownerUid', 'owner-b'], ['deleted', true], ['sourceSetId', 'another-set'], ['collectorNumber', 'another-number'],
    ['language', 'ENGLISH'], ['externalProductSource', 'OTHER'], ['externalProductId', 999], ['finish', 'Holo'],
    ['variant', 'Reverse'], ['sourceCardId', null],
  ] as const)('invalidates exactly the changed %s resolver input', async (field, value) => {
    const rows = [entry(0), entry(1)]; const view = hook(rows); await done(view.result);
    view.rerender({ entries: [{ ...rows[0], [field]: value }, rows[1]], uid: 'owner-a' }); await done(view.result);
    expect(vi.mocked(resolveCollectionPrice)).toHaveBeenCalledTimes(3);
    expect(view.result.current.prices[rows[1].syncId]).toBe(1.23);
  });

  it('keeps the original catalog expiry when the card was already cached before this hook mounted', async () => {
    const rows = [entry()]; await catalog.loadCard(rows[0].sourceCardId!); now += TTL - 1;
    const view = hook(rows); await done(view.result); expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 1; details.get(rows[0].sourceCardId!)!.variants_detailed![0].pricing!.cardmarket!.trend = 9.87;
    view.rerender({ entries: [{ ...rows[0], quantity: 2 }], uid: 'owner-a' }); await done(view.result);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(view.result.current.prices[rows[0].syncId]).toBe(9.87);
  });

  it('does not revalidate before the original deadline but replaces a manual selection with a new real trend at expiry', async () => {
    const rows = [entry()]; withoutTrend(rows[0]); const view = hook(rows); await done(view.result);
    await act(async () => listeners[0].next({ [rows[0].syncId]: selection(rows[0]) })); await done(view.result);
    now += TTL - 1; view.rerender({ entries: [{ ...rows[0], quantity: 2 }], uid: 'owner-a' }); await done(view.result);
    expect(counts()).toEqual({ resolver: 2, loader: 2, fetch: 1 }); expect(view.result.current.prices[rows[0].syncId]).toBe(4.44);
    now += 1; details.get(rows[0].sourceCardId!)!.variants_detailed![0].pricing!.cardmarket!.trend = 7.89;
    view.rerender({ entries: [{ ...rows[0], quantity: 3 }], uid: 'owner-a' }); await done(view.result);
    expect(view.result.current.prices[rows[0].syncId]).toBe(7.89); expect(view.result.current.priceSources[rows[0].syncId]).toBe('trend');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps explicit retry as a re-evaluation of all entries without restarting a healthy listener', async () => {
    const rows = [entry(0), entry(1)]; const view = hook(rows); await done(view.result);
    act(() => view.result.current.retry()); await done(view.result);
    expect(counts()).toEqual({ resolver: 4, loader: 4, fetch: 2 }); expect(subscription.subscribe).toHaveBeenCalledOnce();
  });

  it('does not cache a transport error as a permanent missing price', async () => {
    const rows = [entry()]; fetchMock.mockRejectedValueOnce(new Error('local synthetic failure')); const view = hook(rows); await done(view.result);
    expect(view.result.current.failed.has(rows[0].syncId)).toBe(true);
    view.rerender({ entries: [{ ...rows[0], quantity: 2 }], uid: 'owner-a' }); await done(view.result);
    expect(view.result.current.failed.size).toBe(0); expect(view.result.current.prices[rows[0].syncId]).toBe(1.23); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses pending unchanged work instead of resolving the same entry again on a quantity update', async () => {
    const rows = [entry()]; let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })); const view = hook(rows);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    view.rerender({ entries: [{ ...rows[0], quantity: 2 }], uid: 'owner-a' }); await flush();
    expect(vi.mocked(resolveCollectionPrice)).toHaveBeenCalledOnce();
    await act(async () => finish(Response.json(details.get(rows[0].sourceCardId!)!))); await done(view.result);
    expect(view.result.current.prices[rows[0].syncId]).toBe(1.23);
  });

  it('ignores an obsolete pending selection while keeping the current selection and unaffected results', async () => {
    const rows = [entry(0), entry(1)]; withoutTrend(rows[0]); let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })); const view = hook(rows);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => listeners[0].next({ [rows[0].syncId]: selection(rows[0], 555) }));
    await act(async () => finish(Response.json(details.get(rows[0].sourceCardId!)!))); await done(view.result);
    expect(view.result.current.prices[rows[0].syncId]).toBe(5.55); expect(view.result.current.prices[rows[1].syncId]).toBe(1.23);
  });

  it('never reuses resolved results after A to B to A or permission revoke and regrant', async () => {
    const rows = [entry()]; const view = hook(rows); await done(view.result);
    view.rerender({ entries: rows, uid: 'owner-b' }); await done(view.result);
    view.rerender({ entries: rows, uid: 'owner-a' }); await done(view.result);
    expect(vi.mocked(resolveCollectionPrice)).toHaveBeenCalledTimes(3);
    view.rerender({ entries: rows, uid: undefined }); await flush(); expect(view.result.current.prices).toEqual({});
    expect(vi.mocked(resolveCollectionPrice)).toHaveBeenCalledTimes(3);
    view.rerender({ entries: rows, uid: 'owner-a' }); await done(view.result);
    expect(vi.mocked(resolveCollectionPrice)).toHaveBeenCalledTimes(4); expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([false, true])('ignores an old private resolution after A to B to A (old failed=%s)', async (failed) => {
    const rows = [entry()]; withoutTrend(rows[0]);
    let finish!: (result: Awaited<ReturnType<typeof resolveCollectionPrice>>) => void;
    vi.mocked(resolveCollectionPrice).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = hook(rows); await waitFor(() => expect(vi.mocked(resolveCollectionPrice)).toHaveBeenCalledOnce());
    view.rerender({ entries: rows, uid: 'owner-b' }); await done(view.result);
    view.rerender({ entries: rows, uid: 'owner-a' }); await done(view.result);
    await act(async () => listeners[2].next({ [rows[0].syncId]: selection(rows[0], 999) })); await done(view.result);
    const identity = [rows[0].sourceCardId, rows[0].externalProductId, 'normal', 'standard'].join('|');
    await act(async () => finish({ identity, price: failed ? null : 1.11, failed, source: failed ? null : 'manual' }));
    expect(view.result.current.prices[rows[0].syncId]).toBe(9.99); expect(view.result.current.failed.size).toBe(0);
    expect(view.result.current.priceSources[rows[0].syncId]).toBe('manual');
  });

  it('does not publish a pending resolver or listener from an unmounted hook into a new same-owner hook', async () => {
    const rows = [entry()]; withoutTrend(rows[0]); let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const old = hook(rows); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); old.unmount();
    expect(listeners[0].stop).toHaveBeenCalledOnce();
    const current = hook(rows);
    await act(async () => listeners[1].next({ [rows[0].syncId]: selection(rows[0], 666) }));
    await act(async () => finish(Response.json(details.get(rows[0].sourceCardId!)!))); await done(current.result);
    await act(async () => {
      listeners[0].next({ [rows[0].syncId]: selection(rows[0], 999) });
      listeners[0].fail(new Error('late old listener error'));
    });
    expect(current.result.current.prices[rows[0].syncId]).toBe(6.66);
    expect(current.result.current.selectionSyncFailed).toBe(false); expect(current.result.current.failed.size).toBe(0);
    // Only the public catalog promise is shared; private price/selection results are not.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('starts a fresh result generation after a terminal sidecar listener failure and retry', async () => {
    const rows = [entry()]; withoutTrend(rows[0]); const view = hook(rows); await done(view.result);
    await act(async () => listeners[0].next({ [rows[0].syncId]: selection(rows[0]) })); await done(view.result);
    act(() => listeners[0].fail(new Error('listener stopped'))); await done(view.result);
    expect(view.result.current.selectionSyncFailed).toBe(true); const calls = vi.mocked(resolveCollectionPrice).mock.calls.length;
    act(() => view.result.current.retry()); await done(view.result);
    expect(subscription.subscribe).toHaveBeenCalledTimes(2); expect(vi.mocked(resolveCollectionPrice)).toHaveBeenCalledTimes(calls + 1);
    await act(async () => listeners[0].next({ [rows[0].syncId]: selection(rows[0], 999) }));
    expect(view.result.current.prices[rows[0].syncId]).toBeNull(); expect(view.result.current.selectionSyncFailed).toBe(false);
  });
});
