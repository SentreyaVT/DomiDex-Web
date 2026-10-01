import type { Tilt } from '@/lib/shared-binder-visual';

/** Collection-card profiles are independent of the private binder's atlas material IDs. */
export type CardEffectProfile = 'NONE' | 'HOLO' | 'REVERSE_HOLO' | 'DOUBLE_RARE' | 'ILLUSTRATION_RARE'
  | 'ULTRA_RARE' | 'SPECIAL_ILLUSTRATION_RARE' | 'HYPER_RARE' | 'FULL_GOLD' | 'EX' | 'FULL_ART' | 'SPECIAL';
export type CardEffectZone = 'ARTWORK' | 'BODY' | 'BORDER' | 'FULL_CARD';
export interface CardEffectConfig {
  readonly profile: CardEffectProfile;
  readonly label: string;
  readonly zones: readonly CardEffectZone[];
  readonly intensity: number;
  readonly parallax: number;
  readonly sparkleCount: number;
  readonly metallic: boolean;
}

function config(profile: CardEffectProfile, label: string, zones: readonly CardEffectZone[], intensity: number, parallax = 1, sparkleCount = 0, metallic = false): CardEffectConfig {
  return Object.freeze({ profile, label, zones: Object.freeze(zones), intensity, parallax, sparkleCount, metallic });
}

/** Values and palette ported from Android ui/CardEffects.kt and ui/theme/Color.kt. */
export const cardEffectConfigs: Readonly<Record<CardEffectProfile, CardEffectConfig>> = Object.freeze({
  NONE: config('NONE', 'Kein Effekt', [], 0),
  HOLO: config('HOLO', 'Holo', ['ARTWORK', 'BORDER'], .50),
  REVERSE_HOLO: config('REVERSE_HOLO', 'Reverse Holo', ['BODY'], .48),
  DOUBLE_RARE: config('DOUBLE_RARE', 'Doppelselten', ['FULL_CARD'], .62, 1.15, 0, true),
  ILLUSTRATION_RARE: config('ILLUSTRATION_RARE', 'Illustration Rare · Goldstern', ['FULL_CARD'], .60, .92, 2, true),
  ULTRA_RARE: config('ULTRA_RARE', 'Ultra Rare · Silbersterne', ['FULL_CARD'], .67, 1.20, 3, true),
  SPECIAL_ILLUSTRATION_RARE: config('SPECIAL_ILLUSTRATION_RARE', 'Special Illustration Rare · Goldsterne', ['FULL_CARD'], .78, 1.45, 6, true),
  HYPER_RARE: config('HYPER_RARE', 'Hyper Rare · Goldsterne', ['FULL_CARD'], .82, 1.30, 4, true),
  FULL_GOLD: config('FULL_GOLD', 'Full Gold', ['FULL_CARD'], .74, 1.10, 2, true),
  EX: config('EX', 'EX', ['FULL_CARD'], .72),
  FULL_ART: config('FULL_ART', 'Full Art', ['FULL_CARD'], .55),
  SPECIAL: config('SPECIAL', 'Special', ['FULL_CARD'], .82),
});

export const cardEffectProfileIds = Object.keys(cardEffectConfigs) as CardEffectProfile[];
export function cardEffectProfile(value: string): CardEffectConfig | null {
  const id = value.trim().toUpperCase();
  return Object.hasOwn(cardEffectConfigs, id) ? cardEffectConfigs[id as CardEffectProfile] : null;
}

const ice = '#49DDF5', rose = '#E4A7FF', plum = '#C27AFF', gold = '#F4C86A';
type SpectralStop = readonly [color: string, alpha: number];
const clear: SpectralStop = [ice, 0];
const ordinaryStops: readonly SpectralStop[] = [clear, [ice, .36], [rose, .40], [gold, .28], clear];

export function cardProfileStops(profile: CardEffectProfile): readonly SpectralStop[] {
  switch (profile) {
    case 'ILLUSTRATION_RARE': return [clear, [gold, .42], [rose, .22], [ice, .16], clear];
    case 'SPECIAL_ILLUSTRATION_RARE': return [clear, [gold, .50], [ice, .30], [rose, .34], [gold, .32], clear];
    case 'HYPER_RARE': case 'FULL_GOLD': return [clear, [gold, .58], ['#FFF0A0', .30], [rose, .16], clear];
    case 'ULTRA_RARE': return [clear, [ice, .48], ['#DDE7F2', .34], [plum, .20], clear];
    case 'DOUBLE_RARE': return [clear, [ice, .34], [rose, .34], [plum, .22], clear];
    default: return ordinaryStops;
  }
}

export interface ProfileRect { x: number; y: number; width: number; height: number }
export interface ProfileRegion {
  zone: CardEffectZone;
  bounds: ProfileRect;
  /** Disjoint rectangles ensure artwork and text areas never receive an accidental extra pass. */
  clips: readonly ProfileRect[];
  start: { x: number; y: number };
  end: { x: number; y: number };
}
const boundTilt = (angle: number) => Number.isFinite(angle) ? Math.max(-8, Math.min(8, angle)) / 8 : 0;
const wrap = (value: number) => ((value % 1) + 1) % 1;
const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;

/** Shared tilt contains CSS degrees; Android's effect inputs are normalized horizontal/vertical motion. */
export function cardProfileGeometry(width: number, height: number, profile: CardEffectConfig, tilt: Tilt) {
  const motionX = boundTilt(tilt.y) * profile.parallax;
  const motionY = -boundTilt(tilt.x) * profile.parallax;
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return { motionX, motionY, regions: [] as ProfileRegion[] };
  const full = { x: 0, y: 0, width, height };
  const artwork = { x: width * .08, y: height * .10, width: width * .84, height: height * .44 };
  const body = { x: width * .06, y: height * .49, width: width * .88, height: height * .43 };
  const regions: ProfileRegion[] = profile.zones.map((zone) => {
    const bounds = zone === 'ARTWORK' ? artwork : zone === 'BODY' ? body : full;
    // Android's BORDER rect covers the whole card and BODY overlaps the lower 5% of the artwork.
    // Keep the reference bounds, but clip to a real outer rim and explicitly subtract the artwork.
    const clips = zone === 'BORDER' ? [
      { x: 0, y: 0, width, height: height * .04 },
      { x: 0, y: height * .96, width, height: height * .04 },
      { x: 0, y: height * .04, width: width * .04, height: height * .92 },
      { x: width * .96, y: height * .04, width: width * .04, height: height * .92 },
    ] : zone === 'BODY' ? [
      { x: body.x, y: height * .54, width: body.width, height: height * .38 },
      { x: body.x, y: body.y, width: width * .02, height: height * .05 },
      { x: width * .92, y: body.y, width: width * .02, height: height * .05 },
    ] : [bounds];
    return {
      zone, bounds, clips,
      start: { x: bounds.x + bounds.width * (motionX - .65), y: bounds.y + bounds.height * (motionY - .55) },
      end: { x: bounds.x + bounds.width * (motionX + 1.25), y: bounds.y + bounds.height * (motionY + 1.45) },
    };
  });
  return { motionX, motionY, regions };
}

/** Stateless source-profile rendering: no atlas substitution, image inference, clock, or idle animation. */
export function drawCardProfile(ctx: CanvasRenderingContext2D, width: number, height: number, profile: CardEffectConfig, tilt: Tilt) {
  ctx.clearRect(0, 0, width, height);
  if (profile.profile === 'NONE' || !profile.intensity) return;
  const { motionX, motionY, regions } = cardProfileGeometry(width, height, profile, tilt);
  const stops = cardProfileStops(profile.profile);
  const count = profile.sparkleCount || (profile.profile === 'SPECIAL' ? 8 : profile.profile === 'EX' ? 4 : 0);
  const goldSparkles = ['ILLUSTRATION_RARE', 'SPECIAL_ILLUSTRATION_RARE', 'HYPER_RARE', 'FULL_GOLD'].includes(profile.profile);
  for (const { bounds, clips, start, end } of regions) {
    ctx.save();
    ctx.beginPath();
    for (const rect of clips) ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    // Transparent-ended, colored source-over light preserves the printed art without a white screen film.
    const spectral = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    stops.forEach(([color, alpha], index) => spectral.addColorStop(index / (stops.length - 1), rgba(color, alpha * profile.intensity)));
    ctx.fillStyle = spectral;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    if (count) {
      const depth = ctx.createLinearGradient(bounds.x, bounds.y + bounds.height * (.35 + motionY * .25), bounds.x + bounds.width, bounds.y + bounds.height * (.65 + motionY * .25));
      depth.addColorStop(0, rgba(plum, 0));
      depth.addColorStop(.5, rgba(plum, .24 * profile.intensity));
      depth.addColorStop(1, rgba(plum, 0));
      ctx.fillStyle = depth;
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
      for (let index = 0; index < count; index++) {
        const x = bounds.x + bounds.width * wrap(index * .23 + .18 + motionX * .14);
        const y = bounds.y + bounds.height * wrap(index * .37 + .16 + motionY * .10);
        const radius = (profile.profile === 'SPECIAL_ILLUSTRATION_RARE' ? 2.2 : 1.6) * width / 300;
        const sparkle = ctx.createRadialGradient(x, y, 0, x, y, radius * 2);
        sparkle.addColorStop(0, rgba(goldSparkles ? gold : ice, .35 * profile.intensity));
        sparkle.addColorStop(.4, rgba(goldSparkles ? gold : ice, .20 * profile.intensity));
        sparkle.addColorStop(1, rgba(goldSparkles ? gold : ice, 0));
        ctx.fillStyle = sparkle;
        ctx.fillRect(x - radius * 2, y - radius * 2, radius * 4, radius * 4);
      }
    }
    ctx.restore();
  }
}
