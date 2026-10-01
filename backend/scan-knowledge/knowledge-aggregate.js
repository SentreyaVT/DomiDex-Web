const MAX_IDENTITIES_PER_PATTERN = 32;

function assertPersistableKey(key) {
  // The installed Firestore serializer drops this key even on null-prototype maps.
  // Fail before writes; never encode it under another identity or silently repair it.
  if (key === "__proto__") throw new Error("unsupported-knowledge-key");
}

function checkedCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid-knowledge-counter");
  return value;
}

function counterMap(value) {
  const result = Object.create(null);
  if (value == null) return result;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-knowledge-counter");
  // Own properties only: catalog IDs must not resolve to Object.prototype members.
  // Malformed historical counters are not silently repaired into invented votes.
  for (const [key, count] of Object.entries(value)) {
    assertPersistableKey(key);
    result[key] = checkedCount(count);
  }
  return result;
}

export function aggregateVote(summary = {}, previousVote, nextVote) {
  assertPersistableKey(nextVote.cardId);
  assertPersistableKey(previousVote?.cardId);
  const votes = counterMap(summary.votes);
  const correctionVotes = counterMap(summary.correctionVotes);
  const identities = Object.assign(Object.create(null), summary.identities);
  for (const key of Object.keys(identities)) assertPersistableKey(key);

  if (previousVote?.cardId) {
    votes[previousVote.cardId] = Math.max(0, (votes[previousVote.cardId] || 0) - 1);
    if (previousVote.corrected) correctionVotes[previousVote.cardId] = Math.max(0, (correctionVotes[previousVote.cardId] || 0) - 1);
  }
  if (!Object.hasOwn(votes, nextVote.cardId) && Object.keys(votes).length >= MAX_IDENTITIES_PER_PATTERN) {
    throw new Error("too-many-identities-for-fingerprint");
  }
  votes[nextVote.cardId] = checkedCount((votes[nextVote.cardId] || 0) + 1);
  if (nextVote.corrected) correctionVotes[nextVote.cardId] = checkedCount((correctionVotes[nextVote.cardId] || 0) + 1);
  identities[nextVote.cardId] = {
    sourceSetId: nextVote.sourceSetId || null,
    cardNumber: nextVote.cardNumber || "",
    setCode: nextVote.setCode || null,
  };

  const ranked = Object.entries(votes).filter(([, count]) => count > 0)
    .sort(([leftId, left], [rightId, right]) => right - left || leftId.localeCompare(rightId));
  const [cardId, confirmations] = ranked[0] || [nextVote.cardId, 1];
  const second = ranked[1]?.[1] || 0;
  const total = ranked.reduce((sum, [, count]) => checkedCount(sum + count), 0);
  const margin = confirmations - second;
  const status = confirmations >= 3 && margin >= 2
    ? "STABLE"
    : total >= 3 && second > 0 && margin <= 1 ? "DISPUTED" : "CANDIDATE";
  return {
    // Plain output maps retain the existing Firestore DTO and safe own properties.
    privateSummary: { votes: Object.fromEntries(Object.entries(votes)),
      correctionVotes: Object.fromEntries(Object.entries(correctionVotes)),
      identities: Object.fromEntries(Object.entries(identities)), total },
    publicKnowledge: {
      cardId,
      ...identities[cardId],
      status,
      confidence: Math.round(confirmations * 100 / Math.max(1, total)),
      confirmations,
      corrections: Math.max(0, total - confirmations),
      manualCorrections: correctionVotes[cardId] || 0,
    },
  };
}
