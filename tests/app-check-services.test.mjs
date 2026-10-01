import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, services } from '../backend/security/firebase.mjs';

const fixture = vi.hoisted(() => {
  const app = { name: 'private-operations' };
  const decoded = { uid: 'synthetic-user', admin: true };
  const auth = { verifyIdToken: vi.fn(async () => decoded), getUser: vi.fn(async () => ({ disabled: false, customClaims: { admin: true } })) };
  const db = { doc: vi.fn(() => ({ get: async () => ({ exists: false, data: () => ({}) }) })) };
  const verifier = { verifyToken: vi.fn(async () => ({ appId: '1:123456789012:android:abcdef0123456789' })) };
  return { app, auth, db, verifier, getAppCheck: vi.fn(() => verifier), initializeApp: vi.fn(), applicationDefault: vi.fn() };
});
vi.mock('firebase-admin/app', () => ({ getApps: () => [fixture.app], initializeApp: fixture.initializeApp, applicationDefault: fixture.applicationDefault }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => fixture.auth }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => fixture.db }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({}) }) }));
vi.mock('firebase-admin/app-check', () => ({ getAppCheck: fixture.getAppCheck }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('FIREBASE_ADMIN_PROJECT_ID', 'demo-domidex-app-check');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'demo-domidex-app-check.firebasestorage.app');
  vi.stubEnv('DOMIDEX_APP_CHECK_MODE', undefined);
  vi.stubEnv('DOMIDEX_APP_CHECK_ALLOWED_APP_IDS', '1:123456789012:android:abcdef0123456789');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const request = value => new Request('https://domidex.web.app/api/pretester/scan-reports', {
  method: 'POST', headers: { authorization: 'Bearer synthetic-auth', ...(value ? { 'X-Firebase-AppCheck': value } : {}) },
});

describe('production services factory App Check wiring without external credentials', () => {
  it('does not initialize App Check in off mode', async () => {
    await actorFor(request('header.payload.signature'), services(), 'tester');
    expect(fixture.getAppCheck).not.toHaveBeenCalled(); expect(fixture.verifier.verifyToken).not.toHaveBeenCalled();
    expect(fixture.applicationDefault).not.toHaveBeenCalled();
  });
  it('uses the existing app SDK verifier without replay consumption after Auth', async () => {
    vi.stubEnv('DOMIDEX_APP_CHECK_MODE', 'monitor'); const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    await actorFor(request('header.payload.signature'), services(), 'tester');
    expect(fixture.getAppCheck).toHaveBeenCalledExactlyOnceWith(fixture.app);
    expect(fixture.verifier.verifyToken).toHaveBeenCalledExactlyOnceWith('header.payload.signature');
    expect(fixture.auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(fixture.getAppCheck.mock.invocationCallOrder[0]);
    expect(output).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'APP_CHECK_MONITOR', route: 'report_upload', reason: 'valid' }));
  });
  it('does not initialize the SDK for a missing token in monitor mode', async () => {
    vi.stubEnv('DOMIDEX_APP_CHECK_MODE', 'monitor'); vi.spyOn(console, 'info').mockImplementation(() => {});
    await actorFor(request(), services(), 'tester');
    expect(fixture.getAppCheck).not.toHaveBeenCalled(); expect(fixture.verifier.verifyToken).not.toHaveBeenCalled();
  });
});
