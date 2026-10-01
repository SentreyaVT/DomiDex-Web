import { requireScannerLabToken } from '@/lib/server/firebase-token';
import { loadLocalScannerBridge, loadReferenceImage, loadRemoteReferenceImage, loadUpstreamReferenceImage } from '@/lib/server/scanner-references';
import { privateOperations } from '@/lib/server/private-cloud-operations';
import { serverFailure } from '@/lib/server/server-failure';

export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  try {
    const authorization = request.headers.get('authorization');
    await requireScannerLabToken(authorization, request);
    const { file } = await context.params;
    const bridge = await loadLocalScannerBridge(`scanner-reference-image/${encodeURIComponent(file)}`);
    if (bridge?.ok) return new Response(bridge.body, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    const serverAuthorization = await (await privateOperations()).serverAuthorization();
    const remote = await loadRemoteReferenceImage(file, serverAuthorization, 'server');
    if (remote?.ok) return new Response(remote.body, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    const image = await loadReferenceImage(file);
    if (image) return new Response(image, { headers: imageHeaders() });
    const upstream = await loadUpstreamReferenceImage(file, serverAuthorization, 'server');
    if (!upstream) return Response.json({ error: 'Referenzbild nicht verfügbar.' }, { status: 404 });
    return new Response(upstream.body, { headers: imageHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'AUTH_REQUIRED' || message === 'SCANNER_LAB_REQUIRED') return Response.json({ error: message === 'SCANNER_LAB_REQUIRED' ? 'Scanner-Lab-Freigabe erforderlich.' : 'Anmeldung erforderlich.' }, { status: message === 'SCANNER_LAB_REQUIRED' ? 403 : 401, headers: { 'Cache-Control': 'private, no-store' } });
    return serverFailure('scanner-reference-image', error, 'Das Referenzbild ist gerade nicht erreichbar. Bitte erneut versuchen.');
  }
}

function imageHeaders() { return { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }; }
