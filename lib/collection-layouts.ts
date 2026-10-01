'use client';

import type { CollectionEntry } from './domain';
import { ownerDocumentState } from './owner-document-state';

export type SetBinderVisibility = ReadonlyMap<string, boolean>;

export function decodeCollectionLayout(data: Record<string, unknown>, id: string, uid: string) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id) || data.entrySyncId !== id || data.ownerUid !== uid
    || !Number.isSafeInteger(data.revision) || Number(data.revision) < 1
    || !Number.isSafeInteger(data.updatedAtClient) || Number(data.updatedAtClient) < 1
    || typeof data.visibleInSetBinder !== 'boolean') return null;
  return { entrySyncId: id, visibleInSetBinder: data.visibleInSetBinder };
}

/** Layouts affect set-binder placement only; the collection still owns every entry. */
export function setBinderEntries(entries: CollectionEntry[], visibility: SetBinderVisibility) {
  return entries.filter((entry) => visibility.get(entry.syncId) !== false);
}

export async function subscribeCollectionLayouts(uid: string, next: (visibility: SetBinderVisibility) => void, fail: (error: Error) => void) {
  const [{ collection, onSnapshot }, { firestore }] = await Promise.all([import('firebase/firestore'), import('./firebase-client')]);
  let active = true;
  const update = ownerDocumentState((data, id) => decodeCollectionLayout(data, id, uid));
  const unsubscribe = onSnapshot(collection(firestore, 'users', uid, 'collectionLayouts'), (snapshot) => {
    if (!active) return;
    const layouts = update(snapshot);
    if (layouts !== null) next(new Map(layouts.map((layout) => [layout.entrySyncId, layout.visibleInSetBinder])));
  }, (error) => { if (active) { active = false; fail(error); } });
  return () => { active = false; unsubscribe(); };
}
