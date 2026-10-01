import { afterEach, describe, expect, it, vi } from 'vitest';
import * as operations from '../backend/security/routes.mjs';
import { actorFor } from '../backend/security/firebase.mjs';

const stamp = () => ({ seconds: 1_800_000_000, nanoseconds: 987_654_321,
  toMillis: () => { throw Error('LOSSY_TIME_CONVERSION'); },
  toDate: () => { throw Error('LOSSY_TIME_CONVERSION'); } });
function fixture() {
  const decoded = { uid: 'owner-a', appAccess: true, auth_time: 1_799_999_000 };
  const user = { disabled: false, customClaims: { appAccess: true } };
  const access = {};
  const lock = { exists: false, readTime: stamp() };
  const reads = [];
  const context = {
    auth: { verifyIdToken: vi.fn(async () => decoded), getUser: vi.fn(async () => user) },
    db: { doc: path => ({ get: vi.fn(async () => {
      reads.push(path);
      if (path === 'accountAccess/owner-a') return { data: () => access };
      if (path === 'accountDeletionLocks/owner-a') return lock;
      throw Error('UNEXPECTED_DATABASE_READ');
    }) }) },
    appCheck: { mode: 'off' }, consumeReadQuota: vi.fn(async () => {}),
  };
  const request = (suffix = '', options = {}) => new Request(`https://local.invalid/api/private-sync/time-anchor${suffix}`,
    { headers: { authorization: 'Bearer private-test-token' }, ...options });
  return { decoded, user, access, lock, reads, context, request };
}
async function anchor(data, request = data.request()) {
  return operations.readPrivateSyncTimeAnchor(request, data.context);
}
afterEach(() => vi.restoreAllMocks());

describe('authoritative private sync anchor: new local contract, not deployed', () => {
  it('preserves exact server seconds/nanoseconds and authenticated owner without a new auth read', async () => {
    const data = fixture();
    const response = await anchor(data);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: 1, ownerUid: 'owner-a', seconds: 1_800_000_000, nanoseconds: 987_654_321 });
    expect(data.reads).toEqual(['accountAccess/owner-a', 'accountDeletionLocks/owner-a']);
    expect(data.context.auth.verifyIdToken).toHaveBeenCalledExactlyOnceWith('private-test-token', true);
    expect(data.context.auth.getUser).toHaveBeenCalledExactlyOnceWith('owner-a');
    expect(data.context.consumeReadQuota).toHaveBeenCalledExactlyOnceWith('syncTimeAnchor', 'owner-a');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('does not substitute the device/process clock for authoritative readTime', async () => {
    const data = fixture(); const request = data.request();
    vi.spyOn(Date, 'now').mockImplementation(() => { throw Error('DEVICE_CLOCK_FORBIDDEN'); });
    expect((await anchor(data, request)).status).toBe(200);
  });

  it.each([undefined, null, {}, { seconds: '1800000000', nanoseconds: 0 },
    { seconds: -1, nanoseconds: 0 }, { seconds: 1.5, nanoseconds: 0 },
    { seconds: 253402300800, nanoseconds: 0 }, { seconds: 1, nanoseconds: -1 },
    { seconds: 1, nanoseconds: 1e9 }, { seconds: 1, nanoseconds: 0.5 },
    { seconds: 1, nanoseconds: '0' }, { seconds: Infinity, nanoseconds: 0 },
  ])('fails closed for invalid or unavailable readTime %j', async readTime => {
    const data = fixture(); data.lock.readTime = readTime;
    const response = await anchor(data);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: 'SERVER_OPERATION_FAILED' });
    expect(data.context.consumeReadQuota).not.toHaveBeenCalled();
  });

  it('accepts exact nanosecond endpoints without rounding', async () => {
    for (const nanoseconds of [0, 999_999_999]) {
      const data = fixture(); data.lock.readTime = { seconds: 1_800_000_000, nanoseconds };
      expect(await (await anchor(data)).json()).toMatchObject({ nanoseconds });
    }
  });

  it('requires authentication before all database/quota work', async () => {
    const data = fixture();
    const response = await anchor(data, data.request('', { headers: {} }));
    expect(response.status).toBe(401); expect(data.reads).toEqual([]);
    expect(data.context.consumeReadQuota).not.toHaveBeenCalled();
  });

  it('rejects revoked credentials without exposing the token/provider error', async () => {
    const data = fixture(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    data.context.auth.verifyIdToken.mockRejectedValueOnce(Object.assign(Error('private-test-token SECRET'), { code: 'auth/id-token-revoked' }));
    const response = await anchor(data);
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ ok: false, error: 'AUTH_REQUIRED' });
    expect(data.reads).toEqual([]); expect(data.context.consumeReadQuota).not.toHaveBeenCalled();
  });

  it.each(['userDisabled', 'accessDisabled', 'tokenClaimMissing', 'liveClaimMissing', 'explicitRevoke'])('denies %s before quota', async kind => {
    const data = fixture();
    if (kind === 'userDisabled') data.user.disabled = true;
    if (kind === 'accessDisabled') data.access.disabled = true;
    if (kind === 'tokenClaimMissing') delete data.decoded.appAccess;
    if (kind === 'liveClaimMissing') delete data.user.customClaims.appAccess;
    if (kind === 'explicitRevoke') data.access.appAccess = false;
    const response = await anchor(data);
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, error: 'ACCESS_DENIED' });
    expect(data.context.consumeReadQuota).not.toHaveBeenCalled();
  });

  it('preserves existing admin-derived app access, not a new authorization policy', async () => {
    const data = fixture(); data.decoded.admin = true; data.user.customClaims.admin = true;
    delete data.decoded.appAccess; delete data.user.customClaims.appAccess;
    expect((await anchor(data)).status).toBe(200);
  });

  it('denies a deletion fence before issuing an anchor', async () => {
    const data = fixture(); data.lock.exists = true;
    const response = await anchor(data);
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, error: 'ACCOUNT_DELETING' });
    expect(data.context.consumeReadQuota).not.toHaveBeenCalled();
  });

  it.each(['?uid=owner-b', '?ownerUid=owner-b', '?seconds=9999999999'])('rejects client-selected anchor/owner inputs %s', async query => {
    const data = fixture(); expect((await anchor(data, data.request(query))).status).toBe(400);
    expect(data.reads).toEqual([]); expect(data.context.consumeReadQuota).not.toHaveBeenCalled();
  });

  it('does not support mutation methods or request bodies', async () => {
    const data = fixture();
    expect((await anchor(data, data.request('', { method: 'POST', body: '{}' }))).status).toBe(405);
    expect(data.reads).toEqual([]);
  });

  it('returns private noncacheable Retry-After, without an anchor when over quota', async () => {
    const data = fixture(); data.context.consumeReadQuota.mockRejectedValueOnce(Object.assign(Error('RATE_LIMITED'), { status: 429, retryAfterSeconds: 60 }));
    const response = await anchor(data);
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: false, error: 'RATE_LIMITED', retryAfterSeconds: 60 });
  });

  it.each(['RATE_LIMIT_UNAVAILABLE', 'SECRET_INFRA_DETAILS owner-a private-test-token'])('does not issue an anchor on infrastructure failure', async message => {
    const data = fixture(); data.context.consumeReadQuota.mockRejectedValueOnce(Error(message));
    const response = await anchor(data);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: 'SERVER_OPERATION_FAILED' });
  });

  it('retains the final in-transaction deletion denial from quota consumption', async () => {
    const data = fixture(); data.context.consumeReadQuota.mockRejectedValueOnce(Object.assign(Error('ACCOUNT_DELETING'), { status: 403 }));
    const response = await anchor(data); expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: 'ACCOUNT_DELETING' });
  });

  it('obtains a fresh authorization snapshot and quota for every call, without server response caching', async () => {
    const data = fixture();
    const first = await (await anchor(data)).json();
    data.lock.readTime = { seconds: 1_800_000_001, nanoseconds: 1 };
    const second = await (await anchor(data)).json();
    expect(first.seconds).toBe(1_800_000_000); expect(second).toMatchObject({ seconds: 1_800_000_001, nanoseconds: 1 });
    expect(data.context.auth.verifyIdToken).toHaveBeenCalledTimes(2);
    expect(data.context.consumeReadQuota).toHaveBeenCalledTimes(2);
    expect(data.reads).toHaveLength(4);
  });

  it('uses the real read limiter seam without custom quota injection, writing only one technical counter', async () => {
    const data = fixture(); delete data.context.consumeReadQuota;
    const originalDoc = data.context.db.doc; data.context.db.doc = path => ({ path, ...originalDoc(path) });
    const reads = []; const writes = [];
    data.context.db.runTransaction = async work => work({
      get: async reference => { reads.push(reference.path); return { exists: false, readTime: { seconds: 1_800_000_010, nanoseconds: 123 } }; },
      set: (reference, value) => writes.push({ path: reference.path, value }),
    });
    const response = await anchor(data);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ seconds: 1_800_000_000, nanoseconds: 987_654_321 });
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toMatch(/^privateReadRateLimits\/syncTimeAnchor_[a-f0-9]{64}$/);
    expect(writes[0].value).toMatchObject({ schemaVersion: 1, policy: 'syncTimeAnchor', count: 1, windowStartedAt: 1_800_000_010_000 });
    expect(reads).toEqual([writes[0].path, 'accountDeletionLocks/owner-a']);
    expect(data.reads).toEqual(['accountAccess/owner-a', 'accountDeletionLocks/owner-a']);
  });

  it('sanitizes failure to obtain the authorization snapshot', async () => {
    const data = fixture(); data.context.db.doc = () => ({ get: async () => { throw Error('PRIVATE_FIRESTORE_PATH_AND_CREDENTIAL'); } });
    const response = await anchor(data);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: 'SERVER_OPERATION_FAILED' });
    expect(data.context.consumeReadQuota).not.toHaveBeenCalled();
  });
});

describe('existing actorFor compatibility during anchor auth extraction', () => {
  it('retains exact actor shape and read count without examining readTime or quota', async () => {
    const data = fixture(); Object.defineProperty(data.lock, 'readTime', { get: () => { throw Error('OLD_ROUTES_MUST_NOT_READ_ANCHOR'); } });
    expect(await actorFor(data.request(), data.context, 'app')).toEqual({ uid: 'owner-a', admin: false,
      appAccess: true, pretester: false, scannerLabAccess: false, pretesterClaim: false, authTime: 1_799_999_000_000 });
    expect(data.reads).toEqual(['accountAccess/owner-a', 'accountDeletionLocks/owner-a']);
    expect(data.context.consumeReadQuota).not.toHaveBeenCalled();
  });

  it('preserves omitted-role self-service access and rejects unknown roles', async () => {
    const data = fixture(); delete data.decoded.appAccess; delete data.user.customClaims.appAccess;
    expect(await actorFor(data.request(), data.context)).toMatchObject({ uid: 'owner-a', appAccess: false });
    await expect(actorFor(data.request(), data.context, 'unknown')).rejects.toMatchObject({ message: 'ACCESS_DENIED', status: 403 });
    expect(data.reads).toHaveLength(2);
  });
});
