type OwnerDocument = { id: string; data: () => Record<string, unknown> };
type OwnerDocumentChange = { type: 'added' | 'modified' | 'removed'; doc: OwnerDocument; oldIndex: number; newIndex: number };
type OwnerSnapshot = { docChanges: () => readonly OwnerDocumentChange[] };

/** State for ONE existing unfiltered owner query; no cursors, persistence or revision arbitration. */
export function ownerDocumentState<T>(decode: (data: Record<string, unknown>, id: string) => T | null) {
  // SDK indices include documents that the decoder rejects. Keep their positions separately.
  const orderedIds: string[] = [];
  const values = new Map<string, T>();
  let ready = false;
  return (snapshot: OwnerSnapshot): T[] | null => {
    let changed = !ready;
    for (const change of snapshot.docChanges()) {
      const id = change.doc.id;
      if (change.type === 'removed') {
        orderedIds.splice(change.oldIndex, 1);
        changed = values.delete(id) || changed;
        continue;
      }
      if (change.type === 'added') orderedIds.splice(change.newIndex, 0, id);
      else if (change.oldIndex !== change.newIndex) {
        orderedIds.splice(change.oldIndex, 1);
        orderedIds.splice(change.newIndex, 0, id);
      }
      // Apply SDK-authoritative rollbacks too; a lower revision is not a reason to discard one.
      let value: T | null;
      try { value = decode(change.doc.data(), id); }
      catch {
        // A malformed legacy record must not interrupt the remaining SDK changes or
        // poison their indices. Keep its raw position, but remove its visible value.
        value = null;
      }
      if (value === null) changed = values.delete(id) || changed;
      else { values.set(id, value); changed = true; }
    }
    ready = true;
    if (!changed) return null;
    // Never expose or mutate the internal Map or a previously published array.
    const published: T[] = [];
    for (const id of orderedIds) if (values.has(id)) published.push(values.get(id)!);
    return published;
  };
}
