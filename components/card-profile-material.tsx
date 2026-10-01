'use client';

import { useEffect, useRef, useState } from 'react';
import { drawCardProfile, type CardEffectConfig } from '@/lib/card-profile-visual';
import type { Tilt } from '@/lib/shared-binder-visual';
import styles from './card-profile-material.module.css';

/** Uses the card's exact tilt, including the parent's resting/reduced-motion value. */
export function CardProfileMaterial({ profile, tilt }: { profile: CardEffectConfig; tilt: Tilt }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [revision, setRevision] = useState(0);
  const { x, y } = tilt;
  const visible = profile.profile !== 'NONE' && profile.intensity > 0;

  useEffect(() => {
    const surface = canvas.current;
    if (!surface || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setRevision((previous) => previous + 1));
    observer.observe(surface);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const context = surface.getContext('2d');
    const width = surface.clientWidth, height = surface.clientHeight;
    if (!context || !width || !height) return;
    // Layout dimensions stay stable when the containing card rotates in 3D.
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    surface.width = Math.round(width * ratio);
    surface.height = Math.round(height * ratio);
    context.scale(ratio, ratio);
    drawCardProfile(context, width, height, profile, { x, y });
  }, [profile, x, y, revision]);

  if (!visible) return null;
  return <canvas ref={canvas} className={styles.material} aria-hidden="true" data-profile-id={profile.profile} />;
}
