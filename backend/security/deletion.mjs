import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { actorFor, fail, failure, json, services } from './firebase.mjs';

const { aggregateVote } = createRequire(import.meta.url)('../scan-knowledge/knowledge-aggregate.js');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const safeUid = (value) => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value);
const personalRoots = { communitySubmissions: 'submitterUid', supportRequests: 'requesterUid', privateUploadOperations: 'ownerUid' };
const protectedRoots = ['scannerProfiles', 'scannerProfileVersions', 'scannerReleaseManifest', 'scannerLayouts', 'scannerBenchmarks', 'siteContent'];
const clock = (context) => context.now?.() ?? Date.now();
const containsIdentity = (value, uid) => typeof value === 'string' ? value === uid || value === hash(uid)
  : Array.isArray(value) ? value.some((item) => containsIdentity(item, uid))
    : value && typeof value === 'object' ? Object.values(value).some((item) => containsIdentity(item, uid)) : false;

async function* documents(collection) { for await (const doc of collection.stream()) yield doc; }
async function* objects(bucket, options = {}) {
  let query = { autoPaginate: false, maxResults: 200, ...options };
  while (query) {
    const [files, next] = await bucket.getFiles(query);
    for (const file of files) yield file;
    query = next ? { ...next, autoPaginate: false } : null;
  }
}
async function* descendants(reference) {
  for (const collection of await reference.listCollections()) {
    // listDocuments includes missing parents that still have subcollections.
    for (const child of await collection.listDocuments()) {
      yield* descendants(child);
      yield child;
    }
  }
}

export async function inventory(context, uid) {
  const { db, bucket } = context;
  const result = { docs: new Set(), images: [], retained: [], contributors: [], redact: [], blockers: new Set() };
  for (const root of protectedRoots) {
    await context.checkpoint?.();
    for await (const doc of documents(db.collection(root))) {
      if (containsIdentity(doc.data(), uid)) result.blockers.add('PROTECTED_SCANNER_ATTRIBUTION');
    }
  }
  for await (const ref of descendants(db.doc(`users/${uid}`))) result.docs.add(ref.path);
  result.docs.add(`users/${uid}`);
  for (const [root, owner] of Object.entries(personalRoots)) {
    for await (const doc of documents(db.collection(root).where(owner, '==', uid))) {
      for await (const child of descendants(doc.ref)) result.docs.add(child.path);
      result.docs.add(doc.ref.path);
    }
  }
  const ownedImages = new Set();
  const allImageOwners = new Map();
  for await (const file of objects(bucket, { versions: true })) {
    await context.checkpoint?.();
    const metadata = file.metadata || (await file.getMetadata())[0];
    const owner = metadata.metadata?.ownerUid;
    if (file.name.startsWith('scanner-report-images/')) allImageOwners.set(file.name, owner || null);
    const ownedPrefix = [`users/${uid}/`, `catalog-contributions/${uid}/`, `community-submissions/${uid}/`].some((prefix) => file.name.startsWith(prefix));
    if (ownedPrefix || owner === uid) {
      if (ownedPrefix && owner && owner !== uid) { result.blockers.add('CONFLICTING_IMAGE_OWNERSHIP'); continue; }
      if (!ownedPrefix && !file.name.startsWith('scanner-report-images/')) { result.blockers.add('UNKNOWN_OWNED_IMAGE_CLASS'); continue; }
      result.images.push({ path: file.name, generation: String(metadata.generation), kind: 'image' });
      ownedImages.add(file.name);
    }
  }
  for await (const doc of documents(db.collection('scannerReports'))) {
    await context.checkpoint?.();
    const data = doc.data();
    const path = data.captureImagePath;
    const imageOwner = allImageOwners.get(path);
    if (!data.ownerUid && !imageOwner) result.blockers.add('LEGACY_REPORT_OWNERSHIP_REVIEW');
    if (data.ownerUid === uid || ownedImages.has(path)) {
      if ((data.ownerUid && data.ownerUid !== uid) || (imageOwner && imageOwner !== uid)) result.blockers.add('CONFLICTING_REPORT_OWNERSHIP');
      else result.docs.add(doc.ref.path);
    } else if (data.reviewedBy === uid) result.redact.push({ path: doc.ref.path, field: 'reviewedBy', kind: 'redact' });
  }
  // Soft-deleted versions may predate this request or a later bucket policy change.
  for await (const file of objects(bucket, { softDeleted: true })) {
    await context.checkpoint?.();
    const metadata = file.metadata;
    const ownedPrefix = [`users/${uid}/`, `catalog-contributions/${uid}/`, `community-submissions/${uid}/`].some((prefix) => file.name.startsWith(prefix));
    if (ownedPrefix || metadata.metadata?.ownerUid === uid) {
      if (ownedPrefix && metadata.metadata?.ownerUid && metadata.metadata.ownerUid !== uid) result.blockers.add('CONFLICTING_IMAGE_OWNERSHIP');
      else result.retained.push({ path: file.name, generation: String(metadata.generation), kind: 'retained', hardDeleteTime: metadata.hardDeleteTime || null });
    }
  }
  // Include orphan contributors even when the original Evidence document is already absent.
  for (const summary of await db.collection('scanKnowledgePrivate').listDocuments()) {
    const contribution = summary.collection('contributors').doc(hash(uid));
    if ((await contribution.get()).exists) result.contributors.push(summary.id);
  }
  for await (const doc of documents(db.collection('scannerAudit').where('actor', '==', uid))) {
    result.redact.push({ path: doc.ref.path, field: 'actor', kind: 'redact' });
  }
  return { ...result, docs: [...result.docs], blockers: [...result.blockers] };
}

async function removeContribution(context, uid, fingerprint) {
  const privateRef = context.db.doc(`scanKnowledgePrivate/${fingerprint}`);
  await context.db.runTransaction(async (tx) => {
    const summary = await tx.get(privateRef);
    const contributors = await tx.get(privateRef.collection('contributors'));
    const target = contributors.docs.find((doc) => doc.id === hash(uid));
    if (!target) return;
    const others = contributors.docs.filter((doc) => doc.id !== target.id);
    tx.delete(target.ref);
    if (!others.length) {
      tx.delete(privateRef); tx.delete(context.db.doc(`scanKnowledge/${fingerprint}`)); return;
    }
    let aggregate;
    for (const other of others) aggregate = aggregateVote(aggregate?.privateSummary, undefined, other.data());
    const knowledgeVersion = Number(summary.data()?.knowledgeVersion || 1);
    tx.set(privateRef, { ...aggregate.privateSummary, knowledgeVersion, lastUpdatedAt: new Date(clock(context)) });
    tx.set(context.db.doc(`scanKnowledge/${fingerprint}`), { fingerprint, ...aggregate.publicKnowledge, knowledgeVersion, lastUpdatedAt: new Date(clock(context)) });
  });
}

async function saveInventory(job, found) {
  const items = [...found.docs.map((path) => ({ kind: 'document', path })), ...found.images, ...found.retained,
    ...found.contributors.map((path) => ({ kind: 'contributor', path })), ...found.redact];
  for (const item of items) {
    const key = hash(`${item.kind}:${item.path}:${item.generation || item.field || ''}`);
    // Never overwrite 'done': retries may discover the same ownership item.
    try { await job.collection('items').doc(key).create({ ...item, done: false }); }
    catch (error) { if (error.code !== 6) throw error; }
  }
}

async function deleteItems(context, job, uid) {
  // Evidence first, then contributors. Current-evidence transaction guard prevents re-creation.
  const all = (await job.collection('items').get()).docs;
  const priority = (item) => item.kind === 'document' && item.path.includes('/scanEvidence/') ? 0 : item.kind === 'contributor' ? 1 : item.kind === 'document' ? 2 : 3;
  all.sort((a, b) => priority(a.data()) - priority(b.data()) || b.data().path.length - a.data().path.length);
  for (const snapshot of all) {
    const item = snapshot.data();
    if (item.done || item.kind === 'retained') continue;
    await context.beforeDelete?.(item);
    if (item.kind === 'contributor') await removeContribution(context, uid, item.path);
    else if (item.kind === 'document') await context.db.doc(item.path).delete();
    else if (item.kind === 'image') await context.bucket.file(item.path, { generation: item.generation }).delete({ ignoreNotFound: true, ifGenerationMatch: item.generation });
    else if (item.kind === 'redact') await context.db.runTransaction(async (tx) => {
      const ref = context.db.doc(item.path); const doc = await tx.get(ref);
      if (doc.exists && doc.get(item.field) === uid) tx.update(ref, { [item.field]: 'deleted-account' });
    });
    await snapshot.ref.update({ done: true, completedAt: clock(context) });
  }
}

async function account(context, uid) {
  try { return await context.auth.getUser(uid); }
  catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
}

export async function advanceDeletion(context, uid, jobId) {
  const job = context.db.doc(`accountDeletionJobs/${jobId}`);
  const lease = randomUUID();
  let acquired = false;
  const checkpoint = () => context.db.runTransaction(async (tx) => {
    const current = await tx.get(job);
    if (!current.exists || current.get('lease') !== lease) fail('LEASE_LOST');
    tx.update(job, { leaseUntil: clock(context) + 10 * 60_000 });
  });
  try {
    await context.db.runTransaction(async (tx) => {
      const current = await tx.get(job);
      if (!current.exists || current.get('uid') !== uid) fail('NOT_FOUND', 404);
      if (current.get('leaseUntil') > clock(context)) fail('JOB_BUSY');
      tx.update(job, { lease, leaseUntil: clock(context) + 10 * 60_000 });
    });
    acquired = true;
    context = { ...context, checkpoint, beforeDelete: async (item) => { await checkpoint(); await context.originalBeforeDelete?.(item); }, originalBeforeDelete: context.beforeDelete };
    let state = (await job.get()).data();
    const user = await account(context, uid);
    if (user && (!user.disabled || !state.sessionsRevokedAt)) {
      await context.auth.updateUser(uid, { disabled: true });
      await context.auth.revokeRefreshTokens(uid);
      const revokedAt = clock(context);
      await job.update({ sessionsRevokedAt: revokedAt, settleAfter: revokedAt + 65 * 60_000 });
    }
    const found = await inventory(context, uid);
    if (found.blockers.length) {
      await job.update({ status: 'REVIEW_REQUIRED', blockers: found.blockers });
      return { jobId, status: 'REVIEW_REQUIRED', blockers: found.blockers };
    }
    await saveInventory(job, found);
    await deleteItems(context, job, uid);
    await checkpoint();
    state = (await job.get()).data();
    if (clock(context) < state.settleAfter) {
      await job.update({ status: 'PENDING_SESSION_EXPIRY' });
      return { jobId, status: 'PENDING_SESSION_EXPIRY', nextActionAt: state.settleAfter };
    }
    // Final post-expiry sweep catches uploads/requests that were already in flight at the fence.
    const final = await inventory(context, uid);
    if (final.blockers.length) {
      await job.update({ status: 'REVIEW_REQUIRED', blockers: final.blockers });
      return { jobId, status: 'REVIEW_REQUIRED', blockers: final.blockers };
    }
    await saveInventory(job, final);
    // Previously completed document items can reappear from pre-fence operations.
    for (const path of final.docs) if ((await context.db.doc(path).get()).exists) await context.db.doc(path).delete();
    await deleteItems(context, job, uid);
    await checkpoint();
    const remaining = await inventory(context, uid);
    const remainingDocs = await Promise.all(remaining.docs.map((path) => context.db.doc(path).get()));
    if (remaining.blockers.length || remaining.images.length || remaining.contributors.length || remaining.redact.length || remainingDocs.some((doc) => doc.exists)) throw new Error('FINAL_INVENTORY_NOT_EMPTY');
    if (await account(context, uid)) await context.auth.deleteUser(uid);
    if (await account(context, uid)) throw new Error('AUTH_DELETE_NOT_CONFIRMED');
    const [bucketMetadata] = await context.bucket.getMetadata();
    const retention = Number(bucketMetadata.softDeletePolicy?.retentionDurationSeconds || 0) * 1000;
    const items = (await job.collection('items').get()).docs.map((doc) => doc.data());
    const imageItems = items.filter((item) => item.kind === 'image');
    const purgeAfter = imageItems.reduce((last, item) => Math.max(last, (item.completedAt || clock(context)) + retention), 0);
    if (retention && clock(context) < purgeAfter) {
      await job.update({ status: 'ACTIVE_DATA_DELETED_PENDING_PROVIDER_RETENTION', purgeAfter });
      return { jobId, status: 'ACTIVE_DATA_DELETED_PENDING_PROVIDER_RETENTION', nextActionAt: purgeAfter };
    }
    {
      const known = new Set(items.filter((item) => ['image', 'retained'].includes(item.kind)).map((item) => `${item.path}:${item.generation}`));
      for await (const file of objects(context.bucket, { softDeleted: true })) {
        if (known.has(`${file.name}:${file.metadata.generation}`)) {
          await job.update({ status: 'PROVIDER_PURGE_NOT_CONFIRMED' });
          return { jobId, status: 'PROVIDER_PURGE_NOT_CONFIRMED', nextActionAt: Date.parse(file.metadata.hardDeleteTime || '') || null };
        }
      }
    }
    const counts = Object.fromEntries(['document', 'image', 'contributor', 'redact'].map((kind) => [kind, items.filter((item) => item.kind === kind).length]));
    // Keep the resumable parent until cleanup and COMPLETE can be committed atomically.
    await checkpoint();
    await context.db.recursiveDelete(job.collection('items'));
    await context.db.runTransaction(async (tx) => {
      const current = await tx.get(job);
      if (current.get('lease') !== lease) fail('LEASE_LOST');
      tx.delete(job);
      tx.delete(context.db.doc(`accountDeletionLocks/${uid}`));
      tx.set(context.db.doc(`accountDeletionReceipts/${jobId}`), { status: 'COMPLETE', counts, completedAt: clock(context) });
    });
    return { jobId, status: 'COMPLETE', counts };
  } catch (error) {
    if (acquired) await context.db.runTransaction(async (tx) => {
      const current = await tx.get(job);
      if (current.exists && current.get('lease') === lease) tx.update(job, { status: 'PARTIAL_FAILURE', errorCode: 'RETRY_REQUIRED' });
    });
    return { jobId, status: error.message === 'JOB_BUSY' ? 'IN_PROGRESS' : 'PARTIAL_FAILURE' };
  } finally {
    if (acquired) await context.db.runTransaction(async (tx) => {
      const current = await tx.get(job);
      if (current.exists && current.get('lease') === lease) tx.update(job, { leaseUntil: 0, lease: null });
    });
  }
}

export async function deletionRequest(request, context = services()) {
  try {
    const actor = await actorFor(request, context);
    if (!context.deletionEnabled && process.env.ACCOUNT_DELETION_READY !== 'verified-v1') fail('DELETION_DISABLED', 503);
    if (clock(context) - actor.authTime > 5 * 60_000) fail('RECENT_LOGIN_REQUIRED', 401);
    const body = await request.json();
    const uid = body.uid || actor.uid;
    if (!safeUid(uid) || body.confirm !== 'DELETE_DOMIDEX_ACCOUNT') fail('INVALID_REQUEST', 400);
    if (uid !== actor.uid && !actor.admin) fail('ACCESS_DENIED', 403);
    if (body.jobId) {
      if (!/^[0-9a-f-]{36}$/.test(body.jobId)) fail('INVALID_REQUEST', 400);
      const receipt = await context.db.doc(`accountDeletionReceipts/${body.jobId}`).get();
      if (receipt.exists && actor.admin) return json({ jobId: body.jobId, ...receipt.data() });
      return json(await advanceDeletion(context, uid, body.jobId));
    }
    const lock = context.db.doc(`accountDeletionLocks/${uid}`);
    const existing = await lock.get();
    if (existing.exists) return json(await advanceDeletion(context, uid, existing.get('jobId')));
    if (!await account(context, uid)) fail('NOT_FOUND', 404);
    const found = await inventory(context, uid);
    if (found.blockers.length) return json({ status: 'REVIEW_REQUIRED', blockers: found.blockers, destructiveChanges: false }, 409);
    const jobId = randomUUID();
    const now = clock(context);
    await context.db.runTransaction(async (tx) => {
      if ((await tx.get(lock)).exists) fail('JOB_BUSY');
      tx.create(lock, { jobId, startedAt: now });
      tx.create(context.db.doc(`accountDeletionJobs/${jobId}`), { uid, startedAt: now, status: 'STARTED', settleAfter: now + 65 * 60_000, leaseUntil: 0 });
    });
    return json(await advanceDeletion(context, uid, jobId), 202);
  } catch (error) { return failure(error); }
}

export async function deletionStatus(request, context = services()) {
  try {
    await actorFor(request, context, 'admin');
    const jobId = new URL(request.url).searchParams.get('jobId');
    if (!/^[0-9a-f-]{36}$/.test(jobId || '')) fail('INVALID_REQUEST', 400);
    const receipt = await context.db.doc(`accountDeletionReceipts/${jobId}`).get();
    if (receipt.exists) return json({ jobId, ...receipt.data() });
    const doc = await context.db.doc(`accountDeletionJobs/${jobId}`).get();
    if (!doc.exists) fail('NOT_FOUND', 404);
    const value = doc.data();
    return json({ jobId, status: value.status, nextActionAt: value.purgeAfter || value.settleAfter, blockers: value.blockers || [] });
  } catch (error) { return failure(error); }
}
