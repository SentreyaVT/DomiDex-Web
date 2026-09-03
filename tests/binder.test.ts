import { describe, expect, it } from 'vitest';
import { buildBinderSlots, paginateBinderSlots } from '@/lib/binder';
import type { CollectionEntry, TcgCardSummary } from '@/lib/domain';

const threePrints = ['normal', 'holofoil', 'reverseholofoil'];

function card(overrides: Partial<TcgCardSummary> = {}): TcgCardSummary {
  return {
    id: 'sv-test-025',
    localId: '025',
    name: 'Pikachu',
    rarity: 'Common',
    printVariants: threePrints,
    ...overrides,
  };
}

function entry(finish: string, overrides: Partial<CollectionEntry> = {}): CollectionEntry {
  return {
    sourceCardId: 'sv-test-025',
    collectorNumber: '025',
    name: 'Pikachu',
    finish,
    variant: finish === 'Normal' ? 'Standard' : finish,
    ...overrides,
  } as CollectionEntry;
}

describe('master-set binder print-slot policy', () => {
  it('keeps at most Normal and Reverse for an ordinary main-set card', () => {
    const slots = buildBinderSlots([card()], [], 100);

    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => slot.finish)).toEqual(['Normal', 'Reverse Holo']);
  });

  it('keeps an EX card singular even when several printings are declared', () => {
    const slots = buildBinderSlots([card({ name: 'Glurak ex', localId: '006', id: 'sv-test-006' })], [], 100);

    expect(slots).toHaveLength(1);
    expect(slots[0].finish).toBe('Normal');
  });

  it.each([
    ['ACE SPEC Rare', '070'],
    ['Illustration Rare', '117'],
  ])('keeps the special printing %s singular', (rarity, localId) => {
    const slots = buildBinderSlots([card({ id: `sv-test-${localId}`, localId, name: 'Sonderkarte', rarity })], [], 120);

    expect(slots).toHaveLength(1);
  });

  it('maps ownership only to the exact finish slot', () => {
    const normal = entry('Normal');
    const reverse = entry('Reverse Holo');
    const slots = buildBinderSlots([card()], [normal, reverse], 100);

    expect(slots[0].finish).toBe('Normal');
    expect(slots[0].owned).toEqual([normal]);
    expect(slots[1].finish).toBe('Reverse Holo');
    expect(slots[1].owned).toEqual([reverse]);
  });

  it('paginates expanded print slots without losing their order', () => {
    const cards = Array.from({ length: 10 }, (_, index) => card({
      id: `sv-test-${String(index + 1).padStart(3, '0')}`,
      localId: String(index + 1).padStart(3, '0'),
      name: `Karte ${index + 1}`,
    }));
    const slots = buildBinderSlots(cards, [], 100);
    const pages = paginateBinderSlots(slots);

    expect(slots).toHaveLength(20);
    expect(pages.map((page) => page.length)).toEqual([8, 8, 4]);
    expect(pages.flat().map((slot) => slot.slotId)).toEqual(slots.map((slot) => slot.slotId));
  });
});
