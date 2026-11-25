import { isQuarantinedCardmarketIdentity } from './cardmarket-identity';

export type Finish = string;

export interface CollectionEntry {
  syncId: string;
  ownerUid: string;
  revision: number;
  lastMutationId: string;
  updatedAtClient: number;
  /** Original ownership creation time. Null is an explicit legacy-data fallback. */
  createdAtClient?: number | null;
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
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  'avg-holo'?: number | null;
  'low-holo'?: number | null;
  'trend-holo'?: number | null;
}

export interface TcgVariant {
  type: string;
  size?: string;
  subtype?: string | null;
  stamp?: string[];
  foil?: string;
  variantId?: string;
  /** Identity declared for this printing, never inherited from the card-wide root. */
  thirdParty?: { cardmarket?: number | null };
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
  /** Provider-supplied publication date; absent data is never guessed. */
  releaseDate?: string;
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
  heroSubtitle: 'Pokémon-Karten sammeln, private Binder gestalten und deine Lieblingskarten per Link zeigen. Android und Web verbinden deine Sammlung – aktuell in der geschlossenen Alpha.',
  statusBanner: 'DomiDex ist in der geschlossenen Alpha. Android-Zugang über den internen Google-Play-Test und die persönliche Web-App werden über den privaten Testerprozess in unserer Discord-Community freigeschaltet.',
  currentVersion: '',
  currentBuild: '',
  releaseStatus: 'Geschlossene Alpha',
  discordUrl: process.env.NEXT_PUBLIC_DISCORD_URL ?? 'https://discord.gg/fc9XgwtVTE',
  discordText: 'Zeig deinen Binder, tausche dich mit anderen Sammlern aus und hilf mit ehrlichem Feedback. Wenn du mit Android testen möchtest, öffne im Discord ein privates Tester-Ticket.',
  kickstarterUrl: process.env.NEXT_PUBLIC_KICKSTARTER_URL ?? '',
  kickstarterCta: 'Kickstarter – noch kein Starttermin',
  updates: [{
    id: 'closed-alpha-sharing-20260923', title: 'Geschlossene Alpha: Deinen privaten Binder teilen', date: '2026-09-23',
    version: 'Geschlossene Alpha', build: '', active: true,
    summary: 'Private Binder mit eigenen Covern, freier Kartenanordnung und individuellen Holo-Effekten lassen sich jetzt per Link zum Ansehen teilen.',
    details: 'Andere können den freigegebenen Binder im Browser oder mit einer unterstützten DomiDex-Android-Version ansehen, aber nicht bearbeiten. Nur ausdrücklich freigegebene Inhalte werden gezeigt; die übrige Sammlung bleibt privat. Freigaben kannst du wieder beenden. Die Web-App bietet große Kartenansichten und Holo-Vorschauen.',
  }, {
    id: 'catalog-prices-20260923', title: 'Jubiläumskarten, Preise und Synchronisierung', date: '2026-09-23',
    version: 'Aktueller Informationsstand', build: '', active: true,
    summary: 'Das 30-Jahre-Set und ergänzte Promokarten sind im Katalog. Die Preiszuordnung wird weiter vervollständigt; einzelne Sonderkarten und Promos können noch ohne Preis bleiben.',
    details: 'Cardmarket-Preise erscheinen nur bei verlässlicher Karten- und Variantenzuordnung. Fehlende Werte werden nicht geschätzt. Sammlung und Binder werden bei bestehender Verbindung zwischen Android und Web mit demselben freigeschalteten Google-Konto synchronisiert. Marktpreise werden separat abgerufen und zwischengespeichert; sie sind keine garantierten Verkaufspreise und nicht immer sofort aktuell.',
  }, {
    id: 'pre-beta-17', title: 'Archiv: Start der privaten Testphase', date: '2026-09-01',
    version: '1.0-pre-beta', build: '17', active: true,
    summary: 'Historischer Stand des ersten privaten Android-Testlaufs mit Scanner, Bindern, Preisübersicht und Synchronisierung. Dies ist nicht die aktuelle Buildangabe.',
    details: 'Der heutige Test läuft als geschlossene Alpha. Den jeweils freigegebenen Android-Teststand und Hinweise zur Teilnahme erhältst du über den privaten Testerprozess im Discord.',
  }],
  roadmap: [
    { id: 'pre-beta', title: 'Geschlossene Alpha für Android', description: 'Für freigeschaltete Tester im internen Google-Play-Test verfügbar. Kein öffentlicher App-Release.', status: 'Released', order: 1 },
    { id: 'web', title: 'DomiDex Web', description: 'Für freigeschaltete Tester verfügbar: Sammlung, Binder, Portfolio und große Kartenansichten mit demselben Google-Konto wie in Android.', status: 'Released', order: 2 },
    { id: 'sharing', title: 'Private Binder gestalten und teilen', description: 'Eigene Cover, individuelle Holo-Effekte und Freigabelinks zum Ansehen. Die restliche Sammlung bleibt privat.', status: 'Released', order: 3 },
    { id: 'scanner', title: 'Kartenerkennung weiter verbessern', description: 'Reale Karten, Lichtverhältnisse und Geräte bleiben im Test. Freiwillige ScanLab-Fotos werden nur nach deiner manuellen Freigabe hochgeladen.', status: 'In Development', order: 4 },
    { id: 'prices', title: 'Katalog- und Preisabdeckung', description: 'Fehlende Zuordnungen im 30-Jahre-Set und bei Promokarten ergänzen. Unsichere Preise bleiben als nicht verfügbar gekennzeichnet.', status: 'In Development', order: 5 },
    { id: 'kickstarter', title: 'Kickstarter', description: 'Noch keine gestartete Kampagne und kein bestätigter Starttermin. Neuigkeiten dazu folgen erst nach einer konkreten Ankündigung.', status: 'Planned', order: 6 },
  ],
};

export function cardmarketPricingForVariant(_card: TcgCardDetail, variant: TcgVariant) {
  // One generated printing is not evidence that card-wide prices belong to it.
  // Reviewed supplements/anniversary bridges already attach printing-level pricing.
  return variant.pricing?.cardmarket ?? null;
}

export function exactCardmarketProductId(card: TcgCardDetail, variant: TcgVariant): number | null {
  const ids = [variant.pricing?.cardmarket?.idProduct, variant.thirdParty?.cardmarket].filter((id) => id != null);
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id! <= 0 || id !== ids[0])) return null;
  const id = ids[0]!;
  if (typeof variant.variantId === 'string' && variant.variantId.trim()) {
    const finish = normalizedFinish(variant.type);
    const description = collectionVariantLabel(variant);
    for (const sibling of card.variants_detailed ?? []) {
      if (sibling.variantId !== variant.variantId || normalizedFinish(sibling.type) !== finish
        || collectionVariantLabel(sibling) !== description) continue;
      // Compare raw declarations: resolving a contradictory sibling first would
      // erase its evidence. Do not inherit a sibling's product or price.
      const declared = [sibling.pricing?.cardmarket?.idProduct, sibling.thirdParty?.cardmarket];
      if (declared.some((candidate) => candidate != null && Number.isSafeInteger(candidate)
        && candidate > 0 && candidate !== id)) return null;
    }
  }
  return isQuarantinedCardmarketIdentity(canonicalTcgCardId(card.id), id) ? null : id;
}

export function exactTrendPrice(card: TcgCardDetail, variant: TcgVariant): number | null {
  const pricing = cardmarketPricingForVariant(card, variant);
  if (!pricing || (pricing.unit && pricing.unit !== 'EUR')) return null;
  if (exactCardmarketProductId(card, variant) === null) return null;
  // Cardmarket's Pokemon guide calls the Reverse Holo field "trend-holo".
  // Regular Holo cards use "trend"; a missing Reverse price must never borrow it.
  const preferred = /reverse/i.test(variant.type) ? pricing['trend-holo'] : pricing.trend;
  if (typeof preferred === 'number' && Number.isFinite(preferred) && preferred > 0) return preferred;
  return null;
}

export function canonicalTcgCardId(value: string) {
  return value.trim().replace(/-(?:1steditionholofoil|unlimitedholofoil|reverse-?holofoil|reverse-holo|1stedition|unlimited|holofoil|reverse|holo|normal)$/i, '');
}

export function collectionVariantLabel(variant: TcgVariant) {
  const base = variant.size?.trim() || (/reverse/i.test(variant.type) ? 'Reverse Holo' : /holo/i.test(variant.type) ? 'Holo' : 'Standard');
  const parts = base.split(' · ');
  const append = (label: string, raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    const value = `${label}: ${raw.trim()}`;
    // Preserve precomposed labels verbatim; compare complete markers only.
    if (!parts.some((part) => part.trim().toLowerCase() === value.toLowerCase())) parts.push(value);
  };
  append('Untertyp', variant.subtype);
  const stamps = new Map<string, string>();
  const rawStamps: unknown[] = Array.isArray(variant.stamp) ? variant.stamp : [variant.stamp];
  for (const item of rawStamps) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const stamp = item.trim();
    if (!stamps.has(stamp.toLowerCase())) stamps.set(stamp.toLowerCase(), stamp);
  }
  append('Stempel', [...stamps].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, stamp]) => stamp).join(' + '));
  append('Folie', variant.foil);
  return parts.join(' · ');
}

export function collectionPriceIdentity(entry: CollectionEntry) {
  return [canonicalTcgCardId(entry.sourceCardId ?? ''), entry.externalProductId ?? '', normalizedFinish(entry.finish), normalizedVariant(entry.variant)].join('|');
}

export function cardVariantsForSelection(card: TcgCardDetail): TcgVariant[] {
  return card.variants_detailed?.length
    ? card.variants_detailed
    : [{ type: 'Normal', size: 'Standard' }];
}

export function variantForCollectionEntry(card: TcgCardDetail, entry: CollectionEntry) {
  let variants = cardVariantsForSelection(card);
  if (entry.externalProductId != null) {
    if (!Number.isSafeInteger(entry.externalProductId) || entry.externalProductId <= 0) return null;
    variants = variants.filter((item) => exactCardmarketProductId(card, item) === entry.externalProductId);
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
