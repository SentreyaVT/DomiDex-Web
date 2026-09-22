export async function isCurrentEvidence(transaction, after, deletionLock) {
  const [current, lock] = await Promise.all([transaction.get(after.ref), transaction.get(deletionLock)]);
  return !lock.exists && current.exists && current.updateTime.isEqual(after.updateTime);
}
