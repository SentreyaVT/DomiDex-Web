// Intended runner: isolated tests/release-local/config.mjs + existing network preload.
// Raw identity excerpts below were read, not fetched, from the verified 2026-09-25
// snapshot cards/base1-1.json and cards/sv03-062.json. Descriptors are independently
// transcribed from Android parseCardDetail's size/subtype/stamp/foil construction.
// Prices are fixture observations only; this proves neither current prices nor SDK writes.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { collectionVariantLabel, exactCardmarketProductId, variantForCollectionEntry } from '@/lib/domain';
import { collectionSyncIdForExactCard } from '@/lib/collection';
import { deterministicSourceSyncId } from '@/lib/sync-id';
import { supplementalCard } from '@/lib/catalog-supplement';
import { sharedCardDto } from '@/lib/shared-binder';
import { createPublicCatalogCache } from '../backend/security/public-catalog-cache.mjs';

// No Default Firebase app, cloud or transaction is involved. All identity/domain,
// public-cache projection and shared DTO functions below are the actual product code.
vi.mock('@/lib/firebase-client', () => ({ firestore: {} }));

const owner = 'descriptor-owner';
const rawBasePrintings = [
  {
    type: 'Holo', subtype: 'unbegrenzt', size: 'Standard',
    thirdParty: { cardmarket: 273696 }, variantId: '4ffrmhcfiaejakhepqdkx7o',
    pricing: { cardmarket: { idProduct: 273696, trend: 58.21, unit: 'EUR', updated: '2026-09-24T22:54:32.494Z' } },
  },
  {
    type: 'Holo', subtype: 'schattenlos', size: 'Standard', stamp: ['1. Auflage'],
    thirdParty: { cardmarket: 660227 }, variantId: 'mtltux8qtgdu4exu903oasum21juxbvx6lx',
    pricing: { cardmarket: { idProduct: 660227, trend: 245.15, unit: 'EUR', updated: '2026-09-24T22:54:32.494Z' } },
  },
  {
    type: 'Holo', subtype: 'schattenlos', size: 'Standard',
    thirdParty: { cardmarket: 660227 }, variantId: '3takscxpcqoqcfnxk1ivs2y6',
    pricing: { cardmarket: { idProduct: 660227, trend: 245.15, unit: 'EUR', updated: '2026-09-24T22:54:32.494Z' } },
  },
  { type: 'Holo', subtype: 'Copyright 1999-2000', size: 'Standard', variantId: 'zqq5g2u9n0st0gren5bssktmac2ywqaw' },
];
const androidBaseLabels = [
  'Standard · Untertyp: unbegrenzt',
  'Standard · Untertyp: schattenlos · Stempel: 1. Auflage',
  'Standard · Untertyp: schattenlos',
  'Standard · Untertyp: Copyright 1999-2000',
];
const rawFoil = {
  type: 'Holo', size: 'Standard', foil: 'Kosmos',
  thirdParty: { cardmarket: 781858 }, variantId: '5zs5af49g93yryvw1ftj',
};
const baseCard = {
  id: 'base1-1', localId: '1', name: 'Public descriptor fixture',
  set: { id: 'base1', name: 'Public base set' },
  image: 'https://assets.tcgdex.net/de/base/base1/1',
  variants_detailed: rawBasePrintings,
};

function persisted(printing, label, id = 'existing-descriptor-entry') {
  return {
    syncId: id, ownerUid: owner, revision: 1, lastMutationId: 'existing-mutation', updatedAtClient: 1000,
    deleted: false, deletedAtClient: null, name: 'PRIVATE_OWNER_NAME', setId: 'base1', setName: 'PRIVATE_SET_NAME',
    collectorNumber: '1', language: 'GERMAN', finish: 'Holo', variant: label, rarity: 'UNKNOWN',
    quantity: 2, condition: 'Near Mint', notes: 'PRIVATE_OWNER_NOTE', acquisitionPriceMinor: 123456,
    acquisitionCurrency: 'EUR', acquisitionDateEpochDay: null,
    externalProductSource: printing.thirdParty?.cardmarket ? 'CARDMARKET_PUBLIC_DOWNLOAD' : null,
    externalProductId: printing.thirdParty?.cardmarket ?? null, imageUrl: null, effectOverride: null,
    binderId: 'tcgdex-base1', sourceSetId: 'base1', sourceCardId: 'base1-1',
    binderSetKey: 'tcgdex-base1', binderName: 'PRIVATE_BINDER_NAME', binderHeroAsset: null,
  };
}

// Independent platform-crypto reference for Java UUID.nameUUIDFromBytes, not the
// product's custom TypeScript MD5. Identity framing follows the existing Android
// deterministicSourceSyncId contract. Fixed expected labels do not call Web label code.
function androidSourceUuid(label) {
  const key = [owner, 'base1', 'base1-1', 'Near Mint', 'Holo', label]
    .map((value) => value.trim().toLowerCase()).join('|');
  const bytes = createHash('md5').update(key, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe('raw printing descriptors agree with the existing Android identity contract', () => {
  it.each(rawBasePrintings.map((printing, index) => ({ printing, expected: androidBaseLabels[index] })))(
    'retains the raw base1 printing descriptor: $expected', ({ printing, expected }) => {
      const before = structuredClone(printing);
      expect(collectionVariantLabel(printing)).toBe(expected);
      expect(printing).toEqual(before);
    },
  );

  it('retains the raw sv03 foil without changing its ID or bypassing quarantine', () => {
    const before = structuredClone(rawFoil);
    expect(collectionVariantLabel(rawFoil)).toBe('Standard · Folie: Kosmos');
    expect(exactCardmarketProductId({ ...baseCard, id: 'sv03-062' }, rawFoil)).toBeNull();
    expect(rawFoil).toEqual(before);
  });

  it('keeps ordinary size labels and absent-size fallbacks unchanged', () => {
    for (const [printing, expected] of [
      [{ variantId: 'ordinary', type: 'Normal', size: 'Standard' }, 'Standard'],
      [{ variantId: 'reverse', type: 'Reverse', size: 'Standard' }, 'Standard'],
      [{ variantId: 'holo', type: 'Holo', size: 'Holo' }, 'Holo'],
      [{ variantId: 'no-size', type: 'Normal' }, 'Standard'],
      [{ variantId: 'no-size-holo', type: 'Holo' }, 'Holo'],
      [{ variantId: 'no-size-reverse', type: 'Reverse' }, 'Reverse Holo'],
      [{ variantId: 'empty-markers', type: 'Holo', size: 'Standard', subtype: '', stamp: [], foil: null }, 'Standard'],
    ]) {
      const before = structuredClone(printing);
      expect(collectionVariantLabel(printing)).toBe(expected);
      expect(printing).toEqual(before);
    }
    // Existing Android-compatible ordinary identity must not acquire another generation.
    expect(deterministicSourceSyncId('user', 'sv08', 'sv08-001', 'Near Mint', 'Normal', 'Standard'))
      .toBe('c8830d2d-151e-33b0-9085-532cd04c3814');
  });

  it('does not duplicate an already composed local supplement stamp label', () => {
    const supplement = supplementalCard('mep-101');
    expect(supplement).toBeDefined();
    const printing = supplement.variants_detailed.find((item) => item.variantId === 'supplement-pokemon-center');
    expect(printing).toBeDefined();
    const before = structuredClone(supplement);
    expect(collectionVariantLabel(printing)).toBe('Standard · Stempel: Pokémon-Center');
    expect(supplement).toEqual(before);
  });

  it('keeps every selected raw base printing on its Android-compatible source UUID', () => {
    const before = structuredClone(baseCard);
    const actual = rawBasePrintings.map((printing) => collectionSyncIdForExactCard(owner, baseCard, printing, []));
    expect(actual).toEqual(androidBaseLabels.map(androidSourceUuid));
    expect(new Set(actual).size).toBe(4);
    expect(baseCard).toEqual(before);
  });

  it('resolves both shadowless printings even though their exact product IDs are equal', () => {
    const entries = [1, 2].map((index) => persisted(rawBasePrintings[index], androidBaseLabels[index], `stored-${index}`));
    const before = structuredClone(entries);
    expect(entries[0].externalProductId).toBe(entries[1].externalProductId);
    for (const [index, entry] of entries.entries()) {
      const selected = rawBasePrintings[index + 1];
      expect(variantForCollectionEntry(baseCard, entry)).toBe(selected);
      expect(collectionSyncIdForExactCard(owner, baseCard, selected, entries)).toBe(entry.syncId);
    }
    expect(entries).toEqual(before);
  });

  it('retains an unambiguous legacy raw-ID alias without migrating its stored label', () => {
    const selected = rawBasePrintings[1];
    const legacy = persisted(selected, selected.variantId, 'legacy-raw-id-entry');
    const before = structuredClone(legacy);
    expect(variantForCollectionEntry(baseCard, legacy)).toBe(selected);
    expect(collectionSyncIdForExactCard(owner, baseCard, selected, [legacy])).toBe(legacy.syncId);
    expect(legacy).toEqual(before);
  });

  it('shares the exact stamped descriptor from an Android-shaped entry', () => {
    const entry = persisted(rawBasePrintings[1], androidBaseLabels[1]);
    const before = structuredClone(entry);
    const dto = sharedCardDto(entry, { slotPosition: 0 }, baseCard, true);
    expect(dto).toMatchObject({ cardId: 'base1-1', finish: 'Holo',
      price: { amount: 245.15, currency: 'EUR', source: 'Cardmarket', asOf: '2026-09-24T22:54:32.494Z' } });
    expect(JSON.stringify(dto)).not.toMatch(/PRIVATE_|notes|acquisitionPrice/);
    expect(entry).toEqual(before);
  });

  it.each(['raw', 'prices'])('retains subtype/stamp through the real cold and warm public cache (%s)', async (mode) => {
    const source = structuredClone(baseCard);
    source.ownerUid = 'PRIVATE_PROVIDER_OWNER';
    source.variants_detailed[1].privateNote = 'PRIVATE_PROVIDER_NOTE';
    const load = vi.fn(async () => source);
    const cache = createPublicCatalogCache({ load });
    const controller = new AbortController();
    try {
      const first = await cache.get(source.id, controller.signal, mode);
      const second = await cache.get(source.id, controller.signal, mode);
      expect(load).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      for (const projected of [first, second]) {
        expect(projected.variants_detailed.map((printing) => printing.subtype))
          .toEqual(rawBasePrintings.map((printing) => printing.subtype));
        expect(projected.variants_detailed[1].stamp).toEqual(['1. Auflage']);
        expect(projected.variants_detailed.map(collectionVariantLabel)).toEqual(androidBaseLabels);
        expect(JSON.stringify(projected)).not.toContain('PRIVATE_');
        const entry = persisted(rawBasePrintings[1], androidBaseLabels[1]);
        expect(sharedCardDto(entry, { slotPosition: 0 }, projected, true)).toMatchObject({ finish: 'Holo', price: { amount: 245.15 } });
      }
      expect(cache.stats()).toMatchObject({ entries: 1, inFlight: 0 });
    } finally {
      controller.abort();
    }
  });
});
