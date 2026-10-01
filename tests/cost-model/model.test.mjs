import test from 'node:test';
import assert from 'node:assert/strict';
import { model, profiles, sharedReadUnits } from './model.mjs';

test('successful sharing document model matches actual 5k fixture cold and warm', () => {
  assert.equal(sharedReadUnits(5000, 9), 5017);
  assert.equal(sharedReadUnits(5000, 5000), 10008);
  assert.equal(sharedReadUnits(5000, 9) * 80, 401360);
  assert.throws(() => sharedReadUnits(5001, 9));
});
test('deterministic profiles stay linear for 1k, 5k, 10k and 50k only under stated assumptions', () => {
  for (const profile of Object.keys(profiles)) {
    const baseline = model(profile, 1000);
    for (const users of [5000, 10000, 50000]) {
      const result = model(profile, users);
      assert.equal(result.logicalReads.total, baseline.logicalReads.total * users / 1000);
      assert.equal(result.logicalWrites.total, baseline.logicalWrites.total * users / 1000);
      assert.equal(result.bytes.storageNewUploadBytesThisMonth, baseline.bytes.storageNewUploadBytesThisMonth * users / 1000);
    }
  }
});
test('public catalog cache changes modeled provider demand, never logical Firestore reads', () => {
  const cold = model('average', 1000), warm = model('average', 1000, { sharedPublicCacheHitFraction: 0.75 });
  assert.deepEqual(cold.logicalReads, warm.logicalReads);
  assert.equal(warm.catalog.sharedUncachedDistinctCardLoadsUpperModel, cold.catalog.sharedUncachedDistinctCardLoadsUpperModel / 4);
});
test('polls and total-enabled reads are explicit and separately inspectable', () => {
  const base = { ...profiles.light, sharePlacements: 5000, shareSessionsPerMonth: 1, shareMinutes: 1 };
  const without = model(base, 1000), total = model({ ...base, shareTotalFraction: 1 }, 1000);
  assert.equal(without.cloudRun.publicShareRequests, 5000);
  assert.equal(without.logicalReads.publicShares, 5000 * 5017);
  assert.equal(total.logicalReads.publicShares, 5000 * 10008);
});
test('no currency or actual latency/memory/retention claims are invented', () => {
  const result = model('heavy', 1000);
  assert.equal(result.monetaryCost, null);
  assert.equal(result.cloudRun.latencyMs, null);
  assert.equal(result.bytes.firestoreActualStorage, null);
  assert.equal(result.bytes.retainedObjectVersions, null);
  assert.ok(result.exclusions.length > 4);
});
test('rejects invalid sizes and unknown parameters instead of silently dropping them', () => {
  for (const count of [0, -1, 1.5, NaN]) assert.throws(() => model('light', count));
  assert.throws(() => model('unknown', 1000));
  assert.throws(() => model('light', 1000, { guessedPrice: 0.1 }));
  assert.throws(() => model('light', 1000, { sharedPublicCacheHitFraction: 1.1 }));
  assert.throws(() => model({ ...profiles.light, reportMiB: 11 }, 1000));
});
