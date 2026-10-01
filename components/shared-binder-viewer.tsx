'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SharedBinder, SharedCard } from '@/lib/shared-binder';
import { sharedTilt } from '@/lib/shared-binder-visual';
import { SharedBinderMaterial } from './shared-binder-material';
import styles from './shared-binder-viewer.module.css';

const euro = (amount: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
type SharedCardSelection = Pick<SharedCard, 'slot' | 'cardId' | 'finish' | 'collectorNumber'>;

export function SharedBinderViewer({ token }: { token: string }) {
  const [page, setPage] = useState(0);
  const [binder, setBinder] = useState<SharedBinder | null>(null);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<SharedCardSelection | null>(null);
  // Keep only identity in UI state: prices and artwork always come from the latest permitted DTO.
  const selected = selection && binder?.cards.find((card) => card.slot === selection.slot && card.cardId === selection.cardId
    && card.finish === selection.finish && card.collectorNumber === selection.collectorNumber) || null;
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const dialog = useRef<HTMLDialogElement>(null);
  const requestVersion = useRef(0);
  useEffect(() => {
    if (selection && !selected) { setSelection(null); setTilt({ x: 0, y: 0 }); dialog.current?.close(); }
  }, [selection, selected]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reset = () => { if (media.matches) setTilt({ x: 0, y: 0 }); };
    media.addEventListener('change', reset); return () => media.removeEventListener('change', reset);
  }, []);
  const refresh = useCallback(async (signal: AbortSignal) => {
    const version = ++requestVersion.current;
    try {
      const response = await fetch(`/api/shared-binders/${encodeURIComponent(token)}?page=${page}`, { cache: 'no-store', signal, referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(response.status === 404 ? 'Diese Freigabe ist nicht verfügbar oder wurde beendet.' : 'Der Binder konnte nicht geladen werden. Bitte erneut versuchen.');
      const data = await response.json() as SharedBinder;
      if (version === requestVersion.current && !signal.aborted) { setBinder(data); setError(''); }
    } catch (failure) {
      if (version !== requestVersion.current || signal.aborted) return;
      setBinder(null); setSelection(null); dialog.current?.close();
      setError(failure instanceof Error ? failure.message : 'Freigabe nicht verfügbar.');
    }
  }, [page, token]);
  useEffect(() => {
    const controller = new AbortController();
    setBinder(null); setSelection(null); dialog.current?.close(); setError('');
    void refresh(controller.signal);
    // Revocation is enforced on every API request; an open view is also cleared promptly.
    const timer = setInterval(() => { if (!document.hidden) void refresh(controller.signal); }, 15000);
    const visible = () => { if (!document.hidden) void refresh(controller.signal); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const open = ({ slot, cardId, finish, collectorNumber }: SharedCard) => { setSelection({ slot, cardId, finish, collectorNumber }); setTilt({ x: 0, y: 0 }); dialog.current?.showModal(); };
  return <main className={styles.shell}>
    <a href="/" className={styles.brand}>DomiDex</a><p>Geteilter Binder · Nur ansehen</p>
    {error ? <section role="alert"><h1>Freigabe nicht verfügbar</h1><p>{error}</p><button onClick={() => void refresh(new AbortController().signal)}>Erneut versuchen</button></section> : !binder ? <p role="status">Binder wird geladen …</p> : <>
      <header><div className={styles.cover} aria-label={`Binder-Cover ${binder.coverStyle}`}><SharedBinderMaterial cover effect={binder.coverStyle} /><img src="/domidex-logo.jpg" alt="" /><strong>{binder.title}</strong></div><h1>{binder.title}</h1>{binder.displayName && <p>Geteilt von {binder.displayName}</p>}
        {binder.total && <p>Binderwert: {binder.total.complete && binder.total.amount !== null ? euro(binder.total.amount) : 'Nicht vollständig verfügbar'}</p>}
      </header>
      <div className={styles.grid} aria-label={`Binderseite ${page + 1}`}>
        {Array.from({ length: 9 }, (_, index) => {
          const slot = page * 9 + index; const card = binder.cards.find((item) => item.slot === slot);
          return card ? <button className={styles.slot} key={slot} onClick={() => open(card)} aria-label={`${card.name}, Nummer ${card.collectorNumber}, groß ansehen`}>
            {card.image ? <span className={styles.cardSurface}><img src={card.image} alt={card.name} loading="lazy" referrerPolicy="no-referrer" /><SharedBinderMaterial effect={card.holoEffectId} intensity={card.holoIntensity} /></span> : <span>{card.name}</span>}
            {card.price && <span>{card.price.amount === null ? 'Preis nicht verfügbar' : euro(card.price.amount)}</span>}
          </button> : binder.unavailableSlots.includes(slot) ? <div className={styles.empty} key={slot}>Kartendaten gerade nicht verfügbar</div> : <div className={styles.empty} key={slot} aria-label={`Freier Platz ${index + 1}`} />;
        })}
      </div>
      <nav aria-label="Binderseiten"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Zurück</button><span>Seite {page + 1} / {binder.pageCount}</span><button disabled={page + 1 >= binder.pageCount} onClick={() => setPage(page + 1)}>Weiter</button></nav>
    </>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="shared-card-title" onClose={() => { setSelection(null); setTilt({ x: 0, y: 0 }); }}>
      <button className={styles.close} onClick={() => dialog.current?.close()} aria-label="Großansicht schließen">Schließen</button>
      {selected && <><h2 id="shared-card-title">{selected.name}</h2>
        <div className={styles.showcase} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setTilt(sharedTilt((event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1, window.matchMedia('(prefers-reduced-motion: reduce)').matches));
        }} onPointerUp={() => setTilt({ x: 0, y: 0 })} onPointerCancel={() => setTilt({ x: 0, y: 0 })} onPointerLeave={() => setTilt({ x: 0, y: 0 })}>
          {selected.image && <div className={styles.cardSurface} style={{ transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}><img src={selected.image} alt={selected.name} referrerPolicy="no-referrer" /><SharedBinderMaterial effect={selected.holoEffectId} intensity={selected.holoIntensity} tilt={tilt} /></div>}
        </div><p>{selected.setName} · {selected.collectorNumber} · {selected.finish}</p>
        {selected.price && <p>{selected.price.basis === 'selection' ? 'Gewählte Cardmarket-Kennzahl' : 'Cardmarket'}: {selected.price.amount === null ? 'Preis nicht verfügbar' : euro(selected.price.amount)}</p>}
      </>}
    </dialog>
  </main>;
}
