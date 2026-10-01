import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, getApps, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential, signOut, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDocFromServer, initializeFirestore, memoryLocalCache, terminate, type Firestore } from 'firebase/firestore';
import { PROJECT, OWNER, EMAIL, GOOGLE_UID, PARENT_PATH, CHOICE_PATH, ENTRY, WEB_PHASES,
  assertChoice, normalize, validRunId } from './contract.mjs';
import { assertTestEnvironment } from '../private-operations-local/safety.mjs';
import type { CollectionPriceSelection } from '../../lib/price-alternatives';

// Only initialization is substituted. Every Firebase Auth/Firestore RPC, subscription,
// transaction, timestamp, codec and actual product operation remains real.
const injected = vi.hoisted(() => ({ firestore: undefined as Firestore | undefined }));
vi.mock('../../lib/firebase-client', () => ({
  get firestore() { if (!injected.firestore) throw Error('Named SDK not initialized'); return injected.firestore; },
}));
import { subscribeCollectionPriceSelections, saveCollectionPriceSelection, clearCollectionPriceSelection,
  decodeCollectionPriceSelection } from '../../lib/collection-price-selections';

const phase = process.env.DOMIDEX_PRICE_WEB_PHASE as 'save' | 'clear';
if (!Object.hasOwn(WEB_PHASES, phase)) throw Error('Run only through the isolated roundtrip driver');
const runId = validRunId(process.env.DOMIDEX_PRICE_RUN_ID);
const directory = process.env.DOMIDEX_PRIVATE_TEST_RUN!;
const originalApps = getApps().map(app => app.name).sort();
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let unsubscribe: (() => void) | undefined;
const timers = new Set<ReturnType<typeof setTimeout>>();
function bounded<T>(promise: Promise<T>, label: string, milliseconds = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { timers.delete(timer); reject(Error(`${label} timed out`)); }, milliseconds);
    timers.add(timer);
    promise.then(value => { clearTimeout(timer); timers.delete(timer); resolve(value); }, error => {
      clearTimeout(timer); timers.delete(timer); reject(error);
    });
  });
}

beforeAll(async () => {
  assertTestEnvironment(process.env);
  assert.ok(path.isAbsolute(directory) && path.basename(path.dirname(directory)) === 'android-web-price-local');
  assert.ok(!originalApps.includes('[DEFAULT]'), 'No default Firebase app may be initialized in this process');
  app = initializeApp({ projectId: PROJECT, apiKey: 'demo-only-api-key', appId: '1:1234567890:web:priceproof' },
    `price-web-${phase}-${runId}`);
  auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9097', { disableWarnings: true });
  db = initializeFirestore(app, { localCache: memoryLocalCache() }); connectFirestoreEmulator(db, '127.0.0.1', 8187);
  injected.firestore = db;
  const credential = GoogleAuthProvider.credential(JSON.stringify({ sub: GOOGLE_UID, email: EMAIL, email_verified: true }));
  const signedIn = await bounded(signInWithCredential(auth, credential), 'local Google sign-in');
  expect(signedIn.user.uid).toBe(OWNER);
  expect(signedIn.user.providerData.map(provider => ({ providerId: provider.providerId, uid: provider.uid, email: provider.email })))
    .toEqual([{ providerId: 'google.com', uid: GOOGLE_UID, email: EMAIL }]);
  const claims = (await bounded(signedIn.user.getIdTokenResult(true), 'refresh local claims')).claims;
  expect(claims.appAccess).toBe(true); expect(claims.admin).toBeUndefined(); expect(claims.pretester).toBeUndefined();
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
  if (errors.length) throw new AggregateError(errors, 'Named Web SDK cleanup failed');
});

it(WEB_PHASES[phase], async () => {
  const expectedBefore = phase === 'save' ? 1 : 2;
  const before = await bounded(getDocFromServer(doc(db, CHOICE_PATH)), 'before server read');
  expect(before.exists()).toBe(true); expect(before.metadata.fromCache).toBe(false); expect(before.metadata.hasPendingWrites).toBe(false);
  const previous = assertChoice(before.data(), expectedBefore);
  const parent = normalize((await bounded(getDocFromServer(doc(db, PARENT_PATH)), 'parent read')).data());
  const seen: Record<number, CollectionPriceSelection> = {};
  const waiters = new Map<number, { resolve: (value: CollectionPriceSelection) => void; reject: (error: Error) => void }>();
  const awaitRevision = (revision: number) => seen[revision] ? Promise.resolve(seen[revision]) : bounded(
    new Promise<CollectionPriceSelection>((resolve, reject) => { waiters.set(revision, { resolve, reject }); }), `subscription revision ${revision}`);
  unsubscribe = await subscribeCollectionPriceSelections(OWNER, selections => {
    const value = selections[ENTRY]; if (!value) return;
    seen[value.revision] = value; waiters.get(value.revision)?.resolve(value); waiters.delete(value.revision);
  }, error => { for (const waiter of waiters.values()) waiter.reject(error); waiters.clear(); });
  expect(await awaitRevision(expectedBefore)).toEqual(decodeCollectionPriceSelection(before.data()!, ENTRY, OWNER));
  const writeStartedAt = Date.now();
  if (phase === 'save') await bounded(saveCollectionPriceSelection(auth.currentUser!, ENTRY, {
    metric: 'normal_low', label: 'Niedrigster verfügbarer Preis', productId: 42, amountMinor: 450, currency: 'EUR', sourceAt: 1000,
  }), 'actual Web save transaction');
  else await bounded(clearCollectionPriceSelection(auth.currentUser!, ENTRY), 'actual Web clear transaction');
  const writeFinishedAt = Date.now();
  const after = await bounded(getDocFromServer(doc(db, CHOICE_PATH)), 'after server read');
  expect(after.metadata.fromCache).toBe(false); expect(after.metadata.hasPendingWrites).toBe(false);
  const choice = assertChoice(after.data(), expectedBefore + 1);
  expect(choice.lastMutationId).not.toBe(previous.lastMutationId);
  expect(choice.updatedAtClient).toBeGreaterThanOrEqual(writeStartedAt); expect(choice.updatedAtClient).toBeLessThanOrEqual(writeFinishedAt);
  expect(await awaitRevision(expectedBefore + 1)).toEqual(decodeCollectionPriceSelection(after.data()!, ENTRY, OWNER));
  expect(normalize((await bounded(getDocFromServer(doc(db, PARENT_PATH)), 'unchanged parent')).data())).toEqual(parent);
  writeFileSync(path.join(directory, `web-${phase}-proof.json`), JSON.stringify({ project: PROJECT, runId, phase,
    verified: true, actualProductFunctions: true, rpcMocked: false, defaultAppInitialized: false,
    before: previous, choice, parent, subscribedRevisions: [expectedBefore, expectedBefore + 1], writeStartedAt, writeFinishedAt }, null, 2));
});
