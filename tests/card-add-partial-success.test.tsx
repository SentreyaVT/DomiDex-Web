// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinderView, WebApp } from '@/components/web-app';
import { useAuth } from '@/components/auth-provider';
import { useCollectionPrices } from '@/components/use-collection-prices';
import { addExactCard, changeQuantity, subscribeCollection } from '@/lib/collection';
import { saveCollectionPriceSelection } from '@/lib/collection-price-selections';
import { loadCard, loadSet, searchCards } from '@/lib/tcgdex';
import type { CollectionEntry, TcgCardDetail, TcgCardSummary, TcgVariant } from '@/lib/domain';

vi.mock('@/components/auth-provider', () => ({ useAuth: vi.fn() }));
vi.mock('@/components/use-collection-prices', () => ({ useCollectionPrices: vi.fn() }));
vi.mock('@/components/use-collection-layouts', () => ({ useCollectionLayouts: () => ({ visibility: new Map(), failed: false }) }));
vi.mock('@/lib/collection', () => ({
  subscribeCollection: vi.fn(), changeQuantity: vi.fn(), addExactCard: vi.fn(),
  collectionSyncIdForExactCard: vi.fn(() => 'synthetic-added-entry'),
}));
vi.mock('@/lib/collection-price-selections', () => ({
  saveCollectionPriceSelection: vi.fn(), clearCollectionPriceSelection: vi.fn(),
}));
vi.mock('@/lib/tcgdex', () => ({
  loadCard: vi.fn(), loadSet: vi.fn(), searchCards: vi.fn(),
  imageUrl: (url?: string | null) => url ? `${url}/high.webp` : null,
}));
vi.mock('@/components/private-binder-gallery', () => ({ PrivateBinderGallery: () => null }));
vi.mock('@/components/binder-sharing-owner', () => ({ BinderSharingOwner: () => null }));
vi.mock('@/components/shared-binder-material', () => ({ SharedBinderMaterial: () => null }));
vi.mock('@/components/card-profile-material', () => ({ CardProfileMaterial: () => null }));

const user = { uid: 'synthetic-owner', displayName: 'Synthetic', email: 'synthetic@example.invalid' } as
  NonNullable<ReturnType<typeof useAuth>['user']>;
const summary: TcgCardSummary = { id: 'fixture-025', localId: '025', name: 'Testkarte', printVariants: ['normal'] };
const variant: TcgVariant = { type: 'Normal', size: 'Standard', variantId: 'normal-print', pricing: { cardmarket: {
  idProduct: 101, trend: null, avg: 4.44, low: 3.33, unit: 'EUR', updated: '2026-09-25T08:00:00Z',
} } };
const detail: TcgCardDetail = { ...summary, set: { id: 'fixture', name: 'Testset' }, variants_detailed: [variant] };
const binderError = vi.fn();
const partialMessage = /Karte.*hinzugefügt.*Preisauswahl.*nicht.*gespeichert/i;
type Flow = 'search' | 'binder';
const savedEntry: CollectionEntry = {
  syncId: 'synthetic-added-entry', ownerUid: user.uid, revision: 1, lastMutationId: 'synthetic-mutation',
  updatedAtClient: 1, deleted: false, deletedAtClient: null, name: 'Testkarte', setId: 'fixture',
  setName: 'Testset', collectorNumber: '025', language: 'GERMAN', finish: 'Normal', variant: 'Standard',
  rarity: 'Common', quantity: 1, condition: 'Near Mint', notes: '', acquisitionPriceMinor: null,
  acquisitionCurrency: null, acquisitionDateEpochDay: null, externalProductSource: 'CARDMARKET_PUBLIC_DOWNLOAD',
  externalProductId: 101, imageUrl: null, effectOverride: null, binderId: 'fixture', sourceSetId: 'fixture',
  sourceCardId: 'fixture-025', binderSetKey: 'fixture', binderName: 'Testbinder', binderHeroAsset: null,
};
let collectionNext: (entries: CollectionEntry[]) => void;
const authFor = (owner: typeof user) => ({ user: owner, loading: false, isAdmin: false, hasAppAccess: true, accessError: null,
  logout: vi.fn(), refreshClaims: vi.fn(), signIn: vi.fn() } as unknown as ReturnType<typeof useAuth>);
const binderTree = (owner = user) => <BinderView binders={[{ id: 'fixture', name: 'Testbinder', sourceSetId: 'fixture', entries: [] }]}
  prices={{}} user={owner} onError={binderError} />;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No external network in partial-add fixtures')));
  vi.mocked(useAuth).mockReturnValue(authFor(user));
  vi.mocked(useCollectionPrices).mockReturnValue({ prices: {}, priceSources: {}, selections: {},
    selectionSyncFailed: false, failed: new Set(), pending: 0, retry: vi.fn() });
  // An acknowledged write may precede the next listener delivery. Retain the old
  // snapshot to exercise the real UI's unsafe retry window, not a backend failure.
  vi.mocked(subscribeCollection).mockImplementation((_user, next) => { collectionNext = next; next([]); return vi.fn(); });
  vi.mocked(addExactCard).mockResolvedValue(null);
  vi.mocked(saveCollectionPriceSelection).mockResolvedValue(undefined);
  vi.mocked(loadCard).mockResolvedValue(detail);
  vi.mocked(loadSet).mockResolvedValue({ id: 'fixture', name: 'Testset', cards: [summary] });
  vi.mocked(searchCards).mockResolvedValue([summary]);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function open(flow: Flow) {
  let rendered;
  if (flow === 'search') {
    rendered = render(<WebApp />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Web-App Navigation' }))
      .getByRole('button', { name: 'Karte hinzufügen' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Kartenname suchen' }), { target: { value: 'Testkarte' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*#025.*fixture-025/ }));
  } else {
    rendered = render(binderTree());
    fireEvent.click(screen.getByRole('button', { name: /DOMIDEX BINDER/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*Normal.*fehlt/ }));
  }
  const selector = await screen.findByRole('combobox', { name: 'Preiskennzahl' });
  if (!(selector instanceof HTMLSelectElement)) throw new Error('Price metric control must be a select element.');
  await waitFor(() => expect(selector.disabled).toBe(false));
  fireEvent.change(selector, { target: { value: 'normal_avg_sell' } });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Fürs Hinzufügen auswählen' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Fürs Hinzufügen auswählen' }));
  await screen.findByText('Für diese Karte vorgemerkt; gespeichert wird beim Hinzufügen.');
  expect(addExactCard).not.toHaveBeenCalled();
  expect(saveCollectionPriceSelection).not.toHaveBeenCalled();
  return rendered;
}

async function addThenWaitForPartialFailure() {
  fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
  await waitFor(() => expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(1));
  await waitFor(() => {
    const action = screen.queryByRole('button', { name: /Preisauswahl erneut speichern|Zur Sammlung hinzufügen/ });
    expect(action).not.toBeNull();
    expect((action as HTMLButtonElement).disabled).toBe(false);
  });
  expect(addExactCard).toHaveBeenCalledExactlyOnceWith(user, detail, variant, 1, []);
  expect(saveCollectionPriceSelection).toHaveBeenCalledWith(user, 'synthetic-added-entry', expect.objectContaining({
    productId: 101, metric: 'normal_avg_sell', amountMinor: 444, currency: 'EUR',
  }));
}

describe.each<Flow>(['search', 'binder'])('%s: collection write succeeds but its optional price selection fails', flow => {
  it('reports the successful card add separately from the failed price selection', async () => {
    vi.mocked(saveCollectionPriceSelection).mockRejectedValueOnce(new Error('synthetic-sidecar-write-failed'));
    await open(flow);
    await addThenWaitForPartialFailure();
    expect(screen.queryByText(partialMessage)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Preisauswahl erneut speichern' })).not.toBeNull();
    expect(changeQuantity).not.toHaveBeenCalled();
  });

  it('retries only the price sidecar and never adds the acknowledged quantity twice', async () => {
    vi.mocked(saveCollectionPriceSelection).mockRejectedValueOnce(new Error('synthetic-sidecar-write-failed'));
    await open(flow);
    await addThenWaitForPartialFailure();
    // Exercise the actual action exposed to a retrying user on either version:
    // old UI exposes Add again; corrected UI must expose a sidecar-only retry.
    const retry = screen.queryByRole('button', { name: 'Preisauswahl erneut speichern' })
      ?? screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' });
    fireEvent.click(retry);
    await waitFor(() => expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(2));
    expect(addExactCard).toHaveBeenCalledTimes(1);
    expect(changeQuantity).not.toHaveBeenCalled();
    expect(vi.mocked(saveCollectionPriceSelection).mock.calls[1])
      .toEqual(vi.mocked(saveCollectionPriceSelection).mock.calls[0]);
  });

  it('retains the existing happy path with one explicit card write and one selected sidecar', async () => {
    await open(flow);
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(1));
    expect(addExactCard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addExactCard).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(saveCollectionPriceSelection).mock.invocationCallOrder[0]);
    if (flow === 'binder') await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    else expect(await screen.findByText(/Testkarte wurde synchronisiert/)).toBeTruthy();
    expect(binderError).not.toHaveBeenCalled();
  });

  it('does not write a price for a failed card add and allows a real card retry', async () => {
    vi.mocked(addExactCard).mockRejectedValueOnce(new Error('synthetic-card-write-failed'));
    await open(flow);
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(addExactCard).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }) as HTMLButtonElement).disabled).toBe(false));
    expect(saveCollectionPriceSelection).not.toHaveBeenCalled();
    expect(screen.queryByText(partialMessage)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(1));
    expect(addExactCard).toHaveBeenCalledTimes(2);
  });

  it('keeps a repeatedly failing sidecar retry pinned to the original target', async () => {
    vi.mocked(saveCollectionPriceSelection).mockRejectedValue(new Error('synthetic-sidecar-write-failed'));
    await open(flow);
    await addThenWaitForPartialFailure();
    const original = vi.mocked(saveCollectionPriceSelection).mock.calls[0];
    for (let attempt = 2; attempt <= 3; attempt++) {
      fireEvent.click(screen.getByRole('button', { name: 'Preisauswahl erneut speichern' }));
      await waitFor(() => expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(attempt));
      await screen.findByText(partialMessage);
      expect(vi.mocked(saveCollectionPriceSelection).mock.calls[attempt - 1]).toEqual(original);
    }
    expect(addExactCard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Zur Sammlung hinzufügen' })).toBeNull();
  });

  it('guards rapid same-batch double clicks for both the card and the sidecar retry', async () => {
    const first = deferred<number | null>();
    const retry = deferred<void>();
    vi.mocked(addExactCard).mockReturnValueOnce(first.promise);
    vi.mocked(saveCollectionPriceSelection).mockRejectedValueOnce(new Error('synthetic-sidecar-write-failed'))
      .mockReturnValueOnce(retry.promise);
    await open(flow);
    const addButton = screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' });
    act(() => { fireEvent.click(addButton); fireEvent.click(addButton); });
    expect(addExactCard).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(null); });
    await screen.findByText(partialMessage);
    const retryButton = screen.getByRole('button', { name: 'Preisauswahl erneut speichern' });
    act(() => { fireEvent.click(retryButton); fireEvent.click(retryButton); });
    expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(2);
    expect(addExactCard).toHaveBeenCalledTimes(1);
    await act(async () => { retry.resolve(undefined); });
  });

  it.each(['card', 'sidecar'] as const)('ignores late %s completion after unmount', async stage => {
    const pending = deferred<null>();
    if (stage === 'card') vi.mocked(addExactCard).mockReturnValueOnce(pending.promise);
    else vi.mocked(saveCollectionPriceSelection).mockImplementationOnce(async () => { await pending.promise; });
    const rendered = await open(flow);
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    if (stage === 'sidecar') await waitFor(() => expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(1));
    rendered.unmount();
    await act(async () => { pending.resolve(null); });
    expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(stage === 'card' ? 0 : 1);
    expect(addExactCard).toHaveBeenCalledTimes(1);
    expect(binderError).not.toHaveBeenCalled();
    expect(screen.queryByText(partialMessage)).toBeNull();
  });

  it.each(['card', 'sidecar'] as const)('rejects late %s results from an observed account A–B–A generation', async stage => {
    const pending = deferred<null>();
    if (stage === 'card') vi.mocked(addExactCard).mockReturnValueOnce(pending.promise);
    else vi.mocked(saveCollectionPriceSelection).mockImplementationOnce(async () => { await pending.promise; });
    const rendered = await open(flow);
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    if (stage === 'sidecar') await waitFor(() => expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(1));
    const other = { ...user, uid: 'synthetic-other' };
    for (const owner of [other, user]) {
      vi.mocked(useAuth).mockReturnValue(authFor(owner));
      rendered.rerender(flow === 'search' ? <WebApp /> : binderTree(owner));
    }
    await act(async () => { pending.reject(new Error('stale-owner-error')); });
    expect(screen.queryByText(/stale-owner-error|Testkarte wurde synchronisiert/)).toBeNull();
    expect(screen.queryByText(partialMessage)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preisauswahl erneut speichern' })).toBeNull();
    expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(stage === 'card' ? 0 : 1);
    expect(binderError).not.toHaveBeenCalled();
  });

  it('requires a fresh explicit price choice after the account changes', async () => {
    const rendered = await open(flow);
    const other = { ...user, uid: 'synthetic-other' };
    vi.mocked(useAuth).mockReturnValue(authFor(other));
    rendered.rerender(flow === 'search' ? <WebApp /> : binderTree(other));
    expect(screen.queryByText('Für diese Karte vorgemerkt; gespeichert wird beim Hinzufügen.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(addExactCard).toHaveBeenCalledTimes(1));
    expect(vi.mocked(addExactCard).mock.calls[0][0].uid).toBe(other.uid);
    expect(saveCollectionPriceSelection).not.toHaveBeenCalled();
  });
});

describe('actual WebApp collection callback during optional price retry', () => {
  it.each<Flow>(['search', 'binder'])('preserves the retry when the %s card becomes owned in the listener', async flow => {
    const retry = deferred<void>();
    vi.mocked(saveCollectionPriceSelection).mockRejectedValueOnce(new Error('synthetic-sidecar-write-failed'))
      .mockReturnValueOnce(retry.promise);
    const anchor = { ...savedEntry, syncId: 'anchor', sourceCardId: 'fixture-001', collectorNumber: '001', name: 'Ankerkarte' };
    if (flow === 'search') await open(flow);
    else {
      vi.mocked(subscribeCollection).mockImplementation((_user, next) => { collectionNext = next; next([anchor]); return vi.fn(); });
      render(<WebApp />);
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Web-App Navigation' })).getByRole('button', { name: 'Binder' }));
      fireEvent.click(screen.getByRole('button', { name: /DOMIDEX BINDER/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*Normal.*fehlt/ }));
      fireEvent.change(await screen.findByRole('combobox', { name: 'Preiskennzahl' }), { target: { value: 'normal_avg_sell' } });
      fireEvent.click(screen.getByRole('button', { name: 'Fürs Hinzufügen auswählen' }));
      await screen.findByText('Für diese Karte vorgemerkt; gespeichert wird beim Hinzufügen.');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await screen.findByText(partialMessage);
    fireEvent.click(screen.getByRole('button', { name: 'Preisauswahl erneut speichern' }));
    await waitFor(() => expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(2));
    act(() => collectionNext([...(flow === 'binder' ? [anchor] : []), savedEntry]));
    expect(screen.getByRole('button', { name: 'Preisauswahl erneut speichern' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zur Sammlung hinzufügen' })).toBeNull();
    await act(async () => { retry.resolve(undefined); });
    expect(addExactCard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveCollectionPriceSelection).mock.calls[1]).toEqual(vi.mocked(saveCollectionPriceSelection).mock.calls[0]);
    if (flow === 'binder') expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('search context changes during an acknowledged card add', () => {
  it('does not display an old confirmation after the same card is selected again', async () => {
    await open('search');
    fireEvent.click(screen.getByRole('button', { name: /Testkarte.*#025.*fixture-025/ }));
    await waitFor(() => expect(vi.mocked(loadCard)).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Für diese Karte vorgemerkt; gespeichert wird beim Hinzufügen.')).toBeNull();
    expect(saveCollectionPriceSelection).not.toHaveBeenCalled();
    expect(addExactCard).not.toHaveBeenCalled();
  });

  it('drops a pending price target on variant change and never applies it to the new printing', async () => {
    const pending = deferred<void>();
    const otherVariant: TcgVariant = { ...variant, type: 'Holo', variantId: 'holo-print',
      pricing: { cardmarket: { ...variant.pricing!.cardmarket!, idProduct: 202 } } };
    vi.mocked(loadCard).mockResolvedValue({ ...detail, variants_detailed: [variant, otherVariant] });
    vi.mocked(saveCollectionPriceSelection).mockReturnValueOnce(pending.promise);
    await open('search');
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('combobox', { name: 'Variante' }), { target: { value: '1' } });
    await act(async () => { pending.reject(new Error('stale-printing-error')); });
    expect(screen.queryByRole('button', { name: 'Preisauswahl erneut speichern' })).toBeNull();
    expect(screen.queryByText(/stale-printing-error|Testkarte wurde synchronisiert/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(addExactCard).toHaveBeenCalledTimes(2));
    expect(vi.mocked(addExactCard).mock.calls[1][2]).toEqual(otherVariant);
    // A choice confirmed for the former printing is not an implicit confirmation here.
    expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(1);
  });

  it('invalidates old success as soon as another card is selected, even while its details are loading', async () => {
    const oldPrice = deferred<void>();
    const newDetail = deferred<TcgCardDetail>();
    const otherSummary = { ...summary, id: 'fixture-026', localId: '026', name: 'Anderekarte' };
    vi.mocked(searchCards).mockResolvedValue([summary, otherSummary]);
    vi.mocked(loadCard).mockResolvedValueOnce(detail).mockReturnValueOnce(newDetail.promise);
    vi.mocked(saveCollectionPriceSelection).mockReturnValueOnce(oldPrice.promise);
    await open('search');
    fireEvent.click(screen.getByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Anderekarte.*#026.*fixture-026/ }));
    await act(async () => { oldPrice.resolve(undefined); });
    expect(screen.queryByText(/Testkarte wurde synchronisiert/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preisauswahl erneut speichern' })).toBeNull();
    await act(async () => { newDetail.resolve({ ...detail, ...otherSummary }); });
    expect(screen.queryByText(/Testkarte wurde synchronisiert/)).toBeNull();
    expect(addExactCard).toHaveBeenCalledTimes(1);
    expect(saveCollectionPriceSelection).toHaveBeenCalledTimes(1);
  });
});
