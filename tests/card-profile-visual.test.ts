import { describe, expect, it, vi } from 'vitest';
import { cardEffectConfigs, cardEffectProfile, cardEffectProfileIds, cardProfileGeometry, cardProfileStops, drawCardProfile, type CardEffectProfile, type ProfileRect } from '@/lib/card-profile-visual';
import { resolveCardShowcaseEffect } from '@/lib/card-showcase-effect';

const resting = { x: 0, y: 0 };
const profileOf = (input: Parameters<typeof resolveCardShowcaseEffect>[0]) => resolveCardShowcaseEffect(input).profile?.profile;

describe('Android collection-card profile contract', () => {
  it('preserves all source profile identities and settings independently of binder atlas IDs', () => {
    const expected: [CardEffectProfile, string[], number, number, number, boolean][] = [
      ['NONE', [], 0, 1, 0, false],
      ['HOLO', ['ARTWORK', 'BORDER'], .50, 1, 0, false],
      ['REVERSE_HOLO', ['BODY'], .48, 1, 0, false],
      ['DOUBLE_RARE', ['FULL_CARD'], .62, 1.15, 0, true],
      ['ILLUSTRATION_RARE', ['FULL_CARD'], .60, .92, 2, true],
      ['ULTRA_RARE', ['FULL_CARD'], .67, 1.20, 3, true],
      ['SPECIAL_ILLUSTRATION_RARE', ['FULL_CARD'], .78, 1.45, 6, true],
      ['HYPER_RARE', ['FULL_CARD'], .82, 1.30, 4, true],
      ['FULL_GOLD', ['FULL_CARD'], .74, 1.10, 2, true],
      ['EX', ['FULL_CARD'], .72, 1, 0, false],
      ['FULL_ART', ['FULL_CARD'], .55, 1, 0, false],
      ['SPECIAL', ['FULL_CARD'], .82, 1, 0, false],
    ];
    expect(cardEffectProfileIds).toEqual(expected.map(([id]) => id));
    for (const [profile, zones, intensity, parallax, sparkleCount, metallic] of expected) {
      expect(cardEffectConfigs[profile]).toMatchObject({ profile, zones, intensity, parallax, sparkleCount, metallic });
      expect(resolveCardShowcaseEffect({ effectOverride: profile })).toMatchObject({ id: null, profile: cardEffectConfigs[profile] });
    }
    expect(cardEffectProfile(' special_illustration_rare ')).toBe(cardEffectConfigs.SPECIAL_ILLUSTRATION_RARE);
    expect(cardEffectProfile('toString')).toBeNull();
    expect(cardEffectProfile('galaxy')).toBeNull();
  });

  it('uses source RGB colors and alpha stops for gold, silver and ordinary foils', () => {
    expect(cardProfileStops('HOLO').slice(1, -1)).toEqual([['#49DDF5', .36], ['#E4A7FF', .40], ['#F4C86A', .28]]);
    expect(cardProfileStops('ILLUSTRATION_RARE').slice(1, -1)).toEqual([['#F4C86A', .42], ['#E4A7FF', .22], ['#49DDF5', .16]]);
    expect(cardProfileStops('ULTRA_RARE').slice(1, -1)).toEqual([['#49DDF5', .48], ['#DDE7F2', .34], ['#C27AFF', .20]]);
    expect(cardProfileStops('SPECIAL_ILLUSTRATION_RARE').slice(1, -1)).toEqual([['#F4C86A', .50], ['#49DDF5', .30], ['#E4A7FF', .34], ['#F4C86A', .32]]);
    expect(cardProfileStops('HYPER_RARE').slice(1, -1)).toEqual([['#F4C86A', .58], ['#FFF0A0', .30], ['#E4A7FF', .16]]);
    expect(cardProfileStops('FULL_GOLD')).toEqual(cardProfileStops('HYPER_RARE'));
    expect(cardProfileStops('DOUBLE_RARE').slice(1, -1)).toEqual([['#49DDF5', .34], ['#E4A7FF', .34], ['#C27AFF', .22]]);
  });

  it('keeps placement identity authoritative, including NONE and unsupported material IDs', () => {
    expect(resolveCardShowcaseEffect({ effectId: 'galaxy', effectOverride: 'FULL_GOLD', rarity: 'Hyper Rare' })).toMatchObject({ id: 'galaxy', profile: null, kind: 'material' });
    expect(resolveCardShowcaseEffect({ effectId: 'none', effectOverride: 'FULL_GOLD' }).kind).toBe('none');
    expect(resolveCardShowcaseEffect({ effectId: 'future', effectOverride: 'FULL_GOLD' })).toMatchObject({ id: null, profile: null, kind: 'unsupported' });
    expect(resolveCardShowcaseEffect({ effectOverride: 'future', finish: 'Holo' })).toMatchObject({ id: null, profile: null, kind: 'unsupported' });
    expect(profileOf({ effectOverride: 'NONE', rarity: 'Special Illustration Rare', variant: 'Full Art', finish: 'Holo' })).toBe('NONE');
    expect(resolveCardShowcaseEffect({ effectId: null, intensity: 0, effectOverride: 'FULL_GOLD' })).toMatchObject({ profile: { profile: 'FULL_GOLD', intensity: .74 }, intensity: .74, kind: 'profile' });
    expect(resolveCardShowcaseEffect({ effectId: 'galaxy', intensity: 0, effectOverride: 'FULL_GOLD' })).toMatchObject({ profile: null, intensity: 0, kind: 'material' });
  });

  it('resolves rarity before variant and finish with Android metadata aliases', () => {
    for (const rarity of ['Special Illustration Rare', 'illustration special', 'Besondere Illustration', 'SIR']) expect(profileOf({ rarity, variant: 'Full Art', finish: 'Reverse Holo' })).toBe('SPECIAL_ILLUSTRATION_RARE');
    for (const rarity of ['Illustration rare', 'selten illustration', 'IR']) expect(profileOf({ rarity })).toBe('ILLUSTRATION_RARE');
    for (const rarity of ['Hyper rare', 'rare hyper', 'hyper selten', 'Mega Hyper Rare']) expect(profileOf({ rarity })).toBe('HYPER_RARE');
    for (const rarity of ['Full Gold', 'gold rare', 'gold selten']) expect(profileOf({ rarity })).toBe('FULL_GOLD');
    for (const rarity of ['Ultra Rare', 'rare ultra', 'ultra selten', 'Shiny Ultra Rare']) expect(profileOf({ rarity })).toBe('ULTRA_RARE');
    for (const rarity of ['Double rare', 'rare double', 'doppelt selten', 'Doppelselten']) expect(profileOf({ rarity })).toBe('DOUBLE_RARE');
    expect(profileOf({ rarity: 'Special Mega Rare' })).toBe('SPECIAL');
    expect(profileOf({ rarity: 'Hyper Rare', effectOverride: 'HOLO' })).toBe('HOLO');
  });

  it('uses variant and finish only as explicit metadata and avoids substring false positives', () => {
    for (const variant of ['Full Art', 'FullArt']) expect(profileOf({ variant, finish: 'Holo' })).toBe('FULL_ART');
    for (const variant of ['Special', 'Illustration Rare', 'SIR']) expect(profileOf({ variant })).toBe('SPECIAL');
    for (const variant of ['EX', 'Rare GX', 'Pokémon V', 'VMAX', 'VSTAR']) expect(profileOf({ variant })).toBe('EX');
    expect(profileOf({ finish: 'EX' })).toBe('EX');
    expect(profileOf({ finish: 'Reverse Holo' })).toBe('REVERSE_HOLO');
    expect(profileOf({ finish: 'Holo' })).toBe('HOLO');
    for (const finish of ['Normal', 'Non-Holo', 'nonholo', 'No Holo', 'Non-Holofoil', 'nonholofoil', 'Non‑Holo', 'Unknown']) expect(profileOf({ finish })).toBe('NONE');
    for (const variant of ['Extra', 'Standard variant', 'Desirable', 'Standard']) expect(profileOf({ variant })).toBe('NONE');
    for (const rarity of ['Secret Rare', 'Promo', 'Radiant Rare', 'ACE SPEC Rare', 'Unknown']) expect(profileOf({ rarity })).toBe('NONE');
  });

  it('recognizes full-art spelling variants in rarity, variant and finish', () => {
    for (const value of ['Full Art', 'FullArt', 'Full-Art', 'Full_Art', 'Full‑Art']) {
      for (const field of ['rarity', 'variant', 'finish']) {
        expect(resolveCardShowcaseEffect({ finish: 'Holo', [field]: value }).profile).toMatchObject({ profile: 'FULL_ART', zones: ['FULL_CARD'] });
      }
    }
    for (const rarity of ['Holo Rare V', 'Holo Rare VMAX', 'Holo Rare VSTAR']) {
      expect(resolveCardShowcaseEffect({ finish: 'Holo', rarity }).profile).toMatchObject({ profile: 'EX', zones: ['FULL_CARD'] });
    }
  });

  it('keeps saved Holo light but covers the complete known Full-Art layout, including below the artwork', () => {
    for (const metadata of [{ rarity: 'Ultra Rare' }, { rarity: 'Full Art' }, { variant: 'Full-Art' }, { rarity: 'Holo Rare VMAX' }, { rarity: 'Illustration Rare' }]) {
      const profile = resolveCardShowcaseEffect({ finish: 'Holo', effectOverride: 'HOLO', ...metadata }).profile!;
      expect(profile).toEqual({ ...cardEffectConfigs.HOLO, zones: ['FULL_CARD'] });
      const geometry = cardProfileGeometry(300, 420, profile, resting);
      expect(geometry.regions).toHaveLength(1);
      expect(geometry.regions[0].clips).toEqual([{ x: 0, y: 0, width: 300, height: 420 }]);
    }
    expect(resolveCardShowcaseEffect({ finish: 'Holo', rarity: 'Common', effectOverride: 'HOLO' }).profile).toBe(cardEffectConfigs.HOLO);
    expect(resolveCardShowcaseEffect({ rarity: 'Full Art', effectOverride: 'REVERSE_HOLO' }).profile).toBe(cardEffectConfigs.REVERSE_HOLO);
    expect(resolveCardShowcaseEffect({ rarity: 'Full Art', effectOverride: 'NONE' }).kind).toBe('none');
    expect(resolveCardShowcaseEffect({ rarity: 'Full Art', effectId: 'none' }).kind).toBe('none');
    expect(resolveCardShowcaseEffect({ rarity: 'Full Art', effectId: 'galaxy', intensity: .3 })).toMatchObject({ id: 'galaxy', intensity: .3, profile: null });
    for (const rarity of ['NotFullArt', 'Holo Rare Variant', 'Secret Rare', 'Promo']) {
      expect(resolveCardShowcaseEffect({ rarity, finish: 'Holo' }).profile).toBe(cardEffectConfigs.HOLO);
    }
  });
});

describe('profile rendering geometry', () => {
  const contains = (rect: ProfileRect, x: number, y: number) => x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height;
  const covers = (profile: CardEffectProfile, x: number, y: number) => cardProfileGeometry(100, 100, cardEffectConfigs[profile], resting).regions.some((region) => region.clips.some((rect) => contains(rect, x, y)));

  it('confines regular holo to artwork and a true outer rim without covering body text', () => {
    expect(covers('HOLO', 50, 30)).toBe(true);
    expect(covers('HOLO', 2, 60)).toBe(true);
    expect(covers('HOLO', 50, 2)).toBe(true);
    expect(covers('HOLO', 50, 75)).toBe(false);
    expect(covers('HOLO', 50, 7)).toBe(false);
    const art = cardProfileGeometry(100, 100, cardEffectConfigs.HOLO, resting).regions[0];
    expect(art.bounds).toEqual({ x: 8, y: 10, width: 84, height: 44 });
  });

  it('subtracts artwork from the source reverse body and retains full-card rare profiles', () => {
    expect(covers('REVERSE_HOLO', 50, 75)).toBe(true);
    expect(covers('REVERSE_HOLO', 50, 51)).toBe(false);
    expect(covers('REVERSE_HOLO', 50, 30)).toBe(false);
    expect(covers('REVERSE_HOLO', 7, 51)).toBe(true);
    expect(covers('REVERSE_HOLO', 2, 75)).toBe(false);
    for (const id of cardEffectProfileIds.filter((profile) => cardEffectConfigs[profile].zones.includes('FULL_CARD'))) {
      expect(covers(id, 50, 30)).toBe(true);
      expect(covers(id, 50, 75)).toBe(true);
    }
    expect(cardProfileGeometry(100, 100, cardEffectConfigs.NONE, resting).regions).toHaveLength(0);
  });

  it('normalizes the same physical card tilt into source horizontal/vertical parallax', () => {
    const geometry = cardProfileGeometry(300, 420, cardEffectConfigs.SPECIAL_ILLUSTRATION_RARE, { x: 8, y: 8 });
    expect(geometry.motionX).toBe(1.45);
    expect(geometry.motionY).toBe(-1.45);
    expect(geometry.regions[0].start.x).toBeCloseTo(240);
    expect(geometry.regions[0].start.y).toBeCloseTo(-840);
    expect(cardProfileGeometry(300, 420, cardEffectConfigs.SPECIAL_ILLUSTRATION_RARE, { x: 90, y: 90 })).toEqual(geometry);
    expect(cardProfileGeometry(300, 420, cardEffectConfigs.HOLO, { x: Infinity, y: NaN })).toEqual(cardProfileGeometry(300, 420, cardEffectConfigs.HOLO, resting));
    expect(cardProfileGeometry(Infinity, 420, cardEffectConfigs.HOLO, resting).regions).toHaveLength(0);
  });

  it('renders source alpha and deterministic sparkle counts without using images or clocks', () => {
    const stops: [number, string][] = [];
    const gradient = () => ({ addColorStop: vi.fn((offset: number, color: string) => stops.push([offset, color])) });
    const ctx = {
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect: vi.fn(),
      createLinearGradient: vi.fn(gradient), createRadialGradient: vi.fn(gradient), fillStyle: '',
    };
    drawCardProfile(ctx as unknown as CanvasRenderingContext2D, 300, 420, cardEffectConfigs.ULTRA_RARE, resting);
    expect(stops).toContainEqual([.25, 'rgba(73,221,245,0.3216)']);
    expect(ctx.createRadialGradient).toHaveBeenCalledTimes(3);
    const firstGeometry = ctx.createLinearGradient.mock.calls.slice();
    ctx.createLinearGradient.mockClear();
    drawCardProfile(ctx as unknown as CanvasRenderingContext2D, 300, 420, cardEffectConfigs.ULTRA_RARE, resting);
    expect(ctx.createLinearGradient.mock.calls).toEqual(firstGeometry);
    for (const [profile, count] of [['EX', 4], ['SPECIAL', 8], ['SPECIAL_ILLUSTRATION_RARE', 6], ['HOLO', 0]] as const) {
      ctx.createRadialGradient.mockClear();
      drawCardProfile(ctx as unknown as CanvasRenderingContext2D, 300, 420, cardEffectConfigs[profile], { x: 8, y: -8 });
      expect(ctx.createRadialGradient).toHaveBeenCalledTimes(count);
    }
    ctx.fillRect.mockClear();
    drawCardProfile(ctx as unknown as CanvasRenderingContext2D, 300, 420, cardEffectConfigs.NONE, resting);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.save).toHaveBeenCalledTimes(ctx.restore.mock.calls.length);
  });
});
