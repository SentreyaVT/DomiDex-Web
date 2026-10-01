// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { formatKnownValuation, resolveCollectionPrice, sumKnownPrices } from '@/lib/collection-prices';
import { useCollectionPrices } from '@/components/use-collection-prices';
import { loadCard } from '@/lib/tcgdex';
import type { CollectionEntry, TcgCardDetail } from '@/lib/domain';
import { alternativePriceCandidates, type CollectionPriceSelection } from '@/lib/price-alternatives';

type SelectionListener = {
  owner: string;
  next: (values: Record<string, CollectionPriceSelection>) => void;
  fail: (error: Error) => void;
  stop: ReturnType<typeof vi.fn>;
};
const selectionMock = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock('@/lib/tcgdex', () => {
  const loadCard = vi.fn();
  return { loadCard, loadCardWithCacheInfo: (id: string) => ({ promise: loadCard(id), cacheExpiresAt: Date.now() + 600_000 }) };
});
vi.mock('@/lib/collection-price-selections', () => ({ subscribeCollectionPriceSelections: selectionMock.subscribe }));
beforeEach(() => {
  selectionMock.subscribe.mockImplementation(async (_owner: string, next: SelectionListener['next']) => { next({}); return vi.fn(); });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const entry = { syncId: 'a', sourceCardId: 'sv-test-137', sourceSetId: 'sv-test', collectorNumber: '137/088', finish: 'Holo', variant: 'Standard', quantity: 2, externalProductId: 77 } as CollectionEntry;
const card = { id: 'sv-test-137', localId: '137', name: 'Sonderkarte', set: { id: 'sv-test', name: 'Test', cardCount: { official: 88 } }, variants_detailed: [{ type: 'Holo', size: 'Standard', pricing: { cardmarket: { idProduct: 77, trend: 12.34, 'trend-holo': 98.76 } } }] } as TcgCardDetail;

describe('honest bounded collection price states', () => {
  it('retains exact above-main-set printing price', async () => {
    const result = await resolveCollectionPrice(entry, async () => card);
    expect(result).toMatchObject({ price: 12.34, failed: false });
  });
  it.each([
    ['swsh11', '201', 670816, 1.38],
    ['sv03', '062', 781858, .23],
  ] as const)('does not value existing quarantined source/product pairs (%s-%s)', async (setId, localId, productId, trend) => {
    const identity = `${setId}-${localId}`;
    const persisted = { ...entry, sourceSetId: setId, sourceCardId: identity, collectorNumber: localId, externalProductId: productId };
    const fetched = { ...card, id: identity, localId, set: { ...card.set, id: setId }, variants_detailed: [{ type: 'Holo', size: 'Standard', pricing: { cardmarket: { idProduct: productId, trend } } }] };
    const before = JSON.stringify(persisted);
    expect(await resolveCollectionPrice(persisted, async () => fetched)).toMatchObject({ price: null, failed: false });
    expect(JSON.stringify(persisted)).toBe(before);
    expect(sumKnownPrices([persisted], { a: null })).toEqual({ value: 0, priced: 0, quantity: 2 });
  });
  it('distinguishes absent identity from failed transport', async () => {
    const load = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await resolveCollectionPrice({ ...entry, sourceCardId: null }, load)).toMatchObject({ price: null, failed: false });
    expect(load).not.toHaveBeenCalled();
    expect(await resolveCollectionPrice(entry, load)).toMatchObject({ price: null, failed: true });
  });
  it.each([
    { ...card, id: 'sv-test-138' },
    { ...card, set: { ...card.set, id: 'another-set' } },
    { ...card, localId: '138' },
    { ...card, variants_detailed: [{ type: 'Holo', size: 'Standard', pricing: { cardmarket: { idProduct: 88, 'trend-holo': 99 } } }] },
    { ...card, variants_detailed: [{ type: 'Reverse Holo', size: 'Standard', pricing: { cardmarket: { idProduct: 77, 'trend-holo': 99 } } }] },
  ])('never prices a conflicting card/set/number/product/finish', async (conflict) => {
    expect(await resolveCollectionPrice(entry, async () => conflict)).toMatchObject({ price: null, failed: false });
  });
  it('accepts only formatting differences in collector numbers, including values above the main set', async () => {
    expect(await resolveCollectionPrice({ ...entry, collectorNumber: '00137/088' }, async () => card)).toMatchObject({ price: 12.34 });
  });
  it('does not invent portfolio value for unknown cards', () => {
    expect(sumKnownPrices([entry, { ...entry, syncId: 'unknown', quantity: 3 }], { a: 12.34, unknown: null })).toEqual({ value: 24.68, priced: 2, quantity: 5 });
  });
  it('distinguishes an empty binder from an entirely unpriced binder', () => {
    expect(formatKnownValuation(sumKnownPrices([], {}))).toMatch(/^0,00/);
    expect(formatKnownValuation(sumKnownPrices([entry], { a: null }))).toBe('Preis nicht verfügbar');
  });
  it('labels partial binder and per-set values instead of presenting a complete valuation', () => {
    expect(formatKnownValuation(sumKnownPrices([entry, { ...entry, syncId: 'missing', quantity: 3 }], { a: 12.34 }))).toContain('Teilwert · 2/5');
    expect(formatKnownValuation(sumKnownPrices([entry], { a: 12.34 }))).not.toContain('Teilwert');
  });
  it('does not count zero, negative or non-finite source values as priced', () => {
    for (const value of [0, -1, Infinity, NaN]) expect(formatKnownValuation(sumKnownPrices([entry], { a: value }))).toBe('Preis nicht verfügbar');
  });
  it('finishes failed entries and can retry successfully', async () => {
    vi.mocked(loadCard).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(card);
    const entries = [entry];
    const { result } = renderHook(() => useCollectionPrices(entries, 'owner'));
    await waitFor(() => expect(result.current.failed.has('a')).toBe(true));
    expect(result.current.pending).toBe(0);
    result.current.retry();
    await waitFor(() => expect(result.current.prices.a).toBe(12.34));
    expect(result.current.failed.size).toBe(0);
  });
  it('never reuses old-owner or old-variant prices', async () => {
    vi.mocked(loadCard).mockResolvedValue(card);
    const entries = [entry];
    const { result, rerender } = renderHook(({ owner, cards }) => useCollectionPrices(cards, owner), { initialProps: { owner: 'first', cards: entries } });
    await waitFor(() => expect(result.current.prices.a).toBe(12.34));
    vi.mocked(loadCard).mockImplementation(() => new Promise(() => {}));
    rerender({ owner: 'second', cards: entries });
    expect(result.current.prices.a).toBeUndefined();
    expect(result.current.pending).toBe(1);
  });

  it('offers only real alternative metrics for the exact finish and guide snapshot', () => {
    const source = { ...card, variants_detailed: [{ type: 'Holo', size: 'Standard', pricing: { cardmarket: {
      idProduct: 77, trend: null, avg: 4.44, low: 3.33, avg1: 4.1, avg7: 4.2, avg30: 4.3,
      'avg-holo': 99, 'low-holo': 88, unit: 'EUR', updated: '2026-09-25T08:00:00Z',
    } } }] } as TcgCardDetail;
    expect(alternativePriceCandidates(source, source.variants_detailed![0])).toEqual([
      expect.objectContaining({ metric: 'normal_avg_sell', amountMinor: 444, productId: 77 }),
      expect.objectContaining({ metric: 'normal_low', amountMinor: 333, productId: 77 }),
      expect.objectContaining({ metric: 'normal_avg_1d', amountMinor: 410, productId: 77 }),
      expect.objectContaining({ metric: 'normal_avg_7d', amountMinor: 420, productId: 77 }),
      expect.objectContaining({ metric: 'normal_avg_30d', amountMinor: 430, productId: 77 }),
    ]);
    const reverse = { ...source.variants_detailed![0], type: 'Reverse Holo' };
    expect(alternativePriceCandidates({ ...source, variants_detailed: [reverse] }, reverse).map((item) => item.metric)).toEqual(['reverse_holo_avg_sell', 'reverse_holo_low']);
  });

  it('never offers a manually selectable value for a quarantined source/product pair', () => {
    const quarantined = { ...card, id: 'sv03-062', set: { ...card.set, id: 'sv03' }, variants_detailed: [{
      type: 'Holo', size: 'Standard', pricing: { cardmarket: { idProduct: 781858, trend: null, avg: .23, unit: 'EUR', updated: '2026-09-25T08:00:00Z' } },
    }] } as TcgCardDetail;
    expect(alternativePriceCandidates(quarantined, quarantined.variants_detailed![0])).toEqual([]);
  });

  it('uses an exact manually confirmed alternative only while the real trend is missing', async () => {
    const exactEntry = { ...entry, ownerUid: 'owner', deleted: false, language: 'GERMAN', externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD' } as CollectionEntry;
    const selection: CollectionPriceSelection = {
      schemaVersion: 1, ownerUid: 'owner', entrySyncId: exactEntry.syncId, revision: 1, lastMutationId: 'mutation-1',
      updatedAtClient: 1_788_220_800_000, cleared: false, sourceSetId: exactEntry.sourceSetId,
      sourceCardId: exactEntry.sourceCardId, collectorNumber: exactEntry.collectorNumber, language: exactEntry.language,
      finish: exactEntry.finish, variant: exactEntry.variant, productId: 77, metric: 'normal_avg_sell',
      amountMinor: 444, currency: 'EUR', sourceAt: 1_788_220_800_000, selectedAt: 1_788_220_900_000,
    };
    const missingTrend = { ...card, variants_detailed: [{ ...card.variants_detailed![0], pricing: { cardmarket: { idProduct: 77, trend: null, avg: 4.44, unit: 'EUR', updated: '2026-09-25T08:00:00Z' } } }] } as TcgCardDetail;
    expect(await resolveCollectionPrice(exactEntry, async () => missingTrend, selection)).toMatchObject({ price: 4.44, source: 'manual', failed: false });
    expect(await resolveCollectionPrice(exactEntry, async () => card, selection)).toMatchObject({ price: 12.34, source: 'trend', failed: false });
    expect(await resolveCollectionPrice(exactEntry, async () => missingTrend, { ...selection, finish: 'Reverse Holo' })).toMatchObject({ price: null, source: null });
    expect(await resolveCollectionPrice(exactEntry, async () => missingTrend, { ...selection, productId: 88 })).toMatchObject({ price: null, source: null });
  });
});

describe('price selection listener lifecycle', () => {
  const emptyEntries: CollectionEntry[] = [];
  const marker = (owner: string, id: string) => ({ [id]: { ownerUid: owner, entrySyncId: id, cleared: true } as CollectionPriceSelection });
  function captureListeners() {
    const listeners: SelectionListener[] = [];
    selectionMock.subscribe.mockImplementation(async (owner: string, next: SelectionListener['next'], fail: SelectionListener['fail']) => {
      const listener = { owner, next, fail, stop: vi.fn() };
      listeners.push(listener);
      return listener.stop;
    });
    return listeners;
  }

  it('restarts a failed listener for the same owner and ignores callbacks from its previous generation', async () => {
    const listeners = captureListeners();
    const { result } = renderHook(() => useCollectionPrices(emptyEntries, 'owner-a'));
    await waitFor(() => expect(listeners).toHaveLength(1));
    act(() => listeners[0].fail(new Error('permission-denied')));
    expect(result.current.selectionSyncFailed).toBe(true);

    act(() => result.current.retry());
    await waitFor(() => expect(listeners).toHaveLength(2));
    expect(listeners[1].owner).toBe('owner-a');
    expect(listeners[0].stop).toHaveBeenCalledOnce();
    act(() => listeners[1].next(marker('owner-a', 'current')));
    expect(result.current.selections).toEqual(marker('owner-a', 'current'));
    act(() => { listeners[0].next(marker('owner-a', 'stale')); listeners[0].fail(new Error('late')); });
    expect(result.current.selections).toEqual(marker('owner-a', 'current'));
    expect(result.current.selectionSyncFailed).toBe(false);
  });

  it('ignores late success and error after losing access and returning to the same owner', async () => {
    const listeners = captureListeners();
    const initialProps: { owner?: string } = { owner: 'owner-a' };
    const { result, rerender } = renderHook(({ owner }) => useCollectionPrices(emptyEntries, owner), { initialProps });
    await waitFor(() => expect(listeners).toHaveLength(1));
    act(() => listeners[0].next(marker('owner-a', 'before')));
    rerender({ owner: undefined });
    expect(result.current.selections).toEqual({});
    expect(listeners[0].stop).toHaveBeenCalledOnce();
    rerender({ owner: 'owner-a' });
    await waitFor(() => expect(listeners).toHaveLength(2));
    act(() => listeners[1].next(marker('owner-a', 'current')));
    act(() => listeners[0].next(marker('owner-a', 'stale')));
    expect(result.current.selections).toEqual(marker('owner-a', 'current'));
    act(() => listeners[0].fail(new Error('late')));
    expect(result.current.selectionSyncFailed).toBe(false);
  });

  it('ignores late snapshots while an old asynchronous registration is still completing', async () => {
    const listeners = captureListeners();
    let finishOld!: (stop: () => void) => void;
    let oldNext!: SelectionListener['next'];
    let oldFail!: SelectionListener['fail'];
    selectionMock.subscribe.mockImplementationOnce((_owner: string, next: SelectionListener['next'], fail: SelectionListener['fail']) => {
      oldNext = next; oldFail = fail;
      return new Promise<() => void>((resolve) => { finishOld = resolve; });
    });
    const { result, rerender } = renderHook(({ owner }) => useCollectionPrices(emptyEntries, owner), { initialProps: { owner: 'owner-a' } });
    rerender({ owner: 'owner-b' });
    await waitFor(() => expect(listeners).toHaveLength(1));
    act(() => listeners[0].next(marker('owner-b', 'current')));
    act(() => { oldNext(marker('owner-a', 'stale')); oldFail(new Error('late')); });
    expect(result.current.selections).toEqual(marker('owner-b', 'current'));
    expect(result.current.selectionSyncFailed).toBe(false);
    const stopOld = vi.fn();
    await act(async () => finishOld(stopOld));
    expect(stopOld).toHaveBeenCalledOnce();
    expect(listeners[0].stop).not.toHaveBeenCalled();
  });

  it('ignores a rejected old registration and cleans up a registration completed after unmount', async () => {
    const listeners = captureListeners();
    let rejectOld!: (error: Error) => void;
    selectionMock.subscribe.mockImplementationOnce(() => new Promise<() => void>((_resolve, reject) => { rejectOld = reject; }));
    const { result, rerender, unmount } = renderHook(({ owner }) => useCollectionPrices(emptyEntries, owner), { initialProps: { owner: 'owner-a' } });
    rerender({ owner: 'owner-b' });
    await waitFor(() => expect(listeners).toHaveLength(1));
    act(() => listeners[0].next(marker('owner-b', 'current')));
    await act(async () => rejectOld(new Error('late import failure')));
    expect(result.current.selections).toEqual(marker('owner-b', 'current'));
    expect(result.current.selectionSyncFailed).toBe(false);
    unmount();
    expect(listeners[0].stop).toHaveBeenCalledOnce();

    let finish!: (stop: () => void) => void;
    selectionMock.subscribe.mockImplementationOnce(() => new Promise<() => void>((resolve) => { finish = resolve; }));
    const delayed = renderHook(() => useCollectionPrices(emptyEntries, 'owner-a'));
    delayed.unmount();
    const stop = vi.fn();
    await act(async () => finish(stop));
    expect(stop).toHaveBeenCalledOnce();
  });

  it('retries a failed registration but does not restart a healthy listener for a card-price retry', async () => {
    const listeners = captureListeners();
    selectionMock.subscribe.mockRejectedValueOnce(new Error('registration failed'));
    const entries = [entry];
    vi.mocked(loadCard).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(card);
    const { result } = renderHook(() => useCollectionPrices(entries, 'owner-a'));
    await waitFor(() => expect(result.current.selectionSyncFailed).toBe(true));
    act(() => result.current.retry());
    await waitFor(() => expect(listeners).toHaveLength(1));
    act(() => listeners[0].next({}));
    await waitFor(() => expect(result.current.prices.a).toBe(12.34));
    expect(result.current.selectionSyncFailed).toBe(false);
    vi.mocked(loadCard).mockRejectedValueOnce(new Error('card transport offline'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.failed.has('a')).toBe(true));
    expect(selectionMock.subscribe).toHaveBeenCalledTimes(2);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.prices.a).toBe(12.34));
    expect(selectionMock.subscribe).toHaveBeenCalledTimes(2);
    expect(listeners[0].stop).not.toHaveBeenCalled();
  });
});
