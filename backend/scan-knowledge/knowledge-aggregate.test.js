import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateVote } from './knowledge-aggregate.js';

const vote = (cardId, corrected = false) => ({ cardId, corrected, sourceSetId: "sv1", cardNumber: "001/198", setCode: "SV1" });

void test("one contributor cannot create stable knowledge", () => {
  const result = aggregateVote({}, null, vote("card-a"));
  assert.equal(result.publicKnowledge.status, "CANDIDATE");
  assert.equal(result.publicKnowledge.confirmations, 1);
});

void test("three independent matching votes become stable", () => {
  let summary = aggregateVote({}, null, vote("card-a")).privateSummary;
  summary = aggregateVote(summary, null, vote("card-a")).privateSummary;
  const result = aggregateVote(summary, null, vote("card-a"));
  assert.equal(result.publicKnowledge.status, "STABLE");
  assert.equal(result.publicKnowledge.confirmations, 3);
});

void test("conflicting votes stay disputed and changing one vote does not double count", () => {
  let summary = aggregateVote({}, null, vote("card-a")).privateSummary;
  summary = aggregateVote(summary, null, vote("card-b")).privateSummary;
  let result = aggregateVote(summary, null, vote("card-b", true));
  assert.equal(result.publicKnowledge.status, "DISPUTED");
  result = aggregateVote(result.privateSummary, vote("card-b", true), vote("card-a", true));
  assert.equal(result.privateSummary.total, 3);
  assert.equal(result.publicKnowledge.cardId, "card-a");
});
