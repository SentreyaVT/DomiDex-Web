import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createHash, randomUUID } from 'node:crypto';
import { isCurrentEvidence } from '../backend/scan-knowledge/current-evidence.js';
import sharp from 'sharp';
import { uploadReport, readReportImage, deleteReport } from '../backend/security/images.mjs';
import { deletionRequest, advanceDeletion } from '../backend/security/deletion.mjs';
import { authorize, changeRole } from '../backend/security/access.mjs';
import { createBinderShare, listBinderShares, readBinderShare, revokeBinderShare } from '../backend/security/sharing.mjs';
import { rateLimitDocumentId, writePolicies } from '../backend/security/rate-limit.mjs';
import { createReadRateLimiter } from '../backend/security/read-rate-limit.mjs';
import { readPrivateSyncTimeAnchor } from '../backend/security/private-sync-time-anchor.mjs';

const projectId = 'demo-domidex-privacy';
let app, context, tokens;
const uidHash = (uid) => createHash('sha256').update(uid).digest('hex');
// Exact future read-policy cleanup contract, independently of implementation.
const anchorQuotaPath = uid => `privateReadRateLimits/syncTimeAnchor_${createHash('sha256').update(`syncTimeAnchor\0${uid}`).digest('hex')}`;
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
  context = { auth: getAuth(app), db: getFirestore(app), bucket, deletionEnabled: true, rateLimitMode: 'off' };
  // Storage emulator has no bucket soft-delete policy; policy behavior is tested separately.
  bucket.getMetadata = async () => [{ softDeletePolicy: { retentionDurationSeconds: '0' } }];
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  const users = await context.auth.listUsers();
  if (users.users.length) await context.auth.deleteUsers(users.users.map((user) => user.uid));
  const [files] = await context.bucket.getFiles();
  await Promise.all(files.map((file) => file.delete()));
  delete context.beforeDelete; delete context.now; delete context.sharingEnabled; delete context.cardFor;
  context.bucket.getMetadata = async () => [{ softDeletePolicy: { retentionDurationSeconds: '0' } }];
  tokens = { a: await login('owner-a', { appAccess: true, pretester: true }), b: await login('owner-b', { appAccess: true }), admin: await login('operator', { admin: true }) };
}, 30_000);
afterAll(async () => deleteApp(app));

describe('Private sync anchors: real local Auth and Firestore SDKs', () => {
  const anchorRequest = token => new Request('http://localhost/api/private-sync/time-anchor', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  it('preserves the exact real absent-lock snapshot readTime and authenticated identity', async () => {
    let observed;
    const checked = { ...context,
      // Observe, do not replace, the actual Admin SDK authorization snapshot.
      db: { doc: path => ({ get: async () => {
        const snapshot = await context.db.doc(path).get();
        if (path === 'accountDeletionLocks/owner-a') observed = snapshot;
        return snapshot;
      } }) },
      // The real quota uses real DocumentReferences/transactions on the same DB.
      consumeReadQuota: createReadRateLimiter(context.db, { observe: () => {} }),
    };
    const response = await readPrivateSyncTimeAnchor(anchorRequest(tokens.a), checked);
    expect(response.status).toBe(200);
    expect(observed).toBeDefined(); expect(observed.exists).toBe(false);
    expect(await response.json()).toEqual({ schemaVersion: 1, ownerUid: 'owner-a',
      seconds: observed.readTime.seconds, nanoseconds: observed.readTime.nanoseconds });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await context.db.doc(anchorQuotaPath('owner-a')).get()).data()).toMatchObject({ schemaVersion: 1, policy: 'syncTimeAnchor', count: 1 });
    expect((await context.db.doc(anchorQuotaPath('owner-b')).get()).exists).toBe(false);
  });

  it('enforces the shared 60+1 budget across independent SDK instances and isolates another owner', async () => {
    const secondApp = initializeApp({ projectId }, `anchor-quota-${randomUUID()}`);
    try {
      const secondDb = getFirestore(secondApp);
      const firstQuota = createReadRateLimiter(context.db, { observe: () => {} });
      const secondQuota = createReadRateLimiter(secondDb, { observe: () => {} });
      // 59 real successful reservations; then two competing endpoint calls.
      // This is not 61 simultaneous requests or a production capacity benchmark.
      for (let index = 0; index < 59; index++) await (index % 2 ? firstQuota : secondQuota)('syncTimeAnchor', 'owner-a');
      const firstContext = { ...context, consumeReadQuota: firstQuota };
      const secondContext = { ...context, db: secondDb, consumeReadQuota: secondQuota };
      const replies = await Promise.all([
        readPrivateSyncTimeAnchor(anchorRequest(tokens.a), firstContext),
        readPrivateSyncTimeAnchor(anchorRequest(tokens.a), secondContext),
      ]);
      expect(replies.map(reply => reply.status).sort((a, b) => a - b)).toEqual([200, 429]);
      const allowed = replies.find(reply => reply.status === 200);
      const limited = replies.find(reply => reply.status === 429);
      expect(await allowed.json()).toMatchObject({ schemaVersion: 1, ownerUid: 'owner-a' });
      const limitedBody = await limited.json();
      expect(limitedBody).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
      expect(Number.isInteger(limitedBody.retryAfterSeconds)).toBe(true);
      expect(limitedBody.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(limitedBody.retryAfterSeconds).toBeLessThanOrEqual(60);
      expect(limited.headers.get('retry-after')).toBe(String(limitedBody.retryAfterSeconds));
      expect(limited.headers.get('cache-control')).toBe('private, no-store');
      expect((await secondDb.doc(anchorQuotaPath('owner-a')).get()).data().count).toBe(60);
      const other = await readPrivateSyncTimeAnchor(anchorRequest(tokens.b), secondContext);
      expect(other.status).toBe(200); expect(await other.json()).toMatchObject({ ownerUid: 'owner-b' });
      expect((await context.db.doc(anchorQuotaPath('owner-b')).get()).data().count).toBe(1);
      expect((await context.db.collection('privateReadRateLimits').get()).size).toBe(2);
    } finally { await deleteApp(secondApp); }
  }, 60_000);

  it('denies revoked/disabled access and both early and post-auth deletion fences without quota writes', async () => {
    const denied = async (token, status, error, checked = context) => {
      const response = await readPrivateSyncTimeAnchor(anchorRequest(token), checked);
      expect(response.status).toBe(status); expect(await response.json()).toEqual({ ok: false, error });
      expect((await context.db.doc(anchorQuotaPath('owner-a')).get()).exists).toBe(false);
    };
    await denied(null, 401, 'AUTH_REQUIRED');
    await context.auth.setCustomUserClaims('owner-a', { pretester: true });
    await denied(tokens.a, 403, 'ACCESS_DENIED');
    await context.auth.setCustomUserClaims('owner-a', { appAccess: true, pretester: true });
    await context.db.doc('accountAccess/owner-a').set({ disabled: true });
    await denied(tokens.a, 403, 'ACCESS_DENIED');
    await context.db.doc('accountAccess/owner-a').delete();
    await context.db.doc('accountDeletionLocks/owner-a').set({ jobId: 'local-anchor-test' });
    await denied(tokens.a, 403, 'ACCOUNT_DELETING');
    await context.db.doc('accountDeletionLocks/owner-a').delete();
    const quota = createReadRateLimiter(context.db, { observe: () => {} });
    await denied(tokens.a, 403, 'ACCOUNT_DELETING', { ...context, consumeReadQuota: async (policy, uid) => {
      // Deterministic interleaving after genuine Auth/absent-lock reads, before
      // the genuine Firestore quota transaction; no fake transaction outcome.
      await context.db.doc(`accountDeletionLocks/${uid}`).set({ jobId: 'local-post-auth-fence' });
      await quota(policy, uid);
    } });
    await context.db.doc('accountDeletionLocks/owner-a').delete();
    await context.auth.updateUser('owner-a', { disabled: true });
    await denied(tokens.a, 401, 'AUTH_REQUIRED');
    expect((await context.db.collection('privateReadRateLimits').get()).size).toBe(0);
  });
});

describe('Read-only binder sharing server boundary', () => {
  const card = { id: 'sv1-200', localId: '200', name: 'Public card', image: 'https://assets.tcgdex.net/de/sv/sv1/200', set: { id: 'sv1', name: 'Public set' }, variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: { idProduct: 42, trend: 2.5, unit: 'EUR' } } }] };
  async function seed() {
    context.sharingEnabled = true; context.cardFor = async () => card;
    await context.db.doc('users/owner-a/privateBinders/binder-a').set({ binderId: 'binder-a', ownerUid: 'owner-a', name: 'My explicitly shared binder', coverStyle: 'galaxy', minimumPageCount: 2, deleted: false, description: 'PRIVATE_DESCRIPTION' });
    await context.db.doc('users/owner-a/privateBinderPlacements/placement-a').set({ ownerUid: 'owner-a', binderId: 'binder-a', entrySyncId: 'entry-a', slotPosition: 1, holoEffectId: 'galaxy', holoIntensity: .7, deleted: false });
    await context.db.doc('users/owner-a/collectionEntries/entry-a').set({ ownerUid: 'owner-a', sourceCardId: 'sv1-200', sourceSetId: 'sv1', setId: 'sv1', collectorNumber: '200/198', finish: 'Normal', variant: 'Standard', externalProductId: 42, deleted: false, quantity: 12, notes: 'PRIVATE_NOTES', acquisitionPriceMinor: 9000, imageUrl: 'https://private.invalid/secret' });
  }
  async function make(extra = {}) {
    const response = await createBinderShare(request(tokens.a, { binderId: 'binder-a', confirm: true, ...extra }), context);
    expect(response.status).toBe(201);
    return response.json();
  }
  const read = (token, suffix = '') => readBinderShare(new Request(`http://localhost/shared${suffix}`), { params: Promise.resolve({ token }) }, context);
  it('is off by default and requires explicit owner confirmation and app access', async () => {
    expect((await createBinderShare(request(tokens.a, { binderId: 'binder-a', confirm: true }), context)).status).toBe(404);
    await seed();
    expect((await createBinderShare(request(tokens.a, { binderId: 'binder-a' }), context)).status).toBe(400);
    expect((await createBinderShare(request(tokens.b, { binderId: 'binder-a', ownerUid: 'owner-a', confirm: true }), context)).status).toBe(404);
    expect((await read('owner-a')).status).toBe(404);
    expect((await read('a'.repeat(43))).status).toBe(404);
    const forgedBrowser = new Request('http://localhost/api/binder-shares', { method: 'POST', headers: { Cookie: `session=${tokens.a}`, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ binderId: 'binder-a', confirm: true }) });
    expect((await createBinderShare(forgedBrowser, context)).status).toBe(401);
    expect((await createBinderShare(request(tokens.a, { binderId: 'binder-a', confirm: true, padding: 'x'.repeat(3000) }), context)).status).toBe(413);
  });
  it('issues 256-bit tokens and returns only the DTO without default owner or price data', async () => {
    await seed(); const created = await make(); const token = created.path.split('/').pop();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const saved = (await context.db.doc(`privateBinderShares/${created.shareId}`).get()).data();
    expect(JSON.stringify(saved)).not.toContain(token);
    const response = await read(token, '?showPrices=true&showTotal=true&showDisplayName=true');
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await response.json();
    expect(body.cards[0]).toMatchObject({ name: 'Public card', slot: 1, holoEffectId: 'galaxy', holoIntensity: .7 });
    expect(JSON.stringify(body)).not.toMatch(/owner-a|PRIVATE_|entry-a|placement-a|quantity|acquisition|price|total|displayName|private.invalid/);
    expect((await context.db.doc('users/owner-a/collectionEntries/entry-a').get()).get('quantity')).toBe(12);
    expect((await read(created.shareId)).status).toBe(404);
  });
  it('keeps pricing and total opt-ins independent, with quantity excluded from market total', async () => {
    await seed(); const created = await make({ showTotal: true });
    const body = await (await read(created.path.split('/').pop())).json();
    expect(body.total).toEqual({ amount: 2.5, currency: 'EUR', complete: true, pricedCards: 1, visibleCards: 1 });
    expect(body.cards[0].price).toBeUndefined();
    const named = await make({ showPrices: true, showDisplayName: true, displayName: 'Sammler' });
    const namedBody = await (await read(named.path.split('/').pop())).json();
    expect(namedBody.displayName).toBe('Sammler'); expect(namedBody.cards[0].price.amount).toBe(2.5); expect(namedBody.total).toBeUndefined();
  });
  it('only allows the owner to list/revoke and makes revocation immediately effective', async () => {
    await seed(); const created = await make(); const token = created.path.split('/').pop();
    const list = await listBinderShares(new Request('http://localhost/shares?binderId=binder-a', { headers: { Authorization: `Bearer ${tokens.a}` } }), context);
    expect((await list.json()).shares).toHaveLength(1);
    expect((await revokeBinderShare(request(tokens.b, { shareId: created.shareId, confirm: true }), context)).status).toBe(404);
    expect((await revokeBinderShare(request(tokens.a, { shareId: created.shareId, confirm: true }), context)).status).toBe(200);
    expect((await read(token)).status).toBe(404);
  });
  it('lists only the calling owners private binder summaries without unrelated metadata', async () => {
    await seed();
    const response = await listBinderShares(new Request('http://localhost/shares', { headers: { Authorization: `Bearer ${tokens.a}` } }), context);
    expect(await response.json()).toEqual({ binders: [{ binderId: 'binder-a', name: 'My explicitly shared binder', coverStyle: 'galaxy' }] });
    const foreign = await listBinderShares(new Request('http://localhost/shares?ownerUid=owner-a', { headers: { Authorization: `Bearer ${tokens.b}` } }), context);
    expect(await foreign.json()).toEqual({ binders: [] });
  });
  it('rechecks a revocation during catalog work and owner revocation without refreshing client tokens', async () => {
    await seed(); const created = await make();
    context.cardFor = async () => { await context.db.doc(`privateBinderShares/${created.shareId}`).update({ revokedAt: Date.now() }); return card; };
    expect((await read(created.path.split('/').pop())).status).toBe(404);
    context.cardFor = async () => card;
    const second = await make();
    await context.db.doc('accountAccess/owner-a').set({ appAccess: false });
    expect((await read(second.path.split('/').pop())).status).toBe(404);
  });
  it('fails closed on corrupt placement ownership and unavailable exact prices', async () => {
    await seed(); const created = await make({ showTotal: true, showPrices: true });
    context.cardFor = async () => ({ ...card, variants_detailed: [{ type: 'Normal', pricing: { cardmarket: { idProduct: 999, trend: 800 } } }] });
    const missing = await (await read(created.path.split('/').pop())).json();
    expect(missing.total.amount).toBeNull(); expect(missing.total.complete).toBe(false); expect(missing.cards[0].price.amount).toBeNull();
    await context.db.doc('users/owner-a/privateBinderPlacements/placement-a').update({ ownerUid: 'owner-b' });
    expect((await read(created.path.split('/').pop())).status).toBe(503);
  });
});

describe('Private image server boundary', () => {
  it('does not treat a malformed explicit deletion target as the calling admin', async () => {
    for (const uid of ['', null, 0, {}, 'bad/path']) {
      expect((await deletionRequest(request(tokens.admin, { uid, confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context)).status).toBe(400);
    }
    expect((await context.auth.getUser('operator')).disabled).toBe(false);
    expect((await context.db.collection('accountDeletionJobs').get()).empty).toBe(true);
  });
  it.each([['a', 'owner-a', 'pretester'], ['admin', 'operator', 'admin']])('denies and cleans in-flight %s uploads revoked before final commit', async (tokenKey, uid, role) => {
    const run = context.db.runTransaction.bind(context.db);
    let count = 0;
    context.db.runTransaction = async (work) => {
      count++;
      if (count === 2) await context.db.doc(`accountAccess/${uid}`).set({ [role]: false });
      return run(work);
    };
    try {
      expect((await upload(tokens[tokenKey])).status).toBe(403);
      expect((await context.db.collection('scannerReports').get()).empty).toBe(true);
      expect((await context.db.collection('privateUploadOperations').get()).empty).toBe(true);
      expect((await context.bucket.getFiles())[0]).toHaveLength(0);
    } finally { context.db.runTransaction = run; }
  });
  it('fences stale role tokens, preserves unrelated claims and records an attribution-only access audit', async () => {
    await context.auth.setCustomUserClaims('owner-a', { appAccess: true, pretester: true, feature: 'keep' });
    await changeRole('owner-a', 'appAccess', false, `Bearer ${tokens.admin}`, context);
    expect((await context.auth.getUser('owner-a')).customClaims).toEqual({ pretester: true, feature: 'keep' });
    expect((await context.db.doc('accountAccess/owner-a').get()).get('appAccess')).toBe(false);
    await expect(authorize(`Bearer ${tokens.a}`, 'app', context)).rejects.toThrow();
    const audit = (await context.db.collection('accessAudit').get()).docs[0].data();
    expect(audit).toMatchObject({ targetUid: 'owner-a', actorUid: 'operator', role: 'appAccess', enabled: false });
    expect(audit.email).toBeUndefined();
    // pretester is an independent entitlement. Auth revocation timestamps have second
    // precision, so assert its authoritative override, not incidental token expiry.
    await changeRole('owner-a', 'pretester', false, `Bearer ${tokens.admin}`, context);
    expect((await upload(tokens.a)).status).not.toBe(201);
  });

  it('leaves the affected role denied if the Auth update fails', async () => {
    const broken = { ...context, auth: { verifyIdToken: context.auth.verifyIdToken.bind(context.auth), getUser: context.auth.getUser.bind(context.auth), setCustomUserClaims: async () => { throw new Error('INJECTED_FAILURE'); } } };
    await expect(changeRole('owner-a', 'pretester', false, `Bearer ${tokens.admin}`, broken)).rejects.toThrow('INJECTED_FAILURE');
    expect((await context.db.doc('accountAccess/owner-a').get()).get('pretester')).toBe(false);
    expect((await upload(tokens.a)).status).toBe(403);
  });

  it('never serves an image whose owner/hash no longer matches its report', async () => {
    const uploaded = await upload(tokens.a);
    const { reportId } = await uploaded.json();
    await context.db.doc(`scannerReports/${reportId}`).update({ imageSha256: 'f'.repeat(64) });
    const response = await image(tokens.admin, reportId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'REPORT_IMAGE_RELATION_UNSAFE' });
  });

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
  for (const uid of ['owner-a', 'owner-b']) await context.db.doc(anchorQuotaPath(uid)).set({ schemaVersion: 1, policy: 'syncTimeAnchor', count: 1, windowStartedAt: Date.now(), expiresAt: new Date(Date.now() + 86400000) });
  for (const policy of Object.keys(writePolicies)) {
    for (const uid of ['owner-a', 'owner-b']) await context.db.doc(`privateWriteRateLimits/${rateLimitDocumentId(policy, uid)}`).set({ schemaVersion: 1, policy, count: 1, windowStartedAt: Date.now(), expiresAt: new Date(Date.now() + 86400000) });
  }
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
    for (const policy of Object.keys(writePolicies)) {
      expect((await context.db.doc(`privateWriteRateLimits/${rateLimitDocumentId(policy, 'owner-a')}`).get()).exists).toBe(false);
      expect((await context.db.doc(`privateWriteRateLimits/${rateLimitDocumentId(policy, 'owner-b')}`).get()).exists).toBe(true);
    }
    expect((await context.db.doc(anchorQuotaPath('owner-a')).get()).exists).toBe(false);
    expect((await context.db.doc(anchorQuotaPath('owner-b')).get()).exists).toBe(true);
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
    expect((await context.db.doc(anchorQuotaPath('owner-a')).get()).exists).toBe(true);
    delete context.beforeDelete;
    const job = (await context.db.doc(`accountDeletionJobs/${first.jobId}`).get()).data();
    context.now = () => job.settleAfter + 1000;
    context.bucket.getMetadata = async () => [{ softDeletePolicy: { retentionDurationSeconds: '604800' } }];
    const resumed = await advanceDeletion(context, 'owner-a', first.jobId);
    expect(resumed.status).toBe('ACTIVE_DATA_DELETED_PENDING_PROVIDER_RETENTION');
    expect((await context.db.doc(anchorQuotaPath('owner-a')).get()).exists).toBe(false);
    expect((await context.db.doc(anchorQuotaPath('owner-b')).get()).exists).toBe(true);
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
