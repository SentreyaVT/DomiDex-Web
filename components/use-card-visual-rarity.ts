'use client';

import { useEffect, useState } from 'react';
import { canonicalTcgCardId } from '@/lib/domain';
import { loadCard } from '@/lib/tcgdex';

export interface CardVisualIdentity {
  sourceCardId?: string | null;
  sourceSetId?: string | null;
  collectorNumber?: string | null;
  rarity?: string | null;
  effectId?: string | null;
  effectOverride?: string | null;
}
const localNumber = (value: string) => value.trim().split('/')[0].replace(/^0+(?=\d)/, '').toUpperCase();

/** Read-only display metadata: old sync entries can lack rarity even though their exact catalog card has it. */
export function useCardVisualRarity({ sourceCardId, sourceSetId, collectorNumber, rarity, effectId, effectOverride }: CardVisualIdentity) {
  const cardId = canonicalTcgCardId(sourceCardId ?? ''), setId = sourceSetId?.trim().toLowerCase() ?? '';
  const number = localNumber(collectorNumber ?? '');
  const override = effectOverride?.trim().toUpperCase();
  const enabled = effectId == null && (!override || override === 'HOLO')
    && /^[a-zA-Z0-9._-]{1,120}$/.test(cardId) && /^[a-zA-Z0-9._-]{1,120}$/.test(setId) && Boolean(number);
  const key = `${cardId.toLowerCase()}|${setId}|${number}`;
  const [resolved, setResolved] = useState<{ key: string; rarity: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    // Reuses the price/catalog request cache; never guesses by name or writes the saved entry.
    void loadCard(cardId).then((card) => {
      if (!active || typeof card.id !== 'string' || canonicalTcgCardId(card.id).toLowerCase() !== cardId.toLowerCase()
        || typeof card.set?.id !== 'string' || card.set.id.toLowerCase() !== setId
        || typeof card.localId !== 'string' || localNumber(card.localId) !== number
        || typeof card.rarity !== 'string' || !card.rarity.trim() || /^unknown$/i.test(card.rarity.trim())) return;
      setResolved({ key, rarity: card.rarity });
    }).catch(() => { /* Offline/error: keep the saved visual metadata, without changing data or price. */ });
    return () => { active = false; };
  }, [enabled, cardId, setId, number, key]);
  return enabled && resolved?.key === key ? resolved.rarity : rarity;
}
