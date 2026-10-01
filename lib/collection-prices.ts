import { canonicalTcgCardId, collectionPriceIdentity, exactTrendPrice, variantForCollectionEntry, type CollectionEntry, type TcgCardDetail } from './domain';
import { manualSelectionPrice, type CollectionPriceSelection } from './price-alternatives';

export type CollectionPriceResult = { identity: string; price: number | null; failed: boolean; source: 'trend' | 'manual' | null };

/** Missing source identity is not a loading state. Transport errors are not missing market prices. */
export async function resolveCollectionPrice(entry: CollectionEntry, load: (id: string) => Promise<TcgCardDetail>, selection?: CollectionPriceSelection | null): Promise<CollectionPriceResult> {
  const identity = collectionPriceIdentity(entry);
  if (!entry.sourceCardId) return { identity, price: null, failed: false, source: null };
  try {
    const card = await load(canonicalTcgCardId(entry.sourceCardId));
    const localNumber = (value: string) => value.trim().split('/')[0].replace(/^0+(?=\d)/, '').toUpperCase();
    if (typeof card.id !== 'string' || canonicalTcgCardId(card.id).toLowerCase() !== canonicalTcgCardId(entry.sourceCardId).toLowerCase()
      || typeof card.set?.id !== 'string' || typeof card.localId !== 'string'
      || (entry.sourceSetId && card.set.id.toLowerCase() !== entry.sourceSetId.toLowerCase())
      || (entry.collectorNumber && localNumber(card.localId) !== localNumber(entry.collectorNumber))) {
      return { identity, price: null, failed: false, source: null };
    }
    const variant = variantForCollectionEntry(card, entry);
    if (!variant) return { identity, price: null, failed: false, source: null };
    const trend = exactTrendPrice(card, variant);
    if (trend !== null) return { identity, price: trend, failed: false, source: 'trend' };
    const manual = manualSelectionPrice(entry, selection);
    return { identity, price: manual, failed: false, source: manual === null ? null : 'manual' };
  } catch { return { identity, price: null, failed: true, source: null }; }
}

export function sumKnownPrices(entries: CollectionEntry[], prices: Record<string, number | null | undefined>) {
  let value = 0; let priced = 0; let quantity = 0;
  for (const entry of entries) {
    quantity += entry.quantity;
    const price = prices[entry.syncId];
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) { value += price * entry.quantity; priced += entry.quantity; }
  }
  return { value, priced, quantity };
}

export function formatKnownValuation({ value, priced, quantity }: { value: number; priced: number; quantity: number }) {
  if (quantity > 0 && priced === 0) return 'Preis nicht verfügbar';
  const amount = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
  return priced < quantity ? `${amount} (Teilwert · ${priced}/${quantity})` : amount;
}
