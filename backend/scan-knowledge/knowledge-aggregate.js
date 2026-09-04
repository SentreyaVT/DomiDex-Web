"use strict";

const MAX_IDENTITIES_PER_PATTERN = 32;

function aggregateVote(summary = {}, previousVote, nextVote) {
  const votes = { ...(summary.votes || {}) };
  const correctionVotes = { ...(summary.correctionVotes || {}) };
  const identities = { ...(summary.identities || {}) };

  if (previousVote?.cardId) {
    votes[previousVote.cardId] = Math.max(0, (votes[previousVote.cardId] || 0) - 1);
    if (previousVote.corrected) correctionVotes[previousVote.cardId] = Math.max(0, (correctionVotes[previousVote.cardId] || 0) - 1);
  }
  if (!Object.hasOwn(votes, nextVote.cardId) && Object.keys(votes).length >= MAX_IDENTITIES_PER_PATTERN) {
    throw new Error("too-many-identities-for-fingerprint");
  }
  votes[nextVote.cardId] = (votes[nextVote.cardId] || 0) + 1;
  if (nextVote.corrected) correctionVotes[nextVote.cardId] = (correctionVotes[nextVote.cardId] || 0) + 1;
  identities[nextVote.cardId] = {
    sourceSetId: nextVote.sourceSetId || null,
    cardNumber: nextVote.cardNumber || "",
    setCode: nextVote.setCode || null,
  };

  const ranked = Object.entries(votes).filter(([, count]) => count > 0)
    .sort(([leftId, left], [rightId, right]) => right - left || leftId.localeCompare(rightId));
  const [cardId, confirmations] = ranked[0] || [nextVote.cardId, 1];
  const second = ranked[1]?.[1] || 0;
  const total = ranked.reduce((sum, [, count]) => sum + count, 0);
  const margin = confirmations - second;
  const status = confirmations >= 3 && margin >= 2
    ? "STABLE"
    : total >= 3 && second > 0 && margin <= 1 ? "DISPUTED" : "CANDIDATE";
  return {
    privateSummary: { votes, correctionVotes, identities, total },
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

module.exports = { aggregateVote };
