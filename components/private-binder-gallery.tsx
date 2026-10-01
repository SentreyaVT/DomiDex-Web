'use client';

import { useEffect, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { CollectionEntry } from '@/lib/domain';
import { privateBinderPage, subscribePrivateBinderView, type PrivateBinderSnapshot } from '@/lib/private-binder-view';
import { sharedVisualId } from '@/lib/shared-binder';
import { resolveCardShowcaseEffect } from '@/lib/card-showcase-effect';
import { SharedBinderMaterial } from './shared-binder-material';
import { CardProfileMaterial } from './card-profile-material';
import { useCardVisualRarity } from './use-card-visual-rarity';
import { CardShowcase } from './card-showcase';
import { ModalFocus } from './modal-focus';
import styles from './private-binder-gallery.module.css';

type Props = { user: { uid: string }; entries: CollectionEntry[]; prices: Record<string, number | null | undefined> };
const euro = (value: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);

function ThumbnailMaterial({ entry, effectId, intensity }: { entry: CollectionEntry; effectId: string | null; intensity: number }) {
  const rarity = useCardVisualRarity({ ...entry, effectId });
  const effect = resolveCardShowcaseEffect({ finish: entry.finish, rarity, variant: entry.variant, effectOverride: entry.effectOverride, effectId, intensity });
  return effect.profile ? <CardProfileMaterial profile={effect.profile} tilt={{ x: 0, y: 0 }} /> : effect.id ? <SharedBinderMaterial effect={effect.id} intensity={effect.intensity} /> : null;
}

/** Account-keyed child drops all private state immediately when the signed-in owner changes. */
export function PrivateBinderGallery(props: Props) { return <OwnerGallery key={props.user.uid} {...props} />; }
function OwnerGallery({ user, entries, prices }: Props) {
  const [snapshot, setSnapshot] = useState<PrivateBinderSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [binderId, setBinderId] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let active = true, stop = () => {};
    setSnapshot(null); setFailed(false); setSelectedId(null);
    void subscribePrivateBinderView(user.uid, (data) => { if (active) { setSnapshot(data); setFailed(false); } }, () => {
      if (active) { setSnapshot(null); setSelectedId(null); setFailed(true); }
    }).then((unsubscribe) => { if (active) stop = unsubscribe; else unsubscribe(); }).catch(() => {
      if (active) { setSnapshot(null); setSelectedId(null); setFailed(true); }
    });
    return () => { active = false; stop(); };
  }, [user.uid, attempt]);
  const binder = snapshot?.binders.find((item) => item.binderId === binderId) ?? snapshot?.binders[0];
  // Changing/deleting the selected binder cannot carry an old page or modal into another one.
  useEffect(() => { setPage(0); setSelectedId(null); }, [binder?.binderId]);
  const view = binder && snapshot ? privateBinderPage(binder, snapshot.placements, entries, user.uid, page) : null;
  const selected = view?.slots.find((slot) => slot.placement?.placementId === selectedId && slot.entry);
  const price = selected?.entry ? prices[selected.entry.syncId] : undefined;
  return <section className={styles.panel} aria-labelledby="private-gallery-title">
    <header className={styles.heading}><div><p>DEIN PERSÖNLICHER LOOK</p><h2 id="private-gallery-title">Private Binder</h2><span>Deine Anordnung. Deine gespeicherten Holo-Effekte.</span></div><BookOpen aria-hidden="true" /></header>
    {failed ? <div role="status">Private Binder konnten nicht geladen werden. <button onClick={() => setAttempt((value) => value + 1)}>Erneut laden</button></div> : !snapshot ? <p role="status">Private Binder werden geladen …</p> : !binder || !view ? <p>Noch kein privater Binder synchronisiert. Deine in der Android-App synchronisierten Binder erscheinen hier.</p> : <>
      <div className={styles.summary}>
        <div className={styles.cover} aria-label={`Cover: ${binder.name}`}><SharedBinderMaterial cover effect={sharedVisualId(binder.coverStyle, true)} /><img src="/domidex-logo.jpg" alt="" /><strong>{binder.name}</strong></div>
        <div><label>Privaten Binder ansehen<select aria-label="Privaten Binder ansehen" value={binder.binderId} onChange={(event) => { setBinderId(event.target.value); setPage(0); setSelectedId(null); }}>{snapshot.binders.map((item) => <option key={item.binderId} value={item.binderId}>{item.name}</option>)}</select></label><p>Klicke auf eine Karte und bewege sie in der Großansicht. Deine gespeicherte Effektstärke bleibt erhalten.</p><small>Nur ansehen · Keine Änderungen an deinem Binder</small></div>
      </div>
      <div className={styles.grid} role="group" aria-label={`Privater Binder ${binder.name}, Seite ${view.page + 1}`}>
        {view.slots.map((slot) => slot.entry && slot.placement ? <button className={styles.slot} key={slot.position} aria-label={`${slot.entry.name}, Platz ${slot.position + 1}, groß ansehen`} onClick={() => { setSelectedId(slot.placement!.placementId); setExpanded(false); }}>
          <span className={styles.card}>{slot.entry.imageUrl ? <><img src={slot.entry.imageUrl} alt={slot.entry.name} loading="lazy" draggable={false} /><ThumbnailMaterial entry={slot.entry} effectId={slot.placement.holoEffectId} intensity={slot.placement.holoIntensity} /></> : <span>{slot.entry.name}</span>}</span>
          <span className={styles.slotName}>{slot.entry.name}</span><small>#{slot.entry.collectorNumber}</small>
        </button> : <div key={slot.position} className={styles.empty} aria-label={`Platz ${slot.position + 1}: ${slot.unavailable ? 'Kartendaten nicht verfügbar' : 'frei'}`}><span>{slot.position + 1}</span>{slot.unavailable && <small>Kartendaten nicht verfügbar</small>}</div>)}
      </div>
      <nav className={styles.pages} aria-label="Private Binderseiten"><button aria-label="Vorherige private Binderseite" disabled={view.page === 0} onClick={() => setPage(view.page - 1)}><ChevronLeft /></button><span>Seite {view.page + 1} / {view.pageCount}</span><button aria-label="Nächste private Binderseite" disabled={view.page + 1 >= view.pageCount} onClick={() => setPage(view.page + 1)}><ChevronRight /></button></nav>
    </>}
    {selected?.entry && selected.placement && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}>
      <section className={`card-dialog ${expanded ? 'card-dialog--expanded' : ''}`} role="dialog" aria-modal="true" aria-labelledby="private-card-title">
        <ModalFocus onClose={() => setSelectedId(null)} /><button className="dialog-close" onClick={() => setSelectedId(null)} aria-label="Schließen"><X /></button>
        <div className="dialog-card-image"><CardShowcase key={selected.placement.placementId} sourceCardId={selected.entry.sourceCardId} sourceSetId={selected.entry.sourceSetId} collectorNumber={selected.entry.collectorNumber} image={selected.entry.imageUrl} name={selected.entry.name} finish={selected.entry.finish} rarity={selected.entry.rarity} variant={selected.entry.variant} effectOverride={selected.entry.effectOverride} effectId={selected.placement.holoEffectId} intensity={selected.placement.holoIntensity} expanded={expanded} onExpand={() => setExpanded((value) => !value)} /></div>
        <div className="dialog-card-info"><p>{binder?.name} · PRIVATER BINDER</p><h2 id="private-card-title">{selected.entry.name}</h2><span>{selected.entry.setName} · #{selected.entry.collectorNumber}</span><dl><div><dt>Variante</dt><dd>{selected.entry.finish} · {selected.entry.variant}</dd></div><div><dt>Platz</dt><dd>{selected.position + 1}</dd></div><div><dt>Cardmarket Trend</dt><dd>{typeof price === 'number' ? euro(price) : 'Preis derzeit nicht verfügbar'}</dd></div></dl><p>Nur Ansicht · Gespeicherte Karte und Effekt bleiben unverändert.</p></div>
      </section>
    </div>}
  </section>;
}
