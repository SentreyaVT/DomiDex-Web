const base = 'https://api.tcgdex.net/v2/de/sets';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) return Response.json({ error: 'Ungültige Set-ID.' }, { status: 400 });
  let response: Response;
  try {
    response = await fetch(`${base}/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, next: { revalidate: 3600 }, signal: AbortSignal.timeout(8_000) });
  } catch { return Response.json({ error: 'Set-Datenquelle vorübergehend nicht erreichbar.' }, { status: 503 }); }
  if (!response.ok) return Response.json({ error: 'Set nicht verfügbar.' }, { status: response.status });
  const set = await response.json() as { cards?: Array<{ id?: string; image?: string }> };
  if (set.cards?.some((card) => !card.image)) {
    try {
      const fallback = await fetch(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, next: { revalidate: 3600 }, signal: AbortSignal.timeout(5_000) });
      if (fallback.ok) {
        const english = await fallback.json() as { cards?: Array<{ id?: string; image?: string }> };
        const images = new Map((english.cards ?? []).filter((card) => card.id && card.image).map((card) => [card.id!, card.image!]));
        set.cards = set.cards.map((card) => card.image ? card : { ...card, image: card.id ? images.get(card.id) : undefined });
      }
    } catch { /* Cards without an official image remain explicitly image-less. */ }
  }
  return Response.json(set, { headers: { 'Cache-Control': 'public, max-age=900, stale-while-revalidate=3600' } });
}
