'use client';

import { useEffect, useRef, useState } from 'react';
import { drawSharedCover, drawSharedHolo, holoMaterial, type Tilt } from '@/lib/shared-binder-visual';
import styles from './shared-binder-viewer.module.css';

const images = new Map<string, Promise<HTMLImageElement>>();
function atlasImage(path: string) {
  const cached = images.get(path); if (cached) return cached;
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => { images.delete(path); reject(new Error('MATERIAL_UNAVAILABLE')); }; image.src = path;
  });
  images.set(path, loaded); return loaded;
}
export function SharedBinderMaterial({ effect, intensity = 0, tilt = { x: 0, y: 0 }, cover = false }: { effect: string; intensity?: number; tilt?: Tilt; cover?: boolean }) {
  const { x, y } = tilt;
  const light = useRef<HTMLCanvasElement>(null), grooves = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<{ path: string; image: HTMLImageElement } | null>(null);
  const [revision, setRevision] = useState(0);
  const material = holoMaterial(effect), path = cover ? '/binder-materials/private_binder_cover_atlas.png' : material?.asset;
  const asset = loaded && loaded.path === path ? loaded.image : null;
  const visible = cover || Boolean(material && Number.isFinite(intensity) && intensity > 0);
  useEffect(() => {
    let active = true;
    if (path) void atlasImage(path).then((image) => { if (active) setLoaded({ path, image }); }).catch(() => undefined);
    return () => { active = false; };
  }, [path]);
  useEffect(() => {
    if (!light.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setRevision((value) => value + 1)); observer.observe(light.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (cover && !asset) return;
    for (const [canvas, layer] of [[light.current, 'light'], [grooves.current, 'grooves']] as const) {
      if (!canvas) continue;
      const ctx = canvas.getContext('2d'); if (!ctx) continue;
      // Layout dimensions must not include the parent's 3D projection; otherwise tilt resizes its own texture.
      const width = canvas.clientWidth, height = canvas.clientHeight; if (!width || !height) continue;
      const ratio = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); ctx.scale(ratio, ratio);
      if (cover && asset) drawSharedCover(ctx, asset, width, height, effect);
      else drawSharedHolo(ctx, asset, width, height, effect, intensity, { x, y }, layer);
    }
  }, [asset, effect, intensity, x, y, cover, revision]);
  if (!visible) return null;
  return <><canvas ref={light} aria-hidden="true" data-material-id={effect} className={cover ? styles.coverMaterial : styles.foilLight} />{!cover && <canvas ref={grooves} aria-hidden="true" className={styles.foilGrooves} />}</>;
}
