import { createHash, randomUUID } from 'node:crypto';
import { normalizeScannerReport } from '../../lib/scanner-report.ts';
import { actorFor, fail, failure, json, services } from './firebase.mjs';

const types = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
const maxBody = 11 * 1024 * 1024;

async function assertUploadAccess(transaction, context, actor) {
  const [lock, status] = await Promise.all([
    transaction.get(context.db.doc(`accountDeletionLocks/${actor.uid}`)),
    transaction.get(context.db.doc(`accountAccess/${actor.uid}`)),
  ]);
  if (lock.exists) fail('ACCOUNT_DELETING', 403);
  const access = status.data() || {};
  const allowed = (role) => !(role in access) || access[role] === true;
  if (access.disabled === true || !((actor.admin && allowed('admin')) || (actor.pretesterClaim && allowed('pretester')))) fail('ACCESS_DENIED', 403);
}

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
      reviewStatus: 'NEW', referenceCardId: null, referenceCardKey: null, referenceVariant: null, reviewNote: '', reviewedAt: null });
    if (!normalized || Object.keys(normalized.zoneConfidence).length > 64) fail('INVALID_REPORT', 400);
    const { documentId: _id, ...report } = normalized;
    const operation = context.db.doc(`privateUploadOperations/${reportId}`);
    // Durable ownership precedes bytes: interrupted uploads remain discoverable.
    await context.db.runTransaction(async (tx) => {
      await assertUploadAccess(tx, context, actor);
      tx.create(operation, { ownerUid: actor.uid, path, reportId, startedAt: Date.now() });
    });
    const file = context.bucket.file(path);
    try {
      // GCS API, never Firebase getDownloadURL: no public bearer download URL.
      await file.save(bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 }, metadata: {
        contentType: image.type, cacheControl: 'private, no-store',
        metadata: { ownerUid: actor.uid, reportId, captureType: 'MANUAL_CAPTURE', contentSha256: hash },
      } });
      const currentActor = await actorFor(request, context, 'tester');
      await context.db.runTransaction(async (tx) => {
        await assertUploadAccess(tx, context, currentActor);
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
    await actorFor(request, context, 'scannerLab');
    const reportId = (await route.params).reportId;
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(reportId)) fail('INVALID_REQUEST', 400);
    const document = await context.db.doc(`scannerReports/${reportId}`).get();
    const report = document.exists ? normalizeScannerReport({ ...document.data(), documentId: reportId }) : null;
    if (!report?.captureImagePath) fail('NOT_FOUND', 404);
    if (report.captureImagePath !== `scanner-report-images/${reportId}/capture.${types.get(report.imageContentType)}`) fail('REPORT_IMAGE_RELATION_UNSAFE', 409);
    const file = context.bucket.file(report.captureImagePath);
    const [metadata] = await file.getMetadata();
    const ownership = metadata.metadata || {};
    if (!document.get('ownerUid') || ownership.ownerUid !== document.get('ownerUid') || ownership.reportId !== reportId
      || ownership.contentSha256 !== report.imageSha256 || ownership.captureType !== 'MANUAL_CAPTURE'
      || metadata.contentType !== report.imageContentType || Number(metadata.size) !== report.imageSizeBytes
      || ownership.firebaseStorageDownloadTokens) fail('REPORT_IMAGE_RELATION_UNSAFE', 409);
    if (!types.has(metadata.contentType) || Number(metadata.size) > 10 * 1024 * 1024) fail('NOT_FOUND', 404);
    const [bytes] = await file.download({ validation: 'crc32c' });
    const thumbnail = new URL(request.url).searchParams.get('view') === 'thumb';
    const output = thumbnail
      ? await (await import('sharp')).default(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 180, height: 252, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer()
      : bytes;
    return new Response(output, { headers: { 'Content-Type': thumbnail ? 'image/webp' : metadata.contentType, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
  } catch (error) { return failure(error); }
}

export async function deleteReport(request, context = services()) {
  try {
    const actor = await actorFor(request, context, 'admin');
    let input;
    try { input = await request.json(); } catch { fail('INVALID_REQUEST', 400); }
    const reportId = typeof input?.reportId === 'string' ? input.reportId : '';
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(reportId)) fail('INVALID_REQUEST', 400);
    if (input?.confirm !== `DELETE_SCAN_REPORT:${reportId}`) fail('CONFIRMATION_REQUIRED', 400);
    if (Date.now() - actor.authTime > 15 * 60_000) fail('RECENT_LOGIN_REQUIRED', 401);

    const reportReference = context.db.doc(`scannerReports/${reportId}`);
    const document = await reportReference.get();
    if (!document.exists) {
      return json({ ok: true, reportId, alreadyDeleted: true, reportDeleted: false, imageDeleted: false });
    }
    const stored = document.data() || {};
    const report = normalizeScannerReport({ ...stored, documentId: reportId });
    const ownerUid = typeof stored.ownerUid === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(stored.ownerUid) ? stored.ownerUid : null;
    if (!report?.captureImagePath || !report.imageSha256 || !report.imageContentType || !report.imageSizeBytes || !ownerUid) fail('REPORT_IMAGE_RELATION_UNSAFE', 409);

    let imageDeleted = false;
    let imageAlreadyMissing = false;
    const file = context.bucket.file(report.captureImagePath);
    let metadata = null;
    try { [metadata] = await file.getMetadata(); }
    catch (error) {
      if (Number(error?.code) === 404) imageAlreadyMissing = true;
      else throw error;
    }
    if (metadata) {
      const custom = metadata.metadata || {};
      const metadataSafe = custom.reportId === reportId && custom.ownerUid === ownerUid && custom.contentSha256 === report.imageSha256 &&
        custom.captureType === 'MANUAL_CAPTURE' && metadata.contentType === report.imageContentType && Number(metadata.size) === report.imageSizeBytes &&
        !custom.firebaseStorageDownloadTokens && metadata.generation;
      if (!metadataSafe) fail('REPORT_IMAGE_RELATION_UNSAFE', 409);
      try {
        await file.delete({ ignoreNotFound: true, ifGenerationMatch: metadata.generation });
        imageDeleted = true;
      } catch {
        return json({ ok: false, error: 'REPORT_IMAGE_DELETE_FAILED', reportId, reportDeleted: false, imageDeleted: false }, 503);
      }
    }

    const now = new Date().toISOString();
    try {
      await context.db.runTransaction(async (tx) => {
        const latest = await tx.get(reportReference);
        if (!latest.exists) return;
        const value = latest.data() || {};
        if (value.captureImagePath !== report.captureImagePath || value.imageSha256 !== report.imageSha256 || value.ownerUid !== ownerUid) fail('REPORT_CHANGED_DURING_DELETE', 409);
        tx.delete(reportReference);
        tx.create(context.db.doc(`scannerAudit/${randomUUID()}`), {
          action: 'SCAN_REPORT_DELETED', actor: actor.uid, reportId, createdAt: now,
        });
      });
    } catch {
      return json({ ok: false, error: 'PARTIAL_DELETE', reportId, reportDeleted: false, imageDeleted, imageAlreadyMissing, providerRetentionPossible: imageDeleted }, 503);
    }
    return json({ ok: true, reportId, alreadyDeleted: false, reportDeleted: true, imageDeleted, imageAlreadyMissing, providerRetentionPossible: imageDeleted });
  } catch (error) { return failure(error); }
}
