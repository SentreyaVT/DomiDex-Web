import { normalizeScannerReport } from '@/lib/scanner-report';
import { requirePretesterToken } from '@/lib/server/firebase-token';
import { commitDocuments, setWrite } from '@/lib/server/firestore-rest';
import { uploadFirebaseStorageObject } from '@/lib/server/firebase-storage-rest';

const imageTypes = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);

export async function POST(request: Request) {
  try {
    const authorization = requiredAuthorization(request);
    const actor = await requirePretesterToken(authorization);
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > 11 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
    const form = await request.formData();
    const image = form.get('image');
    const payloadValue = form.get('report');
    if (!(image instanceof File) || typeof payloadValue !== 'string') throw new Error('INVALID_REPORT');
    const extension = imageTypes.get(image.type);
    if (!extension) throw new Error('INVALID_IMAGE_TYPE');
    if (image.size < 1 || image.size > 10 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
    const input = parseReportPayload(payloadValue);
    if (input.captureType !== 'MANUAL_CAPTURE') throw new Error('MANUAL_ONLY');
    const reportId = crypto.randomUUID();
    const path = `scanner-report-images/${reportId}/capture.${extension}`;
    const bytes = new Uint8Array(await image.arrayBuffer());
    const imageSha256 = await sha256(bytes);
    const normalized = normalizeScannerReport({
      ...input,
      documentId: reportId,
      scanId: cleanId(input.scanId) || reportId,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      captureType: 'MANUAL_CAPTURE',
      captureImagePath: path,
      imageSha256,
      imageContentType: image.type,
      imageSizeBytes: image.size,
      reviewStatus: 'NEW',
      referenceCardId: null,
      referenceCardKey: null,
      reviewNote: '',
      reviewedAt: null,
    });
    if (!normalized) throw new Error('INVALID_REPORT');
    const { documentId: _documentId, ...report } = normalized;
    await uploadFirebaseStorageObject(path, bytes, image.type, {
      ownerUid: String(actor.sub), reportId, captureType: 'MANUAL_CAPTURE', contentSha256: imageSha256,
    }, authorization);
    await commitDocuments([setWrite('scannerReports', reportId, { schemaVersion: 1, ...report }, true)], authorization);
    return json({ ok: true, reportId, reviewStatus: 'NEW' }, 201);
  } catch (error) { return errorResponse(error); }
}

function parseReportPayload(value: string) { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { throw new Error('INVALID_REPORT'); } }
function requiredAuthorization(request: Request) { const value = request.headers.get('authorization'); if (!value) throw new Error('AUTH_REQUIRED'); return value; }
function cleanId(value: unknown) { return typeof value === 'string' ? value.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128) : ''; }
async function sha256(value: Uint8Array<ArrayBuffer>) { const digest = await crypto.subtle.digest('SHA-256', value); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN';
  if (message === 'AUTH_REQUIRED') return json({ error: 'Anmeldung erforderlich.' }, 401);
  if (message === 'PRETESTER_REQUIRED') return json({ error: 'Pretester- oder Administratorrechte erforderlich.' }, 403);
  if (message === 'MANUAL_ONLY') return json({ error: 'Dieser sichere Feedbackpfad akzeptiert ausschließlich MANUAL_CAPTURE.' }, 400);
  if (message === 'INVALID_IMAGE_TYPE') return json({ error: 'Nur JPEG-, PNG- oder WebP-Bilder sind erlaubt.' }, 415);
  if (message === 'IMAGE_TOO_LARGE') return json({ error: 'Das Bild darf höchstens 10 MB groß sein.' }, 413);
  if (message === 'INVALID_REPORT') return json({ error: 'Ungültiger technischer Scan-Report.' }, 400);
  return json({ error: 'Der Fehlscan konnte nicht sicher gespeichert werden.' }, 502);
}
