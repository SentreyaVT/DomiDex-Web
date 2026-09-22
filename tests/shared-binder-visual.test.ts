import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { atlasCrop, coverIds, holoGeometry, holoIds, holoMaterial, sharedTilt } from '@/lib/shared-binder-visual';
import androidContract from './fixtures/android-binder-visual-contract.json';

describe('same Android material and deterministic motion contract', () => {
  it('keeps the original atlas files byte-identical without generating replacement artwork', () => {
    const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    for (const [file, sha256] of Object.entries(androidContract.atlasSha256)) expect(digest(`public/binder-materials/${file}`)).toBe(sha256);
  });
  it('maps every stable ID to the same Android atlas cell, pattern and palette', () => {
    expect(coverIds).toEqual(androidContract.coverIds); expect(holoIds).toEqual(androidContract.holoEffects.map((effect) => effect.id));
    androidContract.holoEffects.forEach((effect, index) => {
      const material = holoMaterial(effect.id)!;
      expect(material).toMatchObject({ index: index < 20 ? index : index - 20, columns: index < 20 ? 5 : 4, rows: index < 20 ? 4 : 3, pattern: effect.pattern, colors: effect.colors });
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
    expect(geometry.materialAlpha).toBe(.58); expect(geometry.horizontal).toBeCloseTo(100.8); expect(geometry.vertical).toBeCloseTo(70.4);
    expect(geometry.materialX).toBeLessThan(geometry.overscan); expect(geometry.materialY).toBeLessThan(geometry.overscan);
    expect(holoGeometry(630, 880, .5, { x: 0, y: 0 })).toEqual(holoGeometry(630, 880, .5, { x: 0, y: 0 }));
    expect(holoGeometry(630, 880, NaN, { x: NaN, y: Infinity })).toMatchObject({ intensity: 0, horizontal: 0, vertical: 0 });
  });
});
