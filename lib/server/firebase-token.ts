import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'cardvault-715ac';
const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export interface VerifiedFirebaseToken extends JWTPayload { user_id?: string; admin?: boolean; pretester?: boolean; appAccess?: boolean; }

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
  const token = await verifyFirebaseToken(authorization);
  if (token.admin !== true) throw new Error('ADMIN_REQUIRED');
  return token;
}

export async function requirePretesterToken(authorization: string | null) {
  const token = await verifyFirebaseToken(authorization);
  if (token.admin !== true && token.pretester !== true) throw new Error('PRETESTER_REQUIRED');
  return token;
}

export async function requireAppAccessToken(authorization: string | null) {
  const token = await verifyFirebaseToken(authorization);
  if (token.admin !== true && token.appAccess !== true) throw new Error('APP_ACCESS_REQUIRED');
  return token;
}
