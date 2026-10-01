import { describe, expect, it } from 'vitest';
import {
  exactCardmarketProductId,
  exactTrendPrice,
  variantForCollectionEntry,
  type CollectionEntry,
  type TcgCardDetail,
  type TcgVariant,
} from '@/lib/domain';
import { resolveCollectionPrice } from '@/lib/collection-prices';
import { alternativePriceCandidates, manualSelectionPrice, type CollectionPriceSelection } from '@/lib/price-alternatives';
import { sharedCardDto } from '@/lib/shared-binder';

/**
 * Identity fixtures mirror Android's PokemonCardLevelPriceIdentitySafetyTest:
 * bw1-1/bw1-2 share root 279739; sm1-162/sm1-168 share root 295475.
 * Product IDs are dated local identity evidence, not proof of either printing.
 * All amounts below are synthetic markers, never live Cardmarket values.
 * No fetch, provider download, registry mutation or persisted entry rewrite.
 */
const rootCases = [
  { id: 'bw1-1', setId: 'bw1', number: '1', name: 'Serpifeu', printedTotal: 114, productId: 279739 },
  { id: 'bw1-2', setId: 'bw1', number: '2', name: 'Serpifeu', printedTotal: 114, productId: 279739 },
  { id: 'sm1-162', setId: 'sm1', number: '162', name: 'Psycho-Energie', printedTotal: 149, productId: 295475 },
  { id: 'sm1-168', setId: 'sm1', number: '168', name: 'Psycho-Energie', printedTotal: 149, productId: 295475 },
] as const;

function sourceCard(row: (typeof rootCases)[number]): TcgCardDetail {
  return {
    id: row.id, localId: row.number, name: row.name,
    set: { id: row.setId, name: row.setId, cardCount: { official: row.printedTotal } },
    pricing: { cardmarket: {
      idProduct: row.productId, unit: 'EUR', trend: 123.45, avg: 67.89,
      updated: '2026-09-25T08:00:00Z',
    } },
    // Exactly the generated ordinary printing used in the Android regression.
    variants_detailed: [{ variantId: 'normal', type: 'normal', size: 'Standard' }],
  };
}

function savedEntry(card: TcgCardDetail, productId: number): CollectionEntry {
  return {
    syncId: `fixture-${card.id}`, ownerUid: 'synthetic-owner', revision: 1,
    lastMutationId: 'fixture-mutation', updatedAtClient: 1, deleted: false, deletedAtClient: null,
    name: card.name, setId: card.set.id, setName: card.set.name, collectorNumber: card.localId,
    language: 'GERMAN', finish: 'Normal', variant: 'Standard', rarity: '', quantity: 1,
    condition: 'NEAR_MINT', notes: '', acquisitionPriceMinor: null, acquisitionCurrency: null,
    acquisitionDateEpochDay: null, externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD',
    externalProductId: productId, imageUrl: null, effectOverride: null, binderId: '',
    sourceSetId: card.set.id, sourceCardId: card.id,
    binderSetKey: card.set.id, binderName: card.set.name, binderHeroAsset: null,
  };
}

function savedSelection(entry: CollectionEntry): CollectionPriceSelection {
  return {
    schemaVersion: 1, ownerUid: entry.ownerUid, entrySyncId: entry.syncId,
    revision: 1, lastMutationId: 'fixture-selection', updatedAtClient: 1_790_323_200_000,
    cleared: false, sourceSetId: entry.sourceSetId, sourceCardId: entry.sourceCardId,
    collectorNumber: entry.collectorNumber, language: entry.language,
    finish: entry.finish, variant: entry.variant, productId: entry.externalProductId,
    metric: 'normal_avg_sell', amountMinor: 444, currency: 'EUR',
    sourceAt: 1_790_323_200_000, selectedAt: 1_790_323_300_000,
  };
}

describe('persisted selection compatibility across the stricter identity boundary', () => {
  it('retains a saved alternative with explicit thirdParty identity until a variant trend becomes available', async () => {
    const card = sourceCard(rootCases[0]);
    const variant: TcgVariant = { type: 'Normal', size: 'Standard', thirdParty: { cardmarket: 805531 } };
    card.variants_detailed = [variant];
    const entry = savedEntry(card, 805531), selection = savedSelection(entry);
    const original = structuredClone({ card, entry, selection });

    // The card-wide trend is not this printing's trend. The existing confirmed value survives.
    expect(manualSelectionPrice(entry, selection)).toBe(4.44);
    expect(await resolveCollectionPrice(entry, async () => card, selection)).toMatchObject({ price: 4.44, source: 'manual', failed: false });
    const withTrend = { ...card, variants_detailed: [{ ...variant, pricing: { cardmarket: { trend: 4.56, unit: 'EUR' } } }] };
    expect(await resolveCollectionPrice(entry, async () => withTrend, selection)).toMatchObject({ price: 4.56, source: 'trend', failed: false });
    expect({ card, entry, selection }).toEqual(original);
  });

  it('does not rewrite a saved selection when its product was evidenced only by the card-wide root', async () => {
    const card = sourceCard(rootCases[0]);
    const entry = savedEntry(card, rootCases[0].productId), selection = savedSelection(entry);
    const original = structuredClone({ card, entry, selection });

    // Valid persisted selection metadata is not independent proof of the catalog printing.
    expect(manualSelectionPrice(entry, selection)).toBe(4.44);
    expect(await resolveCollectionPrice(entry, async () => card, selection)).toMatchObject({ price: null, source: null, failed: false });
    expect({ card, entry, selection }).toEqual(original);
  });

  it('does not let a saved alternative bypass conflicting identity declarations on a printing', async () => {
    const card = sourceCard(rootCases[0]);
    card.variants_detailed = [{ type: 'Normal', size: 'Standard', thirdParty: { cardmarket: 805531 },
      pricing: { cardmarket: { idProduct: rootCases[0].productId, trend: null } },
    }];
    const entry = savedEntry(card, 805531), selection = savedSelection(entry);
    const original = structuredClone({ card, entry, selection });

    expect(manualSelectionPrice(entry, selection)).toBe(4.44);
    expect(await resolveCollectionPrice(entry, async () => card, selection)).toMatchObject({ price: null, source: null, failed: false });
    expect({ card, entry, selection }).toEqual(original);
  });
});

describe('unreviewed card-wide prices cannot establish exact printing identity', () => {
  it.each(rootCases)('$id does not inherit root product $productId for its sole declared printing', (row) => {
    const card = sourceCard(row);
    expect(exactCardmarketProductId(card, card.variants_detailed![0])).toBeNull();
  });

  it.each(rootCases)('$id does not show the shared root trend as its exact market price', (row) => {
    const card = sourceCard(row);
    expect(exactTrendPrice(card, card.variants_detailed![0])).toBeNull();
  });

  it.each(rootCases)('$id cannot select a printing solely because the saved product equals its shared root', (row) => {
    const card = sourceCard(row);
    expect(variantForCollectionEntry(card, savedEntry(card, row.productId))).toBeNull();
  });

  it.each(rootCases)('$id remains honestly unpriced through the actual collection resolver', async (row) => {
    const card = sourceCard(row), entry = savedEntry(card, row.productId);
    const original = structuredClone({ card, entry });
    expect(await resolveCollectionPrice(entry, async () => card)).toMatchObject({ price: null, failed: false, source: null });
    expect({ card, entry }).toEqual(original);
  });

  it.each(rootCases)('$id does not offer an alternative from the same unverified root when trend is absent', (row) => {
    const card = sourceCard(row);
    card.pricing!.cardmarket!.trend = null;
    expect(alternativePriceCandidates(card, card.variants_detailed![0])).toEqual([]);
  });

  it.each(rootCases)('$id without detailed variants does not convert root pricing into printing evidence', async (row) => {
    const card = sourceCard(row);
    delete card.variants_detailed;
    expect(await resolveCollectionPrice(savedEntry(card, row.productId), async () => card)).toMatchObject({ price: null, failed: false, source: null });
  });

  it.each(rootCases)('$id shared without a saved product does not expose a root price or root date', (row) => {
    const card = sourceCard(row), entry = { ...savedEntry(card, row.productId), externalProductId: null };
    const result = sharedCardDto(entry, { slotPosition: 0 }, card, true);
    expect(result?.cardId).toBe(row.id);
    expect(result?.price).toMatchObject({ amount: null, asOf: null });
  });

  it.each(rootCases)('$id shared without detailed variants does not restore root price or root date', (row) => {
    const card = sourceCard(row);
    delete card.variants_detailed;
    const result = sharedCardDto(savedEntry(card, row.productId), { slotPosition: 0 }, card, true);
    expect(result?.cardId).toBe(row.id);
    expect(result?.price).toMatchObject({ amount: null, asOf: null });
  });
});

describe('variant-declared thirdParty identity is not permission to borrow root prices', () => {
  it.each([0, -1, 1.5, NaN, Infinity, '279739'])('rejects an invalid explicit thirdParty declaration (%s)', (productId) => {
    const card = sourceCard(rootCases[0]);
    const variant = { ...card.variants_detailed![0], thirdParty: { cardmarket: productId },
      pricing: { cardmarket: { ...card.pricing!.cardmarket! } },
    } as unknown as TcgVariant;
    expect(exactCardmarketProductId(card, variant)).toBeNull();
    expect(exactTrendPrice(card, variant)).toBeNull();
    expect(alternativePriceCandidates(card, variant)).toEqual([]);
  });

  it.each(['Normal', 'Holo', 'Reverse Holo'])('retains consistent own/thirdParty identity and the correct %s price family', (type) => {
    const card = sourceCard(rootCases[0]);
    const variant: TcgVariant = { type, size: 'Standard', thirdParty: { cardmarket: 805531 },
      pricing: { cardmarket: { idProduct: 805531, trend: 4.56, 'trend-holo': 7.89, unit: 'EUR' } },
    };
    expect(exactCardmarketProductId(card, variant)).toBe(805531);
    expect(exactTrendPrice(card, variant)).toBe(type === 'Reverse Holo' ? 7.89 : 4.56);
  });

  it('does not bypass quarantine through a thirdParty-only identity', () => {
    const card = { ...sourceCard(rootCases[0]), id: 'swsh11-201' };
    const variant: TcgVariant = { type: 'Holo', thirdParty: { cardmarket: 670816 }, pricing: { cardmarket: { trend: 123.45 } } };
    expect(exactCardmarketProductId(card, variant)).toBeNull();
    expect(exactTrendPrice(card, variant)).toBeNull();
  });

  it('keeps an explicit thirdParty printing ID even when the root namesake differs', () => {
    const card = sourceCard(rootCases[0]);
    const variant = { ...card.variants_detailed![0], thirdParty: { cardmarket: 805531 } } as TcgVariant;
    card.variants_detailed = [variant];
    expect(exactCardmarketProductId(card, variant)).toBe(805531);
    expect(exactTrendPrice(card, variant)).toBeNull();
    expect(alternativePriceCandidates(card, variant)).toEqual([]);
    expect(variantForCollectionEntry(card, savedEntry(card, 805531))).toBe(variant);
  });

  it('does not borrow root prices even if root and explicit thirdParty IDs match', () => {
    const card = sourceCard(rootCases[0]);
    const variant = { ...card.variants_detailed![0], thirdParty: { cardmarket: rootCases[0].productId } } as TcgVariant;
    card.variants_detailed = [variant];
    expect(exactCardmarketProductId(card, variant)).toBe(rootCases[0].productId);
    expect(exactTrendPrice(card, variant)).toBeNull();
    expect(alternativePriceCandidates(card, variant)).toEqual([]);
  });

  it('uses prices located on the same declared printing without merging any root field', () => {
    const card = sourceCard(rootCases[0]);
    const variant = { ...card.variants_detailed![0], thirdParty: { cardmarket: 805531 },
      pricing: { cardmarket: { trend: 4.56, unit: 'EUR', updated: '2026-09-24T08:00:00Z' } },
    } as TcgVariant;
    card.variants_detailed = [variant];
    expect(exactCardmarketProductId(card, variant)).toBe(805531);
    expect(exactTrendPrice(card, variant)).toBe(4.56);
    expect(alternativePriceCandidates(card, variant)).toEqual([]);
    expect(sharedCardDto(savedEntry(card, 805531), { slotPosition: 0 }, card, true)?.price).toEqual({
      amount: 4.56, asOf: '2026-09-24T08:00:00Z', currency: 'EUR', source: 'Cardmarket',
    });
  });

  it('rejects conflicting identity declarations inside the same printing', () => {
    const card = sourceCard(rootCases[0]);
    const variant = { ...card.variants_detailed![0], thirdParty: { cardmarket: 805531 },
      pricing: { cardmarket: { ...card.pricing!.cardmarket! } },
    } as TcgVariant;
    card.variants_detailed = [variant];
    expect(exactCardmarketProductId(card, variant)).toBeNull();
    expect(exactTrendPrice(card, variant)).toBeNull();
    expect(alternativePriceCandidates(card, variant)).toEqual([]);
    expect(variantForCollectionEntry(card, savedEntry(card, rootCases[0].productId))).toBeNull();
  });
});

describe('positive exact-printing and ambiguity controls', () => {
  it.each(rootCases)('$id keeps an explicitly variant-declared product and price', async (row) => {
    const card = sourceCard(row);
    card.variants_detailed![0].pricing = { cardmarket: { ...card.pricing!.cardmarket! } };
    const variant = card.variants_detailed![0];
    expect(exactCardmarketProductId(card, variant)).toBe(row.productId);
    expect(exactTrendPrice(card, variant)).toBe(123.45);
    expect(await resolveCollectionPrice(savedEntry(card, row.productId), async () => card)).toMatchObject({ price: 123.45, failed: false, source: 'trend' });
  });

  it('keeps an explicit Full Art product separate from a different root namesake', () => {
    const card: TcgCardDetail = {
      id: 'sv08.5-137', localId: '137', name: 'Freunde aus Paldea',
      set: { id: 'sv08.5', name: 'Test', cardCount: { official: 131 } },
      pricing: { cardmarket: { idProduct: 805503, trend: 123.45, unit: 'EUR' } },
      variants_detailed: [{ variantId: 'full-art', type: 'Holo', size: 'Standard',
        pricing: { cardmarket: { idProduct: 805531, trend: 67.89, unit: 'EUR' } } }],
    };
    expect(exactCardmarketProductId(card, card.variants_detailed![0])).toBe(805531);
    expect(exactTrendPrice(card, card.variants_detailed![0])).toBe(67.89);
  });

  it('already rejects root inheritance when multiple printings exist', () => {
    const card = sourceCard(rootCases[0]);
    card.variants_detailed!.push({ variantId: 'reverse', type: 'Reverse Holo', size: 'Standard' });
    for (const variant of card.variants_detailed!) {
      expect(exactCardmarketProductId(card, variant)).toBeNull();
      expect(exactTrendPrice(card, variant)).toBeNull();
    }
  });

  it('retains the existing exact-pair quarantine', () => {
    const card: TcgCardDetail = {
      id: 'swsh11-201', localId: '201', name: 'Giratina VSTAR', set: { id: 'swsh11', name: 'Test' },
      variants_detailed: [{ type: 'Holo', size: 'Standard',
        pricing: { cardmarket: { idProduct: 670816, trend: 123.45 } } }],
    };
    expect(exactCardmarketProductId(card, card.variants_detailed![0])).toBeNull();
    expect(exactTrendPrice(card, card.variants_detailed![0])).toBeNull();
  });
});
