import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { firebaseCliToken, project, folder } from './sharing-cloud-context.mjs';

// Recovery only for this run's synthetic fixture if a tool closes stdin unexpectedly.
const { url, synthetic } = JSON.parse(await fs.readFile(folder + '/visual-test-link.json', 'utf8'));
assert.equal(synthetic, true);
const rawToken = new URL(url).pathname.match(/^\/share\/([A-Za-z0-9_-]{43})$/)?.[1]; assert(rawToken);
const token = await firebaseCliToken();
const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: token });
const db = new Firestore({ projectId: project, authClient });
const app = initializeApp({ projectId: project, credential: { getAccessToken: async () => ({ access_token: token, expires_in: 3600 }) } }, 'sharing-fixture-cleanup');
const auth = getAuth(app);
const doc = await db.doc('privateBinderShares/' + createHash('sha256').update(rawToken).digest('hex')).get();
const owner = doc.get('ownerUid');
assert(typeof owner === 'string' && /^sharing-qa-[a-f0-9-]{36}-owner$/.test(owner), 'NOT_OUR_SYNTHETIC_FIXTURE');
const prefix = owner.slice(0, -6);
const shares = await db.collection('privateBinderShares').where('ownerUid', '==', owner).get();
for (const share of shares.docs) { assert.equal(share.get('binderId'), 'binder-test'); await share.ref.delete(); }
for (const role of ['owner', 'other', 'denied']) {
  const uid = prefix + '-' + role;
  await db.recursiveDelete(db.doc('users/' + uid)); await db.doc('accountAccess/' + uid).delete(); await auth.deleteUser(uid);
}
await db.terminate(); await deleteApp(app);
console.log(JSON.stringify({ syntheticAccountsRemoved: 3, syntheticSharesRemoved: shares.size, realUserDataChanged: false }));
