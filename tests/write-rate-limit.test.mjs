import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWriteRateLimiter, rateLimitDocumentId, rateLimitMode, rateLimitResponse, writePolicies } from '../backend/security/rate-limit.mjs';

function store({ retry = false } = {}) {
  const documents = new Map();
  let now = 1_800_000_000_000;
  let queue = Promise.resolve();
  const db = {
    doc: path => ({ path }),
    runTransaction: vi.fn(work => {
      const next = queue.then(async () => {
        const attempt = async commit => {
          const writes = new Map();
          const result = await work({
            get: async reference => ({ exists: documents.has(reference.path), data: () => documents.get(reference.path), readTime: { toMillis: () => now } }),
            set: (reference, value) => writes.set(reference.path, value),
          });
          if (commit) for (const [key, value] of writes) documents.set(key, value);
          return result;
        };
        if (retry) await attempt(false);
        return attempt(true);
      });
      queue = next.catch(() => {});
      return next;
    }),
  };
  return { db, documents, setTime: value => { now = value; }, now: () => now };
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('distributed UID write quota contract', () => {
  it('pins immutable server-side quotas and rejects invalid configuration', () => {
    expect(writePolicies).toEqual({ reportUpload: { limit: 5, windowMs: 600000 }, shareCreate: { limit: 20, windowMs: 3600000 }, roleGrant: { limit: 30, windowMs: 60000 } });
    expect(Object.isFrozen(writePolicies)).toBe(true);
    for (const value of Object.values(writePolicies)) expect(Object.isFrozen(value)).toBe(true);
    for (const mode of ['', 'MONITOR', null, true, 'enforce ', 'unknown']) expect(() => rateLimitMode(mode)).toThrow('RATE_LIMIT_UNAVAILABLE');
    vi.stubEnv('DOMIDEX_WRITE_RATE_LIMIT_MODE', '');
    expect(() => createWriteRateLimiter({})).toThrow('RATE_LIMIT_UNAVAILABLE');
    vi.stubEnv('DOMIDEX_WRITE_RATE_LIMIT_MODE', 'monitor');
    expect(rateLimitMode()).toBe('monitor');
  });

  it('off performs no budget database request', async () => {
    const { db, documents } = store();
    const consume = createWriteRateLimiter(db, { mode: 'off' });
    await consume('reportUpload', 'owner');
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(documents.size).toBe(0);
  });

  it('shares one atomic budget between independent instances under parallel requests', async () => {
    const { db, documents } = store();
    const first = createWriteRateLimiter(db, { mode: 'enforce', observe: vi.fn() });
    const second = createWriteRateLimiter(db, { mode: 'enforce', observe: vi.fn() });
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, index) => (index % 2 ? first : second)('reportUpload', 'owner')));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(20);
    expect([...documents.values()]).toMatchObject([{ count: 5 }]);
    expect(documents.size).toBe(1);
  });

  it('isolates identities and policies and hashes all user-controlled identity material', async () => {
    const { db, documents } = store();
    const consume = createWriteRateLimiter(db, { mode: 'enforce' });
    await consume('reportUpload', 'private@example.invalid');
    await consume('reportUpload', 'other');
    await consume('shareCreate', 'private@example.invalid');
    expect(documents.size).toBe(3);
    const encoded = JSON.stringify([...documents]);
    expect(encoded).not.toContain('private@example.invalid');
    expect(encoded).not.toContain('other');
    expect([...documents.keys()].every(key => /^privateWriteRateLimits\/(reportUpload|shareCreate)_[a-f0-9]{64}$/.test(key))).toBe(true);
    expect([...documents.values()][0].expiresAt).toEqual(new Date(1_800_000_000_000 + 600000 + 86400000));
  });

  it('rejects unknown policies, invalid UID and unavailable server time without fallback', async () => {
    for (const policy of ['__proto__', 'unknown', 'toString']) expect(() => rateLimitDocumentId(policy, 'owner')).toThrow();
    for (const uid of ['', null, 'x'.repeat(129)]) expect(() => rateLimitDocumentId('reportUpload', uid)).toThrow();
    const db = { doc: path => ({ path }), runTransaction: async work => work({ get: async () => ({ exists: false }), set: vi.fn() }) };
    await expect(createWriteRateLimiter(db, { mode: 'enforce' })('reportUpload', 'owner')).rejects.toMatchObject({ message: 'RATE_LIMIT_UNAVAILABLE', status: 503 });
  });

  it('allows the exact server-time boundary and does not extend an exhausted window', async () => {
    const data = store();
    const consume = createWriteRateLimiter(data.db, { mode: 'enforce', observe: vi.fn() });
    const start = data.now();
    for (let index = 0; index < 5; index++) await consume('reportUpload', 'owner');
    data.setTime(start + 599001);
    await expect(consume('reportUpload', 'owner')).rejects.toMatchObject({ retryAfterSeconds: 1 });
    data.setTime(start + 599999);
    await expect(consume('reportUpload', 'owner')).rejects.toMatchObject({ retryAfterSeconds: 1 });
    data.setTime(start + 600000);
    await consume('reportUpload', 'owner');
    expect([...data.documents.values()][0]).toMatchObject({ count: 1, windowStartedAt: start + 600000 });
  });

  it('fails closed on clock rollback and malformed persisted state', async () => {
    const data = store();
    const consume = createWriteRateLimiter(data.db, { mode: 'enforce' });
    await consume('reportUpload', 'owner');
    data.setTime(data.now() - 1);
    await expect(consume('reportUpload', 'owner')).rejects.toMatchObject({ status: 503 });
    data.setTime(data.now() + 1);
    const key = [...data.documents.keys()][0];
    data.documents.set(key, { ...data.documents.get(key), count: -1 });
    await expect(consume('reportUpload', 'owner')).rejects.toMatchObject({ status: 503 });
  });

  it('never writes a quota document after the account deletion fence', async () => {
    const { db, documents } = store();
    documents.set('accountDeletionLocks/owner', { jobId: 'delete-account' });
    const consume = createWriteRateLimiter(db, { mode: 'enforce' });
    await expect(consume('reportUpload', 'owner')).rejects.toMatchObject({ status: 403, message: 'ACCOUNT_DELETING' });
    expect([...documents.keys()]).toEqual(['accountDeletionLocks/owner']);
  });

  it('retries transactions without double counting or duplicate observation', async () => {
    const { db, documents } = store({ retry: true });
    const observe = vi.fn();
    const consume = createWriteRateLimiter(db, { mode: 'monitor', observe });
    for (let index = 0; index < 6; index++) await consume('reportUpload', 'owner');
    expect([...documents.values()][0].count).toBe(5);
    expect(observe).toHaveBeenCalledExactlyOnceWith({ event: 'WRITE_RATE_LIMIT_EXCEEDED', policy: 'reportUpload', mode: 'monitor' });
  });

  it('monitor permits quota excess but not budget infrastructure failure', async () => {
    const { db } = store();
    const observe = vi.fn();
    const consume = createWriteRateLimiter(db, { mode: 'monitor', observe });
    for (let index = 0; index < 8; index++) await consume('reportUpload', 'owner');
    expect(observe).toHaveBeenCalledTimes(3);
    db.runTransaction.mockRejectedValueOnce(new Error('SECRET_TOKEN_PRIVATE_UID'));
    const failure = await consume('reportUpload', 'owner').catch(error => error);
    expect(failure.message).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(failure.status).toBe(503);
    expect(JSON.stringify(failure)).not.toContain('SECRET');
    const response = rateLimitResponse(failure);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: 'SERVER_OPERATION_FAILED' });
  });

  it('does not log private identifiers and keeps enforcement if metrics fail', async () => {
    const { db } = store();
    const logger = vi.spyOn(console, 'info').mockImplementation(() => {});
    const consume = createWriteRateLimiter(db, { mode: 'enforce' });
    for (let index = 0; index < 5; index++) await consume('reportUpload', 'PRIVATE_OWNER');
    await expect(consume('reportUpload', 'PRIVATE_OWNER')).rejects.toMatchObject({ status: 429 });
    expect(logger).toHaveBeenCalledExactlyOnceWith('{"event":"WRITE_RATE_LIMIT_EXCEEDED","policy":"reportUpload","mode":"enforce"}');
    const brokenMetrics = createWriteRateLimiter(db, { mode: 'enforce', observe: () => { throw Error('METRIC_FAILURE'); } });
    await expect(brokenMetrics('reportUpload', 'PRIVATE_OWNER')).rejects.toMatchObject({ status: 429 });
  });

  it('provides bounded Retry-After with the existing error envelope and no private error data', async () => {
    const response = rateLimitResponse({ message: 'RATE_LIMITED', status: 429, retryAfterSeconds: 60, privateValue: 'SECRET' });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: false, error: 'RATE_LIMITED', retryAfterSeconds: 60 });
    for (const value of [0, -1, 3601, Infinity, '60']) expect(rateLimitResponse({ message: 'RATE_LIMITED', status: 429, retryAfterSeconds: value })).toBeNull();
  });
});
