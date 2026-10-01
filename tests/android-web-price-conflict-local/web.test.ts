import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, getApps, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential, signOut, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDocFromServer, initializeFirestore, memoryLocalCache, terminate, type Firestore } from 'firebase/firestore';
import { PROJECT, OWNER, EMAIL, GOOGLE_UID, PARENT_PATH, CHOICE_PATH, ENTRY, WEB_PHASES,
  assertChoice, normalize, validRunId, validResolution, parentFixture } from './contract.mjs';
import { assertTestEnvironment } from '../private-operations-local/safety.mjs';
import type { CollectionPriceSelection } from '../../lib/price-alternatives';

// Only the named SDK initializer is substituted. Product subscribe/save, codecs,
// Auth, Firestore transaction, permissions and all network RPCs are genuine.
const injected = vi.hoisted(() => ({ firestore: undefined as Firestore | undefined }));
vi.mock('../../lib/firebase-client', () => ({
  get firestore() { if (!injected.firestore) throw Error('Named SDK not initialized'); return injected.firestore; },
}));
import { subscribeCollectionPriceSelections, saveCollectionPriceSelection,
  decodeCollectionPriceSelection } from '../../lib/collection-price-selections';

const phase = process.env.DOMIDEX_PRICE_CONFLICT_WEB_PHASE as 'save' | 'verify';
if (!Object.hasOwn(WEB_PHASES, phase)) throw Error('Use isolated conflict driver');
const runId = validRunId(process.env.DOMIDEX_PRICE_CONFLICT_RUN_ID);
const resolution = validResolution(process.env.DOMIDEX_PRICE_CONFLICT_RESOLUTION);
const directory = process.env.DOMIDEX_PRIVATE_TEST_RUN!;
const originalApps = getApps().map(app => app.name).sort();
let app: FirebaseApp; let auth: Auth; let db: Firestore; let unsubscribe: (() => void) | undefined;
const timers = new Set<ReturnType<typeof setTimeout>>();
function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { timers.delete(timer); reject(Error(`${label} timed out`)); }, 20_000);
    timers.add(timer);
    promise.then(value => { clearTimeout(timer); timers.delete(timer); resolve(value); }, error => {
      clearTimeout(timer); timers.delete(timer); reject(error);
    });
  });
}
beforeAll(async () => {
  assertTestEnvironment(process.env);
  assert.ok(path.isAbsolute(directory) && path.basename(path.dirname(directory)) === 'android-web-price-conflict-local');
  assert.ok(!originalApps.includes('[DEFAULT]'));
  app = initializeApp({ projectId: PROJECT, apiKey: 'demo-only-api-key', appId: '1:1234567890:web:priceconflict' },
    `price-conflict-web-${resolution}-${phase}-${runId}`);
  auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9097', { disableWarnings: true });
  db = initializeFirestore(app, { localCache: memoryLocalCache() }); connectFirestoreEmulator(db, '127.0.0.1', 8187);
  injected.firestore = db;
  // Literal JSON credential is understood only by the Auth emulator, never a production token.
  const signedIn = await bounded(signInWithCredential(auth,
    GoogleAuthProvider.credential(JSON.stringify({ sub: GOOGLE_UID, email: EMAIL, email_verified: true }))), 'local Google sign-in');
  expect(signedIn.user.uid).toBe(OWNER); expect(signedIn.user.email).toBe(EMAIL); expect(signedIn.user.emailVerified).toBe(true);
  expect(signedIn.user.providerData.map(({ providerId, uid, email }) => ({ providerId, uid, email })))
    .toEqual([{ providerId: 'google.com', uid: GOOGLE_UID, email: EMAIL }]);
  const claims = (await bounded(signedIn.user.getIdTokenResult(true), 'claims')).claims;
  expect(claims.appAccess).toBe(true); expect(claims.admin).toBeUndefined(); expect(claims.pretester).toBeUndefined();
  expect(claims.firebase?.sign_in_provider).toBe('google.com');
});
afterAll(async () => {
  const errors: unknown[] = [];
  try { unsubscribe?.(); } catch (error) { errors.push(error); }
  for (const timer of timers) clearTimeout(timer); timers.clear();
  try { if (db) await bounded(terminate(db), 'terminate named Firestore'); } catch (error) { errors.push(error); }
  try { if (auth) await bounded(signOut(auth), 'sign out named Auth'); } catch (error) { errors.push(error); }
  try { if (app) await bounded(deleteApp(app), 'delete named Firebase app'); } catch (error) { errors.push(error); }
  injected.firestore = undefined;
  try { expect(getApps().map(value => value.name).sort()).toEqual(originalApps); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'Named conflict Web SDK cleanup failed');
});
it(WEB_PHASES[phase], async () => {
  const revision = phase === 'save' ? 1 : resolution === 'cloud' ? 2 : 3;
  const before = await bounded(getDocFromServer(doc(db, CHOICE_PATH)), 'before server read');
  expect(before.exists()).toBe(true); expect(before.metadata.fromCache).toBe(false); expect(before.metadata.hasPendingWrites).toBe(false);
  const previous = assertChoice(before.data(), revision);
  const parentRead = await bounded(getDocFromServer(doc(db, PARENT_PATH)), 'parent read');
  expect(parentRead.metadata.fromCache).toBe(false); expect(parentRead.metadata.hasPendingWrites).toBe(false);
  const parent = normalize(parentRead.data()); expect(parent).toEqual(parentFixture({ seconds: 1700000000, nanoseconds: 0 }));
  const seen: Record<number, CollectionPriceSelection> = {};
  const waiters = new Map<number, { resolve: (value: CollectionPriceSelection) => void; reject: (error: Error) => void }>();
  let subscriptionError: Error | undefined;
  const awaitRevision = (wanted: number) => subscriptionError ? Promise.reject(subscriptionError) : seen[wanted] ? Promise.resolve(seen[wanted]) : bounded(
    new Promise<CollectionPriceSelection>((resolve, reject) => { waiters.set(wanted, { resolve, reject }); }), `subscription revision ${wanted}`);
  unsubscribe = await subscribeCollectionPriceSelections(OWNER, selections => {
    const value = selections[ENTRY]; if (!value) return;
    seen[value.revision] = value; waiters.get(value.revision)?.resolve(value); waiters.delete(value.revision);
  }, error => { subscriptionError = error; for (const waiter of waiters.values()) waiter.reject(error); waiters.clear(); });
  expect(await awaitRevision(revision)).toEqual(decodeCollectionPriceSelection(before.data()!, ENTRY, OWNER));
  const writeStartedAt = phase === 'save' ? Date.now() : null;
  if (phase === 'save') await bounded(saveCollectionPriceSelection(auth.currentUser!, ENTRY, {
    metric: 'normal_low', label: 'Niedrigster verfügbarer Preis', productId: 42, amountMinor: 450, currency: 'EUR', sourceAt: 1000,
  }), 'actual Web save');
  const writeFinishedAt = phase === 'save' ? Date.now() : null;
  const after = await bounded(getDocFromServer(doc(db, CHOICE_PATH)), 'after server read');
  expect(after.metadata.fromCache).toBe(false); expect(after.metadata.hasPendingWrites).toBe(false);
  const finalRevision = phase === 'save' ? 2 : revision;
  const choice = assertChoice(after.data(), finalRevision);
  if (phase === 'save') {
    expect(choice.lastMutationId).not.toBe(previous.lastMutationId);
    expect(choice.updatedAtClient).toBeGreaterThanOrEqual(writeStartedAt!); expect(choice.updatedAtClient).toBeLessThanOrEqual(writeFinishedAt!);
  } else expect(choice).toEqual(previous);
  expect(await awaitRevision(finalRevision)).toEqual(decodeCollectionPriceSelection(after.data()!, ENTRY, OWNER));
  const parentAfter = await bounded(getDocFromServer(doc(db, PARENT_PATH)), 'unchanged parent');
  expect(parentAfter.metadata.fromCache).toBe(false); expect(parentAfter.metadata.hasPendingWrites).toBe(false);
  expect(normalize(parentAfter.data())).toEqual(parent);
  writeFileSync(path.join(directory, `web-${phase}-proof.json`), JSON.stringify({ project: PROJECT, runId, resolution, phase,
    verified: true, actualProductFunctions: true, rpcMocked: false, defaultAppInitialized: false,
    before: previous, choice, parent, subscribedRevisions: phase === 'save' ? [1, 2] : [revision],
    writeStartedAt, writeFinishedAt }, null, 2));
});
