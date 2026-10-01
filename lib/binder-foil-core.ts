/** Shared drawing primitives for the Android procedural foil ports. */
export type FoilOptics = {
  intensity: number; grooveAlpha: number; normalizedTiltX: number; normalizedTiltY: number;
  reflectionCenterX: number; hue: number;
};
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;
export function blend(first: string, second: string, amount: number): string {
  // Compose Color.lerp interpolates in Oklab, then converts back to sRGB.
  // Decode the sRGB transfer curve before applying the D65 Oklab matrices.
  const toOklab = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const parsed = Number.parseInt(hex.slice(offset, offset + 2), 16);
      const value = Number.isFinite(parsed) ? clamp01(parsed / 255) : 0;
      return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4);
    });
    const [r, g, b] = channels;
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [
      .2104542553 * l + .7936177850 * m - .0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + .4505937099 * s,
      .0259040371 * l + .7827717662 * m - .8086757660 * s,
    ];
  };
  const start = toOklab(first), end = toOklab(second);
  // Keep NaN deterministic; finite overshoots and infinities select an endpoint.
  const t = Number.isNaN(amount) ? 0 : clamp01(amount);
  const [lightness, a, b] = start.map((value, index) => value + (end[index] - value) * t);
  const l = Math.pow(lightness + .3963377774 * a + .2158037573 * b, 3);
  const m = Math.pow(lightness - .1055613458 * a - .0638541728 * b, 3);
  const s = Math.pow(lightness - .0894841775 * a - 1.2914855480 * b, 3);
  return `#${[
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.7076147010 * s,
  ].map((channel) => {
    const linear = Number.isFinite(channel) ? clamp01(channel) : 0;
    const encoded = linear <= .0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - .055;
    return Math.round(clamp01(encoded) * 255).toString(16).padStart(2, '0');
  }).join('')}`;
}
const rainbow = ['#FF315F', '#FFCA28', '#36EF8D', '#20DFFF', '#6366FF', '#E348FF'];
export function spectrum(phase: number, palette: readonly string[] = rainbow) {
  const position = ((phase % palette.length) + palette.length) % palette.length, first = Math.floor(position);
  return blend(palette[first], palette[(first + 1) % palette.length], position - first);
}
export function polygon(...points: number[]) {
  const path = new Path2D(); path.moveTo(points[0], points[1]);
  for (let index = 2; index < points.length; index += 2) path.lineTo(points[index], points[index + 1]);
  path.closePath(); return path;
}
export function fill(ctx: CanvasRenderingContext2D, path: Path2D, brush: string | CanvasGradient, alpha: number, rule: CanvasFillRule = 'nonzero') {
  ctx.fillStyle = brush; ctx.globalAlpha = alpha; ctx.fill(path, rule);
}
export function stroke(ctx: CanvasRenderingContext2D, path: Path2D, brush: string | CanvasGradient, alpha: number, width: number) {
  ctx.strokeStyle = brush; ctx.globalAlpha = alpha; ctx.lineWidth = width;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(path);
}
