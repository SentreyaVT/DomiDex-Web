import { describe, it, expect, vi } from 'vitest';
import { readReviewedKnowledge } from '../backend/security/reviewed-knowledge.mjs';

const fingerprint = 'a'.repeat(64);
const key = { fingerprint, knowledgeVersion: 1, scannerVersion: 'scanner-v2.1' };
const reference = { schemaVersion: 1, sourceSetId: 'sv3', sourceCardId: 'sv3-137', cardNumber: '137', variant: 'normal' };
const report = () => ({ knowledgeContext: { schemaVersion: 1, ...key }, recognitionReference: reference,
  reviewStatus: 'RESOLVED', referenceCardId: 'sv3-137', referenceCardKey: 'sv3-137', referenceVariant: 'normal',
  reviewedAt: '2026-09-24T15:00:00Z', reviewedBy: 'reviewer', ownerUid: 'capture-owner',
  captureImagePath: 'private.jpg', reviewNote: 'private note', ocrTokens: ['private'], email: 'private' });
const request = (body = key, token = 'test-only') => new Request('https://domidex.web.app/api/scanner/reviewed-knowledge', {
  method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

function fixture(reports = [report()], claims = { pretester: true }) {
  const locks = new Set(), documents = new Map();
  const query = { where: vi.fn(() => query), limit: vi.fn(() => query), get: vi.fn(async () => ({ docs: reports.map(value => ({ data: () => value })) })) };
  const context = {
    auth: { verifyIdToken: vi.fn(async () => ({ uid: 'tester', ...claims })), getUser: vi.fn(async () => ({ customClaims: claims })) },
    db: { collection: vi.fn(() => query), doc: vi.fn(path => ({ get: async () => ({ exists: locks.has(path) || documents.has(path), data: () => documents.get(path) }) })) },
  };
  return { context, query, locks, documents };
}

describe('private report-backed scanner confirmation bridge', () => {
  it('returns only exact canonical card identity; no report or personal data', async () => {
    const { context, query } = fixture(); const response = await readReviewedKnowledge(request(), context);
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: true, hint: { ...key, sourceSetId: 'sv3', sourceCardId: 'sv3-137', cardNumber: '137', variant: 'normal' } });
    expect(query.where).toHaveBeenCalledWith('knowledgeContext.fingerprint', '==', fingerprint);
    expect(query.limit).toHaveBeenCalledWith(51);
    expect(context.auth.verifyIdToken).toHaveBeenCalledWith('test-only', true);
  });
  it.each(['NEW', 'IN_REVIEW', 'REJECTED', 'PUBLISHED'])('withdraws the hint for state %s', async state => {
    const value = report(); value.reviewStatus = state;
    expect(await (await readReviewedKnowledge(request(), fixture([value]).context)).json()).toEqual({ ok: true, hint: null });
  });
  it.each(['knowledgeContext', 'recognitionReference', 'referenceCardKey', 'reviewedAt', 'reviewedBy', 'ownerUid'])('ignores unverified metadata missing %s', async field => {
    const value = report(); delete value[field];
    expect(await (await readReviewedKnowledge(request(), fixture([value]).context)).json()).toEqual({ ok: true, hint: null });
  });
  it('returns no hint after report deletion, conflicting decisions or mismatched fingerprint', async () => {
    for (const values of [[], [report(), { ...report(), referenceCardId: 'sv3-138', recognitionReference: { ...reference, sourceCardId: 'sv3-138', cardNumber: '138' } }],
      [{ ...report(), knowledgeContext: { schemaVersion: 1, ...key, fingerprint: 'b'.repeat(64) } }]]) {
      expect(await (await readReviewedKnowledge(request(), fixture(values).context)).json()).toEqual({ ok: true, hint: null });
    }
  });
  it('deduplicates matching confirmations without inventing votes or STABLE confidence', async () => {
    const body = await (await readReviewedKnowledge(request(), fixture([report(), report()]).context)).json();
    expect(body.hint.sourceCardId).toBe('sv3-137'); expect(body.hint).not.toHaveProperty('confirmations'); expect(body.hint).not.toHaveProperty('confidence');
  });
  it('fails closed at query limit instead of selecting from partial results', async () => {
    expect(await (await readReviewedKnowledge(request(), fixture(Array.from({ length: 51 }, report)).context)).json()).toEqual({ ok: true, hint: null });
  });
  it('withdraws hints when capture-owner deletion is in progress', async () => {
    const { context, locks } = fixture(); locks.add('accountDeletionLocks/capture-owner');
    expect(await (await readReviewedKnowledge(request(), context)).json()).toEqual({ ok: true, hint: null });
  });
  it.each([{}, { appAccess: true }, { scannerLabAccess: true }])('does not grant Android tester access from %j', async claims => {
    const { context, query } = fixture(undefined, claims);
    expect((await readReviewedKnowledge(request(), context)).status).toBe(403); expect(query.get).not.toHaveBeenCalled();
  });
  it('denies guests and revoked tester access before querying reports', async () => {
    const { context, documents, query } = fixture();
    expect((await readReviewedKnowledge(request(key, ''), context)).status).toBe(401);
    documents.set('accountAccess/tester', { pretester: false });
    expect((await readReviewedKnowledge(request(), context)).status).toBe(403); expect(query.get).not.toHaveBeenCalled();
  });
  it.each([{}, { ...key, knowledgeVersion: 2 }, { ...key, scannerVersion: 'x' }, { ...key, fingerprint: '../secret' }])('rejects invalid key %j', async input => {
    const { context, query } = fixture(); expect((await readReviewedKnowledge(request(input), context)).status).toBe(400); expect(query.get).not.toHaveBeenCalled();
  });
  it('bounds request size and does not turn service failures into a success', async () => {
    const { context, query } = fixture();
    expect((await readReviewedKnowledge(request({ ...key, oversized: 'x'.repeat(1024) }), context)).status).toBe(413);
    query.get.mockRejectedValue(new Error('private failure detail'));
    const response = await readReviewedKnowledge(request(), context); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: 'SERVER_OPERATION_FAILED' });
  });
});
