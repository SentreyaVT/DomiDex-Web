import { blend, clamp01, fill, spectrum, stroke, type FoilOptics } from './binder-foil-core';

// Direct path, placement and colour port of Android PrivateBinderElementFoil.
// Browser import remains safe on the server; Path2D is constructed on first draw only.
export const ELEMENT_FOIL_IDS = 'element_grass element_fire element_water element_electric element_psychic element_fighting element_darkness element_metal element_dragon element_colorless element_fairy'.split(' ');
const palette = ['#FF539A', '#FFCD45', '#7BE549', '#36DDF5', '#8D7AFF', '#E65DEA'];
const placements = [
  [.16, .14, .21, -22],
  [.80, .12, .16, 18],
  [.86, .33, .23, 12],
  [.12, .43, .19, -15],
  [.31, .62, .22, 27],
  [.76, .70, .20, -17],
  [.14, .86, .20, 20],
  [.87, .91, .16, -24],
  [.54, .20, .17, -8],
  [.58, .85, .18, 16],
  [.59, .47, .16, 9],
  [.38, .36, .17, -27],
  [.07, .67, .14, -12],
  [.91, .52, .15, 20],
  [.35, .91, .13, 32],
  [.36, .07, .14, -9],
  [.66, .04, .11, 25],
  [.63, .62, .12, -18],
  [.06, .26, .13, 14],
  [.93, .78, .13, -10]
];
type Artwork = { body: Path2D; facet: Path2D; highlight: Path2D; details: Path2D; companion: Path2D; shadow: string; color: string; light: string };
let geometry: ReturnType<typeof createGeometry> | undefined;
function createGeometry() {
  const glint = new Path2D("M 50  0 C 54  39  61  46  100  50 C 61  54  54  61  50  100 C 46  61  39  54  0  50 C 39  46  46  39  50  0 Z ");
  const leaf = new Path2D("M 17  88 C -2  39  41  8  91  6 C 92  48  80  89  17  88 Z ");
  const flame = new Path2D("M 51  96 C 14  101  3  75  20  48 C 21  64  31  64  32  49 C 28  28  53  22  51  2 C 76  25  61  42  73  52 C 81  57  81  44  82  36 C 113  74  81  99  51  96 Z ");
  const drop = new Path2D("M 50  4 C 44  29  17  40  17  64 C 17  104  83  104  83  64 C 83  40  60  28  50  4 Z ");
  const bolt = new Path2D("M 53  2 L 14  53 L 43  49 L 29  98 L 87  34 L 58  40 L 77  3 Z ");
  const shard = new Path2D("M 49  4 L 83  37 L 66  86 L 18  96 L 29  42 Z ");
  const crescent = new Path2D("M 79  10 C 17  -14  -7  67  40  92 C 61  103  82  92  91  74 C 62  87  38  60  47  36 C 52  21  66  12  79  10 Z ");
  const scale = new Path2D("M 9  26 C 21  6  77  6  91  26 C 95  56  73  81  50  96 C 28  81  6  56  9  26 Z ");
  const petal = new Path2D("M 50  94 C 8  76  6  24  31  11 C 47  1  50  28  57  18 C 91  -4  109  57  50  94 Z ");
  const star = new Path2D("M 50  2 L 63  32 L 92  24 L 77  51 L 97  72 L 65  72 L 50  99 L 37  73 L 5  76 L 24  51 L 8  23 L 38  32 Z ");
  const artworks: Record<string, Artwork> = {
        'element_grass': {
            body: leaf,
            facet: new Path2D("M 17  88 C 41  56  57  37  91  6 C 92  48  80  89  17  88 Z "),
            highlight: new Path2D("M 18  67 C 15  40  40  20  69  14 C 39  31  28  46  18  67 Z "),
            details: new Path2D("M 11  96 C 37  65  61  34  87  11 M 37  63 L 30  40 M 51  46 L 49  25 M 35  66 L 62  68 M 51  47 L 77  44"),
            companion: leaf,
            shadow: '#153B36', color: '#5BBE47', light: '#D4ED7B',
        },
        'element_fire': {
            body: flame,
            facet: new Path2D("M 47  92 C 18  75  51  56  47  34 C 72  55  44  67  66  89 C 61  96  54  96  47  92 Z "),
            highlight: new Path2D("M 75  85 C 88  72  86  62  83  55 C 102  72  89  91  75  85 Z "),
            details: new Path2D("M 28  81 C 22  73  23  65  25  61 M 60  42 C 66  32  65  23  59  17"),
            companion: flame,
            shadow: '#743344', color: '#FA6E34', light: '#FFD866',
        },
        'element_water': {
            body: drop,
            facet: new Path2D("M 50  10 C 57  52  94  65  63  89 C 91  84  91  63  78  46 Z "),
            highlight: new Path2D("M 27  66 C 25  49  41  37  45  29 C 42  48  30  57  31  70 Z "),
            details: new Path2D("M 6  83 C -8  105  107  110  100  83 M 8  91 C 26  108  76  109  92  95 M 53  84 C 65  85  72  77  73  68"),
            companion: drop,
            shadow: '#21436D', color: '#399CDF', light: '#97EBEE',
        },
        'element_electric': {
            body: bolt,
            facet: new Path2D("M 53  2 L 43  49 L 14  53 Z  M 87  34 L 43  64 L 29  98 Z "),
            highlight: new Path2D("M 58  7 L 50  42 L 69  7 Z "),
            details: new Path2D("M 18  22 L 8  16 M 90  70 L 99  76 M 20  75 L 9  83"),
            companion: bolt,
            shadow: '#6B4A2D', color: '#F2C735', light: '#FFED8D',
        },
        'element_psychic': {
            body: new Path2D("M 3  51 C 32  14  65  14  97  51 C 66  84  32  84  3  51 Z "),
            facet: new Path2D(" M 72 51 A 21.5 22 0 1 1 29 51 A 21.5 22 0 1 1 72 51 Z M 8  24 C 30  0  70  2  91  23 C 64  11  33  9  8  24 Z  M 9  78 C 36  93  67  88  92  77 C 71  101  30  103  9  78 Z "),
            highlight: new Path2D("M 43  34 C 21  45  41  75  53  66 C 39  60  37  47  43  34 Z   M 60 39.5 A 4.5 4.5 0 1 1 51 39.5 A 4.5 4.5 0 1 1 60 39.5 Z"),
            details: new Path2D(" M 60 51 A 10 12 0 1 1 40 51 A 10 12 0 1 1 60 51 Z M 15  49 C 29  35  41  30  49  30 M 52  6 L 52  0 M 50  94 L 50  101"),
            companion: glint,
            shadow: '#502153', color: '#B35BCF', light: '#FBA6E2',
        },
        'element_fighting': {
            body: new Path2D("M 53  7 L 83  29 L 71  47 L 83  58 L 60  91 L 20  76 L 31  54 L 19  41 Z  M 12  24 L 1  48 L 19  55 Z  M 89  67 L 77  96 L 99  89 Z "),
            facet: new Path2D("M 53  7 L 51  54 L 19  41 Z  M 51  54 L 83  58 L 60  91 Z "),
            highlight: new Path2D("M 29  72 L 51  54 L 39  77 Z "),
            details: new Path2D("M 53  15 L 51  54 L 68  47 M 44  87 L 39  95 M 82  18 L 90  9"),
            companion: shard,
            shadow: '#663529', color: '#C9824A', light: '#F1C484',
        },
        'element_darkness': {
            body: crescent,
            facet: new Path2D("M 58  9 C 14  20  15  78  56  88 C 4  75  8  19  58  9 Z "),
            highlight: new Path2D("M 30  22 C 14  44  18  71  31  80 C 7  65  11  34  30  22 Z "),
            details: new Path2D("M 56  46 C 84  20  99  43  76  53 C 58  60  62  69  79  64  M 80 27 A 2 2 0 1 1 76 27 A 2 2 0 1 1 80 27 Z"),
            companion: crescent,
            shadow: '#191D3D', color: '#645C9E', light: '#92BDCF',
        },
        'element_metal': {
            body: new Path2D("M 25  10 L 77  10 L 94  30 L 82  81 L 28  95 L 7  70 Z "),
            facet: new Path2D("M 25  10 L 35  29 L 20  66 L 7  70 Z  M 20  66 L 75  64 L 82  81 L 28  95 Z "),
            highlight: new Path2D("M 35  29 L 77  10 L 94  30 L 75  64 Z "),
            details: new Path2D("M 35  29 L 75  32 L 75  64 L 20  66  M 35 46 A 2 2 0 1 1 31 46 A 2 2 0 1 1 35 46 Z  M 66 49 A 2 2 0 1 1 62 49 A 2 2 0 1 1 66 49 Z M 35  78 L 64  72"),
            companion: shard,
            shadow: '#384559', color: '#98AEB9', light: '#DEF0EA',
        },
        'element_dragon': {
            body: scale,
            facet: new Path2D("M 50  17 L 50  96 C 73  81  95  56  91  26 Z "),
            highlight: new Path2D("M 15  27 C 31  10  69  11  86  27 C 57  22  46  25  50  90 C 45  44  43  23  15  27 Z "),
            details: new Path2D("M 17  40 C 21  61  33  75  45  85 M 79  40 C 73  57  65  68  56  75"),
            companion: scale,
            shadow: '#554333', color: '#CAA649', light: '#B5E5A4',
        },
        'element_colorless': {
            body: star,
            facet: new Path2D("M 50  2 L 50  51 L 92  24 L 63  32 Z  M 50  51 L 97  72 L 65  72 L 50  99 Z  M 50  51 L 8  23 L 38  32 Z "),
            highlight: new Path2D("M 50  17 L 54  47 L 81  65 L 49  56 L 19  66 L 45  47 Z "),
            details: new Path2D("M 50  5 L 50  51 L 10  74 M 50  51 L 89  26"),
            companion: star,
            shadow: '#505579', color: '#B7BED1', light: '#E4EBF3',
        },
        'element_fairy': {
            body: petal,
            facet: new Path2D("M 50  94 C 45  71  57  43  73  23 C 82  16  87  26  87  37 C 88  55  70  77  50  94 Z "),
            highlight: new Path2D("M 24  45 C 17  23  31  8  40  25 C 28  20  26  35  24  45 Z "),
            details: new Path2D("M 47  98 C 40  110  15  102  15  85 C 12  71  -1  67  1  83 M 48  85 C 34  63  40  44  47  34"),
            companion: petal,
            shadow: '#713F6A', color: '#E989B7', light: '#FFCEDB',
        },
  };
  return { artworks, glint };
}

export function drawElementFoil(ctx: CanvasRenderingContext2D, width: number, height: number, effectId: string, g: FoilOptics) {
  const shapes = geometry ??= createGeometry(), artwork = shapes.artworks[effectId];
  if (!artwork || g.intensity <= 0 || g.grooveAlpha <= 0) return;
  const alpha = Math.min(.97, g.grooveAlpha * .96 + g.intensity * .18), count = 16;
  const shiftX = g.normalizedTiltY * width * .009, shiftY = g.normalizedTiltX * height * .007;
  // Canvas gradients live in the current coordinate system, so build them after
  // transforming to each motif's 100-unit local space (as Compose brushes do).
  const brushes = (band: number) => {
    const face = ctx.createLinearGradient(g.normalizedTiltY * 15, 5, 96, 112 + g.normalizedTiltX * 15);
    [artwork.shadow, artwork.color, artwork.light, artwork.color].forEach((color, index) => face.addColorStop(index / 3, color));
    const prism = ctx.createLinearGradient(-6, -5, 106, 102);
    for (let sample = 0; sample <= 12; sample++) prism.addColorStop(sample / 12, blend(spectrum(sample / 12 * 5.4 + band * .77 + g.hue, palette), artwork.light, .12));
    return { face, prism };
  };
  const at = (x: number, y: number, size: number, angle: number, draw: () => void) => {
    ctx.save(); ctx.translate(x * width + shiftX, y * height + shiftY); ctx.rotate(angle * Math.PI / 180);
    ctx.scale(size, size); ctx.translate(-50, -50); draw(); ctx.restore();
  };
  const etch = (path: Path2D, brush: CanvasGradient, opacity: number, lineWidth: number) => {
    stroke(ctx, path, brush, opacity * .08, lineWidth * 3);
    stroke(ctx, path, brush, opacity, lineWidth);
  };
  placements.slice(0, count).forEach(([x, y, motifWidth, rotation], index) => {
    const reflection = clamp01(1 - Math.abs(x - g.reflectionCenterX) * 1.7), localAlpha = alpha * (.76 + reflection * .24);
    const scale = width * motifWidth / 100;
    at(x, y, scale, rotation, () => {
      const { face, prism } = brushes(index % 6);
      stroke(ctx, artwork.body, artwork.shadow, localAlpha * .32, 3.6);
      fill(ctx, artwork.body, face, localAlpha * .48);
      fill(ctx, artwork.facet, prism, localAlpha * .43);
      fill(ctx, artwork.highlight, prism, localAlpha * .68);
      etch(artwork.body, prism, localAlpha * .88, 1.55);
      etch(artwork.details, prism, localAlpha * .96, 1.8);
      if (index % 3 === 0) {
        ctx.beginPath(); ctx.arc(33, 28, 1.4, 0, 2 * Math.PI);
        ctx.fillStyle = artwork.light; ctx.globalAlpha = localAlpha * (.40 + reflection * .38); ctx.fill();
      }
    });
    // Flame and lightning silhouettes have no touching miniature duplicates.
    if (effectId !== 'element_fire' && effectId !== 'element_electric') {
      at(x + (index % 2 === 0 ? .070 : -.063), y + .051, scale * (.27 + index % 3 * .065), -rotation + 24, () => {
        const { face } = brushes(index % 6), { prism } = brushes((index + 2) % 6);
        fill(ctx, artwork.companion, face, localAlpha * .58); fill(ctx, artwork.companion, prism, localAlpha * .52);
      });
    }
  });
  for (let index = 0; index < count + 6; index++) {
    const x = .055 + ((index * 41 + 11) % 89) / 100, y = .055 + ((index * 29 + 7) % 89) / 100;
    const reflection = clamp01(1 - Math.abs(x - g.reflectionCenterX) * 1.7);
    at(x, y, width * (.013 + index % 3 * .006) / 100, 0, () => {
      fill(ctx, shapes.glint, brushes(index % 6).prism, alpha * (.33 + reflection * .30));
    });
  }
}

