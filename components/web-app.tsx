'use client';

import {
  BadgeEuro, BookOpen, ChevronLeft, ChevronRight, CircleUserRound, CloudOff, FolderSearch,
  LayoutDashboard, LibraryBig, LoaderCircle, LogOut, Minus, Plus, Search, Settings, ShieldCheck,
  Sparkles, Trash2, X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth-provider';
import { addExactCard, changeQuantity, subscribeCollection } from '@/lib/collection';
import { exactTrendPrice, type CollectionEntry, type TcgCardDetail, type TcgCardSummary } from '@/lib/domain';
import { buildBinderSlots, type BinderSlot } from '@/lib/binder';
import { imageUrl, loadCard, loadSet, searchCards } from '@/lib/tcgdex';

type View = 'overview' | 'binder' | 'collection' | 'search' | 'portfolio' | 'settings';

const navigation: Array<[View, string, typeof LayoutDashboard]> = [
  ['overview', 'Übersicht', LayoutDashboard], ['binder', 'Binder', BookOpen], ['collection', 'Sammlung', LibraryBig],
  ['search', 'Karte hinzufügen', Search], ['portfolio', 'Portfolio', BadgeEuro], ['settings', 'Einstellungen', Settings],
];

export function WebApp() {
  const { user, loading: authLoading, isAdmin, logout } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<View>('overview');
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [prices, setPrices] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    return subscribeCollection(user, (next) => { setEntries(next); setLoading(false); setOffline(false); }, () => { setLoading(false); setOffline(true); });
  }, [user]);

  useEffect(() => {
    let active = true;
    const unresolved = entries.filter((entry) => entry.sourceCardId && !(entry.syncId in prices));
    void (async () => {
      for (let index = 0; index < unresolved.length; index += 4) {
        const chunk = unresolved.slice(index, index + 4);
        const resolved = await Promise.all(chunk.map(async (entry) => {
          try {
            const card = await loadCard(entry.sourceCardId!);
            const variant = bestVariant(card, entry.finish, entry.variant);
            return [entry.syncId, variant ? exactTrendPrice(card, variant) : null] as const;
          } catch { return [entry.syncId, null] as const; }
        }));
        if (!active) return;
        setPrices((current) => ({ ...current, ...Object.fromEntries(resolved) }));
      }
    })();
    return () => { active = false; };
  }, [entries, prices]);

  const portfolio = useMemo(() => entries.reduce((sum, entry) => {
    const price = prices[entry.syncId];
    return sum + (typeof price === 'number' ? price * entry.quantity : 0);
  }, 0), [entries, prices]);
  const pricedCount = entries.filter((entry) => typeof prices[entry.syncId] === 'number').reduce((sum, entry) => sum + entry.quantity, 0);
  const totalCount = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const binders = useMemo(() => groupBinders(entries), [entries]);

  if (authLoading || !user) return <AppLoading />;

  return (
    <main className="desktop-app">
      <aside className="desktop-sidebar">
        <a className="brand" href="/"><img src="/domidex-logo.jpg" alt="" /><span>Domi<span>Dex</span></span></a>
        <nav aria-label="Web-App Navigation">
          {navigation.map(([key, label, Icon]) => <button className={view === key ? 'active' : ''} onClick={() => setView(key)} key={key}><Icon />{label}</button>)}
          {isAdmin && <a href="/admin"><ShieldCheck />Administration</a>}
        </nav>
        <div className="sidebar-account"><CircleUserRound /><div><strong>{user.displayName ?? 'DomiDex Nutzer'}</strong><small>{user.email}</small></div></div>
      </aside>
      <section className="desktop-content">
        <header className="app-topbar">
          <div><span>DomiDex Web</span><b>{navigation.find(([key]) => key === view)?.[1]}</b></div>
          <div className="sync-pill">{offline ? <><CloudOff /> Offline · lokaler Cache</> : <><span /> Live mit Android synchronisiert</>}</div>
        </header>
        {error && <div className="app-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fehler schließen"><X /></button></div>}
        {loading ? <AppLoading compact /> : (
          <>
            {view === 'overview' && <Overview entries={entries} prices={prices} total={portfolio} binders={binders} onNavigate={setView} />}
            {view === 'binder' && <BinderView binders={binders} prices={prices} user={user} onError={setError} />}
            {view === 'collection' && <CollectionView entries={entries} prices={prices} user={user} onError={setError} />}
            {view === 'search' && <SearchView entries={entries} user={user} onError={setError} />}
            {view === 'portfolio' && <Portfolio entries={entries} prices={prices} total={portfolio} pricedCount={pricedCount} totalCount={totalCount} />}
            {view === 'settings' && <SettingsView userName={user.displayName ?? user.email ?? 'DomiDex Nutzer'} onLogout={() => void logout()} />}
          </>
        )}
      </section>
    </main>
  );
}

function Overview({ entries, prices, total, binders, onNavigate }: { entries: CollectionEntry[]; prices: Record<string, number | null>; total: number; binders: BinderGroup[]; onNavigate: (view: View) => void }) {
  const count = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const top = [...entries].filter((entry) => typeof prices[entry.syncId] === 'number').sort((a, b) => (prices[b.syncId]! * b.quantity) - (prices[a.syncId]! * a.quantity)).slice(0, 4);
  return <div className="app-view">
    <div className="view-title"><div><p>DEINE SAMMLUNG</p><h1>Willkommen zurück.</h1><span>Echte Daten aus deinem gemeinsamen DomiDex-Konto.</span></div><button onClick={() => onNavigate('search')}><Plus /> Karte hinzufügen</button></div>
    <div className="metric-grid">
      <Metric title="Gesamtwert" value={formatPrice(total)} detail="Cardmarket-Trend, soweit eindeutig" accent="violet" />
      <Metric title="Karten" value={String(count)} detail={`${entries.length} eindeutige Varianten`} accent="cyan" />
      <Metric title="Sets" value={String(binders.length)} detail="mit gesammelten Karten" accent="green" />
      <Metric title="Synchronisation" value="Live" detail="Android ↔ Web" accent="gold" />
    </div>
    <div className="dashboard-grid">
      <section className="panel"><PanelTitle title="Letzte Karten" action="Sammlung öffnen" onAction={() => onNavigate('collection')} />{entries.length ? <div className="recent-grid">{entries.slice(0, 6).map((entry) => <CardTile entry={entry} price={prices[entry.syncId]} key={entry.syncId} />)}</div> : <Empty title="Noch keine Karten" text="Füge deine erste Karte in der Android-App oder hier über die Suche hinzu." />}</section>
      <section className="panel"><PanelTitle title="Wertvollste Karten" />{top.length ? <div className="value-list">{top.map((entry, index) => <div key={entry.syncId}><span>{index + 1}</span><img src={entry.imageUrl ?? '/domidex-logo.jpg'} alt="" /><div><b>{entry.name}</b><small>{entry.setName} · {entry.finish}</small></div><strong>{formatPrice(prices[entry.syncId]! * entry.quantity)}</strong></div>)}</div> : <Empty title="Noch keine bepreisten Karten" text="Nur eindeutig zugeordnete Trendpreise werden berücksichtigt." />}</section>
    </div>
  </div>;
}

function BinderView({ binders, prices, user, onError }: { binders: BinderGroup[]; prices: Record<string, number | null>; user: NonNullable<ReturnType<typeof useAuth>['user']>; onError: (value: string) => void }) {
  const [binderIndex, setBinderIndex] = useState(0); const [page, setPage] = useState(0); const [open, setOpen] = useState(false); const [selected, setSelected] = useState<BinderSlot | null>(null); const [busy, setBusy] = useState(false); const [setCards, setSetCards] = useState<TcgCardSummary[]>([]); const [setLoading, setSetLoading] = useState(false);
  const binder = binders[Math.min(binderIndex, Math.max(0, binders.length - 1))];
  useEffect(() => { setPage(0); setOpen(false); setSelected(null); }, [binderIndex]);
  useEffect(() => {
    let active = true; setSetCards([]); setSetLoading(false); if (!binder?.sourceSetId) return;
    setSetLoading(true); void loadSet(binder.sourceSetId).then((set) => { if (active) setSetCards(set.cards ?? []); }).catch(() => { if (active) onError('Das vollständige Set konnte nicht geladen werden. Der vorhandene Bestand bleibt sichtbar.'); }).finally(() => { if (active) setSetLoading(false); });
    return () => { active = false; };
  }, [binder?.sourceSetId, onError]);
  if (!binder) return <div className="app-view"><div className="view-title"><div><p>BINDER</p><h1>Deine Binder.</h1></div></div><Empty title="Noch kein Binder" text="Sobald eine Karte hinzugefügt wird, erscheint ihr Set-Binder automatisch hier." /></div>;
  const summaries = setCards.length ? setCards : binder.entries.map((entry) => ({ id: entry.sourceCardId ?? entry.syncId, localId: entry.collectorNumber, name: entry.name, image: entry.imageUrl ?? undefined }));
  const slots = buildBinderSlots(summaries, binder.entries); const pages = chunk(slots, 8); const visible = pages[page] ?? [];
  return <div className="app-view binder-view">
    <div className="view-title"><div><p>MASTER-SET BINDER</p><h1>{binder.name}</h1><span>{binder.entries.reduce((sum, entry) => sum + entry.quantity, 0)} Karten · {slots.filter((slot) => slot.owned.length).length}/{slots.length || binder.entries.length} Plätze · {formatPrice(binder.entries.reduce((sum, entry) => sum + ((prices[entry.syncId] ?? 0) * entry.quantity), 0))}</span></div><select value={binderIndex} onChange={(event) => setBinderIndex(Number(event.target.value))}>{binders.map((item, index) => <option value={index} key={item.id}>{item.name}</option>)}</select></div>
    <section className={`interactive-binder ${open ? 'is-open' : ''}`}>
      {!open ? <button className="binder-cover" onClick={() => setOpen(true)}><img src="/domidex-logo.jpg" alt="" /><small>DOMIDEX BINDER</small><strong>{binder.name}</strong><span>Öffnen</span></button> : <>
        {setLoading ? <div className="binder-set-loading"><LoaderCircle className="spin" /><span>Alle Set-Karten werden geladen …</span></div> : <div className="binder-book"><div className="pocket-page">{[0,1,2,3].map((slot) => <BinderPocket slot={visible[slot]} onSelect={setSelected} key={slot} />)}</div><div className="binder-spine"><i/><i/><i/><i/></div><div className="pocket-page">{[4,5,6,7].map((slot) => <BinderPocket slot={visible[slot]} onSelect={setSelected} key={slot} />)}</div></div>}
        <div className="page-controls"><button disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft /></button><span>Seite {page + 1} / {Math.max(1, pages.length)}</span><button disabled={page >= pages.length - 1} onClick={() => setPage((value) => value + 1)}><ChevronRight /></button><button className="close-binder" onClick={() => setOpen(false)}>Binder schließen</button></div>
      </>}
    </section>
    {selected && <BinderCardDialog slot={selected} entries={binder.entries} prices={prices} user={user} busy={busy} setBusy={setBusy} onClose={() => setSelected(null)} onError={onError} />}
  </div>;
}

function CollectionView({ entries, prices, user, onError }: { entries: CollectionEntry[]; prices: Record<string, number | null>; user: NonNullable<ReturnType<typeof useAuth>['user']>; onError: (value: string) => void }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState<CollectionEntry | null>(null); const [busy, setBusy] = useState(false);
  const filtered = entries.filter((entry) => `${entry.name} ${entry.setName} ${entry.collectorNumber}`.toLowerCase().includes(query.toLowerCase()));
  const mutate = async (entry: CollectionEntry, delta: number) => { setBusy(true); try { await changeQuantity(user, entry, delta); if (delta < 0 && entry.quantity === 1) setSelected(null); } catch { onError('Die Kartenmenge konnte nicht aktualisiert werden.'); } finally { setBusy(false); } };
  return <div className="app-view"><div className="view-title"><div><p>SAMMLUNG</p><h1>Alle Karten.</h1><span>{entries.reduce((sum, entry) => sum + entry.quantity, 0)} Karten in {new Set(entries.map((entry) => entry.setName)).size} Sets</span></div><label className="search-field"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sammlung durchsuchen" /></label></div>{filtered.length ? <div className="collection-grid">{filtered.map((entry) => <button onClick={() => setSelected(entry)} key={entry.syncId}><CardTile entry={entry} price={prices[entry.syncId]} /><span className="quantity-badge">×{entry.quantity}</span></button>)}</div> : <Empty title="Keine Karten gefunden" text="Passe deine Suche an oder füge eine neue Karte hinzu." />}{selected && <CardDialog entry={selected} price={prices[selected.syncId]} busy={busy} onClose={() => setSelected(null)} onChange={mutate} />}</div>;
}

function SearchView({ entries, user, onError }: { entries: CollectionEntry[]; user: NonNullable<ReturnType<typeof useAuth>['user']>; onError: (value: string) => void }) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<TcgCardSummary[]>([]); const [card, setCard] = useState<TcgCardDetail | null>(null); const [variantIndex, setVariantIndex] = useState(0); const [quantity, setQuantity] = useState(1); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const variants = card?.variants_detailed?.length ? card.variants_detailed : card ? [{ type: 'Normal', size: 'Standard', pricing: card.pricing }] : [];
  const variant = variants[variantIndex] ?? variants[0]; const price = card && variant ? exactTrendPrice(card, variant) : null;
  const search = async () => { setBusy(true); setMessage(''); try { setResults(await searchCards(query)); setCard(null); } catch (error) { onError(error instanceof Error ? error.message : 'Kartensuche fehlgeschlagen.'); } finally { setBusy(false); } };
  const choose = async (summary: TcgCardSummary) => { setBusy(true); setMessage(''); try { setCard(await loadCard(summary.id)); setVariantIndex(0); } catch (error) { onError(error instanceof Error ? error.message : 'Kartendetails fehlen.'); } finally { setBusy(false); } };
  const add = async () => { if (!card || !variant) return; setBusy(true); setMessage(''); try { await addExactCard(user, card, variant, quantity, entries); setMessage(`${card.name} wurde synchronisiert.`); } catch (error) { onError(error instanceof Error ? error.message : 'Karte konnte nicht hinzugefügt werden.'); } finally { setBusy(false); } };
  return <div className="app-view"><div className="view-title"><div><p>MANUELL HINZUFÜGEN</p><h1>Karte suchen.</h1><span>Set, Karte, Variante und Menge – der Scanner bleibt in der Android-App.</span></div></div><div className="search-layout"><section className="panel search-panel"><form onSubmit={(event) => { event.preventDefault(); void search(); }}><label className="search-field large"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kartenname, z. B. Glurak" /><button disabled={busy || query.trim().length < 2}>{busy ? <LoaderCircle className="spin" /> : 'Suchen'}</button></label></form><div className="search-results">{results.map((result) => <button className={card?.id === result.id ? 'active' : ''} onClick={() => void choose(result)} key={result.id}><div className="mini-card">{result.image ? <img src={imageUrl(result.image, 'low') ?? ''} alt="" /> : <FolderSearch />}</div><div><b>{result.name}</b><small>#{result.localId} · {result.id}</small></div><ChevronRight /></button>)}</div>{!results.length && !busy && <Empty title="Suche im deutschen Kartenkatalog" text="Es werden nur echte TCGdex-Kartenidentitäten verwendet." />}</section><section className="panel card-add-panel">{card && variant ? <><div className="selected-card"><div className="selected-card-image">{card.image ? <img src={imageUrl(card.image) ?? ''} alt={card.name} /> : <img src="/domidex-logo.jpg" alt="" />}</div><div><p>{card.set.name}</p><h2>{card.name}</h2><span>#{card.localId} · {card.rarity ?? 'Seltenheit unbekannt'}</span></div></div><label>Variante<select value={variantIndex} onChange={(event) => setVariantIndex(Number(event.target.value))}>{variants.map((item, index) => <option value={index} key={`${item.variantId ?? item.type}-${index}`}>{item.type}{item.foil ? ` · ${item.foil}` : ''}{item.stamp?.length ? ` · ${item.stamp.join(', ')}` : ''}</option>)}</select></label><div className="add-price"><span>Cardmarket Trendpreis</span><strong>{price === null ? 'Preis nicht verfügbar' : formatPrice(price)}</strong><small>{price === null ? 'Keine eindeutige Preiszuordnung für diese Variante.' : `Exakte Quelle · Produkt ${variant.pricing?.cardmarket?.idProduct ?? card.pricing?.cardmarket?.idProduct}`}</small></div><label>Menge<div className="stepper"><button onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus /></button><output>{quantity}</output><button onClick={() => setQuantity((value) => Math.min(100, value + 1))}><Plus /></button></div></label><button className="add-card-button" disabled={busy} onClick={() => void add()}>{busy ? <LoaderCircle className="spin" /> : <Plus />} Zur Sammlung hinzufügen</button>{message && <p className="success-message">✓ {message}</p>}</> : <Empty title="Wähle eine Karte" text="Danach erscheinen die tatsächlich gemeldeten Varianten und der passende Cardmarket-Trendpreis." />}</section></div></div>;
}

function Portfolio({ entries, prices, total, pricedCount, totalCount }: { entries: CollectionEntry[]; prices: Record<string, number | null>; total: number; pricedCount: number; totalCount: number }) {
  const groups = Object.entries(entries.reduce<Record<string, { value: number; cards: number }>>((result, entry) => { const current = result[entry.setName] ?? { value: 0, cards: 0 }; current.cards += entry.quantity; current.value += (prices[entry.syncId] ?? 0) * entry.quantity; result[entry.setName] = current; return result; }, {})).sort((a,b) => b[1].value-a[1].value);
  return <div className="app-view"><div className="view-title"><div><p>PORTFOLIO</p><h1>{formatPrice(total)}</h1><span>Nur aktuelle, eindeutig zugeordnete Cardmarket-Trendpreise.</span></div></div><div className="portfolio-layout"><section className="panel portfolio-total"><span>BEWERTETER BESTAND</span><strong>{pricedCount} / {totalCount}</strong><div className="price-ring" style={{ '--progress': `${totalCount ? pricedCount/totalCount*360 : 0}deg` } as React.CSSProperties}><b>{totalCount ? Math.round(pricedCount/totalCount*100) : 0}%</b></div><p>Unbepreiste Karten werden transparent ausgeschlossen – niemals mit erfundenen 0 € verrechnet.</p></section><section className="panel"><PanelTitle title="Wert nach Set" />{groups.length ? <div className="set-values">{groups.map(([name, group]) => <div key={name}><div><b>{name}</b><small>{group.cards} Karten</small></div><strong>{formatPrice(group.value)}</strong><span><i style={{ width: `${total ? Math.max(2,group.value/total*100) : 2}%` }} /></span></div>)}</div> : <Empty title="Noch keine Portfoliodaten" text="Füge Karten hinzu, um den echten Set-Wert zu sehen." />}</section></div></div>;
}

function SettingsView({ userName, onLogout }: { userName: string; onLogout: () => void }) { return <div className="app-view"><div className="view-title"><div><p>EINSTELLUNGEN</p><h1>Dein DomiDex.</h1></div></div><section className="panel settings-list"><div><CircleUserRound /><span><b>{userName}</b><small>Firebase-/Google-Konto</small></span><ShieldCheck /></div><div><Sparkles /><span><b>Design</b><small>Dunkel · DomiDex Violet</small></span></div><div><BadgeEuro /><span><b>Preise</b><small>Cardmarket Trend · keine Ersatzwerte</small></span></div><button onClick={onLogout}><LogOut /> Abmelden</button></section></div>; }

function BinderCardDialog({ slot, entries, prices, user, busy, setBusy, onClose, onError }: { slot: BinderSlot; entries: CollectionEntry[]; prices: Record<string, number | null>; user: NonNullable<ReturnType<typeof useAuth>['user']>; busy: boolean; setBusy: (value: boolean) => void; onClose: () => void; onError: (value: string) => void }) {
  const owned = slot.owned[0]; const [card, setCard] = useState<TcgCardDetail | null>(null); const [variantIndex, setVariantIndex] = useState(0); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; setLoading(true); setCard(null); void loadCard(slot.card.id).then((value) => { if (active) setCard(value); }).catch(() => { if (active) onError('Kartendetails konnten nicht geladen werden.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [onError, slot.card.id]);
  if (owned) {
    const mutate = async (entry: CollectionEntry, delta: number) => { setBusy(true); try { await changeQuantity(user, entry, delta); if (delta < 0 && entry.quantity === 1) onClose(); } catch { onError('Die Kartenmenge konnte nicht aktualisiert werden.'); } finally { setBusy(false); } };
    return <CardDialog entry={owned} price={prices[owned.syncId]} busy={busy} onClose={onClose} onChange={mutate} />;
  }
  const variants = card?.variants_detailed?.length ? card.variants_detailed : card ? [{ type: 'Normal', size: 'Standard', pricing: card.pricing }] : [];
  const variant = variants[Math.min(variantIndex, Math.max(0, variants.length - 1))]; const price = card && variant ? exactTrendPrice(card, variant) : null;
  const add = async () => { if (!card || !variant) return; setBusy(true); try { await addExactCard(user, card, variant, 1, entries); onClose(); } catch { onError('Die Karte konnte nicht zum Binder hinzugefügt werden.'); } finally { setBusy(false); } };
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="card-dialog missing-card-dialog" role="dialog" aria-modal="true" aria-labelledby="binder-card-title"><button className="dialog-close" onClick={onClose} aria-label="Schließen"><X /></button><div className="dialog-card-image missing-preview"><img src={imageUrl(card?.image ?? slot.card.image, 'high') ?? '/domidex-logo.jpg'} alt={slot.card.name} /></div><div className="dialog-card-info"><p>{card?.set.name ?? 'Set-Karte'} · NICHT IM BESITZ</p><h2 id="binder-card-title">{card?.name ?? slot.card.name}</h2><span>#{card?.localId ?? slot.card.localId} · {card?.rarity ?? 'Seltenheit nicht angegeben'}</span>{loading ? <div className="binder-detail-loading"><LoaderCircle className="spin" /> Kartendaten werden geladen …</div> : <><label className="binder-variant"><span>Variante</span><select value={variantIndex} onChange={(event) => setVariantIndex(Number(event.target.value))}>{variants.map((item, index) => <option value={index} key={`${item.type}-${item.size ?? index}`}>{item.type}{item.size ? ` · ${item.size}` : ''}</option>)}</select></label><dl><div><dt>Besitzstatus</dt><dd>Fehlt im Binder</dd></div><div><dt>Cardmarket Trend</dt><dd>{price === null ? 'Preis nicht verfügbar' : formatPrice(price)}</dd></div></dl><button className="binder-add-button" disabled={busy || !variant} onClick={() => void add()}>{busy ? <LoaderCircle className="spin" /> : <Plus />} Zur Sammlung hinzufügen</button></>}</div></section></div>;
}

function CardDialog({ entry, price, busy, onClose, onChange }: { entry: CollectionEntry; price: number | null | undefined; busy: boolean; onClose: () => void; onChange: (entry: CollectionEntry, delta: number) => void }) { return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="card-dialog" role="dialog" aria-modal="true" aria-labelledby="card-title"><button className="dialog-close" onClick={onClose} aria-label="Schließen"><X /></button><div className="dialog-card-image"><img src={entry.imageUrl ?? '/domidex-logo.jpg'} alt={entry.name} /></div><div className="dialog-card-info"><p>{entry.setName}</p><h2 id="card-title">{entry.name}</h2><span>#{entry.collectorNumber} · {entry.language === 'GERMAN' ? 'Deutsch' : entry.language}</span><dl><div><dt>Variante</dt><dd>{entry.finish} · {entry.variant}</dd></div><div><dt>Zustand</dt><dd>{entry.condition || 'Nicht angegeben'}</dd></div><div><dt>Cardmarket Trend</dt><dd>{price === undefined ? 'Wird geladen …' : price === null ? 'Preis nicht verfügbar' : formatPrice(price)}</dd></div><div><dt>Gesamtwert</dt><dd>{typeof price === 'number' ? formatPrice(price * entry.quantity) : 'Preis nicht verfügbar'}</dd></div></dl><div className="dialog-actions"><button disabled={busy} onClick={() => onChange(entry,-1)}>{entry.quantity === 1 ? <Trash2 /> : <Minus />}</button><output>{entry.quantity}</output><button disabled={busy} onClick={() => onChange(entry,1)}><Plus /></button></div></div></section></div>; }

function BinderPocket({ slot, onSelect }: { slot?: BinderSlot; onSelect: (slot: BinderSlot) => void }) { const owned = slot?.owned[0]; return <button className={`binder-pocket ${slot && !owned ? 'missing-card' : slot ? '' : 'empty-pocket'}`} disabled={!slot} onClick={() => slot && onSelect(slot)}>{slot ? <><img src={owned?.imageUrl ?? imageUrl(slot.card.image, 'low') ?? '/domidex-logo.jpg'} alt={slot.card.name} /><span>{owned ? `×${slot.owned.reduce((sum, entry) => sum + entry.quantity, 0)}` : `#${slot.card.localId}`}</span>{!owned && <small>Fehlt · antippen</small>}</> : <><b>—</b><small>Kein Kartenplatz</small></>}</button>; }
function CardTile({ entry, price }: { entry: CollectionEntry; price: number | null | undefined }) { return <article className="card-tile"><div>{entry.imageUrl ? <img src={entry.imageUrl} alt={entry.name} loading="lazy" /> : <img src="/domidex-logo.jpg" alt="" />}</div><p>{entry.setName}</p><h3>{entry.name}</h3><span>#{entry.collectorNumber} · {entry.finish}</span><strong>{price === undefined ? 'Preis wird geladen' : price === null ? 'Preis nicht verfügbar' : formatPrice(price)}</strong></article>; }
function Metric({ title, value, detail, accent }: { title: string; value: string; detail: string; accent: string }) { return <article className={`metric ${accent}`}><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>; }
function PanelTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) { return <header className="panel-title"><h2>{title}</h2>{action && <button onClick={onAction}>{action} <ChevronRight /></button>}</header>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><FolderSearch /><h2>{title}</h2><p>{text}</p></div>; }
function AppLoading({ compact = false }: { compact?: boolean }) { return <main className={compact ? 'app-loading compact' : 'app-loading'}><img src="/domidex-logo.jpg" alt="DomiDex" /><LoaderCircle className="spin" /><p>Deine Sammlung wird vorbereitet …</p></main>; }

interface BinderGroup { id: string; name: string; sourceSetId: string | null; entries: CollectionEntry[]; }
function groupBinders(entries: CollectionEntry[]): BinderGroup[] { return Object.values(entries.reduce<Record<string,BinderGroup>>((groups,entry) => { const current=groups[entry.binderId]??{id:entry.binderId,name:entry.binderName,sourceSetId:entry.sourceSetId,entries:[]}; if (!current.sourceSetId && entry.sourceSetId) current.sourceSetId=entry.sourceSetId; current.entries.push(entry); groups[entry.binderId]=current; return groups;},{})).sort((a,b)=>a.name.localeCompare(b.name,'de')); }
function bestVariant(card: TcgCardDetail, finish: string, variant: string) { const variants=card.variants_detailed?.length?card.variants_detailed:[{type:'Normal',size:'Standard',pricing:card.pricing}]; return variants.find((item)=>normalizeFinish(item.type)===finish && (!variant || variant.includes(item.size??'Standard')))??variants.find((item)=>normalizeFinish(item.type)===finish); }
function normalizeFinish(value:string){if(/reverse/i.test(value))return'Reverse Holo';if(/holo/i.test(value))return'Holo';return'Normal';}
function chunk<T>(items:T[],size:number){return Array.from({length:Math.ceil(items.length/size)},(_,index)=>items.slice(index*size,(index+1)*size));}
function formatPrice(value:number){return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value);}
