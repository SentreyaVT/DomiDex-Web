import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exactCardmarketProductId, exactTrendPrice, type TcgCardDetail } from '@/lib/domain';
import { anniversaryProducts } from '@/lib/server/cardmarket-anniversary-products';

const GUIDE = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
type Fields = Record<string, unknown>;
let enrich: typeof import('@/lib/server/cardmarket-anniversary-prices').enrichAnniversaryPrices;
const requestedUrl = (input: string | URL | Request) => typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

beforeEach(async () => {
  vi.resetModules();
  enrich = (await import('@/lib/server/cardmarket-anniversary-prices')).enrichAnniversaryPrices;
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function card(id = '30th-129', variant: Fields = {}, extra: Fields = {}) {
  return {
    id, localId: id.includes('-rgb-') ? `${id.slice(-1).toUpperCase()}/RGB` : id.slice(id.lastIndexOf('-') + 1),
    name: 'Unveränderter deutscher Kartenname', set: { id: id.startsWith('30th-c-') ? '30th-c' : id.startsWith('mep-') ? 'mep' : '30th', name: 'Quellset' },
    variants_detailed: [{ variantId: 'source-variant', type: 'holo', size: 'standard', ...variant } as Fields], ...extra,
  };
}
function mockGuide(rows: Fields[]) {
  const fetch = vi.fn(async (input: string | URL | Request) => {
    expect(requestedUrl(input)).toBe(GUIDE);
    return Response.json({ createdAt: '2026-09-23T08:00:00Z', priceGuides: rows });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function valued(source: ReturnType<typeof card>) {
  return await enrich(source, source.id) as unknown as TcgCardDetail;
}

describe('reviewed anniversary product identities', () => {
  it('mirrors 158 main, 23 Classic, 3 RGB and 14 existing MEP exact bridges', () => {
    expect(Object.keys(anniversaryProducts)).toHaveLength(198);
    for (let number = 1; number <= 158; number++) expect(anniversaryProducts[`30th-${String(number).padStart(3, '0')}`]).toBeGreaterThan(0);
    expect(new Set(Object.values(anniversaryProducts)).size).toBe(198);
    expect(anniversaryProducts['30th-010']).toBe(907736);
    expect(anniversaryProducts['30th-143']).toBe(908352);
    expect(anniversaryProducts['30th-151']).toBe(908353);
    expect(anniversaryProducts['30th-c-014']).toBe(907939);
    expect(anniversaryProducts['mep-101']).toBeUndefined();
  });

  it('keeps base, SAR and FUR products and their guide values distinct', async () => {
    const fetch = mockGuide([
      { idProduct: 907608, trend: 1.11 }, { idProduct: 907737, trend: 22.22 }, { idProduct: 907758, trend: 333.33 },
    ]);
    const cards = await Promise.all(['30th-002', '30th-129', '30th-153'].map((id) => valued(card(id))));
    expect(cards.map((item) => exactCardmarketProductId(item, item.variants_detailed![0]))).toEqual([907608, 907737, 907758]);
    expect(cards.map((item) => exactTrendPrice(item, item.variants_detailed![0]))).toEqual([1.11, 22.22, 333.33]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves source labels, identifiers, type and metadata while linking ordinary printings', async () => {
    mockGuide([{ idProduct: 907737, trend: 12.34 }]);
    const original = card('30th-129', { stamp: [], foil: null, subtype: null, thirdParty: { cardmarket: 907737 }, type: 'Holo', size: 'Standard' }, { rarity: 'Special Illustration Rare' });
    const saved = structuredClone(original);
    const result = await enrich(original, original.id);
    expect(original).toEqual(saved);
    expect(result).toMatchObject(saved);
    expect(result.variants_detailed[0]).toMatchObject({ pricing: { cardmarket: { idProduct: 907737, trend: 12.34, unit: 'EUR', updated: '2026-09-23T08:00:00Z' } } });
  });

  it.each([
    { stamp: ['Pokémon-Center'] }, { stamp: 'Pokémon-Center' }, { foil: 'Cosmos' }, { subtype: 'First Edition' },
    { size: 'Jumbo' }, { size: 'Standard · Stempel: Pokémon-Center' }, { type: 'Unknown' },
    { thirdParty: { cardmarket: 123456 } }, { pricing: { cardmarket: { idProduct: 123456 } } },
    { pricing: { cardmarket: { idProduct: 907737, unit: 'USD' } } },
  ])('never attaches an ordinary bridge to foreign products or special printing %j', async (variant) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const original = card('30th-129', variant);
    expect(await enrich(original, original.id)).toBe(original);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses a coherent guide snapshot including null trends and date while preserving identity and other metadata', async () => {
    mockGuide([{ idProduct: 907737, trend: null, 'trend-holo': 4 }]);
    const source = card('30th-129', { pricing: { otherSource: { value: 5 }, cardmarket: { idProduct: 907737, trend: 8.5, 'trend-holo': 9, unit: 'EUR', updated: 'source-date' } } });
    const result = await valued(source);
    expect(result.variants_detailed![0].pricing).toEqual({ otherSource: { value: 5 }, cardmarket: { idProduct: 907737, trend: null, 'trend-holo': 4, unit: 'EUR', updated: '2026-09-23T08:00:00Z' } });
    expect(exactTrendPrice(result, result.variants_detailed![0])).toBeNull();
  });

  it('preserves legitimate source pricing when the guide has no matching row', async () => {
    mockGuide([]);
    const source = card('30th-129', { pricing: { cardmarket: { idProduct: 907737, trend: 8.5, unit: 'EUR', updated: 'source-date' } } });
    const result = await valued(source);
    expect(result.variants_detailed![0].pricing).toEqual(source.variants_detailed[0].pricing);
  });

  it('does not invent a guide timestamp by retaining an older source date', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ priceGuides: [{ idProduct: 907737, trend: 3 }] })));
    const source = card('30th-129', { pricing: { cardmarket: { idProduct: 907737, trend: 8.5, updated: 'source-date' } } });
    const result = await valued(source);
    expect(result.variants_detailed![0].pricing?.cardmarket).toEqual({ idProduct: 907737, trend: 3, 'trend-holo': null, unit: 'EUR' });
  });

  it('keeps stamped variants separate when an ordinary printing receives its guide price', async () => {
    mockGuide([{ idProduct: 907737, trend: 12.34 }]);
    const special = { variantId: 'stamped', type: 'Holo', size: 'Standard', stamp: ['Pokémon-Center'] };
    const source = card('30th-129', {}, { variants_detailed: [card().variants_detailed[0], special] });
    const result = await valued(source);
    expect(exactTrendPrice(result, result.variants_detailed![0])).toBe(12.34);
    expect(result.variants_detailed![1]).toEqual(special);
    expect(exactCardmarketProductId(result, result.variants_detailed![1])).toBeNull();
  });

  it('requires requested ID, upstream ID, set and printed number to agree', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const source of [card('30th-129', {}, { id: '30th-130' }), card('30th-129', {}, { set: { id: 'other' } }), card('30th-129', {}, { localId: '130' })]) {
      expect(await enrich(source, '30th-129')).toBe(source);
    }
    const foreign = card('sv08-129');
    expect(await enrich(foreign, foreign.id)).toBe(foreign);
    const unknownPromo = card('mep-101');
    expect(await enrich(unknownPromo, unknownPromo.id)).toBe(unknownPromo);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('guide values and bounds', () => {
  it.each([undefined, null, 0, -1, '23.45'])('keeps missing or unusable guide trend %j unavailable', async (trend) => {
    mockGuide([{ idProduct: 907737, trend, avg: 10, low: 8, 'trend-holo': 99 }]);
    const result = await valued(card());
    expect(exactCardmarketProductId(result, result.variants_detailed![0])).toBe(907737);
    expect(exactTrendPrice(result, result.variants_detailed![0])).toBeNull();
  });

  it('never borrows regular guide trend for Reverse Holo', async () => {
    mockGuide([{ idProduct: 907737, trend: 45, 'trend-holo': null }]);
    const result = await valued(card('30th-129', { type: 'Reverse Holo' }));
    expect(exactTrendPrice(result, result.variants_detailed![0])).toBeNull();
  });

  it('uses only the explicit Reverse Holo guide field', async () => {
    mockGuide([{ idProduct: 907737, trend: 45, 'trend-holo': 7.89 }]);
    const result = await valued(card('30th-129', { type: 'Reverse Holo' }));
    expect(exactTrendPrice(result, result.variants_detailed![0])).toBe(7.89);
  });

  it('leaves absent and duplicate guide products without a numeric price', async () => {
    mockGuide([{ idProduct: 907737, trend: 2 }, { idProduct: 907737, trend: 9 }, { idProduct: 123456, trend: 100 }]);
    for (const id of ['30th-129', '30th-130']) {
      const result = await valued(card(id));
      expect(exactTrendPrice(result, result.variants_detailed![0])).toBeNull();
    }
  });

  it('caches successful downloads for one hour and retries after expiry', async () => {
    vi.useFakeTimers();
    const fetch = mockGuide([{ idProduct: 907737, trend: 2 }]);
    await valued(card()); await valued(card());
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1);
    await valued(card()); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses a short failure cache and leaves exact identities intact during outages', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => { throw new Error('offline'); }); vi.stubGlobal('fetch', fetch);
    const result = await valued(card()); await valued(card());
    expect(exactCardmarketProductId(result, result.variants_detailed![0])).toBe(907737);
    expect(exactTrendPrice(result, result.variants_detailed![0])).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_001); await valued(card()); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized guide responses before consuming them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'Content-Length': String(33 * 1024 * 1024) } })));
    const result = await valued(card());
    expect(exactTrendPrice(result, result.variants_detailed![0])).toBeNull();
  });

  it('bounds chunked guide bodies without relying on Content-Length', async () => {
    const cancel = vi.fn(), chunk = new Uint8Array(1024 * 1024);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(chunk); }, cancel,
    }))));
    const result = await valued(card());
    expect(exactTrendPrice(result, result.variants_detailed![0])).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds a stalled download independently of fetch signal support', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const result = valued(card());
    await vi.advanceTimersByTimeAsync(6_001);
    const finished = await result;
    expect(exactTrendPrice(finished, finished.variants_detailed![0])).toBeNull();
  });
});

describe('existing card-detail route integration', () => {
  it('enriches upstream details and supplemental MEP/RGB fallbacks through the same public guide', async () => {
    const rows = [{ idProduct: 907737, trend: 12.34 }, { idProduct: 895609, trend: 2.5 }, { idProduct: 909509, trend: 55 }];
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = requestedUrl(input);
      if (url === GUIDE) return Response.json({ priceGuides: rows });
      if (url.endsWith('/de/cards/30th-129')) return Response.json({ ...card(), image: 'https://assets.tcgdex.net/source' });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    const { GET } = await import('@/app/api/cards/[id]/route');
    for (const [id, expected] of [['30th-129', 12.34], ['mep-094', 2.5], ['30th-rgb-r', 55]] as const) {
      const response = await GET(new Request(`https://domidex.web.app/api/cards/${id}`), { params: Promise.resolve({ id }) });
      const detail = await response.json() as TcgCardDetail;
      expect(detail.id).toBe(id);
      expect(exactTrendPrice(detail, detail.variants_detailed![0])).toBe(expected);
    }
    expect(fetch.mock.calls.filter(([url]) => requestedUrl(url) === GUIDE)).toHaveLength(1);
  });
});
