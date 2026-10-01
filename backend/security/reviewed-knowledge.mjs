import { actorFor, fail, failure, json, services } from './firebase.mjs';
import { normalizeKnowledgeContext, normalizeRecognitionReference } from '../../lib/scanner-feedback.ts';

/** Private report stays the source of truth: re-review/delete withdraws the hint. */
export async function readReviewedKnowledge(request, context = services()) {
  try {
    await actorFor(request, context, 'tester');
    if (!request.body) fail('INVALID_REQUEST', 400);
    const reader = request.body.getReader();
    let length = 0; const chunks = [];
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 1024) { await reader.cancel(); fail('REQUEST_TOO_LARGE', 413); }
      chunks.push(value);
    }
    let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('INVALID_REQUEST', 400); }
    const key = normalizeKnowledgeContext({ ...input, schemaVersion: 1 });
    if (!key) fail('INVALID_REQUEST', 400);
    const snapshot = await context.db.collection('scannerReports')
      .where('knowledgeContext.fingerprint', '==', key.fingerprint).limit(51).get();
    // No partial choice when the bounded query cannot establish consensus.
    if (snapshot.docs.length > 50) return json({ ok: true, hint: null });
    const identities = new Map();
    const candidates = [];
    for (const document of snapshot.docs) {
      const report = document.data();
      const original = normalizeKnowledgeContext(report.knowledgeContext);
      const reference = normalizeRecognitionReference(report.recognitionReference);
      if (report.reviewStatus !== 'RESOLVED' || !original || original.fingerprint !== key.fingerprint
        || !reference || reference.sourceCardId !== report.referenceCardId || reference.variant !== report.referenceVariant
        || !report.referenceCardKey || !report.reviewedAt || !report.reviewedBy
        || typeof report.ownerUid !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(report.ownerUid)) continue;
      candidates.push({ report, reference });
    }
    const owners = [...new Set(candidates.map(({ report }) => report.ownerUid))];
    const ownerAllowed = new Map();
    for (let start = 0; start < owners.length; start += 8) {
      await Promise.all(owners.slice(start, start + 8).map(async uid => {
        ownerAllowed.set(uid, !(await context.db.doc(`accountDeletionLocks/${uid}`).get()).exists);
      }));
    }
    for (const { report, reference } of candidates) {
      if (!ownerAllowed.get(report.ownerUid)) continue;
      // No UID, report ID, photo, note or OCR data leaves this boundary.
      const hint = { fingerprint: key.fingerprint, knowledgeVersion: key.knowledgeVersion, scannerVersion: key.scannerVersion,
        sourceSetId: reference.sourceSetId, sourceCardId: reference.sourceCardId, cardNumber: reference.cardNumber, variant: reference.variant };
      identities.set(JSON.stringify(hint), hint);
    }
    return json({ ok: true, hint: identities.size === 1 ? [...identities.values()][0] : null });
  } catch (error) { return failure(error); }
}
