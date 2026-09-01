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

export interface TcgCardSummary { id: string; localId: string; name: string; image?: string; }

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
  githubUrl: string;
  kickstarterUrl: string;
  kickstarterCta: string;
  updates: SiteUpdate[];
  roadmap: RoadmapItem[];
}

export const defaultSiteContent: SiteContent = {
  heroTitle: 'Deine Sammlung. Deine Karten. Überall.',
  heroSubtitle: 'Android-Kartenscanner, deutsche Marktpreisorientierung, Binder, Portfolio und eine gemeinsame Cloud-Sammlung für Mobilgerät und Desktop.',
  statusBanner: 'DomiDex 1.0-pre-beta ist für private Tests verfügbar.',
  currentVersion: '1.0-pre-beta',
  currentBuild: '17',
  releaseStatus: 'Pre-Beta',
  discordUrl: process.env.NEXT_PUBLIC_DISCORD_URL ?? '',
  discordText: 'Tausche dich mit anderen Sammlern aus und begleite die Entwicklung.',
  githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com/nandedomi',
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
    { id: 'web', title: 'DomiDex Web', description: 'Desktop-Sammlung und Binder mit demselben Firebase-Konto.', status: 'In Development', order: 2 },
    { id: 'scanner', title: 'Scanner-Härtung', description: 'Weitere reale Karten, Lichtverhältnisse und Geräte werden getestet.', status: 'In Development', order: 3 },
    { id: 'kickstarter', title: 'Kickstarter', description: 'Projektseite und Kampagnenstart werden vorbereitet; noch kein Termin zugesagt.', status: 'Planned', order: 4 },
  ],
};

export function exactTrendPrice(card: TcgCardDetail, variant: TcgVariant): number | null {
  const pricing = variant.pricing?.cardmarket ?? card.pricing?.cardmarket;
  if (!pricing) return null;
  const holo = /holo|reverse/i.test(variant.type);
  const value = holo ? pricing['trend-holo'] : pricing.trend;
  return typeof value === 'number' && value > 0 ? value : null;
}
