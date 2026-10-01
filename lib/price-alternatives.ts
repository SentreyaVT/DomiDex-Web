import { isQuarantinedCardmarketIdentity } from './cardmarket-identity';
import {
  canonicalTcgCardId,
  cardmarketPricingForVariant,
  exactCardmarketProductId,
  type CollectionEntry,
  type TcgCardDetail,
  type TcgVariant,
} from './domain';

export const collectionPriceMetrics = [
  'normal_avg_sell',
  'normal_low',
  'normal_avg_1d',
  'normal_avg_7d',
  'normal_avg_30d',
  'reverse_holo_avg_sell',
  'reverse_holo_low',
] as const;

export type CollectionPriceMetric = typeof collectionPriceMetrics[number];

export interface AlternativePriceCandidate {
  metric: CollectionPriceMetric;
  label: string;
  productId: number;
  amountMinor: number;
  currency: 'EUR';
  sourceAt: number;
}

export interface CollectionPriceSelection {
  schemaVersion: 1;
  ownerUid: string;
  entrySyncId: string;
  revision: number;
  lastMutationId: string;
  updatedAtClient: number;
  cleared: boolean;
  sourceSetId: string | null;
  sourceCardId: string | null;
  collectorNumber: string | null;
  language: string | null;
  finish: string | null;
  variant: string | null;
  productId: number | null;
  metric: CollectionPriceMetric | null;
  amountMinor: number | null;
  currency: 'EUR' | null;
  sourceAt: number | null;
  selectedAt: number | null;
}

const normalMetrics: ReadonlyArray<[CollectionPriceMetric, string, 'avg' | 'low' | 'avg1' | 'avg7' | 'avg30']> = [
  ['normal_avg_sell', 'Durchschnittlicher Verkaufspreis', 'avg'],
  ['normal_low', 'Niedrigster verfügbarer Preis', 'low'],
  ['normal_avg_1d', 'Durchschnitt der letzten 24 Stunden', 'avg1'],
  ['normal_avg_7d', 'Durchschnitt der letzten 7 Tage', 'avg7'],
  ['normal_avg_30d', 'Durchschnitt der letzten 30 Tage', 'avg30'],
];
const reverseMetrics: ReadonlyArray<[CollectionPriceMetric, string, 'avg-holo' | 'low-holo']> = [
  ['reverse_holo_avg_sell', 'Reverse-Holo Durchschnittspreis', 'avg-holo'],
  ['reverse_holo_low', 'Reverse-Holo Niedrigstpreis', 'low-holo'],
];

export function alternativePriceCandidates(card: TcgCardDetail, variant: TcgVariant): AlternativePriceCandidate[] {
  const pricing = cardmarketPricingForVariant(card, variant);
  const productId = exactCardmarketProductId(card, variant);
  const sourceAt = sourceEpochMillis(pricing?.updated);
  if (!pricing || productId === null || sourceAt === null || (pricing.unit && pricing.unit !== 'EUR')
    || isQuarantinedCardmarketIdentity(canonicalTcgCardId(card.id), productId)) return [];
  const definitions = /reverse/i.test(variant.type) ? reverseMetrics : normalMetrics;
  return definitions.flatMap(([metric, label, key]) => {
    const amountMinor = euroToMinor(pricing[key]);
    return amountMinor === null ? [] : [{ metric, label, productId, amountMinor, currency: 'EUR' as const, sourceAt }];
  });
}

export function manualSelectionPrice(entry: CollectionEntry, selection?: CollectionPriceSelection | null): number | null {
  if (!selection || selection.cleared || selection.ownerUid !== entry.ownerUid || selection.entrySyncId !== entry.syncId
    || entry.deleted || !entry.sourceSetId || !entry.sourceCardId || entry.externalProductSource !== 'CARDMARKET_PUBLIC_DOWNLOAD' || entry.externalProductId === null
    || selection.sourceSetId !== entry.sourceSetId || selection.sourceCardId !== entry.sourceCardId
    || selection.collectorNumber !== entry.collectorNumber || selection.language !== entry.language
    || selection.finish !== entry.finish || selection.variant !== entry.variant
    || selection.productId !== entry.externalProductId || selection.currency !== 'EUR'
    || !selection.metric || !collectionPriceMetricMatchesFinish(selection.metric, entry.finish)
    || !Number.isSafeInteger(selection.amountMinor) || selection.amountMinor! <= 0
    || !Number.isSafeInteger(selection.sourceAt) || selection.sourceAt! <= 0
    || !Number.isSafeInteger(selection.selectedAt) || selection.selectedAt! <= 0
    || isQuarantinedCardmarketIdentity(canonicalTcgCardId(entry.sourceCardId), selection.productId)) return null;
  return selection.amountMinor! / 100;
}

export function collectionPriceMetricLabel(metric: CollectionPriceMetric) {
  return [...normalMetrics, ...reverseMetrics].find(([candidate]) => candidate === metric)?.[1] ?? metric;
}

export function isCollectionPriceMetric(value: unknown): value is CollectionPriceMetric {
  return typeof value === 'string' && (collectionPriceMetrics as readonly string[]).includes(value);
}

export function collectionPriceMetricMatchesFinish(metric: CollectionPriceMetric, finish: string) {
  return /reverse/i.test(finish) ? metric.startsWith('reverse_holo_') : metric.startsWith('normal_');
}

function euroToMinor(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const minor = Math.round((value + Number.EPSILON) * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function sourceEpochMillis(value: unknown): number | null {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const millis = value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
    return Number.isSafeInteger(millis) && millis > 0 ? millis : null;
  }
  return null;
}
