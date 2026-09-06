import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export function services() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!projectId || !storageBucket) throw new Error('SERVER_NOT_CONFIGURED');
  const app = getApps().find((item) => item.name === 'private-operations') || initializeApp({
    projectId, storageBucket, credential: applicationDefault(),
  }, 'private-operations');
  return { auth: getAuth(app), db: getFirestore(app), bucket: getStorage(app).bucket() };
}

export function fail(code, status = 409) { throw Object.assign(new Error(code), { status }); }
export function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function failure(error) {
  const known = new Set(['AUTH_REQUIRED', 'ACCESS_DENIED', 'RECENT_LOGIN_REQUIRED', 'ACCOUNT_DELETING', 'INVALID_REQUEST', 'INVALID_REPORT', 'IMAGE_TOO_LARGE', 'INVALID_IMAGE_TYPE', 'NOT_FOUND', 'DELETION_DISABLED', 'CONFIRMATION_REQUIRED', 'REPORT_IMAGE_RELATION_UNSAFE']);
  return json({ ok: false, error: known.has(error?.message) ? error.message : 'SERVER_OPERATION_FAILED' }, error?.status || 503);
}
export async function actorFor(request, context, role) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) fail('AUTH_REQUIRED', 401);
  let decoded, user;
  try {
    decoded = await context.auth.verifyIdToken(token, true);
    user = await context.auth.getUser(decoded.uid);
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Za-z0-9/_-]{1,80}$/.test(error.code) ? error.code : 'unknown';
    console.warn('PRIVATE_AUTH_REJECTED', code);
    fail('AUTH_REQUIRED', 401);
  }
  if (user.disabled) fail('ACCESS_DENIED', 403);
  const claims = user.customClaims || {};
  const admin = claims.admin === true && decoded.admin === true;
  const tester = admin || (claims.pretester === true && decoded.pretester === true);
  if ((role === 'admin' && !admin) || (role === 'tester' && !tester)) fail('ACCESS_DENIED', 403);
  if ((await context.db.doc(`accountDeletionLocks/${decoded.uid}`).get()).exists) fail('ACCOUNT_DELETING', 403);
  return { uid: decoded.uid, admin, authTime: Number(decoded.auth_time || 0) * 1000 };
}
