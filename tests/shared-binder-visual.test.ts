import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atlasCrop, coverIds, drawSharedHolo, holoGeometry, holoIds, holoMaterial, proceduralHoloIds, sharedTilt } from '@/lib/shared-binder-visual';
import androidContract from './fixtures/android-binder-visual-contract.json';
import { blend } from '@/lib/binder-foil-core';

describe('same Android material and deterministic motion contract', () => {
  it('matches Compose Oklab colour interpolation for the new procedural spectra', () => {
    expect(blend('#000000', '#ffffff', .5)).toBe('#636363');
    expect(blend('#ff568c', '#ffd242', .5)).toBe('#ff9a74');
    expect(blend('#71efa0', '#28d9f3', .5)).toBe('#52e5cc');
  });
  it('keeps the original atlas files byte-identical without generating replacement artwork', () => {
    const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    for (const [file, sha256] of Object.entries(androidContract.atlasSha256)) expect(digest(`public/binder-materials/${file}`)).toBe(sha256);
  });
  it('maps stable IDs to Android procedural materials or their original atlas cell', () => {
    expect(coverIds).toEqual(androidContract.coverIds); expect(holoIds).toEqual(androidContract.holoEffects.map((effect) => effect.id));
    androidContract.holoEffects.forEach((effect, index) => {
      const material = holoMaterial(effect.id)!;
      expect(material).toMatchObject({ pattern: effect.pattern, colors: effect.colors });
      if (proceduralHoloIds.includes(effect.id)) expect(material.asset).toBeNull();
      else expect(material).toMatchObject({ index: index < 20 ? index : index - 20, columns: index < 20 ? 5 : 4, rows: index < 20 ? 4 : 3 });
    });
    expect(holoMaterial('none')).toBeNull(); expect(holoMaterial('unknown')).toBeNull();
  });
  it('uses the exact 2.5% Android atlas inset, including element grid coordinates', () => {
    expect(atlasCrop(2000, 2400, 5, 4, 6)).toEqual({ x: 410, y: 610, width: 380, height: 580 });
    expect(atlasCrop(1600, 1800, 4, 3, 10)).toEqual({ x: 810, y: 1210, width: 380, height: 580 });
  });
  it('drives card rotation, material parallax and foil hue only from the same bounded tilt', () => {
    expect(sharedTilt(1, -1)).toEqual({ x: 8, y: 8 });
    expect(sharedTilt(2, -3)).toEqual({ x: 8, y: 8 });
    expect(sharedTilt(1, 1, true)).toEqual({ x: 0, y: 0 });
    const geometry = holoGeometry(630, 880, 1, sharedTilt(1, -1));
    expect(geometry.materialAlpha).toBeCloseTo(.22); expect(geometry.horizontal).toBeCloseTo(100.8); expect(geometry.vertical).toBeCloseTo(70.4);
    expect(geometry.materialX).toBeLessThan(geometry.overscan); expect(geometry.materialY).toBeLessThan(geometry.overscan);
    expect(holoGeometry(630, 880, .5, { x: 0, y: 0 })).toEqual(holoGeometry(630, 880, .5, { x: 0, y: 0 }));
    expect(holoGeometry(630, 880, NaN, { x: NaN, y: Infinity })).toMatchObject({ intensity: 0, horizontal: 0, vertical: 0 });
  });
  it('keeps zero fully transparent and strengthens fine etching instead of the entire card', () => {
    expect(holoGeometry(630, 880, 0, { x: 0, y: 0 })).toMatchObject({ materialAlpha: 0, grooveAlpha: 0, specularAlpha: 0 });
    const normal = holoGeometry(630, 880, .68, { x: 0, y: 0 });
    expect(normal.materialAlpha).toBeLessThan(.13); expect(normal.grooveAlpha).toBeGreaterThan(.5);
    expect(normal.grooveAlpha).toBeGreaterThan(normal.materialAlpha * 4);
    expect(holoGeometry(630, 880, 4, { x: -100, y: 100 })).toEqual(holoGeometry(630, 880, 1, { x: -8, y: 8 }));
  });
  it('moves reflection and hue with both actual card angles, including the neutral pose', () => {
    const geometry = (x: number, y: number) => holoGeometry(630, 880, .68, { x, y });
    expect(geometry(0, 0)).toMatchObject({ reflectionCenterX: .48, hue: 0 });
    expect(geometry(0, 8).reflectionCenterX).toBeGreaterThan(geometry(0, 0).reflectionCenterX);
    expect(geometry(8, 0).reflectionCenterX).toBeLessThan(geometry(0, 0).reflectionCenterX);
    expect(geometry(8, 8).hue).toBeCloseTo(4.1);
  });
});

// Record real drawing instructions, including paths and gradients, without needing a GPU.
class RecordedPath {
  commands: unknown[][];
  constructor(svg?: string) { this.commands = svg ? [['svg', svg]] : []; }
  moveTo(...values: number[]) { this.commands.push(['move', ...values]); }
  lineTo(...values: number[]) { this.commands.push(['line', ...values]); }
  bezierCurveTo(...values: number[]) { this.commands.push(['curve', ...values]); }
  arc(...values: number[]) { this.commands.push(['arc', ...values]); }
  ellipse(...values: number[]) { this.commands.push(['ellipse', ...values]); }
  closePath() { this.commands.push(['close']); }
  addPath(path: RecordedPath) { this.commands.push(...path.commands); }
}
function recordedCanvas() {
  const operations: unknown[][] = [];
  const record = (name: string) => (...args: unknown[]) => operations.push([name, ...args]);
  const ctx = {
    globalAlpha: 1, lineWidth: 1, strokeStyle: '', fillStyle: '', globalCompositeOperation: 'source-over',
    clearRect: record('clear'), save: record('save'), restore: record('restore'),
    translate: record('translate'), rotate: record('rotate'), scale: record('scale'),
    beginPath: record('begin'), arc: record('arc'), rect: record('rect'), clip: record('clip'), fillRect: record('fullCardFill'),
    stroke(path: RecordedPath) { operations.push(['stroke', path.commands, this.globalAlpha, this.lineWidth, this.strokeStyle]); },
    fill(path?: RecordedPath) { operations.push(['fill', path?.commands, this.globalAlpha, this.fillStyle]); },
    drawImage(...args: unknown[]) { operations.push(['atlas', this.globalAlpha, ...args]); },
    fillText: record('text'), strokeText: record('embossedText'),
    createLinearGradient(...coordinates: number[]) {
      const stops: unknown[][] = []; operations.push(['gradient', coordinates, stops]);
      return { addColorStop: (offset: number, color: string) => stops.push([offset, color]) };
    },
    createRadialGradient(...coordinates: number[]) {
      const stops: unknown[][] = []; operations.push(['radialGradient', coordinates, stops]);
      return { addColorStop: (offset: number, color: string) => stops.push([offset, color]) };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, operations };
}
afterEach(() => vi.unstubAllGlobals());
describe('material-specific smooth geometry', () => {
  it('renders every stable effect with distinct geometry and no full-card gradient wash', () => {
    vi.stubGlobal('Path2D', RecordedPath);
    const signatures = new Set<string>();
    for (const effect of holoIds) {
      const { ctx, operations } = recordedCanvas();
      drawSharedHolo(ctx, null, 630, 880, effect, .68, { x: 0, y: 0 }, 'grooves');
      expect(operations.filter((op) => op[0] === 'stroke' || op[0] === 'fill').length, effect).toBeGreaterThan(0);
      expect(operations.some((op) => op[0] === 'fullCardFill'), effect).toBe(false);
      // Geometry itself must differ, even when effects share a pattern or similar palette.
      signatures.add(JSON.stringify(operations.filter((op) => op[0] === 'stroke' || op[0] === 'fill').map((op) => op[1])));
    }
    expect(signatures.size).toBe(holoIds.length);
  });
  it('renders the anniversary without loading any atlas and includes bubbles, embossed 30s and the small seal', () => {
    vi.stubGlobal('Path2D', RecordedPath);
    const { ctx, operations } = recordedCanvas();
    drawSharedHolo(ctx, null, 630, 880, 'anniversary_30', .68, { x: 2, y: -4 }, 'grooves');
    expect(operations.some((op) => op[0] === 'atlas')).toBe(false);
    expect(operations.filter((op) => op[0] === 'text' && op[1] === '30')).toHaveLength(11);
    expect(operations.some((op) => op[0] === 'embossedText' && op[1] === '30')).toBe(true);
    expect(operations.some((op) => op[0] === 'text' && op[1] === 'J A H R E')).toBe(true);
    const first = JSON.stringify(operations), again = recordedCanvas();
    drawSharedHolo(again.ctx, null, 630, 880, 'anniversary_30', .68, { x: 2, y: -4 }, 'grooves');
    expect(JSON.stringify(again.operations)).toBe(first);
  });
  it('does not paint disabled, invalid or unknown effects and keeps atlas light bounded', () => {
    vi.stubGlobal('Path2D', RecordedPath);
    for (const effect of [...holoIds, 'none', 'unknown']) {
      for (const strength of [0, -1, NaN]) {
        const { ctx, operations } = recordedCanvas();
        drawSharedHolo(ctx, null, 630, 880, effect, strength, { x: 8, y: 8 }, 'grooves');
        expect(operations).toEqual([['clear', 0, 0, 630, 880]]);
      }
    }
    const atlas = { width: 2000, height: 2400 } as CanvasImageSource & { width: number; height: number };
    for (const [effect, alpha] of [['classic_holo', .22], ['stardust', .22], ['bubble', .22], ['pixel', .22]] as const) {
      const { ctx, operations } = recordedCanvas();
      drawSharedHolo(ctx, atlas, 630, 880, effect, 1, { x: 8, y: 8 }, 'light');
      expect(operations.find((op) => op[0] === 'atlas')?.[1]).toBeCloseTo(alpha);
      expect(operations.some((op) => op[0] === 'fullCardFill')).toBe(false);
    }
    for (const effect of proceduralHoloIds) {
      const procedural = recordedCanvas();
      drawSharedHolo(procedural.ctx, atlas, 630, 880, effect, 1, { x: 0, y: 0 }, 'light');
      expect(procedural.operations.some((op) => op[0] === 'atlas'), effect).toBe(false);
    }
  });
  it('keeps all new motifs deterministic while their reflection responds to the actual card tilt', () => {
    vi.stubGlobal('Path2D', RecordedPath);
    expect(proceduralHoloIds).toHaveLength(28);
    for (const effect of proceduralHoloIds) {
      const render = (x: number, y: number) => {
        const canvas = recordedCanvas();
        drawSharedHolo(canvas.ctx, null, 630, 880, effect, .68, { x, y }, 'grooves');
        return JSON.stringify(canvas.operations);
      };
      const rest = render(0, 0);
      expect(render(0, 0), effect).toBe(rest);
      expect(render(4, -6), effect).not.toBe(rest);
    }
  });
  it('keeps fire and electric silhouettes separate from companion motifs', () => {
    vi.stubGlobal('Path2D', RecordedPath);
    for (const effect of ['element_fire', 'element_electric', 'element_grass']) {
      const { ctx, operations } = recordedCanvas();
      drawSharedHolo(ctx, null, 630, 880, effect, .68, { x: 0, y: 0 }, 'grooves');
      // 16 Android medium-budget primary motifs, 22 isolated glints, and companions only for grass.
      expect(operations.filter((op) => op[0] === 'scale'), effect).toHaveLength(effect === 'element_grass' ? 54 : 38);
    }
  });
});
