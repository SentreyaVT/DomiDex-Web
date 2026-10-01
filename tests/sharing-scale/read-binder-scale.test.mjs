import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Actual production readBinderShare; only Firestore/Auth/catalog I/O is doubled.
// Numbers are logical double calls and in-process simulation time, NOT Firebase
// billing, cloud latency, a load test, real catalog coverage or signed-v26 E2E.
const enabled = process.env.DOMIDEX_SHARING_SCALE_ISOLATED === '1';
const suite = enabled ? describe : describe.skip;
const OWNER = 'synthetic-private-owner', BINDER = 'synthetic-binder';
const TOKEN = 'S'.repeat(43), COUNT = 5_000, PAGE_COUNT = 556, LAST_PAGE = 555;
const SHARE_PATH = `privateBinderShares/${createHash('sha256').update(TOKEN).digest('hex')}`;
const BINDER_PATH = `users/${OWNER}/privateBinders/${BINDER}`;
const PLACEMENT_PATH = `users/${OWNER}/privateBinderPlacements`;
const ENTRY_PATH = `users/${OWNER}/collectionEntries`;
const idAt = (index) => String(index).padStart(5, '0');
const cardAt = (index) => `scale-${idAt(index)}`;
const repetitions = Number(process.env.DOMIDEX_SHARING_SCALE_REPETITIONS ?? 3);
let readBinderShare, getApps;
const metrics = () => ({ singleDocumentGets: 0, singleExistingDocuments: 0, singleMissingDocuments: 0,
  placementQueries: 0, queryDocuments: 0, getAllCalls: 0, getAllDocuments: 0,
  authGetUserCalls: 0, catalogCalls: 0, maxConcurrentCatalog: 0 });

function fixture({ count = COUNT, showPrices = false, showTotal = false, reverse = false } = {}) {
  const documents = new Map([
    [SHARE_PATH, Object.freeze({ ownerUid: OWNER, binderId: BINDER, revokedAt: null, showPrices, showTotal })],
    [BINDER_PATH, Object.freeze({ ownerUid: OWNER, binderId: BINDER, name: 'Synthetic scale binder', coverStyle: 'galaxy', minimumPageCount: 1, deleted: false })],
    [`accountAccess/${OWNER}`, Object.freeze({ appAccess: true })],
  ]);
  // 4,995 reserved slots fill 555 pages; five extra placements collide at slot 0.
  // Their stable IDs must occupy 4995..4999, creating a real overflow page 556.
  const rows = Array.from({ length: count }, (_, index) => {
    const id = idAt(index);
    documents.set(`${ENTRY_PATH}/entry-${id}`, Object.freeze({
      ownerUid: OWNER, sourceCardId: cardAt(index), sourceSetId: 'scale', setId: 'scale',
      collectorNumber: id, finish: 'Normal', variant: 'Standard', externalProductId: 100_000 + index,
      quantity: 2 + index % 5, deleted: false, name: 'PRIVATE_ENTRY_NAME', notes: 'PRIVATE_NOTES',
      acquisitionPriceMinor: 999_999, imageUrl: 'https://private.invalid/never-fetch',
    }));
    return { id: `placement-${id}`, data: Object.freeze({ ownerUid: OWNER, binderId: BINDER,
      entrySyncId: `entry-${id}`, slotPosition: index >= 4_995 ? 0 : index,
      holoEffectId: 'galaxy', holoIntensity: .7, deleted: false }) };
  });
  if (reverse) rows.reverse();
  let counters = metrics(), concurrent = 0, revokeAtCatalog = false;
  const dataHash = () => createHash('sha256').update(JSON.stringify([...documents]) + JSON.stringify(rows)).digest('hex');
  const snapshot = (path) => {
    const data = documents.get(path); // Snapshot remains immutable if source is later replaced.
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => data };
  };
  const context = {
    sharingEnabled: true,
    auth: { getUser: async (uid) => {
      expect(uid).toBe(OWNER); counters.authGetUserCalls++;
      return { disabled: false, customClaims: { appAccess: true } };
    } },
    db: {
      doc: (path) => ({ path, get: async () => {
        expect([SHARE_PATH, BINDER_PATH, `accountAccess/${OWNER}`, `accountDeletionLocks/${OWNER}`]).toContain(path);
        counters.singleDocumentGets++;
        const result = snapshot(path);
        counters[result.exists ? 'singleExistingDocuments' : 'singleMissingDocuments']++;
        return result;
      } }),
      collection: (path) => {
        expect(path).toBe(PLACEMENT_PATH);
        return { where: (field, operator, value) => {
          expect([field, operator, value]).toEqual(['binderId', '==', BINDER]);
          return { limit: (limit) => {
            expect(limit).toBe(5_001);
            return { get: async () => {
              counters.placementQueries++;
              const selected = rows.slice(0, limit);
              counters.queryDocuments += selected.length;
              return { size: selected.length, docs: selected.map((row) => ({ id: row.id, data: () => row.data })) };
            } };
          } };
        } };
      },
      getAll: async (...refs) => {
        expect(refs.length).toBeGreaterThan(0); expect(refs.length).toBeLessThanOrEqual(100);
        expect(refs.every(({ path }) => path.startsWith(`${ENTRY_PATH}/entry-`) && documents.has(path))).toBe(true);
        counters.getAllCalls++; counters.getAllDocuments += refs.length;
        return refs.map(({ path }) => snapshot(path));
      },
    },
    cardFor: async (id) => {
      expect(id).toMatch(/^scale-\d{5}$/);
      counters.catalogCalls++; concurrent++;
      counters.maxConcurrentCatalog = Math.max(counters.maxConcurrentCatalog, concurrent);
      if (revokeAtCatalog) {
        revokeAtCatalog = false;
        documents.set(SHARE_PATH, Object.freeze({ ...documents.get(SHARE_PATH), revokedAt: 1 }));
      }
      try {
        await Promise.resolve(); // Observe the production six-worker fan-out, without artificial latency.
        const number = id.slice(6), index = Number(number);
        expect(index).toBeLessThan(count);
        return { id, localId: number, name: `Synthetic card ${number}`, set: { id: 'scale', name: 'Synthetic set' },
          image: `https://assets.tcgdex.net/de/synthetic/scale/${number}`,
          variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: {
            cardmarket: { idProduct: 100_000 + index, trend: 2.5, unit: 'EUR', updated: '2026-10-01T00:00:00Z' },
          } }] };
      } finally { concurrent--; }
    },
  };
  return {
    dataHash,
    revokeDuringNextCatalog: () => { revokeAtCatalog = true; },
    read: async (page) => {
      counters = metrics();
      const start = performance.now();
      const response = await readBinderShare(new Request(`https://synthetic.invalid/api/shared-binders/${TOKEN}?page=${page}`),
        { params: Promise.resolve({ token: TOKEN }) }, context);
      const text = await response.text();
      return { response, text, body: JSON.parse(text), stats: { ...counters,
        logicalDocumentReads: counters.singleDocumentGets + counters.queryDocuments + counters.getAllDocuments,
        jsonBytes: Buffer.byteLength(text, 'utf8'), elapsedMs: performance.now() - start } };
    },
  };
}

function assertPage(result, page, { showPrices = false, showTotal = false } = {}) {
  const { response, body, text } = result;
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(body).toMatchObject({ page, pageCount: PAGE_COUNT, unavailableSlots: [] });
  const slots = Array.from({ length: page === LAST_PAGE ? 5 : 9 }, (_, offset) => page * 9 + offset);
  expect(body.cards.map(({ slot, cardId }) => [slot, cardId])).toEqual(slots.map((slot) => [slot, cardAt(slot)]));
  for (const card of body.cards) {
    expect(card).toMatchObject({ holoEffectId: 'galaxy', holoIntensity: .7 });
    if (showPrices) expect(card.price).toMatchObject({ amount: 2.5, currency: 'EUR', source: 'Cardmarket' });
    else expect(card).not.toHaveProperty('price');
  }
  if (showTotal) expect(body.total).toEqual({ amount: 12_500, currency: 'EUR', complete: true, pricedCards: COUNT, visibleCards: COUNT });
  else expect(body).not.toHaveProperty('total');
  expect(text).not.toMatch(/synthetic-private-owner|entry-|PRIVATE_|private\.invalid|acquisitionPriceMinor|ownerUid|displayName/);
  expect(result.stats.jsonBytes).toBeLessThan(128 * 1024); // Existing Android response envelope, not a speed SLA.
}

function assertCounts(stats, page, showTotal) {
  const needed = showTotal ? COUNT : page === LAST_PAGE ? 5 : 9;
  expect(stats).toMatchObject({ singleDocumentGets: 8, singleExistingDocuments: 6, singleMissingDocuments: 2,
    placementQueries: 1, queryDocuments: COUNT, getAllCalls: Math.ceil(needed / 100), getAllDocuments: needed,
    authGetUserCalls: 2, catalogCalls: needed, maxConcurrentCatalog: Math.min(6, needed), logicalDocumentReads: COUNT + needed + 8 });
}

function report(name, rows) {
  const times = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  console.info(`SHARING_SCALE_SIMULATION ${JSON.stringify({ name, samples: rows.length,
    placementQueries: sum('placementQueries'), queryDocuments: sum('queryDocuments'),
    singleDocumentGets: sum('singleDocumentGets'), getAllCalls: sum('getAllCalls'), getAllDocuments: sum('getAllDocuments'),
    authGetUserCalls: sum('authGetUserCalls'), catalogCalls: sum('catalogCalls'), logicalDocumentReads: sum('logicalDocumentReads'),
    maxConcurrentCatalog: Math.max(...rows.map((row) => row.maxConcurrentCatalog)),
    jsonBytesTotal: sum('jsonBytes'), jsonBytesMax: Math.max(...rows.map((row) => row.jsonBytes)),
    elapsedMs: { total: sum('elapsedMs'), min: times[0], median: times[Math.floor(times.length / 2)], max: times.at(-1) },
    scope: 'local synthetic doubles incl. assertions, microtasks and JSON serialization; not cloud latency, billing or real card coverage' })}`);
}

suite('actual readBinderShare synthetic 5000-placement scale contract', () => {
  beforeAll(async () => {
    expect(globalThis[Symbol.for('domidex.sharing-scale-network-guard')]?.active).toBe(true);
    expect(Object.keys(process.env).filter((key) => /^(FIREBASE|NEXT_PUBLIC_FIREBASE|GOOGLE_APPLICATION_CREDENTIALS|GCLOUD|GOOGLE_CLOUD|NODE_OPTIONS)/.test(key))).toEqual([]);
    expect(repetitions).toBeGreaterThanOrEqual(1); expect(repetitions).toBeLessThanOrEqual(10);
    // Import only after network guards; services() is lazy and every read gets our context.
    ({ readBinderShare } = await import('../../backend/security/sharing.mjs'));
    ({ getApps } = await import('firebase-admin/app'));
    expect(getApps()).toEqual([]);
  });
  afterAll(() => { if (getApps) expect(getApps()).toEqual([]); });

  it('enumerates every card exactly once across all 556 pages, including collision overflow', async () => {
    const data = fixture(), before = data.dataHash(), ids = new Set(), slots = new Set(), stats = [];
    for (let page = 0; page < PAGE_COUNT; page++) {
      const result = await data.read(page);
      assertPage(result, page); assertCounts(result.stats, page, false); stats.push(result.stats);
      result.body.cards.forEach(({ cardId, slot }) => {
        expect(ids.has(cardId)).toBe(false); expect(slots.has(slot)).toBe(false);
        ids.add(cardId); slots.add(slot);
      });
    }
    expect([...ids]).toEqual(Array.from({ length: COUNT }, (_, index) => cardAt(index)));
    expect([...slots]).toEqual(Array.from({ length: COUNT }, (_, index) => index));
    expect(data.dataHash()).toBe(before); // Never rewrite the owner's collision layout.
    report('all-pages-no-price-opt-ins', stats);
  });

  for (const flags of [{ showPrices: false, showTotal: false }, { showPrices: true, showTotal: false },
    { showPrices: false, showTotal: true }, { showPrices: true, showTotal: true }]) {
    it(`measures first/middle/last page with prices=${flags.showPrices}, total=${flags.showTotal}`, async () => {
      const data = fixture(flags), before = data.dataHash(), grouped = new Map();
      for (let repeat = 0; repeat < repetitions; repeat++) for (const page of [0, 277, LAST_PAGE]) {
        const result = await data.read(page);
        assertPage(result, page, flags); assertCounts(result.stats, page, flags.showTotal);
        grouped.set(page, [...(grouped.get(page) ?? []), result.stats]);
      }
      expect(data.dataHash()).toBe(before);
      for (const [page, stats] of grouped) report(`page${page}-prices${flags.showPrices}-total${flags.showTotal}`, stats);
    });
  }

  it('keeps collision ownership/overflow identical under reversed query order', async () => {
    const data = fixture({ reverse: true });
    for (const page of [0, 277, LAST_PAGE]) assertPage(await data.read(page), page);
  });

  it('fails closed if revoked during the 5000-card catalog phase without returning partial data', async () => {
    const data = fixture({ showPrices: true, showTotal: true });
    data.revokeDuringNextCatalog();
    const result = await data.read(277);
    expect(result.response.status).toBe(404);
    expect(result.body).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(result.stats).toMatchObject({ singleDocumentGets: 5, placementQueries: 1, queryDocuments: COUNT,
      getAllCalls: 50, getAllDocuments: COUNT, catalogCalls: COUNT, authGetUserCalls: 1 });
    report('revoked-during-catalog', [result.stats]);
  });

  it('rejects 5001 placements before any collection-entry or catalog read', async () => {
    const data = fixture({ count: 5_001, showPrices: true, showTotal: true });
    const result = await data.read(0);
    expect(result.response.status).toBe(503);
    expect(result.body).toEqual({ ok: false, error: 'SERVER_OPERATION_FAILED' });
    expect(result.stats).toMatchObject({ singleDocumentGets: 4, placementQueries: 1, queryDocuments: 5_001,
      getAllCalls: 0, getAllDocuments: 0, catalogCalls: 0, authGetUserCalls: 1 });
    report('5001-fails-closed', [result.stats]);
  });

  it('rejects a page after the exact 556-page boundary without enriching cards', async () => {
    const result = await fixture().read(PAGE_COUNT);
    expect(result.response.status).toBe(404);
    expect(result.stats).toMatchObject({ placementQueries: 1, queryDocuments: COUNT, getAllCalls: 0, catalogCalls: 0 });
  });
});
