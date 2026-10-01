import type { CollectionEntry } from './domain';
import { ownerDocumentState } from './owner-document-state';

export type PrivateBinderView = { binderId: string; name: string; coverStyle: string; minimumPageCount: number };
export type PrivatePlacementView = { placementId: string; binderId: string; entrySyncId: string; slotPosition: number; holoEffectId: string | null; holoIntensity: number };
export type PrivateBinderSnapshot = { binders: PrivateBinderView[]; placements: PrivatePlacementView[] };
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value);
const integer = (value: unknown, minimum: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const ownedLive = (data: Record<string, unknown>, uid: string) => data.ownerUid === uid && data.deleted === false && integer(data.revision, 1);

export function decodePrivateBinder(data: Record<string, unknown>, id: string, uid: string): PrivateBinderView | null {
  if (!validId(id) || data.binderId !== id || !ownedLive(data, uid) || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 120
    || typeof data.coverStyle !== 'string' || data.coverStyle.length > 80 || !integer(data.minimumPageCount, 1) || data.minimumPageCount > 2147483647) return null;
  return { binderId: id, name: data.name, coverStyle: data.coverStyle, minimumPageCount: data.minimumPageCount };
}

export function decodePrivatePlacement(data: Record<string, unknown>, id: string, uid: string): PrivatePlacementView | null {
  if (!validId(id) || data.placementId !== id || !ownedLive(data, uid) || !validId(data.binderId) || !validId(data.entrySyncId) || !integer(data.slotPosition, 0) || data.slotPosition > 2147483647) return null;
  const effect = data.holoEffectId ?? null, intensity = data.holoIntensity ?? 0;
  if (effect !== null && (typeof effect !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(effect))) return null;
  if (typeof intensity !== 'number' || !Number.isFinite(intensity) || intensity < 0 || intensity > 1 || (effect === null && intensity !== 0)) return null;
  return { placementId: id, binderId: data.binderId, entrySyncId: data.entrySyncId, slotPosition: data.slotPosition, holoEffectId: effect, holoIntensity: intensity };
}

/** Read the same owner-scoped documents as Android; never creates shares or writes data. */
export async function subscribePrivateBinderView(uid: string, next: (value: PrivateBinderSnapshot) => void, fail: () => void): Promise<() => void> {
  const [{ collection, onSnapshot }, { firestore }] = await Promise.all([import('firebase/firestore'), import('./firebase-client')]);
  let active = true, loadedBinders = false, loadedPlacements = false;
  let binders: PrivateBinderView[] = [], placements: PrivatePlacementView[] = [];
  const updateBinders = ownerDocumentState((data, id) => decodePrivateBinder(data, id, uid));
  const updatePlacements = ownerDocumentState((data, id) => decodePrivatePlacement(data, id, uid));
  const stops: Array<() => void> = [];
  const stop = () => { active = false; stops.forEach((unsubscribe) => unsubscribe()); };
  const error = () => { if (active) { stop(); fail(); } };
  const publish = () => { if (active && loadedBinders && loadedPlacements) next({ binders, placements }); };
  try {
    stops.push(onSnapshot(collection(firestore, 'users', uid, 'privateBinders'), (snapshot) => {
      if (!active) return;
      const updated = updateBinders(snapshot);
      if (updated === null) return;
      // Stable name sorting retains SDK document-ID order for equal names.
      binders = updated.sort((a, b) => a.name.localeCompare(b.name, 'de'));
      loadedBinders = true; publish();
    }, error));
    if (active) stops.push(onSnapshot(collection(firestore, 'users', uid, 'privateBinderPlacements'), (snapshot) => {
      if (!active) return;
      const updated = updatePlacements(snapshot);
      if (updated === null) return;
      placements = updated;
      loadedPlacements = true; publish();
    }, error));
    if (!active) stop();
    return stop;
  } catch (failure) { stop(); throw failure; }
}

export function privateBinderPage(binder: PrivateBinderView, placements: PrivatePlacementView[], entries: CollectionEntry[], uid: string, requestedPage: number) {
  const ownEntries = new Map(entries.filter((entry) => entry.ownerUid === uid && !entry.deleted).map((entry) => [entry.syncId, entry]));
  const matches = placements.filter((placement) => placement.binderId === binder.binderId);
  const pageCount = matches.reduce((count, item) => Math.max(count, Math.floor(item.slotPosition / 9) + 1), Math.max(binder.minimumPageCount, 1));
  const page = Math.max(0, Math.min(Number.isSafeInteger(requestedPage) ? requestedPage : 0, pageCount - 1));
  return { page, pageCount, slots: Array.from({ length: 9 }, (_, index) => {
    const position = page * 9 + index;
    const candidates = matches.filter((item) => item.slotPosition === position);
    // Never silently move cards or substitute a different placement after a sync conflict.
    const placement = candidates.length === 1 ? candidates[0] : null;
    return { position, placement, entry: placement ? ownEntries.get(placement.entrySyncId) ?? null : null, unavailable: candidates.length > 0 && (!placement || !ownEntries.has(placement.entrySyncId)) };
  }) };
}
