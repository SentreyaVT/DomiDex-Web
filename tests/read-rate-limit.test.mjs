import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadRateLimiter, readPolicies, readRateLimitDocumentId } from '../backend/security/read-rate-limit.mjs';
import { rateLimitResponse, writePolicies } from '../backend/security/rate-limit.mjs';

// Deterministic shared transactional store, NOT a Firebase/SDK emulator test.
function store({ retry = false } = {}) {
  const documents = new Map(); let queue = Promise.resolve();
  let readTime = { seconds: 1_800_000_000, nanoseconds: 987_654_321 };
  const db = { doc: path => ({ path }), runTransaction: vi.fn(work => {
    const next = queue.then(async () => {
      const attempt = async commit => {
        const writes = new Map();
        const result = await work({
          get: async ref => ({ exists: documents.has(ref.path), data: () => documents.get(ref.path), readTime }),
          set: (ref, value) => writes.set(ref.path, value),
        });
        if (commit) for (const [key, value] of writes) documents.set(key, value);
        return result;
      };
      if (retry) await attempt(false);
      return attempt(true);
    });
    queue = next.catch(() => {}); return next;
  }) };
  return { db, documents, setTime: value => { readTime = value; } };
}
const policy = 'syncTimeAnchor';
const keyFor = uid => `privateReadRateLimits/${readRateLimitDocumentId(policy, uid)}`;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('distinct enforced read quota for private sync time anchors', () => {
  it('defines one immutable 60/minute read policy, without changing write policies', () => {
    expect(readPolicies).toEqual({ syncTimeAnchor: { limit: 60, windowMs: 60_000 } });
    expect(Object.isFrozen(readPolicies)).toBe(true); expect(Object.isFrozen(readPolicies.syncTimeAnchor)).toBe(true);
    expect(Object.keys(writePolicies)).toEqual(['reportUpload', 'shareCreate', 'roleGrant']);
  });

  it('shares exactly one atomic 60-request budget between independent factories', async () => {
    const data = store(); const observe = vi.fn();
    const factories = [createReadRateLimiter(data.db, { observe }), createReadRateLimiter(data.db, { observe })];
    const results = await Promise.allSettled(Array.from({ length: 75 }, (_, index) => factories[index % 2](policy, 'owner-a')));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(60);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(15);
    for (const result of results.filter(result => result.status === 'rejected')) expect(result.reason).toMatchObject({ status: 429, message: 'RATE_LIMITED', retryAfterSeconds: 60 });
    expect(data.documents.size).toBe(1); expect(data.documents.get(keyFor('owner-a')).count).toBe(60);
    expect(observe).toHaveBeenCalledTimes(15);
  });

  it.each(['off', 'monitor', 'enforce', 'invalid'])('never inherits the write-limit mode %s', async mode => {
    vi.stubEnv('DOMIDEX_WRITE_RATE_LIMIT_MODE', mode);
    const data = store(); const consume = createReadRateLimiter(data.db, { observe: vi.fn() });
    for (let index = 0; index < 60; index++) await consume(policy, 'owner');
    await expect(consume(policy, 'owner')).rejects.toMatchObject({ status: 429 });
  });

  it('uses server readTime, not Date.now, and does not extend the window on exhaustion', async () => {
    const data = store(); const consume = createReadRateLimiter(data.db, { observe: vi.fn() });
    vi.spyOn(Date, 'now').mockImplementation(() => { throw Error('NO_DEVICE_CLOCK'); });
    for (let index = 0; index < 60; index++) await consume(policy, 'owner');
    const original = data.documents.get(keyFor('owner'));
    expect(original).toMatchObject({ count: 60, windowStartedAt: 1_800_000_000_987 });
    expect(original.expiresAt).toEqual(new Date(1_800_000_000_987 + 60_000 + 86_400_000));
    data.setTime({ seconds: 1_800_000_060, nanoseconds: 986_999_999 });
    await expect(consume(policy, 'owner')).rejects.toMatchObject({ retryAfterSeconds: 1 });
    expect(data.documents.get(keyFor('owner'))).toBe(original);
    data.setTime({ seconds: 1_800_000_060, nanoseconds: 987_000_000 });
    await consume(policy, 'owner');
    expect(data.documents.get(keyFor('owner'))).toMatchObject({ count: 1, windowStartedAt: 1_800_000_060_987 });
  });

  it('uses bounded hashed per-policy+UID keys, separates owners, and stores no UID', async () => {
    const data = store(); const consume = createReadRateLimiter(data.db);
    for (const uid of ['owner-a', 'owner-b']) await consume(policy, uid);
    expect(data.documents.size).toBe(2);
    for (const key of data.documents.keys()) expect(key).toMatch(/^privateReadRateLimits\/syncTimeAnchor_[a-f0-9]{64}$/);
    const encoded = JSON.stringify([...data.documents]);
    expect(encoded).not.toContain('owner-a'); expect(encoded).not.toContain('owner-b');
  });

  it('rejects unknown policies and malformed identity before any transaction', async () => {
    const data = store(); const consume = createReadRateLimiter(data.db);
    for (const name of ['shareCreate', 'unknown', '__proto__', 'toString']) await expect(consume(name, 'owner')).rejects.toMatchObject({ status: 503 });
    for (const uid of ['', null, undefined, 123, 'a'.repeat(129)]) await expect(consume(policy, uid)).rejects.toMatchObject({ status: 503 });
    expect(data.db.runTransaction).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { seconds: 1, nanoseconds: 1e9 }, { seconds: '1', nanoseconds: 0 },
    { seconds: -1, nanoseconds: 0 }, { seconds: 1, nanoseconds: -1 }, { seconds: 1.1, nanoseconds: 0 },
    { seconds: 253402300800, nanoseconds: 0 }])('fails closed on missing/invalid authoritative transaction time %j', async readTime => {
    const data = store(); data.setTime(readTime);
    await expect(createReadRateLimiter(data.db)(policy, 'owner')).rejects.toMatchObject({ message: 'RATE_LIMIT_UNAVAILABLE', status: 503 });
    expect(data.documents.size).toBe(0);
  });

  it.each([{ count: 0 }, { count: 61 }, { count: 1.1 }, { schemaVersion: 2 }, { policy: 'shareCreate' },
    { windowStartedAt: 1_900_000_000_000 }, { windowStartedAt: '1800000000987' }])('fails closed on corrupt persisted metadata %j', async change => {
    const data = store(); const consume = createReadRateLimiter(data.db); await consume(policy, 'owner');
    data.documents.set(keyFor('owner'), { ...data.documents.get(keyFor('owner')), ...change });
    await expect(consume(policy, 'owner')).rejects.toMatchObject({ status: 503 });
  });

  it('keeps the lock read inside the same transaction and never recreates counters after deletion', async () => {
    const data = store(); data.documents.set('accountDeletionLocks/owner', { jobId: 'delete' });
    await expect(createReadRateLimiter(data.db)(policy, 'owner')).rejects.toMatchObject({ message: 'ACCOUNT_DELETING', status: 403 });
    expect([...data.documents.keys()]).toEqual(['accountDeletionLocks/owner']);
  });

  it('rechecks a newly appearing deletion lock on a transaction retry', async () => {
    const documents = new Map(); let attempt = 0;
    const db = { doc: path => ({ path }), runTransaction: async work => {
      const transaction = { get: async ref => ({ exists: ref.path.startsWith('accountDeletionLocks/') && attempt === 1,
        readTime: { seconds: 1_800_000_000, nanoseconds: 0 } }), set: vi.fn() };
      await work(transaction); attempt++;
      await work({ ...transaction, set: (ref, value) => documents.set(ref.path, value) });
    } };
    await expect(createReadRateLimiter(db)(policy, 'owner')).rejects.toMatchObject({ message: 'ACCOUNT_DELETING', status: 403 });
    expect(documents.size).toBe(0);
  });

  it('does not count aborted attempts twice, and telemetry failure cannot relax enforcement', async () => {
    const data = store({ retry: true }); const observe = vi.fn(() => { throw Error('TELEMETRY_FAILURE'); });
    const consume = createReadRateLimiter(data.db, { observe });
    for (let index = 0; index < 60; index++) await consume(policy, 'owner');
    await expect(consume(policy, 'owner')).rejects.toMatchObject({ status: 429 });
    expect(data.documents.get(keyFor('owner')).count).toBe(60);
    expect(observe).toHaveBeenCalledExactlyOnceWith({ event: 'READ_RATE_LIMIT_EXCEEDED', policy: 'syncTimeAnchor', mode: 'enforce' });
  });

  it('sanitizes infrastructure failures and does not expose owner/path/credential data', async () => {
    const data = store(); data.db.runTransaction.mockRejectedValueOnce(Error('PRIVATE_TOKEN owner-a firestore/path'));
    const error = await createReadRateLimiter(data.db)(policy, 'owner-a').catch(error => error);
    expect(error.message).toBe('RATE_LIMIT_UNAVAILABLE'); expect(error.status).toBe(503);
    const response = rateLimitResponse(error);
    expect(await response.json()).toEqual({ ok: false, error: 'SERVER_OPERATION_FAILED' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
