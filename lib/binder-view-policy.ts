import type { BinderSlot } from './binder';
import type { CollectionEntry } from './domain';

/** Presentation-only ordering for master-set pages; it never mutates the saved collection. */
export type SetBinderSlotSort = 'number_asc' | 'number_desc' | 'name_asc' | 'name_desc' | 'last_added' | 'value_desc' | 'value_asc' | 'variant_asc' | 'variant_desc';

const numberKey = (value: string) => {
  const part = value.split('/')[0]?.trim() ?? '';
  const number = Number.parseInt(part.match(/\d+/)?.[0] ?? '', 10);
  return [Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER, part.toLocaleLowerCase('de')] as const;
};
const addedAt = (slot: BinderSlot) => Math.max(...slot.owned.map((entry) => entry.createdAtClient ?? Number.NEGATIVE_INFINITY));
const valueOf = (slot: BinderSlot, prices: Record<string, number | null | undefined>) => {
  const values = slot.owned.map((entry) => prices[entry.syncId]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : null;
};
const tie = (a: BinderSlot, b: BinderSlot) => a.card.name.localeCompare(b.card.name, 'de') || numberKey(a.card.localId)[0] - numberKey(b.card.localId)[0]
  || a.finish.localeCompare(b.finish, 'de') || a.variant.localeCompare(b.variant, 'de') || a.slotId.localeCompare(b.slotId);

/** Missing filter runs first, so no owned entry can appear in a "nur fehlende" result. */
export function orderBinderSlots(
  slots: BinderSlot[],
  sort: SetBinderSlotSort,
  onlyMissing: boolean,
  prices: Record<string, number | null | undefined>,
): BinderSlot[] {
  const visible = onlyMissing ? slots.filter((slot) => slot.owned.length === 0) : [...slots];
  return visible.sort((a, b) => {
    let result = 0;
    switch (sort) {
      case 'number_asc': result = numberKey(a.card.localId)[0] - numberKey(b.card.localId)[0] || numberKey(a.card.localId)[1].localeCompare(numberKey(b.card.localId)[1], 'de'); break;
      case 'number_desc': result = numberKey(b.card.localId)[0] - numberKey(a.card.localId)[0] || numberKey(b.card.localId)[1].localeCompare(numberKey(a.card.localId)[1], 'de'); break;
      case 'name_asc': result = a.card.name.localeCompare(b.card.name, 'de'); break;
      case 'name_desc': result = b.card.name.localeCompare(a.card.name, 'de'); break;
      case 'last_added': result = addedAt(b) - addedAt(a); break;
      case 'value_desc': result = (valueOf(b, prices) ?? Number.NEGATIVE_INFINITY) - (valueOf(a, prices) ?? Number.NEGATIVE_INFINITY); break;
      case 'value_asc': result = (valueOf(a, prices) ?? Number.POSITIVE_INFINITY) - (valueOf(b, prices) ?? Number.POSITIVE_INFINITY); break;
      case 'variant_asc': result = `${a.finish}\u0000${a.variant}`.localeCompare(`${b.finish}\u0000${b.variant}`, 'de'); break;
      case 'variant_desc': result = `${b.finish}\u0000${b.variant}`.localeCompare(`${a.finish}\u0000${a.variant}`, 'de'); break;
    }
    return result || tie(a, b);
  });
}

/** Ordering for the set-binder overview.  All timestamp and catalogue data is
 * evidence-backed; missing provider/legacy data simply sorts after known data. */
export type SetBinderOverviewSort = 'last_opened' | 'last_added' | 'newest_set' | 'oldest_set' | 'name_asc' | 'name_desc' | 'progress_desc' | 'progress_asc' | 'collected_desc' | 'collected_asc' | 'missing_desc' | 'missing_asc';

export type SetBinderOverviewRecord = Readonly<{
  id: string;
  name: string;
  sourceSetId?: string | null;
  entries: CollectionEntry[];
  lastOpenedAt: number | null;
  releaseDate: string | null;
  collectedSlots: number | null;
  totalSlots: number | null;
}>;

const timestampOrUnknown = (value: number | null) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Number.NEGATIVE_INFINITY;
const releaseOrUnknown = (value: string | null) => {
  if (!value) return Number.NaN;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : Number.NaN;
};
const lastAddedFor = (binder: SetBinderOverviewRecord) => Math.max(...binder.entries.map((entry) => timestampOrUnknown(entry.createdAtClient ?? null)));
const missingFor = (binder: SetBinderOverviewRecord) => binder.totalSlots === null || binder.collectedSlots === null ? null : Math.max(0, binder.totalSlots - binder.collectedSlots);
const progressFor = (binder: SetBinderOverviewRecord) => binder.totalSlots === null || binder.collectedSlots === null || binder.totalSlots <= 0
  ? null : binder.collectedSlots / binder.totalSlots;
const overviewTie = (a: SetBinderOverviewRecord, b: SetBinderOverviewRecord) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id);
const knownFirstDescending = (a: number, b: number) => {
  const aKnown = Number.isFinite(a); const bKnown = Number.isFinite(b);
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  return b - a;
};
const knownFirstAscending = (a: number, b: number) => {
  const aKnown = Number.isFinite(a); const bKnown = Number.isFinite(b);
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  return a - b;
};

/** Pure presentation order only; stored binder/card positions are never touched. */
export function orderSetBinderOverview(records: SetBinderOverviewRecord[], sort: SetBinderOverviewSort): SetBinderOverviewRecord[] {
  return [...records].sort((a, b) => {
    let result = 0;
    switch (sort) {
      case 'last_opened': result = knownFirstDescending(timestampOrUnknown(a.lastOpenedAt), timestampOrUnknown(b.lastOpenedAt)); break;
      case 'last_added': result = knownFirstDescending(lastAddedFor(a), lastAddedFor(b)); break;
      case 'newest_set': result = knownFirstDescending(releaseOrUnknown(a.releaseDate), releaseOrUnknown(b.releaseDate)); break;
      case 'oldest_set': result = knownFirstAscending(releaseOrUnknown(a.releaseDate), releaseOrUnknown(b.releaseDate)); break;
      case 'name_asc': result = a.name.localeCompare(b.name, 'de'); break;
      case 'name_desc': result = b.name.localeCompare(a.name, 'de'); break;
      case 'progress_desc': result = knownFirstDescending(progressFor(a) ?? Number.NaN, progressFor(b) ?? Number.NaN); break;
      case 'progress_asc': result = knownFirstAscending(progressFor(a) ?? Number.NaN, progressFor(b) ?? Number.NaN); break;
      case 'collected_desc': result = knownFirstDescending(a.collectedSlots ?? Number.NaN, b.collectedSlots ?? Number.NaN); break;
      case 'collected_asc': result = knownFirstAscending(a.collectedSlots ?? Number.NaN, b.collectedSlots ?? Number.NaN); break;
      case 'missing_desc': result = knownFirstDescending(missingFor(a) ?? Number.NaN, missingFor(b) ?? Number.NaN); break;
      case 'missing_asc': result = knownFirstAscending(missingFor(a) ?? Number.NaN, missingFor(b) ?? Number.NaN); break;
    }
    return result || overviewTie(a, b);
  });
}
