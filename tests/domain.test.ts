import { describe, expect, it } from 'vitest';
import { canonicalTcgCardId, exactTrendPrice, variantForCollectionEntry, type CollectionEntry, type TcgCardDetail } from '@/lib/domain';

const card: TcgCardDetail = {
  id: 'sv03.5-001', localId: '001', name: 'Bisasam', set: { id: 'sv03.5', name: '151' },
  pricing: { cardmarket: { idProduct: 733596, trend: 0.1, 'trend-holo': 0.34, unit: 'EUR' } },
};

describe('exactTrendPrice', () => {
  it('uses the declared normal Cardmarket trend only', () => {
    expect(exactTrendPrice(card, { type: 'Normal', pricing: card.pricing })).toBe(0.1);
  });

  it('uses the declared holo trend for Holo and Reverse', () => {
    expect(exactTrendPrice(card, { type: 'Holo', pricing: card.pricing })).toBe(0.34);
    expect(exactTrendPrice(card, { type: 'Reverse', pricing: card.pricing })).toBe(0.34);
  });

  it('never substitutes zero or a different price field', () => {
    expect(exactTrendPrice({ ...card, pricing: { cardmarket: { trend: 0, 'trend-holo': 0 } } }, { type: 'Normal' })).toBeNull();
    expect(exactTrendPrice({ ...card, pricing: { cardmarket: { trend: null, 'trend-holo': 2 } } }, { type: 'Normal' })).toBeNull();
  });

  it('normalizes only known Android variant suffixes', () => {
    expect(canonicalTcgCardId('me04-089-normal')).toBe('me04-089');
    expect(canonicalTcgCardId('sv08-001-reverseholofoil')).toBe('sv08-001');
    expect(canonicalTcgCardId('svp-173')).toBe('svp-173');
  });

  it('selects a price variant by exact Cardmarket product before visual labels', () => {
    const detailed = { ...card, variants_detailed: [
      { type: 'Holo', size: 'Standard', foil: 'Cosmos', pricing: { cardmarket: { idProduct: 1, 'trend-holo': 1 } } },
      { type: 'Holo', size: 'Standard', foil: 'Galaxy', pricing: { cardmarket: { idProduct: 2, 'trend-holo': 2 } } },
    ] };
    const entry = { finish: 'Holo', variant: 'Standard · Cosmos', externalProductId: 2 } as CollectionEntry;
    expect(variantForCollectionEntry(detailed, entry)?.pricing?.cardmarket?.idProduct).toBe(2);
  });

  it('does not guess between ambiguous variants', () => {
    const detailed = { ...card, variants_detailed: [
      { type: 'Holo', size: 'Standard', foil: 'Cosmos' },
      { type: 'Holo', size: 'Standard', foil: 'Galaxy' },
    ] };
    const entry = { finish: 'Holo', variant: 'Standard', externalProductId: null } as CollectionEntry;
    expect(variantForCollectionEntry(detailed, entry)).toBeNull();
  });
});
