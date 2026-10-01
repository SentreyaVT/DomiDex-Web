import { requireAdminToken } from '@/lib/server/firebase-token';
import { privateOperations } from '@/lib/server/private-cloud-operations';
import { boundedPageSize, findAuthUserByEmail, listManagedUsers, setAppAccessClaim, setPretesterClaim, setScannerLabAccessClaim } from '@/lib/server/firebase-admin-auth';

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('action') === 'delete-account') return (await privateOperations()).deletionStatus(request);
  try {
    await requireAdminToken(request.headers.get('authorization'));
    const url = new URL(request.url);
    const result = await listManagedUsers(boundedPageSize(url.searchParams.get('pageSize')), cleanToken(url.searchParams.get('pageToken')));
    return json({ configured: true, ...result });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (new URL(request.url).searchParams.get('action') === 'delete-account') return (await privateOperations()).deletionRequest(request);
  try {
    await requireAdminToken(request.headers.get('authorization'));
    const body = await request.json() as { email?: unknown };
    const email = cleanEmail(body.email);
    if (!email) throw new Error('INVALID_EMAIL');
    return json({ configured: true, user: await findAuthUserByEmail(email) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireAdminToken(request.headers.get('authorization'));
    const body = await request.json() as { uid?: unknown; pretester?: unknown; appAccess?: unknown; scannerLabAccess?: unknown };
    const uid = cleanUid(body.uid);
    const pretesterChange = typeof body.pretester === 'boolean';
    const appAccessChange = typeof body.appAccess === 'boolean';
    const scannerLabChange = typeof body.scannerLabAccess === 'boolean';
    if (!uid || [pretesterChange, appAccessChange, scannerLabChange].filter(Boolean).length !== 1) throw new Error('INVALID_CHANGE');
    const updated = pretesterChange ? await setPretesterClaim(uid, body.pretester as boolean, String(actor.sub))
      : appAccessChange ? await setAppAccessClaim(uid, body.appAccess as boolean, String(actor.sub))
      : await setScannerLabAccessClaim(uid, body.scannerLabAccess as boolean, String(actor.sub));
    return json({ configured: true, user: updated, tokenRefreshRequired: true });
  } catch (error) { return errorResponse(error); }
}

function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
function cleanEmail(value: unknown) { const text = typeof value === 'string' ? value.trim().toLowerCase() : ''; return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length <= 254 ? text : ''; }
function cleanUid(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : ''; }
function cleanToken(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9._~-]{1,2000}$/.test(value) ? value : undefined; }
function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN';
  if (message === 'AUTH_REQUIRED') return json({ error: 'Anmeldung erforderlich.' }, 401);
  if (message === 'ADMIN_REQUIRED') return json({ error: 'Administratorrechte erforderlich.' }, 403);
  if (message === 'FIREBASE_ADMIN_NOT_CONFIGURED') return json({ configured: false, error: 'Die geschützte Firebase-Admin-Identität ist noch nicht verbunden.' }, 503);
  if (message === 'AUTH_USER_NOT_FOUND') return json({ error: 'Kein Firebase-Nutzer mit diesen Daten gefunden.' }, 404);
  if (message === 'INVALID_EMAIL') return json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }, 400);
  if (message === 'INVALID_CHANGE') return json({ error: 'Ungültige Rollenänderung.' }, 400);
  if (message === 'ACCESS_CHANGE_BUSY') return json({ error: 'Die Freigabe wird gerade geändert. Bitte erneut versuchen.' }, 409);
  return json({ error: 'Firebase Auth konnte die Anfrage nicht sicher verarbeiten.' }, 502);
}
