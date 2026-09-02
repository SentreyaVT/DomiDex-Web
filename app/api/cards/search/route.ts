const TCGDEX = 'https://api.tcgdex.net/v2/de';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (query.length < 2 || query.length > 80) return Response.json([], { status: 200 });
  let response: Response;
  try {
    response = await fetch(`${TCGDEX}/cards?name=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'DomiDex-Web/1.0-pre-beta' }, signal: AbortSignal.timeout(8_000),
    });
  } catch { return Response.json({ error: 'Kartensuche vorübergehend nicht erreichbar.' }, { status: 503 }); }
  if (!response.ok) return Response.json({ error: 'Kartensuche nicht verfügbar.' }, { status: 502 });
  const cards = await response.json() as Array<{ id?: string; localId?: string; name?: string; image?: string }>;
  const safe = cards.slice(0, 40).flatMap((card) => card.id && card.name ? [{
    id: card.id,
    localId: card.localId ?? '',
    name: card.name,
    image: card.image,
  }] : []);
  return Response.json(safe, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=600' } });
}
