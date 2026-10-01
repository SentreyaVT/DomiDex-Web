import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { readBinderShare } from '../backend/security/sharing.mjs';
import { resolveCollectionPrice } from '../lib/collection-prices';

const token = 'P'.repeat(43);
const sharePath = `privateBinderShares/${createHash('sha256').update(token).digest('hex')}`;
const sourceAt = Date.parse('2026-09-24T00:00:00Z');
export function priceFixture(flags = { showPrices: true, showTotal: true }, owner = 'owner-fixture') {
  const entry = { syncId: 'entry-a', ownerUid: owner, deleted: false, quantity: 9,
    sourceCardId: 'sv1-001', sourceSetId: 'sv1', setId: 'sv1', collectorNumber: '001',
    language: 'DE', finish: 'Normal', variant: 'Standard', externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: 42,
    notes: 'PRIVATE_NOTE', acquisitionPriceMinor: 999999 };
  const selection = { schemaVersion: 1, ownerUid: owner, entrySyncId: entry.syncId, revision: 1,
    lastMutationId: 'mutation-a', updatedAtClient: sourceAt, cleared: false, sourceSetId: entry.sourceSetId,
    sourceCardId: entry.sourceCardId, collectorNumber: entry.collectorNumber, language: entry.language,
    finish: entry.finish, variant: entry.variant, productId: 42, metric: 'normal_avg_sell', amountMinor: 1234,
    currency: 'EUR', sourceAt, selectedAt: sourceAt + 1000 };
  const card = { id: entry.sourceCardId, localId: '001', name: 'Public fixture', set: { id: 'sv1', name: 'Public set' },
    variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: {
      idProduct: 42, trend: null, avg: 12.34, unit: 'EUR', updated: '2026-09-25T00:00:00Z',
    } } }] };
  const binderPath = `users/${owner}/privateBinders/binder-a`;
  const entryPath = `users/${owner}/collectionEntries/${entry.syncId}`;
  const selectionPath = `users/${owner}/collectionPriceSelections/${entry.syncId}`;
  const documents = new Map([
    [sharePath, { ownerUid: owner, binderId: 'binder-a', revokedAt: null, ...flags }],
    [binderPath, { ownerUid: owner, binderId: 'binder-a', name: 'Fixture binder', minimumPageCount: 1, deleted: false }],
    [entryPath, entry], [selectionPath, selection],
  ]);
  const rows = [{ id: 'placement-a', ownerUid: owner, binderId: 'binder-a', entrySyncId: entry.syncId, slotPosition: 0, deleted: false }];
  const snapshot = (path) => ({ id: path.split('/').at(-1), exists: documents.has(path), data: () => structuredClone(documents.get(path)) });
  const context = { sharingEnabled: true,
    auth: { getUser: vi.fn(async () => ({ disabled: false, customClaims: { appAccess: true } })) },
    db: { doc: (path) => ({ path, get: async () => snapshot(path) }),
      collection: (path) => {
        expect(path).toBe(`users/${owner}/privateBinderPlacements`);
        return { where: () => ({ select: (...fields) => ({ limit: (limit) => ({ get: async () => ({ size: rows.length,
          docs: rows.slice(0, limit).map((row) => ({ id: row.id,
            data: () => structuredClone(Object.fromEntries(fields.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]))),
          })) }) }) }) }) };
      },
      getAll: vi.fn(async (...refs) => refs.map(({ path }) => snapshot(path))),
    }, cardFor: vi.fn(async () => structuredClone(card)),
  };
  const read = (page = 0) => readBinderShare(new Request(`http://localhost/api/shared-binders/${token}?page=${page}`), { params: Promise.resolve({ token }) }, context);
  const selectionReads = () => context.db.getAll.mock.calls.flat().filter((ref) => ref.path.includes('/collectionPriceSelections/'));
  return { entry, selection, card, documents, context, rows, read, selectionReads, entryPath, selectionPath, binderPath };
}

describe('shared binder synchronized price selection parity', () => {
  it('uses the same confirmed fallback as collection pricing, with original date and no private fields', async () => {
    const f = priceFixture();
    const collection = await resolveCollectionPrice(f.entry, async () => f.card, f.selection);
    expect(collection).toMatchObject({ price: 12.34, source: 'manual' });
    const body = await (await f.read()).json();
    expect(body.cards[0].price).toEqual({ amount: collection.price, currency: 'EUR', source: 'Cardmarket',
      asOf: '2026-09-24T00:00:00.000Z', basis: 'selection' });
    expect(body.total).toEqual({ amount: 12.34, currency: 'EUR', complete: true, pricedCards: 1, visibleCards: 1 });
    expect(JSON.stringify(body)).not.toMatch(/owner-fixture|entry-a|mutation-a|PRIVATE_NOTE|quantity|acquisition|selectedAt|revision/);
    expect(f.selectionReads()).toHaveLength(1);
  });
  it.each([{ showPrices: true, showTotal: false }, { showPrices: false, showTotal: true }, { showPrices: false, showTotal: false }])(
    'retains independent consent: %j', async (flags) => {
      const f = priceFixture(flags), body = await (await f.read()).json();
      expect(body.cards[0].price?.amount).toBe(flags.showPrices ? 12.34 : undefined);
      expect(body.total?.amount).toBe(flags.showTotal ? 12.34 : undefined);
      expect(f.selectionReads()).toHaveLength(flags.showPrices || flags.showTotal ? 1 : 0);
    });
  it('keeps trend priority without any extra selection read', async () => {
    const f = priceFixture(); f.card.variants_detailed[0].pricing.cardmarket.trend = 5;
    const body = await (await f.read()).json();
    expect(body.cards[0].price).toEqual({ amount: 5, currency: 'EUR', source: 'Cardmarket', asOf: '2026-09-25T00:00:00Z' });
    expect(body.total.amount).toBe(5); expect(f.selectionReads()).toHaveLength(0);
  });
  it.each([{ ownerUid: 'foreign' }, { entrySyncId: 'foreign' }, { revision: 0 }, { amountMinor: -1 }, { currency: 'USD' },
    { metric: 'reverse_holo_low' }, { sourceCardId: 'sv1-002' }, { sourceSetId: 'different' }, { collectorNumber: '002' },
    { language: 'EN' }, { finish: 'Holo' }, { variant: 'Stamped' }, { productId: 999 }, { schemaVersion: 2 }, { cleared: true }])(
    'rejects invalid or mismatched sidecar: %j', async (patch) => {
      const f = priceFixture(); f.documents.set(f.selectionPath, { ...f.selection, ...patch });
      const body = await (await f.read()).json();
      expect(body.cards[0].price.amount).toBeNull(); expect(body.total.complete).toBe(false);
    });
  it.each(['missing', 'cleared'])('keeps absent/cleared selection unavailable (%s)', async (mode) => {
    const f = priceFixture();
    if (mode === 'missing') f.documents.delete(f.selectionPath);
    else f.documents.set(f.selectionPath, { ...f.selection, cleared: true,
      ...Object.fromEntries(['sourceSetId', 'sourceCardId', 'collectorNumber', 'language', 'finish', 'variant', 'productId',
        'metric', 'amountMinor', 'currency', 'sourceAt', 'selectedAt'].map((key) => [key, null])) });
    const body = await (await f.read()).json(); expect(body.cards[0].price.amount).toBeNull();
  });
  it.each(['wrong-product', 'wrong-set', 'no-variant', 'wrong-entry-path'])('does not read selection for inexact entry (%s)', async (kind) => {
    const f = priceFixture();
    if (kind === 'wrong-product') f.card.variants_detailed[0].pricing.cardmarket.idProduct = 999;
    if (kind === 'wrong-set') f.card.set.id = 'foreign';
    if (kind === 'no-variant') f.card.variants_detailed = [];
    if (kind === 'wrong-entry-path') f.entry.syncId = 'foreign';
    const body = await (await f.read()).json();
    expect(body.cards[0]?.price?.amount ?? null).toBeNull(); expect(f.selectionReads()).toHaveLength(0);
  });
  it('keeps reverse alternatives separate from normal prices', async () => {
    const f = priceFixture(); f.entry.finish = f.selection.finish = f.card.variants_detailed[0].type = 'Reverse Holo';
    f.selection.metric = 'reverse_holo_low'; f.selection.amountMinor = 777;
    f.card.variants_detailed[0].pricing.cardmarket.trend = 999;
    const body = await (await f.read()).json(); expect(body.cards[0].price.amount).toBe(7.77);
  });
  it('reads only needed unique page entries; quantities and duplicate placements do not multiply per-card values', async () => {
    const f = priceFixture({ showPrices: true, showTotal: false });
    f.rows.push({ ...f.rows[0], id: 'placement-copy', slotPosition: 1 }, { ...f.rows[0], id: 'other-page', entrySyncId: 'other-entry', slotPosition: 9 });
    f.documents.set(f.entryPath.replace('entry-a', 'other-entry'), { ...f.entry, syncId: 'other-entry' });
    const body = await (await f.read()).json(); expect(body.cards.map((card) => card.price.amount)).toEqual([12.34, 12.34]);
    expect(f.selectionReads().map((ref) => ref.path)).toEqual([f.selectionPath]);
    expect(f.context.cardFor).toHaveBeenCalledTimes(1);
  });
  it('isolates owner-specific handler values and sees clearing on the next read (injected catalog)', async () => {
    const a = priceFixture(), b = priceFixture(undefined, 'other-owner'); b.selection.amountMinor = 2345;
    expect((await (await a.read()).json()).cards[0].price.amount).toBe(12.34);
    expect((await (await b.read()).json()).cards[0].price.amount).toBe(23.45);
    a.documents.delete(a.selectionPath);
    expect((await (await a.read()).json()).cards[0].price.amount).toBeNull();
  });
  it('keeps different owner selections outside the actual shared public cache', async () => {
    vi.resetModules();
    const { readBinderShare: actualRead } = await import('../backend/security/sharing.mjs');
    const a = priceFixture(), b = priceFixture(undefined, 'other-owner');
    b.selection.amountMinor = 2345;
    a.card.image = 'https://assets.tcgdex.net/de/sv/sv1/001';
    const originalFetch = globalThis.fetch;
    const fetch = vi.fn(async () => Response.json(a.card));
    globalThis.fetch = fetch;
    delete a.context.cardFor; delete b.context.cardFor;
    const read = async (f) => (await actualRead(new Request(`http://localhost/api/shared-binders/${token}`),
      { params: Promise.resolve({ token }) }, f.context)).json();
    try {
      expect((await read(a)).cards[0].price.amount).toBe(12.34);
      expect((await read(b)).cards[0].price.amount).toBe(23.45);
      a.documents.delete(a.selectionPath);
      expect((await read(a)).cards[0].price.amount).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(a.selectionReads()).toHaveLength(2); expect(b.selectionReads()).toHaveLength(1);
    } finally { globalThis.fetch = originalFetch; }
  });
  it.each(['trend', 'selection'])('preserves the Android maximum of 1e9 EUR (%s)', async (kind) => {
    const f = priceFixture();
    if (kind === 'trend') f.card.variants_detailed[0].pricing.cardmarket.trend = 1_000_000_000;
    else f.selection.amountMinor = 100_000_000_000;
    const body = await (await f.read()).json();
    expect(body.cards[0].price.amount).toBe(1_000_000_000);
    expect(body.total).toEqual({ amount: 1_000_000_000, currency: 'EUR', complete: true, pricedCards: 1, visibleCards: 1 });
  });
  it.each(['trend', 'selection'])('omits an unrepresentable individual amount without clamping or a false basis (%s)', async (kind) => {
    const f = priceFixture();
    if (kind === 'trend') f.card.variants_detailed[0].pricing.cardmarket.trend = 1_000_000_000.01;
    else f.selection.amountMinor = 100_000_000_001;
    const body = await (await f.read()).json();
    expect(body.cards[0].price.amount).toBeNull();
    expect(body.cards[0].price).not.toHaveProperty('basis');
    expect(body.total).toEqual({ amount: null, currency: 'EUR', complete: false, pricedCards: 0, visibleCards: 1 });
    // The saved source is not modified, and the collection's price contract is unchanged.
    expect((await resolveCollectionPrice(f.entry, async () => f.card, f.selection)).price).toBe(1_000_000_000.01);
  });
  it.each([50_000_000_000, 50_000_000_001])('keeps honest counts by omitting only overflowing optional totals (%i cents per placement)', async (minor) => {
    const f = priceFixture(); f.selection.amountMinor = minor;
    f.rows.push({ ...f.rows[0], id: 'duplicate-placement', slotPosition: 1 });
    const body = await (await f.read()).json();
    expect(body.cards.map((card) => card.price.amount)).toEqual([minor / 100, minor / 100]);
    expect(f.selectionReads()).toHaveLength(1);
    if (minor === 50_000_000_000) expect(body.total).toEqual({ amount: 1_000_000_000, currency: 'EUR', complete: true, pricedCards: 2, visibleCards: 2 });
    else expect(body).not.toHaveProperty('total');
  });
  it('preserves the empty binder zero total and exact Android completeness invariants', async () => {
    const f = priceFixture(); f.rows.length = 0;
    const body = await (await f.read()).json();
    expect(body.total).toEqual({ amount: 0, currency: 'EUR', complete: true, pricedCards: 0, visibleCards: 0 });
    expect(body.total.complete).toBe(body.total.pricedCards === body.total.visibleCards);
    expect(body.total.complete).toBe(body.total.amount !== null);
  });
  it.each(['revoke', 'binder-delete', 'disabled', 'deletion-lock'])('still denies access changed during selection read (%s)', async (kind) => {
    const f = priceFixture(), original = f.context.db.getAll.getMockImplementation();
    f.context.db.getAll.mockImplementation(async (...refs) => {
      if (refs.some((ref) => ref.path.includes('/collectionPriceSelections/'))) {
        if (kind === 'revoke') f.documents.get(sharePath).revokedAt = 1;
        if (kind === 'binder-delete') f.documents.get(f.binderPath).deleted = true;
        if (kind === 'disabled') f.context.auth.getUser.mockResolvedValue({ disabled: true, customClaims: { appAccess: true } });
        if (kind === 'deletion-lock') f.documents.set('accountDeletionLocks/owner-fixture', { fixture: true });
      }
      return original(...refs);
    });
    expect((await f.read()).status).toBe(404);
  });
});
