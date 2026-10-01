// Synthetic compatibility regression for precomposed source labels.
// These synthetic compatibility fixtures are NOT additional observed source records.
// Existing complete markers may match case-insensitively after trimming their
// outer whitespace; preserve their original text. No fuzzy/subset stamp matching.
import { describe, expect, it, vi } from 'vitest';
import { collectionVariantLabel } from '@/lib/domain';
import { collectionSyncIdForExactCard } from '@/lib/collection';
import { deterministicSourceSyncId } from '@/lib/sync-id';

vi.mock('@/lib/firebase-client', () => ({ firestore: {} }));

const owner = 'composed-marker-owner';
const baseCard = {
  id: 'identity-proof-001', localId: '001', name: 'Synthetic composed descriptor',
  set: { id: 'identity-proof', name: 'Synthetic set' },
};

function assertLabelAndUuid(printing, expected) {
  const before = structuredClone(printing);
  const card = { ...baseCard, variants_detailed: [printing] };
  expect(collectionVariantLabel(printing)).toBe(expected);
  expect(collectionSyncIdForExactCard(owner, card, printing, [])).toBe(
    deterministicSourceSyncId(owner, card.set.id, card.id, 'Near Mint', 'Holo', expected),
  );
  expect(printing).toEqual(before);
}

describe('complete precomposed markers retain their existing identity', () => {
  it.each([
    {
      label: 'stamp value case', size: 'Standard · Stempel: Event', stamp: ['event'],
      expected: 'Standard · Stempel: Event',
    },
    {
      label: 'stamp marker case', size: 'Standard · stempel: Event', stamp: [' Event '],
      expected: 'Standard · stempel: Event',
    },
    {
      label: 'part boundary spaces', size: ' Standard ·  Stempel: Event  · Folie: Cosmos ',
      stamp: [' event '], foil: ' cosmos ',
      expected: 'Standard ·  Stempel: Event  · Folie: Cosmos',
    },
    {
      label: 'subtype case', size: 'Standard · UNTERTYP: Schattenlos', subtype: ' schattenlos ',
      expected: 'Standard · UNTERTYP: Schattenlos',
    },
    {
      label: 'foil case', size: 'Standard · Folie: Kosmos', foil: ' kosmos ',
      expected: 'Standard · Folie: Kosmos',
    },
    {
      label: 'sorted complete stamp list', size: 'Standard · Stempel: Alpha + BETA', stamp: [' beta ', 'alpha', 'ALPHA'],
      expected: 'Standard · Stempel: Alpha + BETA',
    },
    {
      label: 'scalar stamp', size: 'Standard · Stempel: Event', stamp: ' EVENT ',
      expected: 'Standard · Stempel: Event',
    },
  ])('preserves text and UUID for $label', ({ label: _label, expected, ...fields }) => {
    const printing = { variantId: 'existing-source-id', type: 'Holo', ...fields };
    assertLabelAndUuid(printing, expected);
    // Before the raw marker fields were supplied, the exact same precomposed size
    // already selected this identity. This is compatibility, not data migration.
    const previous = { variantId: printing.variantId, type: printing.type, size: printing.size };
    expect(collectionSyncIdForExactCard(owner, { ...baseCard, variants_detailed: [previous] }, previous, []))
      .toBe(collectionSyncIdForExactCard(owner, { ...baseCard, variants_detailed: [printing] }, printing, []));
  });

  it('appends a different complete stamp rather than accepting a partial value match', () => {
    assertLabelAndUuid({
      variantId: 'existing-source-id', type: 'Holo', size: 'Standard · Stempel: Event Extra', stamp: ['Event'],
    }, 'Standard · Stempel: Event Extra · Stempel: Event');
  });

  it('does not mistake another marker name for Stempel', () => {
    assertLabelAndUuid({
      variantId: 'existing-source-id', type: 'Holo', size: 'Standard · Sonderstempel: Event', stamp: ['Event'],
    }, 'Standard · Sonderstempel: Event · Stempel: Event');
  });
});

describe('new raw markers use the Android trim/deduplicate/sort contract', () => {
  it('supports a scalar stamp without rewriting the source value', () => {
    assertLabelAndUuid({ variantId: 'raw-stamp', type: 'Holo', size: 'Standard', stamp: ' Event ' },
      'Standard · Stempel: Event');
  });

  it.each([null, undefined, '', '   ', [], [' ', '', null]].map((stamp) => ({ stamp })))('leaves the ordinary label unchanged for empty stamp $stamp', ({ stamp }) => {
    assertLabelAndUuid({ variantId: 'ordinary', type: 'Holo', size: 'Standard', stamp }, 'Standard');
  });

  it('trims, ignores empty values, preserves first spelling and sorts unique stamps', () => {
    assertLabelAndUuid({
      variantId: 'raw-stamps', type: 'Holo', size: 'Standard',
      stamp: [' zeta ', '', null, 'Alpha', 'alpha', 'BETA', ' beta '],
    }, 'Standard · Stempel: Alpha + BETA + zeta');
  });

  it('keeps the subtype, sorted stamps and foil in Android marker order', () => {
    assertLabelAndUuid({
      variantId: 'raw-all-markers', type: 'Holo', size: 'Standard',
      subtype: ' schattenlos ', stamp: [' Event ', '1. Auflage', 'event'], foil: ' Kosmos ',
    }, 'Standard · Untertyp: schattenlos · Stempel: 1. Auflage + Event · Folie: Kosmos');
  });
});
