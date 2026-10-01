'use client';

import { useEffect, useMemo, useState } from 'react';
import { collectionPriceIdentity, type CollectionEntry } from '@/lib/domain';
import { resolveCollectionPrice, type CollectionPriceResult } from '@/lib/collection-prices';
import { subscribeCollectionPriceSelections } from '@/lib/collection-price-selections';
import type { CollectionPriceSelection } from '@/lib/price-alternatives';
import { loadCard } from '@/lib/tcgdex';

export function useCollectionPrices(entries: CollectionEntry[], ownerUid?: string) {
  const [results, setResults] = useState<{ owner?: string; values: Record<string, CollectionPriceResult> }>({ values: {} });
  const [selectionState, setSelectionState] = useState<{ owner?: string; values: Record<string, CollectionPriceSelection>; ready: boolean; failed: boolean }>({ values: {}, ready: true, failed: false });
  const [attempt, setAttempt] = useState(0);
  const [selectionAttempt, setSelectionAttempt] = useState(0);
  useEffect(() => {
    if (!ownerUid) { setSelectionState({ values: {}, ready: true, failed: false }); return; }
    setSelectionState({ owner: ownerUid, values: {}, ready: false, failed: false });
    // Each effect is a separate registration generation, even when the same UID returns.
    let active = true; let stop: (() => void) | undefined;
    void subscribeCollectionPriceSelections(ownerUid,
      (values) => { if (active) setSelectionState({ owner: ownerUid, values, ready: true, failed: false }); },
      () => { if (active) setSelectionState({ owner: ownerUid, values: {}, ready: true, failed: true }); })
      .then((unsubscribe) => { if (active) stop = unsubscribe; else unsubscribe(); })
      .catch(() => { if (active) setSelectionState({ owner: ownerUid, values: {}, ready: true, failed: true }); });
    return () => { active = false; stop?.(); };
  }, [ownerUid, selectionAttempt]);
  useEffect(() => {
    let active = true;
    setResults({ owner: ownerUid, values: {} });
    if (ownerUid && (selectionState.owner !== ownerUid || !selectionState.ready)) return () => { active = false; };
    void (async () => {
      // One bounded batch at a time, not a restart after every individual price result.
      for (let index = 0; active && index < entries.length; index += 6) {
        const chunk = entries.slice(index, index + 6);
        const resolved = await Promise.all(chunk.map(async (entry) => [entry.syncId, await resolveCollectionPrice(entry, loadCard, selectionState.values[entry.syncId])] as const));
        if (active) setResults((current) => ({ owner: ownerUid, values: { ...current.values, ...Object.fromEntries(resolved) } }));
      }
    })();
    return () => { active = false; };
  }, [entries, ownerUid, attempt, selectionState]);

  const state = useMemo(() => {
    const prices: Record<string, number | null> = {};
    const priceSources: Record<string, CollectionPriceResult['source']> = {};
    const failed = new Set<string>();
    let pending = 0;
    for (const entry of entries) {
      const result = results.owner === ownerUid ? results.values[entry.syncId] : undefined;
      if (!result || result.identity !== collectionPriceIdentity(entry)) { pending++; continue; }
      prices[entry.syncId] = result.price;
      priceSources[entry.syncId] = result.source;
      if (result.failed) failed.add(entry.syncId);
    }
    return { prices, priceSources, failed, pending };
  }, [entries, results, ownerUid]);
  const selections = selectionState.owner === ownerUid ? selectionState.values : {};
  const selectionSyncFailed = selectionState.owner === ownerUid && selectionState.failed;
  return { ...state, selections, selectionSyncFailed, retry: () => {
    // A terminal listener error needs a new subscription, not just another price lookup.
    if (selectionSyncFailed) setSelectionAttempt((value) => value + 1);
    else setAttempt((value) => value + 1);
  } };
}
