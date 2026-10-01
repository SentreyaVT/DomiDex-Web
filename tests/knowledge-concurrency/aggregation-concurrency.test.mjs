import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransactionDouble, ref, version } from './transaction-double.mjs';

const backendRequire = createRequire(new URL('../../backend/scan-knowledge/index.js', import.meta.url));
let harness;
const initializeApp = vi.fn();
const onDocumentWritten = vi.fn((_options, handler) => handler);
function mockSdkExport(specifier, factory) {
  const resolved = backendRequire.resolve(specifier);
  let directory = path.dirname(resolved);
  const packageName = specifier.split('/')[0];
  let metadata;
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (metadata.name === packageName) break;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw Error(`SDK package not found: ${packageName}`);
    directory = parent;
  }
  vi.doMock(resolved, factory);
  const conditions = metadata.exports[`./${specifier.slice(packageName.length + 1)}`];
  if (conditions.import) vi.doMock(path.resolve(directory, conditions.import), factory);
}
mockSdkExport('firebase-admin/app', () => ({ initializeApp }));
mockSdkExport('firebase-admin/firestore', () => ({ getFirestore: () => harness.db,
  FieldValue: { serverTimestamp: () => 'synthetic-server-timestamp' } }));
mockSdkExport('firebase-functions/v2/firestore', () => ({ onDocumentWritten }));
// Only SDK boundaries are mocked: current-evidence + reducer + exported handler are actual code.
const { aggregateScanKnowledge } = await import('../../backend/scan-knowledge/index.js');
const { aggregateVote } = await import('../../backend/scan-knowledge/knowledge-aggregate.js');
const fingerprint = 'a'.repeat(64);
const summaryPath = `scanKnowledgePrivate/${fingerprint}`;
const publicPath = `scanKnowledge/${fingerprint}`;
const contributorPath = uid => `${summaryPath}/contributors/${crypto.createHash('sha256').update(uid).digest('hex')}`;
const evidencePath = uid => `users/${uid}/scanEvidence/${fingerprint}`;
const lockPath = uid => `accountDeletionLocks/${uid}`;
const publicKnowledge = () => harness.read(publicPath);

function makeEvent(uid, { cardId = 'sv3-215', time = 1, corrected = false } = {}) {
  const evidence = { fingerprint, confirmedCardId: cardId, observedAtClient: time, corrected,
    sourceSetId: 'sv3', cardNumber: '215', setCode: 'OBF', knowledgeVersion: 1 };
  const revision = harness.put(evidencePath(uid), evidence);
  return { params: { uid, fingerprint }, data: { after: {
    ref: ref(evidencePath(uid)), updateTime: version(revision), data: () => structuredClone(evidence),
  } } };
}
beforeEach(() => { harness = createTransactionDouble(); });

async function runBatch(scenario, events, maxAttempts) {
  const started = performance.now();
  const timings = [];
  const settled = await Promise.allSettled(events.map(async event => {
    const start = performance.now();
    try { return await aggregateScanKnowledge(event); }
    finally { timings.push(performance.now() - start); }
  }));
  timings.sort((a, b) => a - b);
  const memory = process.memoryUsage();
  const metrics = { scenario, events: events.length, maxAttemptsAllowed: maxAttempts,
    ...harness.stats, fulfilled: settled.filter(row => row.status === 'fulfilled').length,
    rejected: settled.filter(row => row.status === 'rejected').length,
    medianLocalMs: +timings[Math.floor(timings.length / 2)].toFixed(3),
    p95LocalMs: +timings[Math.ceil(timings.length * 0.95) - 1].toFixed(3),
    elapsedLocalMs: +(performance.now() - started).toFixed(3),
    rssBytesAfterBatch: memory.rss, heapUsedBytesAfterBatch: memory.heapUsed,
    uniqueContributors: harness.count(`${summaryPath}/contributors/`),
    totalVotes: harness.read(summaryPath)?.total ?? 0 };
  console.log(`KNOWLEDGE_CONCURRENCY_SIMULATION ${JSON.stringify(metrics)}`);
  return { settled, metrics };
}

describe('actual Knowledge handler — synthetic hot-document contention, not Cloud performance', () => {
  it('uses SDK mocks with an active network guard and unchanged actual trigger registration', () => {
    expect(globalThis[Symbol.for('domidex.sharing-scale-network-guard')]).toEqual({ attempts: [], active: true });
    expect(initializeApp).toHaveBeenCalledExactlyOnceWith();
    expect(onDocumentWritten).toHaveBeenCalledExactlyOnceWith({
      document: 'users/{uid}/scanEvidence/{fingerprint}', region: 'europe-west1', maxInstances: 10,
    }, aggregateScanKnowledge);
  });

  for (const size of [10, 40, 80]) {
    it(`${size} unique contributors are counted exactly once despite deterministic conflicts`, async () => {
      const events = Array.from({ length: size }, (_, i) => makeEvent(`synthetic-unique-${i}`));
      const { metrics } = await runBatch('unique-same-fingerprint', events, 81);
      expect(metrics.rejected).toBe(0);
      expect(metrics.uniqueContributors).toBe(size);
      expect(metrics.totalVotes).toBe(size);
      expect(metrics.committedWrites).toBe(3 * size);
      expect(metrics.attempts).toBe(size * (size + 1) / 2);
      expect(metrics.logicalReads).toBe(4 * metrics.attempts);
      expect(metrics.logicalQueries).toBe(0);
      expect(publicKnowledge()).toMatchObject({ cardId: 'sv3-215', status: 'STABLE', confirmations: size, confidence: 100 });
    });

    it(`${size} simultaneous redeliveries keep one contributor and never become STABLE`, async () => {
      const event = makeEvent('synthetic-duplicate');
      const { metrics } = await runBatch('same-event-redelivery', Array(size).fill(event), 81);
      expect(metrics.rejected).toBe(0);
      expect(metrics.totalVotes).toBe(1);
      expect(metrics.uniqueContributors).toBe(1);
      expect(metrics.committedWrites).toBe(3);
      expect(metrics.attempts).toBe(2 * size - 1);
      expect(metrics.logicalReads).toBe(4 * metrics.attempts);
      expect(publicKnowledge()).toMatchObject({ status: 'CANDIDATE', confirmations: 1 });
    });

    it(`${size} balanced conflicting contributors remain DISPUTED without lost votes`, async () => {
      const events = Array.from({ length: size }, (_, i) => makeEvent(`synthetic-mixed-${i}`,
        { cardId: i % 2 ? 'sv3-214' : 'sv3-215', corrected: true }));
      const { metrics } = await runBatch('balanced-conflicting-identities', events, 81);
      expect(metrics.rejected).toBe(0);
      expect(harness.read(summaryPath)).toMatchObject({ total: size,
        votes: { 'sv3-214': size / 2, 'sv3-215': size / 2 } });
      expect(publicKnowledge()).toMatchObject({ status: 'DISPUTED', confirmations: size / 2,
        corrections: size / 2, manualCorrections: size / 2, confidence: 50 });
      expect(metrics.committedWrites).toBe(3 * size);
    });

    it(`${size} events under an adversarial five-attempt cap show explicit exhaustion, not data loss disguised as success`, async () => {
      harness = createTransactionDouble({ maxAttempts: 5 });
      const events = Array.from({ length: size }, (_, i) => makeEvent(`synthetic-capped-${i}`));
      const { settled, metrics } = await runBatch('adversarial-five-attempt-cap', events, 5);
      expect(metrics.fulfilled).toBe(5);
      expect(metrics.rejected).toBe(size - 5);
      expect(metrics.exhausted).toBe(size - 5);
      expect(metrics.totalVotes).toBe(5);
      expect(metrics.uniqueContributors).toBe(5);
      expect(metrics.committedWrites).toBe(15);
      expect(metrics.attempts).toBe(size * 5 - 10);
      expect(settled.filter(row => row.status === 'rejected').every(row =>
        row.reason.message === 'SIMULATED_TRANSACTION_RETRY_EXHAUSTED')).toBe(true);
    });
  }

  it('80 reordered versions of one evidence document aggregate only its current revision', async () => {
    const events = Array.from({ length: 80 }, (_, i) => makeEvent('synthetic-reordered',
      { cardId: i === 79 ? 'sv3-214' : 'sv3-215', time: i + 1 }));
    // Reverse order deliberately, without random scheduling or timestamps.
    const { metrics } = await runBatch('reordered-same-contributor', events.reverse(), 81);
    expect(metrics.rejected).toBe(0);
    expect(metrics.logicalReads).toBe(79 * 2 + 4);
    expect(metrics.committedWrites).toBe(3);
    expect(publicKnowledge()).toMatchObject({ cardId: 'sv3-214', confirmations: 1, status: 'CANDIDATE' });
  });

  it('repeated newer identical evidence is idempotent in votes, but currently amplifies writes', async () => {
    const start = performance.now();
    for (let i = 1; i <= 80; i++) await aggregateScanKnowledge(makeEvent('synthetic-repeated', { time: i }));
    expect(harness.read(summaryPath).total).toBe(1);
    expect(publicKnowledge()).toMatchObject({ confirmations: 1, status: 'CANDIDATE' });
    expect(harness.stats).toMatchObject({ logicalReads: 320, committedWrites: 240, attempts: 80, conflicts: 0 });
    console.log(`KNOWLEDGE_CONCURRENCY_SIMULATION ${JSON.stringify({ scenario: 'sequential-newer-identical-evidence',
      events: 80, ...harness.stats, elapsedLocalMs: +(performance.now() - start).toFixed(3),
      uniqueContributors: 1, totalVotes: 1 })}`);
  });

  it.each(['delete', 'replace', 'deletion-lock'])('a %s during the transaction forces revalidation and no stale aggregate commit', async mutation => {
    let changed = false;
    harness = createTransactionDouble({ beforeCommit: ({ put }) => {
      if (changed) return;
      changed = true;
      if (mutation === 'delete') put(evidencePath('synthetic-race'), undefined);
      if (mutation === 'replace') put(evidencePath('synthetic-race'), { fingerprint, confirmedCardId: 'sv3-214' });
      if (mutation === 'deletion-lock') put(lockPath('synthetic-race'), { phase: 'inventory' });
    } });
    await aggregateScanKnowledge(makeEvent('synthetic-race'));
    expect(harness.stats).toMatchObject({ attempts: 2, logicalReads: 6, attemptedWrites: 3,
      committedWrites: 0, conflicts: 1, retries: 1 });
    expect(harness.read(summaryPath)).toBeUndefined();
    expect(publicKnowledge()).toBeUndefined();
    expect(harness.read(contributorPath('synthetic-race'))).toBeUndefined();
  });

  it('a server-newer correction with an equal/older client clock is currently ignored until the clock advances', async () => {
    await aggregateScanKnowledge(makeEvent('synthetic-clock', { time: 1000 }));
    const original = harness.read(publicPath);
    for (const time of [1000, 999]) {
      await aggregateScanKnowledge(makeEvent('synthetic-clock', { time, cardId: 'sv3-214', corrected: true }));
      expect(harness.read(publicPath)).toEqual(original);
    }
    expect(harness.stats.committedWrites).toBe(3);
    await aggregateScanKnowledge(makeEvent('synthetic-clock', { time: 1001, cardId: 'sv3-214', corrected: true }));
    expect(harness.read(summaryPath)).toMatchObject({ total: 1, votes: { 'sv3-215': 0, 'sv3-214': 1 } });
    expect(publicKnowledge()).toMatchObject({ cardId: 'sv3-214', confirmations: 1 });
  });

  it('32 historical identities retain zero-count keys; identity 33 fails atomically without partial contributor/public writes', async () => {
    for (let i = 1; i <= 32; i++) {
      await aggregateScanKnowledge(makeEvent('synthetic-cap', { time: i, cardId: `synthetic-card-${i}` }));
    }
    expect(Object.keys(harness.read(summaryPath).votes)).toHaveLength(32);
    expect(harness.read(summaryPath).total).toBe(1);
    const before = [summaryPath, contributorPath('synthetic-cap'), publicPath].map(key => harness.read(key));
    await expect(aggregateScanKnowledge(makeEvent('synthetic-cap', { time: 33, cardId: 'synthetic-card-33' })))
      .rejects.toThrow('too-many-identities-for-fingerprint');
    expect([summaryPath, contributorPath('synthetic-cap'), publicPath].map(key => harness.read(key))).toEqual(before);
    expect(harness.stats).toMatchObject({ committedWrites: 96, callbackFailures: 1 });
  });

  it('handles inherited-name keys as own counters without changing Object.prototype', () => {
    const constructor = aggregateVote({}, null, { cardId: 'constructor', corrected: true });
    expect(constructor.privateSummary.votes.constructor).toBe(1);
    expect(constructor.privateSummary.total).toBe(1);
    expect(constructor.publicKnowledge.confirmations).toBe(1);
    expect(() => aggregateVote({}, null, { cardId: '__proto__', corrected: true, cardNumber: '215' }))
      .toThrow('unsupported-knowledge-key');
    expect(Object.hasOwn(Object.prototype, 'cardNumber')).toBe(false);
  });

  it.each(['constructor', 'toString'])('actual handler persists own numeric %s counters with the unchanged 4-read/3-write contract', async cardId => {
    await aggregateScanKnowledge(makeEvent('synthetic-own-key', { cardId, corrected: true }));
    expect(harness.stats).toMatchObject({ logicalReads: 4, committedWrites: 3, attemptedWrites: 3 });
    expect(harness.read(summaryPath).votes[cardId]).toBe(1);
    expect(publicKnowledge()).toMatchObject({ cardId, confirmations: 1, manualCorrections: 1 });
  });

  it.each(['evidence', 'previous-contributor', 'votes', 'correctionVotes', 'identities'])(
    'actual handler rejects reserved key in %s without any of its three writes', async source => {
      const event = makeEvent('synthetic-reserved', { cardId: source === 'evidence' ? '__proto__' : 'sv3-215', time: 2 });
      if (source === 'previous-contributor') harness.put(contributorPath('synthetic-reserved'),
        { cardId: '__proto__', observedAtClient: 1 });
      if (['votes', 'correctionVotes', 'identities'].includes(source)) harness.put(summaryPath,
        { [source]: Object.fromEntries([['__proto__', source === 'identities' ? { cardNumber: '1' } : 1]]) });
      const before = harness.snapshot();
      await expect(aggregateScanKnowledge(event)).rejects.toThrow('unsupported-knowledge-key');
      expect(harness.stats).toMatchObject({ logicalReads: 4, attemptedWrites: 0, committedWrites: 0 });
      expect(harness.snapshot()).toEqual(before);
      expect(publicKnowledge()).toBeUndefined();
    },
  );

  it('actual handler fails closed on malformed legacy counters before any contributor, summary or public write', async () => {
    const event = makeEvent('synthetic-corrupt');
    harness.put(summaryPath, { votes: { constructor: 'function Object() { [native code] }1' } });
    const before = harness.snapshot();
    await expect(aggregateScanKnowledge(event)).rejects.toThrow('invalid-knowledge-counter');
    expect(harness.stats).toMatchObject({ logicalReads: 4, attemptedWrites: 0, committedWrites: 0 });
    expect(harness.snapshot()).toEqual(before);
  });
});
