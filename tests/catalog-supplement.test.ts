import { describe, expect, it } from 'vitest';
import { supplementalCard, supplementSet, searchSupplement, supplementSearchResults } from '@/lib/catalog-supplement';
import { buildBinderSlots, variantForBinderSlot } from '@/lib/binder';
import {
  canonicalTcgCardId, collectionVariantLabel, exactCardmarketProductId, exactTrendPrice,
  variantForCollectionEntry, type CollectionEntry, type TcgCardDetail, type TcgCardSummary, type TcgSetDetail,
} from '@/lib/domain';
import { deterministicSourceSyncId } from '@/lib/sync-id';
import { imageUrl } from '@/lib/tcgdex';

// Reviewed Android catalogue identities and product links, not inferred from ID order.
const expectedCards = [
  ['30th-rgb-r', 'R/RGB', 'Mew', 'https://www.serebii.net/card/30thcelebration/rgb1.jpg', null],
  ['30th-rgb-g', 'G/RGB', 'Mew', 'https://www.serebii.net/card/30thcelebration/rgb2.jpg', null],
  ['30th-rgb-b', 'B/RGB', 'Mew', 'https://www.serebii.net/card/30thcelebration/rgb3.jpg', null],
  ['mep-094', '094', 'Alola-Kokowei', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_94.png', 895609],
  ['mep-095', '095', 'Lucario', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_95.png', 895610],
  ['mep-096', '096', 'Lavados', 'https://www.serebii.net/card/megapromos/96.jpg', 895606],
  ['mep-097', '097', 'Arktos', 'https://www.serebii.net/card/megapromos/97.jpg', 895607],
  ['mep-098', '098', 'Zapdos', 'https://www.serebii.net/card/megapromos/98.jpg', 895608],
  ['mep-099', '099', 'Quajutsu-ex', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_99.png', null],
  ['mep-100', '100', 'Feelinara-ex', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_100.png', null],
  ['mep-101', '101', 'Nidorina', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_101.png', null],
  ['mep-102', '102', 'Victini', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_102.png', 895613],
  ['mep-103', '103', 'Zeraora', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_103.png', 895614],
  ['mep-104', '104', 'Mewtu', 'https://www.serebii.net/card/megapromos/104.jpg', 895620],
  ['mep-105', '105', 'Mew', 'https://www.serebii.net/card/megapromos/105.jpg', 895621],
  ['mep-106', '106', 'Ditto', 'https://www.serebii.net/card/megapromos/106.jpg', 895619],
  ['mep-107', '107', 'Pikachu-ex', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_107.png', 895615],
  ['mep-108', '108', 'Psiana-ex', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_108.png', 895616],
  ['mep-109', '109', 'Pikachu-ex', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_109.png', 895617],
  ['mep-110', '110', 'Nachtara-ex', 'https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_110.png', 895618],
] as const;

function detail(id: string): TcgCardDetail {
  const card = supplementalCard(id);
  expect(card, `supplemental detail for ${id}`).toBeDefined();
  return card!;
}

function owned(card: TcgCardSummary, variant = 'Holo'): CollectionEntry {
  const sourceSetId = card.id.startsWith('30th-') ? '30th' : 'mep';
  return {
    syncId: deterministicSourceSyncId('test-owner', sourceSetId, card.id, 'Near Mint', 'Holo', variant),
    sourceSetId, sourceCardId: card.id, collectorNumber: card.localId, name: card.name,
    finish: 'Holo', variant, quantity: 1, externalProductId: null,
  } as CollectionEntry;
}

describe('reviewed 30th anniversary supplement', () => {
  it('contains exactly three RGB cards and the seventeen numbered MEP 094–110 promos', () => {
    const cards = ['30th', 'mep'].flatMap((id) => supplementSet({ id, name: id, cards: [] }).cards);
    expect(cards.map((card) => card.id).sort()).toEqual(expectedCards.map(([id]) => id).sort());
    expect(new Set(cards.map((card) => card.id)).size).toBe(20);
    expect(expectedCards.filter(([, , , , productId]) => productId !== null)).toHaveLength(14);
  });

  it.each(expectedCards)('preserves %s collector, artwork, and exact market identity', (id, localId, name, image, productId) => {
    const card = detail(id);
    expect(card).toMatchObject({ id, localId, name, image, set: { id: id.startsWith('30th-') ? '30th' : 'mep' } });
    expect(card.variants_detailed?.[0]).toMatchObject({ variantId: 'supplement-holo', type: 'Holo' });
    expect(exactCardmarketProductId(card, card.variants_detailed![0])).toBe(productId);
    expect(imageUrl(card.image, 'low')).toBe(image);
    expect(imageUrl(card.image, 'high')).toBe(image);
    for (const variant of card.variants_detailed ?? []) {
      expect(exactTrendPrice(card, variant)).toBeNull();
      expect(variant.pricing?.cardmarket?.trend).toBeUndefined();
      expect(variant.pricing?.cardmarket?.['trend-holo']).toBeUndefined();
    }
    expect(card.pricing).toBeUndefined();
  });

  it.each(['30th-rgb-r', '30th-rgb-g', '30th-rgb-b', 'mep-099', 'mep-100', 'mep-101'])('does not guess any ambiguous Cardmarket printing for %s', (id) => {
    const card = detail(id);
    expect(card.variants_detailed?.length).toBeGreaterThan(0);
    for (const variant of card.variants_detailed ?? []) {
      expect(exactCardmarketProductId(card, variant)).toBeNull();
      expect(variant.pricing?.cardmarket?.idProduct).toBeUndefined();
    }
  });

  it.each(['30th-065', '30th-158', '30th-159', '30th-160', '30th-161', '30th-c-rgb-r', 'mep-093', 'mep-111'])('does not invent a supplemental detail for %s', (id) => {
    expect(supplementalCard(id)).toBeUndefined();
  });

  it('returns independent detail objects and resolves normalized canonical IDs', () => {
    const first = detail(' MEP-094 ');
    first.name = 'Changed locally';
    first.variants_detailed![0].pricing!.cardmarket!.idProduct = 1;
    const second = detail('mep-094');
    expect(second.name).toBe('Alola-Kokowei');
    expect(exactCardmarketProductId(second, second.variants_detailed![0])).toBe(895609);
  });
});

describe('upstream-authoritative supplement merging', () => {
  it('extends 158 main-set cards to 161 while preserving official denominator 128 and Mew-ex 158', () => {
    const cards: TcgCardSummary[] = Array.from({ length: 158 }, (_, index) => {
      const localId = String(index + 1).padStart(3, '0');
      return { id: `30th-${localId}`, localId, name: index === 157 ? 'Mew-ex' : `Original ${localId}` };
    });
    const source: TcgSetDetail = { id: '30th', name: 'Original title', logo: 'source-logo', cardCount: { official: 128, total: 158 }, cards };
    const merged = supplementSet(source);
    expect(merged.cards).toHaveLength(161);
    expect(merged.cardCount).toEqual({ official: 128, total: 161 });
    expect(merged.cards.slice(0, 158)).toEqual(cards);
    expect(merged.cards[157]).toBe(cards[157]);
    expect(merged.name).toBe(source.name);
    expect(merged.logo).toBe(source.logo);
    expect(source.cards).toHaveLength(158);
    expect(source.cardCount?.total).toBe(158);
    expect(supplementSet(merged)).toEqual(merged);
  });

  it('retains upstream identity, printings, rarity, and nonblank artwork', () => {
    const upstream: TcgCardDetail = {
      id: 'mep-101', localId: '101', name: 'Upstream Nidorina', image: 'https://example.test/nidorina.png',
      rarity: 'Source rarity', set: { id: 'mep', name: 'Source promos' }, printVariants: ['normal', 'reverse'],
      variants_detailed: [{ variantId: 'upstream-print', type: 'Normal', stamp: ['Source stamp'], pricing: { cardmarket: { idProduct: 123, trend: 9 } } }],
    };
    const merged = supplementSet({ id: 'mep', name: 'Source promos', cards: [upstream] });
    expect(merged.cards.filter((card) => card.localId === '101')).toHaveLength(1);
    expect(merged.cards[0]).toBe(upstream);
    expect(merged.cards[0]).toEqual(upstream);
    expect(supplementSet(merged)).toEqual(merged);
  });

  it.each(['94', '094', '00094'])('merges collector %s under its future upstream ID and fills only absent art', (localId) => {
    const upstream: TcgCardSummary = { id: 'mep-future-exeggutor', localId, name: 'Authoritative name', rarity: 'Source rarity', image: ' ', printVariants: ['normal'] };
    const merged = supplementSet({ id: 'MEP', name: 'Promos', cards: [upstream] });
    expect(merged.cards).toHaveLength(17);
    expect(merged.cards.find((card) => card.id === 'mep-094')).toBeUndefined();
    expect(merged.cards[0]).toEqual({ ...upstream, image: detail('mep-094').image });
    expect(upstream.image).toBe(' ');
    expect(supplementSet(merged)).toEqual(merged);
  });

  it('keeps a future upstream RGB identity with the same printed collector', () => {
    const upstream: TcgCardSummary = { id: '30th-upstream-red', localId: ' r/rgb ', name: 'Upstream red Mew', printVariants: ['normal'] };
    const merged = supplementSet({ id: '30th', name: 'Main set', cards: [upstream], cardCount: { official: 128 } });
    expect(merged.cards).toHaveLength(3);
    expect(merged.cards.some((card) => card.id === '30th-rgb-r')).toBe(false);
    expect(merged.cards[0]).toEqual({ ...upstream, image: detail('30th-rgb-r').image });
  });

  it('does not add main-set RGB cards or promos to the Classic Collection', () => {
    const classic: TcgSetDetail = { id: '30th-c', name: 'Classic Collection', cardCount: { official: 0, total: 30 }, cards: [{ id: '30th-c-014', localId: '58/102', name: 'Pikachu' }] };
    expect(supplementSet(classic)).toBe(classic);
    expect(supplementSet(classic)).toEqual(classic);
  });
});

describe('supplement search', () => {
  it.each([
    ['R/RGB', ['30th-rgb-r']],
    ['Alolan Exeggutor', ['mep-094']],
    ['  LAVADOS  ', ['mep-096']],
    ['Greninja', ['mep-099']],
    ['mep-110', ['mep-110']],
  ])('finds canonical supplemental records for %s', (query, expected) => {
    expect(searchSupplement(query as string).map((card) => card.id)).toEqual(expected);
  });

  it('keeps source search ordering and metadata, fills missing artwork, and avoids duplicate IDs', () => {
    const upstream: TcgCardSummary = { id: 'mep-094', localId: '094', name: 'Upstream Alola-Kokowei', rarity: 'Source rarity' };
    const unrelated: TcgCardSummary = { id: 'older-001', localId: '001', name: 'Other Alolan Exeggutor', image: 'https://example.test/old.png' };
    const merged = supplementSearchResults([unrelated, upstream], 'Alolan Exeggutor');
    expect(merged).toEqual([unrelated, { ...upstream, image: detail('mep-094').image }]);
    expect(supplementSearchResults(merged, 'Alolan Exeggutor')).toEqual(merged);
  });
});

describe('supplement binder printing identities', () => {
  it('gives red, green, and blue Mew separate owned slots, independent of Mew-ex 158', () => {
    const rgb = ['30th-rgb-r', '30th-rgb-g', '30th-rgb-b'].map(detail);
    const regular: TcgCardSummary = { id: '30th-158', localId: '158', name: 'Mew-ex', printVariants: ['holo'] };
    const entries = [...rgb, regular].map((card) => owned(card));
    const slots = buildBinderSlots([...rgb, regular], entries, 128);
    expect(slots).toHaveLength(4);
    expect(new Set(slots.map((slot) => slot.slotId)).size).toBe(4);
    expect(new Set(entries.map((entry) => entry.syncId)).size).toBe(4);
    rgb.forEach((card, index) => {
      expect(canonicalTcgCardId(card.id)).toBe(card.id);
      const slot = slots.find((candidate) => candidate.card.id === card.id)!;
      expect(slot.card.localId).toBe(['R/RGB', 'G/RGB', 'B/RGB'][index]);
      expect(slot.owned).toEqual([entries[index]]);
      expect(variantForBinderSlot(card.variants_detailed!, slot)?.variantId).toBe('supplement-holo');
    });
    const redOnly = buildBinderSlots(rgb, [entries[0]], 128);
    expect(redOnly.map((slot) => slot.owned.length)).toEqual([1, 0, 0]);
  });

  it.each([0, 88, 110])('keeps regular and Pokémon Center Nidorina distinct with printed total %s', (printedTotal) => {
    const card = detail('mep-101');
    const variants = card.variants_detailed!;
    expect(variants.map(collectionVariantLabel)).toEqual(['Holo', 'Standard · Stempel: Pokémon-Center']);
    const entries = variants.map((variant) => owned(card, collectionVariantLabel(variant)));
    expect(new Set(entries.map((entry) => entry.syncId)).size).toBe(2);
    const slots = buildBinderSlots([card], entries, printedTotal);
    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => [slot.finish, slot.variant])).toEqual([
      ['Holo', 'Standard'], ['Holo', 'Standard · Stempel: Pokémon-Center'],
    ]);
    slots.forEach((slot, index) => {
      expect(slot.standardSlot).toBeUndefined();
      expect(slot.owned).toEqual([entries[index]]);
      expect(variantForBinderSlot([...variants].reverse(), slot)).toBe(variants[index]);
      expect(variantForCollectionEntry(card, entries[index])).toBe(variants[index]);
      expect(exactCardmarketProductId(card, variants[index])).toBeNull();
    });
    expect(buildBinderSlots([card], [entries[1]], printedTotal).map((slot) => slot.owned.length)).toEqual([0, 1]);
  });
});
