import { scanReportStatuses, normalizeScannerReport, type ScanReportStatus } from '@/lib/scanner-report';
import { requireAdminToken } from '@/lib/server/firebase-token';
import { commitDocuments, getDocument, listDocuments, setWrite } from '@/lib/server/firestore-rest';
import { loadScannerIndex } from '@/lib/server/scanner-references';

export async function GET(request: Request) {
  try {
    const authorization = requiredAuthorization(request);
    await requireAdminToken(authorization);
    const reports = (await listDocuments('scannerReports', authorization))
      .map((item) => normalizeScannerReport(item))
      .filter((item) => item !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json({ reports, total: reports.length });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const authorization = requiredAuthorization(request);
    const actor = await requireAdminToken(authorization);
    const body = await request.json() as {
      reportId?: unknown;
      reviewStatus?: unknown;
      reviewNote?: unknown;
      reference?: { id?: unknown; cardKey?: unknown } | null;
    };
    const reportId = cleanId(body.reportId);
    if (!reportId) throw new Error('INVALID_REPORT');
    const currentDocument = await getDocument(`scannerReports/${reportId}`, authorization);
    const current = currentDocument ? normalizeScannerReport(currentDocument) : null;
    if (!current) throw new Error('REPORT_NOT_FOUND');
    const reviewStatus = scanReportStatuses.includes(body.reviewStatus as ScanReportStatus)
      ? body.reviewStatus as ScanReportStatus
      : null;
    if (!reviewStatus) throw new Error('INVALID_STATUS');
    const changesReference = Object.prototype.hasOwnProperty.call(body, 'reference');
    const referenceCardId = body.reference === null ? null : nullableId(body.reference?.id);
    const referenceCardKey = body.reference === null ? null : nullableId(body.reference?.cardKey);
    if (changesReference && (referenceCardId === null) !== (referenceCardKey === null)) throw new Error('INVALID_REFERENCE');
    if (referenceCardId && referenceCardKey) {
      const index = await loadScannerIndex(authorization);
      const reference = index?.cards.find((item) => item.id === referenceCardId && item.cardKey === referenceCardKey);
      if (!reference) throw new Error(index ? 'INVALID_REFERENCE' : 'REFERENCE_UNAVAILABLE');
    }
    const now = new Date().toISOString();
    const { documentId: _documentId, ...persistedCurrent } = current;
    const updated = {
      schemaVersion: 1,
      ...persistedCurrent,
      reviewStatus,
      reviewNote: cleanText(body.reviewNote, 2_000),
      ...(changesReference ? { referenceCardId, referenceCardKey } : {}),
      reviewedAt: now,
      reviewedBy: String(actor.sub),
    };
    await commitDocuments([
      setWrite('scannerReports', reportId, updated),
      setWrite('scannerAudit', crypto.randomUUID(), {
        action: 'SCAN_REPORT_REVIEW_UPDATED', actor: String(actor.sub), reportId,
        reviewStatus, referenceCardId: changesReference ? referenceCardId : null, createdAt: now,
      }, true),
    ], authorization);
    return json({ report: normalizeScannerReport({ ...updated, documentId: reportId }) });
  } catch (error) { return errorResponse(error); }
}

function requiredAuthorization(request: Request) { const value = request.headers.get('authorization'); if (!value) throw new Error('AUTH_REQUIRED'); return value; }
function cleanId(value: unknown) { return typeof value === 'string' ? value.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128) : ''; }
function nullableId(value: unknown) { const id = cleanId(value); return id || null; }
function cleanText(value: unknown, maximum: number) { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN';
  if (message === 'AUTH_REQUIRED') return json({ error: 'Anmeldung erforderlich.' }, 401);
  if (message === 'ADMIN_REQUIRED') return json({ error: 'Administratorrechte erforderlich.' }, 403);
  const known: Record<string, string> = {
    INVALID_REPORT: 'Ungültiger Scan-Report.', REPORT_NOT_FOUND: 'Scan-Report wurde nicht gefunden.',
    INVALID_STATUS: 'Ungültiger Review-Status.', INVALID_REFERENCE: 'Referenzkarte ist unvollständig oder nicht im Referenzarchiv.',
    REFERENCE_UNAVAILABLE: 'Das private Referenzarchiv ist für diese Zuordnung nicht verbunden.',
  };
  return json({ error: known[message] ?? 'Scan-Report konnte nicht verarbeitet werden.' }, 400);
}
