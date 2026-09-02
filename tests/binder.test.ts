import { describe, expect, it } from 'vitest';
import { buildBinderSlots, paginateBinderSlots } from '@/lib/binder';
import type { CollectionEntry } from '@/lib/domain';

describe('master-set binder mapping', () => {
  it('keeps every set position and maps ownership by exact source identity', () => {
    const cards = [
      { id: 'sv03.5-001', localId: '001', name: 'Bisasam' },
      { id: 'sv03.5-002', localId: '002', name: 'Bisaknosp' },
    ];
    const entry = { sourceCardId: 'sv03.5-001', collectorNumber: '001', name: 'Bisasam' } as CollectionEntry;
    const slots = buildBinderSlots(cards, [entry]);
    expect(slots).toHaveLength(2);
    expect(slots[0].owned).toEqual([entry]);
    expect(slots[1].owned).toEqual([]);
    expect(slots[1].card.localId).toBe('002');
  });

  it('does not match cards by name alone', () => {
    const cards = [{ id: 'set-a-001', localId: '001', name: 'Pikachu' }];
    const entry = { sourceCardId: 'set-b-001', collectorNumber: '001', name: 'Pikachu' } as CollectionEntry;
    const slots = buildBinderSlots(cards, [entry]);
    expect(slots[0].owned).toEqual([]);
    expect(slots[1].owned).toEqual([entry]);
  });

  it('maps a known Android variant suffix to the canonical master-set slot', () => {
    const cards = [{ id: 'me04-089', localId: '089', name: 'Testkarte' }];
    const entry = { sourceCardId: 'me04-089-reverse-holo', collectorNumber: '089', name: 'Testkarte' } as CollectionEntry;
    const slots = buildBinderSlots(cards, [entry]);
    expect(slots).toHaveLength(1);
    expect(slots[0].owned).toEqual([entry]);
  });

  it('keeps every master-set card reachable across binder pages', () => {
    const cards = Array.from({ length: 207 }, (_, index) => ({ id: `sv03.5-${index + 1}`, localId: String(index + 1), name: `Karte ${index + 1}` }));
    const slots = buildBinderSlots(cards, []);
    const pages = paginateBinderSlots(slots);
    expect(pages).toHaveLength(26);
    expect(pages.flat().map((slot) => slot.card.id)).toEqual(cards.map((card) => card.id));
    expect(pages.at(-1)).toHaveLength(7);
  });
});
