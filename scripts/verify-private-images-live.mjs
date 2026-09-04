import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { accessToken, liveAuth, cloudCall, bucket, projectId } from './privacy-live-context.mjs';

const origin = process.argv.find((arg) => arg.startsWith('--origin='))?.slice(9) || 'https://domidex.web.app';
assert(origin === 'https://domidex.web.app' || origin === 'https://privacy-gate-20260904---domidex-web-olqifpb3pa-ew.a.run.app');
const token = accessToken();
const auth = liveAuth(token);
const prefix = `privacy-gate-${randomUUID()}`;
const created = [];
const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
assert(key, 'PUBLIC_FIREBASE_CONFIG_REQUIRED');
const storageBase = `https://storage.googleapis.com/storage/v1/b/${bucket}/o`;
const documentBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const report = { origin, isolatedAccounts: 0, cleanup: false };
async function listImages() {
  const images = []; let cursor = '';
  do {
    const page = await (await cloudCall(token, `${storageBase}?prefix=scanner-report-images%2F&maxResults=200${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`)).json();
    images.push(...(page.items || [])); cursor = page.nextPageToken || '';
  } while (cursor);
  return images;
}
async function imageResponse(idToken, id) {
  return fetch(`${origin}/api/admin/scan-reports/${id}/image`, { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {}, signal: AbortSignal.timeout(45_000) });
}
const tokens = {};
try {
  for (const [role, claims] of Object.entries({ normal: { appAccess: true }, tester: { pretester: true }, admin: { admin: true } })) {
    const uid = `${prefix}-${role}`;
    await auth.createUser({ uid }); created.push(uid);
    await auth.setCustomUserClaims(uid, claims);
    const customToken = await auth.createCustomToken(uid);
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    const body = await response.json();
    assert(response.ok && body.idToken, `ISOLATED_SIGN_IN_FAILED_${response.status}`);
    tokens[role] = body.idToken;
    await auth.verifyIdToken(body.idToken, true);
  }
  report.isolatedAccounts = created.length;
  if (process.argv.includes('--deletion-ready')) {
    const target = created.find((uid) => uid.endsWith('-tester'));
    for (const [role, idToken, expected] of [['anonymous', null, 401], ['normal', tokens.normal, 403]]) {
      const response = await fetch(`${origin}/api/admin/testers?action=delete-account`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ uid: target, confirm: 'DELETE_DOMIDEX_ACCOUNT' }),
      });
      assert.equal(response.status, expected, 'LIVE_DELETION_BOUNDARY_FAILED');
      report[`${role}DeletionDenied`] = true;
    }
    const invalid = await fetch(`${origin}/api/admin/testers?action=delete-account`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.admin}` }, body: JSON.stringify({ uid: target, confirm: 'INVALID' }) });
    assert.equal(invalid.status, 400, 'LIVE_DELETION_NOT_READY');
    report.deletionReadyBoundary = true;
  }
  const form = new FormData();
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPZkAAAAASUVORK5CYII=', 'base64');
  form.set('image', new File([image], 'capture.png', { type: 'image/png' }));
  form.set('report', JSON.stringify({ scanId: prefix, captureType: 'MANUAL_CAPTURE', failureReason: 'Isolated privacy release verification, automatically removed.' }));
  const uploaded = await fetch(`${origin}/api/pretester/scan-reports`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.tester}` }, body: form, signal: AbortSignal.timeout(60_000) });
  if (uploaded.status !== 201) {
    const content = await uploaded.clone().text();
    report.failureLayer = content.includes('Your client does not have permission') || content.includes('Unauthorized') ? 'CLOUD_RUN_FRONT_DOOR' : content.includes('AUTH_REQUIRED') ? 'APP_AUTH' : 'OTHER';
  }
  assert.equal(uploaded.status, 201, `UPLOAD_HTTP_${uploaded.status}`);
  const { reportId } = await uploaded.json();
  report.upload = 201;
  for (const [role, idToken] of [['unauthenticated', null], ...Object.entries(tokens)]) {
    const response = await imageResponse(idToken, reportId);
    report[role] = response.status;
    assert.equal(response.status, role === 'admin' ? 200 : role === 'unauthenticated' ? 401 : 403);
    if (role === 'admin') assert(Buffer.from(await response.arrayBuffer()).equals(image));
  }
  let objects = await listImages();
  const newObject = objects.find((item) => item.metadata?.reportId === reportId);
  assert(newObject && !newObject.metadata.firebaseStorageDownloadTokens, 'NEW_PUBLIC_TOKEN_CREATED');
  report.newUploadHasNoDownloadtoken = true;
  const existing = objects.find((item) => !created.includes(item.metadata?.ownerUid) && item.metadata?.reportId);
  if (existing) {
    const bytes = await imageResponse(tokens.admin, existing.metadata.reportId);
    assert.equal(bytes.status, 200);
    const receivedHash = createHash('md5').update(Buffer.from(await bytes.arrayBuffer())).digest('base64');
    assert.equal(receivedHash, existing.md5Hash, 'EXISTING_BYTES_CHANGED');
    report.existingPrivateImageUnchanged = true;
  }
  if (process.argv.includes('--revoke-existing-tokens')) {
    let revoked = 0, oldLinksDenied = 0;
    for (const item of objects) {
      const oldTokens = (item.metadata?.firebaseStorageDownloadTokens || '').split(',').filter(Boolean);
      if (!oldTokens.length) continue;
      const path = `${storageBase}/${encodeURIComponent(item.name)}`;
      await cloudCall(token, `${path}?ifGenerationMatch=${item.generation}&ifMetagenerationMatch=${item.metageneration}`, {
        method: 'PATCH', body: JSON.stringify({ cacheControl: 'private, no-store', metadata: { firebaseStorageDownloadTokens: null } }),
      });
      const after = await (await cloudCall(token, path)).json();
      assert.equal(after.generation, item.generation); assert.equal(after.md5Hash, item.md5Hash);
      assert.equal(after.size, item.size); assert(!after.metadata?.firebaseStorageDownloadTokens);
      for (const [name, value] of Object.entries(item.metadata || {})) if (name !== 'firebaseStorageDownloadTokens') assert.equal(after.metadata[name], value);
      revoked++;
      for (const oldToken of oldTokens) {
        const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(item.name)}?alt=media&token=${encodeURIComponent(oldToken)}`, { signal: AbortSignal.timeout(30_000) });
        assert([401, 403, 404].includes(response.status), 'OLD_TOKEN_STILL_PUBLIC'); oldLinksDenied++;
      }
    }
    report.revokedObjects = revoked; report.oldLinksDenied = oldLinksDenied;
  }
  if (process.argv.includes('--strict-rules')) {
    const direct = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(newObject.name)}`;
    for (const [role, idToken] of [['anonymous', null], ...Object.entries(tokens)]) {
      const response = await fetch(direct, { headers: idToken ? { Authorization: `Firebase ${idToken}` } : {} });
      assert([401, 403].includes(response.status), `DIRECT_METADATA_NOT_DENIED_${role}`);
    }
    objects = await listImages();
    assert(objects.every((item) => !item.metadata?.firebaseStorageDownloadTokens));
    report.directMetadataDeniedAllRoles = true;
    report.allLiveReportImagesTokenFree = true;
  }
} catch (error) {
  report.error = error.code || (error.message?.match(/^[A-Z0-9_]+$/) ? error.message : 'LIVE_ASSERTION_FAILED');
  if (error.code === 'ERR_ASSERTION') report.check = error.message?.match(/^[A-Z][A-Z0-9_]+/)?.[0] || 'ASSERTION';
  process.exitCode = 1;
} finally {
  try {
    // Exact ownership of random users created in THIS run only; no production-user deletion.
    for (const item of await listImages()) if (created.includes(item.metadata?.ownerUid)) {
      const id = item.metadata.reportId;
      if (id && /^[A-Za-z0-9._-]{1,128}$/.test(id)) {
        const document = await fetch(`${documentBase}/scannerReports/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (document.ok) {
          const data = await document.json();
          assert(created.includes(data.fields.ownerUid.stringValue), 'CLEANUP_OWNER_MISMATCH');
          await cloudCall(token, `${documentBase}/scannerReports/${id}`, { method: 'DELETE' });
        }
      }
      await cloudCall(token, `${storageBase}/${encodeURIComponent(item.name)}?ifGenerationMatch=${item.generation}`, { method: 'DELETE' });
    }
    for (const uid of created) {
      assert(uid.startsWith(`${prefix}-`)); await auth.deleteUser(uid);
    }
    report.cleanup = true;
  } catch { report.cleanup = false; process.exitCode = 1; }
  fs.writeFileSync('.domidex/security-gate/live-image-result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
