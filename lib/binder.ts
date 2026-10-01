import type { CollectionEntry, TcgCardSummary, TcgVariant } from './domain';
import { canonicalTcgCardId, collectionVariantLabel } from './domain';

export interface BinderSlot {
  slotId: string;
  card: TcgCardSummary;
  finish: 'Normal' | 'Holo' | 'Reverse Holo';
  variant: string;
  standardSlot?: true;
  owned: CollectionEntry[];
}

interface Printing { finish: BinderSlot['finish']; variant: string; standardSlot?: true; }

export function buildBinderSlots(cards: TcgCardSummary[], entries: CollectionEntry[], printedTotal = 0): BinderSlot[] {
  const byCard = new Map<string, CollectionEntry[]>();
  for (const entry of entries) {
    if (!entry.sourceCardId) continue;
    const key = canonicalTcgCardId(entry.sourceCardId).toLowerCase();
    byCard.set(key, [...(byCard.get(key) ?? []), entry]);
  }

  const uniqueCards = [...new Map(cards.map((card) => [card.id.toLowerCase(), card])).values()];
  const slots = uniqueCards.flatMap((card) => {
    const owned = byCard.get(card.id.toLowerCase()) ?? [];
    return binderPrintings(card, printedTotal).map((printing) => ({
      slotId: `${card.id}:${finishKey(printing.finish)}:${normalize(printing.variant)}`,
      card,
      ...printing,
      // A special card has one binder place; retain the original price/printing identity.
      owned: printing.standardSlot ? owned : owned.filter((entry) => finishKey(entry.finish) === finishKey(printing.finish)
        && variantKey(entry.variant) === variantKey(printing.variant)),
    }));
  });

  const known = new Set(uniqueCards.map((card) => card.id.toLowerCase()));
  for (const entry of entries) {
    if (!entry.sourceCardId) continue;
    const cardId = canonicalTcgCardId(entry.sourceCardId);
    if (known.has(cardId.toLowerCase())) continue;
    const finish = normalizedFinish(entry.finish);
    const variant = entry.variant || (finish === 'Normal' ? 'Standard' : finish);
    const slotId = `${cardId.toLowerCase()}:${finishKey(finish)}:${variantKey(variant)}`;
    const existing = slots.find((slot) => slot.slotId === slotId);
    if (existing) { existing.owned.push(entry); continue; }
    slots.push({
      slotId,
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
  // Verified named printings (such as the Pokémon Center Nidorina) keep their own
  // ownership and selection even when the numbered promo is beyond a set's total.
  if (distinct.some((printing) => printing.variant.includes('Stempel:'))) return distinct;
  if (isStandardBinderCard(card, printedTotal)) return [{ finish: 'Normal', variant: 'Standard', standardSlot: true }];
  if (!distinct.length) return [{ finish: 'Normal', variant: 'Standard' }];

  const number = Number.parseInt(card.localId.match(/\d+/)?.[0] ?? '', 10);
  const inMainSet = Number.isFinite(number) && printedTotal > 0 && number <= printedTotal;
  if (!inMainSet) return distinct.slice(0, 1);

  const normal = distinct.find((printing) => printing.finish === 'Normal');
  const reverse = distinct.find((printing) => printing.finish === 'Reverse Holo');
  return normal && reverse ? [normal, reverse] : distinct.slice(0, 2);
}

function isStandardBinderCard(card: TcgCardSummary, printedTotal: number): boolean {
  const number = Number.parseInt(card.localId.match(/\d+/)?.[0] ?? '', 10);
  const beyondMainSet = Number.isFinite(number) && printedTotal > 0 && number > printedTotal;
  const ruleBox = /(?:^|\s|-)(?:ex|gx|v|vmax|vstar)$/i.test(card.name.trim());
  const special = /ace|special|illustration|ultra|hyper|secret|rainbow|gold|full[ -]?art/i.test(card.rarity ?? '');
  return beyondMainSet || ruleBox || special;
}

/** Binder labels never replace the actual variant passed to pricing or persistence. */
export function variantForBinderSlot(variants: TcgVariant[], slot: BinderSlot): TcgVariant | undefined {
  if (slot.standardSlot) {
    const basePrintings = variants.filter((item) => !/reverse/i.test(item.type));
    if (basePrintings.length === 1) return basePrintings[0];
    const standard = basePrintings.filter((item) => finishKey(item.type) === 'normal'
      && normalize(collectionVariantLabel(item)) === 'standard');
    return standard.length === 1 ? standard[0] : undefined;
  }
  const matching = variants.filter((item) => finishKey(item.type) === finishKey(slot.finish));
  const exact = matching.filter((item) => variantKey(collectionVariantLabel(item)) === variantKey(slot.variant));
  return exact.length === 1 ? exact[0] : undefined;
}

export function paginateBinderSlots(slots: BinderSlot[], pageSize = 8): BinderSlot[][] {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Ungültige Binderseitengröße.');
  return Array.from({ length: Math.ceil(slots.length / pageSize) }, (_, index) => slots.slice(index * pageSize, (index + 1) * pageSize));
}

function printingFromSource(value: string): Printing | null {
  const stampedHolo = value.match(/^holo\s*·\s*(Standard\s*·\s*Stempel:.+)$/i);
  if (stampedHolo) return { finish: 'Holo', variant: stampedHolo[1] };
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
function variantKey(value: string) { const key = normalize(value); return ['', 'normal', 'holo', 'reverse', 'reverse holo'].includes(key) ? 'standard' : key; }
