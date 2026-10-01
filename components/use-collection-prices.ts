'use client';

import { useEffect, useMemo, useState } from 'react';
import { collectionPriceIdentity, type CollectionEntry } from '@/lib/domain';
import { resolveCollectionPrice, type CollectionPriceResult } from '@/lib/collection-prices';
import { subscribeCollectionPriceSelections } from '@/lib/collection-price-selections';
import type { CollectionPriceSelection } from '@/lib/price-alternatives';
import { loadCardWithCacheInfo } from '@/lib/tcgdex';

type Generation = object;
type ResolvedPrice = { fingerprint: string; attempt: number; cacheExpiresAt: number | null; result: CollectionPriceResult };
type PriceWork = { fingerprint: string; attempt: number; promise: Promise<ResolvedPrice> };

function priceInputFingerprint(entry: CollectionEntry, selection?: CollectionPriceSelection) {
  // Include every resolver/manual-selection input, not just collectionPriceIdentity.
  // Raw strings matter: persisted manual selections require exact identity equality.
  return JSON.stringify([
    entry.ownerUid, entry.syncId, entry.deleted, entry.sourceCardId, entry.sourceSetId,
    entry.collectorNumber, entry.language, entry.finish, entry.variant,
    entry.externalProductSource, entry.externalProductId,
    selection ? [selection.schemaVersion, selection.ownerUid, selection.entrySyncId, selection.revision,
      selection.lastMutationId, selection.updatedAtClient, selection.cleared, selection.sourceSetId,
      selection.sourceCardId, selection.collectorNumber, selection.language, selection.finish,
      selection.variant, selection.productId, selection.metric, selection.amountMinor,
      selection.currency, selection.sourceAt, selection.selectedAt] : null,
  ]);
}

export function useCollectionPrices(entries: CollectionEntry[], ownerUid?: string) {
  const [results, setResults] = useState<{ generation?: Generation; values: Record<string, ResolvedPrice> }>({ values: {} });
  const [selectionState, setSelectionState] = useState<{ generation?: Generation; values: Record<string, CollectionPriceSelection>; ready: boolean; failed: boolean }>({ values: {}, ready: true, failed: false });
  const [attempt, setAttempt] = useState(0);
  const [selectionAttempt, setSelectionAttempt] = useState(0);
  // Object identity prevents A -> B -> A and permission regrant from reviving an old result.
  const generation = useMemo(() => ({ ownerUid, selectionAttempt }), [ownerUid, selectionAttempt]);
  const workState = useMemo(() => ({ generation, completed: new Map<string, ResolvedPrice>(), pending: new Map<string, PriceWork>() }), [generation]);
  useEffect(() => {
    if (!ownerUid) { setSelectionState({ values: {}, ready: true, failed: false }); return; }
    setSelectionState({ generation, values: {}, ready: false, failed: false });
    // Each effect is a separate registration generation, even when the same UID returns.
    let active = true; let stop: (() => void) | undefined;
    void subscribeCollectionPriceSelections(ownerUid,
      (values) => { if (active) setSelectionState({ generation, values, ready: true, failed: false }); },
      () => { if (active) setSelectionState({ generation, values: {}, ready: true, failed: true }); })
      .then((unsubscribe) => { if (active) stop = unsubscribe; else unsubscribe(); })
      .catch(() => { if (active) setSelectionState({ generation, values: {}, ready: true, failed: true }); });
    return () => { active = false; stop?.(); };
  }, [ownerUid, generation]);
  const inputs = useMemo(() => entries.map((entry) => {
    const selection = selectionState.generation === generation ? selectionState.values[entry.syncId] : undefined;
    return { entry, selection, fingerprint: priceInputFingerprint(entry, selection) };
  }), [entries, selectionState, generation]);
  useEffect(() => {
    let active = true;
    if (!ownerUid || selectionState.generation !== generation || !selectionState.ready) {
      setResults({ generation, values: {} });
      return () => { active = false; };
    }
    const ids = new Set(inputs.map(({ entry }) => entry.syncId));
    for (const id of workState.completed.keys()) if (!ids.has(id)) workState.completed.delete(id);
    for (const id of workState.pending.keys()) if (!ids.has(id)) workState.pending.delete(id);
    const retained: Record<string, ResolvedPrice> = {};
    const needed = inputs.filter(({ entry, fingerprint }) => {
      const previous = workState.completed.get(entry.syncId);
      if (previous && previous.fingerprint === fingerprint && previous.attempt === attempt && !previous.result.failed
        && (previous.cacheExpiresAt === null || Date.now() < previous.cacheExpiresAt)) {
        retained[entry.syncId] = previous;
        return false;
      }
      workState.completed.delete(entry.syncId);
      return true;
    });
    setResults({ generation, values: retained });
    void (async () => {
      // Preserve the existing six-at-a-time chunk barrier; only the work selection changes.
      for (let index = 0; active && index < needed.length; index += 6) {
        const chunk = needed.slice(index, index + 6);
        const resolved = await Promise.all(chunk.map(async ({ entry, selection, fingerprint }) => {
          let work = workState.pending.get(entry.syncId);
          if (!work || work.fingerprint !== fingerprint || work.attempt !== attempt) {
            let cacheExpiresAt: number | null = null;
            const promise = resolveCollectionPrice(entry, (id) => {
              const snapshot = loadCardWithCacheInfo(id);
              cacheExpiresAt = snapshot.cacheExpiresAt;
              return snapshot.promise;
            }, selection).then((result) => {
              const completed = { fingerprint, attempt, cacheExpiresAt, result };
              if (workState.pending.get(entry.syncId) === work) {
                workState.pending.delete(entry.syncId);
                workState.completed.set(entry.syncId, completed);
              }
              return completed;
            });
            work = { fingerprint, attempt, promise };
            workState.pending.set(entry.syncId, work);
          }
          return [entry.syncId, await work.promise] as const;
        }));
        if (active) setResults((current) => ({ generation, values: { ...(current.generation === generation ? current.values : {}), ...Object.fromEntries(resolved) } }));
      }
    })();
    return () => { active = false; };
  }, [inputs, ownerUid, attempt, selectionState, generation, workState]);

  const state = useMemo(() => {
    const prices: Record<string, number | null> = {};
    const priceSources: Record<string, CollectionPriceResult['source']> = {};
    const failed = new Set<string>();
    let pending = 0;
    for (const { entry, fingerprint } of inputs) {
      const completed = ownerUid && results.generation === generation ? results.values[entry.syncId] : undefined;
      const result = completed?.result;
      if (!completed || completed.fingerprint !== fingerprint || completed.attempt !== attempt
        || !result || result.identity !== collectionPriceIdentity(entry)) { pending++; continue; }
      prices[entry.syncId] = result.price;
      priceSources[entry.syncId] = result.source;
      if (result.failed) failed.add(entry.syncId);
    }
    return { prices, priceSources, failed, pending };
  }, [inputs, results, ownerUid, generation, attempt]);
  const selections = selectionState.generation === generation ? selectionState.values : {};
  const selectionSyncFailed = selectionState.generation === generation && selectionState.failed;
  return { ...state, selections, selectionSyncFailed, retry: () => {
    // A terminal listener error needs a new subscription, not just another price lookup.
    if (selectionSyncFailed) setSelectionAttempt((value) => value + 1);
    else setAttempt((value) => value + 1);
  } };
}
