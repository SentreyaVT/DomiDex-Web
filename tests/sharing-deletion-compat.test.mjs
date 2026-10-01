import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { ORIGINAL_DELETION_SHA256, patchSharingDeletion } from '../scripts/sharing-deletion-compat.mjs';

// This targeted compatibility test deliberately uses the archived production
// module, not the newer development deletion implementation. It never imports
// Firebase or evaluates any deletion/authentication methods.
const original = await readFile(new URL('../.domidex/security-gate/release/backend/security/deletion.mjs', import.meta.url), 'utf8');
const oldAnchor = "privateUploadOperations: 'ownerUid' };";
const newAnchor = "privateUploadOperations: 'ownerUid', privateBinderShares: 'ownerUid' };";

function actualInventory(source) {
  const start = source.indexOf('const hash =');
  const end = source.indexOf('\nasync function removeContribution(');
  assert.ok(start > 0 && end > start, 'Reviewed production inventory boundaries must exist.');
  const inventorySource = source.slice(start, end).replace('export async function inventory(', 'async function inventory(');
  return runInNewContext(`${inventorySource}\ninventory;`, { createHash }, { timeout: 1000 });
}

function isolatedContext() {
  const queries = [];
  const rows = {
    privateBinderShares: {
      ownActive: { ownerUid: 'owner-a', revoked: false },
      ownRevoked: { ownerUid: 'owner-a', revoked: true },
      foreign: { ownerUid: 'owner-b', revoked: false },
      missingOwner: { revoked: false },
    },
    communitySubmissions: { oldSubmission: { submitterUid: 'owner-a' } },
    supportRequests: { oldSupport: { requesterUid: 'owner-a' } },
    privateUploadOperations: { oldUpload: { ownerUid: 'owner-a' } },
    scannerReports: { foreignReport: { ownerUid: 'owner-b', reviewedBy: 'owner-a' } },
  };
  const reference = (path) => ({ path, listCollections: async () => [] });
  const collection = (name, filter) => ({
    where(field, operator, value) {
      assert.equal(operator, '==');
      queries.push({ name, field, value });
      return collection(name, { field, value });
    },
    async *stream() {
      for (const [id, data] of Object.entries(rows[name] || {})) {
        if (!filter || data[filter.field] === filter.value) {
          yield { ref: reference(`${name}/${id}`), data: () => data };
        }
      }
    },
    listDocuments: async () => [],
  });
  // Intentionally no writes, delete methods, credentials, services or network.
  return {
    context: { db: { collection, doc: reference }, bucket: { getFiles: async () => [[], null] } },
    queries,
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

await test('only the reviewed production source is accepted; all other bytes remain identical', () => {
  assert.equal(createHash('sha256').update(original).digest('hex'), ORIGINAL_DELETION_SHA256);
  const patched = patchSharingDeletion(original);
  assert.equal(patched, original.replace(oldAnchor, newAnchor));
  assert.ok(Buffer.from(patched.replace(newAnchor, oldAnchor)).equals(Buffer.from(original)));
});

await test('actual production inventory includes own active/revoked shares and no foreign/unowned shares', async () => {
  const before = isolatedContext();
  const after = isolatedContext();
  const beforeResult = plain(await actualInventory(original)(before.context, 'owner-a'));
  const afterResult = plain(await actualInventory(patchSharingDeletion(original))(after.context, 'owner-a'));
  assert.deepEqual(afterResult.docs.filter((path) => path.startsWith('privateBinderShares/')).sort(), [
    'privateBinderShares/ownActive', 'privateBinderShares/ownRevoked',
  ]);
  assert.deepEqual(after.queries.filter(({ name }) => name === 'privateBinderShares'), [
    { name: 'privateBinderShares', field: 'ownerUid', value: 'owner-a' },
  ]);
  afterResult.docs = afterResult.docs.filter((path) => !path.startsWith('privateBinderShares/'));
  assert.deepEqual(afterResult, beforeResult, 'Every other inventory result must remain unchanged.');
});

await test('actual production inventory stays scoped when another owner is deleted', async () => {
  const { context } = isolatedContext();
  const result = plain(await actualInventory(patchSharingDeletion(original))(context, 'owner-b'));
  assert.deepEqual(result.docs.filter((path) => path.startsWith('privateBinderShares/')), ['privateBinderShares/foreign']);
  assert.ok(!result.docs.some((path) => path.includes('ownActive') || path.includes('ownRevoked')));
});

await test('changed, missing, duplicate and already-patched sources fail closed', () => {
  for (const source of [original + '\n', original.replace(oldAnchor, ''), original + original,
    patchSharingDeletion(original)]) {
    assert.throws(() => patchSharingDeletion(source), /source hash differs/);
  }
  assert.throws(() => patchSharingDeletion(null), TypeError);
});
