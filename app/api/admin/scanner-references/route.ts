import { requireScannerLabToken } from '@/lib/server/firebase-token';
import { loadLocalScannerBridge, loadScannerIndex } from '@/lib/server/scanner-references';
import { privateOperations } from '@/lib/server/private-cloud-operations';
import { serverFailure } from '@/lib/server/server-failure';

export async function GET(request: Request) {
  try {
    const authorization = request.headers.get('authorization');
    await requireScannerLabToken(authorization, request);
    const requestUrl = new URL(request.url);
    const bridge = await loadLocalScannerBridge(`scanner-references${requestUrl.search}`);
    if (bridge?.ok) return new Response(bridge.body, { status: bridge.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    const serverAuthorization = await (await privateOperations()).serverAuthorization();
    const index = await loadScannerIndex(serverAuthorization, 'server');
    if (!index) return json({ connected: false, cards: [], total: 0, stats: null, message: 'Referenzarchiv ist auf diesem Server nicht verbunden.' });
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
    return json({ connected: true, cards: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, stats: index.stats, generatedAt: index.generatedAt });
  } catch (error) { return authError(error); }
}

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'AUTH_REQUIRED') return json({ error: 'Anmeldung erforderlich.' }, 401);
  if (message === 'SCANNER_LAB_REQUIRED') return json({ error: 'Scanner-Lab-Freigabe erforderlich.' }, 403);
  return serverFailure('scanner-references', error, 'Die Kartenreferenzen sind gerade nicht erreichbar. Bitte erneut versuchen.');
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
