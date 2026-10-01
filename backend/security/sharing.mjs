import { createHash, randomBytes } from 'node:crypto';
import { actorFor, fail, failure, services } from './firebase.mjs';
import { publicCardId, sharedCardDto, sharedVisualId, sharedPriceSelectionNeeded, SHARED_PRICE_MAX_EUR } from '../../lib/shared-binder.ts';
import { decodeCollectionPriceSelection } from '../../lib/collection-price-selection-codec.ts';
import { boundedJson } from '../../lib/bounded-json.ts';
import { consumeWriteQuota } from './rate-limit.mjs';
import { createPublicCatalogCache } from './public-catalog-cache.mjs';
import { readPublicCatalogResponse } from './public-catalog-response.mjs';
import { supplementalCard } from '../../lib/catalog-supplement.ts';
import { enrichAnniversaryPrices } from '../../lib/server/cardmarket-anniversary-prices.ts';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const respond = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' } });
function enabled(context) {
  // UI remains read-only/unavailable until cross-device visual/security review is complete.
  if (!(context.sharingEnabled ?? (process.env.BINDER_SHARING_READY === 'verified-v1'))) fail('NOT_FOUND', 404);
}
async function input(request) {
  return boundedJson(request, 2048);
}
function options(value) {
  for (const key of ['showPrices', 'showTotal', 'showDisplayName']) if (key in value && typeof value[key] !== 'boolean') fail('INVALID_REQUEST', 400);
  return { showPrices: value.showPrices === true, showTotal: value.showTotal === true, showDisplayName: value.showDisplayName === true };
}
async function ownedBinder(context, uid, id) {
  if (!safeId(id)) fail('INVALID_REQUEST', 400);
  const binder = (await context.db.doc(`users/${uid}/privateBinders/${id}`).get()).data();
  if (!binder || binder.ownerUid !== uid || binder.deleted === true || binder.binderId !== id) fail('NOT_FOUND', 404);
  return binder;
}
async function ownerStillAllowed(context, uid) {
  if (!safeId(uid)) return false;
  const [user, status, lock] = await Promise.all([context.auth.getUser(uid).catch(() => null), context.db.doc(`accountAccess/${uid}`).get(), context.db.doc(`accountDeletionLocks/${uid}`).get()]);
  const access = status.data() || {};
  const allowed = (role) => user?.customClaims?.[role] === true && (!(role in access) || access[role] === true);
  return Boolean(user && !user.disabled && !lock.exists && access.disabled !== true && (allowed('admin') || allowed('appAccess')));
}

export async function createBinderShare(request, context = services()) {
  try {
    enabled(context);
    const actor = await actorFor(request, context, 'app');
    const body = await input(request);
    if (!body || body.confirm !== true) fail('CONFIRMATION_REQUIRED', 400);
    await ownedBinder(context, actor.uid, body.binderId);
    const flags = options(body);
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (flags.showDisplayName && (!displayName || displayName.length > 60 || /[@\r\n]/.test(displayName))) fail('INVALID_REQUEST', 400);
    await consumeWriteQuota(context, 'shareCreate', actor.uid);
    const token = randomBytes(32).toString('base64url');
    const shareId = digest(token);
    const now = Date.now();
    await context.db.doc(`privateBinderShares/${shareId}`).create({
      ownerUid: actor.uid, binderId: body.binderId, ...flags,
      ...(flags.showDisplayName ? { displayName } : {}), createdAt: now, revokedAt: null,
    });
    return respond({ shareId, path: `/share/${token}`, createdAt: now, options: flags }, 201);
  } catch (error) { return failure(error); }
}
export async function listBinderShares(request, context = services()) {
  try {
    enabled(context);
    const actor = await actorFor(request, context, 'app');
    const binderId = new URL(request.url).searchParams.get('binderId');
    if (binderId === null) {
      const snapshots = await context.db.collection(`users/${actor.uid}/privateBinders`).limit(501).get();
      if (snapshots.size > 500) fail('SERVER_OPERATION_FAILED', 503);
      const binders = snapshots.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
        .filter(({ id, data }) => safeId(id) && data.binderId === id && data.ownerUid === actor.uid && data.deleted !== true)
        .map(({ id, data }) => ({ binderId: id, name: typeof data.name === 'string' ? data.name.slice(0, 100) : 'Privater Binder', coverStyle: sharedVisualId(data.coverStyle, true) }))
        .sort((left, right) => left.name.localeCompare(right.name, 'de'));
      return respond({ binders });
    }
    await ownedBinder(context, actor.uid, binderId);
    const records = await context.db.collection('privateBinderShares').where('ownerUid', '==', actor.uid).get();
    // One equality query avoids requiring a new composite index. Raw tokens are never persisted.
    return respond({ shares: records.docs.filter((doc) => doc.data().binderId === binderId && doc.data().revokedAt === null).map((doc) => ({
      shareId: doc.id, createdAt: doc.data().createdAt, options: options(doc.data()),
    })) });
  } catch (error) { return failure(error); }
}
export async function revokeBinderShare(request, context = services()) {
  try {
    enabled(context);
    const actor = await actorFor(request, context, 'app');
    const body = await input(request);
    const shareId = typeof body.shareId === 'string' ? body.shareId : '';
    if (body.confirm !== true || !/^[a-f0-9]{64}$/.test(shareId)) fail('INVALID_REQUEST', 400);
    const reference = context.db.doc(`privateBinderShares/${shareId}`);
    await context.db.runTransaction(async (tx) => {
      const data = (await tx.get(reference)).data();
      if (!data || data.ownerUid !== actor.uid) fail('NOT_FOUND', 404);
      tx.update(reference, { revokedAt: Date.now() });
    });
    return respond({ ok: true });
  } catch (error) { return failure(error); }
}

async function catalogCard(id, signal, mode = 'raw') {
  const supplement = supplementalCard(id);
  let card;
  try {
    const response = await fetch(`https://api.tcgdex.net/v2/de/cards/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, signal });
    card = await readPublicCatalogResponse(response, signal);
  } catch { card = supplement; }
  if (!card || signal.aborted) return null;
  try {
    if (!card.image && supplement?.image) card.image = supplement.image;
    if (!card.image) {
      try {
        const english = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, signal });
        const fallback = await readPublicCatalogResponse(english, signal);
        if (fallback.id === card.id && fallback.set?.id === card.set?.id && fallback.localId === card.localId) card.image = fallback.image;
      } catch { /* Image-only exact-ID fallback; never borrow names, variants or prices. */ }
    }
    // Enrich before the allowlist projection: its exact-printing checks also inspect
    // subtype/root identity fields which are deliberately not exposed by the cache.
    if (signal.aborted) return null;
    const resolved = mode === 'prices' ? await enrichAnniversaryPrices(card, id) : card;
    return signal.aborted ? null : resolved;
  } catch { return null; }
}
const publicCatalog = createPublicCatalogCache({ load: catalogCard });
async function catalogCards(ids, context, withPrices) {
  const catalog = new Map(); const queue = [...new Set(ids)]; const signal = AbortSignal.timeout(12_000);
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length && !signal.aborted) {
      const id = queue.shift();
      catalog.set(id, await (context.cardFor ? context.cardFor(id, signal)
        : publicCatalog.get(id, signal, withPrices ? 'prices' : 'raw')));
    }
  }));
  return catalog;
}
function sharedPlacements(documents, ownerUid) {
  const records = documents.map((doc) => ({ id: doc.id, data: doc.data() })).filter(({ data }) => data.deleted !== true);
  const reserved = new Set();
  for (const { data } of records) {
    if (data.ownerUid !== ownerUid || !safeId(data.entrySyncId) || !Number.isSafeInteger(data.slotPosition) || data.slotPosition < 0 || data.slotPosition > 900000) fail('SERVER_OPERATION_FAILED', 503);
    reserved.add(data.slotPosition);
  }
  // A concurrent sync may temporarily put distinct placements in one slot.
  // Keep every card and reserve all requested slots before assigning overflow,
  // using stable document IDs rather than Firestore's incidental query order.
  // This is only the shared view: never mutate the owner's stored layout.
  records.sort((a, b) => a.data.slotPosition - b.data.slotPosition || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const used = new Set();
  let free = 0;
  return records.map(({ data }) => {
    if (!used.has(data.slotPosition)) {
      used.add(data.slotPosition);
      return data;
    }
    while (reserved.has(free)) free++;
    reserved.add(free);
    return { ...data, slotPosition: free++ };
  });
}
export async function readBinderShare(request, route, context = services()) {
  try {
    enabled(context);
    const { token } = await route.params;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail('NOT_FOUND', 404);
    const reference = context.db.doc(`privateBinderShares/${digest(token)}`);
    const share = (await reference.get()).data();
    if (!share || share.revokedAt !== null || !await ownerStillAllowed(context, share.ownerUid)) fail('NOT_FOUND', 404);
    const binder = await ownedBinder(context, share.ownerUid, share.binderId);
    const page = Number(new URL(request.url).searchParams.get('page') ?? '0');
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) fail('INVALID_REQUEST', 400);
    const snapshots = await context.db.collection(`users/${share.ownerUid}/privateBinderPlacements`).where('binderId', '==', share.binderId)
      .select('ownerUid', 'entrySyncId', 'slotPosition', 'deleted', 'holoEffectId', 'holoIntensity').limit(5001).get();
    if (snapshots.size > 5000) fail('SERVER_OPERATION_FAILED', 503);
    const placements = sharedPlacements(snapshots.docs, share.ownerUid);
    const pageCount = Math.max(1, Number.isSafeInteger(binder.minimumPageCount) ? binder.minimumPageCount : 1, ...placements.map((item) => Math.floor(item.slotPosition / 9) + 1));
    if (page >= pageCount) fail('NOT_FOUND', 404);
    const needed = share.showTotal ? placements : placements.filter((item) => Math.floor(item.slotPosition / 9) === page);
    const entries = new Map();
    // Read only the selected binder's referenced entries, never the owner's full collection.
    const ids = [...new Set(needed.map((item) => item.entrySyncId))];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const refs = ids.slice(offset, offset + 100).map((id) => context.db.doc(`users/${share.ownerUid}/collectionEntries/${id}`));
      // Keep exact printing/price identity and access checks, without fetching
      // private notes, acquisition information or owner-supplied photo fields.
      for (const doc of refs.length ? await context.db.getAll(...refs, { fieldMask: [
        'ownerUid', 'syncId', 'deleted', 'quantity', 'sourceCardId', 'sourceSetId', 'setId',
        'collectorNumber', 'language', 'finish', 'variant', 'externalProductSource', 'externalProductId',
      ] }) : []) {
        const data = doc.data();
        if (data && data.ownerUid === share.ownerUid && data.deleted !== true && data.quantity > 0) entries.set(doc.id, data);
      }
    }
    const catalog = await catalogCards([...entries.values()].map(publicCardId).filter(Boolean), context, share.showPrices === true || share.showTotal === true);
    const selections = new Map();
    if (share.showPrices === true || share.showTotal === true) {
      // Never scan the owner's sidecar collection or cache private values with public metadata.
      // Existing trend prices and image-only sharing need no additional database reads.
      const selectionIds = [...entries].filter(([id, entry]) => entry.syncId === id
        && sharedPriceSelectionNeeded(entry, catalog.get(publicCardId(entry)) ?? null)).map(([id]) => id);
      for (let offset = 0; offset < selectionIds.length; offset += 100) {
        const refs = selectionIds.slice(offset, offset + 100).map((id) => context.db.doc(`users/${share.ownerUid}/collectionPriceSelections/${id}`));
        for (const doc of await context.db.getAll(...refs)) {
          const data = doc.data();
          const selection = data ? decodeCollectionPriceSelection(data, doc.id, share.ownerUid) : null;
          if (selection) selections.set(doc.id, selection);
        }
      }
    }
    const cards = []; const unavailableSlots = []; let pricedCards = 0; let visibleCards = 0; let cents = 0;
    for (const item of needed) {
      const entry = entries.get(item.entrySyncId);
      if (!entry) continue;
      visibleCards++;
      const card = sharedCardDto(entry, item, catalog.get(publicCardId(entry)) ?? null, share.showPrices === true || share.showTotal === true, selections.get(item.entrySyncId));
      if (!card) { if (Math.floor(item.slotPosition / 9) === page) unavailableSlots.push(item.slotPosition); continue; }
      if (card.price?.amount != null) { cents += Math.round(card.price.amount * 100); pricedCards++; }
      if (Math.floor(item.slotPosition / 9) === page) {
        if (share.showPrices !== true) delete card.price;
        cards.push(card);
      }
    }
    // Re-check after slow catalog work; concurrent revoke, access loss or binder deletion must win.
    if ((await reference.get()).data()?.revokedAt !== null || !await ownerStillAllowed(context, share.ownerUid)) fail('NOT_FOUND', 404);
    await ownedBinder(context, share.ownerUid, share.binderId);
    const dto = {
      title: typeof binder.name === 'string' ? binder.name.slice(0, 100) : 'Geteilter Binder', coverStyle: sharedVisualId(binder.coverStyle, true),
      page, pageCount, cards: cards.sort((a, b) => a.slot - b.slot), unavailableSlots,
      ...(share.showDisplayName === true ? { displayName: share.displayName } : {}),
      // Android also requires complete == (pricedCards == visibleCards) == (amount != null).
      // An unrepresentable complete sum omits the optional total, never invents counts or clamps.
      ...(share.showTotal === true && (pricedCards !== visibleCards || cents <= SHARED_PRICE_MAX_EUR * 100)
        ? { total: { amount: pricedCards === visibleCards ? cents / 100 : null, currency: 'EUR', complete: pricedCards === visibleCards, pricedCards, visibleCards } } : {}),
    };
    return respond(dto);
  } catch (error) { return failure(error); }
}
