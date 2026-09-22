import { scanReportStatuses, normalizeScannerReport, type ScanReportStatus } from '@/lib/scanner-report';
import { requireAdminToken } from '@/lib/server/firebase-token';
import { serverFailure } from '@/lib/server/server-failure';
import { commitDocuments, countDocuments, getDocument, listDocumentsPage, setWrite } from '@/lib/server/firestore-rest';
import { loadScannerIndex } from '@/lib/server/scanner-references';
import { privateOperations } from '@/lib/server/private-cloud-operations';

export async function GET(request: Request) {
  try {
    await requireAdminToken(requiredAuthorization(request));
    const authorization = await (await privateOperations()).serverAuthorization();
    const url = new URL(request.url);
    const pageSize = Math.min(100, Math.max(12, Number(url.searchParams.get('pageSize')) || 48));
    const pageToken = (url.searchParams.get('pageToken') ?? '').slice(0, 2_048);
    const [page, counted] = await Promise.all([
      listDocumentsPage('scannerReports', authorization, { pageSize, pageToken, orderBy: 'createdAt desc' }),
      countDocuments('scannerReports', authorization).catch(() => null),
    ]);
    const reports = page.documents
      .map((item) => normalizeScannerReport(item))
      .filter((item) => item !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json({ reports, total: counted ?? reports.length, nextPageToken: page.nextPageToken || null });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireAdminToken(requiredAuthorization(request));
    const authorization = await (await privateOperations()).serverAuthorization();
    const body = await request.json() as {
      reportId?: unknown;
      reviewStatus?: unknown;
      reviewNote?: unknown;
      reference?: { id?: unknown; cardKey?: unknown; variant?: unknown } | null;
    };
    const reportId = cleanId(body.reportId);
    if (!reportId) throw new Error('INVALID_REPORT');
    const currentDocument = await getDocument(`scannerReports/${reportId}`, authorization);
    const current = currentDocument ? normalizeScannerReport(currentDocument) : null;
    if (!currentDocument || !current) throw new Error('REPORT_NOT_FOUND');
    const reviewStatus = scanReportStatuses.includes(body.reviewStatus as ScanReportStatus)
      ? body.reviewStatus as ScanReportStatus
      : null;
    if (!reviewStatus) throw new Error('INVALID_STATUS');
    const changesReference = Object.prototype.hasOwnProperty.call(body, 'reference');
    const referenceCardId = body.reference === null ? null : nullableId(body.reference?.id);
    const referenceCardKey = body.reference === null ? null : nullableId(body.reference?.cardKey);
    const referenceVariant = body.reference === null ? null : nullableText(body.reference?.variant, 120);
    if (changesReference && (referenceCardId === null) !== (referenceCardKey === null)) throw new Error('INVALID_REFERENCE');
    if (referenceCardId && referenceCardKey) {
      const index = await loadScannerIndex(authorization);
      const reference = index?.cards.find((item) => item.id === referenceCardId && item.cardKey === referenceCardKey);
      if (!reference) throw new Error(index ? 'INVALID_REFERENCE' : 'REFERENCE_UNAVAILABLE');
      if (referenceVariant && !reference.variants.includes(referenceVariant)) throw new Error('INVALID_VARIANT');
    }
    const now = new Date().toISOString();
    const { documentId: _documentId, ...persistedCurrent } = currentDocument;
    const updated = {
      schemaVersion: 1,
      ...persistedCurrent,
      reviewStatus,
      reviewNote: cleanText(body.reviewNote, 2_000),
      referenceVariant: changesReference ? referenceVariant : current.referenceVariant,
      ...(changesReference ? { referenceCardId, referenceCardKey, referenceVariant } : {}),
      reviewedAt: now,
      reviewedBy: String(actor.sub),
    };
    await commitDocuments([
      setWrite('scannerReports', reportId, updated),
      setWrite('scannerAudit', crypto.randomUUID(), {
        action: 'SCAN_REPORT_REVIEW_UPDATED', actor: String(actor.sub), reportId,
        reviewStatus, referenceCardId: changesReference ? referenceCardId : null,
        referenceVariant: changesReference ? referenceVariant : null, createdAt: now,
      }, true),
    ], authorization);
    return json({ report: normalizeScannerReport({ ...updated, documentId: reportId }) });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  return (await privateOperations()).deleteReport(request);
}

function requiredAuthorization(request: Request) { const value = request.headers.get('authorization'); if (!value) throw new Error('AUTH_REQUIRED'); return value; }
function cleanId(value: unknown) { return typeof value === 'string' ? value.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128) : ''; }
function nullableId(value: unknown) { const id = cleanId(value); return id || null; }
function nullableText(value: unknown, maximum: number) { const text = cleanText(value, maximum); return text || null; }
function cleanText(value: unknown, maximum: number) { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN';
  if (message === 'AUTH_REQUIRED') return json({ error: 'Anmeldung erforderlich.' }, 401);
  if (message === 'ADMIN_REQUIRED') return json({ error: 'Administratorrechte erforderlich.' }, 403);
  const known: Record<string, string> = {
    INVALID_REPORT: 'Ungültiger Scan-Report.', REPORT_NOT_FOUND: 'Scan-Report wurde nicht gefunden.',
    INVALID_STATUS: 'Ungültiger Review-Status.', INVALID_REFERENCE: 'Referenzkarte ist unvollständig oder nicht im Referenzarchiv.',
    INVALID_VARIANT: 'Die gewählte Variante gehört nicht zur Referenzkarte.',
    REFERENCE_UNAVAILABLE: 'Das private Referenzarchiv ist für diese Zuordnung nicht verbunden.',
  };
  if (known[message]) return json({ error: known[message] }, 400);
  return serverFailure('scan-reports', error, 'Fehlscans konnten gerade nicht verarbeitet werden. Bitte erneut versuchen.');
}
