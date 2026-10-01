import { actorWithServerReadTime, fail, failure, json, services } from './firebase.mjs';
import { consumeReadQuota, serverReadTimeParts } from './read-rate-limit.mjs';

// This is an authenticated server-time fence, not a catalog/snapshot endpoint.
// It neither validates historical updatedAt values nor proves a document exists.
export async function readPrivateSyncTimeAnchor(request, context = services()) {
  try {
    if (request.method !== 'GET') fail('INVALID_REQUEST', 405);
    if (new URL(request.url).search) fail('INVALID_REQUEST', 400);
    const { actor, readTime } = await actorWithServerReadTime(request, context, 'app');
    const timestamp = serverReadTimeParts(readTime);
    await consumeReadQuota(context, 'syncTimeAnchor', actor.uid);
    return json({ schemaVersion: 1, ownerUid: actor.uid, ...timestamp });
  } catch (error) { return failure(error); }
}
