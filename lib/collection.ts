'use client';

import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { CollectionEntry, TcgCardDetail, TcgVariant } from './domain';
import { exactTrendPrice } from './domain';
import { firestore } from './firebase-client';
import { imageUrl } from './tcgdex';

const SOURCE = 'CARDMARKET_PUBLIC_DOWNLOAD';

export function subscribeCollection(user: User, next: (entries: CollectionEntry[]) => void, fail: (error: Error) => void) {
  return onSnapshot(
    collection(firestore, 'users', user.uid, 'collectionEntries'),
    (snapshot) => next(snapshot.docs
      .map((item) => decodeEntry(item.data(), item.id, user.uid))
      .filter((entry): entry is CollectionEntry => Boolean(entry))
      .filter((entry) => !entry.deleted)),
    (error) => fail(error),
  );
}

export async function addExactCard(
  user: User,
  card: TcgCardDetail,
  selectedVariant: TcgVariant,
  quantity: number,
  current: CollectionEntry[],
) {
  const safeQuantity = Math.max(1, Math.min(10_000, Math.trunc(quantity)));
  const finish = normalizeFinish(selectedVariant.type);
  const variant = selectedVariant.stamp?.length
    ? `${selectedVariant.size ?? 'Standard'} · ${selectedVariant.stamp.join(', ')}`
    : selectedVariant.foil ? `${selectedVariant.size ?? 'Standard'} · ${selectedVariant.foil}` : selectedVariant.size ?? 'Standard';
  const productId = selectedVariant.pricing?.cardmarket?.idProduct ?? card.pricing?.cardmarket?.idProduct ?? null;
  const exact = current.find((entry) =>
    entry.sourceSetId === card.set.id && entry.sourceCardId === card.id
    && entry.finish === finish && entry.variant === variant && entry.condition === 'Near Mint');
  const syncId = exact?.syncId ?? await deterministicWebSyncId(user.uid, card.set.id, card.id, finish, variant);
  const reference = doc(firestore, 'users', user.uid, 'collectionEntries', syncId);

  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists()) {
      const remote = decodeEntry(snapshot.data(), syncId, user.uid);
      if (!remote) throw new Error('Der vorhandene Collection-Eintrag ist ungültig.');
      if (remote.deleted) throw new Error('Diese Kartengeneration wurde bereits entfernt. Bitte erneut suchen.');
      transaction.update(reference, {
        quantity: Math.min(10_000, remote.quantity + safeQuantity),
        revision: remote.revision + 1,
        lastMutationId: crypto.randomUUID(),
        updatedAt: serverTimestamp(),
        updatedAtClient: Date.now(),
      });
      return;
    }
    const binderSetKey = `tcgdex-${card.set.id.toLowerCase()}`;
    const created: Omit<CollectionEntry, 'updatedAtClient'> & { updatedAt: ReturnType<typeof serverTimestamp>; updatedAtClient: number } = {
      syncId,
      ownerUid: user.uid,
      revision: 1,
      lastMutationId: crypto.randomUUID(),
      updatedAt: serverTimestamp(),
      updatedAtClient: Date.now(),
      deleted: false,
      deletedAtClient: null,
      name: card.name.slice(0, 200),
      setId: card.set.id.slice(0, 120),
      setName: card.set.name.slice(0, 200),
      collectorNumber: card.localId.slice(0, 80),
      language: 'GERMAN',
      finish,
      variant: variant.slice(0, 80),
      rarity: (card.rarity ?? 'UNKNOWN').slice(0, 80),
      quantity: safeQuantity,
      condition: 'Near Mint',
      notes: '',
      acquisitionPriceMinor: null,
      acquisitionCurrency: null,
      acquisitionDateEpochDay: null,
      externalProductSource: productId ? SOURCE : null,
      externalProductId: productId,
      imageUrl: imageUrl(card.image, 'high'),
      effectOverride: null,
      binderId: binderSetKey,
      sourceSetId: card.set.id.toLowerCase(),
      sourceCardId: card.id.toLowerCase(),
      binderSetKey,
      binderName: card.set.name.slice(0, 200),
      binderHeroAsset: card.set.logo ? `${card.set.logo}.webp` : null,
    };
    transaction.set(reference, created);
  });

  return exactTrendPrice(card, selectedVariant);
}

export async function changeQuantity(user: User, entry: CollectionEntry, delta: number) {
  const reference = doc(firestore, 'users', user.uid, 'collectionEntries', entry.syncId);
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists() ? decodeEntry(snapshot.data(), entry.syncId, user.uid) : null;
    if (!current || current.deleted) throw new Error('Die Karte ist nicht mehr verfügbar.');
    const nextQuantity = current.quantity + delta;
    const common = {
      revision: current.revision + 1,
      lastMutationId: crypto.randomUUID(),
      updatedAt: serverTimestamp(),
      updatedAtClient: Date.now(),
    };
    if (nextQuantity <= 0) {
      transaction.update(reference, { ...common, deleted: true, deletedAtClient: Date.now() });
    } else {
      transaction.update(reference, { ...common, quantity: Math.min(10_000, nextQuantity) });
    }
  });
}

function decodeEntry(data: DocumentData, id: string, uid: string): CollectionEntry | null {
  if (data.ownerUid !== uid || data.syncId !== id || !Number.isInteger(data.revision) || data.revision < 1) return null;
  const sourceSetId = stringOrNull(data.sourceSetId);
  const sourceCardId = stringOrNull(data.sourceCardId);
  if ((sourceSetId === null) !== (sourceCardId === null)) return null;
  return {
    syncId: id, ownerUid: uid, revision: data.revision, lastMutationId: String(data.lastMutationId ?? ''),
    updatedAtClient: Number(data.updatedAtClient ?? 0), deleted: data.deleted === true,
    deletedAtClient: numberOrNull(data.deletedAtClient), name: String(data.name ?? ''), setId: String(data.setId ?? ''),
    setName: String(data.setName ?? ''), collectorNumber: String(data.collectorNumber ?? ''), language: String(data.language ?? ''),
    finish: String(data.finish ?? ''), variant: String(data.variant ?? ''), rarity: String(data.rarity ?? 'UNKNOWN'),
    quantity: Math.max(1, Number(data.quantity ?? 1)), condition: String(data.condition ?? ''), notes: String(data.notes ?? ''),
    acquisitionPriceMinor: numberOrNull(data.acquisitionPriceMinor), acquisitionCurrency: stringOrNull(data.acquisitionCurrency),
    acquisitionDateEpochDay: numberOrNull(data.acquisitionDateEpochDay), externalProductSource: stringOrNull(data.externalProductSource),
    externalProductId: numberOrNull(data.externalProductId), imageUrl: stringOrNull(data.imageUrl), effectOverride: stringOrNull(data.effectOverride),
    binderId: String(data.binderId ?? 'inbox'), sourceSetId, sourceCardId,
    binderSetKey: String(data.binderSetKey ?? 'inbox'), binderName: String(data.binderName ?? 'Ohne Setzuordnung'),
    binderHeroAsset: stringOrNull(data.binderHeroAsset),
  };
}

function normalizeFinish(value: string) {
  if (/reverse/i.test(value)) return 'Reverse Holo';
  if (/holo/i.test(value)) return 'Holo';
  return 'Normal';
}

function stringOrNull(value: unknown) { return typeof value === 'string' ? value : null; }
function numberOrNull(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

async function deterministicWebSyncId(...parts: string[]) {
  const bytes = new TextEncoder().encode(parts.map((part) => part.trim().toLowerCase()).join('|'));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
