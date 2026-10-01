import { vi } from 'vitest';

export type RawOwnerRecord = Record<string, unknown>;
export type OwnerTestDocument = { id: string; data: ReturnType<typeof vi.fn<() => RawOwnerRecord>> };
export type OwnerTestChange = { type: 'added' | 'modified' | 'removed'; doc: OwnerTestDocument; oldIndex: number; newIndex: number };
export type OwnerTestSnapshot = { docs: OwnerTestDocument[]; docChanges: () => OwnerTestChange[] };

/** Unfiltered default document-ID query: indices include invalid/hidden documents. */
export function ownerSnapshotSequence(idField: string) {
  let previous: Array<{ id: string; raw: RawOwnerRecord }> = [];
  return (records: RawOwnerRecord[]): OwnerTestSnapshot => {
    const current = records.map((raw) => ({ id: String(raw[idField]), raw }))
      .sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
    const docs = current.map(({ id, raw }) => ({ id, data: vi.fn(() => raw) }));
    const ids = previous.map(({ id }) => id);
    const currentIds = new Set(current.map(({ id }) => id));
    const old = new Map(previous.map(({ id, raw }) => [id, raw]));
    const changes: OwnerTestChange[] = [];
    for (let index = ids.length - 1; index >= 0; index--) {
      if (currentIds.has(ids[index])) continue;
      const id = ids[index];
      changes.push({ type: 'removed', oldIndex: index, newIndex: -1, doc: { id, data: vi.fn(() => old.get(id)!) } });
      ids.splice(index, 1);
    }
    for (let index = 0; index < docs.length; index++) {
      const document = docs[index];
      if (ids[index] !== document.id) {
        // Default ID ordering means remaining existing documents never move.
        ids.splice(index, 0, document.id);
        changes.push({ type: 'added', oldIndex: -1, newIndex: index, doc: document });
      } else if (JSON.stringify(old.get(document.id)) !== JSON.stringify(current[index].raw)) {
        changes.push({ type: 'modified', oldIndex: index, newIndex: index, doc: document });
      }
    }
    previous = current;
    return { docs, docChanges: () => changes };
  };
}
