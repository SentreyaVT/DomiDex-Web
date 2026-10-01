import { createHash } from 'node:crypto';

// Dedicated, always-enforced read budget. Existing write-policy modes are not
// consulted. This bounds successful anchors, not ingress or authentication cost.
export const readPolicies = Object.freeze({
  syncTimeAnchor: Object.freeze({ limit: 60, windowMs: 60_000 }),
});
const retentionMs = 24 * 60 * 60_000;
const unavailable = () => Object.assign(new Error('RATE_LIMIT_UNAVAILABLE'), { status: 503 });
class AccountDeleting extends Error {
  constructor() { super('ACCOUNT_DELETING'); this.status = 403; }
}

// Admin DocumentSnapshot.readTime, including snapshots of absent documents.
// Preserve the full Firestore precision; never accept a process/client clock,
// a coerced string, or a toDate/toMillis round-trip as the anchor contract.
export function serverReadTimeParts(readTime) {
  const seconds = readTime?.seconds;
  const nanoseconds = readTime?.nanoseconds;
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 253_402_300_799
    || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1_000_000_000) throw unavailable();
  return { seconds, nanoseconds };
}

export function readRateLimitDocumentId(policy, uid) {
  if (!Object.hasOwn(readPolicies, policy) || typeof uid !== 'string' || !uid || uid.length > 128) throw unavailable();
  return `${policy}_${createHash('sha256').update(`${policy}\0${uid}`).digest('hex')}`;
}

export function createReadRateLimiter(db, { observe = event => console.info(JSON.stringify(event)) } = {}) {
  return async (policy, uid) => {
    const id = readRateLimitDocumentId(policy, uid);
    const { limit, windowMs } = readPolicies[policy];
    let result;
    try {
      result = await db.runTransaction(async transaction => {
        const reference = db.doc(`privateReadRateLimits/${id}`);
        const [snapshot, deletionLock] = await Promise.all([
          transaction.get(reference), transaction.get(db.doc(`accountDeletionLocks/${uid}`)),
        ]);
        // Participates in transaction retries: deletion cannot race a recreated
        // technical counter. There are no collection/binder/content writes here.
        if (deletionLock.exists) throw new AccountDeleting();
        const time = serverReadTimeParts(snapshot.readTime);
        // Milliseconds are sufficient only for the quota window, not the anchor.
        const now = time.seconds * 1000 + Math.floor(time.nanoseconds / 1_000_000);
        const stored = snapshot.exists ? snapshot.data() : null;
        if (snapshot.exists && (!stored || stored.schemaVersion !== 1 || stored.policy !== policy
          || !Number.isSafeInteger(stored.windowStartedAt) || stored.windowStartedAt < 0
          || stored.windowStartedAt > now || !Number.isSafeInteger(stored.count)
          || stored.count < 1 || stored.count > limit)) throw unavailable();
        const expired = !stored || now >= stored.windowStartedAt + windowMs;
        const startedAt = expired ? now : stored.windowStartedAt;
        const count = expired ? 0 : stored.count;
        if (count >= limit) return { exceeded: true, retryAfterSeconds: Math.max(1, Math.ceil((startedAt + windowMs - now) / 1000)) };
        transaction.set(reference, {
          schemaVersion: 1, policy, windowStartedAt: startedAt, count: count + 1,
          // Retention metadata only. No TTL policy is created or assumed here;
          // expired quota windows reset correctly without background deletion.
          expiresAt: new Date(startedAt + windowMs + retentionMs),
        });
        return { exceeded: false };
      });
    } catch (error) {
      if (error instanceof AccountDeleting) throw error;
      throw unavailable();
    }
    if (!result.exceeded) return;
    // Outside retries, no UID, hash, token, URL, or other high-cardinality label.
    try { observe({ event: 'READ_RATE_LIMIT_EXCEEDED', policy, mode: 'enforce' }); } catch { /* best-effort telemetry */ }
    throw Object.assign(new Error('RATE_LIMITED'), { status: 429, retryAfterSeconds: result.retryAfterSeconds });
  };
}

export async function consumeReadQuota(context, policy, uid) {
  const consume = context.consumeReadQuota ?? createReadRateLimiter(context.db);
  await consume(policy, uid);
}
