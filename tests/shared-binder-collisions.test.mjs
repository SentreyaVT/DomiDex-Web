import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { readBinderShare } from '../backend/security/sharing.mjs';

const owner = 'owner-fixture', binderId = 'binder-fixture', token = 'A'.repeat(43);
const sharePath = `privateBinderShares/${createHash('sha256').update(token).digest('hex')}`;
const binderPath = `users/${owner}/privateBinders/${binderId}`;
const placementPath = `users/${owner}/privateBinderPlacements`;
const entryPath = `users/${owner}/collectionEntries`;
const placement = (id, slot, extra = {}) => ({ id, data: {
  ownerUid: owner, binderId, entrySyncId: `entry-${id}`, slotPosition: slot,
  holoEffectId: 'galaxy', holoIntensity: .7, deleted: false, ...extra,
} });

function fixture(rows, flags = {}) {
  const documents = new Map([
    [sharePath, { ownerUid: owner, binderId, revokedAt: null, ...flags }],
    [binderPath, { ownerUid: owner, binderId, name: 'Shared fixture', coverStyle: 'galaxy', minimumPageCount: 1, deleted: false }],
  ]);
  for (const row of rows) documents.set(`${entryPath}/${row.data.entrySyncId}`, {
    ownerUid: owner, sourceCardId: `sv1-${row.id}`, sourceSetId: 'sv1', setId: 'sv1',
    collectorNumber: row.id, finish: 'Normal', variant: 'Standard', externalProductId: 42,
    deleted: false, quantity: 1, notes: 'PRIVATE_NOTES',
  });
  const snapshot = (path, fields = null) => ({ id: path.split('/').pop(), exists: documents.has(path), data: () => {
    const data = documents.get(path);
    return fields === null || data === undefined ? data
      : Object.fromEntries(fields.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]));
  } });
  const doc = (path) => ({ path, get: async () => snapshot(path) });
  const context = {
    sharingEnabled: true,
    auth: { getUser: vi.fn(async () => ({ disabled: false, customClaims: { appAccess: true } })) },
    db: {
      doc,
      collection: (path) => {
        expect(path).toBe(placementPath);
        return { where(field, operator, value) {
          expect([field, operator, value]).toEqual(['binderId', '==', binderId]);
          return { select: (...fields) => ({ limit: (limit) => ({ get: async () => ({ size: Math.min(rows.length, limit),
            docs: rows.slice(0, limit).map((row) => ({ id: row.id,
              data: () => Object.fromEntries(fields.filter((key) => Object.hasOwn(row.data, key)).map((key) => [key, row.data[key]])),
            })) }) }) }) };
        } };
      },
      getAll: async (...references) => {
        const fields = Array.isArray(references.at(-1)?.fieldMask) ? references.pop().fieldMask : null;
        return references.map(({ path }) => snapshot(path, fields));
      },
    },
    cardFor: vi.fn(async (id) => ({ id, localId: id.slice(4), name: `Card ${id}`, image: `https://assets.tcgdex.net/de/sv/sv1/${id.slice(4)}`, set: { id: 'sv1', name: 'Fixture set' },
      variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: { idProduct: 42, trend: 2.5, unit: 'EUR' } } }],
    })),
  };
  const read = (page = 0) => readBinderShare(new Request(`https://domidex.web.app/api/shared-binders/${token}?page=${page}`), { params: Promise.resolve({ token }) }, context);
  return { context, documents, read };
}

describe('shared binder read-only collision recovery', () => {
  it('recovers the 23-placement incident without dropping cards or changing stored data', async () => {
    const rows = Array.from({ length: 23 }, (_, index) => placement(String(index + 1).padStart(3, '0'), index));
    rows[22].data.slotPosition = 5;
    const { read, documents } = fixture(rows, { showTotal: true, showPrices: true });
    const before = JSON.stringify([...documents]), beforeRows = JSON.stringify(rows);
    const cards = [];
    for (let page = 0; page < 3; page++) {
      const response = await read(page);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      const body = await response.json();
      expect(body.pageCount).toBe(3);
      expect(body.total).toEqual({ amount: 57.5, currency: 'EUR', complete: true, pricedCards: 23, visibleCards: 23 });
      cards.push(...body.cards);
    }
    expect(cards).toHaveLength(23);
    expect(new Set(cards.map((card) => card.cardId)).size).toBe(23);
    expect(new Set(cards.map((card) => card.slot)).size).toBe(23);
    expect(cards.find((card) => card.cardId === 'sv1-006').slot).toBe(5);
    expect(cards.find((card) => card.cardId === 'sv1-023').slot).toBe(22);
    expect(cards.every((card) => card.holoEffectId === 'galaxy' && card.holoIntensity === .7 && card.price.amount === 2.5)).toBe(true);
    expect(JSON.stringify(cards)).not.toMatch(/owner-fixture|entry-|PRIVATE_NOTES/);
    expect(JSON.stringify([...documents])).toBe(before);
    expect(JSON.stringify(rows)).toBe(beforeRows);
  });

  it('is deterministic across query order and reserves unique requested slots before resolving collisions', async () => {
    const rows = [placement('002', 5), placement('001', 5), placement('003', 0), placement('004', 1), placement('006', 8), placement('005', 8)];
    const body = await (await fixture(rows).read()).json();
    const reversed = await (await fixture([...rows].reverse()).read()).json();
    expect(body).toEqual(reversed);
    expect(body.cards.map(({ cardId, slot }) => [cardId, slot])).toEqual([
      ['sv1-003', 0], ['sv1-004', 1], ['sv1-002', 2], ['sv1-006', 3], ['sv1-001', 5], ['sv1-005', 8],
    ]);
    expect(body.total).toBeUndefined();
    expect(body.cards.every((card) => !('price' in card))).toBe(true);
  });

  it('adds a read-only page when all original page slots are full', async () => {
    const rows = Array.from({ length: 9 }, (_, index) => placement(String(index + 1).padStart(3, '0'), index));
    rows.push(placement('010', 5));
    const { read } = fixture(rows);
    const first = await (await read()).json(), second = await (await read(1)).json();
    expect(first.pageCount).toBe(2);
    expect(first.cards).toHaveLength(9);
    expect(second.cards).toMatchObject([{ cardId: 'sv1-010', slot: 9 }]);
    expect((await read(2)).status).toBe(404);
  });

  it('preserves valid original positions, ignores tombstones and keeps missing catalog slots visible as unavailable', async () => {
    const rows = [placement('001', 5), placement('002', 5, { deleted: true }), placement('003', 12)];
    const { context, read } = fixture(rows);
    expect((await (await read()).json()).cards).toMatchObject([{ cardId: 'sv1-001', slot: 5 }]);
    context.cardFor.mockResolvedValue(null);
    const body = await (await read(1)).json();
    expect(body.pageCount).toBe(2); expect(body.cards).toEqual([]); expect(body.unavailableSlots).toEqual([12]);
  });

  it.each([{ ownerUid: 'foreign-owner' }, { entrySyncId: '../foreign' }, { slotPosition: -1 }, { slotPosition: 900001 }, { slotPosition: 1.5 }, { slotPosition: '5' }])('still rejects malformed or cross-owner placements: %j', async (extra) => {
    const { read, context } = fixture([placement('001', 5), placement('002', 5, extra)]);
    expect((await read()).status).toBe(503);
    expect(context.cardFor).not.toHaveBeenCalled();
  });

  it('still fails closed above the bounded placement limit', async () => {
    const { read } = fixture(Array.from({ length: 5001 }, (_, index) => placement(String(index), 0)));
    expect((await read()).status).toBe(503);
  });

  it.each(['disabled', 'no-access', 'access-revoked', 'deleted-owner', 'revoked-share', 'deleted-binder', 'gate-off'])('preserves access controls for %s even with a collision', async (condition) => {
    const { context, documents, read } = fixture([placement('001', 5), placement('002', 5)]);
    if (condition === 'disabled') context.auth.getUser.mockResolvedValue({ disabled: true, customClaims: { appAccess: true } });
    if (condition === 'no-access') context.auth.getUser.mockResolvedValue({ disabled: false, customClaims: {} });
    if (condition === 'access-revoked') documents.set(`accountAccess/${owner}`, { appAccess: false });
    if (condition === 'deleted-owner') documents.set(`accountDeletionLocks/${owner}`, { jobId: 'fixture' });
    if (condition === 'revoked-share') documents.get(sharePath).revokedAt = 1;
    if (condition === 'deleted-binder') documents.get(binderPath).deleted = true;
    if (condition === 'gate-off') context.sharingEnabled = false;
    expect((await read()).status).toBe(404);
    expect(context.cardFor).not.toHaveBeenCalled();
  });

  it('honors a revocation occurring during catalog resolution', async () => {
    const { context, documents, read } = fixture([placement('001', 5), placement('002', 5)]);
    const cardFor = context.cardFor.getMockImplementation();
    context.cardFor.mockImplementation(async (id) => { documents.get(sharePath).revokedAt = 1; return cardFor(id); });
    expect((await read()).status).toBe(404);
  });

  it.each(['tombstone', 'deleted-document', 'foreign-owner', 'different-binder-id'])(
    'fails closed when the binder changes during catalog resolution: %s', async (change) => {
      const { context, documents, read } = fixture([placement('001', 0)], { showTotal: true, showPrices: true });
      const cardFor = context.cardFor.getMockImplementation();
      context.cardFor.mockImplementation(async (id) => {
        // Replace the record: the earlier snapshot remains unchanged, just like a real SDK read.
        const previous = documents.get(binderPath);
        if (change === 'deleted-document') documents.delete(binderPath);
        else documents.set(binderPath, {
          ...previous,
          ...(change === 'tombstone' ? { deleted: true } : {}),
          ...(change === 'foreign-owner' ? { ownerUid: 'other-owner' } : {}),
          ...(change === 'different-binder-id' ? { binderId: 'other-binder' } : {}),
        });
        return cardFor(id);
      });
      const response = await read();
      expect(context.cardFor).toHaveBeenCalledOnce();
      expect(response.status).toBe(404);
      expect(await response.text()).not.toMatch(/Shared fixture|Card sv1|owner-fixture|other-owner|other-binder/);
    },
  );
});
