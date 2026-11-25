import type { TcgCardDetail, TcgCardSummary, TcgSetDetail } from './domain';
import { attachVerifiedDlrCardmarketPricing } from './dlr-cardmarket-mapping';

/** Official German DLR corrections; TCGdex remains the technical feed. */
export const DELTA_HERRSCHAFT = Object.freeze({
  id: 'me06',
  code: 'DLR',
  name: 'Mega-Entwicklung – Delta-Herrschaft',
  releaseDate: '2026-11-06',
  mainCards: 103,
  totalCards: 141,
});

const names = new Map<string, string>([
  ['094', 'Legendäre Lavabröhe'], ['095', 'Legendäre Lavabröhe'],
  ['132', 'Sprudelnde Wasser-Energie'], ['133', 'Wachsende Pflanzen-Energie'],
  ['134', 'Nitro-Feuer-Energie'],
]);

const rarity = (localId: string, original?: string) => {
  const number = Number(localId);
  if (number >= 104 && number <= 117) return 'Illustration Rare';
  if (number >= 118 && number <= 134) return 'Ultra Rare';
  if (number >= 135 && number <= 140) return 'Special Illustration Rare';
  if (number === 141) return 'Mega Hyper Rare';
  return original;
};

const isDelta = (id: string | undefined) => id?.trim().toLowerCase() === DELTA_HERRSCHAFT.id;
const localKey = (value: string | undefined) => value?.trim().padStart(3, '0') ?? '';

export function officializeDeltaSummary<T extends TcgCardSummary>(card: T): T {
  if (!isDelta(card.id.split('-')[0])) return card;
  const localId = localKey(card.localId || card.id.slice(card.id.lastIndexOf('-') + 1));
  return { ...card, name: names.get(localId) ?? card.name, rarity: rarity(localId, card.rarity) };
}

export function officializeDeltaSet<T extends TcgSetDetail>(set: T): T {
  if (!isDelta(set.id)) return set;
  return {
    ...set,
    name: DELTA_HERRSCHAFT.name,
    cardCount: { ...set.cardCount, official: DELTA_HERRSCHAFT.mainCards, total: DELTA_HERRSCHAFT.totalCards },
    cards: set.cards.map(officializeDeltaSummary),
  };
}

export function officializeDeltaCard<T extends TcgCardDetail>(card: T): T {
  if (!isDelta(card.set?.id) && !isDelta(card.id.split('-')[0])) return card;
  const localId = localKey(card.localId || card.id.slice(card.id.lastIndexOf('-') + 1));
  return attachVerifiedDlrCardmarketPricing({
    ...card,
    name: names.get(localId) ?? card.name,
    rarity: rarity(localId, card.rarity),
    set: {
      ...card.set,
      id: DELTA_HERRSCHAFT.id,
      name: DELTA_HERRSCHAFT.name,
      cardCount: { ...card.set?.cardCount, official: DELTA_HERRSCHAFT.mainCards, total: DELTA_HERRSCHAFT.totalCards },
    },
  });
}

/** A partial provider response must not masquerade as a complete 141-slot master set. */
export function hasCompleteDeltaHerrschaft(set: TcgSetDetail): boolean {
  if (!isDelta(set.id)) return true;
  const slots = new Set(set.cards.map((card) => Number(card.localId)).filter((value) => Number.isInteger(value)));
  return slots.size === DELTA_HERRSCHAFT.totalCards
    && [...Array(DELTA_HERRSCHAFT.totalCards)].every((_, index) => slots.has(index + 1))
    && set.cards.every((card) => typeof card.image === 'string' && card.image.trim().length > 0);
}
