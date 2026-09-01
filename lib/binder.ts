import type { CollectionEntry, TcgCardSummary } from './domain';

export interface BinderSlot { card: TcgCardSummary; owned: CollectionEntry[]; }

export function buildBinderSlots(cards: TcgCardSummary[], entries: CollectionEntry[]): BinderSlot[] {
  const byCard = new Map<string, CollectionEntry[]>();
  for (const entry of entries) {
    if (!entry.sourceCardId) continue;
    const key = entry.sourceCardId.toLowerCase();
    byCard.set(key, [...(byCard.get(key) ?? []), entry]);
  }
  const slots = cards.map((card) => ({ card, owned: byCard.get(card.id.toLowerCase()) ?? [] }));
  const known = new Set(cards.map((card) => card.id.toLowerCase()));
  for (const entry of entries) {
    if (!entry.sourceCardId || known.has(entry.sourceCardId.toLowerCase())) continue;
    slots.push({ card: { id: entry.sourceCardId, localId: entry.collectorNumber, name: entry.name, image: entry.imageUrl ?? undefined }, owned: [entry] });
  }
  return slots;
}
