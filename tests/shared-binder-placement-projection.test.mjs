import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { readBinderShare } from '../backend/security/sharing.mjs';

const fields = ['ownerUid', 'entrySyncId', 'slotPosition', 'deleted', 'holoEffectId', 'holoIntensity'];
// Independent transport contract: do not import this allowlist from the handler.
const entryFields = ['ownerUid', 'syncId', 'deleted', 'quantity', 'sourceCardId', 'sourceSetId', 'setId',
  'collectorNumber', 'language', 'finish', 'variant', 'externalProductSource', 'externalProductId'];
const owner = 'projection-owner', binderId = 'projection-binder', token = 'Q'.repeat(43);
const placementsPath = `users/${owner}/privateBinderPlacements`;
const sharePath = `privateBinderShares/${createHash('sha256').update(token).digest('hex')}`;
const binderPath = `users/${owner}/privateBinders/${binderId}`;
const sourceAt = Date.parse('2026-09-24T00:00:00Z');

/** SDK-like immutable query: filters/limit select documents; select only masks their data.
 * fullDocuments is a comparison oracle for the old full-document transport, not a second
 * implementation of the handler. Document IDs, missing fields and row counts stay unchanged. */
function fixture(flags = {}, { fullDocuments = false } = {}) {
  const documents = new Map([
    [sharePath, { ownerUid: owner, binderId, revokedAt: null, displayName: 'Fixture streamer', ...flags }],
    [binderPath, { ownerUid: owner, binderId, name: 'Projection fixture', coverStyle: 'galaxy', minimumPageCount: 1, deleted: false }],
  ]);
  const cards = new Map();
  for (let number = 1; number <= 4; number++) {
    const local = String(number).padStart(3, '0'), syncId = `entry-${number}`;
    const entry = { ownerUid: owner, syncId, sourceCardId: `sv1-${local}`, sourceSetId: 'sv1', setId: 'sv1',
      collectorNumber: local, finish: 'Normal', variant: 'Standard', language: 'DE', quantity: 9, deleted: false,
      externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: 42, notes: 'PRIVATE_ENTRY_NOTE'.repeat(40),
      acquisitionPriceMinor: 999999, acquisitionCurrency: 'EUR', acquisitionDateEpochDay: 20000,
      imageUrl: 'https://private.invalid/PRIVATE_PHOTO.jpg', privatePhotoPayload: 'PRIVATE_PHOTO_PAYLOAD'.repeat(200) };
    documents.set(`users/${owner}/collectionEntries/${syncId}`, entry);
    cards.set(entry.sourceCardId, number === 3 ? null : { id: entry.sourceCardId, localId: local, name: `Public ${local}`,
      set: { id: 'sv1', name: 'Public set' }, image: 'https://assets.tcgdex.net/de/sv/sv1/001',
      variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: {
        idProduct: 42, trend: number === 1 ? 2.5 : null, avg: 12.34, unit: 'EUR', updated: '2026-09-24T00:00:00Z',
      } } }] });
  }
  documents.set(`users/${owner}/collectionEntries/foreign-entry`, { ownerUid: 'someone-else', quantity: 1 });
  documents.set(`users/${owner}/collectionPriceSelections/entry-2`, {
    schemaVersion: 1, ownerUid: owner, entrySyncId: 'entry-2', revision: 1, lastMutationId: 'selected-price',
    updatedAtClient: sourceAt, cleared: false, sourceSetId: 'sv1', sourceCardId: 'sv1-002', collectorNumber: '002',
    language: 'DE', finish: 'Normal', variant: 'Standard', productId: 42, metric: 'normal_avg_sell',
    amountMinor: 1234, currency: 'EUR', sourceAt, selectedAt: sourceAt + 1000,
  });
  const placement = (id, entrySyncId, slotPosition, extra = {}) => ({ id, data: {
    ownerUid: owner, binderId, entrySyncId, slotPosition, deleted: false,
    holoEffectId: 'galaxy', holoIntensity: .7, revision: 17, lastMutationId: `mutation-${id}`,
    createdAtClient: sourceAt, updatedAtClient: sourceAt, updatedAt: { seconds: 123, nanoseconds: 456 },
    unusedPrivateMetadata: 'PRIVATE_PLACEMENT_METADATA'.repeat(12), ...extra,
  } });
  const rows = [
    placement('a-high', 'entry-1', 1000),
    placement('b-high', 'entry-2', 1000), // Global collision must still overflow into slot 0.
    placement('c-unavailable', 'entry-3', 1),
    placement('d-missing-entry', 'missing-entry', 3),
    placement('e-legacy', 'entry-2', 8),
    placement('f-unpriced', 'entry-4', 9),
    placement('g-foreign-entry', 'foreign-entry', 2),
    placement('z-tombstone', '../invalid', 900001, { deleted: true, ownerUid: 'foreign' }),
  ];
  delete rows[4].data.deleted; delete rows[4].data.holoEffectId; delete rows[4].data.holoIntensity;
  const stats = { queries: [], projectedData: [], queryDocuments: 0, singleGets: 0, getAllDocuments: 0, payloadBytes: 0,
    getAllRequests: [], getAllData: [], entryPayloadBytes: 0 };
  const snapshot = (path, mask = null) => {
    const source = documents.get(path);
    const data = source === undefined || mask === null || fullDocuments ? source
      : Object.fromEntries(mask.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]));
    return { id: path.split('/').at(-1), exists: documents.has(path), data: () => structuredClone(data) };
  };
  const query = (state = { filters: [], mask: null, maximum: null }) => ({
    where(field, operator, value) {
      expect([field, operator, value]).toEqual(['binderId', '==', binderId]);
      return query({ ...state, filters: [...state.filters, [field, operator, value]] });
    },
    select(...mask) { return query({ ...state, mask: [...mask] }); },
    limit(maximum) { return query({ ...state, maximum }); },
    async get() {
      stats.queries.push(structuredClone(state));
      const selected = rows.filter(({ data }) => state.filters.every(([field, , value]) => data[field] === value))
        .slice(0, state.maximum ?? rows.length);
      const docs = selected.map(({ id, data }) => {
        const projected = structuredClone(!state.mask || fullDocuments ? data
          : Object.fromEntries(state.mask.filter((field) => Object.hasOwn(data, field)).map((field) => [field, data[field]])));
        stats.projectedData.push({ id, data: projected });
        stats.payloadBytes += Buffer.byteLength(JSON.stringify(projected));
        return { id, data: () => structuredClone(projected) };
      });
      stats.queryDocuments += docs.length;
      return { size: docs.length, docs };
    },
  });
  const context = { sharingEnabled: true,
    auth: { getUser: vi.fn(async () => ({ disabled: false, customClaims: { appAccess: true } })) },
    db: {
      doc: (path) => ({ path, get: async () => { stats.singleGets++; return snapshot(path); } }),
      collection: (path) => { expect(path).toBe(placementsPath); return query(); },
      getAll: vi.fn(async (...args) => {
        // Admin getAll accepts read options after the document references. Options are
        // not a document read; absent documents/fields must not be invented by a mask.
        const options = args.at(-1) && Object.hasOwn(args.at(-1), 'fieldMask') ? args.pop() : null;
        const mask = options?.fieldMask ?? null;
        if (options) {
          expect(Object.keys(options)).toEqual(['fieldMask']);
          expect(Array.isArray(mask)).toBe(true);
          expect(mask.every((field) => typeof field === 'string')).toBe(true);
        }
        for (const ref of args) expect(typeof ref.path).toBe('string');
        stats.getAllDocuments += args.length;
        stats.getAllRequests.push({ paths: args.map(({ path }) => path), fieldMask: structuredClone(mask) });
        return args.map(({ path }) => {
          const doc = snapshot(path, mask), data = doc.data();
          stats.getAllData.push({ path, id: doc.id, exists: doc.exists, data });
          if (path.includes('/collectionEntries/') && doc.exists) stats.entryPayloadBytes += Buffer.byteLength(JSON.stringify(data));
          return doc;
        });
      }),
    },
    cardFor: vi.fn(async (id) => structuredClone(cards.get(id) ?? null)),
  };
  const read = (page = 0) => readBinderShare(new Request(`http://localhost/api/shared-binders/${token}?page=${page}`),
    { params: Promise.resolve({ token }) }, context);
  return { context, rows, documents, cards, stats, read };
}

describe('shared binder placement payload projection (synthetic, no read-count saving)', () => {
  it('asks the actual handler for precisely six fields before fetching the same bounded binder query', async () => {
    const f = fixture();
    expect((await f.read()).status).toBe(200);
    expect(f.stats.queries).toEqual([{ filters: [['binderId', '==', binderId]], mask: fields, maximum: 5001 }]);
    expect(f.stats.queryDocuments).toBe(f.rows.length);
  });

  it('actually drops unused fields from fetched data while preserving document IDs and absent optional fields', async () => {
    const f = fixture(), before = structuredClone(f.rows);
    expect((await f.read()).status).toBe(200);
    expect(f.stats.projectedData.map(({ id }) => id)).toEqual(f.rows.map(({ id }) => id));
    for (const { data } of f.stats.projectedData) expect(Object.keys(data).every((key) => fields.includes(key))).toBe(true);
    const legacy = f.stats.projectedData.find(({ id }) => id === 'e-legacy').data;
    expect(legacy).not.toHaveProperty('deleted'); expect(legacy).not.toHaveProperty('holoEffectId'); expect(legacy).not.toHaveProperty('holoIntensity');
    expect(f.rows).toEqual(before);
  });

  it('checks the test double really projects fields without filtering out documents whose selected field is absent', async () => {
    const f = fixture();
    const snapshot = await f.context.db.collection(placementsPath).where('binderId', '==', binderId).select('deleted').limit(5001).get();
    expect(snapshot.size).toBe(f.rows.length);
    expect(snapshot.docs.find((doc) => doc.id === 'e-legacy').data()).toEqual({});
    expect(snapshot.docs.find((doc) => doc.id === 'z-tombstone').data()).toEqual({ deleted: true });
    expect(snapshot.docs[0].data()).toEqual({ deleted: false });
  });

  for (const showPrices of [false, true]) for (const showTotal of [false, true]) for (const showDisplayName of [false, true]) {
    it(`keeps the complete DTO and private read counts with prices=${showPrices}, total=${showTotal}, name=${showDisplayName}`, async () => {
      const flags = { showPrices, showTotal, showDisplayName };
      const projected = fixture(flags), full = fixture(flags, { fullDocuments: true });
      const before = structuredClone(projected.rows);
      for (const page of [0, 1, 111]) {
        const actual = await projected.read(page), reference = await full.read(page);
        expect(actual.status).toBe(200); expect(reference.status).toBe(200);
        const body = await actual.json();
        expect(body).toEqual(await reference.json());
        expect(body.pageCount).toBe(112); expect(body.page).toBe(page);
        expect(body.displayName).toBe(showDisplayName ? 'Fixture streamer' : undefined);
        if (page === 0) {
          expect(body.cards.map(({ slot, cardId }) => [slot, cardId])).toEqual([[0, 'sv1-002'], [8, 'sv1-002']]);
          expect(body.unavailableSlots).toEqual([1]);
          expect(body.cards[1]).toMatchObject({ holoEffectId: 'none', holoIntensity: 0 });
          for (const card of body.cards) {
            if (showPrices) expect(card.price).toEqual({ amount: 12.34, currency: 'EUR', source: 'Cardmarket', asOf: '2026-09-24T00:00:00.000Z', basis: 'selection' });
            else expect(card).not.toHaveProperty('price');
          }
        }
        if (page === 111) {
          expect(body.cards.map(({ slot, cardId }) => [slot, cardId])).toEqual([[1000, 'sv1-001']]);
          if (showPrices) expect(body.cards[0].price).toEqual({ amount: 2.5, currency: 'EUR', source: 'Cardmarket', asOf: '2026-09-24T00:00:00Z' });
          else expect(body.cards[0]).not.toHaveProperty('price');
        }
        if (showTotal) expect(body.total).toEqual({ amount: null, currency: 'EUR', complete: false, pricedCards: 3, visibleCards: 5 });
        else expect(body).not.toHaveProperty('total');
        expect(JSON.stringify(body)).not.toMatch(/projection-owner|entry-|PRIVATE_|lastMutationId|updatedAtClient/);
        expect(actual.headers.get('cache-control')).toContain('no-store');
      }
      expect(projected.stats.queryDocuments).toBe(full.stats.queryDocuments);
      expect(projected.stats.singleGets).toBe(full.stats.singleGets);
      expect(projected.stats.getAllDocuments).toBe(full.stats.getAllDocuments);
      expect(projected.stats.getAllRequests.map(({ paths }) => paths)).toEqual(full.stats.getAllRequests.map(({ paths }) => paths));
      for (const request of projected.stats.getAllRequests.filter(({ paths }) => paths[0].includes('/collectionPriceSelections/'))) {
        expect(request.fieldMask).toBeNull();
      }
      expect(projected.rows).toEqual(before);
    });
  }

  it('reduces synthetic payload bytes, explicitly not placement query or document read counts', async () => {
    const projected = fixture(), full = fixture({}, { fullDocuments: true });
    expect((await projected.read()).status).toBe(200); expect((await full.read()).status).toBe(200);
    expect(projected.stats.queryDocuments).toBe(full.stats.queryDocuments);
    expect(projected.stats.queries).toHaveLength(1); expect(full.stats.queries).toHaveLength(1);
    expect(projected.stats.payloadBytes).toBeLessThan(full.stats.payloadBytes);
  });

  it.each([{ ownerUid: undefined }, { ownerUid: 'foreign' }, { entrySyncId: undefined }, { entrySyncId: '../foreign' },
    { slotPosition: undefined }, { slotPosition: '5' }, { slotPosition: -1 }, { slotPosition: 900001 }])(
    'does not conceal malformed or foreign live placement fields: %j', async (patch) => {
      const f = fixture(); Object.assign(f.rows[0].data, patch);
      for (const [key, value] of Object.entries(patch)) if (value === undefined) delete f.rows[0].data[key];
      expect((await f.read()).status).toBe(503);
      expect(f.context.cardFor).not.toHaveBeenCalled();
    });

  it('keeps missing-entry/catalog semantics and rejects pages outside the original full-layout bound', async () => {
    const f = fixture();
    const body = await (await f.read(0)).json();
    expect(body.cards.map((card) => card.slot)).toEqual([0, 8]);
    expect(body.unavailableSlots).toEqual([1]); // Not slots 2/3: foreign or absent entries remain absent.
    expect((await f.read(112)).status).toBe(404);
  });

  it('retains the 5000-document cap including tombstones, rather than quietly filtering them out', async () => {
    const f = fixture();
    f.rows.splice(0, f.rows.length, ...Array.from({ length: 5001 }, (_, index) => ({
      id: `deleted-${index}`, data: { binderId, ownerUid: 'foreign', deleted: true },
    })));
    expect((await f.read()).status).toBe(503);
    expect(f.stats.queryDocuments).toBe(5001); expect(f.context.cardFor).not.toHaveBeenCalled();
  });

  it.each(['share', 'binder', 'access', 'deletion-lock'])('preserves the final revocation check after slow catalogue work: %s', async (kind) => {
    const projected = fixture({ showPrices: true, showTotal: true }), full = fixture({ showPrices: true, showTotal: true }, { fullDocuments: true });
    for (const f of [projected, full]) {
      const original = f.context.cardFor.getMockImplementation();
      f.context.cardFor.mockImplementation(async (id) => {
        if (kind === 'share') f.documents.get(sharePath).revokedAt = 1;
        if (kind === 'binder') f.documents.get(binderPath).deleted = true;
        if (kind === 'access') f.documents.set(`accountAccess/${owner}`, { appAccess: false });
        if (kind === 'deletion-lock') f.documents.set(`accountDeletionLocks/${owner}`, { fixture: true });
        return original(id);
      });
    }
    const actual = await projected.read(), reference = await full.read();
    expect(actual.status).toBe(404); expect(reference.status).toBe(404);
    expect(await actual.json()).toEqual(await reference.json());
    expect(projected.stats.queryDocuments).toBe(full.stats.queryDocuments);
    expect(projected.stats.singleGets).toBe(full.stats.singleGets);
    expect(projected.stats.getAllDocuments).toBe(full.stats.getAllDocuments);
  });
});

describe('shared binder collection-entry payload projection (synthetic, no read-count saving)', () => {
  it('models trailing getAll options without an extra read and retains missing documents and absent fields', async () => {
    const f = fixture();
    const entryPath = `users/${owner}/collectionEntries/entry-1`, missingPath = `users/${owner}/collectionEntries/missing-entry`;
    const refs = [entryPath, missingPath].map((path) => f.context.db.doc(path));
    const docs = await f.context.db.getAll(...refs, { fieldMask: ['quantity', 'absentField'] });
    expect(docs.map(({ id, exists }) => ({ id, exists }))).toEqual([{ id: 'entry-1', exists: true }, { id: 'missing-entry', exists: false }]);
    expect(docs[0].data()).toEqual({ quantity: 9 }); expect(docs[1].data()).toBeUndefined();
    expect(f.stats.getAllDocuments).toBe(2);
    expect(f.stats.getAllRequests).toEqual([{ paths: [entryPath, missingPath], fieldMask: ['quantity', 'absentField'] }]);
    expect(f.documents.get(entryPath).notes).toContain('PRIVATE_ENTRY_NOTE');
  });

  it('requests exactly the thirteen entry fields while keeping price-selection getAll unmasked', async () => {
    const f = fixture({ showPrices: true, showTotal: true });
    expect((await f.read()).status).toBe(200);
    const entries = f.stats.getAllRequests.filter(({ paths }) => paths[0].includes('/collectionEntries/'));
    const selections = f.stats.getAllRequests.filter(({ paths }) => paths[0].includes('/collectionPriceSelections/'));
    expect(entries).toHaveLength(1); expect(selections).toHaveLength(1);
    expect(entries[0].fieldMask).toEqual(entryFields);
    expect(selections[0].fieldMask).toBeNull();
    expect(selections[0].paths).toEqual([`users/${owner}/collectionPriceSelections/entry-2`, `users/${owner}/collectionPriceSelections/entry-4`]);
    const selected = f.stats.getAllData.find(({ path }) => path.endsWith('/collectionPriceSelections/entry-2'));
    expect(selected.data).toEqual(f.documents.get(selected.path));
  });

  it('does not load private notes, acquisition or photo payloads, without changing entries or document reads', async () => {
    const projected = fixture({ showPrices: true, showTotal: true }), full = fixture({ showPrices: true, showTotal: true }, { fullDocuments: true });
    const before = structuredClone(projected.documents);
    const actual = await projected.read(), reference = await full.read();
    expect(actual.status).toBe(200); expect(reference.status).toBe(200);
    expect(await actual.json()).toEqual(await reference.json());
    expect(projected.stats.getAllDocuments).toBe(full.stats.getAllDocuments);
    expect(projected.stats.queryDocuments).toBe(full.stats.queryDocuments);
    expect(projected.stats.singleGets).toBe(full.stats.singleGets);
    const entries = projected.stats.getAllData.filter(({ path }) => path.includes('/collectionEntries/'));
    expect(entries.map(({ id, exists }) => ({ id, exists }))).toEqual(full.stats.getAllData
      .filter(({ path }) => path.includes('/collectionEntries/')).map(({ id, exists }) => ({ id, exists })));
    for (const { data, exists } of entries) {
      if (exists) expect(Object.keys(data).every((key) => entryFields.includes(key))).toBe(true);
      else expect(data).toBeUndefined();
    }
    expect(JSON.stringify(entries)).not.toMatch(/PRIVATE_|acquisition|imageUrl|privatePhotoPayload/);
    expect(projected.stats.entryPayloadBytes).toBeLessThan(full.stats.entryPayloadBytes);
    expect(projected.documents).toEqual(before);
  });

  it.each(['reverse-alternative', 'legacy-set-fallback'])('keeps the complete DTO and reads for every visibility combination: %s', async (kind) => {
    for (const showPrices of [false, true]) for (const showTotal of [false, true]) for (const showDisplayName of [false, true]) {
      const flags = { showPrices, showTotal, showDisplayName };
      const projected = fixture(flags), full = fixture(flags, { fullDocuments: true });
      for (const f of [projected, full]) {
        if (kind === 'reverse-alternative') {
          const entry = f.documents.get(`users/${owner}/collectionEntries/entry-2`);
          const selection = f.documents.get(`users/${owner}/collectionPriceSelections/entry-2`);
          entry.finish = selection.finish = f.cards.get(entry.sourceCardId).variants_detailed[0].type = 'Reverse Holo';
          selection.metric = 'reverse_holo_low'; selection.amountMinor = 777;
          // This is a normal trend, not a reverse trend; it must not replace the saved reverse choice.
          f.cards.get(entry.sourceCardId).variants_detailed[0].pricing.cardmarket.trend = 999;
        } else {
          const entry = f.documents.get(`users/${owner}/collectionEntries/entry-1`);
          delete entry.sourceSetId; delete entry.deleted;
        }
      }
      const before = structuredClone(projected.documents);
      for (const page of [0, 111]) {
        const actual = await projected.read(page), reference = await full.read(page);
        expect(actual.status).toBe(200); expect(reference.status).toBe(200);
        const body = await actual.json(); expect(body).toEqual(await reference.json());
        expect(body.page).toBe(page); expect(body.pageCount).toBe(112);
        if (page === 0) {
          expect(body.cards.map(({ slot, cardId }) => [slot, cardId])).toEqual([[0, 'sv1-002'], [8, 'sv1-002']]);
          if (showPrices) for (const card of body.cards) expect(card.price).toEqual({ amount: kind === 'reverse-alternative' ? 7.77 : 12.34,
            currency: 'EUR', source: 'Cardmarket', asOf: '2026-09-24T00:00:00.000Z', basis: 'selection' });
        } else {
          expect(body.cards.map(({ slot, cardId }) => [slot, cardId])).toEqual([[1000, 'sv1-001']]);
          if (showPrices) expect(body.cards[0].price).toEqual({ amount: 2.5, currency: 'EUR', source: 'Cardmarket', asOf: '2026-09-24T00:00:00Z' });
        }
        if (!showPrices) for (const card of body.cards) expect(card).not.toHaveProperty('price');
        if (showTotal) expect(body.total).toEqual({ amount: null, currency: 'EUR', complete: false, pricedCards: 3, visibleCards: 5 });
        else expect(body).not.toHaveProperty('total');
        expect(body.displayName).toBe(showDisplayName ? 'Fixture streamer' : undefined);
      }
      expect(projected.stats.queryDocuments).toBe(full.stats.queryDocuments);
      expect(projected.stats.singleGets).toBe(full.stats.singleGets);
      expect(projected.stats.getAllDocuments).toBe(full.stats.getAllDocuments);
      expect(projected.stats.getAllRequests.map(({ paths }) => paths)).toEqual(full.stats.getAllRequests.map(({ paths }) => paths));
      const selections = projected.stats.getAllRequests.filter(({ paths }) => paths[0].includes('/collectionPriceSelections/'));
      for (const request of selections) expect(request.fieldMask).toBeNull();
      for (const { path, data, exists } of projected.stats.getAllData.filter(({ path }) => path.includes('/collectionPriceSelections/'))) {
        expect(data).toEqual(exists ? projected.documents.get(path) : undefined);
      }
      if (kind === 'legacy-set-fallback') for (const doc of projected.stats.getAllData.filter(({ path }) => path.endsWith('/collectionEntries/entry-1'))) {
        expect(doc.data).not.toHaveProperty('sourceSetId'); expect(doc.data).not.toHaveProperty('deleted');
      }
      expect(projected.documents).toEqual(before);
    }
  });
});
