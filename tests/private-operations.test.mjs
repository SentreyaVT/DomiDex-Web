import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { uploadReport, readReportImage, deleteReport } from '../backend/security/images.mjs';
import { deletionRequest, advanceDeletion } from '../backend/security/deletion.mjs';

const { isCurrentEvidence } = createRequire(import.meta.url)('../backend/scan-knowledge/current-evidence.js');
const projectId = 'demo-domidex-privacy';
let app, context, tokens;
const uidHash = (uid) => createHash('sha256').update(uid).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPZkAAAAASUVORK5CYII=', 'base64');

async function login(uid, claims = {}) {
  const password = randomUUID();
  const email = `${uid}@example.invalid`;
  await context.auth.createUser({ uid, email, password });
  await context.auth.setCustomUserClaims(uid, claims);
  const result = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await result.json();
  if (!data.idToken) throw new Error('TEST_LOGIN_FAILED');
  return data.idToken;
}
function request(token, body) {
  return new Request('http://localhost/api/admin/testers?action=delete-account', { method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function upload(token, extra = {}) {
  const form = new FormData();
  form.set('image', new File([png], 'capture.png', { type: 'image/png' }));
  form.set('report', JSON.stringify({ scanId: 'isolated-report', captureType: 'MANUAL_CAPTURE', failureReason: 'Isolated security test', ...extra }));
  return uploadReport(new Request('http://localhost/api/pretester/scan-reports', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form }), context);
}
function image(token, reportId, view) {
  const url = new URL('http://localhost/private-image');
  if (view) url.searchParams.set('view', view);
  return readReportImage(new Request(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }), { params: Promise.resolve({ reportId }) }, context);
}
function removeReport(token, reportId, confirm = `DELETE_SCAN_REPORT:${reportId}`) {
  return deleteReport(new Request('http://localhost/api/admin/scan-reports', { method: 'DELETE',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportId, confirm }),
  }), context);
}

beforeAll(() => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw new Error(`LOCAL_EMULATOR_REQUIRED:${key}`);
  }
  app = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com`, credential: applicationDefault() }, 'privacy-tests');
  const bucket = getStorage(app).bucket();
  context = { auth: getAuth(app), db: getFirestore(app), bucket, deletionEnabled: true };
  // Storage emulator has no bucket soft-delete policy; policy behavior is tested separately.
  bucket.getMetadata = async () => [{ softDeletePolicy: { retentionDurationSeconds: '0' } }];
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  const users = await context.auth.listUsers();
  if (users.users.length) await context.auth.deleteUsers(users.users.map((user) => user.uid));
  const [files] = await context.bucket.getFiles();
  await Promise.all(files.map((file) => file.delete()));
  delete context.beforeDelete; delete context.now;
  context.bucket.getMetadata = async () => [{ softDeletePolicy: { retentionDurationSeconds: '0' } }];
  tokens = { a: await login('owner-a', { appAccess: true, pretester: true }), b: await login('owner-b', { appAccess: true }), admin: await login('operator', { admin: true }) };
}, 30_000);
afterAll(async () => deleteApp(app));

describe('Private image server boundary', () => {
  it('preserves upload contract and permits only a current admin to read bytes', async () => {
    expect((await upload()).status).toBe(401);
    expect((await upload(tokens.b)).status).toBe(403);
    expect((await upload(tokens.a, { captureType: 'AUTO_CAPTURE' })).status).toBe(400);
    const response = await upload(tokens.a, { ownerUid: 'owner-b', reviewedBy: 'operator', reviewStatus: 'PUBLISHED' });
    expect(response.status).toBe(201);
    const { reportId } = await response.json();
    const report = (await context.db.doc(`scannerReports/${reportId}`).get()).data();
    expect(report.ownerUid).toBe('owner-a'); expect(report.reviewStatus).toBe('NEW'); expect(report.reviewedBy).toBeUndefined();
    expect((await image(null, reportId)).status).toBe(401);
    expect((await image(tokens.a, reportId)).status).toBe(403);
    expect((await image(tokens.b, reportId)).status).toBe(403);
    const allowed = await image(tokens.admin, reportId);
    expect(allowed.status).toBe(200); expect(Buffer.from(await allowed.arrayBuffer())).toEqual(png);
    const [metadata] = await context.bucket.file(report.captureImagePath).getMetadata();
    expect(metadata.metadata.firebaseStorageDownloadTokens).toBeUndefined();
    await context.auth.setCustomUserClaims('operator', {});
    expect((await image(tokens.admin, reportId)).status).toBe(403);
  });

  it('returns original bytes unchanged and creates only view=thumb as a private bounded WebP', async () => {
    const uploaded = await upload(tokens.a);
    const { reportId } = await uploaded.json();

    const original = await image(tokens.admin, reportId);
    expect(original.status).toBe(200);
    expect(original.headers.get('content-type')).toBe('image/png');
    expect(original.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await original.arrayBuffer())).toEqual(png);

    const thumbnail = await image(tokens.admin, reportId, 'thumb');
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toBe('image/webp');
    expect(thumbnail.headers.get('cache-control')).toBe('private, no-store');
    const thumbnailBytes = Buffer.from(await thumbnail.arrayBuffer());
    expect(thumbnailBytes).not.toEqual(png);
    const metadata = await sharp(thumbnailBytes).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.width).toBeLessThanOrEqual(180);
    expect(metadata.height).toBeGreaterThan(0);
    expect(metadata.height).toBeLessThanOrEqual(252);
  });

  it('keeps interrupted upload ownership and refuses a deleting account', async () => {
    await context.db.doc('accountDeletionLocks/owner-a').set({ jobId: 'test' });
    expect((await upload(tokens.a)).status).toBe(403);
    expect((await context.bucket.getFiles())[0]).toHaveLength(0);
  });

  it('deletes exactly one admin-selected report and image while preserving global scanner data', async () => {
    await context.db.doc('scannerProfileVersions/production').set({ checksum: 'unchanged', status: 'production' });
    await context.db.doc('scannerReleaseManifest/production').set({ checksum: 'unchanged' });
    const uploaded = await upload(tokens.a); const { reportId } = await uploaded.json();
    const report = (await context.db.doc(`scannerReports/${reportId}`).get()).data();
    expect((await removeReport(null, reportId)).status).toBe(401);
    expect((await removeReport(tokens.a, reportId)).status).toBe(403);
    expect((await removeReport(tokens.admin, reportId, 'wrong')).status).toBe(400);
    expect((await context.db.doc(`scannerReports/${reportId}`).get()).exists).toBe(true);
    const removed = await removeReport(tokens.admin, reportId);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ ok: true, reportDeleted: true, imageDeleted: true, providerRetentionPossible: true });
    expect((await context.db.doc(`scannerReports/${reportId}`).get()).exists).toBe(false);
    expect((await context.bucket.file(report.captureImagePath).exists())[0]).toBe(false);
    expect((await context.db.doc('scannerProfileVersions/production').get()).get('checksum')).toBe('unchanged');
    expect((await context.db.doc('scannerReleaseManifest/production').get()).get('checksum')).toBe('unchanged');
    expect((await context.db.collection('scannerAudit').where('reportId', '==', reportId).get()).size).toBe(1);
    expect(await (await removeReport(tokens.admin, reportId)).json()).toMatchObject({ ok: true, alreadyDeleted: true });
  });

  it('fails closed on mismatched image metadata without deleting either resource', async () => {
    const uploaded = await upload(tokens.a); const { reportId } = await uploaded.json();
    const ref = context.db.doc(`scannerReports/${reportId}`); const report = (await ref.get()).data();
    await context.bucket.file(report.captureImagePath).setMetadata({ metadata: { reportId: 'another-report', ownerUid: 'owner-a', captureType: 'MANUAL_CAPTURE', contentSha256: report.imageSha256 } });
    const response = await removeReport(tokens.admin, reportId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: 'REPORT_IMAGE_RELATION_UNSAFE' });
    expect((await ref.get()).exists).toBe(true);
    expect((await context.bucket.file(report.captureImagePath).exists())[0]).toBe(true);
  });

  it('reports a partial deletion truthfully and completes safely on retry', async () => {
    const uploaded = await upload(tokens.a); const { reportId } = await uploaded.json();
    const ref = context.db.doc(`scannerReports/${reportId}`); const report = (await ref.get()).data();
    const transaction = context.db.runTransaction.bind(context.db);
    context.db.runTransaction = async () => { throw new Error('INJECTED_COMMIT_FAILURE'); };
    let partial;
    try { partial = await removeReport(tokens.admin, reportId); }
    finally { context.db.runTransaction = transaction; }
    expect(partial.status).toBe(503);
    expect(await partial.json()).toMatchObject({ ok: false, error: 'PARTIAL_DELETE', imageDeleted: true, reportDeleted: false });
    expect((await ref.get()).exists).toBe(true);
    expect((await context.bucket.file(report.captureImagePath).exists())[0]).toBe(false);
    expect(await (await removeReport(tokens.admin, reportId)).json()).toMatchObject({ ok: true, reportDeleted: true, imageAlreadyMissing: true });
  });
});

async function seedAccount() {
  await context.db.doc('users/owner-a').set({ preference: 'test' });
  await context.db.doc('users/owner-a/collectionEntries/one').set({ ownerUid: 'owner-a', deleted: true, acquisitionPriceMinor: 100, binderId: 'set' });
  await context.db.doc('users/owner-a/preferences/nested/history/one').set({ setting: true });
  await context.db.doc('users/owner-b/collectionEntries/keep').set({ ownerUid: 'owner-b', variant: 'Reverse' });
  await context.db.doc('cards/global').set({ name: 'Global catalog' });
  await context.db.doc('sets/global').set({ name: 'Global set' });
  await context.db.doc('scannerProfileVersions/production').set({ status: 'production', createdBy: 'someone-else', checksum: 'unchanged' });
  await context.db.doc('scannerReleaseManifest/production').set({ profiles: { production: 'unchanged' } });
  await context.db.doc('supportRequests/own').set({ requesterUid: 'owner-a', message: 'test' });
  await context.db.doc('communitySubmissions/own').set({ submitterUid: 'owner-a' });
  const fingerprint = 'a'.repeat(64);
  await context.db.doc(`users/owner-a/scanEvidence/${fingerprint}`).set({ fingerprint });
  await context.db.doc(`scanKnowledgePrivate/${fingerprint}`).set({ knowledgeVersion: 1, votes: { card1: 2 }, total: 2 });
  for (const uid of ['owner-a', 'owner-b']) await context.db.doc(`scanKnowledgePrivate/${fingerprint}/contributors/${uidHash(uid)}`).set({ cardId: 'card1', cardNumber: '001', corrected: false });
  await context.db.doc(`scanKnowledge/${fingerprint}`).set({ confirmations: 2 });
  const uploaded = await upload(tokens.a);
  expect(uploaded.status).toBe(201);
  for (const prefix of ['users/owner-a', 'catalog-contributions/owner-a', 'community-submissions/owner-a']) await context.bucket.file(`${prefix}/test.png`).save(png, { resumable: false, metadata: { contentType: 'image/png', metadata: { ownerUid: 'owner-a' } } });
  await context.bucket.file('users/owner-b/keep.png').save(png, { resumable: false, metadata: { contentType: 'image/png' } });
}

describe('Account deletion: isolated real Firebase emulators', () => {
  it('denies anonymous and foreign user deletion without modifying either account', async () => {
    expect((await deletionRequest(request(null, { uid: 'owner-a', confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context)).status).toBe(401);
    expect((await deletionRequest(request(tokens.a, { uid: 'owner-b', confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context)).status).toBe(403);
    expect((await context.auth.getUser('owner-b')).disabled).toBe(false);
  });
  it('deletes all owned classes, recalculates contributions, preserves global/foreign data and is repeatable', async () => {
    await seedAccount();
    const response = await deletionRequest(request(tokens.a, { confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context);
    expect(response.status).toBe(202);
    const first = await response.json();
    expect(first.status).toBe('PENDING_SESSION_EXPIRY');
    expect((await context.auth.getUser('owner-a')).disabled).toBe(true);
    expect((await context.db.doc('users/owner-a/collectionEntries/one').get()).exists).toBe(false);
    context.now = () => first.nextActionAt + 1000;
    const done = await advanceDeletion(context, 'owner-a', first.jobId);
    expect(done.status).toBe('COMPLETE');
    await expect(context.auth.getUser('owner-a')).rejects.toMatchObject({ code: 'auth/user-not-found' });
    expect((await context.db.doc('users/owner-a/preferences/nested/history/one').get()).exists).toBe(false);
    expect((await context.db.collection('scannerReports').get()).size).toBe(0);
    expect((await context.db.doc('supportRequests/own').get()).exists).toBe(false);
    expect((await context.db.doc('communitySubmissions/own').get()).exists).toBe(false);
    expect((await context.bucket.getFiles())[0].map((file) => file.name)).toEqual(['users/owner-b/keep.png']);
    expect((await context.db.doc(`scanKnowledge/${'a'.repeat(64)}`).get()).get('confirmations')).toBe(1);
    expect((await context.db.doc('users/owner-b/collectionEntries/keep').get()).get('variant')).toBe('Reverse');
    expect((await context.db.doc('scannerProfileVersions/production').get()).get('checksum')).toBe('unchanged');
    expect((await context.db.doc('scannerReleaseManifest/production').get()).exists).toBe(true);
    expect((await context.db.doc('cards/global').get()).exists).toBe(true);
    expect((await context.db.doc('sets/global').get()).exists).toBe(true);
    delete context.now;
    const repeat = await deletionRequest(request(tokens.admin, { uid: 'owner-a', jobId: first.jobId, confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context);
    expect((await repeat.json()).status).toBe('COMPLETE');
    expect((await context.db.doc('accountDeletionLocks/owner-a').get()).exists).toBe(false);
  }, 45_000);
  it('records partial failure, retries safely, and never reports provider retention as complete', async () => {
    await seedAccount();
    context.beforeDelete = () => { throw new Error('INJECTED_FAILURE'); };
    const first = await (await deletionRequest(request(tokens.admin, { uid: 'owner-a', confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context)).json();
    expect(first.status).toBe('PARTIAL_FAILURE');
    expect((await context.db.doc('users/owner-a/collectionEntries/one').get()).exists).toBe(true);
    delete context.beforeDelete;
    const job = (await context.db.doc(`accountDeletionJobs/${first.jobId}`).get()).data();
    context.now = () => job.settleAfter + 1000;
    context.bucket.getMetadata = async () => [{ softDeletePolicy: { retentionDurationSeconds: '604800' } }];
    const resumed = await advanceDeletion(context, 'owner-a', first.jobId);
    expect(resumed.status).toBe('ACTIVE_DATA_DELETED_PENDING_PROVIDER_RETENTION');
    expect((await context.db.doc(`accountDeletionReceipts/${first.jobId}`).get()).exists).toBe(false);
    expect((await context.db.doc('users/owner-b/collectionEntries/keep').get()).exists).toBe(true);
  }, 45_000);
  it('blocks protected attribution before disabling or deleting the account', async () => {
    await context.db.doc('scannerProfileVersions/production').set({ createdBy: 'owner-a', checksum: 'keep' });
    const result = await deletionRequest(request(tokens.a, { confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context);
    expect(result.status).toBe(409);
    expect((await result.json()).blockers).toContain('PROTECTED_SCANNER_ATTRIBUTION');
    expect((await context.auth.getUser('owner-a')).disabled).toBe(false);
  });
  it('starts the token expiry interval only after a successful disable/revoke', async () => {
    const update = context.auth.updateUser.bind(context.auth);
    context.auth.updateUser = async () => { throw new Error('INJECTED_AUTH_FAILURE'); };
    let first;
    try { first = await (await deletionRequest(request(tokens.admin, { uid: 'owner-a', confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context)).json(); }
    finally { context.auth.updateUser = update; }
    expect(first.status).toBe('PARTIAL_FAILURE');
    const later = Date.now() + 70 * 60_000;
    context.now = () => later;
    const result = await advanceDeletion(context, 'owner-a', first.jobId);
    expect(result.status).toBe('PENDING_SESSION_EXPIRY');
    expect(result.nextActionAt).toBe(later + 65 * 60_000);
    expect((await context.auth.getUser('owner-a')).disabled).toBe(true);
  });
  it('tracks old soft-deleted versions even with a current zero-retention policy', async () => {
    const list = context.bucket.getFiles.bind(context.bucket);
    let retained = true;
    const old = { name: 'users/owner-a/old.png', metadata: { generation: '123', metadata: { ownerUid: 'owner-a' }, hardDeleteTime: new Date(Date.now() + 2 * 86400_000).toISOString() } };
    context.bucket.getFiles = async (query) => query?.softDeleted ? [retained ? [old] : [], null] : list(query);
    try {
      const first = await (await deletionRequest(request(tokens.admin, { uid: 'owner-a', confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context)).json();
      context.now = () => first.nextActionAt + 1000;
      const pending = await advanceDeletion(context, 'owner-a', first.jobId);
      expect(pending.status).toBe('PROVIDER_PURGE_NOT_CONFIRMED');
      expect((await context.db.doc(`accountDeletionReceipts/${first.jobId}`).get()).exists).toBe(false);
      retained = false;
      expect((await advanceDeletion(context, 'owner-a', first.jobId)).status).toBe('COMPLETE');
    } finally { context.bucket.getFiles = list; }
  });
  it('does not publish COMPLETE when final job cleanup fails', async () => {
    const first = await (await deletionRequest(request(tokens.admin, { uid: 'owner-a', confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context)).json();
    context.now = () => first.nextActionAt + 1000;
    const cleanup = context.db.recursiveDelete.bind(context.db);
    context.db.recursiveDelete = async () => { throw new Error('INJECTED_CLEANUP_FAILURE'); };
    try {
      expect((await advanceDeletion(context, 'owner-a', first.jobId)).status).toBe('PARTIAL_FAILURE');
      expect((await context.db.doc(`accountDeletionReceipts/${first.jobId}`).get()).exists).toBe(false);
      expect((await context.db.doc(`accountDeletionJobs/${first.jobId}`).get()).exists).toBe(true);
    } finally { context.db.recursiveDelete = cleanup; }
    expect((await advanceDeletion(context, 'owner-a', first.jobId)).status).toBe('COMPLETE');
  });
  it('does not replay stale/deleted Evidence, even if a trigger arrived before deletion', async () => {
    const ref = context.db.doc(`users/owner-a/scanEvidence/${'b'.repeat(64)}`);
    const lock = context.db.doc('accountDeletionLocks/owner-a');
    await ref.set({ confirmedCardId: 'card1' }); const after = await ref.get();
    expect(await context.db.runTransaction((tx) => isCurrentEvidence(tx, after, lock))).toBe(true);
    await ref.set({ confirmedCardId: 'card2' });
    expect(await context.db.runTransaction((tx) => isCurrentEvidence(tx, after, lock))).toBe(false);
    await ref.delete();
    expect(await context.db.runTransaction((tx) => isCurrentEvidence(tx, after, lock))).toBe(false);
    await ref.set({ confirmedCardId: 'card1' }); const latest = await ref.get();
    await lock.set({ jobId: 'deletion' });
    expect(await context.db.runTransaction((tx) => isCurrentEvidence(tx, latest, lock))).toBe(false);
  });
});
