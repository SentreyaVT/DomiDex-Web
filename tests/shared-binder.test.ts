import { describe, expect, it, vi } from 'vitest';
import * as domain from '@/lib/domain';
import type { CollectionEntry, TcgCardDetail } from '@/lib/domain';
import type { CollectionPriceSelection } from '@/lib/price-alternatives';
import { sharedCardDto, sharedPriceSelectionNeeded, sharedVisualId } from '@/lib/shared-binder';

const entry = {
  sourceCardId: 'sv08.5-137', sourceSetId: 'sv08.5', setId: 'sv08.5', collectorNumber: '137/131',
  finish: 'Normal', variant: 'Standard', externalProductId: 123, name: 'private label', ownerUid: 'private-uid',
  notes: 'secret note', quantity: 50, acquisitionPriceMinor: 4200, imageUrl: 'https://private.invalid/image?token=secret',
} as CollectionEntry;
const detail: TcgCardDetail = {
  id: 'sv08.5-137', localId: '137', name: 'Öffentliche Karte', set: { id: 'sv08.5', name: 'Öffentliches Set' },
  image: 'https://assets.tcgdex.net/de/sv/sv08.5/137', variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: { idProduct: 123, trend: 5, unit: 'EUR', updated: '2026-09-22' } } }],
};
const placement = { slotPosition: 4, holoEffectId: 'galaxy', holoIntensity: .6 };

function missingTrendFixture() {
  const owned: CollectionEntry = { ...entry, syncId: 'selection-entry', deleted: false, language: 'DE',
    externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD' };
  const card: TcgCardDetail = { ...detail, variants_detailed: [
    { type: 'Normal', size: 'Other product', pricing: { cardmarket: { idProduct: 124, trend: 99, unit: 'EUR' } } },
    { type: 'Normal', size: 'Standard', pricing: { cardmarket: { idProduct: 123, trend: null, avg: 12.34,
      unit: 'EUR', updated: '2026-09-22' } } },
    { type: 'Reverse Holo', size: 'Reverse Holo', pricing: { cardmarket: { idProduct: 125, 'trend-holo': 88, unit: 'EUR' } } },
  ] };
  const selected: CollectionPriceSelection = { schemaVersion: 1, ownerUid: owned.ownerUid, entrySyncId: owned.syncId,
    revision: 1, lastMutationId: 'selection-mutation', updatedAtClient: 1700000001000, cleared: false,
    sourceSetId: owned.sourceSetId, sourceCardId: owned.sourceCardId, collectorNumber: owned.collectorNumber,
    language: owned.language, finish: owned.finish, variant: owned.variant, productId: 123,
    metric: 'normal_avg_sell', amountMinor: 1234, currency: 'EUR', sourceAt: 1700000000000, selectedAt: 1700000001000 };
  const expected = { slot: 4, cardId: 'sv08.5-137', name: 'Öffentliche Karte', setName: 'Öffentliches Set',
    collectorNumber: '137', image: 'https://assets.tcgdex.net/de/sv/sv08.5/137/high.webp', finish: 'Normal',
    holoEffectId: 'galaxy', holoIntensity: .6 };
  return { owned, card, selected, expected };
}

describe('shared binder explicit public DTO', () => {
  it('keeps the Android anniversary ID without changing card or price identity', () => {
    const result = sharedCardDto(entry, { ...placement, holoEffectId: 'anniversary_30' }, detail, true)!;
    expect(result.holoEffectId).toBe('anniversary_30');
    expect(result.cardId).toBe('sv08.5-137');
    expect(result.price?.amount).toBe(5);
  });
  it('never serializes owner data, custom URLs or prices by default', () => {
    const value = sharedCardDto(entry, placement, detail, false)!;
    expect(Object.keys(value).sort()).toEqual(['slot', 'cardId', 'name', 'setName', 'collectorNumber', 'image', 'finish', 'holoEffectId', 'holoIntensity'].sort());
    expect(JSON.stringify(value)).not.toMatch(/private|secret|quantity|acquisition|ownerUid/);
    expect(value).toMatchObject({ name: detail.name, holoEffectId: 'galaxy', holoIntensity: .6 });
  });
  it('uses exact canonical identity above printed total without name matching', () => {
    expect(sharedCardDto(entry, placement, detail, true)?.price?.amount).toBe(5);
    expect(sharedCardDto(entry, placement, { ...detail, id: 'sv08.5-136' }, true)).toBeNull();
    expect(sharedCardDto(entry, placement, { ...detail, set: { id: 'sv08', name: 'Other' } }, true)).toBeNull();
    expect(sharedCardDto(entry, placement, { ...detail, localId: '138' }, true)).toBeNull();
  });
  it('does not substitute products or another foil variant', () => {
    expect(sharedCardDto({ ...entry, externalProductId: 456 }, placement, detail, true)?.price?.amount).toBeNull();
    expect(sharedCardDto({ ...entry, finish: 'Reverse Holo' }, placement, detail, true)?.price?.amount).toBeNull();
  });
  it('allows only official catalog assets and finite visual intensity', () => {
    expect(sharedCardDto(entry, { ...placement, holoIntensity: Infinity }, { ...detail, image: 'https://firebasestorage.googleapis.com/private?token=secret' }, false)).toMatchObject({ image: null, holoIntensity: 0 });
    expect(sharedVisualId('https://private.invalid/avatar', true)).toBe('nebula');
  });

  it('resolves each missing-trend DTO printing once while preserving the complete selected-price projection', () => {
    const f = missingTrendFixture();
    // This spy delegates to the real resolver: no fabricated printing, price or decision.
    const resolver = vi.spyOn(domain, 'variantForCollectionEntry');
    try {
      expect(sharedPriceSelectionNeeded(f.owned, f.card)).toBe(true);
      expect(resolver).toHaveBeenCalledExactlyOnceWith(f.card, f.owned);
      resolver.mockClear();
      const before = structuredClone(f);
      for (let index = 0; index < 64; index++) {
        const owned = { ...f.owned, syncId: `selection-entry-${index}` };
        const selected = { ...f.selected, entrySyncId: owned.syncId };
        const slot = { ...placement, slotPosition: index };
        expect(sharedCardDto(owned, slot, f.card, true, selected)).toEqual({
          ...f.expected, slot: index,
          price: { amount: 12.34, currency: 'EUR', source: 'Cardmarket',
            asOf: '2023-11-14T22:13:20.000Z', basis: 'selection' },
        });
      }
      expect(f).toEqual(before);
      // A deterministic work count, not elapsed time, cloud cost or an O(N) removal claim.
      expect(resolver).toHaveBeenCalledTimes(64);
    } finally { resolver.mockRestore(); }
  });

  it.each(['selected', 'trend', 'cleared', 'foreign-selection', 'different-product', 'image-only', 'reverse'] as const)(
    'retains the complete public DTO and sidecar eligibility for %s', (kind) => {
      const f = missingTrendFixture();
      const printing = f.card.variants_detailed![1];
      const pricing = printing.pricing!.cardmarket!;
      if (kind === 'trend') pricing.trend = 5;
      if (kind === 'cleared') f.selected.cleared = true;
      if (kind === 'foreign-selection') f.selected.ownerUid = 'different-private-owner';
      if (kind === 'different-product') pricing.idProduct = 126;
      if (kind === 'reverse') {
        f.owned.finish = f.selected.finish = printing.type = 'Reverse Holo';
        pricing.trend = 999; // A normal trend must not displace a Reverse selection.
        f.selected.metric = 'reverse_holo_low'; f.selected.amountMinor = 777;
      }
      const before = structuredClone(f);
      expect(sharedPriceSelectionNeeded(f.owned, f.card)).toBe(kind !== 'trend' && kind !== 'different-product');
      const hasSelection = kind === 'selected' || kind === 'reverse';
      const expectedPrice = { amount: kind === 'trend' ? 5 : hasSelection ? kind === 'reverse' ? 7.77 : 12.34 : null,
        currency: 'EUR', source: 'Cardmarket',
        asOf: hasSelection ? '2023-11-14T22:13:20.000Z' : kind === 'different-product' ? null : '2026-09-22',
        ...(hasSelection ? { basis: 'selection' } : {}),
      };
      const result = sharedCardDto(f.owned, placement, f.card, kind !== 'image-only', f.selected);
      expect(result).toEqual({ ...f.expected,
        finish: kind === 'different-product' ? 'Unbestimmte Druckvariante' : kind === 'reverse' ? 'Reverse Holo' : 'Normal',
        ...(kind === 'image-only' ? {} : { price: expectedPrice }),
      });
      expect(JSON.stringify(result)).not.toMatch(/private|secret|quantity|acquisition|ownerUid|selection-entry|selectedAt|revision/);
      expect(f).toEqual(before);
    },
  );
});
