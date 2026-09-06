import { requireAdminToken } from '@/lib/server/firebase-token';
import { loadLocalScannerBridge, loadScannerIndex } from '@/lib/server/scanner-references';

export async function GET(request: Request) {
  try {
    const authorization = request.headers.get('authorization');
    await requireAdminToken(authorization);
    const requestUrl = new URL(request.url);
    const bridge = await loadLocalScannerBridge(`scanner-references${requestUrl.search}`);
    if (bridge?.ok) return new Response(bridge.body, { status: bridge.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    const index = await loadScannerIndex(authorization);
    if (!index) return Response.json({ connected: false, cards: [], total: 0, stats: null, message: 'Referenzarchiv ist auf diesem Server nicht verbunden.' });
    const url = requestUrl; const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('de');
    const setId = (url.searchParams.get('setId') ?? '').trim().toLowerCase();
    const setQuery = (url.searchParams.get('set') ?? '').trim().toLocaleLowerCase('de');
    const layout = (url.searchParams.get('layoutFamily') ?? '').trim().toLowerCase();
    const category = (url.searchParams.get('category') ?? '').trim().toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(48, Math.max(8, Number(url.searchParams.get('pageSize')) || 24));
    const filtered = index.cards.filter((card) => {
      if (setId && card.setId.toLowerCase() !== setId) return false;
      if (setQuery && !`${card.setId} ${card.setName ?? ''}`.toLocaleLowerCase('de').includes(setQuery)) return false;
      if (layout && card.layoutFamily.toLowerCase() !== layout) return false;
      if (category && card.category?.toLowerCase() !== category) return false;
      return !query || `${card.nameDe} ${card.id} ${card.setId} ${card.setName ?? ''} ${card.localId} ${card.rarity ?? ''}`.toLocaleLowerCase('de').includes(query);
    });
    const start = (page - 1) * pageSize;
    return Response.json({ connected: true, cards: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, stats: index.stats, generatedAt: index.generatedAt });
  } catch (error) { return authError(error); }
}

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return Response.json({ error: message === 'ADMIN_REQUIRED' ? 'Administratorrechte erforderlich.' : 'Anmeldung erforderlich.' }, { status: message === 'ADMIN_REQUIRED' ? 403 : 401 });
}
