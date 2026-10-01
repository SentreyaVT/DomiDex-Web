import { afterEach, describe, expect, it, vi } from 'vitest';
import { actorFor } from '../backend/security/firebase.mjs';
import { authorize } from '../backend/security/access.mjs';
import { uploadReport } from '../backend/security/images.mjs';

const appId = '1:123456789012:android:abcdef0123456789';
const token = 'header.payload.signature';
function fixture() {
  const context = {
    auth: {
      verifyIdToken: vi.fn(async () => ({ uid: 'private-actor', admin: true })),
      getUser: vi.fn(async () => ({ disabled: false, customClaims: { admin: true } })),
    },
    db: { doc: vi.fn(() => ({ get: async () => ({ exists: false, data: () => ({}) }) })) },
    consumeWriteQuota: vi.fn(async () => {}),
    appCheck: {
      mode: 'monitor', allowedAppIds: appId,
      verifyToken: vi.fn(async () => ({ appId })), observe: vi.fn(),
    },
  };
  return context;
}
function request(value = token, path = '/api/pretester/scan-reports', method = 'POST') {
  return new Request(`https://domidex.web.app${path}`, {
    method, headers: { authorization: 'Bearer test-session', ...(value === null ? {} : { 'X-Firebase-AppCheck': value }) },
  });
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('monitor-only App Check at the authenticated original request boundary', () => {
  it('verifies once without consuming the token, after all current authentication checks', async () => {
    const context = fixture(); const input = request();
    await actorFor(input, context, 'tester');
    await actorFor(input, context, 'tester');
    expect(context.appCheck.verifyToken).toHaveBeenCalledExactlyOnceWith(token);
    expect(context.auth.verifyIdToken).toHaveBeenCalledTimes(2);
    expect(context.auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(context.appCheck.verifyToken.mock.invocationCallOrder[0]);
    expect(context.db.doc.mock.calls.map(([path]) => path)).toContain('accountDeletionLocks/private-actor');
    expect(context.appCheck.observe).toHaveBeenCalledExactlyOnceWith({ event: 'APP_CHECK_MONITOR', route: 'report_upload', reason: 'valid' });
  });

  it('counts missing tokens without changing the original successful authorization', async () => {
    const context = fixture();
    await expect(actorFor(request(null), context, 'tester')).resolves.toMatchObject({ uid: 'private-actor' });
    expect(context.appCheck.verifyToken).not.toHaveBeenCalled();
    expect(context.appCheck.observe).toHaveBeenCalledExactlyOnceWith({ event: 'APP_CHECK_MONITOR', route: 'report_upload', reason: 'missing' });
  });

  it('keeps invalid token and provider failures out of existing HTTP responses and logs', async () => {
    const context = fixture();
    context.appCheck.verifyToken.mockRejectedValueOnce(Object.assign(new Error('PRIVATE_TOKEN_EMAIL_PROVIDER_URL'), { code: 'app-check/invalid-argument' }));
    const response = await uploadReport(request(), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'INVALID_REPORT' });
    expect(context.appCheck.observe).toHaveBeenCalledExactlyOnceWith({ event: 'APP_CHECK_MONITOR', route: 'report_upload', reason: 'invalid' });
    expect(JSON.stringify(context.appCheck.observe.mock.calls)).not.toMatch(/PRIVATE_TOKEN|private-actor|test-session|signature/);
  });

  it('marks a valid token from another Firebase app without denying the current user', async () => {
    const context = fixture(); context.appCheck.verifyToken.mockResolvedValueOnce({ appId: `${appId}00` });
    await expect(actorFor(request(), context, 'tester')).resolves.toMatchObject({ pretester: true });
    expect(context.appCheck.observe).toHaveBeenCalledExactlyOnceWith({ event: 'APP_CHECK_MONITOR', route: 'report_upload', reason: 'wrong_app' });
  });

  it('finishes the monitor wait at 250ms and never logs a second late result', async () => {
    vi.useFakeTimers(); const context = fixture(); let complete;
    context.appCheck.verifyToken.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const input = request(); const pending = actorFor(input, context, 'tester');
    await vi.advanceTimersByTimeAsync(249);
    expect(context.appCheck.observe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ uid: 'private-actor' });
    expect(context.appCheck.observe).toHaveBeenCalledExactlyOnceWith({ event: 'APP_CHECK_MONITOR', route: 'report_upload', reason: 'timeout' });
    complete({ appId }); await Promise.resolve();
    await actorFor(input, context, 'tester');
    expect(context.appCheck.verifyToken).toHaveBeenCalledTimes(1);
    expect(context.appCheck.observe).toHaveBeenCalledTimes(1);
  });

  it('passes the exact original headers through authorize while preserving string callers', async () => {
    const context = fixture(); const input = request(token, '/api/admin/testers', 'PATCH');
    await expect(authorize('Bearer test-session', 'admin', context, input)).resolves.toMatchObject({ sub: 'private-actor' });
    expect(context.appCheck.verifyToken).toHaveBeenCalledExactlyOnceWith(token);
    expect(context.appCheck.observe).toHaveBeenCalledExactlyOnceWith({ event: 'APP_CHECK_MONITOR', route: 'tester_change', reason: 'valid' });
    await expect(authorize('Bearer test-session', 'admin', context)).resolves.toMatchObject({ sub: 'private-actor' });
    expect(context.appCheck.verifyToken).toHaveBeenCalledTimes(1);
  });

  it('never uses a valid App Check token as authorization or checks it before denied roles', async () => {
    const context = fixture(); context.auth.getUser.mockResolvedValueOnce({ disabled: false, customClaims: {} });
    await expect(actorFor(request(), context, 'tester')).rejects.toMatchObject({ status: 403 });
    const missing = request(); missing.headers.delete('authorization');
    await expect(actorFor(missing, context, 'tester')).rejects.toMatchObject({ status: 401 });
    expect(context.appCheck.verifyToken).not.toHaveBeenCalled();
    expect(context.appCheck.observe).not.toHaveBeenCalled();
  });

  it('does not initialize verification or metrics in the default off mode', async () => {
    vi.stubEnv('DOMIDEX_APP_CHECK_MODE', 'off'); const context = fixture(); delete context.appCheck.mode;
    await expect(actorFor(request(), context, 'tester')).resolves.toMatchObject({ uid: 'private-actor' });
    expect(context.appCheck.verifyToken).not.toHaveBeenCalled();
    expect(context.appCheck.observe).not.toHaveBeenCalled();
  });

  it('checks the current deletion lock before observing a token', async () => {
    const context = fixture();
    context.db.doc.mockImplementation(path => ({ get: async () => ({ exists: path.startsWith('accountDeletionLocks/'), data: () => ({}) }) }));
    await expect(actorFor(request(), context, 'tester')).rejects.toMatchObject({ status: 403, message: 'ACCOUNT_DELETING' });
    expect(context.appCheck.verifyToken).not.toHaveBeenCalled(); expect(context.appCheck.observe).not.toHaveBeenCalled();
  });

  it('rejects a mismatched original authorization instead of silently switching actors', async () => {
    const context = fixture();
    await expect(authorize('Bearer other-actor', 'admin', context, request())).rejects.toMatchObject({ status: 401 });
    expect(context.auth.verifyIdToken).not.toHaveBeenCalled(); expect(context.appCheck.verifyToken).not.toHaveBeenCalled();
  });

  it('preserves existing rate limits even when App Check is valid', async () => {
    const context = fixture();
    context.consumeWriteQuota.mockRejectedValueOnce(Object.assign(new Error('RATE_LIMITED'), { status: 429, retryAfterSeconds: 60 }));
    const response = await uploadReport(request(), context);
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60');
    expect(await response.json()).toEqual({ ok: false, error: 'RATE_LIMITED', retryAfterSeconds: 60 });
    expect(context.appCheck.verifyToken).toHaveBeenCalledOnce();
  });
});
