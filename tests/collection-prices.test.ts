// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { resolveCollectionPrice, sumKnownPrices } from '@/lib/collection-prices';
import { useCollectionPrices } from '@/components/use-collection-prices';
import { loadCard } from '@/lib/tcgdex';
import type { CollectionEntry, TcgCardDetail } from '@/lib/domain';

vi.mock('@/lib/tcgdex', () => ({ loadCard: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const entry = { syncId: 'a', sourceCardId: 'sv-test-137', sourceSetId: 'sv-test', collectorNumber: '137/088', finish: 'Holo', variant: 'Standard', quantity: 2, externalProductId: 77 } as CollectionEntry;
const card = { id: 'sv-test-137', localId: '137', name: 'Sonderkarte', set: { id: 'sv-test', name: 'Test', cardCount: { official: 88 } }, variants_detailed: [{ type: 'Holo', size: 'Standard', pricing: { cardmarket: { idProduct: 77, 'trend-holo': 12.34 } } }] } as TcgCardDetail;

describe('honest bounded collection price states', () => {
  it('retains exact above-main-set printing price', async () => {
    const result = await resolveCollectionPrice(entry, async () => card);
    expect(result).toMatchObject({ price: 12.34, failed: false });
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
});
