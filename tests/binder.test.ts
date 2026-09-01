import { describe, expect, it } from 'vitest';
import { buildBinderSlots } from '@/lib/binder';
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
});
