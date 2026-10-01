import { canonicalTcgCardId, exactTrendPrice, variantForCollectionEntry, type CollectionEntry, type TcgCardDetail } from './domain';

export interface ShareOptions { showPrices: boolean; showTotal: boolean; showDisplayName: boolean }
export interface SharedCard {
  slot: number; cardId: string; name: string; setName: string; collectorNumber: string;
  image: string | null; finish: string; holoEffectId: string; holoIntensity: number;
  price?: { amount: number | null; currency: 'EUR'; source: 'Cardmarket'; asOf: string | null };
}
export interface SharedBinder {
  title: string; coverStyle: string; page: number; pageCount: number; cards: SharedCard[];
  unavailableSlots: number[];
  displayName?: string;
  total?: { amount: number | null; currency: 'EUR'; complete: boolean; pricedCards: number; visibleCards: number };
}

const coverIds = new Set('classic_rainbow aurora galaxy crystal nebula golden_shine void prism bubble flame ocean forest stardust electric chroma_shift pixel liquid_metal sunburst dragon_scale cosmic_dust'.split(' '));
const effectIds = new Set('none classic_holo rainbow linear diagonal galaxy nebula aurora crystal prism diamond stardust bubble oil_slick liquid_metal hyper_wave fire ice pixel void holo_spark element_grass element_fire element_water element_electric element_psychic element_fighting element_darkness element_metal element_dragon element_colorless element_fairy anniversary_30'.split(' '));
export function sharedVisualId(value: unknown, cover = false) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (cover ? coverIds : effectIds).has(id) ? id : cover ? 'nebula' : 'none';
}
export function publicCardId(entry: Pick<CollectionEntry, 'sourceCardId'>) {
  const id = canonicalTcgCardId(entry.sourceCardId ?? '');
  return /^[a-zA-Z0-9._-]{1,120}$/.test(id) ? id : null;
}
function publicImage(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'assets.tcgdex.net' || url.port || url.username || url.password || url.search || url.hash) return null;
    return /\.(webp|png|jpe?g)$/i.test(url.pathname) ? url.href : `${url.href}/high.webp`;
  } catch { return null; }
}
const localNumber = (value: string) => value.trim().split('/')[0].replace(/^0+(?=\d)/, '').toUpperCase();

/** Allowlist boundary: never spread an owner document or use user-supplied image/name/price. */
export function sharedCardDto(entry: CollectionEntry, placement: { slotPosition: number; holoEffectId?: unknown; holoIntensity?: unknown }, card: TcgCardDetail | null, prices: boolean): SharedCard | null {
  const cardId = publicCardId(entry);
  if (!card || !cardId || card.id !== cardId || typeof card.set?.id !== 'string' || typeof card.localId !== 'string'
    || typeof card.name !== 'string' || typeof card.set.name !== 'string'
    || typeof entry.collectorNumber !== 'string' || card.set.id.toLowerCase() !== (entry.sourceSetId || entry.setId || '').toLowerCase()
    || localNumber(card.localId) !== localNumber(entry.collectorNumber)) return null;
  const variant = variantForCollectionEntry(card, entry);
  // Do not substitute another Cardmarket product when the stored exact product is known.
  const productId = variant?.pricing?.cardmarket?.idProduct ?? (card.variants_detailed?.length ? null : card.pricing?.cardmarket?.idProduct);
  const finish = (value: string) => /reverse/i.test(value) ? 'reverse' : /holo/i.test(value) ? 'holo' : 'normal';
  const exactVariant = variant && finish(variant.type) === finish(entry.finish)
    && (entry.externalProductId == null || entry.externalProductId === productId) ? variant : null;
  const pricing = exactVariant?.pricing?.cardmarket ?? card.pricing?.cardmarket;
  const amount = exactVariant && (!pricing?.unit || pricing.unit === 'EUR') ? exactTrendPrice(card, exactVariant) : null;
  return {
    slot: placement.slotPosition, cardId, name: card.name, setName: card.set.name, collectorNumber: card.localId,
    image: publicImage(card.image), finish: exactVariant?.type ?? 'Unbestimmte Druckvariante',
    holoEffectId: sharedVisualId(placement.holoEffectId),
    holoIntensity: typeof placement.holoIntensity === 'number' && Number.isFinite(placement.holoIntensity) ? Math.max(0, Math.min(1, placement.holoIntensity)) : 0,
    ...(prices ? { price: { amount: amount != null && Number.isFinite(amount) ? amount : null, currency: 'EUR' as const, source: 'Cardmarket' as const, asOf: pricing?.updated ?? null } } : {}),
  };
}
