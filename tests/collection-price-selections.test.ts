import { describe, expect, it } from 'vitest';
import { decodeCollectionPriceSelection } from '@/lib/collection-price-selections';

const id = 'entry-1';
const owner = 'owner';
const selection = {
  schemaVersion: 1, ownerUid: owner, entrySyncId: id, revision: 1, lastMutationId: 'mutation-1',
  updatedAtClient: 1_788_220_800_000, cleared: false, sourceSetId: 'sv03.5', sourceCardId: 'sv03.5-001',
  collectorNumber: '001/165', language: 'GERMAN', finish: 'Normal', variant: 'Standard', productId: 733596,
  metric: 'normal_avg_sell', amountMinor: 444, currency: 'EUR', sourceAt: 1_788_220_700_000, selectedAt: 1_788_220_800_000,
};

describe('collection price selection wire decoder', () => {
  it('accepts the exact cross-client schema and rejects unsafe or conflicting fields', () => {
    expect(decodeCollectionPriceSelection(selection, id, owner)).toMatchObject({ metric: 'normal_avg_sell', amountMinor: 444 });
    expect(decodeCollectionPriceSelection({ ...selection, productId: Number.MAX_SAFE_INTEGER + 1 }, id, owner)).toBeNull();
    expect(decodeCollectionPriceSelection({ ...selection, finish: 'Reverse Holo' }, id, owner)).toBeNull();
    expect(decodeCollectionPriceSelection({ ...selection, language: 'de' }, id, owner)).toBeNull();
    expect(decodeCollectionPriceSelection({ ...selection, sourceCardId: 'x'.repeat(121) }, id, owner)).toBeNull();
  });

  it('accepts only a complete null payload for a clear tombstone', () => {
    const cleared = { ...selection, cleared: true, ...Object.fromEntries([
      'sourceSetId', 'sourceCardId', 'collectorNumber', 'language', 'finish', 'variant', 'productId', 'metric',
      'amountMinor', 'currency', 'sourceAt', 'selectedAt',
    ].map((field) => [field, null])) };
    expect(decodeCollectionPriceSelection(cleared, id, owner)).toMatchObject({ cleared: true, metric: null });
    expect(decodeCollectionPriceSelection({ ...cleared, amountMinor: 1 }, id, owner)).toBeNull();
  });
});
