import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeCollectionLayout, setBinderEntries, subscribeCollectionLayouts } from '@/lib/collection-layouts';
import type { CollectionEntry } from '@/lib/domain';
import { ownerSnapshotSequence, type OwnerTestSnapshot } from './helpers/owner-snapshot';

type Raw = Record<string, unknown>;
type Snapshot = OwnerTestSnapshot;
type Listener = { path: string; next: (snapshot: Snapshot) => void; error: (error: Error) => void; stop: ReturnType<typeof vi.fn> };
const firebase = vi.hoisted(() => ({ listeners: [] as Listener[], collection: vi.fn(), onSnapshot: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('firebase/firestore', () => firebase);
vi.mock('@/lib/firebase-client', () => ({ firestore: {} }));
const data = (extra: Raw = {}): Raw => ({ entrySyncId: 'entry-a', ownerUid: 'owner-a', revision: 1, updatedAtClient: 1, visibleInSetBinder: false, ...extra });
let snapshot = ownerSnapshotSequence('entrySyncId');

beforeEach(() => {
  snapshot = ownerSnapshotSequence('entrySyncId');
  firebase.listeners.length = 0;
  vi.clearAllMocks();
  firebase.collection.mockImplementation((_store: unknown, ...path: string[]) => path.join('/'));
  firebase.onSnapshot.mockImplementation((path: string, next: Listener['next'], error: Listener['error']) => {
    const stop = vi.fn(); firebase.listeners.push({ path, next, error, stop }); return stop;
  });
});

describe('Android collection layout contract', () => {
  it('accepts both booleans and rejects a wrong owner, document identity or malformed metadata', () => {
    for (const visibleInSetBinder of [false, true]) {
      expect(decodeCollectionLayout(data({ visibleInSetBinder }), 'entry-a', 'owner-a')).toEqual({ entrySyncId: 'entry-a', visibleInSetBinder });
    }
    for (const invalid of [{ ownerUid: 'owner-b' }, { revision: 0 }, { revision: 1.5 }, { revision: NaN }, { updatedAtClient: 0 }, { updatedAtClient: '1' }, { visibleInSetBinder: null }, { visibleInSetBinder: 'false' }]) {
      expect(decodeCollectionLayout(data(invalid), 'entry-a', 'owner-a')).toBeNull();
    }
    expect(decodeCollectionLayout(data(), 'entry-b', 'owner-a')).toBeNull();
    expect(decodeCollectionLayout(data({ entrySyncId: '../entry-a' }), '../entry-a', 'owner-a')).toBeNull();
  });

  it('filters the exact entry only without changing the full collection or another printing', () => {
    const entries = [{ syncId: 'entry-a', sourceCardId: 'same-card' }, { syncId: 'entry-b', sourceCardId: 'same-card' }, { syncId: 'entry-c' }] as CollectionEntry[];
    expect(setBinderEntries(entries, new Map([['entry-a', false], ['entry-c', true]]))).toEqual([entries[1], entries[2]]);
    expect(entries).toHaveLength(3);
    expect(setBinderEntries(entries, new Map())).toEqual(entries);
  });

  it('replaces the current visibility on every owner-scoped snapshot, including deleted layout documents', async () => {
    const next = vi.fn(), fail = vi.fn();
    const stop = await subscribeCollectionLayouts('owner-a', next, fail);
    expect(firebase.listeners.map((listener) => listener.path)).toEqual(['users/owner-a/collectionLayouts']);
    const listener = firebase.listeners[0];
    listener.next(snapshot([data(), data({ entrySyncId: 'foreign', ownerUid: 'owner-b' }), data({ entrySyncId: 'invalid', visibleInSetBinder: 'false' })]));
    expect(next).toHaveBeenLastCalledWith(new Map([['entry-a', false]]));
    listener.next(snapshot([data({ revision: 2, visibleInSetBinder: true })]));
    expect(next).toHaveBeenLastCalledWith(new Map([['entry-a', true]]));
    listener.next(snapshot([]));
    expect(next).toHaveBeenLastCalledWith(new Map());
    stop();
    listener.next(snapshot([data()])); listener.error(new Error('late failure'));
    expect(next).toHaveBeenCalledTimes(3);
    expect(fail).not.toHaveBeenCalled();
    expect(listener.stop).toHaveBeenCalledOnce();
    for (const write of [firebase.setDoc, firebase.updateDoc, firebase.deleteDoc]) expect(write).not.toHaveBeenCalled();
  });

  it('reports listener failures once and suppresses later callbacks', async () => {
    const next = vi.fn(), fail = vi.fn();
    const stop = await subscribeCollectionLayouts('owner-a', next, fail);
    const listener = firebase.listeners[0], error = new Error('permission-denied');
    listener.error(error); listener.error(error); listener.next(snapshot([data()]));
    expect(fail).toHaveBeenCalledExactlyOnceWith(error);
    expect(next).not.toHaveBeenCalled();
    stop(); expect(listener.stop).toHaveBeenCalledOnce();
  });
});
