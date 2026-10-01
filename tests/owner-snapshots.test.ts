import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { subscribeCollection } from '@/lib/collection';
import { subscribeCollectionLayouts } from '@/lib/collection-layouts';
import { subscribeCollectionPriceSelections } from '@/lib/collection-price-selections';
import { subscribePrivateBinderView } from '@/lib/private-binder-view';
import { ownerDocumentState } from '@/lib/owner-document-state';
import { ownerSnapshotSequence, type OwnerTestSnapshot, type RawOwnerRecord } from './helpers/owner-snapshot';

type Listener = { path: string; next: (snapshot: OwnerTestSnapshot) => void; fail: (error: Error) => void; stop: ReturnType<typeof vi.fn> };
const firebase = vi.hoisted(() => ({ listeners: [] as Listener[], collection: vi.fn(), onSnapshot: vi.fn(), doc: vi.fn(), runTransaction: vi.fn(), serverTimestamp: vi.fn() }));
vi.mock('firebase/firestore', () => firebase);
vi.mock('@/lib/firebase-client', () => ({ firestore: {} }));
const uid = 'owner-a';
const common = { ownerUid: uid, revision: 1, updatedAtClient: 100, deleted: false, lastMutationId: 'mutation-1' };
const collectionRow = (id: string, extra: RawOwnerRecord = {}) => ({ ...common, syncId: id, name: id, sourceSetId: null, sourceCardId: null, quantity: 1, ...extra });
const binderRow = (id: string, extra: RawOwnerRecord = {}) => ({ ...common, binderId: id, name: 'Gleicher Name', coverStyle: 'galaxy', minimumPageCount: 1, ...extra });
const placementRow = (id: string, extra: RawOwnerRecord = {}) => ({ ...common, placementId: id, binderId: 'binder', entrySyncId: 'entry', slotPosition: 0, holoEffectId: 'galaxy', holoIntensity: .5, ...extra });
const layoutRow = (id: string, extra: RawOwnerRecord = {}) => ({ ...common, entrySyncId: id, visibleInSetBinder: false, ...extra });
const selectionRow = (id: string, extra: RawOwnerRecord = {}) => ({
  ...common, schemaVersion: 1, entrySyncId: id, cleared: true,
  sourceSetId: null, sourceCardId: null, collectorNumber: null, language: null, finish: null, variant: null,
  productId: null, metric: null, amountMinor: null, currency: null, sourceAt: null, selectedAt: null, ...extra,
});
const cases = [
  { path: 'collectionEntries', field: 'syncId', row: collectionRow },
  { path: 'collectionLayouts', field: 'entrySyncId', row: layoutRow },
  { path: 'collectionPriceSelections', field: 'entrySyncId', row: selectionRow },
  { path: 'privateBinders', field: 'binderId', row: binderRow },
  { path: 'privateBinderPlacements', field: 'placementId', row: placementRow },
] as const;

beforeEach(() => {
  vi.clearAllMocks(); firebase.listeners.length = 0;
  firebase.collection.mockImplementation((_store: unknown, ...path: string[]) => path.join('/'));
  firebase.onSnapshot.mockImplementation((path: string, next: Listener['next'], fail: Listener['fail']) => {
    const stop = vi.fn(); firebase.listeners.push({ path, next, fail, stop }); return stop;
  });
});

async function subscribe(path: string, owner = uid) {
  const next = vi.fn(), fail = vi.fn();
  let stop: () => void;
  if (path === 'collectionEntries') stop = subscribeCollection({ uid: owner } as User, next, fail);
  else if (path === 'collectionLayouts') stop = await subscribeCollectionLayouts(owner, next, fail);
  else if (path === 'collectionPriceSelections') stop = await subscribeCollectionPriceSelections(owner, next, fail);
  else stop = await subscribePrivateBinderView(owner, next, fail);
  const listener = firebase.listeners.findLast((item) => item.path === `users/${owner}/${path}`)!;
  const other = firebase.listeners.findLast((item) => item.path.startsWith(`users/${owner}/private`) && item !== listener);
  if (path.startsWith('private') && other) other.next({ docs: [], docChanges: () => [] });
  const value = () => {
    const last = next.mock.lastCall?.[0];
    if (path === 'privateBinders') return last?.binders;
    if (path === 'privateBinderPlacements') return last?.placements;
    return last;
  };
  const values = (): unknown[] => { const current = value(); return current instanceof Map ? [...current.values()] : Array.isArray(current) ? current : Object.values(current ?? {}); };
  const keys = (): string[] => {
    const current = value();
    if (current instanceof Map) return [...current.keys()];
    if (!Array.isArray(current)) return Object.keys(current ?? {});
    return current.map((item) => item.syncId ?? item.placementId ?? item.binderId);
  };
  return { listener, next, fail, stop, value, values, keys };
}

describe.each(cases)('incremental owner snapshot: $path', ({ path, field, row }) => {
  it('publishes an initially empty result once and skips later empty deltas', async () => {
    const state = await subscribe(path), snapshot = ownerSnapshotSequence(field);
    state.listener.next(snapshot([]));
    expect(state.next).toHaveBeenCalledOnce();
    expect(state.values()).toEqual([]);
    state.listener.next(snapshot([]));
    expect(state.next).toHaveBeenCalledOnce();
  });

  it('decodes only a changed document and preserves other identities and the previous published container', async () => {
    const state = await subscribe(path), snapshot = ownerSnapshotSequence(field);
    const initial = [row('a'), row('b'), row('c')];
    state.listener.next(snapshot(initial));
    const oldContainer = state.value(), oldValues = state.values();
    const changed = snapshot([initial[0], row('b', { revision: 2, updatedAtClient: 101, visibleInSetBinder: true }), initial[2]]);
    state.listener.next(changed);
    expect(changed.docs.map((item) => item.data.mock.calls.length)).toEqual([0, 1, 0]);
    expect(state.value()).not.toBe(oldContainer);
    expect(state.values()[0]).toBe(oldValues[0]);
    expect(state.values()[2]).toBe(oldValues[2]);
    expect(oldContainer instanceof Map ? [...oldContainer.values()] : Array.isArray(oldContainer) ? oldContainer : Object.values(oldContainer)).toEqual(oldValues);
    expect(state.keys()).toEqual(['a', 'b', 'c']);
  });

  it('removes old visible values for invalid modifications and removals while keeping raw-index order', async () => {
    const state = await subscribe(path), snapshot = ownerSnapshotSequence(field);
    state.listener.next(snapshot([row('b'), row('d'), row('f')]));
    const before = state.value();
    const changed = snapshot([row('a'), row('b', { ownerUid: 'other' }), row('c', { ownerUid: 'other' }), row('d'), row('e')]);
    state.listener.next(changed);
    expect(state.keys()).toEqual(['a', 'd', 'e']);
    expect(changed.docChanges().find((change) => change.type === 'removed')!.doc.data).not.toHaveBeenCalled();
    state.listener.next(snapshot([row('a'), row('b', { revision: 3 }), row('c', { ownerUid: 'other' }), row('d'), row('e')]));
    expect(state.keys()).toEqual(['a', 'b', 'd', 'e']);
    expect(before instanceof Map ? [...before.keys()] : Array.isArray(before) ? before.map((item) => item.syncId ?? item.placementId ?? item.binderId) : Object.keys(before)).toEqual(['b', 'd', 'f']);
  });

  it('applies authoritative lower-revision rollback and ignores callbacks after termination', async () => {
    const state = await subscribe(path), snapshot = ownerSnapshotSequence(field);
    state.listener.next(snapshot([row('a', { revision: 3, updatedAtClient: 300, visibleInSetBinder: true, name: 'Newer', slotPosition: 9 })]));
    state.listener.next(snapshot([row('a', { revision: 2, updatedAtClient: 200, visibleInSetBinder: false, name: 'Rollback', slotPosition: 0 })]));
    const current = state.values()[0];
    if (path === 'collectionLayouts') expect(current).toBe(false);
    else if (path === 'collectionPriceSelections') expect(current).toMatchObject({ revision: 2 });
    else if (path === 'privateBinderPlacements') expect(current).toMatchObject({ slotPosition: 0 });
    else expect(current).toMatchObject({ name: 'Rollback' });
    state.listener.fail(new Error('permission-denied'));
    const count = state.next.mock.calls.length;
    state.listener.next(snapshot([])); state.listener.fail(new Error('late'));
    expect(state.next).toHaveBeenCalledTimes(count);
    expect(state.fail).toHaveBeenCalledOnce();
    state.stop();
  });

  it('isolates two simultaneous owners and suppresses success after unsubscribe', async () => {
    const first = await subscribe(path), second = await subscribe(path, 'owner-b');
    const firstSnapshots = ownerSnapshotSequence(field), secondSnapshots = ownerSnapshotSequence(field);
    first.listener.next(firstSnapshots([row('a')]));
    second.listener.next(secondSnapshots([row('b', { ownerUid: 'owner-b' })]));
    expect(first.keys()).toEqual(['a']); expect(second.keys()).toEqual(['b']);
    first.stop(); first.listener.next(firstSnapshots([]));
    expect(first.keys()).toEqual(['a']); expect(second.keys()).toEqual(['b']);
    expect(first.listener.stop).toHaveBeenCalledOnce();
    second.stop();
  });

  it('does not publish an invalid-only change but retains its raw position for a later valid update', async () => {
    const state = await subscribe(path), snapshot = ownerSnapshotSequence(field);
    state.listener.next(snapshot([row('b')]));
    const before = state.value();
    state.listener.next(snapshot([row('a', { ownerUid: 'other' }), row('b')]));
    expect(state.next).toHaveBeenCalledOnce();
    expect(state.value()).toBe(before);
    state.listener.next(snapshot([row('a', { revision: 2 }), row('b')]));
    expect(state.keys()).toEqual(['a', 'b']);
  });
});

describe('SDK index and sidecar edge cases', () => {
  it('finishes an initial snapshot despite a throwing legacy decoder and recovers the repaired document', async () => {
    const state = await subscribe('collectionEntries'), snapshot = ownerSnapshotSequence('syncId');
    const initial = snapshot([collectionRow('a'), collectionRow('b', { name: { toString: 'invalid' } }), collectionRow('c')]);
    expect(() => state.listener.next(initial)).not.toThrow();
    expect(state.keys()).toEqual(['a', 'c']);
    expect(initial.docs[2].data).toHaveBeenCalledOnce();
    const first = state.values();
    state.listener.next(snapshot([collectionRow('a'), collectionRow('b', { name: 'Repaired', revision: 2 }), collectionRow('c')]));
    expect(state.keys()).toEqual(['a', 'b', 'c']);
    expect(state.values()[0]).toBe(first[0]);
    expect(state.values()[2]).toBe(first[1]);
    expect(state.values()[1]).toMatchObject({ name: 'Repaired' });
  });

  it('removes a newly invalid document but applies every following delta and later repair', async () => {
    const state = await subscribe('collectionEntries'), snapshot = ownerSnapshotSequence('syncId');
    state.listener.next(snapshot([collectionRow('a'), collectionRow('b'), collectionRow('c')]));
    const before = state.value();
    const changedRows = [collectionRow('a', { quantity: 2 }), collectionRow('b', { name: { toString: 'invalid' } }), collectionRow('c', { quantity: 3 }), collectionRow('d')];
    expect(() => state.listener.next(snapshot(changedRows))).not.toThrow();
    expect(state.keys()).toEqual(['a', 'c', 'd']);
    expect(state.values()[0]).toMatchObject({ quantity: 2 });
    expect(state.values()[1]).toMatchObject({ quantity: 3 });
    expect(before.map((value: { syncId: string }) => value.syncId)).toEqual(['a', 'b', 'c']);
    const repairedRows = [...changedRows]; repairedRows[1] = collectionRow('b', { name: 'Repaired', revision: 4 });
    state.listener.next(snapshot(repairedRows));
    expect(state.keys()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('isolates a throwing data read without losing subsequent SDK indices', () => {
    const update = ownerDocumentState((raw, id) => ({ id, quantity: raw.quantity }));
    const good = (id: string) => ({ id, data: () => ({ quantity: 1 }) });
    expect(update({ docChanges: () => [
      { type: 'added', doc: good('a'), oldIndex: -1, newIndex: 0 },
      { type: 'added', doc: { id: 'b', data: () => { throw new Error('unreadable fixture'); } }, oldIndex: -1, newIndex: 1 },
      { type: 'added', doc: good('c'), oldIndex: -1, newIndex: 2 },
    ] })!.map((value) => value.id)).toEqual(['a', 'c']);
    expect(update({ docChanges: () => [{ type: 'modified', doc: good('b'), oldIndex: 1, newIndex: 1 }] })!.map((value) => value.id)).toEqual(['a', 'b', 'c']);
  });

  it('honors SDK old/new indices with filtered records and never mutates a previously returned array', () => {
    const decode = vi.fn((raw: RawOwnerRecord, id: string) => raw.valid ? { id } : null);
    const update = ownerDocumentState(decode);
    const document = (id: string, valid = true) => ({ id, data: vi.fn(() => ({ valid })) });
    const [a, hidden, c] = [document('a'), document('hidden', false), document('c')];
    const first = update({ docChanges: () => [
      { type: 'added', doc: a, oldIndex: -1, newIndex: 0 },
      { type: 'added', doc: hidden, oldIndex: -1, newIndex: 1 },
      { type: 'added', doc: c, oldIndex: -1, newIndex: 2 },
    ] })!;
    const moved = update({ docChanges: () => [{ type: 'modified', doc: c, oldIndex: 2, newIndex: 0 }] })!;
    expect(moved.map((value) => value.id)).toEqual(['c', 'a']);
    expect(first.map((value) => value.id)).toEqual(['a', 'c']);
    expect(moved[1]).toBe(first[0]);
    expect(update({ docChanges: () => [{ type: 'removed', doc: hidden, oldIndex: 2, newIndex: -1 }] })).toBeNull();
    expect(hidden.data).toHaveBeenCalledOnce();
    expect(update({ docChanges: () => [{ type: 'removed', doc: c, oldIndex: 0, newIndex: -1 }] })!.map((value) => value.id)).toEqual(['a']);
  });

  it('preserves SDK document order even where UTF-16 sorting would differ', async () => {
    const state = await subscribe('collectionEntries'), snapshot = ownerSnapshotSequence('syncId');
    state.listener.next(snapshot([collectionRow('\u{10000}'), collectionRow('\ue000')]));
    expect(state.keys()).toEqual(['\ue000', '\u{10000}']);
    state.listener.next(snapshot([collectionRow('a'), collectionRow('\u{10000}'), collectionRow('\ue000')]));
    expect(state.keys()).toEqual(['a', '\ue000', '\u{10000}']);
  });

  it('retains a cleared sidecar as a tombstone without mutating the previous selection', async () => {
    const state = await subscribe('collectionPriceSelections'), snapshot = ownerSnapshotSequence('entrySyncId');
    const selected = selectionRow('a', {
      cleared: false, sourceSetId: 'sv03.5', sourceCardId: 'sv03.5-001', collectorNumber: '001/165',
      language: 'GERMAN', finish: 'Normal', variant: 'Standard', productId: 733596,
      metric: 'normal_avg_sell', amountMinor: 444, currency: 'EUR', sourceAt: 100, selectedAt: 100,
    });
    state.listener.next(snapshot([selected]));
    const first = state.values()[0];
    expect(first).toMatchObject({ cleared: false, amountMinor: 444 });
    state.listener.next(snapshot([selectionRow('a', { revision: 2 })]));
    expect(state.keys()).toEqual(['a']);
    expect(state.values()[0]).toMatchObject({ cleared: true, amountMinor: null });
    expect(first).toMatchObject({ cleared: false, amountMinor: 444 });
  });
});

describe('private snapshot edge cases', () => {
  it('retains the opposite dataset array and stable ID tie-order when a binder name changes', async () => {
    const next = vi.fn(); await subscribePrivateBinderView(uid, next, vi.fn());
    const [binders, placements] = firebase.listeners;
    const binderSnapshots = ownerSnapshotSequence('binderId'), placementSnapshots = ownerSnapshotSequence('placementId');
    binders.next(binderSnapshots([binderRow('c'), binderRow('a'), binderRow('b')]));
    expect(next).not.toHaveBeenCalled();
    placements.next(placementSnapshots([placementRow('p')]));
    const first = next.mock.lastCall![0];
    expect(first.binders.map((item: { binderId: string }) => item.binderId)).toEqual(['a', 'b', 'c']);
    binders.next(binderSnapshots([binderRow('c'), binderRow('a', { name: 'ZZZ', revision: 2 }), binderRow('b')]));
    const second = next.mock.lastCall![0];
    expect(second.placements).toBe(first.placements);
    expect(second.binders.map((item: { binderId: string }) => item.binderId)).toEqual(['b', 'c', 'a']);
    expect(second.binders[0]).toBe(first.binders[1]);
    placements.next(placementSnapshots([placementRow('p', { revision: 2, slotPosition: 9 })]));
    expect(next.mock.lastCall![0].binders).toBe(second.binders);
    expect(first.placements[0].slotPosition).toBe(0);
  });

  it.each(cases.filter(({ path }) => path === 'collectionEntries' || path.startsWith('private')))('removes a modified tombstone from $path', async ({ path, field, row }) => {
    const state = await subscribe(path), snapshot = ownerSnapshotSequence(field);
    state.listener.next(snapshot([row('a')]));
    state.listener.next(snapshot([row('a', { deleted: true, revision: 2 })]));
    expect(state.values()).toEqual([]);
  });
});

describe('synthetic snapshot scale, not network performance', () => {
  it.each([1_000, 5_000, 20_000])('decodes one update at %i rows and reuses all other decoded entry objects', async (size) => {
    const state = await subscribe('collectionEntries'), snapshot = ownerSnapshotSequence('syncId');
    const rows = Array.from({ length: size }, (_, index) => collectionRow(`entry-${String(index).padStart(5, '0')}`));
    const initial = snapshot(rows);
    const start = performance.now(); state.listener.next(initial); const initialMs = performance.now() - start;
    const previous = state.values();
    expect(initial.docs.reduce((sum, document) => sum + document.data.mock.calls.length, 0)).toBe(size);
    const midpoint = Math.floor(size / 2);
    const nextRows = [...rows]; nextRows[midpoint] = collectionRow(String(rows[midpoint].syncId), { revision: 2, quantity: 2 });
    const change = snapshot(nextRows);
    const updateStart = performance.now(); state.listener.next(change); const updateMs = performance.now() - updateStart;
    const calls = change.docs.reduce((sum, document) => sum + document.data.mock.calls.length, 0);
    const reused = state.values().filter((value, index) => value === previous[index]).length;
    expect(calls).toBe(1);
    expect(reused).toBe(size - 1);
    console.info(JSON.stringify({ fixture: 'owner-snapshot-local', size, initialDataCalls: size, updateDataCalls: calls, reusedDecodedObjects: reused, newDecodedObjects: size - reused, initialMs, updateMs }));
  });
});
