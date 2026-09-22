import { importPKCS8, SignJWT } from 'jose';
import { privateOperations } from './private-cloud-operations';

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()
  || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
  || 'cardvault-715ac';

interface IdentityUser {
  localId?: string;
  email?: string;
  displayName?: string;
  customAttributes?: string;
  createdAt?: string;
  lastLoginAt?: string;
}

export interface AdminUserSummary {
  uid: string;
  email: string;
  displayName: string | null;
  admin: boolean;
  pretester: boolean;
  appAccess: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export function firebaseAdminConfigured() {
  return Boolean((adminClientEmail() && adminPrivateKey()) || process.env.K_SERVICE?.trim());
}

export function withPretesterClaim(claims: Record<string, unknown>, enabled: boolean) {
  const next = { ...claims };
  if (enabled) next.pretester = true;
  else delete next.pretester;
  return next;
}

export function withAppAccessClaim(claims: Record<string, unknown>, enabled: boolean) {
  const next = { ...claims };
  if (enabled) next.appAccess = true;
  else delete next.appAccess;
  return next;
}

export function boundedPageSize(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(1_000, Math.max(1, number)) : 100;
}

export async function findAuthUserByEmail(email: string) {
  const body = await identityRequest<{ users?: IdentityUser[] }>('accounts:lookup', {
    method: 'POST', body: JSON.stringify({ email: [email] }),
  });
  const user = body.users?.[0];
  if (!user) throw new Error('AUTH_USER_NOT_FOUND');
  return summarize(user);
}

export async function listManagedUsers(pageSize: number, pageToken?: string) {
  const query = new URLSearchParams({ maxResults: String(boundedPageSize(pageSize)) });
  if (pageToken) query.set('nextPageToken', pageToken);
  const body = await identityRequest<{ users?: IdentityUser[]; nextPageToken?: string }>(`accounts:batchGet?${query}`);
  return {
    users: (body.users ?? []).map(summarize).filter((user) => user.pretester || user.appAccess),
    nextPageToken: body.nextPageToken ?? null,
  };
}

export async function setAppAccessClaim(uid: string, enabled: boolean, actorUid: string) {
  return setBooleanClaim(uid, 'appAccess', enabled, actorUid);
}

export async function setPretesterClaim(uid: string, enabled: boolean, actorUid: string) {
  return setBooleanClaim(uid, 'pretester', enabled, actorUid);
}

async function setBooleanClaim(uid: string, claim: 'pretester' | 'appAccess', enabled: boolean, actorUid: string) {
  await (await privateOperations()).changeRole(uid, claim, enabled, actorUid);
  const verified = await identityRequest<{ users?: IdentityUser[] }>('accounts:lookup', {
    method: 'POST', body: JSON.stringify({ localId: [uid] }),
  });
  const current = verified.users?.[0];
  if (!current) throw new Error('AUTH_USER_NOT_FOUND');
  return summarize(current);
}

async function identityRequest<T = Record<string, unknown>>(path: string, init: RequestInit = {}) {
  if (!firebaseAdminConfigured()) throw new Error('FIREBASE_ADMIN_NOT_CONFIGURED');
  const token = await googleAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('AUTH_USER_NOT_FOUND');
    throw new Error(`FIREBASE_ADMIN_${response.status}`);
  }
  return await response.json() as T;
}

async function googleAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const email = adminClientEmail();
  const privateKey = adminPrivateKey();
  if (!email || !privateKey) return cloudRunAccessToken();
  const now = Math.floor(Date.now() / 1_000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/identitytoolkit' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(email).setSubject(email)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt(now).setExpirationTime(now + 3_600)
    .sign(await importPKCS8(privateKey, 'RS256'));
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('FIREBASE_ADMIN_TOKEN_FAILED');
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('FIREBASE_ADMIN_TOKEN_FAILED');
  cachedToken = { value: body.access_token, expiresAt: Date.now() + Math.max(300, body.expires_in ?? 3_600) * 1_000 };
  return body.access_token;
}

async function cloudRunAccessToken() {
  if (!process.env.K_SERVICE?.trim()) throw new Error('FIREBASE_ADMIN_NOT_CONFIGURED');
  const metadataHost = process.env.GCE_METADATA_HOST?.trim() || 'metadata.google.internal';
  const response = await fetch(`http://${metadataHost}/computeMetadata/v1/instance/service-accounts/default/token`, {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error('FIREBASE_ADMIN_TOKEN_FAILED');
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('FIREBASE_ADMIN_TOKEN_FAILED');
  cachedToken = { value: body.access_token, expiresAt: Date.now() + Math.max(300, body.expires_in ?? 3_600) * 1_000 };
  return body.access_token;
}

function summarize(user: IdentityUser): AdminUserSummary {
  const claims = parseClaims(user.customAttributes);
  return {
    uid: cleanId(user.localId), email: typeof user.email === 'string' ? user.email : '',
    displayName: typeof user.displayName === 'string' && user.displayName.trim() ? user.displayName.trim().slice(0, 200) : null,
    admin: claims.admin === true, pretester: claims.pretester === true, appAccess: claims.appAccess === true,
    createdAt: millisToIso(user.createdAt), lastLoginAt: millisToIso(user.lastLoginAt),
  };
}

function parseClaims(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}
function millisToIso(value: unknown) { const number = Number(value); return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : null; }
function cleanId(value: unknown) { return typeof value === 'string' ? value.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128) : ''; }
function adminClientEmail() { return process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() ?? ''; }
function adminPrivateKey() { return (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim(); }
