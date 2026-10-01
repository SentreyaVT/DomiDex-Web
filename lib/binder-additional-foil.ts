import { blend, clamp01, fill, rgba, spectrum, stroke, type FoilOptics } from './binder-foil-core';

/** Android's filled additional materials, using its MEDIUM detail budget. */
export const ADDITIONAL_FOIL_IDS = 'oil_slick liquid_metal hyper_wave fire ice void holo_spark'.split(' ');
const palette = ['#FF568C', '#FFD242', '#71EFA0', '#28D9F3', '#8872FF', '#F26AE6'];
type Motif = [number, number, number, number?, number?];
const pools: Motif[] = [[.18, .16, .40, -24, .82], [.80, .36, .47, 25, .92], [.30, .66, .44, -37, .85], [.75, .87, .39, 19, .77], [.09, .91, .29, -8, .82], [.72, .085, .33, 14, .72], [.15, .40, .28, 32, .78], [.59, .56, .30, -30, .78], [.93, .65, .28, -10, .90], [.44, .27, .23, 45, .69]];
const mercury: Motif[] = [[.17, .13, .35, -30, .80], [.79, .30, .36, 47, 1.10], [.28, .55, .34, -42, 1.25], [.68, .79, .40, 32, .96], [.10, .86, .28, 9, 1.03], [.86, .92, .25, -43, .76], [.68, .06, .26, 58, .95], [.08, .32, .21, 44, 1.08], [.91, .57, .24, -60, .83], [.47, .33, .21, 15, .80], [.39, .92, .22, -19, .89]];
const ribbons: Motif[] = [[.44, .17, 1.02, -10, .56], [.57, .53, 1.05, 15, .57], [.42, .88, 1.02, -12, .53], [.52, .35, .82, -14, .43], [.45, .70, .91, 18, .43]];
const flames: Motif[] = [[.12, .87, .29, -16, 1.38], [.78, .65, .29, 15, 1.44], [.27, .38, .27, -9, 1.36], [.81, .13, .25, 22, 1.24], [.46, .93, .22, 11, 1.38], [.09, .11, .20, -16, 1.27], [.58, .45, .21, 19, 1.30], [.92, .91, .19, 9, 1.35], [.10, .60, .17, -24, 1.38], [.50, .15, .17, 14, 1.32]];
const ice: Motif[] = [[.10, .13, .28, -29, 1.24], [.79, .32, .26, 36, 1.60], [.24, .60, .32, -24, 1.45], [.77, .88, .29, 17, 1.27], [.09, .92, .20, -32, 1.39], [.72, .07, .24, 62, 1.02], [.91, .62, .22, -18, 1.18], [.46, .36, .20, 16, 1.33], [.49, .78, .18, -36, 1.21], [.06, .39, .19, 10, 1.29], [.44, .08, .17, -8, 1.10]];
const eclipses: Motif[] = [[.24, .17, .46, -32], [.79, .49, .52, 24], [.22, .76, .47, -12], [.81, .92, .29, 34], [.83, .10, .25, 96], [.17, .42, .24, -50]];
const sparks: Motif[] = [[.15, .13, .23, -13], [.80, .33, .25, 16], [.29, .58, .25, -30], [.72, .82, .27, 13], [.12, .90, .18, 28], [.81, .09, .18, -9], [.12, .37, .17, 37], [.92, .64, .19, -23], [.53, .19, .17, 19], [.51, .43, .16, -29], [.41, .87, .16, 13], [.90, .92, .15, -6]];
function accents(seed: number, size: number, aspect = 1): Motif[] {
  return Array.from({ length: 15 }, (_, index) => [
    .055 + ((index * 37 + seed * 13) % 89) / 100, .045 + ((index * 53 + seed * 17) % 91) / 100,
    size * (.70 + index % 3 * .19), index * 67 + seed * 11, aspect,
  ]);
}
const oilDroplets = accents(2, .075, .72), chromeDroplets = accents(4, .059), waveDroplets = accents(8, .052, .62);
const embers = accents(5, .039, 1.60), iceDroplets = accents(6, .047, 1.30), voidDroplets = accents(9, .036);
let geometry: ReturnType<typeof createGeometry> | undefined;
function createGeometry() {
  return {
    pool: new Path2D("M 8  41 C -2  14  27  3  49  16 C 70  28  89  5  97  33 C 110  63  81  92  61  84 C 37  75  18  108  5  77 C -2  60  15  56  8  41 Z "),
    poolBand: new Path2D(" M 8  41 C -2  14  27  3  49  16 C 70  28  89  5  97  33 C 110  63  81  92  61  84 C 37  75  18  108  5  77 C -2  60  15  56  8  41 Z M 18  38 C 12  23  31  15  48  26 C 68  41  86  21  88  39 C 92  62  77  75  58  68 C 39  62  22  88  16  73 C 9  59  25  51  18  38 Z "),
    poolInnerBand: new Path2D("M 23  38 C 38  25  45  40  59  43 C 71  45  85  35  82  51 C 80  67  62  61  54  59 C 39  56  29  72  25  68 C 20  59  44  49  38  44 C 34  39  23  46  23  38 Z "),
    poolSheen: new Path2D("M 12  30 C 19  13  34  14  48  23 C 32  19  25  27  24  37 C 22  48  15  49  12  30 Z "),
    mercuryBody: new Path2D("M 25  8 C 54  -10  64  13  60  29 C 53  44  96  38  96  66 C 100  89  73  101  59  90 C 45  80  58  65  36  65 C 10  68  0  53  9  33 C 17  24  12  16  25  8 Z "),
    mercuryFold: new Path2D("M 44  37 C 55  56  87  41  87  65 C 86  78  78  85  66  81 C 82  76  79  65  64  62 C 52  58  42  58  44  37 Z "),
    mercuryLight: new Path2D("M 21  20 C 35  7  52  11  52  23 C 38  18  31  30  24  43 C 16  59  12  42  21  20 Z "),
    ribbon: new Path2D("M -6  72 C 12  71  11  20  32  15 C 53  11  48  79  68  78 C 86  78  82  30  105  28 C 88  41  91  95  68  96 C 39  97  46  29  30  32 C 16  35  20  81  -6  72 Z "),
    ribbonFold: new Path2D("M 33  16 C 52  20  48  70  63  77 L 70  95 C 42  97  44  37  33  16 Z "),
    ribbonCrest: new Path2D("M 0  72 C 18  67  13  24  33  18 C 42  16  45  30  45  41 C 37  21  29  25  23  46 C 18  64  14  76  0  72 Z  M 68  81 C 88  82  85  37  101  30 C 89  46  89  89  72  91 C 66  91  61  85  58  77 C 62  80  65  82  68  81 Z "),
    flame: new Path2D("M 48  1 C 70  28  44  39  59  51 C 69  40  66  32  74  24 C 74  48  97  53  91  75 C 86  99  60  101  47  96 C 15  100  1  77  15  53 C 17  71  32  66  29  52 C 17  30  49  20  48  1 Z "),
    flameCore: new Path2D("M 53  42 C 70  63  60  69  68  77 C 77  67  81  80  71  88 C 49  105  26  82  39  64 C 38  83  52  78  48  66 C 44  57  55  51  53  42 Z "),
    flameTongue: new Path2D("M 10  39 C 1  28  22  16  19  6 C 31  17  19  25  22  32 C 22  40  16  46  10  39 Z "),
    ember: new Path2D("M 57  2 C 87  49  79  89  46  98 C 14  83  33  48  57  2 Z "),
    iceShard: new Path2D("M 43 1 L 75 20 91 65 60 99 22 86 4 47 Z"),
    iceFace: new Path2D("M 43 1 L 49 50 22 86 4 47 Z"),
    iceShadow: new Path2D("M 49 50 L 75 20 91 65 60 99 Z"),
    iceHighlight: new Path2D("M 43 1 L 57 16 60 62 49 50 36 66 Z"),
    iceSplinter: new Path2D("M 84 44 L 101 28 110 72 93 87 Z"),
    eclipseShadow: new Path2D("M 77  8 C 18  -19  -18  49  14  83 C 32  108  62  105  82  86 C 38  103  11  51  42  24 C 54  12  66  11  77  8 Z "),
    eclipseCorona: new Path2D("M 72  4 C 20  -10  -4  36  10  67 C 21  91  51  102  75  88 C 42  94  18  71  21  44 C 23  18  47  8  72  4 Z "),
    eclipseInner: new Path2D("M 67  13 C 34  13  18  38  28  64 C 36  82  54  88  76  85 C 50  77  37  64  37  43 C 37  26  49  20  67  13 Z "),
    eclipseCrest: new Path2D("M 57  4 C 31  6  10  23  12  47 C 15  28  26  17  44  13 C 50  11  54  7  57  4 Z  M 83  80 C 95  68  99  43  90  29 C 104  43  105  70  83  80 Z "),
    spark: new Path2D("M 49 0 L 59 30 83 13 71 42 100 48 69 59 84 88 57 73 49 100 40 68 12 83 29 56 0 45 33 37 20 13 43 29 Z"),
    sparkFacet: new Path2D("M 49 0 L 49 45 100 48 57 55 84 88 49 61 49 100 40 55 12 83 40 46 Z"),
    sparkCore: new Path2D("M 49 28 L 56 43 73 48 55 56 49 74 42 56 25 47 42 42 Z"),
    sparkSatellite: new Path2D(" M 91 2 L 98 10 91 23 83 13 Z  M 5 89 L 15 91 13 103 3 100 Z"),
    drop: new Path2D("M 23  16 C 53  -4  94  27  87  62 C 87  94  42  104  17  80 C 0  63  4  34  23  16 Z "),
    smallShard: new Path2D("M 43 0 L 88 35 65 96 9 69 Z"),
  };
}

export function drawAdditionalFoil(ctx: CanvasRenderingContext2D, width: number, height: number, effectId: string, g: FoilOptics) {
  if (!ADDITIONAL_FOIL_IDS.includes(effectId) || g.intensity <= 0 || g.grooveAlpha <= 0) return;
  const shapes = geometry ??= createGeometry(), exposure = Math.min(.98, g.grooveAlpha + g.intensity * .18);
  const spec = (phase: number) => spectrum(phase, palette);
  const opacity = (motif: Motif) => exposure * (.80 + clamp01(1 - Math.abs(motif[0] - g.reflectionCenterX) * 1.5) * .20);
  const at = (motif: Motif, draw: (spectra: CanvasGradient[], highlight: CanvasGradient) => void) => {
    const [x, y, motifWidth, angle = 0, aspect = 1] = motif, scale = width * motifWidth / 100;
    ctx.save(); ctx.translate((x + g.normalizedTiltY * .008) * width, (y + g.normalizedTiltX * .006) * height);
    ctx.rotate(angle * Math.PI / 180); ctx.scale(scale, scale * aspect); ctx.translate(-50, -50);
    const spectra = Array.from({ length: 5 }, (_, phase) => {
      const brush = ctx.createLinearGradient(-12 + g.normalizedTiltY * 22, -20, 112, 120 + g.normalizedTiltX * 24);
      for (let sample = 0; sample <= 12; sample++) brush.addColorStop(sample / 12, spec(sample / 12 * 4.8 + phase * .84 + g.hue));
      return brush;
    });
    const hx = 32 + g.normalizedTiltY * 30, hy = 25 + g.normalizedTiltX * 21;
    const highlight = ctx.createRadialGradient(hx, hy, 0, hx, hy, 66);
    highlight.addColorStop(0, '#F5F9EC'); highlight.addColorStop(1, rgba('#8CDFF8', 0));
    draw(spectra, highlight); ctx.restore();
  };
  const softBody = (path: Path2D, brush: CanvasGradient, alpha: number, shoulder: number, rule: CanvasFillRule = 'nonzero') => {
    stroke(ctx, path, brush, alpha * .10, shoulder * 2);
    stroke(ctx, path, '#261D51', alpha * .16, shoulder * .70);
    fill(ctx, path, brush, alpha, rule);
  };
  const gradient = (colors: string[], x1: number, y1: number, x2: number, y2: number, stops?: number[]) => {
    const brush = ctx.createLinearGradient(x1, y1, x2, y2);
    colors.forEach((color, index) => brush.addColorStop(stops?.[index] ?? index / (colors.length - 1), color)); return brush;
  };
  const droplets = (layout: Motif[], count: number, alpha: number, angular = false) => {
    layout.slice(0, count).forEach((motif, index) => at(motif, (spectra) => fill(ctx, angular ? shapes.smallShard : shapes.drop, spectra[index % 5], opacity(motif) * alpha)));
  };
  if (effectId === 'oil_slick') {
    pools.slice(0, 8).forEach((motif, index) => at(motif, (spectra, highlight) => {
      const alpha = opacity(motif), spectrum = spectra[index % 5];
      fill(ctx, shapes.pool, '#351148', alpha * .20);
      softBody(shapes.poolBand, spectrum, alpha * .67, 2.4, 'evenodd');
      fill(ctx, shapes.poolInnerBand, spectra[(index + 2) % 5], alpha * .55);
      fill(ctx, shapes.poolSheen, spectrum, alpha * .36); fill(ctx, shapes.poolSheen, highlight, alpha * .19);
    }));
    droplets(oilDroplets, 7, .50);
  } else if (effectId === 'liquid_metal') {
    mercury.slice(0, 9).forEach((motif, index) => at(motif, (spectra, highlight) => {
      const alpha = opacity(motif);
      const chrome = gradient(['#252E59', '#B8E8F0', '#4D7199', '#101D3D', blend('#D8F3F0', spec(g.hue + 2), .30), '#F0F7EB', '#6878A8', '#382249'],
        -10 + g.normalizedTiltY * 34, -4, 100, 105 + g.normalizedTiltX * 24, [0, .20, .34, .45, .58, .71, .87, 1]);
      softBody(shapes.mercuryBody, spectra[index % 5], alpha * .29, 2.2);
      fill(ctx, shapes.mercuryBody, chrome, alpha * .66); fill(ctx, shapes.mercuryFold, spectra[(index + 1) % 5], alpha * .48);
      fill(ctx, shapes.mercuryLight, highlight, alpha * .49);
    }));
    droplets(chromeDroplets, 7, .72);
  } else if (effectId === 'hyper_wave') {
    ribbons.slice(0, 4).forEach((motif, index) => at(motif, (spectra, highlight) => {
      const alpha = opacity(motif);
      softBody(shapes.ribbon, spectra[index % 5], alpha * .60, 2.8);
      fill(ctx, shapes.ribbonFold, '#391A75', alpha * .38); fill(ctx, shapes.ribbonFold, spectra[(index + 3) % 5], alpha * .48);
      fill(ctx, shapes.ribbonCrest, spectra[(index + 1) % 5], alpha * .67); fill(ctx, shapes.ribbonCrest, highlight, alpha * .30);
    }));
    droplets(waveDroplets, 6, .57);
  } else if (effectId === 'fire') {
    flames.slice(0, 8).forEach((motif, index) => at(motif, (spectra, highlight) => {
      const alpha = opacity(motif);
      const flame = gradient([blend('#EA3988', spec(g.hue + 5), .27), '#FF7439', blend('#FFD34A', spec(g.hue + 1), .24), '#9D2478'],
        18 + g.normalizedTiltY * 20, 8, 86, 111 + g.normalizedTiltX * 16);
      softBody(shapes.flame, flame, alpha * .57, 2.9);
      fill(ctx, shapes.flameCore, spectra[(index + 1) % 5], alpha * .50); fill(ctx, shapes.flameCore, highlight, alpha * .27);
      fill(ctx, shapes.flameTongue, flame, alpha * .58);
    }));
    embers.slice(0, 12).forEach((motif, index) => at(motif, (spectra) => fill(ctx, shapes.ember, spectra[index % 5], exposure * .77)));
  } else if (effectId === 'ice') {
    ice.slice(0, 9).forEach((motif, index) => at(motif, (spectra, highlight) => {
      const alpha = opacity(motif);
      const blue = gradient(['#248CC0', '#9CF6EC', blend('#B9C8FF', spec(g.hue + 3.4), .43), '#506DD4'],
        -8 + g.normalizedTiltY * 30, -10, 110, 112 + g.normalizedTiltX * 28);
      softBody(shapes.iceShard, blue, alpha * .48, 1.8); fill(ctx, shapes.iceFace, spectra[(index + 2) % 5], alpha * .51);
      fill(ctx, shapes.iceShadow, '#32419B', alpha * .28); fill(ctx, shapes.iceHighlight, highlight, alpha * .60);
      fill(ctx, shapes.iceSplinter, spectra[index % 5], alpha * .67);
    }));
    droplets(iceDroplets, 7, .45, true);
  } else if (effectId === 'void') {
    eclipses.slice(0, 5).forEach((motif, index) => at(motif, (spectra, highlight) => {
      const alpha = opacity(motif);
      fill(ctx, shapes.eclipseShadow, '#100B2D', alpha * .45); softBody(shapes.eclipseCorona, spectra[(index + 3) % 5], alpha * .72, 3.2);
      fill(ctx, shapes.eclipseInner, '#4B207F', alpha * .28); fill(ctx, shapes.eclipseCrest, spectra[index % 5], alpha * .72);
      fill(ctx, shapes.eclipseCrest, highlight, alpha * .22);
    }));
    droplets(voidDroplets, 8, .62, true);
  } else if (effectId === 'holo_spark') {
    sparks.slice(0, 10).forEach((motif, index) => at(motif, (spectra, highlight) => {
      const alpha = opacity(motif);
      softBody(shapes.spark, spectra[index % 5], alpha * .80, 2.3);
      fill(ctx, shapes.sparkFacet, spectra[(index + 2) % 5], alpha * .62); fill(ctx, shapes.sparkCore, highlight, alpha * .67);
      fill(ctx, shapes.sparkSatellite, spectra[(index + 1) % 5], alpha * .86);
    }));
  }
}

