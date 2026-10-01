import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createWriteRateLimiter, rateLimitDocumentId } from '../backend/security/rate-limit.mjs';

const projectId = 'demo-domidex-rate-limit';
let firstApp, secondApp, firstDb, secondDb;
beforeAll(() => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw Error('LOCAL_FIRESTORE_REQUIRED');
  firstApp = initializeApp({ projectId }, 'rate-limit-instance-one');
  secondApp = initializeApp({ projectId }, 'rate-limit-instance-two');
  firstDb = getFirestore(firstApp);
  secondDb = getFirestore(secondApp);
});
beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  if (!response.ok) throw Error('LOCAL_RESET_FAILED');
});
afterAll(async () => { await Promise.all([deleteApp(firstApp), deleteApp(secondApp)]); });

describe('actual Firestore transaction budget shared by independent SDK instances', () => {
  it('allows exactly five parallel uploads, with no per-instance reset', async () => {
    const a = createWriteRateLimiter(firstDb, { mode: 'enforce', observe: () => {} });
    const b = createWriteRateLimiter(secondDb, { mode: 'enforce', observe: () => {} });
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b)('reportUpload', 'owner')));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(5);
    const rejected = results.filter(result => result.status === 'rejected');
    expect(rejected).toHaveLength(7);
    for (const result of rejected) expect(result.reason).toMatchObject({ status: 429, message: 'RATE_LIMITED' });
    const docs = await firstDb.collection('privateWriteRateLimits').get();
    expect(docs.size).toBe(1);
    expect(docs.docs[0].data().count).toBe(5);
    expect(docs.docs[0].data().expiresAt.toMillis()).toBeGreaterThan(docs.docs[0].data().windowStartedAt);
  }, 30_000);

  it('uses Firestore readTime and atomically resets a window that expired without TTL cleanup', async () => {
    const id = rateLimitDocumentId('reportUpload', 'owner');
    const reference = firstDb.doc(`privateWriteRateLimits/${id}`);
    await reference.set({ schemaVersion: 1, policy: 'reportUpload', count: 5, windowStartedAt: Date.now() - 700000, expiresAt: new Date(0) });
    await createWriteRateLimiter(secondDb, { mode: 'enforce' })('reportUpload', 'owner');
    const updated = await reference.get();
    expect(updated.data().count).toBe(1);
    expect(updated.data().windowStartedAt).toBeLessThanOrEqual(updated.readTime.toMillis());
    expect(updated.readTime.toMillis() - updated.data().windowStartedAt).toBeLessThan(10000);
  });

  it('does not resurrect quotas when deletion locks race across independent instances', async () => {
    const a = createWriteRateLimiter(firstDb, { mode: 'enforce', observe: () => {} });
    const b = createWriteRateLimiter(secondDb, { mode: 'enforce', observe: () => {} });
    const reference = firstDb.doc(`privateWriteRateLimits/${rateLimitDocumentId('reportUpload', 'owner')}`);
    const inflight = a('reportUpload', 'owner').catch(error => error);
    await secondDb.doc('accountDeletionLocks/owner').set({ jobId: 'deletion-test' });
    await reference.delete();
    await inflight;
    await expect(b('reportUpload', 'owner')).rejects.toMatchObject({ status: 403, message: 'ACCOUNT_DELETING' });
    expect((await reference.get()).exists).toBe(false);
    await b('reportUpload', 'other');
    expect((await firstDb.doc(`privateWriteRateLimits/${rateLimitDocumentId('reportUpload', 'other')}`).get()).exists).toBe(true);
  }, 30_000);
});
