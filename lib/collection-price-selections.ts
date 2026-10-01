'use client';

import type { DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { isQuarantinedCardmarketIdentity } from './cardmarket-identity';
import { canonicalTcgCardId } from './domain';
import {
  collectionPriceMetricMatchesFinish,
  collectionPriceMetrics,
  isCollectionPriceMetric,
  type AlternativePriceCandidate,
  type CollectionPriceMetric,
  type CollectionPriceSelection,
} from './price-alternatives';

const nullableFields = [
  'sourceSetId', 'sourceCardId', 'collectorNumber', 'language', 'finish', 'variant',
  'productId', 'metric', 'amountMinor', 'currency', 'sourceAt', 'selectedAt',
] as const;
const entrySyncIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

export async function subscribeCollectionPriceSelections(
  ownerUid: string,
  next: (selections: Record<string, CollectionPriceSelection>) => void,
  fail: (error: Error) => void,
) {
  const [{ collection, onSnapshot }, { firestore }] = await Promise.all([import('firebase/firestore'), import('./firebase-client')]);
  let active = true;
  const unsubscribe = onSnapshot(collection(firestore, 'users', ownerUid, 'collectionPriceSelections'), (snapshot) => {
    if (!active) return;
    const selections: Record<string, CollectionPriceSelection> = {};
    for (const item of snapshot.docs) {
      const decoded = decodeCollectionPriceSelection(item.data(), item.id, ownerUid);
      if (decoded) selections[item.id] = decoded;
    }
    next(selections);
  }, (error) => { if (active) { active = false; fail(error); } });
  return () => { active = false; unsubscribe(); };
}

export async function saveCollectionPriceSelection(user: User, entrySyncId: string, candidate: AlternativePriceCandidate) {
  if (!entrySyncIdPattern.test(entrySyncId)) throw new Error('Ungültige Sammlungs-ID.');
  if (!collectionPriceMetrics.includes(candidate.metric) || !Number.isSafeInteger(candidate.productId) || candidate.productId <= 0
    || !Number.isSafeInteger(candidate.amountMinor) || candidate.amountMinor <= 0 || candidate.currency !== 'EUR'
    || !Number.isSafeInteger(candidate.sourceAt) || candidate.sourceAt <= 0) throw new Error('Ungültige Preiskennzahl.');
  const [{ doc, runTransaction, serverTimestamp }, { firestore }] = await Promise.all([import('firebase/firestore'), import('./firebase-client')]);
  const reference = doc(firestore, 'users', user.uid, 'collectionPriceSelections', entrySyncId);
  const entryReference = doc(firestore, 'users', user.uid, 'collectionEntries', entrySyncId);
  await runTransaction(firestore, async (transaction) => {
    const [selectionSnapshot, entrySnapshot] = await Promise.all([transaction.get(reference), transaction.get(entryReference)]);
    const identity = exactEntryIdentity(entrySnapshot.data(), entrySyncId, user.uid);
    if (!entrySnapshot.exists() || !identity) throw new Error('Die exakte Kartenidentität ist nicht mehr verfügbar.');
    if (identity.productId !== candidate.productId
      || !collectionPriceMetricMatchesFinish(candidate.metric, identity.fields.finish)
      || isQuarantinedCardmarketIdentity(canonicalTcgCardId(identity.fields.sourceCardId), candidate.productId)) {
      throw new Error('Der Preis gehört nicht zur ausgewählten Kartenvariante.');
    }
    const previous = selectionSnapshot.exists() ? decodeCollectionPriceSelection(selectionSnapshot.data(), entrySyncId, user.uid) : null;
    if (selectionSnapshot.exists() && !previous) throw new Error('Die vorhandene Preisauswahl ist ungültig.');
    const now = Date.now();
    transaction.set(reference, {
      schemaVersion: 1,
      ownerUid: user.uid,
      entrySyncId,
      revision: (previous?.revision ?? 0) + 1,
      lastMutationId: crypto.randomUUID(),
      updatedAt: serverTimestamp(),
      updatedAtClient: now,
      cleared: false,
      ...identity.fields,
      productId: candidate.productId,
      metric: candidate.metric,
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      sourceAt: candidate.sourceAt,
      selectedAt: now,
    });
  });
}

export async function clearCollectionPriceSelection(user: User, entrySyncId: string) {
  if (!entrySyncIdPattern.test(entrySyncId)) throw new Error('Ungültige Sammlungs-ID.');
  const [{ doc, runTransaction, serverTimestamp }, { firestore }] = await Promise.all([import('firebase/firestore'), import('./firebase-client')]);
  const reference = doc(firestore, 'users', user.uid, 'collectionPriceSelections', entrySyncId);
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) return;
    const previous = decodeCollectionPriceSelection(snapshot.data(), entrySyncId, user.uid);
    if (!previous) throw new Error('Die vorhandene Preisauswahl ist ungültig.');
    const cleared = Object.fromEntries(nullableFields.map((field) => [field, null]));
    transaction.set(reference, {
      schemaVersion: 1,
      ownerUid: user.uid,
      entrySyncId,
      revision: previous.revision + 1,
      lastMutationId: crypto.randomUUID(),
      updatedAt: serverTimestamp(),
      updatedAtClient: Date.now(),
      cleared: true,
      ...cleared,
    });
  });
}

export function decodeCollectionPriceSelection(data: DocumentData, id: string, ownerUid: string): CollectionPriceSelection | null {
  if (!entrySyncIdPattern.test(id) || data.schemaVersion !== 1 || data.ownerUid !== ownerUid || data.entrySyncId !== id
    || !Number.isSafeInteger(data.revision) || data.revision < 1
    || typeof data.lastMutationId !== 'string' || !data.lastMutationId.match(/^[A-Za-z0-9._-]{1,128}$/)
    || !Number.isSafeInteger(data.updatedAtClient) || data.updatedAtClient <= 0 || typeof data.cleared !== 'boolean') return null;
  if (data.cleared) {
    if (nullableFields.some((field) => data[field] !== null)) return null;
    return { schemaVersion: 1, ownerUid, entrySyncId: id, revision: data.revision, lastMutationId: data.lastMutationId,
      updatedAtClient: data.updatedAtClient, cleared: true, sourceSetId: null, sourceCardId: null,
      collectorNumber: null, language: null, finish: null, variant: null, productId: null, metric: null,
      amountMinor: null, currency: null, sourceAt: null, selectedAt: null };
  }
  if (!boundedString(data.sourceSetId, 120) || !boundedString(data.sourceCardId, 120)
    || !boundedString(data.collectorNumber, 80) || !canonicalLanguage(data.language)
    || !boundedString(data.finish, 80) || !boundedString(data.variant, 80)
    || !Number.isSafeInteger(data.productId) || data.productId <= 0 || !isCollectionPriceMetric(data.metric)
    || !collectionPriceMetricMatchesFinish(data.metric, data.finish)
    || !Number.isSafeInteger(data.amountMinor) || data.amountMinor <= 0 || data.currency !== 'EUR'
    || !Number.isSafeInteger(data.sourceAt) || data.sourceAt <= 0
    || !Number.isSafeInteger(data.selectedAt) || data.selectedAt <= 0) return null;
  return {
    schemaVersion: 1, ownerUid, entrySyncId: id, revision: data.revision, lastMutationId: data.lastMutationId,
    updatedAtClient: data.updatedAtClient, cleared: false, sourceSetId: data.sourceSetId, sourceCardId: data.sourceCardId,
    collectorNumber: data.collectorNumber, language: data.language, finish: data.finish, variant: data.variant,
    productId: data.productId, metric: data.metric as CollectionPriceMetric, amountMinor: data.amountMinor,
    currency: 'EUR', sourceAt: data.sourceAt, selectedAt: data.selectedAt,
  };
}

function exactEntryIdentity(data: DocumentData | undefined, id: string, ownerUid: string) {
  if (!data || data.ownerUid !== ownerUid || data.syncId !== id || data.deleted === true
    || !boundedString(data.sourceSetId, 120) || !boundedString(data.sourceCardId, 120)
    || !boundedString(data.collectorNumber, 80) || !canonicalLanguage(data.language)
    || !boundedString(data.finish, 80) || !boundedString(data.variant, 80) || data.externalProductSource !== 'CARDMARKET_PUBLIC_DOWNLOAD'
    || !Number.isSafeInteger(data.externalProductId) || data.externalProductId <= 0) return null;
  return {
    productId: data.externalProductId as number,
    fields: {
      sourceSetId: data.sourceSetId as string,
      sourceCardId: data.sourceCardId as string,
      collectorNumber: data.collectorNumber as string,
      language: data.language as string,
      finish: data.finish as string,
      variant: data.variant as string,
    },
  };
}

function nonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function boundedString(value: unknown, max: number): value is string { return nonEmptyString(value) && value.length <= max; }
function canonicalLanguage(value: unknown): value is string { return boundedString(value, 30) && /^[A-Z_]{2,30}$/.test(value); }
