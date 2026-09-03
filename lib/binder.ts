import type { CollectionEntry, TcgCardSummary } from './domain';
import { canonicalTcgCardId } from './domain';

export interface BinderSlot {
  slotId: string;
  card: TcgCardSummary;
  finish: 'Normal' | 'Holo' | 'Reverse Holo';
  variant: string;
  owned: CollectionEntry[];
}

interface Printing { finish: BinderSlot['finish']; variant: string; }

export function buildBinderSlots(cards: TcgCardSummary[], entries: CollectionEntry[], printedTotal = 0): BinderSlot[] {
  const byCard = new Map<string, CollectionEntry[]>();
  for (const entry of entries) {
    if (!entry.sourceCardId) continue;
    const key = canonicalTcgCardId(entry.sourceCardId).toLowerCase();
    byCard.set(key, [...(byCard.get(key) ?? []), entry]);
  }

  const slots = cards.flatMap((card) => {
    const owned = byCard.get(card.id.toLowerCase()) ?? [];
    return binderPrintings(card, printedTotal).map((printing) => ({
      slotId: `${card.id}:${finishKey(printing.finish)}:${normalize(printing.variant)}`,
      card,
      ...printing,
      owned: owned.filter((entry) => finishKey(entry.finish) === finishKey(printing.finish)),
    }));
  });

  const known = new Set(cards.map((card) => card.id.toLowerCase()));
  for (const entry of entries) {
    if (!entry.sourceCardId) continue;
    const cardId = canonicalTcgCardId(entry.sourceCardId);
    if (known.has(cardId.toLowerCase())) continue;
    const finish = normalizedFinish(entry.finish);
    const variant = entry.variant || (finish === 'Normal' ? 'Standard' : finish);
    slots.push({
      slotId: `${cardId}:${finishKey(finish)}:${normalize(variant)}`,
      card: { id: cardId, localId: entry.collectorNumber, name: entry.name, image: entry.imageUrl ?? undefined, rarity: entry.rarity },
      finish,
      variant,
      owned: [entry],
    });
  }
  return slots;
}

export function binderPrintings(card: TcgCardSummary, printedTotal: number): Printing[] {
  const declared = (card.printVariants?.length ? card.printVariants : ['normal'])
    .map(printingFromSource)
    .filter((item): item is Printing => Boolean(item));
  const distinct = declared.filter((printing, index) => declared.findIndex((candidate) =>
    finishKey(candidate.finish) === finishKey(printing.finish) && normalize(candidate.variant) === normalize(printing.variant)) === index);
  if (!distinct.length) return [{ finish: 'Normal', variant: 'Standard' }];

  const number = Number.parseInt(card.localId.match(/\d+/)?.[0] ?? '', 10);
  const inMainSet = Number.isFinite(number) && printedTotal > 0 && number <= printedTotal;
  const ruleBox = /(?:^|\s|-)(?:ex|gx|v|vmax|vstar)$/i.test(card.name.trim());
  const special = /ace|special|illustration|ultra|hyper|secret|rainbow|gold/i.test(card.rarity ?? '');
  if (!inMainSet || ruleBox || special) return distinct.slice(0, 1);

  const normal = distinct.find((printing) => printing.finish === 'Normal');
  const reverse = distinct.find((printing) => printing.finish === 'Reverse Holo');
  return normal && reverse ? [normal, reverse] : distinct.slice(0, 2);
}

export function paginateBinderSlots(slots: BinderSlot[], pageSize = 8): BinderSlot[][] {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Ungültige Binderseitengröße.');
  return Array.from({ length: Math.ceil(slots.length / pageSize) }, (_, index) => slots.slice(index * pageSize, (index + 1) * pageSize));
}

function printingFromSource(value: string): Printing | null {
  if (/reverse/i.test(value)) return { finish: 'Reverse Holo', variant: 'Standard' };
  if (/holo/i.test(value)) return { finish: 'Holo', variant: 'Standard' };
  if (/normal|unlimited|1stedition/i.test(value)) return { finish: 'Normal', variant: /1stedition/i.test(value) ? '1. Edition' : 'Standard' };
  return null;
}

function normalizedFinish(value: string): BinderSlot['finish'] {
  if (/reverse/i.test(value)) return 'Reverse Holo';
  if (/holo/i.test(value)) return 'Holo';
  return 'Normal';
}

function finishKey(value: string) { return normalizedFinish(value).toLowerCase(); }
function normalize(value: string) { return value.toLocaleLowerCase('de').replace(/[^a-z0-9]+/g, ' ').trim(); }
