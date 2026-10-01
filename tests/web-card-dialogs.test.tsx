// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebApp, BinderView, CollectionView } from '@/components/web-app';
import { useAuth } from '@/components/auth-provider';
import { useCollectionPrices } from '@/components/use-collection-prices';
import { addExactCard, changeQuantity, subscribeCollection } from '@/lib/collection';
import { loadCard, loadSet, searchCards } from '@/lib/tcgdex';
import type { CollectionEntry, TcgCardDetail, TcgCardSummary, TcgVariant } from '@/lib/domain';

vi.mock('@/components/auth-provider', () => ({ useAuth: vi.fn() }));
vi.mock('@/components/use-collection-prices', () => ({ useCollectionPrices: vi.fn() }));
vi.mock('@/components/use-collection-layouts', () => ({ useCollectionLayouts: () => ({ visibility: new Map(), failed: false }) }));
vi.mock('@/lib/collection', () => ({
  subscribeCollection: vi.fn(),
  changeQuantity: vi.fn(),
  addExactCard: vi.fn(),
  collectionSyncIdForExactCard: vi.fn(() => 'fixture-sync-id'),
}));
vi.mock('@/lib/tcgdex', () => ({
  loadCard: vi.fn(), loadSet: vi.fn(), searchCards: vi.fn(),
  imageUrl: (url?: string | null, size = 'high') => url ? `${url}/${size}.webp` : null,
}));
vi.mock('@/components/private-binder-gallery', () => ({ PrivateBinderGallery: () => null }));
vi.mock('@/components/binder-sharing-owner', () => ({ BinderSharingOwner: () => null }));
vi.mock('@/components/shared-binder-material', () => ({
  SharedBinderMaterial: ({ effect, tilt }: { effect: string; tilt: { x: number; y: number } }) => <span data-testid="card-material" data-effect={effect} data-tilt-x={tilt.x} data-tilt-y={tilt.y} />,
}));
vi.mock('@/components/card-profile-material', () => ({
  CardProfileMaterial: ({ profile, tilt }: { profile: { profile: string }; tilt: { x: number; y: number } }) => profile.profile === 'NONE' ? null : <span data-testid="profile-material" data-profile-id={profile.profile} data-tilt-x={tilt.x} data-tilt-y={tilt.y} />,
}));

const user = { uid: 'fixture-owner', displayName: 'Fixture', email: 'fixture@example.invalid' } as NonNullable<ReturnType<typeof useAuth>['user']>;
const owned = Object.freeze({
  syncId: 'fixture-normal', ownerUid: user.uid, revision: 1, lastMutationId: 'fixture-mutation', updatedAtClient: 1,
  deleted: false, deletedAtClient: null, name: 'Testkarte', setId: 'fixture', setName: 'Testset', collectorNumber: '025',
  language: 'GERMAN', finish: 'Normal', variant: 'Standard', rarity: 'Common', quantity: 2, condition: 'Near Mint', notes: '',
  acquisitionPriceMinor: null, acquisitionCurrency: null, acquisitionDateEpochDay: null, externalProductSource: 'cardmarket', externalProductId: 101,
  imageUrl: 'https://assets.tcgdex.net/fixture/025/high.webp', effectOverride: 'HOLO', binderId: 'fixture',
  sourceSetId: 'fixture', sourceCardId: 'fixture-025', binderSetKey: 'fixture', binderName: 'Testbinder', binderHeroAsset: null,
}) satisfies CollectionEntry;
const entries: CollectionEntry[] = [owned];
const summary: TcgCardSummary = { id: 'fixture-025', name: 'Testkarte', localId: '025', rarity: 'Common', image: 'https://assets.tcgdex.net/fixture/025', printVariants: ['normal', 'reverseholofoil'] };
const normal: TcgVariant = Object.freeze({ type: 'Normal', size: 'Standard', variantId: 'normal-print', pricing: { cardmarket: { idProduct: 101, unit: 'EUR', trend: 12.34 } } });
const reverse: TcgVariant = Object.freeze({ type: 'Reverse Holo', size: 'Standard', variantId: 'reverse-print', pricing: { cardmarket: { idProduct: 102, unit: 'EUR', trend: 99, 'trend-holo': 4.56 } } });
const detail: TcgCardDetail = { ...summary, set: { id: 'fixture', name: 'Testset' }, variants_detailed: [normal, reverse] };
const prices = { [owned.syncId]: 12.34 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No network is allowed in fixture-only dialog tests')));
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, isAdmin: false, hasAppAccess: true, accessError: null, logout: vi.fn(), refreshClaims: vi.fn(), signIn: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useCollectionPrices).mockReturnValue({ prices, priceSources: {}, selections: {}, selectionSyncFailed: false, failed: new Set(), pending: 0, retry: vi.fn() });
  vi.mocked(subscribeCollection).mockImplementation((_user, next) => { next(entries); return vi.fn(); });
  vi.mocked(changeQuantity).mockResolvedValue(undefined);
  vi.mocked(addExactCard).mockResolvedValue(null);
  vi.mocked(loadSet).mockResolvedValue({ id: 'fixture', name: 'Testset', cardCount: { official: 100 }, cards: [summary] });
  vi.mocked(loadCard).mockResolvedValue(detail);
  vi.mocked(searchCards).mockResolvedValue([summary]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function expectNoWrites() {
  expect(changeQuantity).not.toHaveBeenCalled();
  expect(addExactCard).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}

function tiltAndExpand(dialog: HTMLElement) {
  const stage = within(dialog).getByRole('button', { name: 'Testkarte: interaktive Kartenansicht' });
  fireEvent.keyDown(stage, { key: 'ArrowRight' });
  expect(dialog.querySelector('[data-card-surface]')?.getAttribute('data-tilt-y')).toBe('2');
  expect(within(dialog).getByTestId('profile-material').getAttribute('data-tilt-y')).toBe('2');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Großansicht' }));
  expect(dialog.classList.contains('card-dialog--expanded')).toBe(true);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
}

async function openBinderPocket(finish: 'Normal' | 'Reverse Holo') {
  render(<BinderView binders={[{ id: 'fixture', name: 'Testbinder', sourceSetId: 'fixture', entries }]} prices={prices} user={user} onError={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /DOMIDEX BINDER/ }));
  const pocket = await screen.findByRole('button', { name: finish === 'Normal' ? /Testkarte.*×2.*Normal/ : /Testkarte.*Reverse Holo.*fehlt/ });
  fireEvent.click(pocket);
  return screen.findByRole('dialog', { name: 'Testkarte' });
}

describe('card showcase integration without changing collection identity', () => {
  it('keeps a search result without printing evidence addable but does not copy its root prices', async () => {
    const rootOnly = { ...detail, variants_detailed: undefined, pricing: { cardmarket: {
      idProduct: 101, trend: 123.45, avg: 67.89, unit: 'EUR', updated: '2026-09-25T08:00:00Z',
    } } };
    vi.mocked(loadCard).mockResolvedValue(rootOnly);
    render(<WebApp />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Web-App Navigation' })).getByRole('button', { name: 'Karte hinzufügen' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Kartenname suchen' }), { target: { value: 'Testkarte' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*#025.*fixture-025/ }));
    await screen.findByRole('combobox', { name: 'Variante' });
    expect(screen.getByText('Preis nicht verfügbar')).toBeTruthy();
    expect(screen.queryByText(/123,45|67,89/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(addExactCard).toHaveBeenCalledOnce());
    expect(vi.mocked(addExactCard).mock.calls[0][2]).toEqual({ type: 'Normal', size: 'Standard' });
    expect(changeQuantity).not.toHaveBeenCalled();
  });

  it('keeps an unowned binder card without printing evidence unpriced without copying root fields', async () => {
    const rootOnly = { ...detail, variants_detailed: undefined, pricing: { cardmarket: {
      idProduct: 101, trend: 123.45, avg: 67.89, unit: 'EUR', updated: '2026-09-25T08:00:00Z',
    } } };
    vi.mocked(loadCard).mockResolvedValue(rootOnly);
    vi.mocked(loadSet).mockResolvedValue({ id: 'fixture', name: 'Testset', cards: [{ ...summary, printVariants: ['normal'] }] });
    render(<BinderView binders={[{ id: 'fixture', name: 'Testbinder', sourceSetId: 'fixture', entries: [] }]} prices={{}} user={user} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /DOMIDEX BINDER/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*Normal.*fehlt/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Testkarte' });
    expect(await within(dialog).findByText('Preis nicht verfügbar')).toBeTruthy();
    expect(within(dialog).queryByText(/123,45|67,89/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(addExactCard).toHaveBeenCalledOnce());
    expect(vi.mocked(addExactCard).mock.calls[0][2]).toEqual({ type: 'Normal', size: 'Standard' });
    expect(changeQuantity).not.toHaveBeenCalled();
  });

  it('opens the Overview artwork read-only, expands in one dialog and restores focus after Escape', async () => {
    render(<WebApp />);
    const opener = (await screen.findAllByRole('button', { name: 'Karte groß ansehen: Testkarte' }))[0];
    act(() => opener.focus());
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Testkarte' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Schließen' }));
    expect(within(dialog).getByText(/2 × in deiner Sammlung · Nur Ansicht/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Menge erhöhen' })).toBeNull();
    expect(within(dialog).getByText('Normal · Standard')).toBeTruthy();
    expect(within(dialog).getByTestId('profile-material').getAttribute('data-profile-id')).toBe('HOLO');
    expect(within(dialog).queryByTestId('card-material')).toBeNull();
    tiltAndExpand(dialog);
    expectNoWrites();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('retains the collection finish, visual override, exact price and explicit quantity action', async () => {
    render(<CollectionView entries={entries} prices={prices} user={user} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Testkarte, Testset, Nummer 025, Normal, Standard, 2 im Besitz/ }));
    const dialog = screen.getByRole('dialog', { name: 'Testkarte' });
    expect(within(dialog).getByText('Normal · Standard')).toBeTruthy();
    expect(within(dialog).getByText(/12,34/)).toBeTruthy();
    expect(within(dialog).getByText(/24,68/)).toBeTruthy();
    expect(within(dialog).getByTestId('profile-material').getAttribute('data-profile-id')).toBe('HOLO');
    expect(within(dialog).queryByTestId('card-material')).toBeNull();
    tiltAndExpand(dialog);
    expectNoWrites();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Details anzeigen' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Menge erhöhen' }));
    await waitFor(() => expect(changeQuantity).toHaveBeenCalledWith(user, owned, 1));
    expect(changeQuantity).toHaveBeenCalledOnce();
    expect(addExactCard).not.toHaveBeenCalled();
    expect(owned).toMatchObject({ finish: 'Normal', variant: 'Standard', effectOverride: 'HOLO', quantity: 2, externalProductId: 101 });
  });

  it('opens the exact owned Binder printing and only writes after the quantity action', async () => {
    const dialog = await openBinderPocket('Normal');
    expect(within(dialog).getByText('Normal · Standard')).toBeTruthy();
    expect(within(dialog).getByTestId('profile-material').getAttribute('data-profile-id')).toBe('HOLO');
    expect(within(dialog).queryByTestId('card-material')).toBeNull();
    expect(within(dialog).getByText(/12,34/)).toBeTruthy();
    tiltAndExpand(dialog);
    expectNoWrites();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Details anzeigen' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Menge verringern' }));
    await waitFor(() => expect(changeQuantity).toHaveBeenCalledWith(user, owned, -1));
    expect(addExactCard).not.toHaveBeenCalled();
  });

  it('previews an unowned Reverse slot without borrowing the Normal identity, then adds its exact printing', async () => {
    const dialog = await openBinderPocket('Reverse Holo');
    expect(await within(dialog).findByText('Reverse Holo · Standard')).toBeTruthy();
    expect(within(dialog).getByText(/4,56/)).toBeTruthy();
    expect(within(dialog).queryByText(/99,00/)).toBeNull();
    expect(within(dialog).getByTestId('profile-material').getAttribute('data-profile-id')).toBe('REVERSE_HOLO');
    expect(within(dialog).queryByTestId('card-material')).toBeNull();
    tiltAndExpand(dialog);
    expectNoWrites();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Details anzeigen' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(addExactCard).toHaveBeenCalledWith(user, detail, reverse, 1, entries));
    expect(addExactCard).toHaveBeenCalledOnce();
    expect(changeQuantity).not.toHaveBeenCalled();
    expect(owned).toMatchObject({ finish: 'Normal', variant: 'Standard', quantity: 2, externalProductId: 101 });
  });

  it('opens the search artwork read-only and preserves its selected variant after closing', async () => {
    render(<WebApp />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Web-App Navigation' })).getByRole('button', { name: 'Karte hinzufügen' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Kartenname suchen' }), { target: { value: 'Testkarte' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*#025.*fixture-025/ }));
    const select = await screen.findByRole('combobox', { name: 'Variante' });
    fireEvent.change(select, { target: { value: '1' } });
    const opener = screen.getByRole('button', { name: 'Karte groß ansehen: Testkarte' });
    act(() => opener.focus());
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Testkarte' });
    expect(within(dialog).getByText('Reverse Holo')).toBeTruthy();
    expect(within(dialog).getByTestId('profile-material').getAttribute('data-profile-id')).toBe('REVERSE_HOLO');
    expect(within(dialog).queryByTestId('card-material')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Zur Sammlung hinzufügen' })).toBeNull();
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Testkarte: interaktive Kartenansicht' }), { key: 'ArrowRight' });
    expect(within(dialog).getByTestId('profile-material').getAttribute('data-tilt-y')).toBe('2');
    expectNoWrites();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(within(select).getByRole('option', { name: 'Reverse Holo · Standard', selected: true })).toBeTruthy();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(addExactCard).toHaveBeenCalledWith(user, detail, reverse, 1, entries));
    expect(changeQuantity).not.toHaveBeenCalled();
  });
});
