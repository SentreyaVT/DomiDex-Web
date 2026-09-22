'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SharedBinder, SharedCard } from '@/lib/shared-binder';
import styles from './shared-binder-viewer.module.css';

const euro = (amount: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);

export function SharedBinderViewer({ token }: { token: string }) {
  const [page, setPage] = useState(0);
  const [binder, setBinder] = useState<SharedBinder | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SharedCard | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const dialog = useRef<HTMLDialogElement>(null);
  const requestVersion = useRef(0);
  const refresh = useCallback(async (signal: AbortSignal) => {
    const version = ++requestVersion.current;
    try {
      const response = await fetch(`/api/shared-binders/${encodeURIComponent(token)}?page=${page}`, { cache: 'no-store', signal, referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(response.status === 404 ? 'Diese Freigabe ist nicht verfügbar oder wurde beendet.' : 'Der Binder konnte nicht geladen werden. Bitte erneut versuchen.');
      const data = await response.json() as SharedBinder;
      if (version === requestVersion.current && !signal.aborted) { setBinder(data); setError(''); }
    } catch (failure) {
      if (version !== requestVersion.current || signal.aborted) return;
      setBinder(null); setSelected(null); dialog.current?.close();
      setError(failure instanceof Error ? failure.message : 'Freigabe nicht verfügbar.');
    }
  }, [page, token]);
  useEffect(() => {
    const controller = new AbortController();
    setBinder(null); setError('');
    void refresh(controller.signal);
    // Revocation is enforced on every API request; an open view is also cleared promptly.
    const timer = setInterval(() => { if (!document.hidden) void refresh(controller.signal); }, 15000);
    const visible = () => { if (!document.hidden) void refresh(controller.signal); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const open = (card: SharedCard) => { setSelected(card); setTilt({ x: 0, y: 0 }); dialog.current?.showModal(); };
  return <main className={styles.shell}>
    <a href="/" className={styles.brand}>DomiDex</a><p>Geteilter Binder · Nur ansehen</p>
    {error ? <section role="alert"><h1>Freigabe nicht verfügbar</h1><p>{error}</p><button onClick={() => void refresh(new AbortController().signal)}>Erneut versuchen</button></section> : !binder ? <p role="status">Binder wird geladen …</p> : <>
      <header><h1>{binder.title}</h1>{binder.displayName && <p>Geteilt von {binder.displayName}</p>}
        {binder.total && <p>Binderwert: {binder.total.complete && binder.total.amount !== null ? euro(binder.total.amount) : 'Nicht vollständig verfügbar'}</p>}
      </header>
      <div className={styles.grid} aria-label={`Binderseite ${page + 1}`}>
        {Array.from({ length: 9 }, (_, index) => {
          const slot = page * 9 + index; const card = binder.cards.find((item) => item.slot === slot);
          return card ? <button className={styles.slot} key={slot} onClick={() => open(card)} aria-label={`${card.name}, Nummer ${card.collectorNumber}, groß ansehen`}>
            {card.image ? <img src={card.image} alt={card.name} loading="lazy" referrerPolicy="no-referrer" /> : <span>{card.name}</span>}
            {card.price && <span>{card.price.amount === null ? 'Preis nicht verfügbar' : euro(card.price.amount)}</span>}
          </button> : binder.unavailableSlots.includes(slot) ? <div className={styles.empty} key={slot}>Kartendaten gerade nicht verfügbar</div> : <div className={styles.empty} key={slot} aria-label={`Freier Platz ${index + 1}`} />;
        })}
      </div>
      <nav aria-label="Binderseiten"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Zurück</button><span>Seite {page + 1} / {binder.pageCount}</span><button disabled={page + 1 >= binder.pageCount} onClick={() => setPage(page + 1)}>Weiter</button></nav>
    </>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="shared-card-title" onClose={() => { setSelected(null); setTilt({ x: 0, y: 0 }); }}>
      <button className={styles.close} onClick={() => dialog.current?.close()} aria-label="Großansicht schließen">Schließen</button>
      {selected && <><h2 id="shared-card-title">{selected.name}</h2>
        <div className={styles.showcase} onPointerMove={(event) => {
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          setTilt({ x: -((event.clientY - bounds.top) / bounds.height - .5) * 16, y: ((event.clientX - bounds.left) / bounds.width - .5) * 16 });
        }} onPointerLeave={() => setTilt({ x: 0, y: 0 })}>
          {selected.image && <img src={selected.image} alt={selected.name} referrerPolicy="no-referrer" style={{ transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }} />}
        </div><p>{selected.setName} · {selected.collectorNumber} · {selected.finish}</p>
        {selected.price && <p>Cardmarket: {selected.price.amount === null ? 'Preis nicht verfügbar' : euro(selected.price.amount)}</p>}
      </>}
    </dialog>
  </main>;
}
