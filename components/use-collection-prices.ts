'use client';

import { useEffect, useMemo, useState } from 'react';
import { collectionPriceIdentity, type CollectionEntry } from '@/lib/domain';
import { resolveCollectionPrice, type CollectionPriceResult } from '@/lib/collection-prices';
import { loadCard } from '@/lib/tcgdex';

export function useCollectionPrices(entries: CollectionEntry[], ownerUid?: string) {
  const [results, setResults] = useState<{ owner?: string; values: Record<string, CollectionPriceResult> }>({ values: {} });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResults({ owner: ownerUid, values: {} });
    void (async () => {
      // One bounded batch at a time, not a restart after every individual price result.
      for (let index = 0; active && index < entries.length; index += 6) {
        const chunk = entries.slice(index, index + 6);
        const resolved = await Promise.all(chunk.map(async (entry) => [entry.syncId, await resolveCollectionPrice(entry, loadCard)] as const));
        if (active) setResults((current) => ({ owner: ownerUid, values: { ...current.values, ...Object.fromEntries(resolved) } }));
      }
    })();
    return () => { active = false; };
  }, [entries, ownerUid, attempt]);

  const state = useMemo(() => {
    const prices: Record<string, number | null> = {};
    const failed = new Set<string>();
    let pending = 0;
    for (const entry of entries) {
      const result = results.owner === ownerUid ? results.values[entry.syncId] : undefined;
      if (!result || result.identity !== collectionPriceIdentity(entry)) { pending++; continue; }
      prices[entry.syncId] = result.price;
      if (result.failed) failed.add(entry.syncId);
    }
    return { prices, failed, pending };
  }, [entries, results, ownerUid]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
