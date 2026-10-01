import { createHash } from 'node:crypto';

export const writePolicies = Object.freeze({
  reportUpload: Object.freeze({ limit: 5, windowMs: 10 * 60_000 }),
  shareCreate: Object.freeze({ limit: 20, windowMs: 60 * 60_000 }),
  roleGrant: Object.freeze({ limit: 30, windowMs: 60_000 }),
});
const modes = new Set(['off', 'monitor', 'enforce']);
const retentionMs = 24 * 60 * 60_000;
const unavailable = () => Object.assign(new Error('RATE_LIMIT_UNAVAILABLE'), { status: 503 });
class AccountDeleting extends Error {
  constructor() { super('ACCOUNT_DELETING'); this.status = 403; }
}

export function rateLimitMode(value = process.env.DOMIDEX_WRITE_RATE_LIMIT_MODE ?? 'monitor') {
  if (!modes.has(value)) throw unavailable();
  return value;
}

export function rateLimitDocumentId(policy, uid) {
  if (!Object.hasOwn(writePolicies, policy) || typeof uid !== 'string' || !uid || uid.length > 128) throw unavailable();
  return `${policy}_${createHash('sha256').update(`${policy}\0${uid}`).digest('hex')}`;
}

// One bounded document per UID/policy, not per request or per process. TTL is
// housekeeping only; expired windows are handled atomically without TTL deletion.
export function createWriteRateLimiter(db, { mode = rateLimitMode(), observe = defaultObserve } = {}) {
  rateLimitMode(mode);
  for (const { limit, windowMs } of Object.values(writePolicies)) {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1000) throw unavailable();
  }
  return async (policy, uid) => {
    const id = rateLimitDocumentId(policy, uid);
    if (mode === 'off') return;
    const { limit, windowMs } = writePolicies[policy];
    let result;
    try {
      result = await db.runTransaction(async transaction => {
        const reference = db.doc(`privateWriteRateLimits/${id}`);
        const [snapshot, deletionLock] = await Promise.all([
          transaction.get(reference), transaction.get(db.doc(`accountDeletionLocks/${uid}`)),
        ]);
        // The read participates in the same transaction: deletion fencing wins
        // retries, so an in-flight quota writer cannot recreate erased counters.
        if (deletionLock.exists) throw new AccountDeleting();
        // Firestore's read timestamp is authoritative, including for absent docs.
        // No client-supplied timestamp and no process-local counter/clock fallback.
        const now = Math.floor(snapshot.readTime?.toMillis());
        if (!Number.isSafeInteger(now) || now <= 0) throw unavailable();
        const stored = snapshot.exists ? snapshot.data() : null;
        if (stored && (stored.schemaVersion !== 1 || stored.policy !== policy
          || !Number.isSafeInteger(stored.windowStartedAt) || stored.windowStartedAt <= 0
          || stored.windowStartedAt > now || !Number.isSafeInteger(stored.count)
          || stored.count < 1 || stored.count > limit)) throw unavailable();
        const expired = !stored || now >= stored.windowStartedAt + windowMs;
        const startedAt = expired ? now : stored.windowStartedAt;
        const count = expired ? 0 : stored.count;
        if (count >= limit) return { exceeded: true, retryAfterSeconds: Math.max(1, Math.ceil((startedAt + windowMs - now) / 1000)) };
        transaction.set(reference, {
          schemaVersion: 1, policy, windowStartedAt: startedAt, count: count + 1,
          expiresAt: new Date(startedAt + windowMs + retentionMs),
        });
        return { exceeded: false };
      });
    } catch (error) {
      if (error instanceof AccountDeleting) throw error;
      // Never expose Firestore errors, paths, keys, UIDs or credentials.
      throw unavailable();
    }
    if (!result.exceeded) return;
    // Observe outside the transaction: SDK retries must not double-log metrics.
    // No UID/hash/request/token/IP labels. Telemetry must not alter authorization.
    try { observe({ event: 'WRITE_RATE_LIMIT_EXCEEDED', policy, mode }); } catch { /* best-effort telemetry */ }
    if (mode === 'enforce') throw Object.assign(new Error('RATE_LIMITED'), { status: 429, retryAfterSeconds: result.retryAfterSeconds });
  };
}

function defaultObserve(event) { console.info(JSON.stringify(event)); }

export async function consumeWriteQuota(context, policy, uid) {
  const consume = context.consumeWriteQuota ?? createWriteRateLimiter(context.db, { mode: rateLimitMode(context.rateLimitMode) });
  await consume(policy, uid);
}

export function rateLimitResponse(error) {
  if (error?.message === 'RATE_LIMIT_UNAVAILABLE') {
    return Response.json({ ok: false, error: 'SERVER_OPERATION_FAILED' }, { status: 503, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (error?.message !== 'RATE_LIMITED' || error.status !== 429
    || !Number.isSafeInteger(error.retryAfterSeconds) || error.retryAfterSeconds < 1 || error.retryAfterSeconds > 3600) return null;
  return Response.json({ ok: false, error: 'RATE_LIMITED', retryAfterSeconds: error.retryAfterSeconds }, {
    status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
