import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { privateOperations } from './private-cloud-operations';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'cardvault-715ac';
const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export interface VerifiedFirebaseToken extends JWTPayload { user_id?: string; admin?: boolean; pretester?: boolean; appAccess?: boolean; scannerLabAccess?: boolean; }

export async function verifyFirebaseToken(authorization: string | null): Promise<VerifiedFirebaseToken> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error('AUTH_REQUIRED');
  const { payload } = await jwtVerify(token, keys, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('AUTH_REQUIRED');
  return payload as VerifiedFirebaseToken;
}

export async function requireAdminToken(authorization: string | null) {
  return currentAuthorization(authorization, 'admin', 'ADMIN_REQUIRED');
}

export async function requireScannerLabToken(authorization: string | null) {
  return currentAuthorization(authorization, 'scannerLab', 'SCANNER_LAB_REQUIRED');
}

export async function requirePretesterToken(authorization: string | null) {
  return currentAuthorization(authorization, 'tester', 'PRETESTER_REQUIRED');
}

export async function requireAppAccessToken(authorization: string | null) {
  return currentAuthorization(authorization, 'app', 'APP_ACCESS_REQUIRED');
}

async function currentAuthorization(authorization: string | null, role: 'admin' | 'tester' | 'app' | 'scannerLab', denied: string): Promise<VerifiedFirebaseToken> {
  if (!authorization) throw new Error('AUTH_REQUIRED');
  try { return await (await privateOperations()).authorize(authorization, role); }
  catch (error) {
    if (error instanceof Error && ['ACCESS_DENIED', 'ACCOUNT_DELETING'].includes(error.message)) throw new Error(denied);
    throw error;
  }
}
