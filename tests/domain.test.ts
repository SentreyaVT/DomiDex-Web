import { describe, expect, it } from 'vitest';
import { canonicalTcgCardId, exactCardmarketProductId, exactTrendPrice, variantForCollectionEntry, type CollectionEntry, type TcgCardDetail } from '@/lib/domain';

const card: TcgCardDetail = {
  id: 'sv03.5-001', localId: '001', name: 'Bisasam', set: { id: 'sv03.5', name: '151' },
  pricing: { cardmarket: { idProduct: 733596, trend: 0.1, 'trend-holo': 0.34, unit: 'EUR' } },
};

describe('exactTrendPrice', () => {
  it('uses the declared normal Cardmarket trend only', () => {
    expect(exactTrendPrice(card, { type: 'Normal', pricing: card.pricing })).toBe(0.1);
  });

  it('uses trend for regular Holo and trend-holo only for Reverse', () => {
    expect(exactTrendPrice(card, { type: 'Holo', pricing: card.pricing })).toBe(0.1);
    expect(exactTrendPrice(card, { type: 'Reverse', pricing: card.pricing })).toBe(0.34);
  });

  it('uses the base trend for a Holo-only Cardmarket product', () => {
    const holoOnly = { cardmarket: { idProduct: 805370, trend: 19.8, 'trend-holo': 0, unit: 'EUR' } };
    expect(exactTrendPrice(card, { type: 'Holo', pricing: holoOnly })).toBe(19.8);
  });

  it.each([undefined, null, 0, -1, Infinity, NaN])('never borrows the regular price for a missing/invalid Reverse field (%s)', (reversePrice) => {
    const pricing = { cardmarket: { idProduct: 733596, trend: 99, 'trend-holo': reversePrice } };
    expect(exactTrendPrice(card, { type: 'Reverse', pricing })).toBeNull();
  });

  it('never borrows the Reverse field for a Holo card with no regular trend', () => {
    expect(exactTrendPrice(card, { type: 'Holo', pricing: { cardmarket: { idProduct: 733596, trend: 0, 'trend-holo': 12 } } })).toBeNull();
  });

  it.each([
    ['swsh11-201', 670816, 1.38], ['sv03-062', 781858, 0.23],
  ])('quarantines the reviewed incorrect source/product pair %s without persisting a replacement', (id, idProduct, trend) => {
    const detail = { ...card, id: String(id) };
    const variant = { type: 'Holo', pricing: { cardmarket: { idProduct: Number(idProduct), trend: Number(trend) } } };
    expect(exactTrendPrice(detail, variant)).toBeNull();
    expect(exactCardmarketProductId(detail, variant)).toBeNull();
  });

  // Contract change: these three old fixtures supplied only card-wide prices.
  // A known sibling/product pair does not itself prove a requested printing. Keep
  // the positive control with explicit variant evidence, plus the root-only denial.
  it.each([['swsh11-130', 670816], ['sv03-057', 781858], ['sv03-062', 725142]])('retains an explicitly declared sibling/base printing %s', (id, idProduct) => {
    const detail = { ...card, id: String(id) };
    const variant = { type: 'Holo', pricing: { cardmarket: { idProduct: Number(idProduct), trend: 0.23 } } };
    expect(exactTrendPrice(detail, variant)).toBe(0.23);
    expect(exactCardmarketProductId(detail, variant)).toBe(idProduct);
  });

  it.each([['swsh11-130', 670816], ['sv03-057', 781858], ['sv03-062', 725142]])('no longer treats old root-only fixture %s as printing evidence', (id, idProduct) => {
    const detail = { ...card, id: String(id), pricing: { cardmarket: { idProduct: Number(idProduct), trend: 0.23 } } };
    expect(exactTrendPrice(detail, { type: 'Holo' })).toBeNull();
    expect(exactCardmarketProductId(detail, { type: 'Holo' })).toBeNull();
  });

  it('never substitutes zero or a different price field', () => {
    expect(exactTrendPrice(card, { type: 'Normal', pricing: { cardmarket: { idProduct: 733596, trend: 0, 'trend-holo': 0 } } })).toBeNull();
    expect(exactTrendPrice(card, { type: 'Normal', pricing: { cardmarket: { idProduct: 733596, trend: null, 'trend-holo': 2 } } })).toBeNull();
  });
  it.each([undefined, 0, -1, 1.2, Infinity, NaN])('does not display a price without a valid exact product ID (%s)', (idProduct) => {
    expect(exactTrendPrice(card, { type: 'Normal', pricing: { cardmarket: { idProduct, trend: 99 } } })).toBeNull();
  });
  it('does not render non-finite amounts or label foreign currency as EUR', () => {
    expect(exactTrendPrice(card, { type: 'Normal', pricing: { cardmarket: { idProduct: 1, trend: Infinity } } })).toBeNull();
    expect(exactTrendPrice(card, { type: 'Normal', pricing: { cardmarket: { idProduct: 1, trend: 10, unit: 'USD' } } })).toBeNull();
  });

  it.each([
    '1steditionholofoil',
    'unlimitedholofoil',
    'reverseholofoil',
    '1stedition',
    'unlimited',
    'holofoil',
  ])('normalizes the Android legacy suffix %s', (suffix) => {
    expect(canonicalTcgCardId(`base1-058-${suffix}`)).toBe('base1-058');
  });

  it('normalizes Web aliases without truncating a promo identity', () => {
    expect(canonicalTcgCardId('me04-089-normal')).toBe('me04-089');
    expect(canonicalTcgCardId('sv08-001-reverse-holo')).toBe('sv08-001');
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

  it('does not treat a shared Cardmarket product id as an exact variant', () => {
    const detailed = { ...card, variants_detailed: [
      { type: 'Holo', size: 'Standard', foil: 'Cosmos', pricing: { cardmarket: { idProduct: 7 } } },
      { type: 'Holo', size: 'Standard', foil: 'Galaxy', pricing: { cardmarket: { idProduct: 7 } } },
    ] };
    const entry = { finish: 'Holo', variant: 'Standard', externalProductId: 7 } as CollectionEntry;
    expect(variantForCollectionEntry(detailed, entry)).toBeNull();
  });
});
