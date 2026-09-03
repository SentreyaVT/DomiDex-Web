import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as cardDetail } from '@/app/api/cards/[id]/route';
import { GET as searchCards } from '@/app/api/cards/search/route';
import { GET as setDetail } from '@/app/api/sets/[id]/route';
import { imageUrl } from '@/lib/tcgdex';

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
    expect(cards).toEqual([
      { id: 'sv1-001', localId: '001', name: 'Pikachu', image: 'https://assets.tcgdex.net/en/sv/sv1/001' },
      { id: 'sv1-002', localId: '002', name: 'Raichu', image: 'https://assets.tcgdex.net/de/sv/sv1/002' },
    ]);
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
});
