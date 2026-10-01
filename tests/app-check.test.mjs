import { afterEach, describe, expect, it, vi } from 'vitest';
import { appCheckRoute, observeAppCheck } from '../backend/security/app-check.mjs';

const appId = '1:123456789012:android:abcdef0123456789';
const token = 'header.payload.signature';
function fixture(overrides = {}) {
  return { appCheck: { mode: 'monitor', allowedAppIds: appId, verifyToken: vi.fn(async () => ({ appId })), observe: vi.fn(), ...overrides } };
}
const request = (value = token, path = '/api/binder-shares', method = 'POST') => new Request(`https://domidex.web.app${path}`, {
  method, headers: value === null ? {} : { 'X-Firebase-AppCheck': value },
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('bounded optional App Check observation contract', () => {
  it('defaults to off with zero verifier/metric calls even if allowlist is absent', async () => {
    vi.stubEnv('DOMIDEX_APP_CHECK_MODE', undefined); vi.stubEnv('DOMIDEX_APP_CHECK_ALLOWED_APP_IDS', undefined);
    const context = fixture({ mode: undefined, allowedAppIds: undefined });
    await observeAppCheck(request(), context);
    expect(context.appCheck.verifyToken).not.toHaveBeenCalled(); expect(context.appCheck.observe).not.toHaveBeenCalled();
  });

  it.each(['enforce', 'MONITOR', '', 'off ', 'invalid'])('mode %j never enables enforcement and emits only config_error', async mode => {
    const context = fixture({ mode }); await observeAppCheck(request(), context);
    expect(context.appCheck.verifyToken).not.toHaveBeenCalled();
    expect(context.appCheck.observe).toHaveBeenCalledExactlyOnceWith({ event: 'APP_CHECK_MONITOR', route: 'share_create', reason: 'config_error' });
  });

  it.each(['', '*', 'com.dominik.cardvault', `${appId},`, 'uid-or-email@example.invalid', `1:123:android:${'a'.repeat(65)}`, Array(33).fill(appId).join(',')])('rejects invalid or overbroad allowed-app configuration %j', async allowedAppIds => {
    const context = fixture({ allowedAppIds }); await observeAppCheck(request(), context);
    expect(context.appCheck.verifyToken).not.toHaveBeenCalled();
    expect(context.appCheck.observe.mock.calls[0][0].reason).toBe('config_error');
  });

  it('uses explicit comma-separated exact app IDs without substring matching', async () => {
    const webId = '1:123456789012:web:001122334455667788';
    const context = fixture({ allowedAppIds: `${appId}, ${webId}` });
    context.appCheck.verifyToken.mockResolvedValueOnce({ appId: webId });
    await observeAppCheck(request(), context);
    context.appCheck.verifyToken.mockResolvedValueOnce({ appId: `${webId}0` });
    await observeAppCheck(request(), context);
    expect(context.appCheck.observe.mock.calls.map(([event]) => event.reason)).toEqual(['valid', 'wrong_app']);
  });

  it.each(['not-a-jwt', 'Bearer secret', `${token},${token}`, 'a.b.c.d', `a.b.${'a'.repeat(4093)}`])('does not verify malformed or oversized headers', async input => {
    const context = fixture(); await observeAppCheck(request(input), context);
    expect(context.appCheck.verifyToken).not.toHaveBeenCalled();
    expect(context.appCheck.observe.mock.calls[0][0].reason).toBe('invalid');
  });

  it('accepts the exact 4096-character header boundary for verification', async () => {
    const context = fixture(); const input = `a.b.${'a'.repeat(4092)}`;
    expect(input.length).toBe(4096); await observeAppCheck(request(input), context);
    expect(context.appCheck.verifyToken).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each([
    ['app-check/token-expired', 'invalid'], ['app-check/invalid-argument', 'invalid'],
    ['app-check/app-check-token-expired', 'invalid'],
    ['app-check/invalid-token', 'invalid'], ['app-check/internal-error', 'unavailable'],
    ['ENOTFOUND', 'unavailable'],
  ])('maps verifier failure %s without raw errors', async (code, reason) => {
    const context = fixture(); context.appCheck.verifyToken.mockRejectedValueOnce(Object.assign(new Error(`SECRET_${token}`), { code }));
    await expect(observeAppCheck(request(), context)).resolves.toBeUndefined();
    expect(context.appCheck.observe).toHaveBeenCalledExactlyOnceWith({ event: 'APP_CHECK_MONITOR', route: 'share_create', reason });
  });

  it('deduplicates concurrent calls only per original Request, not shared tokens', async () => {
    const context = fixture(); const first = request();
    await Promise.all([observeAppCheck(first, context), observeAppCheck(first, context)]);
    await observeAppCheck(request(), context);
    expect(context.appCheck.verifyToken).toHaveBeenCalledTimes(2); expect(context.appCheck.observe).toHaveBeenCalledTimes(2);
  });

  it('does not wait for an unavailable or hung metric sink', async () => {
    const context = fixture({ observe: vi.fn(() => new Promise(() => {})) });
    await expect(observeAppCheck(request(), context)).resolves.toBeUndefined();
    context.appCheck.observe.mockImplementationOnce(() => { throw new Error('SECRET_SINK'); });
    await expect(observeAppCheck(request(), context)).resolves.toBeUndefined();
    context.appCheck.observe.mockRejectedValueOnce(new Error('SECRET_ASYNC_SINK'));
    await expect(observeAppCheck(request(), context)).resolves.toBeUndefined();
  });

  it('catches a late verifier rejection after the budget and emits only timeout once', async () => {
    vi.useFakeTimers(); let reject;
    const context = fixture({ verifyToken: vi.fn(() => new Promise((_resolve, failure) => { reject = failure; })) });
    const pending = observeAppCheck(request(), context); await vi.advanceTimersByTimeAsync(250); await pending;
    reject(new Error('SECRET_LATE')); await Promise.resolve(); await Promise.resolve();
    expect(context.appCheck.observe).toHaveBeenCalledExactlyOnceWith({ event: 'APP_CHECK_MONITOR', route: 'share_create', reason: 'timeout' });
  });

  it('does not monitor public reads, unknown paths or unsupported methods', async () => {
    const context = fixture();
    for (const path of ['/api/shared-binders/secret-token', '/api/tcgdex/cards/swsh1-1', '/api/cardmarket/prices', '/api/binder-shares/secret', '/']) {
      expect(appCheckRoute(request(token, path, 'GET'))).toBeNull();
      await observeAppCheck(request(token, path, 'GET'), context);
    }
    await observeAppCheck(request(token, '/api/binder-shares', 'PUT'), context);
    expect(context.appCheck.verifyToken).not.toHaveBeenCalled(); expect(context.appCheck.observe).not.toHaveBeenCalled();
  });

  it('emits fixed labels only, excluding private path IDs and query arguments', async () => {
    const context = fixture();
    await observeAppCheck(request(token, '/api/admin/scan-reports/private-report-123/image?secret=personal', 'GET'), context);
    await observeAppCheck(request(token, '/api/admin/scanner-reference-image/private-file.webp', 'GET'), context);
    expect(context.appCheck.observe.mock.calls.map(([event]) => event.route)).toEqual(['report_image', 'reference_image']);
    expect(JSON.stringify(context.appCheck.observe.mock.calls)).not.toMatch(/private-|personal|signature|android|http/);
  });

  it('treats an absent injected verifier as unavailable without calling any fallback network API', async () => {
    const context = fixture({ verifyToken: undefined });
    await observeAppCheck(request(), context);
    expect(context.appCheck.observe.mock.calls[0][0].reason).toBe('unavailable');
  });
});
