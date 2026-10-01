import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

let environment: RulesTestEnvironment;
const projectId = 'cardvault-715ac-web-rules-test';

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } }); });
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
  it('requires appAccess for an owner-compatible create and denies foreign reads', async () => {
    const deniedOwner = environment.authenticatedContext('owner').firestore();
    await assertFails(setDoc(doc(deniedOwner, 'users/owner/collectionEntries/blocked'), entry('owner', 'blocked')));
    await assertFails(setDoc(doc(environment.authenticatedContext('tester', { pretester: true }).firestore(), 'users/tester/collectionEntries/blocked'), entry('tester', 'blocked')));
    const owner = environment.authenticatedContext('owner', { appAccess: true }).firestore();
    const reference = doc(owner, 'users/owner/collectionEntries/web-entry');
    await assertSucceeds(setDoc(reference, entry('owner', 'web-entry')));
    await assertSucceeds(getDoc(reference));
    await assertFails(getDoc(doc(environment.authenticatedContext('other').firestore(), 'users/owner/collectionEntries/web-entry')));
  });

  it('requires the next revision and keeps deletes as tombstones', async () => {
    const owner = environment.authenticatedContext('owner', { appAccess: true }).firestore();
    const reference = doc(owner, 'users/owner/collectionEntries/web-entry');
    await setDoc(reference, entry('owner', 'web-entry'));
    await assertFails(updateDoc(reference, { quantity: 2, revision: 1, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(), updatedAtClient: Date.now() }));
    await assertSucceeds(updateDoc(reference, { quantity: 2, revision: 2, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(), updatedAtClient: Date.now() }));
    await assertSucceeds(updateDoc(reference, { deleted: true, deletedAtClient: Date.now(), revision: 3, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(), updatedAtClient: Date.now() }));
    await assertFails(deleteDoc(reference));
  });

  it('keeps manual price selections owner-only, exact to the collection entry and revisioned', async () => {
    const owner = environment.authenticatedContext('owner', { appAccess: true }).firestore();
    const other = environment.authenticatedContext('other', { appAccess: true }).firestore();
    const entryReference = doc(owner, 'users/owner/collectionEntries/web-entry');
    const selectionReference = doc(owner, 'users/owner/collectionPriceSelections/web-entry');
    await setDoc(entryReference, entry('owner', 'web-entry'));
    await assertSucceeds(setDoc(selectionReference, priceSelection('owner', 'web-entry')));
    await assertSucceeds(getDoc(selectionReference));
    await assertFails(getDoc(doc(other, 'users/owner/collectionPriceSelections/web-entry')));
    await assertFails(updateDoc(selectionReference, { productId: 1, revision: 2, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(), updatedAtClient: Date.now() }));
    await assertFails(updateDoc(selectionReference, { metric: 'reverse_holo_low', revision: 2, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(), updatedAtClient: Date.now() }));
    await assertSucceeds(updateDoc(selectionReference, {
      revision: 2, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(), updatedAtClient: Date.now(), cleared: true,
      sourceSetId: null, sourceCardId: null, collectorNumber: null, language: null, finish: null, variant: null,
      productId: null, metric: null, amountMinor: null, currency: null, sourceAt: null, selectedAt: null,
    }));
    await assertFails(deleteDoc(selectionReference));
  });

  it('exposes only public site copy and requires the admin claim for writes', async () => {
    const publicDoc = doc(environment.unauthenticatedContext().firestore(), 'siteContent/public');
    await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'siteContent/public'), siteContent()));
    await assertSucceeds(getDoc(publicDoc));
    await assertFails(setDoc(doc(environment.authenticatedContext('user').firestore(), 'siteContent/public'), siteContent()));
    await assertSucceeds(setDoc(doc(environment.authenticatedContext('admin', { admin: true }).firestore(), 'siteContent/public'), siteContent()));
    await assertSucceeds(setDoc(doc(environment.authenticatedContext('admin', { admin: true }).firestore(), 'siteContent/public'), { ...siteContent(), githubUrl: '' }));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'users/owner/collectionEntries/web-entry')));
  });

  it('keeps all profile publication server-only and limits production reads to app users', async () => {
    const admin = environment.authenticatedContext('admin', { admin: true }).firestore();
    const user = environment.authenticatedContext('user').firestore();
    const appUser = environment.authenticatedContext('app-user', { appAccess: true }).firestore();
    const draft = doc(admin, 'scannerProfileVersions/profile-v1');
    await assertFails(setDoc(draft, scannerVersion('draft')));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'scannerProfileVersions/profile-v1'), scannerVersion('draft'));
      await setDoc(doc(context.firestore(), 'scannerProfileVersions/profile-v2'), scannerVersion('production', 2));
      await setDoc(doc(context.firestore(), 'scannerReleaseManifest/production'), { schemaVersion: 1, profiles: {}, compatibility: {} });
    });
    await assertSucceeds(getDoc(draft));
    await assertFails(getDoc(doc(user, 'scannerProfileVersions/profile-v1')));
    const production = doc(admin, 'scannerProfileVersions/profile-v2');
    await assertFails(setDoc(production, scannerVersion('production', 2)));
    await assertFails(getDoc(doc(user, 'scannerProfileVersions/profile-v2')));
    await assertSucceeds(getDoc(doc(appUser, 'scannerProfileVersions/profile-v2')));
    await assertFails(setDoc(doc(user, 'scannerProfileVersions/rogue'), scannerVersion('production')));
    await assertFails(setDoc(doc(admin, 'scannerReleaseManifest/production'), { schemaVersion: 1, profiles: {}, compatibility: {} }));
    await assertFails(setDoc(doc(admin, 'scannerBenchmarks/forged'), { mode: 'REAL', passed: true }));
    await assertFails(setDoc(doc(admin, 'scannerAudit/forged'), { action: 'PRODUCTION_PUBLISHED' }));
    await assertFails(getDoc(doc(user, 'scannerReleaseManifest/production')));
    await assertSucceeds(getDoc(doc(appUser, 'scannerReleaseManifest/production')));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'scannerReleaseManifest/production')));
  });

  it('requires server-side report creation and keeps the queue admin-only', async () => {
    const admin = environment.authenticatedContext('admin', { admin: true }).firestore();
    const user = environment.authenticatedContext('user').firestore();
    const pretester = environment.authenticatedContext('tester', { pretester: true }).firestore();
    const report = doc(pretester, 'scannerReports/scan-1');
    await assertFails(setDoc(report, scanReport('scan-1')));
    await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'scannerReports/scan-1'), { ...scanReport('scan-1'), ownerUid: 'tester' }));
    await assertFails(getDoc(doc(user, 'scannerReports/scan-1')));
    await assertFails(getDoc(doc(pretester, 'scannerReports/scan-1')));
    await assertSucceeds(getDoc(doc(admin, 'scannerReports/scan-1')));
    await assertFails(setDoc(doc(user, 'scannerReports/scan-2'), scanReport('scan-2')));
    await assertFails(setDoc(doc(pretester, 'scannerReports/auto'), { ...scanReport('auto'), captureType: 'AUTO_CAPTURE' }));
    await assertFails(setDoc(doc(pretester, 'scannerReports/pii'), { ...scanReport('pii'), email: 'private@example.com' }));
  });

  it('allows admins to review reports without changing technical evidence', async () => {
    const admin = environment.authenticatedContext('admin', { admin: true }).firestore();
    const pretester = environment.authenticatedContext('tester', { pretester: true }).firestore();
    await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'scannerReports/scan-review'), { ...scanReport('scan-review'), ownerUid: 'tester' }));
    const adminReport = doc(admin, 'scannerReports/scan-review');
    await assertSucceeds(updateDoc(adminReport, { reviewStatus: 'IN_REVIEW', reviewNote: 'Prüfung', referenceCardId: 'sv3-137', referenceCardKey: 'sv3:137', referenceVariant: 'reverse', reviewedAt: '2026-09-03T00:00:00Z', reviewedBy: 'admin' }));
    await assertFails(updateDoc(adminReport, { scanId: 'manipulated' }));
    await assertFails(updateDoc(doc(pretester, 'scannerReports/scan-review'), { reviewStatus: 'RESOLVED' }));
  });

  it('fences previously authorized sessions while deletion is in progress', async () => {
    const owner = environment.authenticatedContext('owner', { appAccess: true }).firestore();
    const ref = doc(owner, 'users/owner/collectionEntries/entry');
    await assertSucceeds(setDoc(ref, entry('owner', 'entry')));
    await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'accountDeletionLocks/owner'), { jobId: 'test' }));
    await assertFails(getDoc(ref));
    await assertFails(setDoc(doc(owner, 'users/owner/collectionEntries/recreate'), entry('owner', 'recreate')));
    await assertFails(deleteDoc(doc(owner, 'accountDeletionLocks/owner')));
  });

  it('immediately denies revoked access even with an old valid appAccess token', async () => {
    const owner = environment.authenticatedContext('owner', { appAccess: true }).firestore();
    const ref = doc(owner, 'users/owner/collectionEntries/entry');
    await assertSucceeds(setDoc(ref, entry('owner', 'entry')));
    await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'accountAccess/owner'), { appAccess: false }));
    await assertFails(getDoc(ref));
    await assertFails(setDoc(doc(owner, 'users/owner/collectionEntries/recreate'), entry('owner', 'recreate')));
    await assertFails(setDoc(doc(owner, 'accountAccess/owner'), { appAccess: true }));
    await assertSucceeds(getDoc(doc(owner, 'accountAccess/owner')));
    await assertFails(getDoc(doc(environment.authenticatedContext('other').firestore(), 'accountAccess/owner')));
  });

  it('never exposes share records or permits clients to create/revoke shares directly', async () => {
    for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('owner', { appAccess: true }), environment.authenticatedContext('admin', { admin: true })]) {
      const ref = doc(context.firestore(), `privateBinderShares/${'a'.repeat(64)}`);
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { ownerUid: 'owner', revokedAt: null }));
      await assertFails(deleteDoc(ref));
    }
  });
});

function siteContent() { return { heroTitle:'Deine Sammlung.',heroSubtitle:'Sicher synchronisiert.',statusBanner:'Pre-Beta',currentVersion:'1.0-pre-beta',currentBuild:'17',releaseStatus:'Pre-Beta',discordUrl:'',discordText:'Community',kickstarterUrl:'',kickstarterCta:'Coming Soon',updates:[],roadmap:[] }; }
function scannerVersion(status: string, version = 1) { return { profileId: 'profile', profileVersion: version, schemaVersion: 1, status, zones: [] }; }
function scanReport(reportId: string) { return { schemaVersion:1,scanId:reportId,createdAt:'2026-09-03T00:00:00Z',captureType:'MANUAL_CAPTURE',captureImagePath:`scanner-report-images/${reportId}/capture.webp`,imageSha256:'a'.repeat(64),imageContentType:'image/webp',imageSizeBytes:42,attempts:[],ocrTokens:[],guessedName:null,guessedSet:null,guessedNumber:null,confidence:null,zoneConfidence:{},profileId:null,profileVersion:null,failureReason:'Nicht erkannt',reviewStatus:'NEW',referenceCardId:null,referenceCardKey:null,reviewNote:'',reviewedAt:null}; }
function priceSelection(ownerUid: string, entrySyncId: string) { return { schemaVersion: 1, ownerUid, entrySyncId, revision: 1, lastMutationId: crypto.randomUUID(), updatedAt: serverTimestamp(), updatedAtClient: Date.now(), cleared: false, sourceSetId: 'sv03.5', sourceCardId: 'sv03.5-001', collectorNumber: '001', language: 'GERMAN', finish: 'Normal', variant: 'Standard', productId: 733596, metric: 'normal_avg_sell', amountMinor: 123, currency: 'EUR', sourceAt: 1_788_220_800_000, selectedAt: 1_788_220_900_000 }; }
