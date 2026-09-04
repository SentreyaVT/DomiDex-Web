import { createHash, randomUUID } from 'node:crypto';
import { normalizeScannerReport } from '../../lib/scanner-report.ts';
import { actorFor, fail, failure, json, services } from './firebase.mjs';

const types = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
const maxBody = 11 * 1024 * 1024;

async function boundedForm(request) {
  if (Number(request.headers.get('content-length') || 0) > maxBody) fail('IMAGE_TOO_LARGE', 413);
  if (!request.body) fail('INVALID_REPORT', 400);
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBody) { await reader.cancel(); fail('IMAGE_TOO_LARGE', 413); }
    chunks.push(value);
  }
  try { return await new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData(); }
  catch { fail('INVALID_REPORT', 400); }
}

export async function uploadReport(request, context = services()) {
  try {
    const actor = await actorFor(request, context, 'tester');
    const form = await boundedForm(request);
    const image = form.get('image');
    const payload = form.get('report');
    if (!(image instanceof File) || typeof payload !== 'string') fail('INVALID_REPORT', 400);
    const extension = types.get(image.type);
    if (!extension) fail('INVALID_IMAGE_TYPE', 415);
    if (!image.size || image.size > 10 * 1024 * 1024) fail('IMAGE_TOO_LARGE', 413);
    let input;
    try { input = JSON.parse(payload); } catch { fail('INVALID_REPORT', 400); }
    if (!input || Array.isArray(input) || input.captureType !== 'MANUAL_CAPTURE') fail('INVALID_REPORT', 400);
    const reportId = randomUUID();
    const path = `scanner-report-images/${reportId}/capture.${extension}`;
    const bytes = Buffer.from(await image.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    const normalized = normalizeScannerReport({ ...input, documentId: reportId, createdAt: new Date().toISOString(),
      captureImagePath: path, imageSha256: hash, imageContentType: image.type, imageSizeBytes: bytes.length,
      reviewStatus: 'NEW', referenceCardId: null, referenceCardKey: null, reviewNote: '', reviewedAt: null });
    if (!normalized || Object.keys(normalized.zoneConfidence).length > 64) fail('INVALID_REPORT', 400);
    const { documentId: _id, ...report } = normalized;
    const lock = context.db.doc(`accountDeletionLocks/${actor.uid}`);
    const operation = context.db.doc(`privateUploadOperations/${reportId}`);
    // Durable ownership precedes bytes: interrupted uploads remain discoverable.
    await context.db.runTransaction(async (tx) => {
      if ((await tx.get(lock)).exists) fail('ACCOUNT_DELETING', 403);
      tx.create(operation, { ownerUid: actor.uid, path, reportId, startedAt: Date.now() });
    });
    const file = context.bucket.file(path);
    try {
      // GCS API, never Firebase getDownloadURL: no public bearer download URL.
      await file.save(bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 }, metadata: {
        contentType: image.type, cacheControl: 'private, no-store',
        metadata: { ownerUid: actor.uid, reportId, captureType: 'MANUAL_CAPTURE', contentSha256: hash },
      } });
      await context.db.runTransaction(async (tx) => {
        if ((await tx.get(lock)).exists) fail('ACCOUNT_DELETING', 403);
        tx.create(context.db.doc(`scannerReports/${reportId}`), { schemaVersion: 1, ...report, ownerUid: actor.uid });
        tx.delete(operation);
      });
    } catch (error) {
      // A timed-out commit may actually have succeeded. Never delete its valid image.
      const committed = await context.db.doc(`scannerReports/${reportId}`).get();
      if (committed.exists && committed.get('ownerUid') === actor.uid && committed.get('imageSha256') === hash) {
        return json({ ok: true, reportId, reviewStatus: 'NEW' }, 201);
      }
      // If cleanup fails, retain the durable ownership operation for reconciliation.
      try { await file.delete({ ignoreNotFound: true }); await operation.delete(); } catch { /* operation remains */ }
      throw error;
    }
    return json({ ok: true, reportId, reviewStatus: 'NEW' }, 201);
  } catch (error) { return failure(error); }
}

export async function readReportImage(request, route, context = services()) {
  try {
    await actorFor(request, context, 'admin');
    const reportId = (await route.params).reportId;
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(reportId)) fail('INVALID_REQUEST', 400);
    const document = await context.db.doc(`scannerReports/${reportId}`).get();
    const report = document.exists ? normalizeScannerReport({ ...document.data(), documentId: reportId }) : null;
    if (!report?.captureImagePath) fail('NOT_FOUND', 404);
    const file = context.bucket.file(report.captureImagePath);
    const [metadata] = await file.getMetadata();
    if (!types.has(metadata.contentType) || Number(metadata.size) > 10 * 1024 * 1024) fail('NOT_FOUND', 404);
    const [bytes] = await file.download({ validation: 'crc32c' });
    return new Response(bytes, { headers: { 'Content-Type': metadata.contentType, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
  } catch (error) { return failure(error); }
}
