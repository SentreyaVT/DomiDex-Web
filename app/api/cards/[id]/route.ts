const TCGDEX = 'https://api.tcgdex.net/v2/de';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(id)) return Response.json({ error: 'Ungültige Karten-ID.' }, { status: 400 });
  let response: Response;
  try {
    response = await fetch(`${TCGDEX}/cards/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'DomiDex-Web/1.0-pre-beta' }, signal: AbortSignal.timeout(8_000),
    });
  } catch { return Response.json({ error: 'Kartendatenquelle vorübergehend nicht erreichbar.' }, { status: 503 }); }
  if (!response.ok) return Response.json({ error: 'Karte nicht gefunden.' }, { status: response.status === 404 ? 404 : 502 });
  return new Response(await response.text(), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=3600' },
  });
}
