import { normalizeScannerReport } from '@/lib/scanner-report';
import { requireAdminToken } from '@/lib/server/firebase-token';
import { getDocument } from '@/lib/server/firestore-rest';
import { readFirebaseStorageObject } from '@/lib/server/firebase-storage-rest';

export async function GET(request: Request, context: { params: Promise<{ reportId: string }> }) {
  try {
    const authorization = request.headers.get('authorization');
    await requireAdminToken(authorization);
    const reportId = cleanId((await context.params).reportId);
    if (!reportId) return Response.json({ error: 'Ungültiger Report.' }, { status: 400 });
    const document = await getDocument(`scannerReports/${reportId}`, authorization!);
    const report = document ? normalizeScannerReport(document) : null;
    if (!report?.captureImagePath) return Response.json({ error: 'Kein privates Fehlscan-Bild vorhanden.' }, { status: 404 });
    const image = await readFirebaseStorageObject(report.captureImagePath, authorization!);
    if (!image?.ok) return Response.json({ error: 'Privates Fehlscan-Bild nicht verfügbar.' }, { status: 404 });
    return new Response(image.body, {
      headers: {
        'Content-Type': report.imageContentType ?? 'application/octet-stream',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN';
    const status = message === 'AUTH_REQUIRED' ? 401 : message === 'ADMIN_REQUIRED' ? 403 : 500;
    return Response.json({ error: status === 401 ? 'Anmeldung erforderlich.' : status === 403 ? 'Administratorrechte erforderlich.' : 'Bild konnte nicht geladen werden.' }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

function cleanId(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : ''; }
