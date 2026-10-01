import { holoMaterial } from '@/lib/shared-binder-visual';
import { cardEffectConfigs, cardEffectProfile, type CardEffectConfig, type CardEffectProfile } from '@/lib/card-profile-visual';

export interface CardShowcaseEffectInput {
  finish?: string | null;
  rarity?: string | null;
  variant?: string | null;
  effectOverride?: string | null;
  /** A private-binder placement's stable material ID, when that placement is actually known. */
  effectId?: string | null;
  intensity?: number;
}

export interface CardShowcaseEffect {
  /** Private-binder atlas material identity only; collection profiles never impersonate an atlas ID. */
  id: string | null;
  profile: CardEffectConfig | null;
  intensity: number;
  kind: 'material' | 'profile' | 'none' | 'unsupported';
  note: string | null;
}

const none: CardShowcaseEffect = { id: null, profile: cardEffectConfigs.NONE, intensity: 0, kind: 'none', note: null };
const fullCardHolo: CardEffectConfig = Object.freeze({ ...cardEffectConfigs.HOLO, zones: Object.freeze(['FULL_CARD'] as const) });
const metadataText = (value?: string | null) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function resolvedProfile(profile: CardEffectConfig): CardShowcaseEffect {
  return profile.profile === 'NONE' ? none : { id: null, profile, intensity: profile.intensity, kind: 'profile', note: `${profile.label} · Digitale Glanzdarstellung` };
}

/** Mirrors CardRarityResolver's explicit source-metadata priority, without guessing from card names. */
function rarityProfile(rarity: string | null | undefined): CardEffectProfile | null {
  const value = metadataText(rarity);
  if (/special illustration|illustration special|besondere illustration/.test(value) || value === 'sir') return 'SPECIAL_ILLUSTRATION_RARE';
  if (/illustration rare|selten illustration/.test(value) || value === 'ir') return 'ILLUSTRATION_RARE';
  if (/hyper rare|rare hyper|hyper selten/.test(value)) return 'HYPER_RARE';
  if (/full gold|gold rare|gold selten/.test(value)) return 'FULL_GOLD';
  if (/ultra rare|rare ultra|ultra selten/.test(value)) return 'ULTRA_RARE';
  if (/double rare|rare double|doppelt selten|doppelselten/.test(value)) return 'DOUBLE_RARE';
  if (/\bfull\s*art\b/.test(value)) return 'FULL_ART';
  if (/\bholo rare (?:v|vmax|vstar)\b/.test(value)) return 'EX';
  if (value.includes('mega') && /rare|selten/.test(value)) return 'SPECIAL';
  return null;
}

function metadataProfile(finish?: string | null, rarity?: string | null, variant?: string | null): CardEffectConfig {
  const fromRarity = rarityProfile(rarity);
  if (fromRarity) return cardEffectConfigs[fromRarity];
  const edition = metadataText(variant), physicalFinish = metadataText(finish);
  if (/\bfull\s*art\b/.test(edition) || /\bfull\s*art\b/.test(physicalFinish)) return cardEffectConfigs.FULL_ART;
  if (/\bspecial\b|\billustration rare\b|\bsir\b/.test(edition)) return cardEffectConfigs.SPECIAL;
  if (/\b(?:ex|gx|v|vmax|vstar|vunion)\b/.test(edition) || physicalFinish === 'ex') return cardEffectConfigs.EX;
  if (physicalFinish.includes('reverse')) return cardEffectConfigs.REVERSE_HOLO;
  if (physicalFinish.includes('holo') && !/\b(?:non|no)\s*holo/.test(physicalFinish)) return cardEffectConfigs.HOLO;
  return cardEffectConfigs.NONE;
}

/** Collection profiles and private-binder material IDs are different contracts. */
export function resolveCardShowcaseEffect({ finish, rarity, variant, effectOverride, effectId, intensity }: CardShowcaseEffectInput): CardShowcaseEffect {
  if (effectId != null) {
    if (effectId === 'none') return none;
    if (!holoMaterial(effectId)) return {
      ...none, profile: null, kind: 'unsupported', note: 'Dieser Binder-Effekt ist in der Webansicht noch nicht verfügbar.',
    };
    const strength = intensity === undefined ? .55 : Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
    return { id: effectId, profile: null, intensity: strength, kind: 'material', note: 'Gespeicherter Binder-Effekt' };
  }
  if (effectOverride?.trim()) {
    const profile = cardEffectProfile(effectOverride);
    // A saved generic Holo changes the light, not a known Full-Art card's physical layout.
    // Keep explicit NONE, Reverse, specialized profiles and private materials authoritative.
    if (profile) return resolvedProfile(profile.profile === 'HOLO' && metadataProfile(finish, rarity, variant).zones.includes('FULL_CARD') ? fullCardHolo : profile);
    return { ...none, profile: null, kind: 'unsupported', note: 'Der gewählte Karteneffekt ist in der Webansicht noch nicht verfügbar.' };
  }
  return resolvedProfile(metadataProfile(finish, rarity, variant));
}
