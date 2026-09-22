export type Finish = string;

export interface CollectionEntry {
  syncId: string;
  ownerUid: string;
  revision: number;
  lastMutationId: string;
  updatedAtClient: number;
  deleted: boolean;
  deletedAtClient: number | null;
  name: string;
  setId: string;
  setName: string;
  collectorNumber: string;
  language: string;
  finish: Finish;
  variant: string;
  rarity: string;
  quantity: number;
  condition: string;
  notes: string;
  acquisitionPriceMinor: number | null;
  acquisitionCurrency: string | null;
  acquisitionDateEpochDay: number | null;
  externalProductSource: string | null;
  externalProductId: number | null;
  imageUrl: string | null;
  effectOverride: string | null;
  binderId: string;
  sourceSetId: string | null;
  sourceCardId: string | null;
  binderSetKey: string;
  binderName: string;
  binderHeroAsset: string | null;
}

export interface CardmarketPricing {
  updated?: string;
  unit?: string;
  idProduct?: number;
  trend?: number | null;
  'trend-holo'?: number | null;
}

export interface TcgVariant {
  type: string;
  size?: string;
  stamp?: string[];
  foil?: string;
  variantId?: string;
  pricing?: { cardmarket?: CardmarketPricing | null };
}

export interface TcgCardSummary {
  id: string;
  localId: string;
  name: string;
  image?: string;
  rarity?: string;
  printVariants?: string[];
}

export interface TcgSetDetail {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount?: { official?: number; total?: number };
  cards: TcgCardSummary[];
}

export interface TcgCardDetail extends TcgCardSummary {
  image?: string;
  rarity?: string;
  set: { id: string; name: string; logo?: string; cardCount?: { official?: number; total?: number } };
  variants?: { normal?: boolean; holo?: boolean; reverse?: boolean };
  variants_detailed?: TcgVariant[];
  pricing?: { cardmarket?: CardmarketPricing | null };
}

export interface SiteUpdate {
  id: string;
  title: string;
  date: string;
  version: string;
  build: string;
  summary: string;
  details: string;
  imageUrl?: string;
  linkUrl?: string;
  active: boolean;
}

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: 'Released' | 'In Development' | 'Planned' | 'Experimental';
  order: number;
}

export interface SiteContent {
  heroTitle: string;
  heroSubtitle: string;
  statusBanner: string;
  currentVersion: string;
  currentBuild: string;
  releaseStatus: string;
  discordUrl: string;
  discordText: string;
  kickstarterUrl: string;
  kickstarterCta: string;
  updates: SiteUpdate[];
  roadmap: RoadmapItem[];
}

export const defaultSiteContent: SiteContent = {
  heroTitle: 'Deine Karten. Deine Sammlung. Dein Binder.',
  heroSubtitle: 'Pokémon-TCG-Karten erfassen, Druckvarianten im digitalen Binder verwalten und deine private Sammlung zwischen Android und Web synchron halten.',
  statusBanner: 'DomiDex ist im internen Google-Play-Test verfügbar. Zugang und aktuelle Testversion erhältst du über den Testerprozess in unserer Discord-Community.',
  currentVersion: '1.0-pre-beta',
  currentBuild: '',
  releaseStatus: 'Pre-Beta',
  discordUrl: process.env.NEXT_PUBLIC_DISCORD_URL ?? '',
  discordText: 'Tausche dich mit anderen Sammlern aus und begleite die Entwicklung.',
  kickstarterUrl: process.env.NEXT_PUBLIC_KICKSTARTER_URL ?? '',
  kickstarterCta: 'Kickstarter – Coming Soon',
  updates: [{
    id: 'pre-beta-17', title: 'DomiDex erreicht die Pre-Beta', date: '2026-09-01',
    version: '1.0-pre-beta', build: '17', active: true,
    summary: 'Grading, Binder, Preise, Portfolio und Cloud-Synchronisation wurden für den ersten privaten Testlauf stabilisiert.',
    details: 'Bestätigte und korrigierte Scans können datensparsame Erkennungshinweise beitragen. Der Scanner bleibt in aktiver Entwicklung.',
  }],
  roadmap: [
    { id: 'pre-beta', title: 'Pre-Beta für Android', description: 'Installierbarer Teststand mit Scanner, Binder, Portfolio und Cloud-Sync.', status: 'Released', order: 1 },
    { id: 'web', title: 'DomiDex Web', description: 'Für freigeschaltete Tester verfügbar: Desktop-Sammlung und Binder mit demselben Firebase-Konto.', status: 'Released', order: 2 },
    { id: 'scanner', title: 'Scanner-Härtung', description: 'Weitere reale Karten, Lichtverhältnisse und Geräte werden getestet.', status: 'In Development', order: 3 },
    { id: 'kickstarter', title: 'Kickstarter', description: 'Projektseite und Kampagnenstart werden vorbereitet; noch kein Termin zugesagt.', status: 'Planned', order: 4 },
  ],
};

export function exactTrendPrice(card: TcgCardDetail, variant: TcgVariant): number | null {
  const ownPricing = variant.pricing?.cardmarket;
  const pricing = ownPricing ?? (card.variants_detailed && card.variants_detailed.length > 1 ? null : card.pricing?.cardmarket);
  if (!pricing || !Number.isSafeInteger(pricing.idProduct) || pricing.idProduct! <= 0 || (pricing.unit && pricing.unit !== 'EUR')) return null;
  const holo = /holo|reverse/i.test(variant.type);
  const preferred = holo ? pricing['trend-holo'] : pricing.trend;
  const fallback = holo ? pricing.trend : null;
  if (typeof preferred === 'number' && Number.isFinite(preferred) && preferred > 0) return preferred;
  return typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

export function canonicalTcgCardId(value: string) {
  return value.trim().replace(/-(?:1steditionholofoil|unlimitedholofoil|reverse-?holofoil|reverse-holo|1stedition|unlimited|holofoil|reverse|holo|normal)$/i, '');
}

export function collectionVariantLabel(variant: TcgVariant) {
  return variant.size?.trim() || (/reverse/i.test(variant.type) ? 'Reverse Holo' : /holo/i.test(variant.type) ? 'Holo' : 'Standard');
}

export function collectionPriceIdentity(entry: CollectionEntry) {
  return [canonicalTcgCardId(entry.sourceCardId ?? ''), entry.externalProductId ?? '', normalizedFinish(entry.finish), normalizedVariant(entry.variant)].join('|');
}

export function variantForCollectionEntry(card: TcgCardDetail, entry: CollectionEntry) {
  let variants = card.variants_detailed?.length
    ? card.variants_detailed
    : [{ type: 'Normal', size: 'Standard', pricing: card.pricing }];
  if (entry.externalProductId != null) {
    if (!Number.isSafeInteger(entry.externalProductId) || entry.externalProductId <= 0) return null;
    const allowCardPricing = variants.length === 1;
    variants = variants.filter((item) => (item.pricing?.cardmarket?.idProduct ?? (allowCardPricing ? card.pricing?.cardmarket?.idProduct : undefined)) === entry.externalProductId);
    // A known product must never fall back to a similarly labelled different product.
    if (variants.length === 0) return null;
    if (variants.length === 1) return normalizedFinish(variants[0].type) === normalizedFinish(entry.finish) ? variants[0] : null;
  }
  const finishMatches = variants.filter((item) => normalizedFinish(item.type) === normalizedFinish(entry.finish));
  const stored = normalizedVariant(entry.variant);
  const descriptorMatches = finishMatches.filter((item) => {
    const descriptor = normalizedVariant(collectionVariantLabel(item));
    const identity = normalizedVariant(item.variantId ?? '');
    return descriptor === stored || Boolean(identity && identity === stored);
  });
  if (descriptorMatches.length === 1) return descriptorMatches[0];
  return finishMatches.length === 1 ? finishMatches[0] : null;
}

function normalizedFinish(value: string) { if (/reverse/i.test(value)) return 'reverse-holo'; if (/holo/i.test(value)) return 'holo'; return 'normal'; }
function normalizedVariant(value: string) { return value.toLocaleLowerCase('de').replace(/[^a-z0-9]+/g, ' ').trim(); }
