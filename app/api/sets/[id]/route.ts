const base = 'https://api.tcgdex.net/v2/de/sets';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) return Response.json({ error: 'Ungültige Set-ID.' }, { status: 400 });
  const response = await fetch(`${base}/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, next: { revalidate: 3600 } });
  if (!response.ok) return Response.json({ error: 'Set nicht verfügbar.' }, { status: response.status });
  const set = await response.json() as { cards?: unknown[] };
  return Response.json(set, { headers: { 'Cache-Control': 'public, max-age=900, stale-while-revalidate=3600' } });
}
