// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildBinderSlots, paginateBinderSlots } from '@/lib/binder';
import type { CollectionEntry, TcgCardSummary } from '@/lib/domain';
import { BinderView } from '@/components/web-app';
import { loadCard, loadSet } from '@/lib/tcgdex';

vi.mock('@/components/auth-provider', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/collection', () => ({ addExactCard: vi.fn(), changeQuantity: vi.fn(), subscribeCollection: vi.fn() }));
vi.mock('@/lib/tcgdex', () => ({ loadSet: vi.fn(), loadCard: vi.fn(), searchCards: vi.fn(), imageUrl: (url: string) => url }));
afterEach(cleanup);

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

describe('open binder without page-turn overlays', () => {
  const cards = Array.from({ length: 10 }, (_, index) => card({ id: `test-${index + 1}`, localId: String(index + 1), name: `Testkarte ${index + 1}`, printVariants: ['normal'] }));
  beforeEach(() => {
    vi.mocked(loadSet).mockResolvedValue({ id: 'test', name: 'Testbinder', cardCount: { official: 10 }, cards });
    vi.mocked(loadCard).mockResolvedValue({ ...cards[0], set: { id: 'test', name: 'Testbinder' }, variants: { normal: true } });
  });
  async function openBinder() {
    const view = render(createElement(BinderView, {
      binders: [{ id: 'test', name: 'Testbinder', sourceSetId: 'test', entries: [] }],
      prices: {}, user: { uid: 'test-only' } as Parameters<typeof BinderView>[0]['user'], onError: vi.fn(),
    }));
    fireEvent.click(screen.getByRole('button', { name: /DOMIDEX BINDER/ }));
    await waitFor(() => expect(view.container.querySelectorAll('.binder-pocket')).toHaveLength(8));
    return view;
  }
  it('changes pages immediately with no overlay or animation-event lock', async () => {
    const view = await openBinder();
    const previous = screen.getByRole('button', { name: 'Vorherige Binderseite' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: 'Nächste Binderseite' }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    fireEvent.click(next);
    expect(screen.getByText('Seite 2 / 2')).toBeTruthy();
    expect(next.disabled).toBe(true);
    expect(previous.disabled).toBe(false);
    expect(view.container.querySelector('.binder-turn-sheet')).toBeNull();
    expect(screen.getByAltText('Testkarte 9')).toBeTruthy();
    fireEvent.click(previous);
    expect(screen.getByText('Seite 1 / 2')).toBeTruthy();
    expect(screen.getByAltText('Testkarte 1')).toBeTruthy();
    expect(view.container.querySelector('.binder-turn-sheet')).toBeNull();
  });
  it('retains eight bounded pockets, including disabled empty slots on the last page', async () => {
    const view = await openBinder();
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Binderseite' }));
    expect(view.container.querySelectorAll('.binder-pocket')).toHaveLength(8);
    const empty = [...view.container.querySelectorAll<HTMLButtonElement>('.empty-pocket')];
    expect(empty).toHaveLength(6);
    expect(empty.every((button) => button.disabled)).toBe(true);
  });
  it('still opens the exact selected card and closes/reopens the binder', async () => {
    await openBinder();
    fireEvent.click(screen.getByAltText('Testkarte 1'));
    expect(await screen.findByRole('dialog', { name: 'Testkarte 1' })).toBeTruthy();
    expect(loadCard).toHaveBeenCalledWith('test-1');
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Binder schließen' }));
    fireEvent.click(screen.getByRole('button', { name: /DOMIDEX BINDER/ }));
    expect(screen.getByText('Seite 1 / 2')).toBeTruthy();
  });
});
