// Observation only. This does not grant/deny access and is not an Auth substitute.
// Memoization is per original Request, never per token, UID or process-wide cache key.
const observed = new WeakMap();
const routes = new Map([
  ['POST /api/pretester/scan-reports', 'report_upload'],
  ['POST /api/scanner/reviewed-knowledge', 'reviewed_knowledge'],
  ['GET /api/binder-shares', 'share_list'],
  ['POST /api/binder-shares', 'share_create'],
  ['DELETE /api/binder-shares', 'share_revoke'],
  ['POST /api/account/delete', 'account_delete'],
  ['GET /api/admin/testers', 'tester_list'],
  ['POST /api/admin/testers', 'tester_lookup_or_delete'],
  ['PATCH /api/admin/testers', 'tester_change'],
  ['GET /api/admin/scan-reports', 'report_list'],
  ['PATCH /api/admin/scan-reports', 'report_review'],
  ['DELETE /api/admin/scan-reports', 'report_delete'],
  ['GET /api/admin/scanner-profiles', 'profile_list'],
  ['POST /api/admin/scanner-profiles', 'profile_write'],
  ['GET /api/admin/scanner-references', 'reference_list'],
  ['PUT /api/admin/site-content', 'site_content_write'],
]);
const firebaseAppId = /^1:[0-9]{1,20}:(?:android|ios|web):[a-f0-9]{1,64}$/i;
const invalidCodes = new Set(['app-check/invalid-argument', 'app-check/invalid-token', 'app-check/token-expired', 'app-check/app-check-token-expired']);

export function appCheckRoute(request) {
  const path = new URL(request.url).pathname;
  const fixed = routes.get(`${request.method} ${path}`);
  if (fixed) return fixed;
  if (request.method === 'GET' && /^\/api\/admin\/scan-reports\/[A-Za-z0-9._-]{1,128}\/image$/.test(path)) return 'report_image';
  if (request.method === 'GET' && /^\/api\/admin\/scanner-reference-image\/[A-Za-z0-9._-]{1,200}$/.test(path)) return 'reference_image';
  return null;
}

function configuration(options) {
  const mode = options.mode ?? process.env.DOMIDEX_APP_CHECK_MODE ?? 'off';
  if (mode === 'off') return { mode };
  if (mode !== 'monitor') return null; // There is intentionally no enforce mode.
  const raw = options.allowedAppIds ?? process.env.DOMIDEX_APP_CHECK_ALLOWED_APP_IDS;
  if (typeof raw !== 'string' || !raw || raw.length > 4096) return null;
  const ids = raw.split(',').map(value => value.trim());
  if (ids.length > 32 || ids.some(id => !firebaseAppId.test(id))) return null;
  return { mode, ids: new Set(ids) };
}

async function verifyBounded(token, ids, verifyToken) {
  let timer;
  try {
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 250); });
    // No consume option/replay RPC; the installed Admin SDK verifies signature,
    // issuer, audience and expiry. Handle late failures without duplicate metrics.
    const verification = Promise.resolve().then(() => verifyToken(token)).then(
      result => ids.has(result?.appId) ? 'valid' : 'wrong_app',
      error => invalidCodes.has(error?.code) ? 'invalid' : 'unavailable',
    );
    return await Promise.race([verification, timeout]);
  } finally { clearTimeout(timer); }
}

async function observe(request, context, route) {
  const options = context.appCheck ?? {};
  const config = configuration(options);
  if (config?.mode === 'off') return;
  let reason = 'config_error';
  if (config) {
    const token = request.headers.get('X-Firebase-AppCheck');
    if (!token) reason = 'missing';
    else if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) reason = 'invalid';
    else if (typeof options.verifyToken !== 'function') reason = 'unavailable';
    else reason = await verifyBounded(token, config.ids, options.verifyToken);
  }
  const emit = options.observe ?? (event => console.info(JSON.stringify(event)));
  // Never include token, UID, app ID, URL, body or provider error details.
  try { void Promise.resolve(emit({ event: 'APP_CHECK_MONITOR', route, reason })).catch(() => {}); }
  catch { /* An observer outage must not alter legitimate responses. */ }
}

export function observeAppCheck(request, context) {
  const previous = observed.get(request);
  if (previous) return previous;
  const route = appCheckRoute(request);
  if (!route) return Promise.resolve(); // Public catalog/share reads excluded.
  const pending = observe(request, context, route).catch(() => {});
  observed.set(request, pending);
  return pending;
}
