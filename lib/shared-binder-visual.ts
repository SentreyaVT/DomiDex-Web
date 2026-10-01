import { ADDITIONAL_FOIL_IDS, drawAdditionalFoil } from './binder-additional-foil';
import { ELEMENT_FOIL_IDS, drawElementFoil } from './binder-element-foil';
import { PREMIUM_FOIL_IDS, drawPremiumFoil } from './binder-premium-foil';

/** Port of the current Android binder foil renderers.
 * Stable IDs, original atlases, and the medium-quality geometry budget are preserved. */
export const coverIds = 'classic_rainbow aurora galaxy crystal nebula golden_shine void prism bubble flame ocean forest stardust electric chroma_shift pixel liquid_metal sunburst dragon_scale cosmic_dust'.split(' ');
const coverHighlights = 'FFC85C BB66FF E66DFF E7FCFF 42E8F5 FFED9A 777F8D 5BE5F2 D0B8FF FFDA75 6DE7FF B9FFD9 EF78EE A5FBFF 41E2ED 42E6EF E4ECF5 FFF0A6 B6D1E8 B869DF'.split(' ').map((color) => `#${color}`);
export const holoIds = 'classic_holo rainbow linear diagonal galaxy nebula aurora crystal prism diamond stardust bubble oil_slick liquid_metal hyper_wave fire ice pixel void holo_spark element_grass element_fire element_water element_electric element_psychic element_fighting element_darkness element_metal element_dragon element_colorless element_fairy anniversary_30'.split(' ');
const patterns = 'SHEEN SPECTRUM SHEEN DIAGONAL STARS WAVE WAVE FACETS FACETS FACETS STARS CONFETTI SPECTRUM SHEEN WAVE DIAGONAL FACETS CONFETTI SHEEN BURST WAVE DIAGONAL WAVE BURST WAVE BURST SHEEN FACETS FACETS STARS CONFETTI ANNIVERSARY'.split(' ');
const palettes = [
  'FFFFFF B9E7FF E4D0FF', 'FF6688 63E5FF D778FF', 'FFFFFF 7DDFFF C68CFF', '57E8FF C25CFF FF75B7', '7F68FF DD69FF 64DFFF',
  '746BFF DD69FF 58DDEB', '69F7C5 67B8FF E879FF', '9FF8FF C5B4FF FFFFFF', '57E8FF D15DFF FFD06B', 'FFFFFF 8FDFFF D9C5FF',
  'FFFFFF A7C7FF D7A5FF', 'A7F5FF D0B5FF FFFFFF', '4BE2C5 6D55CE EF5FAE', 'FFFFFF 8593A8 DCE5EF', '66FFF0 8272FF FF7BD4',
  'FFB14C FF5D4F FFE7A1', 'FFFFFF 70DBFF A5BFFF', '5CEBFF B66AFF FFFFFF', '3B4252 705A96 8BA4B8', 'FFFFFF 9F72FF 5BE7FF',
  '57F28E B8FF66 FFFFFF', 'FF4C32 FFB21F FFF0A3', '38D9FF 287CFF FFFFFF', 'FFF26A 55E9FF FFFFFF', 'C85CFF 6E62FF FFA7F2',
  'FF8B38 E33F2F FFD67A', '24113F 7B3EC8 FF527D', 'FFFFFF AEC5DB FFD9A6', '44E4D5 FFC857 B65CFF', 'FFFFFF D9E6F2 FFE4B8', 'FF8FDF 8FE9FF FFFFFF', 'FFC95C FFE6A2 C48DFF',
].map((row) => row.split(' ').map((hex) => `#${hex}`));
const rainbow = ['#FF315F', '#FFCA28', '#36EF8D', '#20DFFF', '#6366FF', '#E348FF'];
export type Tilt = { x: number; y: number };
export const proceduralHoloIds = [...PREMIUM_FOIL_IDS, ...ADDITIONAL_FOIL_IDS, ...ELEMENT_FOIL_IDS, 'anniversary_30'];
export function sharedTilt(horizontal: number, vertical: number, reduceMotion = false): Tilt {
  const clamp = (value: number) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  return reduceMotion ? { x: 0, y: 0 } : { x: -clamp(vertical) * 8, y: clamp(horizontal) * 8 };
}
export function holoMaterial(id: string) {
  const index = holoIds.indexOf(id);
  if (index < 0) return null;
  // Procedural materials must never borrow an unrelated or empty atlas cell.
  if (proceduralHoloIds.includes(id)) return { id, index: 0, columns: 0, rows: 0, asset: null, pattern: patterns[index], colors: palettes[index] };
  return { id, index: index < 20 ? index : index - 20, columns: index < 20 ? 5 : 4, rows: index < 20 ? 4 : 3, asset: index < 20 ? '/binder-materials/private_binder_holo_atlas.png' : '/binder-materials/private_binder_element_holo_atlas.png', pattern: patterns[index], colors: palettes[index] };
}
export function atlasCrop(width: number, height: number, columns: number, rows: number, index: number) {
  const cellWidth = Math.floor(width / columns), cellHeight = Math.floor(height / rows);
  const inset = Math.max(2, Math.round(Math.min(cellWidth, cellHeight) * .025));
  return { x: index % columns * cellWidth + inset, y: Math.floor(index / columns) * cellHeight + inset, width: cellWidth - inset * 2, height: cellHeight - inset * 2 };
}
export function holoGeometry(width: number, height: number, intensity: number, tilt: Tilt) {
  const value = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0;
  const tiltX = Number.isFinite(tilt.x) ? Math.max(-8, Math.min(8, tilt.x)) : 0;
  const tiltY = Number.isFinite(tilt.y) ? Math.max(-8, Math.min(8, tilt.y)) : 0;
  const horizontal = tiltY / 8 * width * .16, vertical = tiltX / 8 * height * .08;
  const normalizedTiltX = tiltX / 8, normalizedTiltY = tiltY / 8, squared = value * value;
  return { intensity: value, materialAlpha: .09 * value + .13 * squared, grooveAlpha: .48 * value + .44 * squared, specularAlpha: .13 * value + .30 * squared,
    normalizedTiltX, normalizedTiltY, reflectionCenterX: .48 + normalizedTiltY * .28 - normalizedTiltX * .08,
    horizontal, vertical, overscan: Math.min(width, height) * .16, materialX: horizontal * .60, materialY: vertical * .62, hue: normalizedTiltY * 2.80 + normalizedTiltX * 1.30 };
}
const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;
const wrap = (value: number, bound: number) => ((value % bound) + bound) % bound;
function line(ctx: CanvasRenderingContext2D, color: string, x1: number, y1: number, x2: number, y2: number, width: number) {
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

type FoilOptics = ReturnType<typeof holoGeometry>;
type Material = NonNullable<ReturnType<typeof holoMaterial>>;
type Atlas = CanvasImageSource & { width: number; height: number };
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const blend = (first: string, second: string, amount: number) => `#${[1, 3, 5].map((offset) => Math.round(parseInt(first.slice(offset, offset + 2), 16) * (1 - amount) + parseInt(second.slice(offset, offset + 2), 16) * amount).toString(16).padStart(2, '0')).join('')}`;
function spectrum(phase: number, palette = rainbow) {
  const position = wrap(phase, palette.length), first = Math.floor(position);
  return blend(palette[first], palette[(first + 1) % palette.length], position - first);
}
function strokePath(ctx: CanvasRenderingContext2D, path: Path2D, brush: string | CanvasGradient, alpha: number, width: number) {
  ctx.strokeStyle = brush; ctx.globalAlpha = alpha; ctx.lineWidth = width;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(path);
}

/** Atlas light uses Screen; colored, feathered etching uses SrcOver over the artwork. */
export function drawSharedHolo(ctx: CanvasRenderingContext2D, atlas: Atlas | null, width: number, height: number, effectId: string, intensity: number, tilt: Tilt, layer: 'light' | 'grooves') {
  ctx.clearRect(0, 0, width, height);
  const material = holoMaterial(effectId), g = holoGeometry(width, height, intensity, tilt);
  if (!material || !g.intensity || width <= 0 || height <= 0) return;
  ctx.save();
  if (layer === 'light') {
    if (atlas && material.asset) {
      const crop = atlasCrop(atlas.width, atlas.height, material.columns, material.rows, material.index);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = g.materialAlpha * (material.pattern === 'FACETS' ? .75 : 1);
      ctx.drawImage(atlas, crop.x, crop.y, crop.width, crop.height, Math.round(-g.overscan + g.materialX), Math.round(-g.overscan + g.materialY), Math.round(width + 2 * g.overscan), Math.round(height + 2 * g.overscan));
    }
  } else {
    ctx.globalCompositeOperation = 'source-over';
    if (effectId === 'anniversary_30') drawAnniversary(ctx, width, height, g);
    else if (PREMIUM_FOIL_IDS.includes(effectId)) drawPremiumFoil(ctx, width, height, effectId, g);
    else if (ADDITIONAL_FOIL_IDS.includes(effectId)) drawAdditionalFoil(ctx, width, height, effectId, g);
    else if (ELEMENT_FOIL_IDS.includes(effectId)) drawElementFoil(ctx, width, height, effectId, g);
    else drawMaterialGeometry(ctx, width, height, material, g);
  }
  ctx.restore();
}

/** The spectrum is clipped to each material's contours: no universal stripes or card wash. */
function drawMaterialGeometry(ctx: CanvasRenderingContext2D, width: number, height: number, material: Material, g: FoilOptics) {
  const count = 7, stroke = Math.max(1, Math.min(3.2, Math.min(width, height) * .006));
  const px = (x: number) => (x + g.normalizedTiltY * .035) * width;
  const py = (y: number) => (y + g.normalizedTiltX * .035) * height;
  const brush = ctx.createLinearGradient(-width * .10, -height * .10, width * 1.10, height * 1.10);
  for (let sample = 0; sample <= 24; sample++) {
    const fraction = sample / 24, glint = clamp01(1 - Math.abs(fraction - g.reflectionCenterX) * 2.8);
    brush.addColorStop(fraction, rgba(blend(spectrum(fraction * 6 + g.hue), material.colors[Math.min(2, Math.floor(sample / 8))], .12), .72 + glint * .28));
  }
  const trace = (path: Path2D, index: number, weight = 1, opacity = 1) => {
    const glint = clamp01(1 - Math.abs((index + .5) / count - g.reflectionCenterX) * 2);
    const alpha = g.grooveAlpha * opacity * (.90 + glint * .10);
    for (const [size, strength] of [[4.6, .03], [3.3, .10], [2.25, .22], [1.35, .37], [.60, .63]]) strokePath(ctx, path, brush, alpha * strength, stroke * weight * size);
  };
  const flake = (path: Path2D) => {
    strokePath(ctx, path, brush, g.grooveAlpha * .05, stroke * 3.2);
    strokePath(ctx, path, brush, g.grooveAlpha * .16, stroke * 1.7);
    ctx.fillStyle = brush; ctx.globalAlpha = g.grooveAlpha * .84; ctx.fill(path);
  };
  for (let index = 0; index < count; index++) {
    const sx = .10 + ((index * 37) % 89) / 111, sy = .10 + ((index * 53) % 83) / 104;
    const path = new Path2D();
    const move = (x: number, y: number) => path.moveTo(px(x), py(y));
    const lineTo = (x: number, y: number) => path.lineTo(px(x), py(y));
    const curve = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => path.bezierCurveTo(px(x1), py(y1), px(x2), py(y2), px(x3), py(y3));
    const sparkle = (x: number, y: number, r: number, cross = false) => {
      if (cross) { move(x - r, y); lineTo(x + r, y); move(x, y - r * .8); lineTo(x, y + r * .8); }
      else { move(x, y - r); lineTo(x + r * .22, y - r * .16); lineTo(x + r, y); lineTo(x + r * .22, y + r * .16); lineTo(x, y + r); lineTo(x - r * .22, y + r * .16); lineTo(x - r, y); lineTo(x - r * .22, y - r * .16); path.closePath(); }
    };
    switch (material.id) {
      case 'classic_holo':
        for (let f = 0; f < 3; f++) sparkle(wrap(sx + f * .19, .92) + .03, wrap(sy + f * .23, .92) + .03, .010 + (index % 3) * .003);
        flake(path); break;
      case 'stardust': sparkle(sx, sy, .025 + (index % 3) * .009); sparkle(1 - sx, wrap(sy + .37, .85) + .06, .009); flake(path); break;
      case 'bubble': {
        const r = .03 + (index % 4) * .013, ring = new Path2D(); ring.arc(px(sx), py(sy), width * r, 0, Math.PI * 2); trace(ring, index);
        move(sx - r * .50, sy - r * .45); curve(sx - r * .10, sy - r * .70, sx + r * .20, sy - r * .70, sx + r * .45, sy - r * .42); trace(path, index + 1, .75); break;
      }
      case 'pixel':
        for (let pixel = 0; pixel < 3; pixel++) { const x = ((index * 3 + pixel * 5) % 13) / 14 + .035, y = ((index * 7 + pixel * 3) % 17) / 18 + .03; move(x, y); lineTo(x + .027, y); lineTo(x + .027, y + .019); lineTo(x, y + .019); path.closePath(); }
        flake(path); break;

    }
  }
}

const anniversaryPalette = ['#FF65CF', '#FFD343', '#87ED39', '#34DCFF', '#AB72FF', '#ED55F4'];
type AnniversaryMotif = readonly [x: number, y: number, width: number, angle: number, kind: 'face' | 'ball' | 'bubble'];
// Android's medium-quality budget: fifteen fixed motifs, nineteen glints, forty-eight edge flecks.
const anniversaryMotifs: readonly AnniversaryMotif[] = [
  [.18, .14, .25, -16, 'face'], [.76, .095, .12, -10, 'ball'], [.85, .245, .23, 12, 'face'],
  [.18, .50, .27, -12, 'face'], [.09, .375, .12, 16, 'ball'], [.395, .625, .22, 10, 'face'],
  [.77, .745, .17, -14, 'bubble'], [.91, .88, .14, 15, 'ball'], [.10, .87, .19, -17, 'face'],
  [.32, .84, .17, -7, 'bubble'], [.595, .155, .20, 10, 'face'], [.59, .37, .105, -15, 'ball'],
  [.335, .30, .205, -9, 'face'], [.065, .68, .15, 8, 'bubble'], [.525, .79, .13, -6, 'ball'],
];
const anniversaryGlints = [
  [.10, .12, .047], [.43, .16, .060], [.91, .36, .045], [.25, .44, .055], [.58, .56, .071],
  [.07, .68, .040], [.57, .88, .045], [.92, .64, .057], [.29, .71, .035], [.61, .36, .032],
  [.07, .94, .045], [.92, .08, .037], [.72, .26, .025], [.43, .45, .031], [.84, .80, .035],
  [.43, .93, .028], [.63, .70, .042], [.25, .19, .024], [.64, .04, .035],
];
function oval(left: number, top: number, right: number, bottom: number) {
  const path = new Path2D(); path.ellipse((left + right) / 2, (top + bottom) / 2, (right - left) / 2, (bottom - top) / 2, 0, 0, Math.PI * 2); return path;
}
function createAnniversaryPaths() {
  const faceDetails = new Path2D('M47 69L51 70L54 68M19 27L24 31M80 23L86 27');
  for (const rect of [[30, 57, 36, 66], [65, 55, 71, 64], [18, 67, 24, 72], [78, 63, 84, 69]]) faceDetails.addPath(oval(rect[0], rect[1], rect[2], rect[3]));
  const ball = new Path2D('M7 45L36 45M7 54L36 54M64 45L93 45M64 54L93 54');
  for (const rect of [[6, 6, 94, 94], [36, 36, 64, 64], [42, 42, 58, 58]]) ball.addPath(oval(rect[0], rect[1], rect[2], rect[3]));
  return {
    faceHalo: oval(1, 26, 101, 108),
    face: new Path2D('M31 39C27 29 23 10 17 3C12 15 17 34 19 45C7 55 10 84 29 94C49 107 83 98 92 79C100 61 87 45 77 41C85 29 93 13 96 3C84 7 72 22 62 35C49 32 41 33 31 39ZM13 54C2 72 20 104 49 103M81 47C105 62 96 87 80 94'),
    faceDetails, ball, bubble: oval(5, 5, 95, 95),
    bubbleGlint: new Path2D('M18 40C19 24 31 14 45 13M75 82C83 76 87 68 88 58'),
    star: new Path2D('M50 0C54 40 58 46 100 50C58 54 54 60 50 100C46 60 42 54 0 50C42 46 46 40 50 0Z'),
    plaque: new Path2D('M8 42C-3 32 3 11 17 8C28 3 42 5 53 10L65 2C69 0 74 3 75 9L88 4C98 1 101 12 93 22C105 29 102 44 95 52L97 88C98 99 91 103 80 101L18 103C7 105 3 99 6 89L5 66C0 58 1 49 8 42Z'),
  };
}
// Lazy construction keeps server rendering safe and geometry fixed across tilt frames.
let anniversaryPaths: ReturnType<typeof createAnniversaryPaths> | undefined;
function drawAnniversary(ctx: CanvasRenderingContext2D, width: number, height: number, g: FoilOptics) {
  const foil = anniversaryPaths ??= createAnniversaryPaths();
  const foilAlpha = Math.min(.98, g.grooveAlpha * 1.25 + g.intensity * .30);
  const shiftX = g.normalizedTiltY * .008 * width, shiftY = g.normalizedTiltX * .006 * height;
  const brush = (band: number) => {
    const gradient = ctx.createLinearGradient(-8, -5, 108, 105);
    for (let sample = 0; sample <= 12; sample++) {
      const position = sample / 12, glint = clamp01(1 - Math.abs(position - g.reflectionCenterX) * 2);
      gradient.addColorStop(position, blend(spectrum(position * 3.7 + band * .85 + g.hue, anniversaryPalette), '#FFF0BC', glint * .10));
    }
    return gradient;
  };
  const softStroke = (path: Path2D, color: CanvasGradient, alpha: number, lineWidth: number) => {
    strokePath(ctx, path, '#39204B', alpha * .37, lineWidth * 1.8);
    strokePath(ctx, path, color, alpha * .05, lineWidth * 3.4);
    strokePath(ctx, path, color, alpha * .23, lineWidth * 2.35);
    strokePath(ctx, path, color, alpha * .97, lineWidth);
  };
  const text = (value: string, size: number, x: number, y: number, color: CanvasGradient, alpha: number, embossed = false) => {
    // Android uses bold sans-serif font outlines; Canvas uses the corresponding native font.
    ctx.font = `bold ${size}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (embossed) { ctx.strokeStyle = '#39204B'; ctx.lineWidth = 1.9; ctx.globalAlpha = alpha * .36; ctx.strokeText(value, x, y); }
    ctx.fillStyle = color; ctx.globalAlpha = alpha; ctx.fillText(value, x, y);
  };
  anniversaryMotifs.forEach(([x, y, motifWidth, angle, kind], index) => {
    const scale = width * motifWidth / 100, reflection = clamp01(1 - Math.abs(x - g.reflectionCenterX) * 1.5);
    const alpha = foilAlpha * (.86 + reflection * .14);
    ctx.save(); ctx.translate(x * width + shiftX, y * height + shiftY); ctx.rotate(angle * Math.PI / 180); ctx.scale(scale, scale); ctx.translate(-50, -50);
    const rainbow = brush(index % 6);
    if (kind === 'face') {
      softStroke(foil.faceHalo, rainbow, alpha * .65, 1.6); softStroke(foil.face, rainbow, alpha, 2.35); softStroke(foil.faceDetails, rainbow, alpha, 1.95); text('30', 29, 51, 95, rainbow, alpha, true);
    } else if (kind === 'ball') {
      softStroke(foil.ball, rainbow, alpha, 2.3); softStroke(foil.bubbleGlint, rainbow, alpha * .8, 2.1);
    } else {
      softStroke(foil.bubble, rainbow, alpha, 2.25); softStroke(foil.bubbleGlint, rainbow, alpha, 3); text('30', 32, 50, 63, rainbow, alpha * .94, true);
    }
    ctx.restore();
  });
  anniversaryGlints.forEach(([x, y, glintWidth], index) => {
    const scale = width * glintWidth / 100, reflection = clamp01(1 - Math.abs(x - g.reflectionCenterX) * 1.8), alpha = foilAlpha * (.66 + reflection * .34);
    ctx.save(); ctx.translate(x * width + shiftX, y * height + shiftY); ctx.scale(scale, scale); ctx.translate(-50, -50);
    const rainbow = brush((index + 2) % 6); softStroke(foil.star, rainbow, alpha * .52, 7);
    ctx.fillStyle = rainbow; ctx.globalAlpha = alpha * .96; ctx.fill(foil.star); ctx.restore();
  });
  for (let index = 0; index < 48; index++) {
    const along = .035 + Math.floor(index / 4) / 12 * .93, inset = .015 + (index % 5) * .009;
    const [x, y] = [[inset, along], [1 - inset, along], [along, inset], [along, 1 - inset]][index % 4];
    const reflection = clamp01(1 - Math.abs(x - g.reflectionCenterX) * 1.7);
    ctx.beginPath(); ctx.arc(x * width + shiftX, y * height + shiftY, width * (.0016 + (index % 3) * .0006), 0, Math.PI * 2);
    ctx.fillStyle = spectrum(index * .71 + g.hue, anniversaryPalette); ctx.globalAlpha = foilAlpha * (.5 + reflection * .4); ctx.fill();
  }
  // Only the small sculpted seal has a backing; all surrounding card artwork stays exposed.
  ctx.save(); ctx.translate(width * .678 + shiftX * .35, height * .465 + shiftY * .35); ctx.scale(width * .29 / 100, width * .29 / 100);
  const gold = ctx.createLinearGradient(-20 + g.normalizedTiltY * 18, -5, 120, 106 + g.normalizedTiltX * 18);
  ['#C38B29', '#FFF0AD', blend('#FFD348', spectrum(g.hue + 1.4, anniversaryPalette), .10), '#FFEDAD', '#D59C38'].forEach((color, index) => gold.addColorStop(index / 4, color));
  ctx.fillStyle = '#15100B'; ctx.globalAlpha = foilAlpha * .96; ctx.fill(foil.plaque); softStroke(foil.plaque, gold, foilAlpha * .87, 1.15);
  text('30', 60, 38, 59, gold, foilAlpha);
  ctx.save(); ctx.translate(63, 7); ctx.scale(.32, .32); softStroke(foil.face, gold, foilAlpha, 3.6); softStroke(foil.faceDetails, gold, foilAlpha, 3); ctx.restore();
  text('J A H R E', 14, 50, 74, gold, foilAlpha); text('GEMEINSAM', 10.5, 50, 88, gold, foilAlpha); text('W E I T E R', 10, 50, 99, gold, foilAlpha);
  ctx.restore();
}

export function drawSharedCover(ctx: CanvasRenderingContext2D, atlas: CanvasImageSource & { width: number; height: number }, width: number, height: number, id: string) {
  const index = coverIds.indexOf(id), crop = atlasCrop(atlas.width, atlas.height, 5, 4, index < 0 ? 4 : index);
  ctx.clearRect(0, 0, width, height); ctx.drawImage(atlas, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  // Static Android phase .5 and default intensity .68: no extra autonomous animation on the web.
  const sheen = ctx.createLinearGradient(width * .18, height, width * .68, 0); sheen.addColorStop(0, 'transparent'); sheen.addColorStop(.5, rgba('#FFFFFF', .068)); sheen.addColorStop(1, 'transparent'); ctx.fillStyle = sheen; ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * .72, height * .24, 0, width * .72, height * .24, Math.min(width, height) * .68); glow.addColorStop(0, rgba(coverHighlights[index < 0 ? 4 : index], .18 * .68)); glow.addColorStop(1, 'transparent'); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(width * .72, height * .24, Math.min(width, height) * .68, 0, 2 * Math.PI); ctx.fill();
  const spine = ctx.createLinearGradient(0, 0, width * .16, 0); spine.addColorStop(0, rgba('#000000', .78)); spine.addColorStop(.38, rgba('#000000', .34)); spine.addColorStop(1, 'transparent'); ctx.fillStyle = spine; ctx.fillRect(0, 0, width * .16, height);
  line(ctx, '#ffffff4d', width * .035, 0, width * .035, height, Math.max(1, width * .01)); line(ctx, '#0000009e', width * .105, 0, width * .105, height, Math.max(1, width * .015));
  const edge = ctx.createLinearGradient(width * .91, 0, width, 0); edge.addColorStop(0, 'transparent'); edge.addColorStop(.5, rgba('#FFFFFF', .30)); edge.addColorStop(1, rgba('#000000', .32)); ctx.fillStyle = edge; ctx.fillRect(width * .91, 0, width * .09, height);
  const vignette = ctx.createRadialGradient(width * .5, height * .5, 0, width * .5, height * .5, Math.max(width, height) * .72); vignette.addColorStop(0, 'transparent'); vignette.addColorStop(1, rgba('#000000', .34)); ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
}
