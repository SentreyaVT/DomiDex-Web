import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregateVote } from '../../backend/scan-knowledge/knowledge-aggregate.js';

const vote = cardId => ({ cardId, corrected: true, sourceSetId: 'synthetic-set', cardNumber: '215', setCode: 'TEST' });
const roundTrip = value => JSON.parse(JSON.stringify(value));

describe('Knowledge own map keys — intended safe policy, test-first regression', () => {
  it.each(['constructor', 'toString', 'sv3-215'])(
    'counts %s as an own numeric key across JSON persistence, duplicate replacement and three contributors', cardId => {
      const first = aggregateVote({}, null, vote(cardId));
      expect(Object.hasOwn(first.privateSummary.votes, cardId)).toBe(true);
      expect(first.privateSummary.votes[cardId]).toBe(1);
      expect(first.privateSummary.correctionVotes[cardId]).toBe(1);
      expect(Object.hasOwn(first.privateSummary.identities, cardId)).toBe(true);
      expect(Object.getPrototypeOf(first.privateSummary.identities)).toBe(Object.prototype);
      const restored = roundTrip(first.privateSummary);
      const replaced = aggregateVote(restored, vote(cardId), vote(cardId));
      expect(replaced.privateSummary.total).toBe(1);
      const second = aggregateVote(roundTrip(replaced.privateSummary), null, vote(cardId));
      const third = aggregateVote(roundTrip(second.privateSummary), null, vote(cardId));
      expect(third.publicKnowledge).toMatchObject({ cardId, confirmations: 3, confidence: 100,
        manualCorrections: 3, status: 'STABLE' });
      expect(Object.hasOwn(Object.prototype, 'cardNumber')).toBe(false);
    },
  );

  it.each(['nextVote', 'previousVote', 'votes', 'correctionVotes', 'identities'])(
    'rejects SDK-unsupported __proto__ at %s before creating any replacement Knowledge', source => {
      const summary = source === 'votes' || source === 'correctionVotes'
        ? { [source]: Object.fromEntries([['__proto__', 1]]) }
        : source === 'identities' ? { identities: Object.fromEntries([['__proto__', { cardNumber: '1' }]]) } : {};
      expect(() => aggregateVote(summary, source === 'previousVote' ? vote('__proto__') : null,
        vote(source === 'nextVote' ? '__proto__' : 'sv3-215'))).toThrow('unsupported-knowledge-key');
    },
  );

  it('changing a previous inherited-name identity removes exactly one existing vote without mutating inputs', () => {
    const input = roundTrip({ votes: { constructor: 2, 'sv3-215': 1 },
      correctionVotes: { constructor: 2, 'sv3-215': 1 }, identities: {
        constructor: { sourceSetId: 'a', cardNumber: '1', setCode: 'A' },
        'sv3-215': { sourceSetId: 'b', cardNumber: '2', setCode: 'B' },
      }, total: 3 });
    const before = roundTrip(input);
    const result = aggregateVote(input, vote('constructor'), vote('sv3-215'));
    expect(result.privateSummary).toMatchObject({ votes: { constructor: 1, 'sv3-215': 2 }, total: 3 });
    expect(result.publicKnowledge).toMatchObject({ confirmations: 2, corrections: 1, status: 'DISPUTED' });
    expect(input).toEqual(before);
  });

  it.each(['broken', 'function Object() { [native code] }1', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed legacy vote counter %s before manufacturing a replacement count', invalid => {
      expect(() => aggregateVote({ votes: { constructor: invalid } }, null, vote('sv3-215')))
        .toThrow('invalid-knowledge-counter');
    },
  );

  it('rejects malformed correction counters even when the winning card would be different', () => {
    expect(() => aggregateVote({ votes: { 'sv3-215': 2 }, correctionVotes: { constructor: 'broken' } },
      null, vote('sv3-215'))).toThrow('invalid-knowledge-counter');
  });

  it('rejects counter increment beyond exact integer range', () => {
    expect(() => aggregateVote({ votes: { 'sv3-215': Number.MAX_SAFE_INTEGER } }, null, vote('sv3-215')))
      .toThrow('invalid-knowledge-counter');
  });

  it('rejects a total beyond exact integer range despite individually valid counters', () => {
    expect(() => aggregateVote({ votes: { 'synthetic-a': Number.MAX_SAFE_INTEGER, 'synthetic-b': 1 } },
      null, vote('synthetic-c'))).toThrow('invalid-knowledge-counter');
  });

  it('ignores inherited legacy counter properties instead of counting them as contributors', () => {
    const votes = Object.assign(Object.create({ 'synthetic-inherited': 99 }), { 'sv3-215': 1 });
    const result = aggregateVote({ votes }, null, vote('sv3-215'));
    expect(Object.keys(result.privateSummary.votes)).toEqual(['sv3-215']);
    expect(result.publicKnowledge).toMatchObject({ confirmations: 2, status: 'CANDIDATE' });
  });

  it('uses Firestore-compatible plain payloads for supported own keys; separately proves the installed SDK __proto__ limitation', () => {
    const backendRequire = createRequire(new URL('../../backend/scan-knowledge/index.js', import.meta.url));
    const entry = backendRequire.resolve('@google-cloud/firestore');
    const { Serializer } = backendRequire(path.join(path.dirname(entry), 'serializer.js'));
    // Pure codec only: never construct a Firestore client, credentials or connection.
    const serializer = new Serializer({ _settings: {}, doc: () => { throw Error('UNEXPECTED_REFERENCE'); } });
    for (const cardId of ['constructor', 'toString', 'sv3-215']) {
      const result = aggregateVote({}, null, vote(cardId));
      const encoded = serializer.encodeValue(result.privateSummary);
      expect(encoded.mapValue.fields.votes.mapValue.fields[cardId]).toEqual({ integerValue: 1 });
      expect(encoded.mapValue.fields.correctionVotes.mapValue.fields[cardId]).toEqual({ integerValue: 1 });
    }
    // Not a claim that __proto__ survives Firestore. Encoding it needs a separate contract decision.
    expect(serializer.encodeValue(Object.fromEntries([['__proto__', 1]]))).toBeNull();
  });
});
