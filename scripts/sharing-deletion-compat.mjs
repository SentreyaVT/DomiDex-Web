import { createHash } from 'node:crypto';

// Apply only to the reviewed, unchanged production deletion module. Never copy
// the larger development deletion pipeline over the production implementation.
export const ORIGINAL_DELETION_SHA256 = '421e3398a68afdf8a153e7b22c2de374e13d7e1769205d9c6ecbf56a61a02969';
const originalRoots = "const personalRoots = { communitySubmissions: 'submitterUid', supportRequests: 'requesterUid', privateUploadOperations: 'ownerUid' };";
const sharingRoots = originalRoots.replace(' };', ", privateBinderShares: 'ownerUid' };");

export function patchSharingDeletion(oldSource) {
  if (typeof oldSource !== 'string') throw new TypeError('Expected the original deletion module as UTF-8 text.');
  const digest = createHash('sha256').update(oldSource, 'utf8').digest('hex');
  if (digest !== ORIGINAL_DELETION_SHA256) {
    throw new Error('Deletion compatibility patch refused: production source hash differs from the reviewed baseline.');
  }
  if (oldSource.split(originalRoots).length !== 2) {
    throw new Error('Deletion compatibility patch refused: expected exactly one personalRoots anchor.');
  }
  return oldSource.replace(originalRoots, sharingRoots);
}
