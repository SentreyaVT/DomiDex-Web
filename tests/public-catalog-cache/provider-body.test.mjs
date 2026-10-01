import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Proposed local per-response protection, not a TCGdex size guarantee or a
// process-wide concurrency/memory limit. These tests run the real sharing loader.
const MAX_CARD_BYTES = 1024 * 1024;
const CHUNK_BYTES = 32 * 1024;
const token = 'B'.repeat(43);
const sharePath = `privateBinderShares/${createHash('sha256').update(token).digest('hex')}`;
const originalFetch = globalThis.fetch;
const cleanups = [];
const card = { id: 'sv1-001', localId: '001', name: 'Public German card', set: { id: 'sv1', name: 'Public set' },
  image: 'https://assets.tcgdex.net/de/sv/sv1/001', variants_detailed: [{ type: 'Normal', size: 'Standard',
    pricing: { cardmarket: { idProduct: 42, trend: 2.5, unit: 'EUR', updated: '2026-10-01' } } }] };
let readBinderShare;

beforeEach(async () => {
  vi.resetModules();
  ({ readBinderShare } = await import('../../backend/security/sharing.mjs'));
  vi.useFakeTimers();
});
afterEach(async () => {
  // Release only this test's streams/promises, including deliberate hung cancel.
  const errors = [];
  for (const cleanup of cleanups.splice(0)) { try { cleanup(); } catch (error) { errors.push(error); } }
  for (let n = 0; n < 20; n++) await Promise.resolve();
  globalThis.fetch = originalFetch;
  vi.clearAllTimers();
  vi.useRealTimers();
  if (errors.length) throw new AggregateError(errors, 'Provider fixture cleanup/check failed');
});

function fixture({ id = card.id, prices = false } = {}) {
  const owner = 'owner-provider-body', binderPath = `users/${owner}/privateBinders/binder`;
  const setId = id.slice(0, id.lastIndexOf('-')), localId = id.split('-').at(-1);
  const documents = new Map([
    [sharePath, { ownerUid: owner, binderId: 'binder', revokedAt: null, showPrices: prices, showTotal: prices }],
    [binderPath, { ownerUid: owner, binderId: 'binder', name: 'Fixture', coverStyle: 'galaxy' }],
    [`users/${owner}/collectionEntries/entry`, { syncId: 'entry', ownerUid: owner, sourceCardId: id,
      sourceSetId: setId, setId, collectorNumber: localId, language: 'GERMAN', quantity: 1,
      finish: id === 'mep-094' ? 'Holo' : 'Normal', variant: id === 'mep-094' ? 'Holo' : 'Standard',
      externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: id === 'mep-094' ? 895609 : 42,
      notes: 'PRIVATE_BODY_FIXTURE_NOTE' }],
  ]);
  const placement = { ownerUid: owner, entrySyncId: 'entry', slotPosition: 0 };
  let logicalReads = 0, authReads = 0;
  const snapshot = (path) => ({ id: path.split('/').at(-1), exists: documents.has(path), data: () => documents.get(path) });
  const context = { sharingEnabled: true,
    auth: { getUser: async () => { authReads++; return { disabled: false, customClaims: { appAccess: true } }; } },
    db: { doc: (path) => ({ path, get: async () => { logicalReads++; return snapshot(path); } }),
      getAll: async (...refs) => { logicalReads += refs.length; return refs.map(({ path }) => snapshot(path)); },
      collection: () => ({ where: () => ({ select: (...fields) => ({ limit: () => ({ get: async () => ({ size: 1,
        docs: [{ id: 'placement', data: () => Object.fromEntries(fields.filter((key) => Object.hasOwn(placement, key))
          .map((key) => [key, placement[key]])) }],
      }) }) }) }) }),
    } };
  // Deliberately no context.cardFor: default catalogCard + public cache must run.
  return { documents, counts: () => ({ logicalReads, authReads }),
    read: () => readBinderShare(new Request(`https://synthetic.invalid/api/shared-binders/${token}`),
      { params: Promise.resolve({ token }) }, context) };
}

function provider(implementation, id = card.id) {
  const unexpected = [];
  const fetch = vi.fn(async (url, options) => {
    const value = String(url);
    const allowed = [`https://api.tcgdex.net/v2/de/cards/${id}`, `https://api.tcgdex.net/v2/en/cards/${id}`];
    if (!allowed.includes(value)) { unexpected.push(value); throw Error('UNEXPECTED_PROVIDER_BODY_FIXTURE'); }
    try {
      expect(options.headers).toEqual({ Accept: 'application/json' });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    } catch (error) { unexpected.push('unexpected provider headers/signal'); throw error; }
    return implementation(value.includes('/de/') ? 'de' : 'en', options.signal);
  });
  globalThis.fetch = fetch;
  cleanups.push(() => expect(unexpected, 'Caught unexpected provider work must not pass').toEqual([]));
  return fetch;
}

function encode(value) { return new TextEncoder().encode(JSON.stringify(value)); }
function paddedCard(bytes, source = card) {
  const empty = { ...source, providerPadding: '' };
  const padding = bytes - encode(empty).byteLength;
  if (padding < 0) throw Error('INVALID_BODY_FIXTURE_SIZE');
  const encoded = encode({ ...empty, providerPadding: 'x'.repeat(padding) });
  expect(encoded.byteLength).toBe(bytes);
  return encoded;
}

function streamResponse(bytes, { headers = {}, status = 200, hungCancel = false, stall = false } = {}) {
  let offset = 0, controller, releaseCancel;
  const cancellation = new Promise((resolve) => { releaseCancel = resolve; });
  const state = { pulls: 0, bytes: 0, cancel: vi.fn(() => hungCancel ? cancellation : undefined),
    finishLate: () => { try { if (bytes.length) controller.enqueue(bytes); controller.close(); } catch { /* Already cancelled. */ } } };
  const stream = new ReadableStream({
    start(value) { controller = value; },
    pull(value) {
      state.pulls++;
      if (stall) return;
      if (offset === bytes.length) { value.close(); return; }
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK_BYTES));
      offset += chunk.byteLength; state.bytes += chunk.byteLength; value.enqueue(chunk);
    },
    cancel: state.cancel,
  }, { highWaterMark: 0 }); // No speculative pull before the product actually reads.
  cleanups.push(() => { releaseCancel(); try { controller.close(); } catch { /* Already closed/cancelled. */ } });
  return { response: new Response(stream, { status, headers: { 'Content-Type': 'application/json', ...headers } }), state };
}

async function completedWithoutDeadline(promise) {
  let complete = false;
  promise.then(() => { complete = true; }, () => { complete = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(complete, 'Body rejection/cancellation must settle without waiting for the 12 s catalog deadline').toBe(true);
  return promise;
}
async function bodyOf(responsePromise) {
  const response = await completedWithoutDeadline(responsePromise);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  const body = await response.json();
  expect(JSON.stringify(body)).not.toMatch(/owner-provider-body|PRIVATE_BODY_FIXTURE_NOTE|providerPadding/);
  return body;
}
function unavailable(body) { expect(body.cards).toEqual([]); expect(body.unavailableSlots).toEqual([0]); }

describe('actual sharing provider response byte boundary (no real network)', () => {
  it.each([encode({ ...card, providerPadding: '' }).byteLength, MAX_CARD_BYTES])('keeps a valid %i-byte card, exact price and warm-cache semantics', async (size) => {
    const fetch = provider(() => streamResponse(paddedCard(size), { headers: { 'Content-Length': String(size) } }).response);
    const data = fixture({ prices: true });
    const cold = await bodyOf(data.read()), warm = await bodyOf(data.read());
    expect(cold.cards[0]).toMatchObject({ cardId: card.id, name: card.name,
      price: { amount: 2.5, currency: 'EUR', source: 'Cardmarket', asOf: '2026-10-01' } });
    expect(cold.total).toMatchObject({ amount: 2.5, complete: true, pricedCards: 1, visibleCards: 1 });
    expect(warm).toEqual(cold); expect(fetch).toHaveBeenCalledTimes(1);
    expect(data.counts()).toEqual({ logicalReads: 18, authReads: 4 });
  });

  it('rejects oversized Content-Length before pulling, even when cancel never resolves', async () => {
    const streamed = streamResponse(encode(card), { headers: { 'Content-Length': String(MAX_CARD_BYTES + 1) }, hungCancel: true });
    provider(() => streamed.response);
    unavailable(await bodyOf(fixture().read()));
    expect(streamed.state.pulls).toBe(0); expect(streamed.state.cancel).toHaveBeenCalledOnce();
  });

  it.each([{}, { 'Content-Length': '12' }])('counts chunked actual bytes, cancels early and never caches overflow (%j)', async (headers) => {
    const streams = [];
    const fetch = provider(() => {
      const streamed = streamResponse(paddedCard(MAX_CARD_BYTES + CHUNK_BYTES * 4), { headers });
      streams.push(streamed); return streamed.response;
    });
    const data = fixture();
    unavailable(await bodyOf(data.read())); unavailable(await bodyOf(data.read()));
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const { state } of streams) {
      expect(state.cancel).toHaveBeenCalledOnce();
      expect(state.bytes).toBeGreaterThan(MAX_CARD_BYTES);
      expect(state.bytes).toBeLessThanOrEqual(MAX_CARD_BYTES + CHUNK_BYTES);
    }
  });

  it('does not wait for an unresponsive cancel after detecting chunked overflow', async () => {
    const streamed = streamResponse(paddedCard(MAX_CARD_BYTES + CHUNK_BYTES * 2), { hungCancel: true });
    provider(() => streamed.response);
    unavailable(await bodyOf(fixture().read()));
    expect(streamed.state.cancel).toHaveBeenCalledOnce();
  });

  it('limits UTF-8 bytes rather than JavaScript character count', async () => {
    const text = JSON.stringify({ ...card, providerPadding: 'é'.repeat(MAX_CARD_BYTES / 2) });
    const bytes = new TextEncoder().encode(text);
    expect(text.length).toBeLessThan(MAX_CARD_BYTES); expect(bytes.byteLength).toBeGreaterThan(MAX_CARD_BYTES);
    const streamed = streamResponse(bytes);
    provider(() => streamed.response);
    unavailable(await bodyOf(fixture().read())); expect(streamed.state.cancel).toHaveBeenCalledOnce();
  });

  it.each(['oversize', 'non-ok'])('retains the reviewed DE supplement and cancels an unused %s body', async (failure) => {
    const source = { ...card, id: 'mep-094', localId: '094', name: 'Untrusted upstream replacement', set: { id: 'mep', name: 'Promos' } };
    const streamed = streamResponse(encode(source), { hungCancel: true,
      ...(failure === 'oversize' ? { headers: { 'Content-Length': String(MAX_CARD_BYTES + 1) } } : { status: 503 }) });
    const fetch = provider(() => streamed.response, 'mep-094');
    const body = await bodyOf(fixture({ id: 'mep-094' }).read());
    expect(body.cards[0]).toMatchObject({ cardId: 'mep-094', name: 'Alola-Kokowei', image: null });
    expect(body.cards[0]).not.toHaveProperty('price'); expect(body.unavailableSlots).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1); // Raw mode must not download the price guide.
    expect(streamed.state.pulls).toBe(0); expect(streamed.state.cancel).toHaveBeenCalledOnce();
  });

  it.each([true, false])('bounded EN response remains exact-identity image-only fallback (matching=%s)', async (matching) => {
    const german = { ...card, image: undefined };
    const english = { ...card, set: { id: matching ? card.set.id : 'foreign-set', name: 'Do not borrow EN set' },
      name: 'Do not borrow EN name', image: 'https://assets.tcgdex.net/en/sv/sv1/001',
      variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: { idProduct: 42, trend: 999, unit: 'EUR' } } }] };
    const fetch = provider((language) => streamResponse(encode(language === 'de' ? german : english)).response);
    const body = await bodyOf(fixture({ prices: true }).read());
    expect(body.cards[0]).toMatchObject({ name: card.name, setName: card.set.name, price: { amount: 2.5 },
      image: matching ? 'https://assets.tcgdex.net/en/sv/sv1/001/high.webp' : null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['oversize', 'non-ok'])('EN %s body is cancelled without losing the valid DE card or price', async (failure) => {
    const english = streamResponse(encode({ ...card, image: 'https://assets.tcgdex.net/en/sv/sv1/001' }), { hungCancel: true,
      ...(failure === 'oversize' ? { headers: { 'Content-Length': String(MAX_CARD_BYTES + 1) } } : { status: 503 }) });
    const fetch = provider((language) => language === 'de' ? Response.json({ ...card, image: undefined }) : english.response);
    const body = await bodyOf(fixture({ prices: true }).read());
    expect(body.cards[0]).toMatchObject({ name: card.name, image: null, price: { amount: 2.5 } });
    expect(body.unavailableSlots).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2);
    expect(english.state.pulls).toBe(0); expect(english.state.cancel).toHaveBeenCalledOnce();
  });

  it('cancels a stalled body at the existing provider deadline and rejects late cache warming', async () => {
    const stalled = streamResponse(encode({ ...card, name: 'Late old body' }), { stall: true, hungCancel: true });
    let oldSignal;
    const fetch = provider((_language, signal) => {
      oldSignal ??= signal;
      return fetch.mock.calls.length === 1 ? stalled.response : Response.json(card);
    });
    const data = fixture(), pending = data.read();
    await vi.advanceTimersByTimeAsync(0); expect(oldSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(12_000);
    unavailable(await bodyOf(pending));
    expect(oldSignal.aborted).toBe(true); expect(stalled.state.cancel).toHaveBeenCalledOnce();
    stalled.state.finishLate(); await vi.advanceTimersByTimeAsync(0);
    expect((await bodyOf(data.read())).cards[0].name).toBe(card.name);
    expect((await bodyOf(data.read())).cards[0].name).toBe(card.name);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
