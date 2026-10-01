import { describe, expect, it } from 'vitest';
import type { CollectionEntry, TcgCardDetail } from '@/lib/domain';
import { sharedCardDto, sharedVisualId } from '@/lib/shared-binder';

const entry = {
  sourceCardId: 'sv08.5-137', sourceSetId: 'sv08.5', setId: 'sv08.5', collectorNumber: '137/131',
  finish: 'Normal', variant: 'Standard', externalProductId: 123, name: 'private label', ownerUid: 'private-uid',
  notes: 'secret note', quantity: 50, acquisitionPriceMinor: 4200, imageUrl: 'https://private.invalid/image?token=secret',
} as CollectionEntry;
const detail: TcgCardDetail = {
  id: 'sv08.5-137', localId: '137', name: 'Öffentliche Karte', set: { id: 'sv08.5', name: 'Öffentliches Set' },
  image: 'https://assets.tcgdex.net/de/sv/sv08.5/137', variants_detailed: [{ type: 'Normal', size: 'Standard', pricing: { cardmarket: { idProduct: 123, trend: 5, unit: 'EUR', updated: '2026-09-22' } } }],
};
const placement = { slotPosition: 4, holoEffectId: 'galaxy', holoIntensity: .6 };

describe('shared binder explicit public DTO', () => {
  it('keeps the Android anniversary ID without changing card or price identity', () => {
    const result = sharedCardDto(entry, { ...placement, holoEffectId: 'anniversary_30' }, detail, true)!;
    expect(result.holoEffectId).toBe('anniversary_30');
    expect(result.cardId).toBe('sv08.5-137');
    expect(result.price?.amount).toBe(5);
  });
  it('never serializes owner data, custom URLs or prices by default', () => {
    const value = sharedCardDto(entry, placement, detail, false)!;
    expect(Object.keys(value).sort()).toEqual(['slot', 'cardId', 'name', 'setName', 'collectorNumber', 'image', 'finish', 'holoEffectId', 'holoIntensity'].sort());
    expect(JSON.stringify(value)).not.toMatch(/private|secret|quantity|acquisition|ownerUid/);
    expect(value).toMatchObject({ name: detail.name, holoEffectId: 'galaxy', holoIntensity: .6 });
  });
  it('uses exact canonical identity above printed total without name matching', () => {
    expect(sharedCardDto(entry, placement, detail, true)?.price?.amount).toBe(5);
    expect(sharedCardDto(entry, placement, { ...detail, id: 'sv08.5-136' }, true)).toBeNull();
    expect(sharedCardDto(entry, placement, { ...detail, set: { id: 'sv08', name: 'Other' } }, true)).toBeNull();
    expect(sharedCardDto(entry, placement, { ...detail, localId: '138' }, true)).toBeNull();
  });
  it('does not substitute products or another foil variant', () => {
    expect(sharedCardDto({ ...entry, externalProductId: 456 }, placement, detail, true)?.price?.amount).toBeNull();
    expect(sharedCardDto({ ...entry, finish: 'Reverse Holo' }, placement, detail, true)?.price?.amount).toBeNull();
  });
  it('allows only official catalog assets and finite visual intensity', () => {
    expect(sharedCardDto(entry, { ...placement, holoIntensity: Infinity }, { ...detail, image: 'https://firebasestorage.googleapis.com/private?token=secret' }, false)).toMatchObject({ image: null, holoIntensity: 0 });
    expect(sharedVisualId('https://private.invalid/avatar', true)).toBe('nebula');
  });
});
