import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp, getApps } from 'firebase/app';
import { connectAuthEmulator, getAuth as getClientAuth, GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDocFromServer, initializeFirestore, memoryLocalCache, terminate } from 'firebase/firestore';
import { assertTestEnvironment } from './private-operations-local/safety.mjs';

// Only substitute default-app initialization. All Auth/Firestore RPCs, the
// transaction callback, identity functions and the deployed local Rules are real.
const webAddSdk = vi.hoisted(() => ({ firestore: undefined }));
vi.mock('../lib/firebase-client', () => ({ get firestore() { return webAddSdk.firestore; } }));
import { addExactCard, collectionSyncIdForExactCard } from '../lib/collection';
import { exactCardmarketProductId } from '../lib/domain';
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

describe('Canonical knowledge callback: actual local Admin SDK transactions', () => {
  const owners = ['knowledge-sdk-a', 'knowledge-sdk-b', 'knowledge-sdk-c'];
  const firstCard = 'sv3-215', secondCard = 'sv3-216';
  const identity = (cardId) => ({ sourceSetId: 'sv3', cardNumber: cardId.endsWith('215') ? '215' : '216', setCode: 'OBF' });
  let triggerAppApi, triggerDb, triggerApp, aggregate;

  beforeAll(async () => {
    assertTestEnvironment(process.env);
    expect(process.env.GCLOUD_PROJECT).toBe('demo-domidex-privacy');
    expect(process.env.GOOGLE_CLOUD_PROJECT).toBe('demo-domidex-privacy');
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8187');
    expect(process.env.FIREBASE_CONFIG).toBeUndefined();
    // Match the canonical backend's installed SDK, including its nested package.
    // Root must retain the existing fresh process / no-credential environment.
    const entry = new URL('../backend/scan-knowledge/index.js', import.meta.url);
    const resolve = createRequire(entry);
    triggerAppApi = await import(pathToFileURL(resolve.resolve('firebase-admin/app')).href);
    const firestoreApi = await import(pathToFileURL(resolve.resolve('firebase-admin/firestore')).href);
    expect(triggerAppApi.getApps().some((candidate) => candidate.name === '[DEFAULT]')).toBe(false);
    // index.js genuinely calls initializeApp() and registers the Cloud Function.
    // The pinned demo project variables and loopback guard were checked first.
    try {
      ({ aggregateScanKnowledge: aggregate } = await import('../backend/scan-knowledge/index.js'));
    } finally {
      // We proved this registry had no default app before this import, so even
      // a later module-initialization error must release our newly created app.
      triggerApp = triggerAppApi.getApps().find((candidate) => candidate.name === '[DEFAULT]');
    }
    expect(triggerApp).toBeDefined();
    expect(triggerApp.options.projectId ?? process.env.GCLOUD_PROJECT).toBe('demo-domidex-privacy');
    expect(typeof aggregate.run).toBe('function');
    triggerDb = firestoreApi.getFirestore(triggerApp);
  });

  afterAll(async () => {
    const failures = [];
    try { if (triggerDb) await triggerDb.terminate(); } catch (error) { failures.push(error); }
    try { if (triggerApp) await triggerAppApi.deleteApp(triggerApp); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'OWNED_KNOWLEDGE_SDK_CLEANUP_FAILED');
  });

  const evidenceFor = (fingerprint, cardId, observedAtClient) => ({
    fingerprint, confirmedCardId: cardId, observedAtClient, corrected: false,
    ...identity(cardId), knowledgeVersion: 1,
  });
  async function capture(fingerprint, uid, cardId, time) {
    const ref = triggerDb.doc(`users/${uid}/scanEvidence/${fingerprint}`);
    await ref.set(evidenceFor(fingerprint, cardId, time));
    const after = await ref.get();
    expect(after.exists).toBe(true);
    expect(after.data()).toEqual(evidenceFor(fingerprint, cardId, time));
    expect(after.updateTime).toBeDefined();
    // Only the event envelope is manually constructed. after/ref/updateTime are
    // genuine server snapshots from the same SDK that the callback will use.
    return { params: { uid, fingerprint }, data: { after } };
  }
  async function graph(fingerprint) {
    // Separate existing Admin instance independently reads the stored outcome.
    const privateRef = context.db.doc(`scanKnowledgePrivate/${fingerprint}`);
    const [summary, publicDoc, contributors] = await Promise.all([
      privateRef.get(), context.db.doc(`scanKnowledge/${fingerprint}`).get(),
      privateRef.collection('contributors').get(),
    ]);
    const record = (snapshot) => ({ exists: snapshot.exists, data: snapshot.data(), updateTime: snapshot.updateTime });
    return {
      summary: record(summary), public: record(publicDoc),
      contributors: contributors.docs.map((snapshot) => ({ id: snapshot.id, ...record(snapshot) }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    };
  }
  function assertTimestamp(value) {
    expect(Number.isSafeInteger(value?.seconds)).toBe(true);
    expect(value.seconds).toBeGreaterThan(0);
    expect(Number.isSafeInteger(value?.nanoseconds)).toBe(true);
    expect(value.nanoseconds).toBeGreaterThanOrEqual(0);
    expect(value.nanoseconds).toBeLessThan(1_000_000_000);
  }
  function assertStable(fingerprint, state) {
    expect(state.summary.exists).toBe(true); expect(state.public.exists).toBe(true);
    assertTimestamp(state.summary.data.lastUpdatedAt);
    assertTimestamp(state.public.data.lastUpdatedAt);
    expect(state.summary.data).toEqual({
      votes: { [firstCard]: 3 }, correctionVotes: {}, identities: { [firstCard]: identity(firstCard) },
      total: 3, knowledgeVersion: 1, lastUpdatedAt: state.summary.data.lastUpdatedAt,
    });
    expect(state.public.data).toEqual({
      fingerprint, cardId: firstCard, ...identity(firstCard), status: 'STABLE',
      confidence: 100, confirmations: 3, corrections: 0, manualCorrections: 0,
      knowledgeVersion: 1, lastUpdatedAt: state.public.data.lastUpdatedAt,
    });
    expect(state.contributors.map(({ id }) => id)).toEqual(owners.map(uidHash).sort());
    for (const item of state.contributors) {
      expect(item.exists).toBe(true); assertTimestamp(item.data.updatedAt);
      expect(item.data).toEqual({ cardId: firstCard, corrected: false, ...identity(firstCard),
        observedAtClient: 1000, updatedAt: item.data.updatedAt });
    }
  }

  it('persists concurrent canonical knowledge votes and makes exact redelivery a server no-op', async () => {
    const fingerprint = 'd'.repeat(64);
    expect(await graph(fingerprint)).toEqual({
      summary: { exists: false, data: undefined, updateTime: undefined },
      public: { exists: false, data: undefined, updateTime: undefined }, contributors: [],
    });
    const events = await Promise.all(owners.map((uid) => capture(fingerprint, uid, firstCard, 1000)));
    // Real Firestore runTransaction/default retry behavior. No manually forced
    // commit, inflated maxAttempts or swallowed ABORTED/unavailable result.
    await Promise.all(events.map((event) => aggregate.run(event)));
    const confirmed = await graph(fingerprint);
    assertStable(fingerprint, confirmed);
    await Promise.all(events.map((event) => aggregate.run(event)));
    expect(await graph(fingerprint)).toEqual(confirmed); // Includes server updateTimes.
    for (let index = 0; index < owners.length; index++) {
      const current = await context.db.doc(`users/${owners[index]}/scanEvidence/${fingerprint}`).get();
      expect(current.data()).toEqual(evidenceFor(fingerprint, firstCard, 1000));
      // Root and backend can install distinct SDK package instances. Compare the
      // timestamp value, not an SDK instanceof-based cross-package isEqual.
      expect([current.updateTime.seconds, current.updateTime.nanoseconds]).toEqual([
        events[index].data.after.updateTime.seconds, events[index].data.after.updateTime.nanoseconds,
      ]);
    }
  });

  it('uses real evidence versions and deletion locks before changing persisted knowledge', async () => {
    const fingerprint = 'e'.repeat(64);
    const originals = await Promise.all(owners.map((uid) => capture(fingerprint, uid, firstCard, 1000)));
    await Promise.all(originals.map((event) => aggregate.run(event)));
    const stable = await graph(fingerprint); assertStable(fingerprint, stable);
    const updated = await capture(fingerprint, owners[0], secondCard, 2000);
    expect(updated.data.after.updateTime.isEqual(originals[0].data.after.updateTime)).toBe(false);
    await aggregate.run(originals[0]);
    expect(await graph(fingerprint)).toEqual(stable);
    const lock = context.db.doc(`accountDeletionLocks/${owners[0]}`);
    await lock.create({ fixture: 'knowledge-actual-transaction' });
    await aggregate.run(updated);
    expect(await graph(fingerprint)).toEqual(stable);
    await lock.delete(); // Exact synthetic fixture only; not a production deletion.
    await aggregate.run(updated); // Positive control: the same valid version now applies.
    const corrected = await graph(fingerprint);
    expect(corrected.summary.data).toEqual({
      votes: { [firstCard]: 2, [secondCard]: 1 }, correctionVotes: {},
      identities: { [firstCard]: identity(firstCard), [secondCard]: identity(secondCard) },
      total: 3, knowledgeVersion: 1, lastUpdatedAt: corrected.summary.data.lastUpdatedAt,
    });
    expect(corrected.public.data).toEqual({ fingerprint, cardId: firstCard, ...identity(firstCard),
      status: 'DISPUTED', confidence: 67, confirmations: 2, corrections: 1, manualCorrections: 0,
      knowledgeVersion: 1, lastUpdatedAt: corrected.public.data.lastUpdatedAt });
    assertTimestamp(corrected.summary.data.lastUpdatedAt); assertTimestamp(corrected.public.data.lastUpdatedAt);
    expect(corrected.contributors).toHaveLength(3);
    for (const item of corrected.contributors) {
      const original = stable.contributors.find(({ id }) => id === item.id);
      expect(original).toBeDefined();
      if (item.id === uidHash(owners[0])) {
        assertTimestamp(item.data.updatedAt);
        expect(item.data).toEqual({ cardId: secondCard, corrected: false, ...identity(secondCard),
          observedAtClient: 2000, updatedAt: item.data.updatedAt });
      } else expect(item).toEqual(original);
    }
    await aggregate.run(updated);
    expect(await graph(fingerprint)).toEqual(corrected);
  });
});

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
  it('uses genuine SDK field masks for shared entries without fetching private payload or losing missing snapshots', async () => {
    await seed();
    const entryPath = 'users/owner-a/collectionEntries/entry-a';
    await context.db.doc(entryPath).update({ syncId: 'entry-a', language: 'DE', externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD' });
    await context.db.doc('users/owner-a/privateBinderPlacements/missing-placement').set({
      ownerUid: 'owner-a', binderId: 'binder-a', entrySyncId: 'missing-entry', slotPosition: 2, deleted: false,
    });
    const before = (await context.db.doc(entryPath).get()).data();
    const created = await make({ showPrices: true, showTotal: true });
    const batches = [];
    const observedContext = { ...context, db: {
      doc: context.db.doc.bind(context.db), collection: context.db.collection.bind(context.db),
      getAll: async (...args) => {
        // Observe the real Admin SDK result; do not emulate or replace its projection.
        const snapshots = await context.db.getAll(...args);
        batches.push({ paths: args.filter(ref => typeof ref?.path === 'string').map(ref => ref.path),
          options: args.at(-1)?.fieldMask,
          snapshots: snapshots.map(doc => ({ id: doc.id, exists: doc.exists, data: doc.data() })) });
        return snapshots;
      },
    } };
    const response = await readBinderShare(new Request('http://localhost/shared'),
      { params: Promise.resolve({ token: created.path.split('/').pop() }) }, observedContext);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({ cardId: 'sv1-200', slot: 1, finish: 'Normal', price: { amount: 2.5 } });
    expect(body.total).toEqual({ amount: 2.5, currency: 'EUR', complete: true, pricedCards: 1, visibleCards: 1 });
    expect(body.unavailableSlots).toEqual([]);
    expect((await context.db.doc(entryPath).get()).data()).toEqual(before);
    expect(batches).toHaveLength(1); // A real trend price must not read private selections.
    expect([...batches[0].paths].sort((left, right) => left.localeCompare(right))).toEqual([entryPath, 'users/owner-a/collectionEntries/missing-entry']);
    expect(batches[0].snapshots.find(doc => doc.id === 'missing-entry')).toEqual({ id: 'missing-entry', exists: false, data: undefined });
    const expectedFields = ['ownerUid', 'syncId', 'deleted', 'quantity', 'sourceCardId', 'sourceSetId', 'setId',
      'collectorNumber', 'language', 'finish', 'variant', 'externalProductSource', 'externalProductId'];
    expect(batches[0].options, 'SHARED_ENTRY_SDK_FIELD_MASK_REQUIRED').toEqual(expectedFields);
    const actual = batches[0].snapshots.find(doc => doc.id === 'entry-a');
    expect(actual.exists).toBe(true);
    expect(actual.data).toEqual(Object.fromEntries(expectedFields.map(field => [field, before[field]])));
    expect(JSON.stringify(actual.data)).not.toMatch(/PRIVATE_|private.invalid|acquisitionPriceMinor|imageUrl/);
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
    expect((await context.db.doc('accountAccess/owner-a').get()).get('disabled')).toBe(true);
    expect((await context.db.doc('users/owner-a/collectionEntries/one').get()).exists).toBe(false);
    context.now = () => first.nextActionAt + 1000;
    const done = await advanceDeletion(context, 'owner-a', first.jobId);
    expect(done.status).toBe('COMPLETE');
    expect((await context.db.doc('accountAccess/owner-a').get()).exists).toBe(false);
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
  it('retains a fresh deletion access fence through session expiry and removes it on completion', async () => {
    const startedAt = Date.now();
    context.now = () => startedAt;
    const access = context.db.doc('accountAccess/owner-a');
    const foreignAccess = context.db.doc('accountAccess/owner-b');
    const foreignData = { appAccess: true, pretester: false, label: 'synthetic-foreign-keep' };
    await access.set({ appAccess: true, pretester: true, lease: 'synthetic-old-lease',
      leaseUntil: startedAt - 1, label: 'synthetic-private-remove' });
    await foreignAccess.set(foreignData);
    const owned = context.db.doc('users/owner-a/preferences/private');
    await owned.set({ setting: 'synthetic-owned-remove' });
    const response = await deletionRequest(request(tokens.a, { confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context);
    expect(response.status).toBe(202);
    const first = await response.json();
    expect(first.status).toBe('PENDING_SESSION_EXPIRY');
    expect(first.nextActionAt).toBe(startedAt + 65 * 60_000);
    const fence = { disabled: true, updatedAt: startedAt };
    expect((await access.get()).data()).toEqual(fence);
    expect((await owned.get()).exists).toBe(false);
    expect((await foreignAccess.get()).data()).toEqual(foreignData);
    expect((await context.auth.getUser('owner-a')).disabled).toBe(true);
    const lock = context.db.doc('accountDeletionLocks/owner-a');
    expect((await lock.get()).data()).toEqual({ jobId: first.jobId, startedAt });
    const job = context.db.doc(`accountDeletionJobs/${first.jobId}`);
    const initialItems = (await job.collection('items').get()).docs;
    const accessItems = initialItems.filter(item => item.get('kind') === 'document' && item.get('path') === access.path);
    expect(accessItems).toHaveLength(1);
    expect(accessItems[0].data()).toEqual({ kind: 'document', path: access.path, done: false });
    expect(initialItems.every(item => item.get('kind') === 'document')).toBe(true);
    const receipt = context.db.doc(`accountDeletionReceipts/${first.jobId}`);
    expect((await receipt.get()).exists).toBe(false);

    context.now = () => first.nextActionAt - 1;
    expect(await advanceDeletion(context, 'owner-a', first.jobId)).toEqual({
      jobId: first.jobId, status: 'PENDING_SESSION_EXPIRY', nextActionAt: first.nextActionAt,
    });
    expect((await access.get()).data()).toEqual(fence);
    expect((await accessItems[0].ref.get()).data()).toEqual({ kind: 'document', path: access.path, done: false });
    expect((await lock.get()).data()).toEqual({ jobId: first.jobId, startedAt });
    expect((await receipt.get()).exists).toBe(false);

    context.now = () => first.nextActionAt;
    const done = await advanceDeletion(context, 'owner-a', first.jobId);
    expect(done.status).toBe('COMPLETE');
    expect((await access.get()).exists).toBe(false);
    expect((await lock.get()).exists).toBe(false);
    expect((await job.get()).exists).toBe(false);
    expect((await job.collection('items').get()).empty).toBe(true);
    expect((await receipt.get()).get('status')).toBe('COMPLETE');
    expect((await receipt.get()).get('counts.document')).toBe(initialItems.length);
    await expect(context.auth.getUser('owner-a')).rejects.toMatchObject({ code: 'auth/user-not-found' });
    expect((await context.auth.getUser('owner-b')).disabled).toBe(false);
    expect((await foreignAccess.get()).data()).toEqual(foreignData);
  }, 45_000);
  it('records partial failure, retries safely, and never reports provider retention as complete', async () => {
    await seedAccount();
    context.beforeDelete = () => { throw new Error('INJECTED_FAILURE'); };
    const first = await (await deletionRequest(request(tokens.admin, { uid: 'owner-a', confirm: 'DELETE_DOMIDEX_ACCOUNT' }), context)).json();
    expect(first.status).toBe('PARTIAL_FAILURE');
    expect((await context.db.doc('users/owner-a/collectionEntries/one').get()).exists).toBe(true);
    expect((await context.db.doc('accountAccess/owner-a').get()).get('disabled')).toBe(true);
    expect((await context.db.doc(anchorQuotaPath('owner-a')).get()).exists).toBe(true);
    delete context.beforeDelete;
    const job = (await context.db.doc(`accountDeletionJobs/${first.jobId}`).get()).data();
    context.now = () => job.settleAfter + 1000;
    context.bucket.getMetadata = async () => [{ softDeletePolicy: { retentionDurationSeconds: '604800' } }];
    const resumed = await advanceDeletion(context, 'owner-a', first.jobId);
    expect(resumed.status).toBe('ACTIVE_DATA_DELETED_PENDING_PROVIDER_RETENTION');
    expect((await context.db.doc('accountAccess/owner-a').get()).exists).toBe(false);
    expect((await context.db.doc('accountDeletionLocks/owner-a').get()).get('jobId')).toBe(first.jobId);
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
    const firstFence = (await context.db.doc('accountAccess/owner-a').get()).data();
    expect(firstFence).toEqual({ disabled: true, updatedAt: expect.any(Number) });
    const later = Date.now() + 70 * 60_000;
    context.now = () => later;
    const result = await advanceDeletion(context, 'owner-a', first.jobId);
    expect(result.status).toBe('PENDING_SESSION_EXPIRY');
    expect(result.nextActionAt).toBe(later + 65 * 60_000);
    expect((await context.auth.getUser('owner-a')).disabled).toBe(true);
    expect((await context.db.doc('accountAccess/owner-a').get()).data()).toEqual(firstFence);
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
      expect((await context.db.doc('accountAccess/owner-a').get()).exists).toBe(false);
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
      expect((await context.db.doc('accountAccess/owner-a').get()).exists).toBe(false);
    } finally { context.db.recursiveDelete = cleanup; }
    expect((await advanceDeletion(context, 'owner-a', first.jobId)).status).toBe('COMPLETE');
    expect((await context.db.doc('accountAccess/owner-a').get()).exists).toBe(false);
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

describe('Web collection add: actual local Google SDK transactions', () => {
  const owner = 'web-add-sdk-owner';
  const email = 'web-add-sdk@example.invalid';
  const googleUid = 'web-add-sdk-google';
  const first = { type: 'Holo', size: 'Standard', variantId: 'printing-one',
    thirdParty: { cardmarket: 900001 }, pricing: { cardmarket: { idProduct: 900001, unit: 'EUR', trend: 4.56 } } };
  const second = { type: 'Holo', size: 'Standard', variantId: 'printing-two',
    thirdParty: { cardmarket: 900002 }, pricing: { cardmarket: { idProduct: 900002, unit: 'EUR', trend: 12.34 } } };
  const card = { id: 'identity-proof-001', localId: '001', name: 'Synthetic SDK card',
    set: { id: 'identity-proof', name: 'Synthetic SDK set' }, variants_detailed: [first, second] };
  // Independent Node MD5 oracle; never call the product UUID helper to predict
  // the document key. Both positive products intentionally have this same key.
  const bytes = createHash('md5').update([owner, 'identity-proof', 'identity-proof-001',
    'Near Mint', 'Holo', 'Standard'].map(value => value.trim().toLowerCase()).join('|')).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  const syncId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const entryPath = `users/${owner}/collectionEntries/${syncId}`;
  const rejection = 'Die gespeicherte Karte gehört zu einer anderen Druckvariante. Bitte prüfe die Variante vor dem erneuten Hinzufügen.';
  const normalize = value => {
    if (value && typeof value.toMillis === 'function' && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)) {
      return { seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    return value;
  };

  async function adminReadback() {
    const documents = {};
    let inspected = 0;
    async function visit(collections, depth = 0) {
      if (depth > 8) throw Error('Unexpected fixture depth');
      for (const collection of collections) for (const reference of await collection.listDocuments()) {
        if (++inspected > 100) throw Error('Unexpected fixture size');
        const snapshot = await reference.get();
        if (snapshot.exists) documents[reference.path] = normalize(snapshot.data());
        // Also visit subcollections of missing parent documents.
        await visit(await reference.listCollections(), depth + 1);
      }
    }
    await visit(await context.db.listCollections());
    const listed = await context.auth.listUsers(100);
    expect(listed.pageToken).toBeUndefined();
    const users = listed.users.map(user => ({ uid: user.uid, email: user.email,
      emailVerified: user.emailVerified, disabled: user.disabled, customClaims: user.customClaims ?? {},
      providerData: user.providerData.map(provider => ({ providerId: provider.providerId, uid: provider.uid, email: provider.email })) }))
      .sort((a, b) => a.uid.localeCompare(b.uid));
    const [files] = await context.bucket.getFiles();
    return { documents, users, storageNames: files.map(file => file.name).sort() };
  }

  function assertCreated(data, started, finished) {
    expect(data.lastMutationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.isInteger(data.updatedAtClient)).toBe(true);
    expect(data.updatedAtClient).toBeGreaterThanOrEqual(started);
    expect(data.updatedAtClient).toBeLessThanOrEqual(finished);
    expect(Number.isInteger(data.updatedAt?.seconds)).toBe(true);
    expect(Number.isInteger(data.updatedAt?.nanoseconds)).toBe(true);
    expect(data.updatedAt.nanoseconds).toBeGreaterThanOrEqual(0);
    expect(data.updatedAt.nanoseconds).toBeLessThan(1_000_000_000);
    const serverMs = data.updatedAt.seconds * 1000 + data.updatedAt.nanoseconds / 1_000_000;
    expect(serverMs).toBeGreaterThanOrEqual(started - 1000);
    expect(serverMs).toBeLessThanOrEqual(finished + 1000);
    expect(data).toEqual({ syncId, ownerUid: owner, revision: 1,
      lastMutationId: data.lastMutationId, updatedAt: data.updatedAt, updatedAtClient: data.updatedAtClient,
      deleted: false, deletedAtClient: null, name: 'Synthetic SDK card', setId: 'identity-proof',
      setName: 'Synthetic SDK set', collectorNumber: '001', language: 'GERMAN', finish: 'Holo',
      variant: 'Standard', rarity: 'UNKNOWN', quantity: 2, condition: 'Near Mint', notes: '',
      acquisitionPriceMinor: null, acquisitionCurrency: null, acquisitionDateEpochDay: null,
      externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: 900001,
      imageUrl: null, effectOverride: null, binderId: 'tcgdex-identity-proof',
      sourceSetId: 'identity-proof', sourceCardId: 'identity-proof-001', binderSetKey: 'tcgdex-identity-proof',
      binderName: 'Synthetic SDK set', binderHeroAsset: null });
  }

  async function withClient(caseName, exercise) {
    assertTestEnvironment(process.env);
    expect(exactCardmarketProductId(card, first)).toBe(900001);
    expect(exactCardmarketProductId(card, second)).toBe(900002);
    expect(collectionSyncIdForExactCard(owner, card, first, [])).toBe(syncId);
    expect(collectionSyncIdForExactCard(owner, card, second, [])).toBe(syncId);
    const directory = process.env.DOMIDEX_PRIVATE_TEST_RUN;
    expect(path.isAbsolute(directory ?? '') && path.basename(path.dirname(directory)) === 'private-operations-local').toBe(true);
    const originalApps = getApps().map(value => value.name).sort();
    expect(originalApps).not.toContain('[DEFAULT]');
    const original = await adminReadback();
    expect(original.documents).toEqual({}); expect(original.storageNames).toEqual([]);
    expect(original.users.map(user => user.uid)).toEqual(['operator', 'owner-a', 'owner-b']);
    let client, auth, db, ownedUser = false;
    const failures = [];
    const proof = { caseName, project: projectId, owner, entryPath, actualProductFunction: 'addExactCard',
      rpcMocked: false, initial: original, stages: [], passed: false, cleanupComplete: false };
    try {
      const imported = await context.auth.importUsers([{ uid: owner, email, emailVerified: true, disabled: false,
        providerData: [{ providerId: 'google.com', uid: googleUid, email }], customClaims: { appAccess: true } }]);
      ownedUser = imported.successCount === 1;
      expect(imported).toMatchObject({ successCount: 1, failureCount: 0, errors: [] });
      client = initializeClientApp({ projectId, apiKey: 'demo-only-api-key', appId: '1:1234567890:web:addproof' }, `web-add-${caseName}-${randomUUID()}`);
      auth = getClientAuth(client); connectAuthEmulator(auth, 'http://127.0.0.1:9097', { disableWarnings: true });
      db = initializeFirestore(client, { localCache: memoryLocalCache() }); connectFirestoreEmulator(db, '127.0.0.1', 8187);
      webAddSdk.firestore = db;
      const signedIn = await signInWithCredential(auth,
        GoogleAuthProvider.credential(JSON.stringify({ sub: googleUid, email, email_verified: true })));
      expect(signedIn.user.uid).toBe(owner);
      expect(signedIn.user.providerData.map(provider => ({ providerId: provider.providerId, uid: provider.uid, email: provider.email })))
        .toEqual([{ providerId: 'google.com', uid: googleUid, email }]);
      const claims = (await signedIn.user.getIdTokenResult(true)).claims;
      expect(claims.appAccess).toBe(true); expect(claims.admin).toBeUndefined(); expect(claims.pretester).toBeUndefined();
      expect(claims.firebase.sign_in_provider).toBe('google.com');
      const before = await adminReadback();
      expect(before).toEqual({ ...original, users: [...original.users, { uid: owner, email, emailVerified: true,
        disabled: false, customClaims: { appAccess: true }, providerData: [{ providerId: 'google.com', uid: googleUid, email }] }]
        .sort((a, b) => a.uid.localeCompare(b.uid)) });
      proof.stages.push({ phase: 'signed-in-empty', server: before });
      const readServer = async phase => {
        const snapshot = await getDocFromServer(doc(db, entryPath));
        expect(snapshot.exists()).toBe(true); expect(snapshot.metadata.fromCache).toBe(false);
        expect(snapshot.metadata.hasPendingWrites).toBe(false);
        const server = await adminReadback();
        expect(server.users).toEqual(before.users); expect(server.storageNames).toEqual([]);
        expect(Object.keys(server.documents)).toEqual([entryPath]);
        expect(normalize(snapshot.data())).toEqual(server.documents[entryPath]);
        proof.stages.push({ phase, server });
        return server;
      };
      const started = Date.now();
      expect(await addExactCard(signedIn.user, card, first, 2, [])).toBe(4.56);
      const finished = Date.now();
      const created = await readServer('created');
      assertCreated(created.documents[entryPath], started, finished);
      await exercise({ user: signedIn.user, created, readServer });
    } catch (error) { failures.push(error); }
    finally {
      // Attempt every owned cleanup even after an assertion/RPC failure. No
      // generic user/database delete; only the exact fixture document and user.
      for (const cleanup of [() => db && terminate(db), () => auth && signOut(auth),
        () => client && deleteClientApp(client), () => ownedUser && context.db.doc(entryPath).delete(),
        () => ownedUser && context.auth.deleteUser(owner)]) {
        try { await cleanup(); } catch (error) { failures.push(error); }
      }
      webAddSdk.firestore = undefined;
      try {
        expect(getApps().map(value => value.name).sort()).toEqual(originalApps);
        proof.cleaned = await adminReadback(); expect(proof.cleaned).toEqual(original);
        proof.cleanupComplete = true;
      } catch (error) { failures.push(error); }
    }
    proof.passed = failures.length === 0;
    writeFileSync(path.join(directory, `web-add-${caseName}-proof.json`), JSON.stringify(proof, null, 2), { flag: 'wx' });
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Web add SDK case/cleanup failed');
  }

  it('creates then increments the same printing through the actual Web SDK and unchanged Rules', async () => {
    await withClient('create-increment', async ({ user, created, readServer }) => {
      const previous = created.documents[entryPath];
      const started = Date.now();
      expect(await addExactCard(user, card, first, 3, [])).toBe(4.56);
      const finished = Date.now();
      const changed = await readServer('incremented');
      const next = changed.documents[entryPath];
      assertCreated({ ...next, quantity: 2, revision: 1 }, started, finished);
      expect(next.lastMutationId).not.toBe(previous.lastMutationId);
      expect(next).toEqual({ ...previous, quantity: 5, revision: 2,
        lastMutationId: next.lastMutationId, updatedAt: next.updatedAt, updatedAtClient: next.updatedAtClient });
      const previousNs = BigInt(previous.updatedAt.seconds) * 1_000_000_000n + BigInt(previous.updatedAt.nanoseconds);
      const nextNs = BigInt(next.updatedAt.seconds) * 1_000_000_000n + BigInt(next.updatedAt.nanoseconds);
      expect(nextNs).toBeGreaterThanOrEqual(previousNs);
    });
  });

  it('rejects a colliding positive product for empty and stale current without any server mutation', async () => {
    await withClient('collision', async ({ user, created, readServer }) => {
      const stored = created.documents[entryPath];
      const stale = [{ ...stored, externalProductId: 900002, quantity: 99 }];
      const staleBefore = JSON.stringify(stale);
      expect(collectionSyncIdForExactCard(owner, card, second, stale)).toBe(syncId);
      for (const [phase, current] of [['rejected-empty', []], ['rejected-stale', stale]]) {
        await expect(addExactCard(user, card, second, 3, current)).rejects.toThrow(rejection);
        // Full document/timestamp/mutation/quantity and complete database+Auth
        // identity inventory, not merely price or a successful promise count.
        expect(await readServer(phase)).toEqual(created);
      }
      expect(JSON.stringify(stale)).toBe(staleBefore);
    });
  });
});
