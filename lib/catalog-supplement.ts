import type { TcgCardDetail, TcgCardSummary, TcgSetDetail, TcgVariant } from './domain';

/** Verified Android catalogue gaps, checked 2026-09-22. See docs/catalog-30th-supplement.md.
 * These are app-canonical identities; unavailable upstream endpoints and prices are not invented. */
type Supplement = { card: TcgCardDetail; englishName: string };
const mainSet = { id: '30th', name: '30 Jahre', cardCount: { official: 128, total: 161 } };
const promoSet = { id: 'mep', name: 'MEP Black Star Promos', cardCount: { official: 0 } };
const holo = (productId?: number): TcgVariant => ({
  variantId: 'supplement-holo', type: 'Holo', size: 'Holo',
  ...(productId ? { pricing: { cardmarket: { idProduct: productId } } } : {}),
});
const rgb = (letter: string, image: number): Supplement => ({ englishName: 'Mew', card: {
  id: `30th-rgb-${letter.toLowerCase()}`, localId: `${letter}/RGB`, name: 'Mew', rarity: 'RGB Rare',
  image: `https://www.serebii.net/card/30thcelebration/rgb${image}.jpg`, set: mainSet,
  printVariants: ['holo'], variants: { holo: true }, variants_detailed: [holo()],
} });
function promo(number: number, name: string, englishName: string, productId?: number, englishImage = false, pokemonCenter = false): Supplement {
  const localId = String(number).padStart(3, '0');
  return { englishName, card: {
    id: `mep-${localId}`, localId, name, rarity: 'Promo', set: promoSet,
    image: englishImage ? `https://www.serebii.net/card/megapromos/${number}.jpg`
      : `https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_${number}.png`,
    printVariants: pokemonCenter ? ['holo', 'Holo · Standard · Stempel: Pokémon-Center'] : ['holo'], variants: { holo: true }, variants_detailed: [holo(productId),
      ...(pokemonCenter ? [{ variantId: 'supplement-pokemon-center', type: 'Holo', size: 'Standard · Stempel: Pokémon-Center', stamp: ['Pokémon-Center'] }] : []),
    ],
  } };
}
const supplement: readonly Supplement[] = [
  rgb('R', 1), rgb('G', 2), rgb('B', 3),
  promo(94, 'Alola-Kokowei', 'Alolan Exeggutor', 895609),
  promo(95, 'Lucario', 'Lucario', 895610),
  promo(96, 'Lavados', 'Moltres', 895606, true),
  promo(97, 'Arktos', 'Articuno', 895607, true),
  promo(98, 'Zapdos', 'Zapdos', 895608, true),
  promo(99, 'Quajutsu-ex', 'Greninja ex'),
  promo(100, 'Feelinara-ex', 'Sylveon ex'),
  promo(101, 'Nidorina', 'Nidorina', undefined, false, true),
  promo(102, 'Victini', 'Victini', 895613),
  promo(103, 'Zeraora', 'Zeraora', 895614),
  promo(104, 'Mewtu', 'Mewtwo', 895620, true),
  promo(105, 'Mew', 'Mew', 895621, true),
  promo(106, 'Ditto', 'Ditto', 895619, true),
  promo(107, 'Pikachu-ex', 'Pikachu ex', 895615),
  promo(108, 'Psiana-ex', 'Espeon ex', 895616),
  promo(109, 'Pikachu-ex', 'Pikachu ex', 895617),
  promo(110, 'Nachtara-ex', 'Umbreon ex', 895618),
];
const normalize = (value: string) => value.trim().toLocaleLowerCase('de');
const collector = (value: string) => /^\d+$/.test(value.trim()) ? String(Number(value)) : normalize(value);
const clone = (card: TcgCardDetail): TcgCardDetail => structuredClone(card);

export function supplementalCard(id: string): TcgCardDetail | undefined {
  const match = supplement.find(({ card }) => card.id === normalize(id));
  return match ? clone(match.card) : undefined;
}

/** A later upstream record wins, even if it uses another ID for the same printed number. */
export function supplementSet(set: TcgSetDetail): TcgSetDetail {
  const additions = supplement.filter(({ card }) => card.set.id === normalize(set.id));
  if (!additions.length || !Array.isArray(set.cards)) return set;
  const byNumber = new Map(additions.map(({ card }) => [collector(card.localId), card]));
  const cards = set.cards.map((card) => {
    const fallback = byNumber.get(collector(card.localId));
    return !card.image?.trim() && fallback ? { ...card, image: fallback.image } : card;
  });
  const ids = new Set(cards.map((card) => normalize(card.id))), numbers = new Set(cards.map((card) => collector(card.localId)));
  for (const { card } of additions) if (!ids.has(normalize(card.id)) && !numbers.has(collector(card.localId))) cards.push(clone(card));
  return { ...set, cards, cardCount: { ...set.cardCount, total: Math.max(set.cardCount?.total ?? 0, cards.length) } };
}

/** Name search is supplemented locally, including English market names and exact printed IDs. */
export function searchSupplement(query: string): TcgCardSummary[] {
  const value = normalize(query);
  if (value.length < 2 || value.length > 80) return [];
  return supplement.filter(({ card, englishName }) => [card.name, englishName, card.id, card.localId].some((field) => normalize(field).includes(value)))
    .map(({ card }) => clone(card));
}

export function supplementSearchResults(cards: TcgCardSummary[], query: string): TcgCardSummary[] {
  const additions = searchSupplement(query), ids = new Set(cards.map((card) => normalize(card.id)));
  // Keep the source's result order and bounded 40-card fetch. At most 20 local records are added.
  return [...cards.map((card) => {
    const fallback = additions.find((candidate) => candidate.id === normalize(card.id));
    return !card.image?.trim() && fallback ? { ...card, image: fallback.image } : card;
  }), ...additions.filter((card) => !ids.has(card.id))];
}
