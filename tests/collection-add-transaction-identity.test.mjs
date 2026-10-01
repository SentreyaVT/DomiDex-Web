// Actual add callback with a local transaction double; isolated release-local runner.
// These synthetic fixtures exercise the actual addExactCard transaction callback,
// not Firebase RPC/Rules, retries, persistence, or the Android writer.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addExactCard, collectionSyncIdForExactCard } from '@/lib/collection';
import { exactCardmarketProductId, variantForCollectionEntry } from '@/lib/domain';
import { deterministicSourceSyncId } from '@/lib/sync-id';

const sdk = vi.hoisted(() => ({
  firestore: {}, doc: vi.fn(), collection: vi.fn(), onSnapshot: vi.fn(),
  runTransaction: vi.fn(), serverTimestamp: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: sdk.doc, collection: sdk.collection, onSnapshot: sdk.onSnapshot,
  runTransaction: sdk.runTransaction, serverTimestamp: sdk.serverTimestamp,
}));
vi.mock('@/lib/firebase-client', () => ({ firestore: sdk.firestore }));

const uid = 'transaction-printing-owner';
const user = { uid };
const marker = { testOnlyServerTimestamp: true };
const productOne = {
  type: 'Holo', size: 'Standard', variantId: 'product-one-source-id',
  thirdParty: { cardmarket: 900_001 },
  pricing: { cardmarket: { idProduct: 900_001, unit: 'EUR', trend: 4.56 } },
};
const productTwo = {
  ...productOne, variantId: 'generated', thirdParty: { cardmarket: 900_002 },
  pricing: { cardmarket: { idProduct: 900_002, unit: 'EUR', trend: 12.34 } },
};
const detail = {
  id: 'identity-proof-001', localId: '001', name: 'Synthetic source card',
  set: { id: 'identity-proof', name: 'Synthetic source set' },
  variants_detailed: [productOne, productTwo],
};
const deterministicId = deterministicSourceSyncId(
  uid, detail.set.id, detail.id, 'Near Mint', 'Holo', 'Standard',
);
const legacyId = '34a57b0d-41f2-4c0a-8c74-a189b25de012';
const path = (id) => `users/${uid}/collectionEntries/${id}`;

function entry(overrides = {}) {
  return {
    syncId: deterministicId, ownerUid: uid, revision: 7, lastMutationId: 'prior-mutation',
    updatedAtClient: 1_000, deleted: false, deletedAtClient: null,
    name: detail.name, setId: detail.set.id, setName: detail.set.name,
    collectorNumber: '001', language: 'GERMAN', finish: 'Holo', variant: 'Standard', rarity: 'UNKNOWN',
    quantity: 3, condition: 'Near Mint', notes: 'Preserve this note',
    acquisitionPriceMinor: 700, acquisitionCurrency: 'EUR', acquisitionDateEpochDay: 20_000,
    externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: 900_002,
    imageUrl: null, effectOverride: 'rainbow', binderId: 'private-binder',
    sourceSetId: detail.set.id, sourceCardId: detail.id,
    binderSetKey: 'private-binder', binderName: 'Private fixture binder', binderHeroAsset: null,
    ...overrides,
  };
}

let documents;
let transactions;
beforeEach(() => {
  vi.clearAllMocks();
  documents = new Map();
  transactions = [];
  sdk.doc.mockImplementation((database, ...segments) => {
    if (database !== sdk.firestore) throw new Error('Unexpected database in transaction fixture');
    return { path: segments.join('/') };
  });
  sdk.serverTimestamp.mockReturnValue(marker);
  sdk.runTransaction.mockImplementation(async (database, work) => {
    if (database !== sdk.firestore) throw new Error('Unexpected transaction database');
    // Stage writes until the actual callback succeeds. The double deliberately has
    // NO knowledge of products/printings: only the product callback may reject them.
    const writes = [];
    const transaction = {
      get: vi.fn(async (reference) => {
        const stored = documents.get(reference.path);
        return { exists: () => stored !== undefined, data: () => structuredClone(stored) };
      }),
      update: vi.fn((reference, data) => writes.push({ kind: 'update', path: reference.path, data: structuredClone(data) })),
      set: vi.fn((reference, data) => writes.push({ kind: 'set', path: reference.path, data: structuredClone(data) })),
    };
    transactions.push(transaction);
    const result = await work(transaction);
    for (const write of writes) {
      if (write.kind === 'update') {
        if (!documents.has(write.path)) throw new Error('Cannot update an absent fixture document');
        documents.set(write.path, { ...documents.get(write.path), ...write.data });
      } else documents.set(write.path, write.data);
    }
    return result;
  });
});

function seed(remote) { documents.set(path(remote.syncId), structuredClone(remote)); }
function snapshot() { return structuredClone([...documents]); }
function onlyTransaction(expectedId) {
  expect(sdk.runTransaction).toHaveBeenCalledTimes(1);
  expect(transactions).toHaveLength(1);
  const transaction = transactions[0];
  expect(sdk.doc).toHaveBeenCalledExactlyOnceWith(sdk.firestore, 'users', uid, 'collectionEntries', expectedId);
  expect(transaction.get).toHaveBeenCalledExactlyOnceWith({ path: path(expectedId) });
  return transaction;
}

async function expectIncrement(remote, current) {
  seed(remote);
  const inputsBefore = structuredClone({ detail, productTwo, current });
  await expect(addExactCard(user, detail, productTwo, 2, current)).resolves.toBe(12.34);
  const transaction = onlyTransaction(remote.syncId);
  expect(transaction.set).not.toHaveBeenCalled();
  expect(transaction.update).toHaveBeenCalledExactlyOnceWith({ path: path(remote.syncId) }, {
    quantity: 5, revision: 8,
    lastMutationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    updatedAt: marker, updatedAtClient: expect.any(Number),
  });
  const patch = transaction.update.mock.calls[0][1];
  expect([...documents]).toEqual([[path(remote.syncId), { ...remote, ...patch }]]);
  expect({ detail, productTwo, current }).toEqual(inputsBefore);
}

async function expectNoWriteOrFalseSuccess(remote, current, expectedId) {
  seed(remote);
  const storedBefore = snapshot();
  const inputsBefore = structuredClone({ detail, productTwo, current });
  const outcome = await addExactCard(user, detail, productTwo, 2, current).then(
    (value) => ({ status: 'fulfilled', value }),
    (error) => ({ status: 'rejected', error }),
  );
  const transaction = onlyTransaction(expectedId);
  expect(transaction.update, 'PRODUCT_CONFLICT_MUST_NOT_INCREMENT_EXISTING_ENTRY').not.toHaveBeenCalled();
  expect(transaction.set).not.toHaveBeenCalled();
  expect(snapshot()).toEqual(storedBefore);
  expect(outcome.status, 'PRODUCT_CONFLICT_MUST_NOT_REPORT_PRICE_OR_SUCCESS').toBe('rejected');
  expect(outcome.error).toBeInstanceOf(Error);
  expect({ detail, productTwo, current }).toEqual(inputsBefore);
}

describe('addExactCard revalidates the actual transaction document printing', () => {
  it('creates a missing exact printing with the existing deterministic key and full payload', async () => {
    const inputsBefore = structuredClone({ detail, productTwo });
    await expect(addExactCard(user, detail, productTwo, 2, [])).resolves.toBe(12.34);
    const transaction = onlyTransaction(deterministicId);
    expect(transaction.update).not.toHaveBeenCalled();
    expect(transaction.set).toHaveBeenCalledExactlyOnceWith({ path: path(deterministicId) }, {
      syncId: deterministicId, ownerUid: uid, revision: 1,
      lastMutationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      updatedAt: marker, updatedAtClient: expect.any(Number), deleted: false, deletedAtClient: null,
      name: detail.name, setId: detail.set.id, setName: detail.set.name, collectorNumber: '001',
      language: 'GERMAN', finish: 'Holo', variant: 'Standard', rarity: 'UNKNOWN', quantity: 2,
      condition: 'Near Mint', notes: '', acquisitionPriceMinor: null, acquisitionCurrency: null,
      acquisitionDateEpochDay: null, externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: 900_002,
      imageUrl: null, effectOverride: null, binderId: 'tcgdex-identity-proof',
      sourceSetId: detail.set.id, sourceCardId: detail.id, binderSetKey: 'tcgdex-identity-proof',
      binderName: detail.set.name, binderHeroAsset: null,
    });
    expect([...documents]).toEqual([[path(deterministicId), transaction.set.mock.calls[0][1]]]);
    expect({ detail, productTwo }).toEqual(inputsBefore);
  });

  it('increments an identical known printing without changing its other fields', async () => {
    const remote = entry();
    expect(variantForCollectionEntry(detail, remote)).toBe(productTwo);
    await expectIncrement(remote, [remote]);
  });

  it('increments an identical printing when the caller collection is still empty', async () => {
    await expectIncrement(entry(), []);
  });

  it('keeps a legacy raw-variant alias and canonical source suffix on its existing key', async () => {
    const remote = entry({ syncId: legacyId, variant: 'generated', sourceCardId: `${detail.id}-holofoil` });
    expect(variantForCollectionEntry(detail, remote)).toBe(productTwo);
    expect(collectionSyncIdForExactCard(uid, detail, productTwo, [remote])).toBe(legacyId);
    await expectIncrement(remote, [remote]);
  });

  it('retains the existing unknown-product merge policy for the same descriptor', async () => {
    // Both candidates have this descriptor. This control deliberately preserves
    // current nullable-product semantics rather than introducing a new identity policy.
    const remote = entry({ externalProductSource: null, externalProductId: null });
    await expectIncrement(remote, [remote]);
  });

  it.each(['known-current', 'empty-current'])('rejects a different known product at the same deterministic key with %s', async (mode) => {
    const remote = entry({ externalProductId: 900_001 });
    const current = mode === 'known-current' ? [remote] : [];
    expect(exactCardmarketProductId(detail, productOne)).toBe(900_001);
    expect(exactCardmarketProductId(detail, productTwo)).toBe(900_002);
    expect(variantForCollectionEntry(detail, remote)).toBe(productOne);
    // This collision is real despite the pre-transaction samePrinting guard:
    // both otherwise equal source identities hash to the same product-free UUID.
    expect(collectionSyncIdForExactCard(uid, detail, productOne, [])).toBe(deterministicId);
    expect(collectionSyncIdForExactCard(uid, detail, productTwo, current)).toBe(deterministicId);
    await expectNoWriteOrFalseSuccess(remote, current, deterministicId);
  });

  it('rejects a changed remote product even when a stale snapshot selected its legacy key', async () => {
    const current = [entry({ syncId: legacyId, variant: 'generated' })];
    const remote = entry({ syncId: legacyId, variant: 'generated', externalProductId: 900_001, revision: 8 });
    expect(collectionSyncIdForExactCard(uid, detail, productTwo, current)).toBe(legacyId);
    expect(variantForCollectionEntry(detail, current[0])).toBe(productTwo);
    expect(variantForCollectionEntry(detail, remote)).toBe(productOne);
    await expectNoWriteOrFalseSuccess(remote, current, legacyId);
  });
});
