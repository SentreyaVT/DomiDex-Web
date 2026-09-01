import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

let environment: RulesTestEnvironment;
const projectId = 'cardvault-715ac-web-rules-test';

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId }); });
afterEach(async () => environment.clearFirestore());
afterAll(async () => environment.cleanup());

function entry(uid: string, syncId: string) {
  return {
    syncId, ownerUid: uid, revision: 1, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(),
    updatedAtClient: Date.now(), deleted: false, deletedAtClient: null, name: 'Bisasam', setId: 'sv03.5',
    setName: '151', collectorNumber: '001', language: 'GERMAN', finish: 'Normal', variant: 'Standard', rarity: 'Häufig',
    quantity: 1, condition: 'Near Mint', notes: '', acquisitionPriceMinor: null, acquisitionCurrency: null,
    acquisitionDateEpochDay: null, externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: 733596,
    imageUrl: 'https://assets.tcgdex.net/de/sv/sv03.5/001/high.webp', effectOverride: null,
    binderId: 'tcgdex-sv03.5', sourceSetId: 'sv03.5', sourceCardId: 'sv03.5-001',
    binderSetKey: 'tcgdex-sv03.5', binderName: '151', binderHeroAsset: null,
  };
}

describe('DomiDex Web Firestore rules', () => {
  it('allows an owner-compatible create and denies foreign reads', async () => {
    const owner = environment.authenticatedContext('owner').firestore();
    const reference = doc(owner, 'users/owner/collectionEntries/web-entry');
    await assertSucceeds(setDoc(reference, entry('owner', 'web-entry')));
    await assertSucceeds(getDoc(reference));
    await assertFails(getDoc(doc(environment.authenticatedContext('other').firestore(), 'users/owner/collectionEntries/web-entry')));
  });

  it('requires the next revision and keeps deletes as tombstones', async () => {
    const owner = environment.authenticatedContext('owner').firestore();
    const reference = doc(owner, 'users/owner/collectionEntries/web-entry');
    await setDoc(reference, entry('owner', 'web-entry'));
    await assertFails(updateDoc(reference, { quantity: 2, revision: 1, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(), updatedAtClient: Date.now() }));
    await assertSucceeds(updateDoc(reference, { quantity: 2, revision: 2, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(), updatedAtClient: Date.now() }));
    await assertSucceeds(updateDoc(reference, { deleted: true, deletedAtClient: Date.now(), revision: 3, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(), updatedAtClient: Date.now() }));
    await assertFails(deleteDoc(reference));
  });

  it('exposes only public site copy and requires the admin claim for writes', async () => {
    const publicDoc = doc(environment.unauthenticatedContext().firestore(), 'siteContent/public');
    await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'siteContent/public'), siteContent()));
    await assertSucceeds(getDoc(publicDoc));
    await assertFails(setDoc(doc(environment.authenticatedContext('user').firestore(), 'siteContent/public'), siteContent()));
    await assertSucceeds(setDoc(doc(environment.authenticatedContext('admin', { admin: true }).firestore(), 'siteContent/public'), siteContent()));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'users/owner/collectionEntries/web-entry')));
  });

  it('keeps scanner drafts private and exposes only production to signed-in clients', async () => {
    const admin = environment.authenticatedContext('admin', { admin: true }).firestore();
    const user = environment.authenticatedContext('user').firestore();
    const draft = doc(admin, 'scannerProfileVersions/profile-v1');
    await assertSucceeds(setDoc(draft, scannerVersion('draft')));
    await assertFails(getDoc(doc(user, 'scannerProfileVersions/profile-v1')));
    const production = doc(admin, 'scannerProfileVersions/profile-v2');
    await assertSucceeds(setDoc(production, scannerVersion('production', 2)));
    await assertSucceeds(getDoc(doc(user, 'scannerProfileVersions/profile-v2')));
    await assertFails(setDoc(doc(user, 'scannerProfileVersions/rogue'), scannerVersion('production')));
    await assertSucceeds(setDoc(doc(admin, 'scannerReleaseManifest/production'), { schemaVersion: 1, profiles: {}, compatibility: {} }));
    await assertSucceeds(getDoc(doc(user, 'scannerReleaseManifest/production')));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'scannerReleaseManifest/production')));
  });
});

function siteContent() { return { heroTitle:'Deine Sammlung.',heroSubtitle:'Sicher synchronisiert.',statusBanner:'Pre-Beta',currentVersion:'1.0-pre-beta',currentBuild:'17',releaseStatus:'Pre-Beta',discordUrl:'',discordText:'Community',githubUrl:'https://github.com/nandedomi/DomiDex',kickstarterUrl:'',kickstarterCta:'Coming Soon',updates:[],roadmap:[] }; }
function scannerVersion(status: string, version = 1) { return { profileId: 'profile', profileVersion: version, schemaVersion: 1, status, zones: [] }; }
