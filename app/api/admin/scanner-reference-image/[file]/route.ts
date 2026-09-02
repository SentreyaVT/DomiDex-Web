import { requireAdminToken } from '@/lib/server/firebase-token';
import { loadLocalScannerBridge, loadReferenceImage } from '@/lib/server/scanner-references';

export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  try {
    await requireAdminToken(request.headers.get('authorization'));
    const { file } = await context.params;
    const bridge = await loadLocalScannerBridge(`scanner-reference-image/${encodeURIComponent(file)}`);
    if (bridge?.ok) return new Response(bridge.body, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    const image = await loadReferenceImage(file);
    if (!image) return Response.json({ error: 'Referenzbild nicht verfügbar.' }, { status: 404 });
    return new Response(image, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({ error: message === 'ADMIN_REQUIRED' ? 'Administratorrechte erforderlich.' : 'Anmeldung erforderlich.' }, { status: message === 'ADMIN_REQUIRED' ? 403 : 401 });
  }
}
