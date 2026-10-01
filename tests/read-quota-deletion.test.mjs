import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { inventory } from '../backend/security/deletion.mjs';

const expectedPath = uid => `privateReadRateLimits/syncTimeAnchor_${createHash('sha256').update(`syncTimeAnchor\0${uid}`).digest('hex')}`;
function emptyInventoryContext() {
  const collections = [];
  const emptyCollection = { stream: async function* () {}, listDocuments: async () => [] };
  emptyCollection.where = () => emptyCollection;
  return { collections, context: {
    db: { doc: path => ({ path, listCollections: async () => [] }),
      collection: name => { collections.push(name); return emptyCollection; } },
    bucket: { getFiles: vi.fn(async () => [[], null]) },
  } };
}
it('adds only the exact bounded read-quota key to the actual deletion inventory', async () => {
  const { collections, context } = emptyInventoryContext();
  const a = await inventory(context, 'owner-a'); const b = await inventory(context, 'owner-b');
  expect(a.docs).toContain(expectedPath('owner-a')); expect(a.docs).not.toContain(expectedPath('owner-b'));
  expect(b.docs).toContain(expectedPath('owner-b')); expect(b.docs).not.toContain(expectedPath('owner-a'));
  expect(a.docs.filter(path => path.startsWith('privateReadRateLimits/'))).toEqual([expectedPath('owner-a')]);
  expect(collections).not.toContain('privateReadRateLimits');
  expect(a.docs.filter(path => path.startsWith('privateWriteRateLimits/'))).toHaveLength(3);
  expect(a.blockers).toEqual([]);
});
