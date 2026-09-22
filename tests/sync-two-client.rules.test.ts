import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, disableNetwork, doc, enableNetwork, getDocFromCache, getDocFromServer, getDocsFromServer, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

// This is a real two-SDK-client/reconnect test, NOT a physical Android/Web acceptance test.
// Refuse to run without an explicitly local emulator; never fall back to production.
const projectId = 'demo-domidex-sync';
const owner = 'isolated-owner';
const root = `users/${owner}`;
let environment: RulesTestEnvironment;

beforeAll(async () => {
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
    throw new Error('This suite requires an explicit local Firestore emulator.');
  }
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
}, 20_000);
afterEach(async () => { if (environment) await environment.clearFirestore(); });
afterAll(async () => { if (environment) await environment.cleanup(); });

const metadata = (revision = 1) => ({ revision, lastMutationId: `mutation-${revision}`, updatedAt: serverTimestamp(), updatedAtClient: 1_788_220_800_000 + revision });

async function seed() {
  const first = environment.authenticatedContext(owner, { appAccess: true }).firestore();
  const second = environment.authenticatedContext(owner, { appAccess: true }).firestore();
  const entry = {
    ...metadata(), ownerUid: owner, syncId: 'entry', deleted: false, deletedAtClient: null,
    name: 'Testkarte', setId: 'sv3', setName: 'Testset', collectorNumber: '201/197', language: 'GERMAN',
    finish: 'Holo', variant: 'Standard', rarity: 'UNKNOWN', quantity: 1, condition: 'Nicht geprüft', notes: '',
    acquisitionPriceMinor: null, acquisitionCurrency: null, acquisitionDateEpochDay: null,
    externalProductSource: null, externalProductId: null, imageUrl: null, effectOverride: null,
    sourceSetId: 'sv3', sourceCardId: 'sv3-201', binderId: 'set-test', binderSetKey: 'test', binderName: 'Testset', binderHeroAsset: null,
  };
  await setDoc(doc(first, `${root}/collectionEntries/entry`), entry);
  await setDoc(doc(first, `${root}/privateBinders/binder`), {
    ...metadata(), ownerUid: owner, binderId: 'binder', name: 'Privat', description: '', coverStyle: 'galaxy',
    minimumPageCount: 2, createdAtClient: 1, lastOpenedAtClient: null, deleted: false,
  });
  await setDoc(doc(first, `${root}/privateBinderPlacements/placement`), {
    ...metadata(), ownerUid: owner, placementId: 'placement', binderId: 'binder', entrySyncId: 'entry',
    slotPosition: 2, holoEffectId: 'galaxy', holoIntensity: 0.6, createdAtClient: 1, deleted: false,
  });
  return { first, second };
}

describe('two isolated SDK clients using the Android/Web document contract', () => {
  it('transfers collection, cover, pages, position and Holo without creating additional ownership', async () => {
    const { first, second } = await seed();
    const batch = writeBatch(first);
    batch.update(doc(first, `${root}/privateBinders/binder`), { ...metadata(2), coverStyle: 'aurora', minimumPageCount: 20 });
    batch.update(doc(first, `${root}/privateBinderPlacements/placement`), { ...metadata(2), slotPosition: 101, holoEffectId: 'fire', holoIntensity: 0.85 });
    await batch.commit();
    expect((await getDocFromServer(doc(second, `${root}/privateBinders/binder`))).data()).toMatchObject({ coverStyle: 'aurora', minimumPageCount: 20, revision: 2 });
    expect((await getDocFromServer(doc(second, `${root}/privateBinderPlacements/placement`))).data()).toMatchObject({ slotPosition: 101, holoEffectId: 'fire', holoIntensity: 0.85, revision: 2 });
    const ownership = await getDocsFromServer(collection(second, `${root}/collectionEntries`));
    expect(ownership.size).toBe(1);
    expect(ownership.docs[0].data().quantity).toBe(1);
  }, 15_000);

  it('reconnects queued edits once and preserves empty positions and ownership quantity', async () => {
    const { first, second } = await seed();
    await disableNetwork(first);
    const batch = writeBatch(first);
    const placement = doc(first, `${root}/privateBinderPlacements/placement`);
    batch.update(placement, { ...metadata(2), slotPosition: 12, holoEffectId: 'water', holoIntensity: 0.7 });
    batch.update(doc(first, `${root}/privateBinders/binder`), { ...metadata(2), coverStyle: 'ocean' });
    const pending = batch.commit();
    // Attach immediately: a rejected write must never become an unhandled rejection.
    const outcome = pending.then(() => 'ok', (error: { code: string }) => error.code);
    try {
      expect((await getDocFromCache(placement)).data()).toMatchObject({ slotPosition: 12, revision: 2 });
      expect((await getDocFromServer(doc(second, `${root}/privateBinderPlacements/placement`))).data()?.slotPosition).toBe(2);
    } finally { await enableNetwork(first); }
    expect(await outcome).toBe('ok');
    expect((await getDocFromServer(doc(second, `${root}/privateBinderPlacements/placement`))).data()).toMatchObject({ slotPosition: 12, holoEffectId: 'water', revision: 2 });
    expect((await getDocFromServer(doc(second, `${root}/privateBinders/binder`))).data()?.coverStyle).toBe('ocean');
    expect((await getDocsFromServer(collection(second, `${root}/privateBinderPlacements`))).size).toBe(1);
    expect((await getDocFromServer(doc(second, `${root}/collectionEntries/entry`))).data()?.quantity).toBe(1);
  }, 15_000);

  it('rejects a stale offline revision rather than overwriting another client position', async () => {
    const { first, second } = await seed();
    await disableNetwork(first);
    const a = doc(first, `${root}/privateBinderPlacements/placement`);
    const b = doc(second, `${root}/privateBinderPlacements/placement`);
    const outcome = updateDoc(a, { ...metadata(2), slotPosition: 13 }).then(() => 'unexpected-success', (error: { code: string }) => error.code);
    try {
      await getDocFromCache(a);
      await updateDoc(b, { ...metadata(2), slotPosition: 14 });
    } finally { await enableNetwork(first); }
    expect(await outcome).toBe('permission-denied');
    expect((await getDocFromServer(b)).data()).toMatchObject({ revision: 2, slotPosition: 14 });
    expect((await getDocFromServer(a)).data()).toMatchObject({ revision: 2, slotPosition: 14 });
  }, 15_000);

  it('does not replay queued writes after account access has been revoked', async () => {
    const { first } = await seed();
    await disableNetwork(first);
    const target = doc(first, `${root}/privateBinderPlacements/placement`);
    const outcome = updateDoc(target, { ...metadata(2), slotPosition: 99 }).then(() => 'unexpected-success', (error: { code: string }) => error.code);
    try {
      await getDocFromCache(target);
      await environment.withSecurityRulesDisabled(async (admin) => setDoc(doc(admin.firestore(), `accountAccess/${owner}`), { appAccess: false }));
    } finally { await enableNetwork(first); }
    expect(await outcome).toBe('permission-denied');
    await environment.withSecurityRulesDisabled(async (admin) => {
      expect((await getDocFromServer(doc(admin.firestore(), `${root}/privateBinderPlacements/placement`))).data()).toMatchObject({ revision: 1, slotPosition: 2 });
    });
  }, 15_000);
});
