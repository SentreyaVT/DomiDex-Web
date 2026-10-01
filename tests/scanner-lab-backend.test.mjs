import { afterEach, describe, expect, it, vi } from 'vitest';
import { actorFor } from '../backend/security/firebase.mjs';
import { authorize, changeRole } from '../backend/security/access.mjs';
import { readReportImage, uploadReport, deleteReport } from '../backend/security/images.mjs';

const uid = 'scanner-reviewer-test';
const request = (method = 'GET', body) => new Request('https://domidex.web.app/api/admin/scan-reports', {
  method, headers: { Authorization: 'Bearer test-only', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

function fixture(claims = { scannerLabAccess: true }, tokenClaims = claims) {
  const documents = new Map();
  const objects = new Map();
  let currentClaims = { ...claims }, auditId = 0;
  const reference = (path) => ({ path,
    async get() { const value = documents.get(path); return { exists: documents.has(path), data: () => value, get: (key) => value?.[key] }; },
    async delete() { documents.delete(path); },
  });
  const context = {
    auth: {
      verifyIdToken: vi.fn(async () => ({ uid, ...tokenClaims, auth_time: Date.now()/1000 })),
      getUser: vi.fn(async () => ({ disabled: false, customClaims: { ...currentClaims } })),
      setCustomUserClaims: vi.fn(async (_uid, value) => { currentClaims = { ...value }; }),
      revokeRefreshTokens: vi.fn(async () => {}),
    },
    db: {
      doc: reference,
      collection: (collection) => ({ doc: () => reference(`${collection}/audit-${++auditId}`) }),
      runTransaction: vi.fn(async (work) => work({
        get: (ref) => ref.get(),
        set: (ref, value, options) => documents.set(ref.path, options?.merge ? { ...documents.get(ref.path), ...value } : value),
        create: (ref, value) => { if (documents.has(ref.path)) throw new Error('ALREADY_EXISTS'); documents.set(ref.path, value); },
        delete: (ref) => documents.delete(ref.path),
      })),
    },
    bucket: { file: vi.fn((path) => ({
      save: async (bytes, options) => objects.set(path, { bytes, metadata: { ...options.metadata, size: String(bytes.length) } }),
      getMetadata: async () => [objects.get(path)?.metadata],
      download: vi.fn(async () => [objects.get(path)?.bytes]),
      delete: async () => objects.delete(path),
    })) },
  };
  return { context, documents, objects };
}

afterEach(() => vi.restoreAllMocks());

describe('separate Scanner Lab server capability', () => {
  it('requires revocation-checked tokens and returns the separate capability without other roles', async () => {
    const { context } = fixture();
    await expect(authorize('Bearer test-only', 'scannerLab', context)).resolves.toMatchObject({ sub: uid, admin: false, appAccess: false, pretester: false, scannerLabAccess: true });
    expect(context.auth.verifyIdToken).toHaveBeenCalledExactlyOnceWith('test-only', true);
  });

  it.each(['admin', 'tester', 'app'])('Scanner Lab alone cannot enter the %s boundary', async (role) => {
    await expect(actorFor(request(), fixture().context, role)).rejects.toMatchObject({ message: 'ACCESS_DENIED', status: 403 });
  });

  it.each([{ pretester: true }, { appAccess: true }, {}, { scannerLabAccess: 'true' }, { scannerLabAccess: 1 }])('does not infer lab access from %j', async (claims) => {
    await expect(actorFor(request(), fixture(claims).context, 'scannerLab')).rejects.toMatchObject({ status: 403 });
  });

  it.each([[{}, { scannerLabAccess: true }], [{ scannerLabAccess: true }, {}], [{ scannerLabAccess: 'true' }, { scannerLabAccess: true }], [{ scannerLabAccess: true }, { scannerLabAccess: 'true' }]])('requires a true claim in both current user and token', async (claims, tokenClaims) => {
    await expect(actorFor(request(), fixture(claims, tokenClaims).context, 'scannerLab')).rejects.toMatchObject({ status: 403 });
  });

  it('includes current administrators without requiring a separate lab grant', async () => {
    const { context, documents } = fixture({ admin: true });
    documents.set(`accountAccess/${uid}`, { scannerLabAccess: false });
    await expect(actorFor(request(), context, 'scannerLab')).resolves.toMatchObject({ admin: true, scannerLabAccess: true });
  });

  it.each([{ scannerLabAccess: false }, { scannerLabAccess: 'true' }, { disabled: true }])('denies accountAccess override %j immediately', async (access) => {
    const { context, documents } = fixture(); documents.set(`accountAccess/${uid}`, access);
    await expect(actorFor(request(), context, 'scannerLab')).rejects.toMatchObject({ status: 403 });
  });

  it('accountAccess can deny but never grant the lab capability', async () => {
    const { context, documents } = fixture({}); documents.set(`accountAccess/${uid}`, { scannerLabAccess: true });
    await expect(actorFor(request(), context, 'scannerLab')).rejects.toMatchObject({ status: 403 });
  });

  it('denies disabled users and deletion locks', async () => {
    const { context, documents } = fixture();
    context.auth.getUser.mockResolvedValueOnce({ disabled: true, customClaims: { scannerLabAccess: true } });
    await expect(actorFor(request(), context, 'scannerLab')).rejects.toMatchObject({ status: 403 });
    documents.set(`accountDeletionLocks/${uid}`, { jobId: 'test-job' });
    await expect(actorFor(request(), context, 'scannerLab')).rejects.toMatchObject({ message: 'ACCOUNT_DELETING', status: 403 });
  });

  it.each(['', null, 'scannerLabAccess', 'superadmin', 'toString', 'constructor'])('fails closed for unknown supplied role %j', async (role) => {
    const { context } = fixture({ admin: true });
    await expect(actorFor(request(), context, role)).rejects.toMatchObject({ status: 403 });
    expect(context.auth.verifyIdToken).not.toHaveBeenCalled();
  });

  it('preserves the existing omitted-role authenticated self-deletion boundary', async () => {
    await expect(actorFor(request(), fixture({}).context)).resolves.toMatchObject({ uid, admin: false, scannerLabAccess: false });
    await expect(actorFor(new Request('https://domidex.web.app/'), fixture().context)).rejects.toMatchObject({ status: 401 });
  });
});

describe('Scanner Lab private images', () => {
  it('allows current lab reviewers to view correctly owned image bytes', async () => {
    const { context, documents, objects } = fixture();
    const reportId = 'report-test', path = `scanner-report-images/${reportId}/capture.jpg`, bytes = Buffer.from([255,216,255,217]), hash = 'a'.repeat(64);
    documents.set(`scannerReports/${reportId}`, { scanId: reportId, ownerUid: 'capture-owner', captureType: 'MANUAL_CAPTURE', captureImagePath: path, imageSha256: hash, imageContentType: 'image/jpeg', imageSizeBytes: bytes.length });
    objects.set(path, { bytes, metadata: { contentType: 'image/jpeg', size: String(bytes.length), metadata: { ownerUid: 'capture-owner', reportId, captureType: 'MANUAL_CAPTURE', contentSha256: hash } } });
    const response = await readReportImage(request(), { params: Promise.resolve({ reportId }) }, context);
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store'); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    objects.get(path).metadata.metadata.ownerUid = 'foreign-owner';
    const unsafe = await readReportImage(request(), { params: Promise.resolve({ reportId }) }, context);
    expect(unsafe.status).toBe(409);
  });

  it('pretester alone cannot read images; lab access cannot upload or delete reports', async () => {
    const tester = fixture({ pretester: true });
    expect((await readReportImage(request(), { params: Promise.resolve({ reportId: 'report-test' }) }, tester.context)).status).toBe(403);
    expect(tester.context.bucket.file).not.toHaveBeenCalled();
    const reviewer = fixture();
    expect((await uploadReport(request('POST'), reviewer.context)).status).toBe(403);
    expect((await deleteReport(request('DELETE', { reportId: 'report-test', confirm: 'DELETE_SCAN_REPORT:report-test' }), reviewer.context)).status).toBe(403);
    expect(reviewer.documents.size).toBe(0); expect(reviewer.context.bucket.file).not.toHaveBeenCalled();
  });

  it('existing pretester uploads retain the manual receipt contract', async () => {
    const { context, documents, objects } = fixture({ pretester: true });
    const form = new FormData(); form.set('report', JSON.stringify({ scanId: 'test-manual', captureType: 'MANUAL_CAPTURE', failureReason: 'Test' })); form.set('image', new File([new Uint8Array([255,216,255,217])], 'capture.jpg', { type: 'image/jpeg' }));
    const response = await uploadReport(new Request('https://domidex.web.app/api/pretester/scan-reports', { method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: form }), context);
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ ok: true, reviewStatus: 'NEW', reportId: expect.any(String) }); expect(objects.size).toBe(1);
    expect([...documents.keys()].filter(key => key.startsWith('scannerReports/'))).toHaveLength(1);
  });

  it('retains optional original analysis metadata but strips user-injected recognition approval', async () => {
    const { context, documents } = fixture({ pretester: true });
    const key = { schemaVersion: 1, knowledgeVersion: 1, scannerVersion: 'scanner-v2.1', fingerprint: 'c'.repeat(64) };
    const form = new FormData(); form.set('report', JSON.stringify({ scanId: 'manual-new', captureType: 'MANUAL_CAPTURE',
      knowledgeContext: key, reviewStatus: 'RESOLVED', referenceCardId: 'sv3-137', reviewedBy: 'spoofed',
      recognitionReference: { schemaVersion: 1, sourceSetId: 'sv3', sourceCardId: 'sv3-137', cardNumber: '137', variant: 'normal' }, recognitionFeedback: 'READY' }));
    form.set('image', new File([new Uint8Array([255,216,255,217])], 'capture.jpg', { type: 'image/jpeg' }));
    const response = await uploadReport(new Request('https://domidex.web.app/api/pretester/scan-reports', { method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: form }), context);
    expect(response.status).toBe(201);
    const stored = [...documents].find(([p]) => p.startsWith('scannerReports/'))[1];
    expect(stored.knowledgeContext).toEqual(key); expect(stored.reviewStatus).toBe('NEW');
    expect(stored.recognitionFeedback).toBe('NOT_CONFIRMED'); expect(stored.referenceCardId).toBeNull();
    expect(stored).not.toHaveProperty('recognitionReference'); expect(stored).not.toHaveProperty('reviewedBy');
  });
});

describe('Scanner Lab grant and revocation use the existing leased audited flow', () => {
  it('grants only scannerLabAccess and preserves unrelated claims and overrides', async () => {
    const { context, documents } = fixture({ pretester: true, appAccess: true, feature: 'keep' });
    documents.set(`accountAccess/${uid}`, { pretester: true, appAccess: false });
    await changeRole(uid, 'scannerLabAccess', true, 'admin-test', context);
    expect(context.auth.setCustomUserClaims).toHaveBeenCalledWith(uid, { pretester: true, appAccess: true, feature: 'keep', scannerLabAccess: true });
    expect(documents.get(`accountAccess/${uid}`)).toMatchObject({ pretester: true, appAccess: false, scannerLabAccess: true, lease: null, leaseUntil: 0 });
    expect(documents.get('accessAudit/audit-1')).toMatchObject({ actorUid: 'admin-test', targetUid: uid, role: 'scannerLabAccess', enabled: true });
    expect(context.auth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('revokes only the lab claim, revokes tokens and audits the change', async () => {
    const { context, documents } = fixture({ scannerLabAccess: true, pretester: true, appAccess: true, feature: 'keep' });
    await changeRole(uid, 'scannerLabAccess', false, 'admin-test', context);
    expect(context.auth.setCustomUserClaims).toHaveBeenCalledWith(uid, { pretester: true, appAccess: true, feature: 'keep' });
    expect(context.auth.revokeRefreshTokens).toHaveBeenCalledExactlyOnceWith(uid);
    expect(documents.get(`accountAccess/${uid}`)).toMatchObject({ scannerLabAccess: false, lease: null });
    expect(documents.get('accessAudit/audit-1')).toMatchObject({ role: 'scannerLabAccess', enabled: false });
    await expect(actorFor(request(), context, 'scannerLab')).rejects.toMatchObject({ status: 403 });
  });

  it('leaves lab access denied without a success audit if the auth update fails', async () => {
    const { context, documents } = fixture(); context.auth.setCustomUserClaims.mockRejectedValueOnce(new Error('TEST_AUTH_FAILURE'));
    await expect(changeRole(uid, 'scannerLabAccess', true, 'admin-test', context)).rejects.toThrow('TEST_AUTH_FAILURE');
    expect(documents.get(`accountAccess/${uid}`)).toMatchObject({ scannerLabAccess: false, lease: null });
    expect([...documents.keys()].filter(key=>key.startsWith('accessAudit/'))).toHaveLength(0);
    await expect(actorFor(request(), context, 'scannerLab')).rejects.toMatchObject({ status: 403 });
  });

  it('does not change claims while another lease owns the account', async () => {
    const { context, documents } = fixture(); documents.set(`accountAccess/${uid}`, { leaseUntil: Date.now()+120_000 });
    await expect(changeRole(uid, 'scannerLabAccess', true, 'admin-test', context)).rejects.toMatchObject({ message: 'ACCESS_CHANGE_BUSY', status: 409 });
    expect(context.auth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it.each(['admin', 'scannerLab', 'unknown'])('cannot grant the forbidden claim %s', async (role) => {
    const { context } = fixture(); await expect(changeRole(uid, role, true, 'admin-test', context)).rejects.toMatchObject({ message: 'INVALID_CHANGE', status: 400 }); expect(context.db.runTransaction).not.toHaveBeenCalled();
  });
});
