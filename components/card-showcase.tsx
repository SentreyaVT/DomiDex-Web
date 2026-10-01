'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Expand, Minimize, RotateCcw } from 'lucide-react';
import { resolveCardShowcaseEffect, type CardShowcaseEffectInput } from '@/lib/card-showcase-effect';
import { sharedTilt, type Tilt } from '@/lib/shared-binder-visual';
import { SharedBinderMaterial } from './shared-binder-material';
import { CardProfileMaterial } from './card-profile-material';
import { useCardVisualRarity, type CardVisualIdentity } from './use-card-visual-rarity';
import styles from './card-showcase.module.css';

export interface CardShowcaseProps extends CardShowcaseEffectInput, CardVisualIdentity {
  image: string | null;
  name: string;
  /** The parent owns expansion and its existing dialog; this component never opens another dialog. */
  onExpand?: () => void;
  expanded?: boolean;
}

const resting: Tilt = { x: 0, y: 0 };
const motionQuery = '(prefers-reduced-motion: reduce)';

export function CardShowcase({ image, name, finish, rarity, variant, effectOverride, effectId, intensity, sourceCardId, sourceSetId, collectorNumber, onExpand, expanded = false }: CardShowcaseProps) {
  const [tilt, setTilt] = useState<Tilt>(resting);
  const [reduceMotion, setReduceMotion] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(motionQuery).matches);
  const [failedImage, setFailedImage] = useState(false);
  const activePointer = useRef<number | null>(null);
  const surface = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const visualRarity = useCardVisualRarity({ sourceCardId, sourceSetId, collectorNumber, rarity, effectId, effectOverride });
  const effect = resolveCardShowcaseEffect({ finish, rarity: visualRarity, variant, effectOverride, effectId, intensity });
  const visibleImage = Boolean(image) && !failedImage;
  const currentTilt = reduceMotion || !visibleImage ? resting : tilt;
  const isTilted = currentTilt.x !== 0 || currentTilt.y !== 0;

  const reset = useCallback(() => {
    const pointer = activePointer.current;
    activePointer.current = null;
    if (pointer !== null && surface.current?.hasPointerCapture?.(pointer)) surface.current.releasePointerCapture(pointer);
    setTilt(resting);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(motionQuery);
    const update = () => { setReduceMotion(media.matches); reset(); };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [reset]);

  useEffect(() => {
    window.addEventListener('blur', reset);
    return () => window.removeEventListener('blur', reset);
  }, [reset]);

  useEffect(() => { setFailedImage(false); reset(); }, [image, name, reset]);
  useEffect(reset, [effectId, effectOverride, finish, rarity, variant, intensity, expanded, reset]);

  function move(event: PointerEvent<HTMLButtonElement>) {
    if (reduceMotion || !visibleImage) return;
    if (event.pointerType !== 'mouse' && activePointer.current !== event.pointerId) return;
    if (activePointer.current !== null && activePointer.current !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    setTilt(sharedTilt((event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
  }

  function start(event: PointerEvent<HTMLButtonElement>) {
    if (reduceMotion || !visibleImage || event.button !== 0 || event.isPrimary === false || activePointer.current !== null) return;
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    move(event);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { reset(); return; }
    if (reduceMotion || !visibleImage) return;
    setTilt((previous) => ({
      x: Math.max(-8, Math.min(8, previous.x + (event.key === 'ArrowUp' ? 2 : event.key === 'ArrowDown' ? -2 : 0))),
      y: Math.max(-8, Math.min(8, previous.y + (event.key === 'ArrowRight' ? 2 : event.key === 'ArrowLeft' ? -2 : 0))),
    }));
  }

  return <figure className={`${styles.figure} ${expanded ? styles.expanded : ''}`}>
    <button ref={surface} type="button" className={styles.stage} disabled={!visibleImage} onClick={reset}
      aria-label={`${name}: interaktive Kartenansicht`} aria-describedby={hintId}
      onPointerDown={start} onPointerMove={move}
      onPointerUp={(event) => { if (activePointer.current === event.pointerId) reset(); }}
      onPointerCancel={reset} onLostPointerCapture={reset}
      onPointerLeave={() => { if (activePointer.current === null) reset(); }}
      onBlur={reset} onKeyDown={keyDown} data-reduced-motion={reduceMotion}
    >
      <span className={styles.card} data-card-surface data-tilt-x={currentTilt.x} data-tilt-y={currentTilt.y}
        style={{ transform: `perspective(1100px) rotateX(${currentTilt.x}deg) rotateY(${currentTilt.y}deg)` }}>
        {visibleImage ? <>
          <img src={image!} alt={name} draggable={false} referrerPolicy="no-referrer" onError={() => { setFailedImage(true); reset(); }} />
          {effect.profile ? <CardProfileMaterial profile={effect.profile} tilt={currentTilt} /> : effect.id && <SharedBinderMaterial effect={effect.id} intensity={effect.intensity} tilt={currentTilt} />}
        </> : <span className={styles.placeholder}><span>{name}</span><small>Kartenbild nicht verfügbar</small></span>}
      </span>
    </button>
    <figcaption className={styles.caption}>
      <p id={hintId}>{!visibleImage ? 'Die Kartendetails bleiben verfügbar.' : reduceMotion ? 'Ruhige Ansicht · Bewegung ist reduziert.' : 'Zum Kippen bewegen oder ziehen · Pfeiltasten · Pos1 zum Zurücksetzen'}</p>
      {visibleImage && effect.note && <p className={styles.effectNote}>{effect.note}</p>}
      {(visibleImage || onExpand) && <div className={styles.controls}>
        {visibleImage && !reduceMotion && <button type="button" onClick={reset} disabled={!isTilted}><RotateCcw size={14} aria-hidden="true" />Zurücksetzen</button>}
        {onExpand && <button type="button" onClick={onExpand}>{expanded ? <Minimize size={14} aria-hidden="true" /> : <Expand size={14} aria-hidden="true" />}{expanded ? 'Details anzeigen' : 'Großansicht'}</button>}
      </div>}
    </figcaption>
  </figure>;
}
