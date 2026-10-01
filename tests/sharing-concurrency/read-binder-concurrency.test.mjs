import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// This invokes real readBinderShare + its public cache, NOT context.cardFor.
// Firestore/Auth and fetch are deterministic doubles. No cloud latency, billing,
// real users, HTTP/socket load, production memory bound or live price coverage.
const repetitions = Number(process.env.DOMIDEX_SHARING_CONCURRENCY_REPETITIONS ?? 3);
const fetchGuard = globalThis.fetch;
const numberAt = (index) => String(index).padStart(5, '0');
const cardAt = (index) => `loadtest-${numberAt(index)}`;
const token = 'T'.repeat(43);
const sharePath = `privateBinderShares/${createHash('sha256').update(token).digest('hex')}`;
const counters = () => ({ singleDocumentGets: 0, placementQueries: 0, queryDocuments: 0,
  getAllCalls: 0, getAllDocuments: 0, authGetUserCalls: 0 });
const memory = () => {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapUsed, external, arrayBuffers };
};
const delta = (after, before) => Object.fromEntries(Object.keys(before).map((key) => [key, after[key] - before[key]]));
let getApps;
beforeAll(async () => {
  expect(globalThis[Symbol.for('domidex.sharing-scale-network-guard')]?.active).toBe(true);
  expect(Object.keys(process.env).filter((key) => /^(FIREBASE|NEXT_PUBLIC_FIREBASE|GOOGLE_APPLICATION_CREDENTIALS|GCLOUD|GOOGLE_CLOUD|NODE_OPTIONS)/.test(key))).toEqual([]);
  expect(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 3).toBe(true);
  ({ getApps } = await import('firebase-admin/app'));
  expect(getApps()).toEqual([]);
});
afterEach(() => { globalThis.fetch = fetchGuard; });
afterAll(() => { expect(getApps()).toEqual([]); });

function fixture({ count, showTotal = false, owner = 'synthetic-owner-a', showPrices = true } = {}) {
  const binder = 'synthetic-binder', binderPath = `users/${owner}/privateBinders/${binder}`;
  const documents = new Map([
    [sharePath, Object.freeze({ ownerUid: owner, binderId: binder, revokedAt: null, showPrices, showTotal })],
    [binderPath, Object.freeze({ ownerUid: owner, binderId: binder, name: 'Synthetic binder', coverStyle: 'galaxy' })],
    [`accountAccess/${owner}`, Object.freeze({ appAccess: true })],
  ]);
  const rows = Array.from({ length: count }, (_, index) => {
    const id = numberAt(index);
    documents.set(`users/${owner}/collectionEntries/entry-${id}`, Object.freeze({
      ownerUid: owner, sourceCardId: cardAt(index), sourceSetId: 'loadtest', setId: 'loadtest',
      collectorNumber: id, finish: 'Normal', variant: 'Standard', externalProductId: 100_000 + index,
      quantity: 3, deleted: false, notes: 'PRIVATE_NOTE', acquisitionPriceMinor: 999_999,
    }));
    return Object.freeze({ id: `placement-${id}`, data: Object.freeze({ ownerUid: owner, binderId: binder,
      entrySyncId: `entry-${id}`, slotPosition: index, deleted: false, holoEffectId: 'galaxy', holoIntensity: .7 }) });
  });
  const stats = counters();
  const snapshot = (path) => {
    const data = documents.get(path);
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => data };
  };
  const context = { sharingEnabled: true,
    auth: { getUser: async (uid) => {
      expect(uid).toBe(owner); stats.authGetUserCalls++;
      return { disabled: false, customClaims: { appAccess: true } };
    } },
    db: {
      doc: (path) => ({ path, get: async () => {
        expect([sharePath, binderPath, `accountAccess/${owner}`, `accountDeletionLocks/${owner}`]).toContain(path);
        stats.singleDocumentGets++; return snapshot(path);
      } }),
      collection: (path) => {
        expect(path).toBe(`users/${owner}/privateBinderPlacements`);
        return { where: (field, operator, value) => {
          expect([field, operator, value]).toEqual(['binderId', '==', binder]);
          return { limit: (limit) => {
            expect(limit).toBe(5_001);
            return { get: async () => {
              stats.placementQueries++; const selected = rows.slice(0, limit); stats.queryDocuments += selected.length;
              return { size: selected.length, docs: selected.map((row) => ({ id: row.id, data: () => row.data })) };
            } };
          } };
        } };
      },
      getAll: async (...refs) => {
        expect(refs.length > 0 && refs.length <= 100).toBe(true);
        expect(refs.every(({ path }) => path.startsWith(`users/${owner}/collectionEntries/entry-`) && documents.has(path))).toBe(true);
        stats.getAllCalls++; stats.getAllDocuments += refs.length;
        return refs.map(({ path }) => snapshot(path));
      },
    },
  };
  return { count, showPrices, showTotal, context, stats,
    revoke: () => documents.set(sharePath, Object.freeze({ ...documents.get(sharePath), revokedAt: 1 })),
    dataHash: () => createHash('sha256').update(JSON.stringify([...documents]) + JSON.stringify(rows)).digest('hex'),
  };
}

function provider({ onFirst = () => {} } = {}) {
  const stats = { calls: 0, inFlight: 0, maxInFlight: 0, aborted: 0, unexpected: 0 };
  globalThis.fetch = async (url, options) => {
    const match = typeof url === 'string' ? /^https:\/\/api\.tcgdex\.net\/v2\/de\/cards\/loadtest-(\d{5})$/.exec(url) : null;
    if (!match || options?.headers?.Accept !== 'application/json' || !(options.signal instanceof AbortSignal)) {
      stats.unexpected++; throw Error('UNEXPECTED_SYNTHETIC_PROVIDER_CALL');
    }
    stats.calls++; stats.inFlight++; stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    if (stats.calls === 1) onFirst();
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { options.signal.removeEventListener('abort', abort); resolve(); }, 2);
        const abort = () => { clearTimeout(timer); options.signal.removeEventListener('abort', abort); stats.aborted++; reject(Error('SYNTHETIC_ABORT')); };
        options.signal.addEventListener('abort', abort, { once: true });
        if (options.signal.aborted) abort();
      });
      const index = Number(match[1]);
      return Response.json({ id: cardAt(index), localId: match[1], name: `Synthetic card ${match[1]}`,
        set: { id: 'loadtest', name: 'Synthetic set' }, image: `https://assets.tcgdex.net/de/synthetic/loadtest/${match[1]}`,
        variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: {
          idProduct: 100_000 + index, trend: 2.5, unit: 'EUR', updated: '2026-10-01T00:00:00Z',
        } } }] });
    } finally { stats.inFlight--; }
  };
  return stats;
}

async function freshHandler() {
  vi.resetModules();
  const { readBinderShare } = await import('../../backend/security/sharing.mjs');
  const { getApps: currentApps } = await import('firebase-admin/app');
  expect(currentApps()).toEqual([]);
  return readBinderShare;
}

async function runBatch({ handler, data, providerStats, concurrency, pages, label, repeat, expectStatus = 200 }) {
  const beforeCounts = { ...data.stats }, beforeFetch = providerStats.calls;
  providerStats.maxInFlight = 0;
  const beforeMemory = memory(), sampledPeak = { ...beforeMemory };
  let memorySamples = 0;
  const sample = () => {
    memorySamples++; const current = memory();
    for (const key of Object.keys(sampledPeak)) sampledPeak[key] = Math.max(sampledPeak[key], current[key]);
  };
  const sampler = setInterval(sample, 5), start = performance.now();
  let results;
  try {
    results = await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
      const page = pages[index], begin = performance.now();
      const response = await handler(new Request(`https://synthetic.invalid/api/shared-binders/${token}?page=${page}`),
        { params: Promise.resolve({ token }) }, data.context);
      const text = await response.text();
      return { status: response.status, noStore: response.headers.get('cache-control')?.includes('no-store'),
        page, text, elapsedMs: performance.now() - begin, jsonBytes: Buffer.byteLength(text, 'utf8') };
    }));
  } finally { sample(); clearInterval(sampler); }
  const wallMs = performance.now() - start, afterMemory = memory();
  const requests = delta(data.stats, beforeCounts), sortedTimes = results.map((result) => result.elapsedMs).sort((a, b) => a - b);
  const stats = { label, repeat, concurrency, count: data.count, showPrices: data.showPrices, showTotal: data.showTotal,
    ...requests, logicalDocumentReads: requests.singleDocumentGets + requests.queryDocuments + requests.getAllDocuments,
    providerCalls: providerStats.calls - beforeFetch, providerMaxInFlight: providerStats.maxInFlight,
    jsonBytesTotal: results.reduce((total, result) => total + result.jsonBytes, 0),
    jsonBytesMax: Math.max(...results.map((result) => result.jsonBytes)), wallMs,
    latencyMs: { min: sortedTimes[0], p50: sortedTimes[Math.ceil(concurrency * .5) - 1],
      p95: sortedTimes[Math.ceil(concurrency * .95) - 1], max: sortedTimes.at(-1) },
    memoryBytes: { before: beforeMemory, after: afterMemory, delta: delta(afterMemory, beforeMemory), sampledPeak, memorySamples },
    scope: 'SYNTHETIC LOCAL: in-process doubles + assertions + fake provider 2ms scheduling + JSON; not cloud/users/billing; memory includes fixtures/cache/GC; sampled peak is not exact' };
  console.info(`SHARING_CONCURRENCY_SIMULATION ${JSON.stringify(stats)}`);
  expect(providerStats.unexpected).toBe(0); expect(providerStats.aborted).toBe(0); expect(providerStats.inFlight).toBe(0);
  for (const result of results) {
    expect(result.status).toBe(expectStatus); expect(result.noStore).toBe(true);
    const body = JSON.parse(result.text);
    expect(result.jsonBytes).toBeLessThan(128 * 1024);
    expect(result.text).not.toMatch(/synthetic-owner|PRIVATE_NOTE|acquisitionPriceMinor|ownerUid|entry-/);
    if (expectStatus !== 200) { expect(body).toEqual({ ok: false, error: 'NOT_FOUND' }); continue; }
    expect(body).toMatchObject({ page: result.page, pageCount: Math.ceil(data.count / 9), unavailableSlots: [] });
    const slots = Array.from({ length: Math.min(9, data.count - result.page * 9) }, (_, offset) => result.page * 9 + offset);
    expect(body.cards.map(({ slot, cardId }) => [slot, cardId])).toEqual(slots.map((slot) => [slot, cardAt(slot)]));
    for (const card of body.cards) {
      if (data.showPrices) expect(card.price).toMatchObject({ amount: 2.5, currency: 'EUR' });
      else expect(card).not.toHaveProperty('price');
    }
    if (data.showTotal) expect(body.total).toEqual({ amount: data.count * 2.5, currency: 'EUR', complete: true,
      pricedCards: data.count, visibleCards: data.count });
    else expect(body).not.toHaveProperty('total');
  }
  return stats;
}

describe('actual readBinderShare local concurrent-request simulation', () => {
  for (const concurrency of [10, 40, 80]) for (const scenario of ['same-page', 'disjoint-pages', 'opt-in-total']) {
    it(`${scenario}: ${concurrency} simultaneous requests, fresh cold/warm cycles`, async () => {
      const count = scenario === 'same-page' ? 5_000 : scenario === 'disjoint-pages' ? 1_000 : 200;
      const showTotal = scenario === 'opt-in-total';
      const pages = Array.from({ length: concurrency }, (_, index) => scenario === 'disjoint-pages' ? index : 0);
      for (let repeat = 1; repeat <= repetitions; repeat++) {
        const handler = await freshHandler(), data = fixture({ count, showTotal }), before = data.dataHash();
        const providerStats = provider(), results = [];
        for (const state of ['cold', 'warm']) results.push(await runBatch({ handler, data, providerStats, concurrency, pages,
          label: `${scenario}-${state}`, repeat }));
        const needed = showTotal ? count : 9;
        for (const result of results) expect(result).toMatchObject({ singleDocumentGets: concurrency * 8,
          placementQueries: concurrency, queryDocuments: concurrency * count, getAllCalls: concurrency * Math.ceil(needed / 100),
          getAllDocuments: concurrency * needed, authGetUserCalls: concurrency * 2,
          logicalDocumentReads: concurrency * (count + needed + 8) });
        const distinct = showTotal ? count : scenario === 'disjoint-pages' ? concurrency * 9 : 9;
        expect(results[0].providerCalls).toBe(distinct);
        if (scenario !== 'disjoint-pages') expect(results[1].providerCalls).toBe(0);
        else {
          // With 64 tracked jobs, overflow may complete uncached. Warm is honestly measured,
          // not assumed zero. Each distinct card is requested once in this scenario.
          expect(results[1].providerCalls).toBeLessThanOrEqual(distinct);
          if (concurrency === 80) expect(results[0].providerMaxInFlight).toBeGreaterThan(64);
        }
        expect(data.dataHash()).toBe(before);
      }
    });
  }

  it('all ten in-flight readers see revocation after catalog work without partial data', async () => {
    const handler = await freshHandler(), data = fixture({ count: 200, showTotal: true });
    const providerStats = provider({ onFirst: data.revoke });
    const result = await runBatch({ handler, data, providerStats, concurrency: 10, pages: Array(10).fill(0),
      label: 'revoked-during-catalog', repeat: 1, expectStatus: 404 });
    expect(result.providerCalls).toBe(200);
    expect(result.authGetUserCalls).toBe(10);
    expect(result.singleDocumentGets).toBe(50);
  });

  it('two owner groups partition raw/prices work and retain separate private options cold and warm', async () => {
    const handler = await freshHandler(), providerStats = provider();
    const a = fixture({ count: 20, owner: 'synthetic-owner-a', showPrices: true });
    const b = fixture({ count: 20, owner: 'synthetic-owner-b', showPrices: false });
    // Both owners race in each ten-request batch. Public raw/prices modes deliberately
    // have distinct keys: unresolved raw data must never substitute for resolved prices.
    for (const [cycle, expectedNewFetches] of [18, 0].entries()) {
      const beforeFetch = providerStats.calls;
      const results = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
        const data = index % 2 ? b : a;
        const response = await handler(new Request(`https://synthetic.invalid/api/shared-binders/${token}?page=0`),
          { params: Promise.resolve({ token }) }, data.context);
        return { index, status: response.status, body: await response.json() };
      }));
      for (const { index, status, body } of results) {
        expect(status).toBe(200); expect(body.cards).toHaveLength(9);
        for (const card of body.cards) if (index % 2) expect(card).not.toHaveProperty('price');
        else expect(card.price.amount).toBe(2.5);
        expect(body).not.toHaveProperty('total');
        expect(JSON.stringify(body)).not.toMatch(/synthetic-owner|PRIVATE_NOTE|ownerUid/);
      }
      expect(providerStats.calls - beforeFetch).toBe(expectedNewFetches);
      expect(providerStats).toMatchObject({ calls: 18, inFlight: 0, unexpected: 0, aborted: 0 });
      // A warm public hit never removes either owner's private reads/auth checks.
      for (const data of [a, b]) expect(data.stats).toMatchObject({ authGetUserCalls: 10 * (cycle + 1),
        singleDocumentGets: 40 * (cycle + 1), placementQueries: 5 * (cycle + 1),
        queryDocuments: 100 * (cycle + 1), getAllDocuments: 45 * (cycle + 1) });
    }
  });

  it('two owners with the same public resolver mode still coalesce nine cold and zero warm fetches', async () => {
    const handler = await freshHandler(), providerStats = provider();
    const a = fixture({ count: 20, owner: 'synthetic-owner-a', showPrices: true });
    const b = fixture({ count: 20, owner: 'synthetic-owner-b', showPrices: true });
    for (const [cycle, expectedNewFetches] of [9, 0].entries()) {
      const beforeFetch = providerStats.calls;
      const results = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
        const data = index % 2 ? b : a;
        const response = await handler(new Request(`https://synthetic.invalid/api/shared-binders/${token}?page=0`),
          { params: Promise.resolve({ token }) }, data.context);
        return { status: response.status, body: await response.json() };
      }));
      for (const { status, body } of results) {
        expect(status).toBe(200); expect(body.cards).toHaveLength(9);
        for (const card of body.cards) expect(card.price).toMatchObject({ amount: 2.5, currency: 'EUR', source: 'Cardmarket' });
        expect(body).not.toHaveProperty('total');
        expect(JSON.stringify(body)).not.toMatch(/synthetic-owner|PRIVATE_NOTE|ownerUid/);
      }
      expect(providerStats.calls - beforeFetch).toBe(expectedNewFetches);
      expect(providerStats).toMatchObject({ calls: 9, inFlight: 0, unexpected: 0, aborted: 0 });
      for (const data of [a, b]) expect(data.stats).toMatchObject({ authGetUserCalls: 10 * (cycle + 1),
        singleDocumentGets: 40 * (cycle + 1), placementQueries: 5 * (cycle + 1),
        queryDocuments: 100 * (cycle + 1), getAllDocuments: 45 * (cycle + 1) });
    }
  });
});
