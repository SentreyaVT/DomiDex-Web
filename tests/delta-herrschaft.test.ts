import { describe, expect, it } from 'vitest';
import { DELTA_HERRSCHAFT, hasCompleteDeltaHerrschaft, officializeDeltaCard, officializeDeltaSet } from '@/lib/delta-herrschaft';
import { dlrCardmarketMappingRecords } from '@/lib/dlr-cardmarket-mapping';
import type { TcgCardDetail, TcgSetDetail } from '@/lib/domain';

describe('official Delta-Herrschaft catalogue contract', () => {
  const cards = Array.from({ length: 141 }, (_, index) => ({
    id: `me06-${String(index + 1).padStart(3, '0')}`,
    localId: String(index + 1).padStart(3, '0'), name: 'Upstream', image: 'https://assets.tcgdex.net/de/me/me06/card',
  }));

  it('keeps every official DLR slot and corrects the known German source errors', () => {
    const set = officializeDeltaSet({ id: 'me06', name: 'Delta-Herrschaft', cards } as TcgSetDetail);
    expect(set.name).toBe(DELTA_HERRSCHAFT.name);
    expect(set.cardCount).toEqual({ official: 103, total: 141 });
    expect(set.cards).toHaveLength(141);
    expect(set.cards[93]).toMatchObject({ name: 'Legendäre Lavabröhe' });
    expect(set.cards[131]).toMatchObject({ name: 'Sprudelnde Wasser-Energie', rarity: 'Ultra Rare' });
    expect(hasCompleteDeltaHerrschaft(set)).toBe(true);
  });

  it('does not present a partial DLR provider response as a master set', () => {
    expect(hasCompleteDeltaHerrschaft({ id: 'me06', name: 'Delta-Herrschaft', cards: cards.slice(0, 140) } as TcgSetDetail)).toBe(false);
  });

  it('does not present a DLR slot without a verified image source as complete', () => {
    expect(hasCompleteDeltaHerrschaft({
      id: 'me06', name: 'Delta-Herrschaft', cards: cards.map((card, index) => index === 76 ? { ...card, image: '' } : card),
    } as TcgSetDetail)).toBe(false);
  });

  it('uses the official special-rarity label for a detail response', () => {
    const detail = officializeDeltaCard({
      id: 'me06-141', localId: '141', name: 'Mega-Rayquaza-ex', set: { id: 'me06', name: 'Delta-Herrschaft' },
    });
    expect(detail).toMatchObject({ rarity: 'Mega Hyper Rare', set: { name: DELTA_HERRSCHAFT.name } });
  });

  it('exposes only reviewed DLR normal printings as Cardmarket products', () => {
    const records = dlrCardmarketMappingRecords();
    expect(records).toHaveLength(141);
    expect(records.filter((record) => record.status === 'VERIFIED')).toHaveLength(62);
    expect(records.filter((record) => record.status === 'NEEDS_REVIEW')).toHaveLength(69);
    expect(records.filter((record) => record.status === 'UNMATCHED')).toHaveLength(10);
    const detail = officializeDeltaCard({
      id: 'me06-001', localId: '001', name: 'Skaraborn',
      set: { id: 'me06', name: 'Delta-Herrschaft' },
      pricing: { cardmarket: { idProduct: 918810, trend: .02, unit: 'EUR' } },
      variants_detailed: [{ type: 'normal', size: 'Standard' }, { type: 'reverse', size: 'Standard' }],
    } as TcgCardDetail);
    expect(detail.variants_detailed?.[0].pricing?.cardmarket?.idProduct).toBe(918810);
    expect(detail.variants_detailed?.[0].pricing?.cardmarket?.trend).toBe(.02);
    expect(detail.variants_detailed?.[1].pricing?.cardmarket).toBeUndefined();

    const independentlyVerified = officializeDeltaCard({
      id: 'me06-055', localId: '055', name: 'Nidoran♀',
      set: { id: 'me06', name: 'Delta-Herrschaft' },
      variants_detailed: [{ type: 'normal', size: 'Standard' }],
    } as TcgCardDetail);
    expect(independentlyVerified.variants_detailed?.[0].pricing?.cardmarket?.idProduct).toBe(918878);
  });
});
