import { supplementalCard } from '@/lib/catalog-supplement';
import { enrichAnniversaryPrices } from '@/lib/server/cardmarket-anniversary-prices';

const TCGDEX = 'https://api.tcgdex.net/v2/de';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(id)) return Response.json({ error: 'Ungültige Karten-ID.' }, { status: 400 });
  const supplement = supplementalCard(id);
  let response: Response;
  try {
    response = await fetch(`${TCGDEX}/cards/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'DomiDex-Web/1.0-pre-beta' }, signal: AbortSignal.timeout(8_000),
    });
  } catch {
    if (supplement) return Response.json(await enrichAnniversaryPrices(supplement, id), { headers: { 'Cache-Control': 'public, max-age=300' } });
    return Response.json({ error: 'Kartendatenquelle vorübergehend nicht erreichbar.' }, { status: 503 });
  }
  if (!response.ok) {
    if (supplement) return Response.json(await enrichAnniversaryPrices(supplement, id), { headers: { 'Cache-Control': 'public, max-age=300' } });
    return Response.json({ error: 'Karte nicht gefunden.' }, { status: response.status === 404 ? 404 : 502 });
  }
  const card = await response.json() as Record<string, unknown>;
  if (!card.image && supplement) card.image = supplement.image;
  if (!card.image) {
    try {
      const fallback = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'DomiDex-Web/1.0-pre-beta' }, signal: AbortSignal.timeout(5_000),
      });
      if (fallback.ok) card.image = ((await fallback.json()) as { image?: string }).image;
    } catch { /* Exact German identity remains valid without an available image. */ }
  }
  return Response.json(await enrichAnniversaryPrices(card, id), { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600' } });
}
