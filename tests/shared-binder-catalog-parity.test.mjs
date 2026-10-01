import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const token = 'C'.repeat(43), sharePath = `privateBinderShares/${createHash('sha256').update(token).digest('hex')}`;
const guideUrl = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
let readBinderShare, cardDetail;
beforeEach(async () => {
  vi.resetModules();
  ({ readBinderShare } = await import('../backend/security/sharing.mjs'));
  ({ GET: cardDetail } = await import('../app/api/cards/[id]/route'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture(id = '30th-c-001', productId = 907940, owner = 'owner-fixture') {
  const setId = id.slice(0, id.lastIndexOf('-')), localId = id.split('-').at(-1);
  const entry = { syncId: 'entry-a', ownerUid: owner, deleted: false, quantity: 7, sourceCardId: id, sourceSetId: setId,
    setId, collectorNumber: localId, language: 'DE', finish: 'Holo', variant: 'Standard',
    externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: productId };
  const binderPath = `users/${owner}/privateBinders/binder-a`;
  const documents = new Map([[sharePath, { ownerUid: owner, binderId: 'binder-a', revokedAt: null, showPrices: true, showTotal: true }],
    [binderPath, { ownerUid: owner, binderId: 'binder-a', name: 'Fixture', deleted: false }],
    [`users/${owner}/collectionEntries/entry-a`, entry]]);
  const snap = (path, fields = null) => ({ id: path.split('/').at(-1), exists: documents.has(path), data: () => {
    const data = documents.get(path);
    return structuredClone(fields === null || data === undefined ? data
      : Object.fromEntries(fields.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]])));
  } });
  const placement = { ownerUid: owner, binderId: 'binder-a', entrySyncId: 'entry-a', slotPosition: 0 };
  const context = { sharingEnabled: true, auth: { getUser: async () => ({ disabled: false, customClaims: { appAccess: true } }) },
    db: { doc: (path) => ({ path, get: async () => snap(path) }),
      getAll: vi.fn(async (...refs) => {
        const fields = Array.isArray(refs.at(-1)?.fieldMask) ? refs.pop().fieldMask : null;
        return refs.map(({ path }) => snap(path, fields));
      }),
      collection: () => ({ where: () => ({ select: (...fields) => ({ limit: () => ({ get: async () => ({ size: 1,
        docs: [{ id: 'placement-a', data: () => Object.fromEntries(fields.filter((key) => Object.hasOwn(placement, key)).map((key) => [key, placement[key]])) }],
      }) }) }) }) }),
    } };
  const raw = { id, localId, name: 'Public fixture', set: { id: setId, name: 'Public set' },
    image: 'https://assets.tcgdex.net/de/example', variants_detailed: [{ type: 'Holo', size: 'Standard' }] };
  const fetch = vi.fn(async (url) => {
    if (String(url) === guideUrl) return Response.json({ createdAt: '2026-09-24T00:00:00Z', priceGuides: [{ idProduct: productId, trend: 5.67 }] });
    if (String(url).startsWith('https://api.tcgdex.net/v2/de/cards/')) return Response.json(raw);
    if (String(url).startsWith('https://api.tcgdex.net/v2/en/cards/')) return new Response(null, { status: 404 });
    throw Error('UNEXPECTED_PROVIDER_FIXTURE');
  });
  vi.stubGlobal('fetch', fetch);
  return { raw, entry, documents, context, fetch,
    guideCalls: () => fetch.mock.calls.filter(([url]) => String(url) === guideUrl),
    flags: (flags) => Object.assign(documents.get(sharePath), flags),
    read: () => readBinderShare(new Request(`http://localhost/api/shared-binders/${token}`), { params: Promise.resolve({ token }) }, context) };
}

describe('actual shared loader matches reviewed normal API enrichment', () => {
  it('uses the same reviewed product and guide timestamp, while warm calls stay cached', async () => {
    const f = fixture();
    const regular = await (await cardDetail(new Request('http://localhost'), { params: Promise.resolve({ id: f.raw.id }) })).json();
    const body = await (await f.read()).json();
    expect(body.cards[0].price).toEqual({ amount: regular.variants_detailed[0].pricing.cardmarket.trend,
      currency: 'EUR', source: 'Cardmarket', asOf: '2026-09-24T00:00:00Z' });
    expect(body.total.amount).toBe(5.67);
    expect(await (await f.read()).json()).toEqual(body);
    expect(f.guideCalls()).toHaveLength(1);
  });
  it('retains a reviewed supplement on upstream404 without broadening the image allowlist', async () => {
    const f = fixture('mep-094', 895609), provider = f.fetch.getMockImplementation();
    f.fetch.mockImplementation((url, options) => String(url) === guideUrl ? provider(url, options) : Promise.resolve(new Response(null, { status: 404 })));
    const body = await (await f.read()).json();
    expect(body.cards).toHaveLength(1); expect(body.unavailableSlots).toEqual([]);
    expect(body.cards[0]).toMatchObject({ cardId: 'mep-094', name: 'Alola-Kokowei', image: null, price: { amount: 5.67 } });
  });
  it.each(['raw-first', 'prices-first'])('keeps privacy-off free of guide and sidecar work with a separate cache mode (%s)', async (order) => {
    const f = fixture();
    if (order === 'raw-first') {
      f.flags({ showPrices: false, showTotal: false });
      expect((await (await f.read()).json()).cards[0].price).toBeUndefined();
      expect(f.guideCalls()).toHaveLength(0);
    }
    f.flags({ showPrices: true, showTotal: true }); expect((await (await f.read()).json()).cards[0].price.amount).toBe(5.67);
    f.flags({ showPrices: false, showTotal: false });
    const body = await (await f.read()).json(); expect(body.cards[0].price).toBeUndefined(); expect(body.total).toBeUndefined();
    expect(f.guideCalls()).toHaveLength(1);
    expect(f.context.db.getAll.mock.calls.flat().filter((ref) => typeof ref.path === 'string' && ref.path.includes('/collectionPriceSelections/'))).toEqual([]);
  });
  it.each([{ subtype: 'Special' }, { stamp: ['Pokémon-Center'] }, { foil: 'Special' },
    { thirdParty: { cardmarket: 123 } }, { pricing: { cardmarket: { idProduct: 123, trend: 999 } } }])(
    'does not lose a printing conflict before deciding eligibility: %j', async (patch) => {
      const f = fixture(); Object.assign(f.raw.variants_detailed[0], patch);
      const body = await (await f.read()).json();
      expect(body.cards[0].price.amount).toBeNull(); expect(f.guideCalls()).toHaveLength(0);
    });
  it('keeps the raw same-printing price when the bounded guide is unavailable', async () => {
    const f = fixture(), provider = f.fetch.getMockImplementation();
    f.raw.variants_detailed[0].pricing = { cardmarket: { idProduct: 907940, trend: 1.23, updated: '2026-09-20', unit: 'EUR' } };
    f.fetch.mockImplementation((url, options) => String(url) === guideUrl ? Promise.resolve(new Response(null, { status: 503 })) : provider(url, options));
    const body = await (await f.read()).json(); expect(body.cards[0].price).toEqual({ amount: 1.23, currency: 'EUR', source: 'Cardmarket', asOf: '2026-09-20' });
  });
  it('retains the 12s consumer limit when a 6s shared guide begins late; no late cache warming', async () => {
    vi.useFakeTimers(); const f = fixture(); let guideSignal;
    f.fetch.mockImplementation(async (url, options) => {
      if (String(url) === guideUrl) {
        guideSignal = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('guide aborted')), { once: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 9000)); return Response.json(f.raw);
    });
    const pending = f.read();
    await vi.advanceTimersByTimeAsync(9000); expect(guideSignal).toBeDefined();
    await vi.advanceTimersByTimeAsync(3000);
    const body = await (await pending).json(); expect(body.cards).toEqual([]); expect(body.unavailableSlots).toEqual([0]);
    // Guide download is shared with other consumers; its existing independent 6s budget remains bounded.
    await vi.advanceTimersByTimeAsync(3000); expect(guideSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    f.fetch.mockImplementation(async (url) => {
      expect(String(url)).not.toBe(guideUrl); // Existing negative guide cache, not a late public-card hit.
      return Response.json(f.raw);
    });
    expect((await (await f.read()).json()).cards).toHaveLength(1);
    expect(f.fetch.mock.calls.filter(([url]) => String(url).startsWith('https://api.tcgdex.net/v2/de/cards/'))).toHaveLength(2);
  });
});
