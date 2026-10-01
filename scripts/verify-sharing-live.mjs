import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { firebaseCliToken, project, folder } from './sharing-cloud-context.mjs';

const origin = process.argv[2];
const candidateOrigin = process.env.SHARING_CANDIDATE_ORIGIN || 'https://binder-sharing-20260922---domidex-web-olqifpb3pa-ew.a.run.app';
assert([candidateOrigin, 'https://domidex.web.app'].includes(origin), 'UNEXPECTED_TARGET');
const token = await firebaseCliToken();
const app = initializeApp({ projectId: project, credential: { getAccessToken: async () => ({ access_token: token, expires_in: 3600 }) } }, 'sharing-live-test');
const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: token });
const auth = getAuth(app), db = new Firestore({ projectId: project, authClient });
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
assert(apiKey, 'PUBLIC_CONFIG_REQUIRED');
const runId = `sharing-qa-${randomUUID()}`;
const users = [], shares = [], results = { origin, checks: [], linkTimings: [], cleanup: false };
const headers = idToken => ({ 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) });
async function request(path, method = 'GET', idToken, body) {
  const started = performance.now();
  const result = await fetch(origin + path, { method, headers: headers(idToken), ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000) });
  if (idToken && path.startsWith('/api/binder-shares')) results.linkTimings.push({ method, status: result.status, millis: Math.round(performance.now() - started) });
  return result;
}
async function account(role, claims) {
  const uid = `${runId}-${role}`;
  const password = randomBytes(32).toString('base64url');
  const email = `${uid}@example.invalid`;
  await auth.createUser({ uid, email, password }); users.push(uid);
  await auth.setCustomUserClaims(uid, claims);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }), signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  assert(response.ok && result.idToken, 'ISOLATED_LOGIN_FAILED');
  return { uid, idToken: result.idToken };
}
async function create(owner, flags = {}) {
  const result = await request('/api/binder-shares', 'POST', owner.idToken, { binderId: 'binder-test', confirm: true, ...flags });
  assert.equal(result.status, 201, 'CREATE_FAILED');
  const data = await result.json(); shares.push(data.shareId);
  assert.equal(createHash('sha256').update(data.path.split('/').pop()).digest('hex'), data.shareId);
  return data;
}
async function checkClientSyncRules(owner, other) {
  const documents = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const value = v => v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v }
    : typeof v === 'number' ? Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v } : { stringValue: v };
  const now = Date.now(), common = { ownerUid: owner.uid, revision: 1, lastMutationId: 'sharing-wire-test', updatedAtClient: now };
  const commit = async (path, fields) => fetch(documents + ':commit', { method: 'POST', headers: headers(owner.idToken),
    body: JSON.stringify({ writes: [{ update: { name: `projects/${project}/databases/(default)/documents/users/${owner.uid}/${path}`, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, value(v)])) },
      currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }] }), signal: AbortSignal.timeout(20000) });
  const binder = await commit('privateBinders/wire-binder', { ...common, binderId: 'wire-binder', name: 'Synthetic sync fixture', description: null, coverStyle: 'galaxy', minimumPageCount: 2, createdAtClient: now, lastOpenedAtClient: null, deleted: false });
  assert.equal(binder.status, 200, 'LIVE_CLIENT_BINDER_WRITE_DENIED');
  const entry = await commit('collectionEntries/wire-entry', { ...common, syncId: 'wire-entry', deleted: false, deletedAtClient: null, name: 'Glurak', setId: 'base1', setName: 'Grundset', collectorNumber: '4',
    language: 'GERMAN', finish: 'Holo', variant: 'Standard', rarity: 'UNKNOWN', quantity: 1, condition: 'Nicht geprüft', notes: '',
    acquisitionPriceMinor: null, acquisitionCurrency: null, acquisitionDateEpochDay: null, externalProductSource: null, externalProductId: null,
    imageUrl: null, effectOverride: null, sourceSetId: 'base1', sourceCardId: 'base1-4', binderId: 'base1', binderSetKey: 'base1', binderName: 'Grundset', binderHeroAsset: null });
  assert.equal(entry.status, 200, 'LIVE_CLIENT_ENTRY_WRITE_DENIED');
  const placement = await commit('privateBinderPlacements/wire-placement', { ...common, placementId: 'wire-placement', binderId: 'wire-binder', entrySyncId: 'wire-entry', slotPosition: 0, holoEffectId: 'galaxy', holoIntensity: .7, createdAtClient: now, deleted: false });
  assert.equal(placement.status, 200, 'LIVE_CLIENT_HOLO_WRITE_DENIED');
  const status = path => fetch(documents + path, { headers: headers(owner.idToken), signal: AbortSignal.timeout(20000) });
  assert.equal((await status('/accountAccess/' + owner.uid)).status, 404, 'OWN_STATUS_READ_DENIED'); // permitted, absent document
  assert.equal((await status('/accountAccess/' + other.uid)).status, 403, 'FOREIGN_STATUS_READ_ALLOWED');
  assert.equal((await status('/privateBinderShares/' + 'a'.repeat(64))).status, 403, 'CLIENT_SHARE_READ_ALLOWED');
  results.checks.push('live client binder/card/Holo sync writes, own status read and foreign/server-only denial');
}
try {
  // Existing application CSS/JS references and bytes must remain identical.
  const assetPaths = new Set();
  for (const path of ['/', '/app', '/admin/scanner-lab']) {
    const [old, current] = await Promise.all([fetch('https://privacy-gate-20260904---domidex-web-olqifpb3pa-ew.a.run.app'+path), fetch(origin+path)]);
    assert.equal(current.status, old.status, `PAGE_STATUS_${path}`);
    const extract = html => [...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map(x => x[1]).sort((a, b) => a.localeCompare(b));
    const before = extract(await old.text()), after = extract(await current.text());
    assert(before.some(x => x.endsWith('.css')), 'BASE_STYLES_MISSING'); assert.deepEqual(after, before, 'EXISTING_ASSET_REFERENCES_CHANGED');
    for (const item of before) if (item.startsWith('/')) assetPaths.add(item);
  }
  for (const path of assetPaths) {
    const [old, current] = await Promise.all([fetch('https://privacy-gate-20260904---domidex-web-olqifpb3pa-ew.a.run.app'+path), fetch(origin+path)]);
    assert.equal(current.status, 200); assert(Buffer.from(await old.arrayBuffer()).equals(Buffer.from(await current.arrayBuffer())), 'EXISTING_ASSET_BYTES_CHANGED');
  }
  results.checks.push(`existing pages/assets unchanged (${assetPaths.size} assets)`);
  const owner = await account('owner', { appAccess: true });
  const other = await account('other', { appAccess: true });
  const denied = await account('denied', {});
  await checkClientSyncRules(owner, other);
  const binder = { ownerUid: owner.uid, binderId: 'binder-test', name: 'DomiDex – Freigabe-Test', coverStyle: 'galaxy', minimumPageCount: 2, deleted: false, description: 'PRIVATE_DESCRIPTION' };
  await db.doc(`users/${owner.uid}/privateBinders/binder-test`).set(binder);
  for (const [index, cardId, setId, number, finish] of [[0, 'base1-4', 'base1', '4', 'Holo'], [10, 'sv03-223', 'sv03', '223', 'Normal']]) {
    const entryId = `entry-${index}`;
    await db.doc(`users/${owner.uid}/collectionEntries/${entryId}`).set({ ownerUid: owner.uid, sourceCardId: cardId, sourceSetId: setId, setId, collectorNumber: number, finish, variant: 'Standard', quantity: 7, deleted: false, notes: 'PRIVATE_NOTES', acquisitionPriceMinor: 999, imageUrl: 'https://private.invalid/photo' });
    await db.doc(`users/${owner.uid}/privateBinderPlacements/placement-${index}`).set({ ownerUid: owner.uid, binderId: 'binder-test', entrySyncId: entryId, slotPosition: index, holoEffectId: index ? 'element_water' : 'galaxy', holoIntensity: .7, deleted: false });
  }
  assert.equal((await request('/api/binder-shares?binderId=binder-test')).status, 401);
  assert.equal((await request('/api/binder-shares?binderId=binder-test', 'GET', denied.idToken)).status, 403);
  assert.equal((await request('/api/binder-shares?binderId=binder-test', 'GET', other.idToken)).status, 404);
  assert.equal((await request('/api/binder-shares', 'POST', owner.idToken, { binderId: 'binder-test' })).status, 400);
  assert.equal((await request('/api/binder-shares', 'POST', other.idToken, { binderId: 'binder-test', confirm: true })).status, 404);
  results.checks.push('anonymous/denied/foreign owner and absent consent rejected');
  const made = await create(owner);
  const publicPath = made.path.replace('/share/', '/api/shared-binders/');
  const read = await request(publicPath + '?showPrices=true&showTotal=true');
  assert.equal(read.status, 200);
  const dto = await read.json();
  assert.equal(dto.cards.length, 1, 'FIRST_PAGE_CARD_MISSING'); assert.equal(dto.cards[0].cardId, 'base1-4');
  assert.equal(dto.cards[0].holoEffectId, 'galaxy'); assert.equal(dto.cards[0].slot, 0); assert.equal(dto.pageCount, 2);
  assert(!/PRIVATE_|private.invalid|ownerUid|quantity|acquisition|price|total|displayName/.test(JSON.stringify(dto)), 'PRIVATE_FIELDS_LEAKED');
  assert(!JSON.stringify(dto).includes(owner.uid));
  const second = await request(publicPath + '?page=1'); const page2 = await second.json();
  assert.equal(page2.cards[0]?.cardId, 'sv03-223', 'SECOND_PAGE_CARD_MISSING'); assert.equal(page2.cards[0].slot, 10);
  assert.equal((await request(publicPath, 'POST', owner.idToken, { name: 'changed' })).status, 405);
  assert.equal((await db.doc(`users/${owner.uid}/collectionEntries/entry-0`).get()).get('quantity'), 7);
  results.checks.push('two-page exact-ID viewer, holo, privacy defaults and read-only verified');
  assert.equal((await request('/api/binder-shares', 'DELETE', other.idToken, { shareId: made.shareId, confirm: true })).status, 404);
  assert.equal((await request('/api/binder-shares', 'DELETE', owner.idToken, { shareId: made.shareId, confirm: true })).status, 200);
  assert.equal((await request(publicPath)).status, 404);
  results.checks.push('foreign revoke denied; owner revoke effective');
  const total = await create(owner, { showTotal: true });
  const totalDto = await (await request(total.path.replace('/share/', '/api/shared-binders/'))).json();
  assert(totalDto.total && !totalDto.cards[0].price, 'INDEPENDENT_TOTAL_OPTIN_FAILED');
  const prices = await create(owner, { showPrices: true });
  const priceDto = await (await request(prices.path.replace('/share/', '/api/shared-binders/'))).json();
  assert(priceDto.cards[0].price && !priceDto.total, 'INDEPENDENT_PRICE_OPTIN_FAILED');
  results.checks.push('price/total opt-ins independently verified');
  const visual = await create(owner);
  const html = await (await request(visual.path)).text();
  assert(html.includes('/_binder-sharing-v1/assets/') && !html.includes('/admin'), 'VIEWER_SHELL_INVALID');
  for (const asset of [...html.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)].map(x => x[1])) assert.equal((await request(asset)).status, 200);
  const noCache = await request(visual.path); assert(noCache.headers.get('cache-control').includes('no-store')); assert.equal(noCache.headers.get('referrer-policy'), 'no-referrer');
  results.checks.push('viewer JS/CSS/security headers verified');
  await fs.writeFile(folder + '/visual-test-link.json', JSON.stringify({ url: origin + visual.path, synthetic: true }));
  console.log(JSON.stringify({ stage: 'api-passed', checks: results.checks, visualUrl: origin + visual.path, synthetic: true }));
  if (process.argv.includes('--hold')) {
    console.log('Synthetic viewer available until Enter; then all test data is removed.');
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 5 * 60_000);
      process.stdin.once('data', () => { clearTimeout(timeout); resolve(); }); process.stdin.resume();
    }); process.stdin.pause();
  }
  await db.doc(`accountAccess/${owner.uid}`).set({ appAccess: false });
  assert.equal((await request(visual.path.replace('/share/', '/api/shared-binders/'))).status, 404);
  assert.equal((await request('/api/binder-shares?binderId=binder-test', 'GET', owner.idToken)).status, 403);
  results.checks.push('current owner access revocation invalidates public share and old token');
} finally {
  for (const id of shares) if (/^[a-f0-9]{64}$/.test(id)) await db.doc(`privateBinderShares/${id}`).delete();
  for (const uid of users) {
    assert(uid.startsWith(runId+'-'));
    await db.recursiveDelete(db.doc(`users/${uid}`)); await db.doc(`accountAccess/${uid}`).delete(); await auth.deleteUser(uid);
  }
  results.cleanup = true;
  await fs.writeFile(folder + (origin === candidateOrigin ? '/candidate-live-results.json' : '/production-live-results.json'), JSON.stringify(results, null, 2));
  await deleteApp(app);
  await db.terminate();
  console.log(JSON.stringify({ ...results, syntheticAccountsRemoved: users.length }));
}
