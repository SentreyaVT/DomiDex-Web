// Observed excerpts below were read from the verified 2026-09-25 public snapshot,
// cards/sv10-096.json, cards/sv03-125.json and cards/sv10.5b-034.json.
// All other cases are explicitly synthetic boundary controls; no network or RPC.
import { describe, expect, it } from 'vitest';
import { collectionVariantLabel, exactCardmarketProductId, exactTrendPrice } from '@/lib/domain';

function printing(productId, trend, fields = {}) {
  return {
    type: 'Holo', size: 'Standard',
    thirdParty: { cardmarket: productId },
    pricing: { cardmarket: { idProduct: productId, trend, unit: 'EUR' } },
    ...fields,
  };
}

const observed = [
  {
    id: 'sv10-096', expectedLabel: 'Standard',
    ambiguous: [
      printing(825969, 0.07, { variantId: 'jr7oetx1mqug9' }),
      printing(828209, 60.53, { variantId: 'jr7oetx1mqug9' }),
    ],
    healthy: printing(826181, 19.45, { variantId: '555jb0efopmyclvkikic41', stamp: ['Set-Logo'] }),
  },
  {
    id: 'sv03-125', expectedLabel: 'Standard · Stempel: player-rewards-program',
    ambiguous: [
      printing(756342, 17.77, { variantId: 'mtltux8quqoc7vwp24c9zzhgmzduu8xcik8', stamp: ['player-rewards-program'] }),
      printing(782239, 12.82, { variantId: 'mtltux8quqoc7vwp24c9zzhgmzduu8xcik8', stamp: ['player-rewards-program'] }),
      printing(811099, 5.96, { variantId: 'mtltux8quqoc7vwp24c9zzhgmzduu8xcik8', stamp: ['player-rewards-program'] }),
    ],
    healthy: printing(725205, 3.63, { variantId: 'jr7oetx1mqug9' }),
  },
  {
    id: 'sv10.5b-034', expectedLabel: 'Standard · Stempel: player-rewards-program',
    ambiguous: [
      printing(864406, 2.11, { variantId: 'mtltux8quqoc7vwp24c9zzhgmzduu8xcik8', stamp: ['player-rewards-program'] }),
      printing(894193, 1.62, { variantId: 'mtltux8quqoc7vwp24c9zzhgmzduu8xcik8', stamp: ['player-rewards-program'] }),
    ],
    healthy: printing(835966, 0.59, { variantId: 'jr7oetx1mqug9' }),
  },
];

function card(id, printings) {
  return { id, localId: id.slice(id.lastIndexOf('-') + 1), name: 'Public identity fixture',
    set: { id: id.slice(0, id.lastIndexOf('-')), name: 'Public fixture set' }, variants_detailed: printings };
}

function assertRejected(detail, variants) {
  const before = structuredClone(detail);
  for (const selected of variants) {
    expect(exactCardmarketProductId(detail, selected), `ambiguous product on ${detail.id}`).toBeNull();
    expect(exactTrendPrice(detail, selected), `ambiguous price on ${detail.id}`).toBeNull();
  }
  expect(detail).toEqual(before);
}

describe('same source printing cannot silently choose one of conflicting product identities', () => {
  for (const fixture of observed) {
    it.each(['forward', 'reverse'])(`${fixture.id} rejects every ambiguous member in %s source order`, (order) => {
      const variants = [...fixture.ambiguous, fixture.healthy];
      const detail = card(fixture.id, order === 'reverse' ? variants.reverse() : variants);
      expect(new Set(fixture.ambiguous.map((item) => item.variantId)).size).toBe(1);
      expect(new Set(fixture.ambiguous.map(collectionVariantLabel))).toEqual(new Set([fixture.expectedLabel]));
      assertRejected(detail, fixture.ambiguous);
      expect(exactCardmarketProductId(detail, fixture.healthy)).toBe(fixture.healthy.thirdParty.cardmarket);
      expect(exactTrendPrice(detail, fixture.healthy)).toBe(fixture.healthy.pricing.cardmarket.trend);
    });
  }

  it('keeps repeated identical declarations valid without mutating or deduplicating input', () => {
    const first = printing(900001, 4.56, { variantId: 'same-source-id' });
    const second = structuredClone(first);
    const detail = card('synthetic-001', [first, second]);
    const before = structuredClone(detail);
    for (const selected of detail.variants_detailed) {
      expect(exactCardmarketProductId(detail, selected)).toBe(900001);
      expect(exactTrendPrice(detail, selected)).toBe(4.56);
    }
    expect(detail).toEqual(before);
    expect(detail.variants_detailed).toHaveLength(2);
  });

  it('detects differing valid IDs even when one sibling declares only pricing and the other only thirdParty', () => {
    const first = { type: 'Holo', size: 'Standard', variantId: 'same-source-id', thirdParty: { cardmarket: 900001 } };
    const second = { type: 'Holo', size: 'Standard', variantId: 'same-source-id', pricing: { cardmarket: { idProduct: 900002, unit: 'EUR', trend: 12.34 } } };
    for (const variants of [[first, second], [second, first]]) assertRejected(card('synthetic-001', variants), variants);
  });

  it('does not hide contradictory sibling declarations behind that sibling already returning null', () => {
    const first = printing(900001, 4.56, { variantId: 'same-source-id' });
    const second = printing(900002, 12.34, { variantId: 'same-source-id', thirdParty: { cardmarket: 900003 } });
    for (const variants of [[first, second], [second, first]]) assertRejected(card('synthetic-001', variants), variants);
  });

  it.each([
    { kind: 'finish', fields: { type: 'Normal' } },
    { kind: 'size', fields: { size: 'Jumbo' } },
    { kind: 'subtype', fields: { subtype: 'schattenlos' } },
    { kind: 'stamp', fields: { stamp: ['Event'] } },
    { kind: 'foil', fields: { foil: 'Kosmos' } },
  ])('does not poison a distinct $kind sharing the source ID', ({ fields }) => {
    const first = printing(900001, 4.56, { variantId: 'shared-source-id' });
    const second = printing(900002, 12.34, { variantId: 'shared-source-id', ...fields });
    for (const variants of [[first, second], [second, first]]) {
      const detail = card('synthetic-001', variants);
      const before = structuredClone(detail);
      expect(exactCardmarketProductId(detail, first)).toBe(900001);
      expect(exactTrendPrice(detail, first)).toBe(4.56);
      expect(exactCardmarketProductId(detail, second)).toBe(900002);
      expect(exactTrendPrice(detail, second)).toBe(12.34);
      expect(detail).toEqual(before);
    }
  });

  it('does not merge different source IDs merely because finish and full label are equal', () => {
    const first = printing(900001, 4.56, { variantId: 'source-one' });
    const second = printing(900002, 12.34, { variantId: 'source-two' });
    for (const variants of [[first, second], [second, first]]) {
      const detail = card('synthetic-001', variants);
      expect(exactCardmarketProductId(detail, first)).toBe(900001);
      expect(exactCardmarketProductId(detail, second)).toBe(900002);
    }
  });

  it('does not invent a raw-ID group for printings without source IDs', () => {
    const first = printing(900001, 4.56);
    const second = printing(900002, 12.34);
    for (const variants of [[first, second], [second, first]]) {
      const detail = card('synthetic-001', variants);
      expect(exactCardmarketProductId(detail, first)).toBe(900001);
      expect(exactCardmarketProductId(detail, second)).toBe(900002);
    }
  });

  it('keeps missing product metadata absent instead of borrowing the agreeing sibling product', () => {
    const first = printing(900001, 4.56, { variantId: 'same-source-id' });
    const missing = { type: 'Holo', size: 'Standard', variantId: 'same-source-id' };
    const detail = card('synthetic-001', [first, missing]);
    expect(exactCardmarketProductId(detail, first)).toBe(900001);
    expect(exactCardmarketProductId(detail, missing)).toBeNull();
    expect(exactTrendPrice(detail, missing)).toBeNull();
  });

  it('does not activate card-root fallback for a printing with no product', () => {
    const selected = { type: 'Holo', size: 'Standard', variantId: 'source-id' };
    const detail = { ...card('synthetic-001', [selected]), pricing: { cardmarket: { idProduct: 900001, unit: 'EUR', trend: 4.56 } } };
    assertRejected(detail, [selected]);
  });
});
