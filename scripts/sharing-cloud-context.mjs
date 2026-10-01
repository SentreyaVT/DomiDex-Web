import { createRequire } from 'node:module';
import path from 'node:path';

export const project = 'cardvault-715ac';
export const serviceAccount = '361496003351-compute@developer.gserviceaccount.com';
export const folder = process.env.SHARING_RUN_FOLDER || '.domidex/sharing-activation';

/** Reuse the existing Firebase CLI login. No credentials are written or printed. */
export async function firebaseCliToken() {
  const require = createRequire(import.meta.url);
  const cli = path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib');
  const { configstore } = require(path.join(cli, 'configstore.js'));
  const api = require(path.join(cli, 'api.js'));
  const refresh = configstore.get('tokens')?.refresh_token;
  if (!refresh) throw Error('FIREBASE_CLI_LOGIN_REQUIRED');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: refresh, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw Error('FIREBASE_CLI_LOGIN_REQUIRED');
  return data.access_token;
}
export function cloudClient(token) {
  return async (url, method = 'GET', body) => {
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': project },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`CLOUD_HTTP_${response.status}`);
    return response.status === 204 ? {} : response.json();
  };
}
