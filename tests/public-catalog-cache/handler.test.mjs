import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const token = 'P'.repeat(43), sharePath = `privateBinderShares/${createHash('sha256').update(token).digest('hex')}`;
const guardFetch = globalThis.fetch;
const card = { id: 'sv1-001', localId: '001', name: 'Public card', set: { id: 'sv1', name: 'Public set' },
  image: 'https://assets.tcgdex.net/de/sv/sv1/001', variants_detailed: [{ type: 'Normal', size: 'Standard',
    pricing: { cardmarket: { idProduct: 42, trend: 2.5, unit: 'EUR', updated: '2026-10-01' } } }] };
let readBinderShare;
beforeEach(async () => { vi.resetModules(); ({ readBinderShare } = await import('../../backend/security/sharing.mjs')); });
afterEach(() => { globalThis.fetch = guardFetch; });
function fixture(owner = 'owner-a') {
  const binderPath = `users/${owner}/privateBinders/binder`;
  const documents = new Map([[sharePath, { ownerUid: owner, binderId: 'binder', revokedAt: null }],
    [binderPath, { ownerUid: owner, binderId: 'binder', name: 'Private named binder', coverStyle: 'galaxy' }]]);
  const entry = { ownerUid: owner, sourceCardId: card.id, sourceSetId: 'sv1', setId: 'sv1', collectorNumber: '001',
    finish: 'Normal', variant: 'Standard', externalProductId: 42, quantity: 1, notes: 'PRIVATE_NOTE' };
  const placement = { ownerUid: owner, entrySyncId: 'entry', slotPosition: 0 };
  let reads = 0, authReads = 0, afterEntries = () => {};
  const context = { sharingEnabled: true,
    auth: { getUser: async () => { authReads++; return { disabled: false, customClaims: { appAccess: true } }; } },
    db: { doc: (path) => ({ get: async () => { reads++; const data = documents.get(path); return { exists: data !== undefined, data: () => data }; } }),
      collection: () => ({ where: () => ({ select: (...fields) => ({ limit: () => ({ get: async () => ({ size: 1,
        docs: [{ id: 'placement', data: () => Object.fromEntries(fields.filter((key) => Object.hasOwn(placement, key)).map((key) => [key, placement[key]])) }],
      }) }) }) }) }),
      getAll: async () => { reads++; afterEntries(); return [{ id: 'entry', data: () => entry }]; },
    } };
  return { documents, binderPath, context, entry,
    afterEntries: (callback) => { afterEntries = callback; },
    counts: () => ({ logicalReads: reads, authReads }),
    options: (flags) => documents.set(sharePath, { ...documents.get(sharePath), ...flags }),
    read: () => readBinderShare(new Request(`https://synthetic.invalid/api/shared-binders/${token}`),
      { params: Promise.resolve({ token }) }, context),
  };
}
function provider(implementation = () => Response.json(card)) {
  const mocked = vi.fn(async (url, options) => {
    expect(String(url)).toMatch(/^https:\/\/api\.tcgdex\.net\/v2\/(de|en)\/cards\/sv1-001$/);
    expect(options.headers).toEqual({ Accept: 'application/json' });
    return implementation(String(url), options);
  });
  globalThis.fetch = mocked; return mocked;
}

describe('actual sharing handler public-cache integration (fake provider only)', () => {
  it('cold raw / cold prices / warm prices reduce only same-mode fetches and keep opt-ins independent', async () => {
    const fetch = provider(), data = fixture();
    const cold = await data.read(); expect(cold.status).toBe(200); expect((await cold.json()).cards[0]).not.toHaveProperty('price');
    expect(data.counts()).toEqual({ logicalReads: 9, authReads: 2 });
    data.options({ showPrices: true, showTotal: true });
    const warm = await data.read(), body = await warm.json();
    expect(body.cards[0].price.amount).toBe(2.5); expect(body.total.amount).toBe(2.5);
    expect(warm.headers.get('cache-control')).toContain('no-store');
    expect(data.counts()).toEqual({ logicalReads: 18, authReads: 4 });
    expect(fetch).toHaveBeenCalledTimes(2); // Price enrichment cannot reuse an unresolved raw entry.
    expect(await (await data.read()).json()).toEqual(body);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(data.counts()).toEqual({ logicalReads: 27, authReads: 6 });
    console.info('PUBLIC_CATALOG_CACHE_SIMULATION raw/prices/warm-prices: provider=1/1/0; private logical reads=9/9/9; no Firestore read reduction');
  });

  it('separates raw and price modes across owners without caching private DTOs or options', async () => {
    const fetch = provider(), a = fixture(), b = fixture('owner-b');
    a.options({ showPrices: true });
    expect((await (await a.read()).json()).cards[0]).toHaveProperty('price');
    const body = await (await b.read()).json(); expect(body.cards[0]).not.toHaveProperty('price');
    expect(JSON.stringify(body)).not.toMatch(/owner-a|PRIVATE_NOTE/); expect(fetch).toHaveBeenCalledTimes(2);
    expect(b.counts().authReads).toBe(2);
    expect(await (await b.read()).json()).toEqual(body); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['revoked', 'owner-denied', 'binder-deleted', 'binder-foreign'])('a warm cache cannot bypass %s', async (mode) => {
    const fetch = provider(), data = fixture(); expect((await data.read()).status).toBe(200);
    if (mode === 'revoked') data.options({ revokedAt: 1 });
    if (mode === 'owner-denied') data.documents.set('accountAccess/owner-a', { appAccess: false });
    if (mode === 'binder-deleted') data.documents.delete(data.binderPath);
    if (mode === 'binder-foreign') data.documents.set(data.binderPath, { ownerUid: 'other', binderId: 'binder' });
    expect((await data.read()).status).toBe(404); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('EN remains an image-only exact-identity fallback (matching=%s)', async (matching) => {
    const fetch = provider((url) => Response.json(url.includes('/de/') ? { ...card, image: undefined } : {
      ...card, id: matching ? card.id : 'sv1-002', name: 'Never borrow English name', image: 'https://assets.tcgdex.net/en/sv/sv1/001',
    }));
    const data = fixture(); const cold = await (await data.read()).json(), warm = await (await data.read()).json();
    expect(warm).toEqual(cold); expect(warm.cards[0].name).toBe('Public card');
    expect(warm.cards[0].image).toBe(matching ? 'https://assets.tcgdex.net/en/sv/sv1/001/high.webp' : null);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['revoked', 'owner-denied', 'binder-deleted'])('final checks still detect %s after initial permission checks on a warm hit', async (mode) => {
    const fetch = provider(), data = fixture(); expect((await data.read()).status).toBe(200);
    data.afterEntries(() => {
      if (mode === 'revoked') data.options({ revokedAt: 1 });
      if (mode === 'owner-denied') data.documents.set('accountAccess/owner-a', { appAccess: false });
      if (mode === 'binder-deleted') data.documents.delete(data.binderPath);
    });
    const result = await data.read(); expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache private collection entries when the public catalog is warm', async () => {
    const fetch = provider(), data = fixture(); expect((await (await data.read()).json()).cards).toHaveLength(1);
    data.entry.deleted = true;
    expect((await (await data.read()).json()).cards).toEqual([]); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('preserves reverse price identity cold and warm (conflict=%s)', async (conflict) => {
    const value = structuredClone(card);
    value.variants_detailed[0].type = 'Reverse Holo';
    value.variants_detailed[0].thirdParty = { cardmarket: conflict ? 43 : 42 };
    value.variants_detailed[0].pricing.cardmarket['trend-holo'] = 7.25;
    const fetch = provider(() => Response.json(value)), data = fixture();
    data.options({ showPrices: true, showTotal: true }); data.entry.finish = 'Reverse Holo';
    const cold = await (await data.read()).json(), warm = await (await data.read()).json();
    expect(warm).toEqual(cold);
    expect(warm.cards[0].price.amount).toBe(conflict ? null : 7.25);
    expect(warm.total.complete).toBe(!conflict);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retains the existing image allowlist after public metadata is cached', async () => {
    const fetch = provider(() => Response.json({ ...card, image: 'https://not-allowed.invalid/card.png' }));
    const data = fixture(); const cold = await (await data.read()).json(), warm = await (await data.read()).json();
    expect(warm).toEqual(cold); expect(warm.cards[0].image).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
