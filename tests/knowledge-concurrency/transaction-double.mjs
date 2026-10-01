// Deterministic optimistic transaction simulation, NOT Firestore's server SDK,
// pessimistic locks, random backoff, billing, index reads or event-delivery system.
export const ref = path => ({ path, collection: name => ({ doc: id => ref(`${path}/${name}/${id}`) }) });
export const version = value => ({ value, isEqual: other => other?.value === value });
const copy = value => value === undefined ? undefined : structuredClone(value);

export function createTransactionDouble({ maxAttempts = 81, beforeCommit } = {}) {
  const rows = new Map();
  let sequence = 0;
  const stats = { transactions: 0, attempts: 0, logicalReads: 0, logicalQueries: 0,
    attemptedWrites: 0, committedWrites: 0, committedTransactions: 0,
    conflicts: 0, retries: 0, exhausted: 0, callbackFailures: 0, maxAttemptsUsed: 0 };
  const put = (path, data) => {
    rows.set(path, { data: copy(data), revision: ++sequence });
    return sequence;
  };
  const db = { doc: ref, async runTransaction(callback) {
    const transactionNumber = ++stats.transactions;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      stats.attempts++;
      stats.maxAttemptsUsed = Math.max(stats.maxAttemptsUsed, attempt);
      const reads = new Map();
      const writes = [];
      const tx = {
        async get(document) {
          if (writes.length) throw Error('SIMULATED_READ_AFTER_WRITE');
          stats.logicalReads++;
          const row = rows.get(document.path);
          const revision = row?.revision ?? 0;
          if (reads.has(document.path) && reads.get(document.path) !== revision) throw Error('SIMULATED_NONREPEATABLE_READ');
          reads.set(document.path, revision);
          const data = copy(row?.data);
          // Yield at real async API boundaries so concurrent callbacks overlap.
          await Promise.resolve();
          return { exists: data !== undefined, updateTime: version(revision), data: () => copy(data) };
        },
        set(document, data, options) {
          stats.attemptedWrites++;
          writes.push({ path: document.path, data: copy(data), merge: options?.merge === true });
        },
      };
      let result;
      try { result = await callback(tx); }
      catch (error) { stats.callbackFailures++; throw error; }
      if (beforeCommit) await beforeCommit({ attempt, transactionNumber, put, reads, writes });
      const conflict = [...reads].some(([path, revision]) => (rows.get(path)?.revision ?? 0) !== revision);
      if (conflict) {
        stats.conflicts++;
        if (attempt === maxAttempts) { stats.exhausted++; throw Error('SIMULATED_TRANSACTION_RETRY_EXHAUSTED'); }
        stats.retries++;
        continue;
      }
      // No await between validation and writes: atomic test-double commit.
      for (const write of writes) {
        const old = rows.get(write.path)?.data;
        put(write.path, write.merge ? { ...old, ...write.data } : write.data);
      }
      stats.committedWrites += writes.length;
      stats.committedTransactions++;
      return result;
    }
    throw Error('SIMULATED_UNREACHABLE');
  } };
  return { db, stats, put, read: path => copy(rows.get(path)?.data),
    count: prefix => [...rows].filter(([path, row]) => path.startsWith(prefix) && row.data !== undefined).length,
    snapshot: () => copy([...rows]),
  };
}
