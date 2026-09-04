import { execFileSync } from 'node:child_process';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export const projectId = 'cardvault-715ac';
export const bucket = 'cardvault-715ac.firebasestorage.app';
export function accessToken() {
  try { return execFileSync('pwsh.exe', ['-NoProfile', '-Command', '& gcloud auth print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new Error('CLI_AUTH_UNAVAILABLE'); }
}
export function liveAuth(token) {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  return getAuth(initializeApp({ projectId, serviceAccountId: '361496003351-compute@developer.gserviceaccount.com',
    credential: { getAccessToken: async () => ({ access_token: token, expires_in: 3600 }) },
  }, `privacy-live-${Date.now()}`));
}
export async function cloudCall(token, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': projectId, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`CLOUD_HTTP_${response.status}`);
  return response;
}
