import {
  type FoilOptics,
  spectrum,
  rgba,
  blend,
  clamp01,
  polygon,
  fill,
  stroke,
} from "./binder-foil-core";

export const PREMIUM_FOIL_IDS: readonly string[] = [
  "rainbow", "linear", "diagonal", "galaxy", "nebula", "aurora", "crystal", "prism", "diamond",
];

type Point = readonly [number, number];
type Stop = readonly [number, string];

const PREMIUM_SPECTRUM = ["#ff467a", "#ffce46", "#55e58b", "#35ddf1", "#8273f5", "#ec64de"] as const;
// Android's default MEDIUM quality: fixed geometry budgets independent of card size.
const BUDGET = { bands: 4, cloudSamples: 26, facets: 9, glints: 6 } as const;
const SHOULDER_WEIGHTS = Array.from({ length: 12 }, (_, index) => Math.sin((index + 0.5) * Math.PI / 12));
const SHOULDER_TOTAL = SHOULDER_WEIGHTS.reduce((total, weight) => total + weight, 0);
const NORMALIZED_SHOULDER_WEIGHTS = SHOULDER_WEIGHTS.map((weight) => weight / SHOULDER_TOTAL);

const colour = (phase: number) => spectrum(Number.isFinite(phase) ? phase : 0, PREMIUM_SPECTRUM);
const fraction = (value: number) => ((value % 101 + 101) % 101) / 101;
const curvePoints = (position: (t: number) => Point): Point[] =>
  Array.from({ length: 25 }, (_, index) => position(index / 24));
const pathFor = (points: readonly Point[]): Path2D => polygon(...points.flatMap(([x, y]) => [x, y]));

function ribbonPath(points: readonly Point[], halfWidth: number): Path2D {
  const shoulders = points.map((point, index) => {
    const before = points[Math.max(index - 1, 0)];
    const after = points[Math.min(index + 1, points.length - 1)];
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.max(Math.hypot(dx, dy), 0.001);
    const nx = -dy / length * halfWidth;
    const ny = dx / length * halfWidth;
    return [[point[0] + nx, point[1] + ny], [point[0] - nx, point[1] - ny]] as const;
  });
  return pathFor([
    ...shoulders.map((shoulder) => shoulder[0]),
    ...shoulders.slice().reverse().map((shoulder) => shoulder[1]),
  ]);
}

/** A direct Canvas port of Android's filled premium foil materials in 100 × 100 space. */
export function drawPremiumFoil(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effectId: string,
  g: FoilOptics,
): void {
  if (!PREMIUM_FOIL_IDS.includes(effectId) || !Number.isFinite(g.intensity) || g.intensity <= 0 ||
      !Number.isFinite(g.grooveAlpha) || g.grooveAlpha <= 0 ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.scale(width / 100, height / 100);
    const painter = new PremiumFoilPainter(ctx, g);
    switch (effectId) {
      case "rainbow": painter.rainbow(); break;
      case "linear": painter.linear(); break;
      case "diagonal": painter.diagonal(); break;
      case "galaxy": painter.galaxy(); break;
      case "nebula": painter.nebula(); break;
      case "aurora": painter.aurora(); break;
      case "crystal": painter.crystal(); break;
      case "prism": painter.prism(); break;
      case "diamond": painter.diamond(); break;
    }
  } finally {
    ctx.restore();
  }
}

class PremiumFoilPainter {
  private readonly strength: number;
  private readonly shiftX: number;
  private readonly shiftY: number;
  private readonly reflectionX: number;
  private readonly phase: number;

  constructor(private readonly ctx: CanvasRenderingContext2D, private readonly g: FoilOptics) {
    this.strength = clamp01(g.grooveAlpha);
    this.shiftX = g.normalizedTiltY * 3;
    this.shiftY = g.normalizedTiltX * 2;
    this.reflectionX = g.reflectionCenterX * 100;
    this.phase = g.hue;
  }

  rainbow(): void {
    for (let index = 0; index < BUDGET.bands; index++) {
      const baseline = 13 + index * 79 / (BUDGET.bands - 1);
      const points = curvePoints((t) => [
        -10 + t * 120 + this.shiftX,
        baseline - Math.sin(t * Math.PI) * 16 + Math.sin(t * Math.PI * 2) * 3 + this.shiftY,
      ]);
      const brush = this.spectrumBrush(index * 0.45, [-8, baseline - 20], [108, baseline + 12]);
      this.featheredRibbon(points, 7.5 + index % 2 * 1.2, brush, 0.80);
      this.ribbonReflection(points, 5, 0.22);
    }
    this.scatteredGlints(11, BUDGET.glints, 0.75);
  }

  linear(): void {
    for (let index = 0; index < BUDGET.bands; index++) {
      const y = 13 + index * 82 / (BUDGET.bands - 1) + this.shiftY;
      const points: Point[] = [[-12, y + 5], [112, y - 5]];
      const brush = this.linearGradient([49, y - 8], [51, y + 8], [
        [0, rgba("#7775ff", 0)],
        [0.18, rgba("#7775ff", 0.36)],
        [0.43, rgba("#46cfff", 0.80)],
        [0.55, rgba("#d5f6ff", 0.88)],
        [0.68, rgba("#b497ff", 0.52)],
        [1, rgba("#b497ff", 0)],
      ]);
      this.featheredRibbon(points, 8, brush, 0.91);
      this.ctx.save();
      this.ctx.clip(ribbonPath(points, 7));
      const center: Point = [this.reflectionX + index * 4 - 6, y];
      this.circle(center, 25, this.radialGradient(center, 25, [
        [0, rgba(colour(index + this.phase), 0.56)],
        [1, rgba(colour(index + this.phase), 0)],
      ]), this.strength);
      this.ctx.globalCompositeOperation = "screen";
      for (let groove = 0; groove < 6; groove++) {
        const offset = -5 + groove * 1.8;
        this.line([-10, y + 5 + offset], [110, y - 5 + offset], "#e0f6ff", this.strength * 0.18, 0.14);
      }
      this.ctx.restore();
    }
    this.scatteredGlints(23, Math.floor(BUDGET.glints / 2), 0.62);
  }

  diagonal(): void {
    for (let index = 0; index < BUDGET.bands + 1; index++) {
      const x = -28 + index * 156 / BUDGET.bands + this.shiftX;
      const points: Point[] = [[x - 33, 109 + this.shiftY], [x + 33, -9 + this.shiftY]];
      const brush = this.linearGradient([x - 11, 44], [x + 11, 56], [
        [0, rgba(colour(index * 0.8 + this.phase), 0)],
        [0.22, rgba(colour(index * 0.8 + this.phase), 0.60)],
        [0.48, rgba(colour(index * 0.8 + this.phase + 1.5), 0.88)],
        [0.58, rgba("#c3faff", 0.56)],
        [0.75, rgba(colour(index * 0.8 + this.phase + 3.2), 0.68)],
        [1, rgba(colour(index * 0.8 + this.phase + 3.2), 0)],
      ]);
      this.featheredRibbon(points, 9, brush, 0.92);
      this.ribbonReflection(points, 6, 0.24);
    }
    this.scatteredGlints(41, BUDGET.glints, 0.66);
  }

  galaxy(): void {
    const origin: Point = [49 + this.shiftX, 43 + this.shiftY];
    for (let index = 0; index < BUDGET.cloudSamples; index++) {
      const arm = index % 2;
      const t = (index / 2 + 1) / (BUDGET.cloudSamples / 2);
      const angle = 0.3 + t * 5.5 + arm * Math.PI + this.phase * 0.045;
      const radius = 5 + t * 49;
      const location: Point = [origin[0] + Math.cos(angle) * radius, origin[1] + Math.sin(angle) * radius * 0.74];
      const tint = blend("#8051ef", arm === 0 ? "#ec67ef" : "#45dfff", clamp01(0.3 + 0.5 * Math.sin(t * 5 + this.phase)));
      this.glow(location, 5.8 + t * 5.2, tint, 0.36);
      if (index % 3 === 0) this.glow([location[0] + 1.2, location[1] - 1.1], 3.3, "#8fe9ff", 0.28);
    }
    this.glow(origin, 12, "#b980ff", 0.43);
    this.glow(origin, 4.4, "#f2d7ff", 0.50);
    for (let index = 0; index < BUDGET.cloudSamples * 2; index++) {
      const x = 4 + fraction(index * 47 + 13) * 92;
      const y = 5 + fraction(index * 71 + 31) * 90;
      this.circle([x + this.shiftX * 0.5, y + this.shiftY * 0.5], 0.12 + index % 3 * 0.075,
        index % 3 === 0 ? "#b7a4ff" : "#c3edff", this.strength * (0.42 + index % 4 * 0.12));
    }
    this.scatteredGlints(67, BUDGET.glints, 0.91);
  }

  nebula(): void {
    for (let index = 0; index < BUDGET.cloudSamples; index++) {
      const cluster = index % 3;
      const t = index / BUDGET.cloudSamples;
      const angle = index * 2.39996;
      const radius = 3 + fraction(index * 37 + 7) * 15;
      const base: Point = cluster === 0 ? [22, 24] : cluster === 1 ? [74, 47] : [31, 83];
      const location: Point = [
        base[0] + Math.cos(angle) * radius * 1.15 + this.shiftX,
        base[1] + Math.sin(angle) * radius * 0.65 + this.shiftY,
      ];
      const tint = cluster === 0 ? blend("#6d6eff", "#a24af3", t)
        : cluster === 1 ? blend("#d64ae7", "#ff82c1", t * 0.7)
        : blend("#26d8e8", "#697fff", t);
      this.glow(location, 10 + fraction(index * 19) * 10, tint, 0.31);
      if (index % 4 === 0) this.glow([location[0] - 2, location[1] + 1], 5.8, blend(tint, "#d3d4ff", 0.22), 0.31);
    }
    for (let index = 0; index < BUDGET.bands - 1; index++) {
      const points = curvePoints((t) => [
        -7 + t * 114 + this.shiftX,
        24 + index * 33 + Math.sin(t * 7 + index) * 8 + this.shiftY,
      ]);
      this.featheredRibbon(points, 2.7, this.spectrumBrush(this.phase + 3 + index, [0, 12], [100, 98]), 0.23);
    }
    this.scatteredGlints(89, Math.floor(BUDGET.glints / 2), 0.63);
  }

  aurora(): void {
    for (let index = 0; index < BUDGET.bands; index++) {
      const baseX = 9 + index * 82 / (BUDGET.bands - 1);
      const points = curvePoints((t) => [
        baseX + Math.sin(t * 6 + index * 0.6) * 10 + this.shiftX,
        -9 + t * 118 + this.shiftY,
      ]);
      const brush = this.linearGradient([baseX, -12 + this.g.normalizedTiltX * 16], [baseX + 12, 113], [
        [0, "#8cf7b9"], [0.25, "#27edbc"], [0.5, "#35cbe4"], [0.75, "#ab71ff"], [1, "#e992ee"],
      ]);
      this.featheredRibbon(points, 8.5, brush, 0.67);
      this.featheredRibbon(points.map(([x, y]): Point => [x - 2.5, y]), 2.5, brush, 0.39);
      this.ribbonReflection(points, 6, 0.19);
    }
    this.scatteredGlints(103, Math.floor(BUDGET.glints / 2), 0.55);
  }

  crystal(): void {
    for (let index = 0; index < BUDGET.facets; index++) {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const rows = Math.floor((BUDGET.facets + 2) / 3);
      const x = 15 + column * 35 + Math.sin(index * 2.7) * 5 + this.shiftX;
      const y = 13 + row * 78 / Math.max(rows - 1, 1) + Math.cos(index * 1.9) * 5 + this.shiftY;
      const lean = index % 2 === 0 ? 1 : -1;
      const a: Point = [x - 4 * lean, y - 17];
      const b: Point = [x + 13, y - 2];
      const c: Point = [x + 4 * lean, y + 19];
      const d: Point = [x - 12, y + 5];
      const middle: Point = [x + lean * 2, y];
      const light = this.reflection(x);
      this.facet([a, b, middle], "#87dfff", "#9994ff", 0.39 + light * 0.11);
      this.facet([b, c, middle], "#b9c7ff", "#48bce9", 0.26 + light * 0.13);
      this.facet([c, d, a, middle], "#78b9f4", "#a996fa", 0.17 + light * 0.10);
      this.softEdge(a, middle, "#ccfbff", 0.24 + light * 0.2);
      if (index % 3 === 0) this.glint(a, 0.95, 0.76);
    }
  }

  prism(): void {
    const origin: Point = [35 + this.shiftX, 36 + this.shiftY];
    const fanCount = BUDGET.bands + 2;
    for (let index = 0; index < fanCount; index++) {
      const angle = -0.40 + index * 1.95 / fanCount;
      const nextAngle = angle + 1.7 / fanCount;
      const edgeA: Point = [origin[0] + Math.cos(angle) * 111, origin[1] + Math.sin(angle) * 100];
      const edgeB: Point = [origin[0] + Math.cos(nextAngle) * 111, origin[1] + Math.sin(nextAngle) * 100];
      const tint = colour(index * 0.76 + this.phase);
      const path = pathFor([origin, edgeA, edgeB]);
      const brush = this.radialGradient(origin, 112, [
        [0, rgba(tint, 0.20)], [0.23, rgba(tint, 0.64)], [0.62, rgba(tint, 0.44)], [1, rgba(tint, 0)],
      ]);
      fill(this.ctx, path, brush, this.strength * 0.64);
      stroke(this.ctx, path, brush, this.strength * 0.035, 3);
    }
    const a: Point = [13 + this.shiftX, 16 + this.shiftY];
    const b: Point = [65 + this.shiftX, 27 + this.shiftY];
    const c: Point = [29 + this.shiftX, 70 + this.shiftY];
    this.facet([a, b, origin], "#8cedff", "#9775fc", 0.47);
    this.facet([a, c, origin], "#de92ff", "#55afff", 0.35);
    this.facet([b, c, origin], "#ffd36a", "#fd7ecf", 0.30);
    this.softEdge(a, origin, "#c4faff", 0.46);
    this.softEdge(b, origin, "#ffe3af", 0.42);
    this.glow(origin, 9, "#acefff", 0.31);
    this.glint(a, 1.1, 0.86);
    this.glint(b, 0.8, 0.76);
    this.glint(c, 0.75, 0.72);
  }

  diamond(): void {
    for (let index = 0; index < BUDGET.facets; index++) {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const rows = Math.floor((BUDGET.facets + 2) / 3);
      const x = 16 + column * 34 + (row % 2 === 0 ? -3 : 3) + this.shiftX;
      const y = 13 + row * 75 / Math.max(rows - 1, 1) + this.shiftY;
      const width = 10 + index % 3 * 1.3;
      const height = width * 0.91;
      const top: Point = [x, y - height];
      const right: Point = [x + width, y];
      const bottom: Point = [x, y + height];
      const left: Point = [x - width, y];
      const innerTop: Point = [x, y - height * 0.35];
      const innerRight: Point = [x + width * 0.36, y];
      const innerBottom: Point = [x, y + height * 0.35];
      const innerLeft: Point = [x - width * 0.36, y];
      const light = this.reflection(x + index % 2 * 13);
      const tint = blend("#59d1ee", colour(this.phase + index * 0.45), 0.42);
      fill(this.ctx, pathFor([top, right, bottom, left]), this.linearGradient(top, bottom, [
        [0, rgba("#7974b4", 0.24)], [0.5, rgba("#55cfe0", 0.08)], [1, rgba("#716296", 0.22)],
      ]), this.strength * 0.55);
      this.facet([top, right, innerRight, innerTop], "#b2f1ff", tint, 0.38 + light * 0.26);
      this.facet([right, bottom, innerBottom, innerRight], "#6dbbdc", "#8669cf", 0.30 + (1 - light) * 0.17);
      this.facet([bottom, left, innerLeft, innerBottom], "#ab86e9", "#45bdd1", 0.37 + light * 0.14);
      this.facet([left, top, innerTop, innerLeft], "#69bedb", "#a5e5f4", 0.32 + (1 - light) * 0.18);
      this.facet([innerTop, innerRight, innerBottom, innerLeft], "#92defb", tint, 0.31 + light * 0.18);
      this.softEdge(top, innerTop, "#f4fcff", 0.32 + light * 0.32);
      if (index % 2 === 0) this.glint(top, 0.7 + light * 0.42, 0.64 + light * 0.25);
    }
  }

  private featheredRibbon(points: readonly Point[], halfWidth: number, brush: CanvasGradient, exposure: number): void {
    // Twelve filled cosine shoulders preserve Android's original core transmittance.
    const amount = this.strength * exposure;
    const coreTransmission = (1 - amount * 0.065) * (1 - amount * 0.16) *
      (1 - amount * 0.24) * (1 - amount * 0.26);
    NORMALIZED_SHOULDER_WEIGHTS.forEach((weight, index) => {
      const width = halfWidth * 1.26 * (1 - index / 12);
      fill(this.ctx, ribbonPath(points, width), brush, 1 - Math.pow(coreTransmission, weight));
    });
  }

  private ribbonReflection(points: readonly Point[], halfWidth: number, exposure: number): void {
    const location: Point = [this.reflectionX, 49 - this.g.normalizedTiltX * 24];
    const brush = this.radialGradient(location, 37, [[0, rgba("#dcf8ff", exposure)], [1, rgba("#dcf8ff", 0)]]);
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    fill(this.ctx, ribbonPath(points, halfWidth), brush, this.strength);
    this.ctx.restore();
  }

  private glow(location: Point, radius: number, tint: string, exposure: number): void {
    const brush = this.radialGradient(location, radius, [
      [0, rgba(tint, exposure)], [0.28, rgba(tint, exposure * 0.77)],
      [0.65, rgba(tint, exposure * 0.27)], [1, rgba(tint, 0)],
    ]);
    this.circle(location, radius, brush, this.strength);
  }

  private facet(vertices: readonly Point[], bright: string, shade: string, exposure: number): void {
    const path = pathFor(vertices);
    const a = vertices[0];
    const b = vertices[Math.floor(vertices.length / 2)];
    const highlight = blend(bright, colour(this.phase + a[0] * 0.018), 0.13);
    const brush = this.linearGradient(a, b, [
      [0, rgba(highlight, 0.91)], [0.5, rgba(shade, 0.48)], [1, rgba(shade, 0.06)],
    ]);
    fill(this.ctx, path, brush, this.strength * exposure);
    stroke(this.ctx, path, brush, this.strength * exposure * 0.065, 1.25);
  }

  private softEdge(a: Point, b: Point, tint: string, exposure: number): void {
    this.ctx.save();
    this.ctx.lineCap = "round";
    this.line(a, b, tint, this.strength * exposure * 0.08, 1.4);
    this.line(a, b, tint, this.strength * exposure * 0.22, 0.56);
    this.line(a, b, tint, this.strength * exposure * 0.66, 0.18);
    this.ctx.restore();
  }

  private scatteredGlints(seed: number, count: number, exposure: number): void {
    for (let index = 0; index < count; index++) {
      const x = 7 + fraction(seed + index * 47) * 86 + this.shiftX;
      const y = 7 + fraction(seed * 3 + index * 61) * 86 + this.shiftY;
      this.glint([x, y], 0.50 + fraction(index * 37 + seed) * 0.75, exposure * (0.6 + this.reflection(x) * 0.4));
    }
  }

  private glint(location: Point, radius: number, exposure: number): void {
    const tint = blend(colour(this.phase + location[1] * 0.04), "#edf9ff", 0.72);
    this.glow(location, radius * 3, tint, exposure * 0.23);
    const [x, y] = location;
    const path = polygon(
      x, y - radius, x + radius * 0.20, y - radius * 0.17,
      x + radius, y, x + radius * 0.20, y + radius * 0.17,
      x, y + radius, x - radius * 0.20, y + radius * 0.17,
      x - radius, y, x - radius * 0.20, y - radius * 0.17,
    );
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    fill(this.ctx, path, tint, this.strength * exposure);
    this.ctx.restore();
    this.circle(location, radius * 0.14, "#ffffff", this.strength * exposure * 0.8);
  }

  private spectrumBrush(offset: number, start: Point, end: Point): CanvasGradient {
    return this.linearGradient(start, end,
      Array.from({ length: 13 }, (_, index): Stop => [index / 12, colour(index * 0.5 + offset + this.phase)]));
  }

  private reflection(x: number): number {
    return clamp01(1 - Math.abs(x - this.reflectionX) / 68);
  }

  private circle(location: Point, radius: number, brush: string | CanvasGradient, alpha: number): void {
    const path = new Path2D();
    path.arc(location[0], location[1], radius, 0, Math.PI * 2);
    fill(this.ctx, path, brush, alpha);
  }

  private line(a: Point, b: Point, brush: string, alpha: number, width: number): void {
    const path = new Path2D();
    path.moveTo(a[0], a[1]);
    path.lineTo(b[0], b[1]);
    stroke(this.ctx, path, brush, alpha, width);
  }

  private linearGradient(start: Point, end: Point, stops: readonly Stop[]): CanvasGradient {
    const gradient = this.ctx.createLinearGradient(start[0], start[1], end[0], end[1]);
    for (const [offset, tint] of stops) gradient.addColorStop(offset, tint);
    return gradient;
  }

  private radialGradient(center: Point, radius: number, stops: readonly Stop[]): CanvasGradient {
    const gradient = this.ctx.createRadialGradient(center[0], center[1], 0, center[0], center[1], radius);
    for (const [offset, tint] of stops) gradient.addColorStop(offset, tint);
    return gradient;
  }
}
