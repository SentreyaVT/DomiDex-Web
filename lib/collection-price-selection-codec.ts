import { collectionPriceMetricMatchesFinish, isCollectionPriceMetric,
  type CollectionPriceMetric, type CollectionPriceSelection } from './price-alternatives';

export const collectionPriceSelectionNullableFields = [
  'sourceSetId', 'sourceCardId', 'collectorNumber', 'language', 'finish', 'variant',
  'productId', 'metric', 'amountMinor', 'currency', 'sourceAt', 'selectedAt',
] as const;
const entrySyncIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

/** Same persisted sidecar contract for browser snapshots and trusted server reads; no SDK import. */
export function decodeCollectionPriceSelection(data: Record<string, unknown>, id: string, ownerUid: string): CollectionPriceSelection | null {
  if (!entrySyncIdPattern.test(id) || data.schemaVersion !== 1 || data.ownerUid !== ownerUid || data.entrySyncId !== id
    || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1
    || typeof data.lastMutationId !== 'string' || !data.lastMutationId.match(/^[A-Za-z0-9._-]{1,128}$/)
    || !Number.isSafeInteger(data.updatedAtClient) || (data.updatedAtClient as number) <= 0 || typeof data.cleared !== 'boolean') return null;
  if (data.cleared) {
    if (collectionPriceSelectionNullableFields.some((field) => data[field] !== null)) return null;
    return { schemaVersion: 1, ownerUid, entrySyncId: id, revision: data.revision as number, lastMutationId: data.lastMutationId,
      updatedAtClient: data.updatedAtClient as number, cleared: true, sourceSetId: null, sourceCardId: null,
      collectorNumber: null, language: null, finish: null, variant: null, productId: null, metric: null,
      amountMinor: null, currency: null, sourceAt: null, selectedAt: null };
  }
  if (!boundedString(data.sourceSetId, 120) || !boundedString(data.sourceCardId, 120)
    || !boundedString(data.collectorNumber, 80) || !canonicalLanguage(data.language)
    || !boundedString(data.finish, 80) || !boundedString(data.variant, 80)
    || !Number.isSafeInteger(data.productId) || (data.productId as number) <= 0 || !isCollectionPriceMetric(data.metric)
    || !collectionPriceMetricMatchesFinish(data.metric, data.finish)
    || !Number.isSafeInteger(data.amountMinor) || (data.amountMinor as number) <= 0 || data.currency !== 'EUR'
    || !Number.isSafeInteger(data.sourceAt) || (data.sourceAt as number) <= 0
    || !Number.isSafeInteger(data.selectedAt) || (data.selectedAt as number) <= 0) return null;
  return {
    schemaVersion: 1, ownerUid, entrySyncId: id, revision: data.revision as number, lastMutationId: data.lastMutationId,
    updatedAtClient: data.updatedAtClient as number, cleared: false, sourceSetId: data.sourceSetId, sourceCardId: data.sourceCardId,
    collectorNumber: data.collectorNumber, language: data.language, finish: data.finish, variant: data.variant,
    productId: data.productId as number, metric: data.metric as CollectionPriceMetric, amountMinor: data.amountMinor as number,
    currency: 'EUR', sourceAt: data.sourceAt as number, selectedAt: data.selectedAt as number,
  };
}

function nonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function boundedString(value: unknown, max: number): value is string { return nonEmptyString(value) && value.length <= max; }
function canonicalLanguage(value: unknown): value is string { return boundedString(value, 30) && /^[A-Z_]{2,30}$/.test(value); }
