// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebApp } from '@/components/web-app';
import { useCollectionLayouts } from '@/components/use-collection-layouts';
import type { CollectionEntry } from '@/lib/domain';
import type { SetBinderVisibility } from '@/lib/collection-layouts';

type LayoutListener = { uid: string; next: (visibility: SetBinderVisibility) => void; fail: () => void; stop: ReturnType<typeof vi.fn> };
const state = vi.hoisted(() => ({
  user: { uid: 'owner-a', displayName: 'Sammler' } as { uid: string; displayName: string } | null,
  access: true,
  entries: [] as CollectionEntry[],
  layouts: [] as LayoutListener[],
  subscribe: vi.fn(),
  privateEntries: [] as CollectionEntry[],
  pricedEntries: [] as CollectionEntry[],
  add: vi.fn(),
}));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: state.user, loading: false, hasAppAccess: state.access, isAdmin: false, logout: vi.fn(), signIn: vi.fn(), refreshClaims: vi.fn() }) }));
vi.mock('@/components/use-collection-prices', () => ({ useCollectionPrices: (entries: CollectionEntry[]) => { state.pricedEntries = entries; return { prices: { hidden: 10, visible: 20 }, failed: new Set(), pending: 0, retry: vi.fn() }; } }));
vi.mock('@/lib/collection', () => ({
  addExactCard: state.add, changeQuantity: vi.fn(),
  collectionSyncIdForExactCard: () => 'fixture-sync-id',
  subscribeCollection: (_user: unknown, next: (entries: CollectionEntry[]) => void) => { next(state.entries); return vi.fn(); },
}));
vi.mock('@/lib/collection-layouts', async (original) => ({ ...await original<typeof import('@/lib/collection-layouts')>(), subscribeCollectionLayouts: state.subscribe }));
vi.mock('@/components/private-binder-gallery', () => ({ PrivateBinderGallery: ({ entries }: { entries: CollectionEntry[] }) => { state.privateEntries = entries; return <div data-testid="private-candidates">{entries.map((entry) => entry.syncId).join(',')}</div>; } }));
vi.mock('@/components/binder-sharing-owner', () => ({ BinderSharingOwner: () => null }));
vi.mock('@/lib/tcgdex', () => ({
  loadSet: vi.fn().mockResolvedValue({ id: 'test', name: 'Testset', cardCount: { official: 10 }, cards: [{ id: 'test-001', localId: '001', name: 'Ausgeblendet' }, { id: 'test-002', localId: '002', name: 'Sichtbar' }] }),
  loadCard: vi.fn().mockResolvedValue({ id: 'test-001', localId: '001', name: 'Ausgeblendet', set: { id: 'test', name: 'Testset' }, variants_detailed: [{ type: 'Normal', size: 'Standard' }] }),
  imageUrl: (url: string) => url,
}));

const entry = (syncId: string, collectorNumber: string): CollectionEntry => ({
  syncId, ownerUid: 'owner-a', name: syncId === 'hidden' ? 'Ausgeblendet' : 'Sichtbar', setId: 'test', setName: 'Testset',
  collectorNumber, quantity: 1, finish: 'Normal', variant: 'Standard', binderId: 'test', binderName: 'Testset',
  sourceSetId: 'test', sourceCardId: `test-${collectorNumber}`, deleted: false, imageUrl: null,
} as CollectionEntry);

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { uid: 'owner-a', displayName: 'Sammler' }; state.access = true;
  state.entries = [entry('hidden', '001'), entry('visible', '002')];
  state.layouts.length = 0; state.privateEntries = []; state.pricedEntries = [];
  state.subscribe.mockImplementation(async (uid: string, next: LayoutListener['next'], fail: LayoutListener['fail']) => {
    const stop = vi.fn(); state.layouts.push({ uid, next, fail, stop }); return stop;
  });
});
afterEach(cleanup);

describe('collection layouts in the Web app', () => {
  it('reflects hide and restore events in set binders while keeping portfolio, collection, and private binder candidates complete', async () => {
    render(<WebApp />);
    await waitFor(() => expect(state.layouts).toHaveLength(1));
    act(() => state.layouts[0].next(new Map([['hidden', false]])));
    const nav = within(screen.getByRole('navigation', { name: 'Web-App Navigation' }));
    fireEvent.click(nav.getByRole('button', { name: 'Binder' }));
    fireEvent.click(screen.getByRole('button', { name: /DOMIDEX BINDER/ }));
    await screen.findByRole('button', { name: /Ausgeblendet.*fehlt/ });
    expect(screen.getByRole('button', { name: /Sichtbar.*×1/ })).toBeDefined();
    expect(state.privateEntries).toEqual(state.entries);
    expect(state.pricedEntries).toEqual(state.entries);
    act(() => state.layouts[0].next(new Map([['hidden', true]])));
    expect(screen.getByRole('button', { name: /Ausgeblendet.*×1/ })).toBeDefined();
    act(() => state.layouts[0].next(new Map([['hidden', false], ['visible', false]])));
    expect(screen.queryByRole('button', { name: /DOMIDEX BINDER/ })).toBeNull();
    expect(state.privateEntries).toEqual(state.entries);
    fireEvent.click(nav.getByRole('button', { name: 'Sammlung' }));
    expect(screen.getByText('2 Karten in 1 Sets')).toBeDefined();
    fireEvent.click(nav.getByRole('button', { name: 'Portfolio' }));
    expect(screen.getByRole('heading', { level: 1, name: /30,00/ })).toBeDefined();
    expect(state.add).not.toHaveBeenCalled();
  });

  it('retains hidden entries for duplicate-printing checks when adding from an empty set pocket', async () => {
    render(<WebApp />);
    await waitFor(() => expect(state.layouts).toHaveLength(1));
    act(() => state.layouts[0].next(new Map([['hidden', false]])));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Web-App Navigation' })).getByRole('button', { name: 'Binder' }));
    fireEvent.click(screen.getByRole('button', { name: /DOMIDEX BINDER/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Ausgeblendet.*fehlt/ }));
    fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Zur Sammlung hinzufügen' }));
    await waitFor(() => expect(state.add).toHaveBeenCalled());
    expect(state.add.mock.calls[0][4]).toEqual(state.entries);
  });

  it('starts no layout listener without confirmed app access and cleans it up on access loss', async () => {
    state.access = false;
    const { rerender } = render(<WebApp />);
    expect(state.subscribe).not.toHaveBeenCalled();
    state.access = true; rerender(<WebApp />);
    await waitFor(() => expect(state.layouts).toHaveLength(1));
    state.access = false; rerender(<WebApp />);
    await waitFor(() => expect(state.layouts[0].stop).toHaveBeenCalledOnce());
    state.user = null; rerender(<WebApp />);
    expect(state.layouts).toHaveLength(1);
  });
});

describe('collection layout listener lifecycle', () => {
  it('clears owner state and ignores late snapshots after account changes and unmount', async () => {
    const { result, rerender, unmount } = renderHook(({ uid }) => useCollectionLayouts(uid), { initialProps: { uid: 'owner-a' } });
    await waitFor(() => expect(state.layouts).toHaveLength(1));
    act(() => state.layouts[0].next(new Map([['hidden', false]])));
    expect(result.current.visibility.get('hidden')).toBe(false);
    rerender({ uid: 'owner-b' });
    expect(result.current.visibility.size).toBe(0);
    await waitFor(() => expect(state.layouts[0].stop).toHaveBeenCalledOnce());
    act(() => state.layouts[0].next(new Map([['stale', false]])));
    expect(result.current.visibility.size).toBe(0);
    act(() => state.layouts[1].next(new Map([['current', false]])));
    expect(result.current.visibility.get('current')).toBe(false);
    unmount(); expect(state.layouts[1].stop).toHaveBeenCalledOnce();
  });

  it('unsubscribes when an asynchronous registration finishes after unmount', async () => {
    let finish!: (stop: () => void) => void;
    state.subscribe.mockReturnValue(new Promise<() => void>((resolve) => { finish = resolve; }));
    const { unmount } = renderHook(() => useCollectionLayouts('owner-a'));
    unmount();
    const stop = vi.fn(); await act(async () => finish(stop));
    expect(stop).toHaveBeenCalledOnce();
  });

  it('retains the last layout and exposes a failed sync without revealing hidden cards again', async () => {
    const { result } = renderHook(() => useCollectionLayouts('owner-a'));
    await waitFor(() => expect(state.layouts).toHaveLength(1));
    act(() => state.layouts[0].next(new Map([['hidden', false]])));
    act(() => state.layouts[0].fail());
    expect(result.current.failed).toBe(true);
    expect(result.current.visibility.get('hidden')).toBe(false);
  });
});
