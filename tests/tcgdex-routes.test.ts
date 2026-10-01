import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as cardDetail } from '@/app/api/cards/[id]/route';
import { GET as searchCards } from '@/app/api/cards/search/route';
import { GET as setDetail } from '@/app/api/sets/[id]/route';
import { imageUrl } from '@/lib/tcgdex';
import type { TcgCardSummary, TcgSetDetail } from '@/lib/domain';

afterEach(() => vi.unstubAllGlobals());

function requestedUrl(input: string | URL | Request) {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

describe('TCGdex image fallback routes', () => {
  it('loads a missing search image only from the exact English card ID', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestedUrl(input);
      if (url === 'https://api.tcgdex.net/v2/de/cards?name=Pikachu') {
        return Response.json([
          { id: 'sv1-001', localId: '001', name: 'Pikachu' },
          { id: 'sv1-002', localId: '002', name: 'Raichu', image: 'https://assets.tcgdex.net/de/sv/sv1/002' },
        ]);
      }
      if (url === 'https://api.tcgdex.net/v2/en/cards/sv1-001') {
        return Response.json({ id: 'sv1-001', image: 'https://assets.tcgdex.net/en/sv/sv1/001' });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await searchCards(new Request('https://domidex.web.app/api/cards/search?q=Pikachu'));
    const cards = await response.json() as Array<{ id: string; image?: string }>;

    expect(response.status).toBe(200);
    expect(cards.slice(0, 2)).toEqual([
      { id: 'sv1-001', localId: '001', name: 'Pikachu', image: 'https://assets.tcgdex.net/en/sv/sv1/001' },
      { id: 'sv1-002', localId: '002', name: 'Raichu', image: 'https://assets.tcgdex.net/de/sv/sv1/002' },
    ]);
    expect(cards.slice(2).map((card) => card.id)).toEqual(['mep-107', 'mep-109']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => requestedUrl(input))).toContain('https://api.tcgdex.net/v2/en/cards/sv1-001');
    expect(fetchMock.mock.calls.map(([input]) => requestedUrl(input))).not.toContain('https://api.tcgdex.net/v2/en/cards/sv1-002');
  });

  it('does not invent a search image when the exact English card ID has none', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestedUrl(input);
      if (url.startsWith('https://api.tcgdex.net/v2/de/cards?name=')) {
        return Response.json([{ id: 'svp-173', localId: '173', name: 'Evoli' }]);
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await searchCards(new Request('https://domidex.web.app/api/cards/search?q=Evoli'));
    const cards = await response.json() as Array<{ id: string; image?: string }>;

    expect(cards).toEqual([{ id: 'svp-173', localId: '173', name: 'Evoli' }]);
    expect(fetchMock.mock.calls.map(([input]) => requestedUrl(input))).toEqual([
      'https://api.tcgdex.net/v2/de/cards?name=Evoli',
      'https://api.tcgdex.net/v2/en/cards/svp-173',
    ]);
  });

  it('maps set fallback images by exact card ID and ignores similar non-matches', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestedUrl(input);
      if (url === 'https://api.tcgdex.net/v2/de/sets/sv1') {
        return Response.json({
          id: 'sv1',
          cards: [
            { id: 'sv1-001', localId: '001', name: 'Karte Eins' },
            { id: 'sv1-002', localId: '002', name: 'Karte Zwei' },
          ],
        });
      }
      if (url === 'https://api.tcgdex.net/v2/en/sets/sv1') {
        return Response.json({
          id: 'sv1',
          cards: [
            { id: 'sv1-001', image: 'https://assets.tcgdex.net/en/sv/sv1/001' },
            { id: 'other-002', image: 'https://assets.tcgdex.net/en/other/002' },
          ],
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await setDetail(
      new Request('https://domidex.web.app/api/sets/sv1'),
      { params: Promise.resolve({ id: 'sv1' }) },
    );
    const set = await response.json() as { cards: Array<{ id: string; image?: string }> };

    expect(set.cards[0].image).toBe('https://assets.tcgdex.net/en/sv/sv1/001');
    expect(set.cards[1].image).toBeUndefined();
  });

  it('uses the exact English card-detail endpoint and keeps a missing exact fallback empty', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestedUrl(input);
      if (url === 'https://api.tcgdex.net/v2/de/cards/svp-173') {
        return Response.json({ id: 'svp-173', localId: '173', name: 'Evoli' });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await cardDetail(
      new Request('https://domidex.web.app/api/cards/svp-173'),
      { params: Promise.resolve({ id: 'svp-173' }) },
    );
    const card = await response.json() as { id: string; image?: string };

    expect(card).toEqual({ id: 'svp-173', localId: '173', name: 'Evoli' });
    expect(fetchMock.mock.calls.map(([input]) => requestedUrl(input))).toEqual([
      'https://api.tcgdex.net/v2/de/cards/svp-173',
      'https://api.tcgdex.net/v2/en/cards/svp-173',
    ]);
  });

  it('never appends high.webp twice', () => {
    const complete = 'https://assets.tcgdex.net/en/sv/sv1/001/high.webp';
    expect(imageUrl(complete)).toBe(complete);
    expect(imageUrl('https://assets.tcgdex.net/en/sv/sv1/001')).toBe(complete);
  });

  it('adds the three exact RGB identities to set, search and missing detail responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = requestedUrl(input);
      if (url.endsWith('/de/sets/30th')) return Response.json({ id: '30th', name: '30 Jahre', cardCount: { official: 128, total: 158 }, cards: Array.from({ length: 158 }, (_, index) => ({ id: `30th-${String(index + 1).padStart(3, '0')}`, localId: String(index + 1), name: 'Bestandskarte', image: 'https://assets.tcgdex.net/existing' })) });
      if (url.includes('/de/cards?name=')) return Response.json([{ id: '30th-158', localId: '158', name: 'Mew-ex', image: 'https://assets.tcgdex.net/existing' }]);
      return new Response(null, { status: 404 });
    }));
    const setResponse = await setDetail(new Request('https://domidex.web.app/api/sets/30th'), { params: Promise.resolve({ id: '30th' }) });
    const set = await setResponse.json() as TcgSetDetail;
    expect(set.cards).toHaveLength(161); expect(set.cardCount).toEqual({ official: 128, total: 161 });
    const search = await (await searchCards(new Request('https://domidex.web.app/api/cards/search?q=Mew'))).json() as TcgCardSummary[];
    expect(search.filter((card: { id: string }) => card.id.startsWith('30th-rgb-')).map((card: { localId: string }) => card.localId)).toEqual(['R/RGB', 'G/RGB', 'B/RGB']);
    for (const letter of ['r', 'g', 'b']) {
      const result = await cardDetail(new Request(`https://domidex.web.app/api/cards/30th-rgb-${letter}`), { params: Promise.resolve({ id: `30th-rgb-${letter}` }) });
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ id: `30th-rgb-${letter}`, localId: `${letter.toUpperCase()}/RGB`, set: { id: '30th' }, variants_detailed: [{ type: 'Holo' }] });
    }
  });

  it('serves all 17 verified promo details when upstream endpoints are missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    for (let number = 94; number <= 110; number++) {
      const id = `mep-${String(number).padStart(3, '0')}`;
      const response = await cardDetail(new Request(`https://domidex.web.app/api/cards/${id}`), { params: Promise.resolve({ id }) });
      expect(response.status, id).toBe(200);
      expect(await response.json()).toMatchObject({ id, localId: String(number).padStart(3, '0'), rarity: 'Promo', set: { id: 'mep' } });
    }
    const unknown = await cardDetail(new Request('https://domidex.web.app/api/cards/mep-089'), { params: Promise.resolve({ id: 'mep-089' }) });
    expect(unknown.status).toBe(404);
  });

  it('keeps future upstream detail metadata and price variants authoritative', async () => {
    const upstream = { id: 'mep-105', localId: '105', name: 'Mew', image: 'https://assets.tcgdex.net/new', variants_detailed: [{ type: 'Holo', variantId: 'upstream-new', pricing: { cardmarket: { idProduct: 895621, trend: 4 } } }] };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(upstream)));
    const response = await cardDetail(new Request('https://domidex.web.app/api/cards/mep-105'), { params: Promise.resolve({ id: 'mep-105' }) });
    expect(await response.json()).toEqual(upstream);
  });
});
