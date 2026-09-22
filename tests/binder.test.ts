// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { buildBinderSlots, paginateBinderSlots, variantForBinderSlot } from '@/lib/binder';
import { exactTrendPrice, type CollectionEntry, type TcgCardSummary, type TcgVariant } from '@/lib/domain';
import { addExactCard } from '@/lib/collection';
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

  it.each([
    ['Bibor-ex', 'Double Rare', '003'],
    ['Sonderkarte', 'ACE SPEC Rare', '070'],
    ['Sonderkarte', 'Illustration Rare', '089'],
    ['Sonderkarte', 'Full Art', '122'],
    ['Sonderkarte', 'Secret Rare', '137'],
    ['Sonderkarte', undefined, '140'],
  ])('counts %s / %s / %s as one Normal / Standard place, including holo-only cards', (name, rarity, localId) => {
    const slots = buildBinderSlots([card({ name, rarity, localId, printVariants: ['holofoil'] })], [], 88);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ finish: 'Normal', variant: 'Standard', standardSlot: true });
  });

  it('shows existing Normal and Holo special-card entries without mutating their identities', () => {
    const normal = Object.freeze(entry('Normal', { externalProductId: 123, syncId: 'normal' }));
    const holo = Object.freeze(entry('Holo', { externalProductId: 456, syncId: 'holo' }));
    const unrelated = entry('Normal', { sourceCardId: 'another-set-025' });
    const [slot] = buildBinderSlots([card({ name: 'Mega-Quajutsu-ex', printVariants: ['holofoil'] })], [normal, holo, unrelated], 88);
    expect(slot.owned).toEqual([normal, holo]);
    expect(slot.owned[0]).toBe(normal);
    expect(slot.owned[1]).toBe(holo);
    expect(holo.finish).toBe('Holo');
    expect(holo.externalProductId).toBe(456);
  });

  it('does not classify ordinary cards as special when the printed total is unknown', () => {
    const [slot] = buildBinderSlots([card({ printVariants: ['holofoil'] })], [], 0);
    expect(slot.finish).toBe('Holo');
    expect(slot.standardSlot).toBeUndefined();
  });

  it('uses the actual unique special-card printing for pricing, not the Normal binder label', () => {
    const summary = card({ name: 'Bibor-ex', printVariants: ['holofoil'] });
    const [slot] = buildBinderSlots([summary], [], 88);
    const holo: TcgVariant = { type: 'Holo', size: 'Standard', pricing: { cardmarket: { idProduct: 123, trend: 2, 'trend-holo': 3 } } };
    const reverse: TcgVariant = { type: 'Reverse Holo' };
    const selected = variantForBinderSlot([reverse, holo], slot);
    expect(selected).toBe(holo);
    expect(exactTrendPrice({ ...summary, set: { id: 'test', name: 'Test' } }, selected!)).toBe(3);
    expect(variantForBinderSlot([holo, { ...holo, variantId: 'other-product' }], slot)).toBeUndefined();
    expect(variantForBinderSlot([reverse], slot)).toBeUndefined();
  });

  it('keeps ordinary Normal and Reverse pricing selections separate', () => {
    const slots = buildBinderSlots([card()], [], 100);
    const variants: TcgVariant[] = [{ type: 'Reverse Holo', size: 'Standard' }, { type: 'Normal', size: 'Standard' }];
    expect(variantForBinderSlot(variants, slots[0])).toBe(variants[1]);
    expect(variantForBinderSlot(variants, slots[1])).toBe(variants[0]);
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

describe('special-card binder preview and ownership', () => {
  const special = card({ id: 'test-122', localId: '122', name: 'Mega-Quajutsu-ex', rarity: 'Special Illustration Rare', printVariants: ['holofoil'] });
  const holo: TcgVariant = { type: 'Holo', size: 'Standard', pricing: { cardmarket: { idProduct: 123, 'trend-holo': 12.34 } } };
  const detail = { ...special, set: { id: 'test', name: 'Testbinder' }, variants_detailed: [holo] };
  const user = { uid: 'test-only' } as Parameters<typeof BinderView>[0]['user'];
  beforeEach(() => {
    vi.mocked(loadSet).mockResolvedValue({ id: 'test', name: 'Testbinder', cardCount: { official: 100 }, cards: [special] });
    vi.mocked(loadCard).mockResolvedValue(detail);
    vi.mocked(addExactCard).mockReset();
  });
  async function openSpecial(entries: CollectionEntry[] = []) {
    const view = render(createElement(BinderView, { binders: [{ id: 'test', name: 'Testbinder', sourceSetId: 'test', entries }], prices: { owned: 12.34 }, user, onError: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: /DOMIDEX BINDER/ }));
    const pocket = await screen.findByRole('button', { name: /Mega-Quajutsu-ex.*Normal/ });
    return { view, pocket };
  }
  it('previews Normal / Standard, shows the exact holo price and adds the unchanged real printing', async () => {
    const { pocket } = await openSpecial();
    fireEvent.click(pocket);
    expect(await screen.findByText('Normal · Standard')).toBeTruthy();
    expect(screen.getByText(/12,34/)).toBeTruthy();
    const add = screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(addExactCard).toHaveBeenCalledWith(user, detail, holo, 1, []));
  });
  it('lights up an existing Normal entry in a holo-only special-card place', async () => {
    const owned = entry('Normal', { sourceCardId: special.id, name: special.name, collectorNumber: '122', quantity: 1, syncId: 'owned', language: 'GERMAN' });
    const { pocket } = await openSpecial([owned]);
    await waitFor(() => expect(screen.getByText(/1\/1 Plätze/)).toBeTruthy());
    expect(pocket.classList.contains('missing-card')).toBe(false);
    expect(pocket.textContent).toContain('×1Normal');
    fireEvent.click(pocket);
    const dialog = await screen.findByRole('dialog', { name: special.name });
    expect(within(dialog).getAllByText(/12,34/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Zur Sammlung hinzufügen' })).toBeNull();
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
