'use client';

import type { DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { isQuarantinedCardmarketIdentity } from './cardmarket-identity';
import { canonicalTcgCardId } from './domain';
import { ownerDocumentState } from './owner-document-state';
import { decodeCollectionPriceSelection, collectionPriceSelectionNullableFields as nullableFields } from './collection-price-selection-codec';
export { decodeCollectionPriceSelection } from './collection-price-selection-codec';
import {
  collectionPriceMetricMatchesFinish,
  collectionPriceMetrics,
  type AlternativePriceCandidate,
  type CollectionPriceSelection,
} from './price-alternatives';

const entrySyncIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

export async function subscribeCollectionPriceSelections(
  ownerUid: string,
  next: (selections: Record<string, CollectionPriceSelection>) => void,
  fail: (error: Error) => void,
) {
  const [{ collection, onSnapshot }, { firestore }] = await Promise.all([import('firebase/firestore'), import('./firebase-client')]);
  let active = true;
  const update = ownerDocumentState((data, id) => decodeCollectionPriceSelection(data, id, ownerUid));
  const unsubscribe = onSnapshot(collection(firestore, 'users', ownerUid, 'collectionPriceSelections'), (snapshot) => {
    if (!active) return;
    const selections = update(snapshot);
    if (selections !== null) next(Object.fromEntries(selections.map((selection) => [selection.entrySyncId, selection])));
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
