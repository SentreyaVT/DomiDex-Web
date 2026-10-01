import { randomUUID } from 'node:crypto';
import { actorFor, fail, services } from './firebase.mjs';
import { consumeWriteQuota } from './rate-limit.mjs';

// Invoked only by authenticated server routes, never exposed as a general API.
export async function authorize(authorization, role, context = services()) {
  const actor = await actorFor(new Request('https://domidex.web.app/', {
    headers: authorization ? { authorization } : {},
  }), context, role);
  return { ...actor, sub: actor.uid };
}

export async function serverAuthorization(context = services()) {
  const credential = context.auth.app.options.credential;
  if (!credential) fail('SERVER_NOT_CONFIGURED', 503);
  const token = await credential.getAccessToken();
  return `Bearer ${token.access_token}`;
}

export async function changeRole(uid, role, enabled, authorization, context = services()) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(uid) || !['appAccess', 'pretester', 'scannerLabAccess'].includes(role)
    || typeof enabled !== 'boolean') fail('INVALID_CHANGE', 400);
  const actor = await actorFor(new Request('https://domidex.web.app/', {
    headers: authorization ? { authorization } : {},
  }), context, 'admin');
  if (enabled) await consumeWriteQuota(context, 'roleGrant', actor.uid);
  const actorUid = actor.uid;
  const lease = randomUUID();
  const ref = context.db.doc(`accountAccess/${uid}`);
  // Serialize changes across Cloud Run instances and deny the affected role before
  // touching Auth. A partial failure is denied until an operator retries.
  await context.db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (Number(current.get('leaseUntil') || 0) > Date.now()) fail('ACCESS_CHANGE_BUSY', 409);
    tx.set(ref, { [role]: false, lease, leaseUntil: Date.now() + 120_000, updatedAt: Date.now() }, { merge: true });
  });
  try {
    const user = await context.auth.getUser(uid);
    const claims = { ...user.customClaims };
    if (enabled) claims[role] = true;
    else delete claims[role];
    await context.auth.setCustomUserClaims(uid, claims);
    if (!enabled) await context.auth.revokeRefreshTokens(uid);
    const verified = await context.auth.getUser(uid);
    if ((verified.customClaims?.[role] === true) !== enabled) fail('ACCESS_CHANGE_UNVERIFIED', 503);
    await context.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.get('lease') !== lease) fail('ACCESS_CHANGE_BUSY', 409);
      tx.set(ref, { [role]: enabled, lease: null, leaseUntil: 0, updatedAt: Date.now() }, { merge: true });
      tx.create(context.db.collection('accessAudit').doc(), {
        actorUid, targetUid: uid, role, enabled, createdAt: Date.now(),
      });
    });
  } catch (error) {
    await context.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.get('lease') === lease) tx.set(ref, { lease: null, leaseUntil: 0 }, { merge: true });
    });
    throw error;
  }
}
