// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateBinderGallery } from '@/components/private-binder-gallery';
import type { CollectionEntry } from '@/lib/domain';
import type { CardEffectConfig } from '@/lib/card-profile-visual';
import { ownerSnapshotSequence, type OwnerTestSnapshot } from './helpers/owner-snapshot';

type Raw = Record<string, unknown>;
type Listener = { path: string; next: (value: OwnerTestSnapshot) => void; error: () => void; stop: ReturnType<typeof vi.fn> };
const firebase = vi.hoisted(() => ({ listeners: [] as Listener[], collection: vi.fn(), onSnapshot: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('firebase/firestore', () => firebase);
vi.mock('@/lib/firebase-client', () => ({ firestore: { fixture: true } }));
vi.mock('@/components/shared-binder-material', () => ({ SharedBinderMaterial: ({ effect, intensity = 0, cover = false }: { effect: string; intensity?: number; cover?: boolean }) => <span data-testid={cover ? 'cover-material' : 'placement-material'} data-material-id={effect} data-intensity={intensity} /> }));
vi.mock('@/components/card-profile-material', () => ({ CardProfileMaterial: ({ profile }: { profile: CardEffectConfig }) => profile.profile === 'NONE' ? null : <span data-testid="profile-material" data-profile-id={profile.profile} /> }));

const uid = 'owner-a';
const owned: CollectionEntry = Object.freeze({
  syncId: 'exact-entry', ownerUid: uid, revision: 1, lastMutationId: 'mutation', updatedAtClient: 1, deleted: false, deletedAtClient: null,
  name: 'Gespeicherte Karte', setId: 'test', setName: 'Testset', collectorNumber: '025', language: 'GERMAN', finish: 'Normal', variant: 'Standard', rarity: 'Common', quantity: 2,
  condition: 'Near Mint', notes: '', acquisitionPriceMinor: null, acquisitionCurrency: null, acquisitionDateEpochDay: null, externalProductSource: 'cardmarket', externalProductId: 101,
  imageUrl: 'https://assets.tcgdex.net/test/025/high.webp', effectOverride: 'FULL_GOLD', binderId: 'set-binder', sourceSetId: 'test', sourceCardId: 'test-025', binderSetKey: 'test', binderName: 'Testset', binderHeroAsset: null,
});
const binder = (extra: Raw = {}): Raw => ({ binderId: 'binder-a', ownerUid: uid, revision: 1, deleted: false, name: 'Privater Testbinder', coverStyle: 'galaxy', minimumPageCount: 2, ...extra });
const placement = (extra: Raw = {}): Raw => ({ placementId: 'placement-a', ownerUid: uid, revision: 1, deleted: false, binderId: 'binder-a', entrySyncId: owned.syncId, slotPosition: 0, holoEffectId: 'galaxy', holoIntensity: .72, ...extra });
let sequences = new WeakMap<Listener, ReturnType<typeof ownerSnapshotSequence>>();
const emit = (listener: Listener, records: Raw[], id: string) => {
  if (!sequences.has(listener)) sequences.set(listener, ownerSnapshotSequence(id));
  listener.next(sequences.get(listener)!(records));
};
async function loaded(placements = [placement()], binders = [binder()], entries = [owned]) {
  const rendered = render(<PrivateBinderGallery user={{ uid }} entries={entries} prices={{ [owned.syncId]: 12.34 }} />);
  await waitFor(() => expect(firebase.listeners).toHaveLength(2));
  act(() => { emit(firebase.listeners[0], binders, 'binderId'); emit(firebase.listeners[1], placements, 'placementId'); });
  return rendered;
}

beforeEach(() => {
  sequences = new WeakMap();
  vi.clearAllMocks(); firebase.listeners.length = 0;
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No network permitted')));
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  firebase.collection.mockImplementation((_store: unknown, ...path: string[]) => path.join('/'));
  firebase.onSnapshot.mockImplementation((path: string, next: Listener['next'], error: Listener['error']) => {
    const stop = vi.fn(); firebase.listeners.push({ path, next, error, stop }); return stop;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('read-only private binder gallery', () => {
  it('opens the exact saved printing, preserves its material and price, and writes nothing', async () => {
    await loaded([placement()], [binder()], [{ ...owned, syncId: 'other-print', name: 'Andere Druckvariante', effectOverride: 'NONE' }, owned]);
    const group = screen.getByRole('group', { name: 'Privater Binder Privater Testbinder, Seite 1' });
    expect(group.children).toHaveLength(9);
    expect(within(group).queryByText('Andere Druckvariante')).toBeNull();
    const opener = within(group).getByRole('button', { name: 'Gespeicherte Karte, Platz 1, groß ansehen' });
    act(() => opener.focus()); fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: owned.name });
    expect(within(dialog).getByTestId('placement-material').dataset).toMatchObject({ materialId: 'galaxy', intensity: '0.72' });
    expect(within(dialog).queryByTestId('profile-material')).toBeNull();
    expect(within(dialog).getByText('Normal · Standard')).toBeTruthy();
    expect(within(dialog).getByText(/12,34/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /Menge|Löschen|Hinzufügen|Speichern|Freigeben/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Großansicht' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(dialog.classList.contains('card-dialog--expanded')).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
    for (const write of [firebase.setDoc, firebase.updateDoc, firebase.deleteDoc, fetch]) expect(write).not.toHaveBeenCalled();
    expect(owned).toMatchObject({ syncId: 'exact-entry', quantity: 2, effectOverride: 'FULL_GOLD', finish: 'Normal' });
  });

  it.each([
    { id: null, intensity: 0, profile: 'FULL_GOLD', material: null },
    { id: 'none', intensity: 0, profile: null, material: null },
    { id: 'galaxy', intensity: 0, profile: null, material: 'galaxy' },
    { id: 'future-material', intensity: .7, profile: null, material: null },
  ])('preserves saved effect $id at strength $intensity in the modal', async ({ id, intensity, profile, material }) => {
    await loaded([placement({ holoEffectId: id, holoIntensity: intensity })]);
    const grid = screen.getByRole('group');
    expect(within(grid).queryByTestId('profile-material')?.getAttribute('data-profile-id') ?? null).toBe(profile);
    expect(within(grid).queryByTestId('placement-material')?.getAttribute('data-material-id') ?? null).toBe(material);
    fireEvent.click(screen.getByRole('button', { name: /Gespeicherte Karte, Platz 1, groß ansehen/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByTestId('profile-material')?.getAttribute('data-profile-id') ?? null).toBe(profile);
    expect(within(dialog).queryByTestId('placement-material')?.getAttribute('data-material-id') ?? null).toBe(material);
    if (material) expect(within(dialog).getByTestId('placement-material').dataset.intensity).toBe('0');
    if (id === 'future-material') expect(within(dialog).getByText(/noch nicht verfügbar/)).toBeTruthy();
  });

  it('shows only nine slots per page, preserves gaps and distinguishes missing card data', async () => {
    await loaded([placement({ slotPosition: 9 }), placement({ placementId: 'missing', slotPosition: 1, entrySyncId: 'unavailable' })]);
    let group = screen.getByRole('group');
    expect(group.children).toHaveLength(9);
    expect(within(group).getByLabelText('Platz 1: frei')).toBeTruthy();
    expect(within(group).getByLabelText('Platz 2: Kartendaten nicht verfügbar')).toBeTruthy();
    expect(within(group).queryByRole('button', { name: /Gespeicherte Karte/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nächste private Binderseite' }));
    group = screen.getByRole('group');
    expect(group.children).toHaveLength(9);
    expect(within(group).getByRole('button', { name: /Gespeicherte Karte, Platz 10/ })).toBeTruthy();
    expect(screen.getByText('Seite 2 / 2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Nächste private Binderseite' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('clears old account state immediately, detaches listeners and ignores stale callbacks', async () => {
    const { rerender } = await loaded();
    fireEvent.click(screen.getByRole('button', { name: /Gespeicherte Karte, Platz 1/ }));
    const old = firebase.listeners.slice();
    rerender(<PrivateBinderGallery user={{ uid: 'owner-b' }} entries={[owned]} prices={{}} />);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText('Privater Testbinder')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('werden geladen');
    for (const listener of old) expect(listener.stop).toHaveBeenCalledOnce();
    await waitFor(() => expect(firebase.listeners).toHaveLength(4));
    act(() => { emit(old[0], [binder()], 'binderId'); emit(old[1], [placement()], 'placementId'); });
    expect(screen.queryByText('Privater Testbinder')).toBeNull();
    act(() => { emit(firebase.listeners[2], [binder({ ownerUid: 'owner-b', name: 'Neuer Besitzer' })], 'binderId'); emit(firebase.listeners[3], [placement({ ownerUid: 'owner-b' })], 'placementId'); });
    expect(screen.queryByRole('button', { name: /Gespeicherte Karte/ })).toBeNull();
    expect(screen.getByLabelText('Platz 1: Kartendaten nicht verfügbar')).toBeTruthy();
  });

  it('removes private content on failure and can retry without retaining the selected card', async () => {
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /Gespeicherte Karte, Platz 1/ }));
    act(() => firebase.listeners[1].error());
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText('Privater Testbinder')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('konnten nicht geladen');
    for (const listener of firebase.listeners) expect(listener.stop).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
    await waitFor(() => expect(firebase.listeners).toHaveLength(4));
    act(() => { emit(firebase.listeners[2], [binder()], 'binderId'); emit(firebase.listeners[3], [placement()], 'placementId'); });
    expect(screen.getByRole('button', { name: /Gespeicherte Karte, Platz 1/ })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cleans up a subscription that finishes after unmount and handles registration failure', async () => {
    const { unmount } = render(<PrivateBinderGallery user={{ uid }} entries={[owned]} prices={{}} />);
    unmount();
    await waitFor(() => expect(firebase.listeners).toHaveLength(2));
    await waitFor(() => firebase.listeners.forEach((listener) => expect(listener.stop).toHaveBeenCalledOnce()));
    firebase.onSnapshot.mockImplementationOnce(() => { throw new Error('listener failed'); });
    render(<PrivateBinderGallery user={{ uid }} entries={[owned]} prices={{}} />);
    expect(await screen.findByRole('button', { name: 'Erneut laden' })).toBeTruthy();
  });

  it('closes selected cards on deletion and resets page when switching binders', async () => {
    await loaded([placement({ slotPosition: 9 })], [binder(), binder({ binderId: 'binder-b', name: 'Zweiter Binder' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Nächste private Binderseite' }));
    fireEvent.click(screen.getByRole('button', { name: /Gespeicherte Karte, Platz 10/ }));
    act(() => emit(firebase.listeners[1], [placement({ deleted: true, slotPosition: 9 })], 'placementId'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Privaten Binder ansehen' }), { target: { value: 'binder-b' } });
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Privater Binder Zweiter Binder, Seite 1');
  });
});
