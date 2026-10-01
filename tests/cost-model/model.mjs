// Offline resource-demand model only. No SDK, credentials, network or invented unit prices.
// Usage: node tests/cost-model/model.mjs > a caller-chosen local report.json
import { pathToFileURL } from 'node:url';

export const profiles = Object.freeze({
  light: Object.freeze({ activeDays: 10, collectionEntries: 100, initialCollectionSnapshotsPerDay: 1,
    privateRecords: 60, privateFullCyclesPerDay: 1, changesPerDay: 2, connectedListenerCopies: 1,
    evidencePerDay: 0.1, knowledgeDeliveriesPerEvidence: 1, reportsPerMonth: 0.1, reportMiB: 0.5,
    reportViewsPerUpload: 1, shareSessionsPerMonth: 1, shareMinutes: 1, shareExtraPages: 0,
    sharePlacements: 54, shareTotalFraction: 0, shareCreatesPerMonth: 1, catalogRequestsPerDay: 3 }),
  average: Object.freeze({ activeDays: 20, collectionEntries: 500, initialCollectionSnapshotsPerDay: 1,
    privateRecords: 400, privateFullCyclesPerDay: 2, changesPerDay: 10, connectedListenerCopies: 2,
    evidencePerDay: 2, knowledgeDeliveriesPerEvidence: 2, reportsPerMonth: 1, reportMiB: 2,
    reportViewsPerUpload: 2, shareSessionsPerMonth: 4, shareMinutes: 3, shareExtraPages: 2,
    sharePlacements: 500, shareTotalFraction: 0.1, shareCreatesPerMonth: 1, catalogRequestsPerDay: 10 }),
  heavy: Object.freeze({ activeDays: 30, collectionEntries: 2000, initialCollectionSnapshotsPerDay: 2,
    privateRecords: 1800, privateFullCyclesPerDay: 4, changesPerDay: 40, connectedListenerCopies: 3,
    evidencePerDay: 10, knowledgeDeliveriesPerEvidence: 4, reportsPerMonth: 4, reportMiB: 8,
    reportViewsPerUpload: 5, shareSessionsPerMonth: 15, shareMinutes: 10, shareExtraPages: 8,
    sharePlacements: 5000, shareTotalFraction: 0.25, shareCreatesPerMonth: 2, catalogRequestsPerDay: 40 }),
});

// Values below are explicit modeling assumptions, NOT a deployed configuration or measurements.
export const assumptions = Object.freeze({
  collectionBytesPerDocument: 1024, privateBytesPerDocument: 512, reportDocumentBytes: 4096,
  catalogResponseBytes: 16 * 1024, shareResponseBytes: 4096,
  privateCycleAdditionalLogicalReads: 4, mutationAdditionalLogicalReads: 2,
  sharedPublicCacheHitFraction: 0, catalogProviderHitFraction: 0,
});

export function sharedReadUnits(placements, neededEntries) {
  if (![placements, neededEntries].every(value => Number.isFinite(value) && value >= 0)
    || placements > 5000 || neededEntries > placements) throw Error('INVALID_SHARED_FIXTURE');
  // Actual successful handler: share+access+lock+binder twice, every placement, referenced entries.
  // Logical document operations, NOT billable SDK/index reads. Empty-query minimums excluded.
  return 8 + placements + neededEntries;
}

export function model(profile, activeUsers, overrides = {}) {
  if (!Number.isSafeInteger(activeUsers) || activeUsers < 1) throw Error('INVALID_USER_COUNT');
  const p = typeof profile === 'string' ? profiles[profile] : profile;
  if (!p || Object.keys(profiles.light).some(key => !Number.isFinite(p[key]) || p[key] < 0)) throw Error('INVALID_PROFILE');
  if (p.activeDays > 31 || p.reportMiB > 10 || p.sharePlacements > 5000 || p.shareTotalFraction > 1) throw Error('INVALID_PROFILE');
  if (Object.keys(overrides).some(key => !Object.hasOwn(assumptions, key))) throw Error('UNKNOWN_ASSUMPTION');
  const a = { ...assumptions, ...overrides };
  if (Object.values(a).some(value => !Number.isFinite(value) || value < 0)
    || a.sharedPublicCacheHitFraction > 1 || a.catalogProviderHitFraction > 1) throw Error('INVALID_ASSUMPTION');
  const activeUserDays = activeUsers * p.activeDays;
  const mutations = activeUserDays * p.changesPerDay;
  const evidence = activeUserDays * p.evidencePerDay;
  const reports = activeUsers * p.reportsPerMonth;
  const reportViews = reports * p.reportViewsPerUpload;
  const shareCreates = activeUsers * p.shareCreatesPerMonth;
  const shareRequests = activeUsers * p.shareSessionsPerMonth * (1 + Math.floor(p.shareMinutes * 4) + p.shareExtraPages);
  const needed = (1 - p.shareTotalFraction) * Math.min(9, p.sharePlacements) + p.shareTotalFraction * p.sharePlacements;
  const catalogRequests = activeUserDays * p.catalogRequestsPerDay;
  const reads = {
    collectionInitial: activeUserDays * p.initialCollectionSnapshotsPerDay * p.collectionEntries,
    privateFullCycles: activeUserDays * p.privateFullCyclesPerDay * (p.privateRecords + a.privateCycleAdditionalLogicalReads),
    mutationTransactionsAndOverhead: mutations * (1 + a.mutationAdditionalLogicalReads),
    collectionChangeDeliveries: mutations * p.connectedListenerCopies,
    knowledgeAggregation: evidence * 4,
    knowledgeDeliveries: evidence * p.knowledgeDeliveriesPerEvidence,
    reportUploads: reports * 10, reportViews: reportViews * 3,
    shareCreates: shareCreates * 5, publicShares: shareRequests * sharedReadUnits(p.sharePlacements, needed),
  };
  // No retries/aborts: one new evidence write + three aggregator writes; report has quota,
  // ownership-operation and report creates, plus one separate operation deletion.
  const writes = { mutations, knowledgeIncludingEvidence: evidence * 4, reportCreates: reports * 3,
    shareCreatesIncludingQuota: shareCreates * 2 };
  const sum = values => Object.values(values).reduce((total, value) => total + value, 0);
  return {
    activeUsers, period: 'hypothetical month; active days specified by profile', profile: p, assumptions: a,
    logicalReads: { ...reads, total: sum(reads) }, logicalWrites: { ...writes, total: sum(writes) },
    logicalDeletes: reports, // Successful upload removes its durable privateUploadOperation.
    cloudRun: { modeledRequests: shareRequests + reports + reportViews + shareCreates + catalogRequests,
      publicShareRequests: shareRequests, latencyMs: null, cpuSeconds: null, gibSeconds: null },
    functions: { eligibleNewEvidenceInvocations: evidence, retries: null, cpuSeconds: null, gibSeconds: null },
    catalog: { webRequests: catalogRequests,
      sharedUncachedDistinctCardLoadsUpperModel: shareRequests * needed * (1 - a.sharedPublicCacheHitFraction),
      otherProviderLoadsModel: catalogRequests * (1 - a.catalogProviderHitFraction),
      englishFallbackLoads: null, androidDirectGuideBytes: null },
    bytes: {
      firestoreModeledCurrentPayloadOnly: activeUsers * (p.collectionEntries * a.collectionBytesPerDocument + p.privateRecords * a.privateBytesPerDocument),
      firestoreNewReportPayloadThisMonth: reports * a.reportDocumentBytes,
      storageNewUploadBytesThisMonth: reports * p.reportMiB * 1024 ** 2,
      storageDownloadBytesToRuntime: reportViews * p.reportMiB * 1024 ** 2,
      sharedJsonEgressModel: shareRequests * a.shareResponseBytes,
      catalogJsonEgressModel: catalogRequests * a.catalogResponseBytes,
      reportHttpResponseBytes: null, firestoreActualStorage: null, indexStorage: null, retainedObjectVersions: null,
    },
    monetaryCost: null,
    exclusions: ['SDK/transaction retries and index/rule-dependent billing', 'daily-active overlap, reconnect and background actual schedule',
      'HTML/static/card artwork CDN bytes and unknown direct Android provider downloads', 'report review/deletion, account deletion inventory, admin reads',
      'Knowledge/contributor/audit/tombstone retention growth and storage versions', 'Cloud Logging volume, images, build/artifact registry and hosting charges',
      'region/SKU/unit prices/free tiers/tax/currency/actual compute; no currency result'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ simulationOnly: true, productionMeasured: false, pricesSpecified: false,
    scenarios: [1000, 5000, 10000, 50000].flatMap(users => Object.keys(profiles).map(profile => ({ name: profile, ...model(profile, users) }))) }, null, 2));
}
