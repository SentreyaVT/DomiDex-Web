import { requireAdminToken } from '@/lib/server/firebase-token';
import { loadLocalScannerBridge, loadReferenceImage, loadRemoteReferenceImage, loadUpstreamReferenceImage } from '@/lib/server/scanner-references';

export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  try {
    const authorization = request.headers.get('authorization');
    await requireAdminToken(authorization);
    const { file } = await context.params;
    const bridge = await loadLocalScannerBridge(`scanner-reference-image/${encodeURIComponent(file)}`);
    if (bridge?.ok) return new Response(bridge.body, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    const remote = authorization ? await loadRemoteReferenceImage(file, authorization) : null;
    if (remote?.ok) return new Response(remote.body, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    const image = await loadReferenceImage(file);
    if (image) return new Response(image, { headers: imageHeaders() });
    const upstream = authorization ? await loadUpstreamReferenceImage(file, authorization) : null;
    if (!upstream) return Response.json({ error: 'Referenzbild nicht verfügbar.' }, { status: 404 });
    return new Response(upstream.body, { headers: imageHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({ error: message === 'ADMIN_REQUIRED' ? 'Administratorrechte erforderlich.' : 'Anmeldung erforderlich.' }, { status: message === 'ADMIN_REQUIRED' ? 403 : 401 });
  }
}

function imageHeaders() { return { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }; }
