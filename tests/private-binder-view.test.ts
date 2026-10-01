import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePrivateBinder, decodePrivatePlacement, privateBinderPage, subscribePrivateBinderView } from '@/lib/private-binder-view';
import type { CollectionEntry } from '@/lib/domain';

type Raw = Record<string, unknown>;
type Snapshot = { docs: { id: string; data: () => Raw }[] };
type Listener = { path: string; next: (snapshot: Snapshot) => void; error: () => void; stop: ReturnType<typeof vi.fn> };
const firebase = vi.hoisted(() => ({ listeners: [] as Listener[], collection: vi.fn(), onSnapshot: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('firebase/firestore', () => firebase);
vi.mock('@/lib/firebase-client', () => ({ firestore: { fixture: true } }));

const uid = 'owner-a';
const binderData = (extra: Raw = {}): Raw => ({ binderId: 'binder-a', ownerUid: uid, revision: 1, deleted: false, name: 'Meine Karten', coverStyle: 'galaxy', minimumPageCount: 1, ...extra });
const placementData = (extra: Raw = {}): Raw => ({ placementId: 'placement-a', binderId: 'binder-a', ownerUid: uid, entrySyncId: 'exact-entry', revision: 1, deleted: false, slotPosition: 0, holoEffectId: 'galaxy', holoIntensity: .72, ...extra });
const snapshot = (records: Raw[], field: string): Snapshot => ({ docs: records.map((data) => ({ id: String(data[field]), data: () => data })) });
const entry = (syncId: string, extra: Partial<CollectionEntry> = {}) => ({ syncId, ownerUid: uid, deleted: false, sourceCardId: 'same-card', finish: 'Holo', name: syncId, ...extra }) as CollectionEntry;

beforeEach(() => {
  firebase.listeners.length = 0;
  vi.clearAllMocks();
  firebase.collection.mockImplementation((_store: unknown, ...path: string[]) => path.join('/'));
  firebase.onSnapshot.mockImplementation((path: string, next: Listener['next'], error: Listener['error']) => {
    const stop = vi.fn(); firebase.listeners.push({ path, next, error, stop }); return stop;
  });
});

describe('owner-scoped private binder decoding', () => {
  it('rejects foreign owners, tombstones, invalid IDs and malformed live records', () => {
    expect(decodePrivateBinder(binderData(), 'binder-a', uid)?.binderId).toBe('binder-a');
    expect(decodePrivatePlacement(placementData(), 'placement-a', uid)?.entrySyncId).toBe('exact-entry');
    for (const invalid of [{ ownerUid: 'owner-b' }, { deleted: true }, { deleted: undefined }, { revision: 0 }, { revision: 1.5 }]) {
      expect(decodePrivateBinder(binderData(invalid), 'binder-a', uid)).toBeNull();
      expect(decodePrivatePlacement(placementData(invalid), 'placement-a', uid)).toBeNull();
    }
    expect(decodePrivateBinder(binderData(), 'different', uid)).toBeNull();
    expect(decodePrivateBinder(binderData({ name: ' ', minimumPageCount: 0 }), 'binder-a', uid)).toBeNull();
    expect(decodePrivateBinder(binderData({ minimumPageCount: 2147483648 }), 'binder-a', uid)).toBeNull();
    expect(decodePrivatePlacement(placementData({ binderId: 'bad/id' }), 'placement-a', uid)).toBeNull();
    expect(decodePrivatePlacement(placementData({ entrySyncId: 'bad/id' }), 'placement-a', uid)).toBeNull();
    expect(decodePrivatePlacement(placementData({ slotPosition: -.5 }), 'placement-a', uid)).toBeNull();
    expect(decodePrivatePlacement(placementData({ slotPosition: 2147483648 }), 'placement-a', uid)).toBeNull();
    expect(decodePrivatePlacement(placementData(), 'different', uid)).toBeNull();
  });

  it('keeps unknown, null, none and zero-strength effects exactly as stored', () => {
    for (const [holoEffectId, holoIntensity] of [['future-material', .8], [null, 0], ['none', 0], ['galaxy', 0], ['galaxy', 1]] as const) {
      expect(decodePrivatePlacement(placementData({ holoEffectId, holoIntensity }), 'placement-a', uid)).toMatchObject({ holoEffectId, holoIntensity });
    }
    expect(decodePrivatePlacement(placementData({ holoEffectId: undefined, holoIntensity: undefined }), 'placement-a', uid)).toMatchObject({ holoEffectId: null, holoIntensity: 0 });
    for (const invalid of [{ holoEffectId: null, holoIntensity: .1 }, { holoEffectId: '' }, { holoEffectId: 'bad/id' }, { holoIntensity: NaN }, { holoIntensity: Infinity }, { holoIntensity: 1.01 }, { holoIntensity: -.1 }]) {
      expect(decodePrivatePlacement(placementData(invalid), 'placement-a', uid)).toBeNull();
    }
  });
});

describe('exact private placement linkage and bounded paging', () => {
  it('uses only exact syncId and owner matches, preserving positions and conflicting slots', () => {
    const binder = decodePrivateBinder(binderData(), 'binder-a', uid)!;
    const placements = [
      placementData(),
      placementData({ placementId: 'missing', entrySyncId: 'missing-entry', slotPosition: 1 }),
      placementData({ placementId: 'foreign', entrySyncId: 'foreign-entry', slotPosition: 2 }),
      placementData({ placementId: 'deleted', entrySyncId: 'deleted-entry', slotPosition: 3 }),
      placementData({ placementId: 'conflict-a', slotPosition: 4 }),
      placementData({ placementId: 'conflict-b', slotPosition: 4 }),
      placementData({ placementId: 'other-binder', binderId: 'binder-b', slotPosition: 5 }),
    ].map((data) => decodePrivatePlacement(data, String(data.placementId), uid)!);
    const exact = entry('exact-entry');
    const view = privateBinderPage(binder, placements, [entry('same-card'), entry('wrong-print'), exact, entry('foreign-entry', { ownerUid: 'owner-b' }), entry('deleted-entry', { deleted: true })], uid, 0);
    expect(view.slots).toHaveLength(9);
    expect(view.slots[0]).toMatchObject({ position: 0, entry: exact, placement: { placementId: 'placement-a', holoEffectId: 'galaxy', holoIntensity: .72 }, unavailable: false });
    for (const index of [1, 2, 3, 4]) expect(view.slots[index]).toMatchObject({ position: index, entry: null, unavailable: true });
    expect(view.slots[4].placement).toBeNull();
    expect(view.slots[5]).toMatchObject({ entry: null, placement: null, unavailable: false });
    expect(view.slots.map((slot) => slot.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('renders nine slots even for a distant saved position and clamps invalid requested pages', () => {
    const binder = decodePrivateBinder(binderData({ minimumPageCount: 4 }), 'binder-a', uid)!;
    const placement = decodePrivatePlacement(placementData({ slotPosition: 90008 }), 'placement-a', uid)!;
    const last = privateBinderPage(binder, [placement], [entry('exact-entry')], uid, 99999);
    expect(last).toMatchObject({ page: 10000, pageCount: 10001 });
    expect(last.slots).toHaveLength(9);
    expect(last.slots[8]).toMatchObject({ position: 90008, entry: { syncId: 'exact-entry' } });
    for (const page of [-1, Infinity, NaN, .5]) expect(privateBinderPage(binder, [placement], [], uid, page).page).toBe(0);
    expect(privateBinderPage(binder, [], [], uid, 0).pageCount).toBe(4);
  });
});

describe('read-only private binder listeners', () => {
  it('reads only the current owner paths and waits for both snapshots before publishing filtered data', async () => {
    const next = vi.fn(), fail = vi.fn();
    const stop = await subscribePrivateBinderView(uid, next, fail);
    expect(firebase.listeners.map((listener) => listener.path)).toEqual(['users/owner-a/privateBinders', 'users/owner-a/privateBinderPlacements']);
    const [binders, placements] = firebase.listeners;
    binders.next(snapshot([binderData(), binderData({ binderId: 'foreign', ownerUid: 'owner-b' }), binderData({ binderId: 'tombstone', deleted: true })], 'binderId'));
    expect(next).not.toHaveBeenCalled();
    placements.next(snapshot([placementData(), placementData({ placementId: 'foreign', ownerUid: 'owner-b' }), placementData({ placementId: 'tombstone', deleted: true })], 'placementId'));
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toMatchObject({ binders: [{ binderId: 'binder-a' }], placements: [{ placementId: 'placement-a' }] });
    expect(fail).not.toHaveBeenCalled();
    stop();
    expect(binders.stop).toHaveBeenCalledOnce();
    expect(placements.stop).toHaveBeenCalledOnce();
    binders.next(snapshot([], 'binderId')); placements.next(snapshot([], 'placementId'));
    expect(next).toHaveBeenCalledOnce();
    for (const write of [firebase.setDoc, firebase.updateDoc, firebase.deleteDoc]) expect(write).not.toHaveBeenCalled();
  });

  it('stops both listeners and suppresses stale callbacks after one fails', async () => {
    const next = vi.fn(), fail = vi.fn();
    await subscribePrivateBinderView(uid, next, fail);
    const [binders, placements] = firebase.listeners;
    binders.error();
    expect(fail).toHaveBeenCalledOnce();
    for (const listener of firebase.listeners) expect(listener.stop).toHaveBeenCalledOnce();
    binders.next(snapshot([binderData()], 'binderId'));
    placements.next(snapshot([placementData()], 'placementId')); placements.error();
    expect(next).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
  });

  it('cleans up a listener when the second registration throws and handles immediate rejection', async () => {
    firebase.onSnapshot.mockImplementationOnce((path: string, next: Listener['next'], error: Listener['error']) => {
      const stop = vi.fn(); firebase.listeners.push({ path, next, error, stop }); return stop;
    }).mockImplementationOnce(() => { throw new Error('registration failed'); });
    await expect(subscribePrivateBinderView(uid, vi.fn(), vi.fn())).rejects.toThrow('registration failed');
    expect(firebase.listeners[0].stop).toHaveBeenCalledOnce();
    const rejectedStop = vi.fn(), fail = vi.fn();
    firebase.onSnapshot.mockImplementationOnce((_path: string, _next: Listener['next'], error: Listener['error']) => { error(); return rejectedStop; });
    await subscribePrivateBinderView(uid, vi.fn(), fail);
    expect(fail).toHaveBeenCalledOnce();
    expect(rejectedStop).toHaveBeenCalledOnce();
  });
});
