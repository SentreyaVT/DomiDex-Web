import { describe, expect, it, vi } from 'vitest';
import { deterministicCardmarketSyncId, deterministicSourceSyncId } from '@/lib/sync-id';
import { collectionSyncIdForExactCard } from '@/lib/collection';
import { variantForCollectionEntry, type CollectionEntry, type TcgCardDetail, type TcgVariant } from '@/lib/domain';

// Only prevent default Firebase initialization. The actual collection identity function,
// descriptor resolution and UUID implementation remain under test; no RPC is exercised.
vi.mock('@/lib/firebase-client', () => ({ firestore: {} }));

describe('Android-compatible deterministic collection sync ids', () => {
  it('matches Android UUID.nameUUIDFromBytes for a source identity', () => {
    expect(deterministicSourceSyncId(
      'user',
      'sv08',
      'sv08-001',
      'Near Mint',
      'Normal',
      'Standard',
    )).toBe('c8830d2d-151e-33b0-9085-532cd04c3814');
  });

  it('matches Android UUID.nameUUIDFromBytes for a Cardmarket identity', () => {
    expect(deterministicCardmarketSyncId(
      'user',
      794256,
      'Near Mint',
      'Normal',
      'Standard',
    )).toBe('a2aa1129-20f2-30d9-80a6-487fd4e2bcef');
  });

  it('normalizes whitespace and case but keeps condition in the identity', () => {
    expect(deterministicSourceSyncId(' USER ', 'SV08', 'SV08-001', ' NEAR MINT ', 'NORMAL', 'STANDARD'))
      .toBe('c8830d2d-151e-33b0-9085-532cd04c3814');
    expect(deterministicSourceSyncId('user', 'sv08', 'sv08-001', 'Played', 'Normal', 'Standard'))
      .not.toBe('c8830d2d-151e-33b0-9085-532cd04c3814');
  });
});

describe('collection add identity with reused source printing ids', () => {
  const ownerUid = 'printing-owner';
  const existingSyncId = 'f14c4503-678c-4f31-b0ca-a58b8f43f3ba';
  const ordinary: TcgVariant = {
    variantId: 'generated', type: 'Holo', size: 'Standard',
    thirdParty: { cardmarket: 900_001 },
  };
  const alternatives: { label: string; selected: TcgVariant }[] = [
    { label: 'stamp', selected: { ...ordinary, size: 'Standard · Stempel: Event', stamp: ['Event'] } },
    { label: 'foil', selected: { ...ordinary, size: 'Standard · Folie: Cosmos', foil: 'Cosmos' } },
    { label: 'descriptor', selected: { ...ordinary, size: 'Jumbo' } },
  ];

  function card(printings: TcgVariant[]): TcgCardDetail {
    return {
      id: 'identity-proof-001', localId: '001', name: 'Synthetic source card',
      set: { id: 'identity-proof', name: 'Synthetic source set' },
      variants_detailed: printings,
    };
  }

  function entry(variant = 'Standard'): CollectionEntry {
    return {
      syncId: existingSyncId, ownerUid, revision: 1, lastMutationId: 'existing-mutation',
      updatedAtClient: 1_000, deleted: false, deletedAtClient: null,
      name: 'Synthetic source card', setId: 'identity-proof', setName: 'Synthetic source set',
      collectorNumber: '001', language: 'GERMAN', finish: 'Holo', variant, rarity: 'UNKNOWN',
      quantity: 2, condition: 'Near Mint', notes: '', acquisitionPriceMinor: null,
      acquisitionCurrency: null, acquisitionDateEpochDay: null,
      externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD', externalProductId: 900_001,
      imageUrl: null, effectOverride: null, binderId: 'tcgdex-identity-proof',
      sourceSetId: 'identity-proof', sourceCardId: 'identity-proof-001',
      binderSetKey: 'tcgdex-identity-proof', binderName: 'Synthetic source set', binderHeroAsset: null,
    };
  }

  it('keeps the existing entry for the identical ordinary or special printing', () => {
    for (const selected of [ordinary, ...alternatives.map((item) => item.selected)]) {
      const detail = card(selected === ordinary ? [ordinary] : [ordinary, selected]);
      const persisted = entry(selected.size);
      const before = structuredClone(persisted);
      expect(variantForCollectionEntry(detail, persisted)).toBe(selected);
      expect(collectionSyncIdForExactCard(ownerUid, detail, selected, [persisted])).toBe(existingSyncId);
      expect(persisted).toEqual(before);
    }
  });

  it.each(alternatives)('does not merge a different $label solely because its source printing id matches', ({ selected }) => {
    // Both printings deliberately share one valid product. Their physical descriptor,
    // not a different market product or a failed lookup, must prevent the wrong merge.
    const detail = card([ordinary, selected]);
    const persisted = entry();
    const before = structuredClone(persisted);
    expect(variantForCollectionEntry(detail, persisted)).toBe(ordinary);
    const expected = deterministicSourceSyncId(ownerUid, detail.set.id, detail.id, 'Near Mint', 'Holo', selected.size!);
    expect(expected).not.toBe(existingSyncId);
    expect(collectionSyncIdForExactCard(ownerUid, detail, selected, [persisted])).toBe(expected);
    expect(persisted).toEqual(before);
  });

  it('does not merge a differently stamped product through the shared source printing id', () => {
    const selected: TcgVariant = {
      ...ordinary, size: 'Standard · Stempel: Event', stamp: ['Event'],
      thirdParty: { cardmarket: 900_002 },
    };
    const detail = card([ordinary, selected]);
    const persisted = entry();
    const before = structuredClone(persisted);
    expect(variantForCollectionEntry(detail, persisted)).toBe(ordinary);
    const expected = deterministicSourceSyncId(ownerUid, detail.set.id, detail.id, 'Near Mint', 'Holo', selected.size!);
    expect(expected).not.toBe(existingSyncId);
    expect(collectionSyncIdForExactCard(ownerUid, detail, selected, [persisted])).toBe(expected);
    expect(persisted).toEqual(before);
  });
});
