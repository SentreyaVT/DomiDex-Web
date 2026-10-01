import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { EXPECTED_LIVE_SHA256, prepareSharingRules, sha256 } from '../scripts/prepare-sharing-rules.mjs';

const live = readFileSync(new URL('../.domidex/sharing-activation/live-firestore.rules', import.meta.url), 'utf8');
const candidate = prepareSharingRules(live);
const now = 1_788_220_800_000;
let environment, baseline;
const base = () => ({ ownerUid:'owner', revision:1, lastMutationId:'fixture-1', updatedAt:serverTimestamp(), updatedAtClient:now });
const entry = () => ({ ...base(), syncId:'entry-1', deleted:false, deletedAtClient:null, name:'Mew', setId:'fixture', setName:'Fixture', collectorNumber:'001/100',
  language:'GERMAN', finish:'Holo', variant:'Standard', rarity:'UNKNOWN', quantity:1, condition:'Nicht geprüft', notes:'',
  acquisitionPriceMinor:null, acquisitionCurrency:null, acquisitionDateEpochDay:null, externalProductSource:null, externalProductId:null,
  imageUrl:null, effectOverride:null, sourceSetId:'fixture', sourceCardId:'fixture-001', binderId:'fixture', binderSetKey:'fixture', binderName:'Fixture', binderHeroAsset:null });
const binder = () => ({ ...base(), binderId:'binder-1', name:'Fixture private binder', description:null, coverStyle:'AURORA', minimumPageCount:2, createdAtClient:now, lastOpenedAtClient:null, deleted:false });
const placement = () => ({ ...base(), placementId:'placement-1', binderId:'binder-1', entrySyncId:'entry-1', slotPosition:0, holoEffectId:'AURORA', holoIntensity:.7, createdAtClient:now, deleted:false });
const user = () => environment.authenticatedContext('owner', { appAccess:true }).firestore();
async function seed(env) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db,'users/owner/collectionEntries/entry-1'),entry());
    await setDoc(doc(db,'users/owner/privateBinders/binder-1'),binder());
    await setDoc(doc(db,'accountAccess/owner'),{appAccess:true});
    await setDoc(doc(db,'privateBinderShares/fixture-share'),{ownerUid:'owner'});
  });
}
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Use the local Firestore emulator only.');
  baseline = await initializeTestEnvironment({ projectId:'demo-domidex-sharing-baseline', firestore:{ rules:live } });
  environment = await initializeTestEnvironment({ projectId:'demo-domidex-sharing', firestore:{ rules:candidate } });
});
beforeEach(async () => { await environment.clearFirestore(); await seed(environment); });
after(async () => { await environment?.cleanup(); await baseline?.cleanup(); });

test('preparation is pinned to the exact live snapshot and preserves unrelated rule text', () => {
  assert.equal(sha256(live), EXPECTED_LIVE_SHA256);
  assert.throws(()=>prepareSharingRules(live+'\n'), /LIVE_RULES_CHANGED/);
  for (const functionName of ['validCollectionEntry','validPrivateBinder','validCollectionLayout']) {
    const block = text => text.slice(text.indexOf(`    function ${functionName}(`), text.indexOf('\n    }',text.indexOf(`    function ${functionName}(`))+6);
    assert.equal(block(candidate),block(live));
  }
  assert.equal(candidate.includes('privateBinderShares'),false);
  assert.ok(candidate.includes('match /{document=**} { allow read, write: if false; }'));
});
test('live rules reproduce both missing account-status read and rejected current Holo wire fields', async () => {
  await seed(baseline);
  const db = baseline.authenticatedContext('owner',{appAccess:true}).firestore();
  await assertFails(getDoc(doc(db,'accountAccess/owner')));
  await assertFails(setDoc(doc(db,'users/owner/privateBinderPlacements/placement-1'),placement()));
});
test('only the owner can get accountAccess; grants cannot be listed, edited or deleted', async () => {
  const db=user(), ref=doc(db,'accountAccess/owner');
  await assertSucceeds(getDoc(ref));
  await assertFails(getDocs(collection(db,'accountAccess')));
  await assertFails(updateDoc(ref,{admin:true}));
  await assertFails(deleteDoc(ref));
  await assertFails(getDoc(doc(environment.authenticatedContext('other').firestore(),'accountAccess/owner')));
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(),'accountAccess/owner')));
});
test('private Binder/placement owner reads remain allowed and foreign reads denied', async () => {
  const db=user();
  await assertSucceeds(getDocs(collection(db,'users/owner/privateBinders')));
  await assertSucceeds(setDoc(doc(db,'users/owner/privateBinderPlacements/placement-1'),placement()));
  await assertSucceeds(getDocs(collection(db,'users/owner/privateBinderPlacements')));
  const foreign=environment.authenticatedContext('other').firestore();
  await assertFails(getDoc(doc(foreign,'users/owner/privateBinders/binder-1')));
  await assertFails(getDoc(doc(foreign,'users/owner/privateBinderPlacements/placement-1')));
});
test('old absent Holo fields and new explicit null/zero wire fields remain valid', async () => {
  const data=placement(); delete data.holoEffectId; delete data.holoIntensity;
  const ref=doc(user(),'users/owner/privateBinderPlacements/placement-1');
  await assertSucceeds(setDoc(ref,data));
  await assertSucceeds(setDoc(ref,{...placement(),holoEffectId:null,holoIntensity:0,revision:2}));
});
test('Holo is bounded: rejects invalid identifiers, intensity, unknown fields and foreign ownership', async () => {
  const ref=doc(user(),'users/owner/privateBinderPlacements/placement-1');
  for(const bad of [{holoEffectId:'../x'}, {holoEffectId:''}, {holoEffectId:'x'.repeat(81)}, {holoEffectId:4}, {holoIntensity:-.1}, {holoIntensity:1.1}, {holoIntensity:'1'}, {holoEffectId:null,holoIntensity:.5}, {unknownField:true}, {ownerUid:'other'}]) {
    await assertFails(setDoc(ref,{...placement(),...bad}));
  }
  await assertSucceeds(setDoc(ref,{...placement(),holoEffectId:'type.psychic-v2',holoIntensity:1}));
});
test('placement revisions, existing dependencies and tombstones stay enforced', async () => {
  const ref=doc(user(),'users/owner/privateBinderPlacements/placement-1');
  await assertFails(setDoc(ref,{...placement(),entrySyncId:'missing'}));
  await assertSucceeds(setDoc(ref,placement()));
  await assertFails(updateDoc(ref,{revision:3}));
  await assertSucceeds(setDoc(ref,{...placement(),revision:2,deleted:true}));
  await assertFails(setDoc(ref,{...placement(),revision:3,deleted:false}));
  await assertFails(deleteDoc(ref));
});
test('current collection, Binder, layout and tombstone wire shapes still work unchanged', async () => {
  const db=user();
  const cref=doc(db,'users/owner/collectionEntries/entry-1'), bref=doc(db,'users/owner/privateBinders/binder-1');
  await assertSucceeds(setDoc(cref,{...entry(),revision:2}));
  await assertSucceeds(setDoc(bref,{...binder(),revision:2}));
  await assertSucceeds(setDoc(doc(db,'users/owner/collectionLayouts/entry-1'),{...base(),entrySyncId:'entry-1',visibleInSetBinder:false}));
  await assertSucceeds(setDoc(cref,{...entry(),revision:3,deleted:true,deletedAtClient:now}));
  await assertSucceeds(setDoc(bref,{...binder(),revision:3,deleted:true}));
  await assertFails(setDoc(cref,{...entry(),revision:4}));
  await assertFails(setDoc(bref,{...binder(),revision:4}));
});
test('public share records remain server-only for owner, other, anonymous and client admin', async () => {
  for(const db of [user(),environment.authenticatedContext('other').firestore(),environment.unauthenticatedContext().firestore(),environment.authenticatedContext('admin',{admin:true}).firestore()]) {
    await assertFails(getDoc(doc(db,'privateBinderShares/fixture-share')));
    await assertFails(setDoc(doc(db,'privateBinderShares/new'),{ownerUid:'owner'}));
  }
});
