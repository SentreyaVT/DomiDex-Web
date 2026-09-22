'use client';

import {
  BadgeEuro, BookOpen, ChevronLeft, ChevronRight, CircleUserRound, CloudOff, Eye, FolderSearch,
  ImageOff, LayoutDashboard, LibraryBig, LoaderCircle, LockKeyhole, LogIn, LogOut, Minus, Plus,
  RefreshCw, ScanLine, Search, Settings, ShieldCheck, Sparkles, Trash2, UserRoundCog, X,
} from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth-provider';
import { addExactCard, changeQuantity, subscribeCollection } from '@/lib/collection';
import { canonicalTcgCardId, collectionVariantLabel, exactTrendPrice, type CollectionEntry, type TcgCardDetail, type TcgCardSummary } from '@/lib/domain';
import { buildBinderSlots, paginateBinderSlots, variantForBinderSlot, type BinderSlot } from '@/lib/binder';
import { imageUrl, loadCard, loadSet, searchCards } from '@/lib/tcgdex';
import { adminNavigation } from '@/lib/admin-navigation';
import { useCollectionPrices } from './use-collection-prices';
import { formatKnownValuation, sumKnownPrices } from '@/lib/collection-prices';
import { ModalFocus } from './modal-focus';

const PriceErrors = createContext<Set<string>>(new Set());

type View = 'overview' | 'binder' | 'collection' | 'search' | 'portfolio' | 'settings';

const navigation: Array<[View, string, typeof LayoutDashboard]> = [
  ['overview', 'Übersicht', LayoutDashboard], ['binder', 'Binder', BookOpen], ['collection', 'Sammlung', LibraryBig],
  ['search', 'Karte hinzufügen', Search], ['portfolio', 'Portfolio', BadgeEuro], ['settings', 'Einstellungen', Settings],
];

export function WebApp() {
  const { user, loading: authLoading, isAdmin, hasAppAccess, accessError, logout, refreshClaims, signIn } = useAuth();
  const [view, setView] = useState<View>('overview');
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const { prices, failed: failedPrices, pending: pendingPrices, retry: retryPrices } = useCollectionPrices(entries, user?.uid);

  useEffect(() => {
    if (!user || !hasAppAccess) { setEntries([]); setLoading(false); return; }
    setLoading(true);
    return subscribeCollection(user, (next) => { setEntries(next); setLoading(false); setOffline(false); }, () => { setLoading(false); setOffline(true); });
  }, [hasAppAccess, user]);

  const portfolio = useMemo(() => entries.reduce((sum, entry) => {
    const price = prices[entry.syncId];
    return sum + (typeof price === 'number' ? price * entry.quantity : 0);
  }, 0), [entries, prices]);
  const pricedCount = entries.filter((entry) => typeof prices[entry.syncId] === 'number').reduce((sum, entry) => sum + entry.quantity, 0);
  const totalCount = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const binders = useMemo(() => groupBinders(entries), [entries]);

  if (authLoading) return <AppLoading />;
  if (!user) return <AccessPreview mode="guest" error={error} onSignIn={() => void signIn().catch(() => setError('Die Google-Anmeldung konnte nicht gestartet werden. Bitte lade die Seite neu und versuche es erneut.'))} />;
  if (!hasAppAccess) return <AccessPreview mode="connect" accessError={accessError} error={error} userName={user.displayName ?? user.email ?? 'DomiDex Nutzer'} onRefresh={() => void refreshClaims().catch(() => setError('Der Web-Zugang konnte nicht erneut geprüft werden.'))} onLogout={() => void logout()} />;

  return (
    <PriceErrors.Provider value={failedPrices}><main className="desktop-app">
      <aside className="desktop-sidebar">
        <a className="brand" href="/"><img src="/domidex-logo.jpg" alt="" /><span>Domi<span>Dex</span></span></a>
        <nav aria-label="Web-App Navigation">
          {navigation.map(([key, label, Icon]) => <button className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined} title={label} onClick={() => setView(key)} key={key}><Icon /><span>{label}</span></button>)}
          {isAdmin && <div className="admin-navigation"><small>ADMIN</small>{adminNavigation(isAdmin).map((item) => { const Icon = item.kind === 'dashboard' ? ShieldCheck : item.kind === 'scanner' ? ScanLine : UserRoundCog; return <a href={item.href} key={item.href}><Icon />{item.label}</a>; })}</div>}
        </nav>
        <div className="sidebar-account"><CircleUserRound /><div><strong>{user.displayName ?? 'DomiDex Nutzer'}</strong><small>{user.email}</small></div></div>
      </aside>
      <section className="desktop-content">
        <header className="app-topbar">
          <div><span>DomiDex Web</span><b>{navigation.find(([key]) => key === view)?.[1]}</b></div>
          <div className="sync-pill">{offline ? <><CloudOff /> Offline · lokaler Cache</> : <><span /> Live mit Android synchronisiert</>}</div>
        </header>
        {error && <div className="app-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fehler schließen"><X /></button></div>}
        {failedPrices.size > 0 && <div className="app-error" role="status">Preise für {failedPrices.size} Einträge konnten nicht geladen werden.<button onClick={retryPrices} disabled={pendingPrices > 0}>Erneut versuchen</button></div>}
        {loading ? <AppLoading compact /> : (
          <>
            {view === 'overview' && <Overview entries={entries} prices={prices} total={portfolio} binders={binders} onNavigate={setView} offline={offline} />}
            {view === 'binder' && <BinderView binders={binders} prices={prices} user={user} onError={setError} />}
            {view === 'collection' && <CollectionView entries={entries} prices={prices} user={user} onError={setError} />}
            {view === 'search' && <SearchView entries={entries} user={user} onError={setError} />}
            {view === 'portfolio' && <Portfolio entries={entries} prices={prices} total={portfolio} pricedCount={pricedCount} totalCount={totalCount} />}
            {view === 'settings' && <SettingsView userName={user.displayName ?? user.email ?? 'DomiDex Nutzer'} onLogout={() => void logout()} />}
          </>
        )}
      </section>
    </main></PriceErrors.Provider>
  );
}

function AccessPreview({ mode, error, accessError, userName, onSignIn, onRefresh, onLogout }: { mode: 'guest' | 'connect'; error?: string; accessError?: 'unavailable' | 'timeout' | null; userName?: string; onSignIn?: () => void; onRefresh?: () => void; onLogout?: () => void }) {
  const [view, setView] = useState<View>('overview');
  const label = navigation.find(([key]) => key === view)?.[1] ?? 'Übersicht';
  return <main className="desktop-app preview-app">
    <aside className="desktop-sidebar">
      <a className="brand" href="/"><img src="/domidex-logo.jpg" alt="" /><span>Domi<span>Dex</span></span></a>
      <nav aria-label="Web-App Vorschau">
        {navigation.map(([key, itemLabel, Icon]) => <button className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined} title={itemLabel} onClick={() => setView(key)} key={key}><Icon /><span>{itemLabel}</span></button>)}
      </nav>
      <div className="sidebar-account"><CircleUserRound /><div><strong>{mode === 'guest' ? 'Gast-Vorschau' : userName}</strong><small>{mode === 'guest' ? 'Keine persönlichen Daten' : accessError ? 'Zugriffsprüfung nicht erreichbar' : 'Web-Zugang noch nicht freigeschaltet'}</small></div></div>
    </aside>
    <section className="desktop-content">
      <header className="app-topbar"><div><span>DomiDex Web</span><b>{label}</b></div><div className="sync-pill preview"><Eye /> Vorschau</div></header>
      <div className="app-view access-preview">
        <section className="access-card">
          <div className="access-icon">{mode === 'guest' ? <Eye /> : <LockKeyhole />}</div>
          <p>{mode === 'guest' ? 'ÖFFENTLICHE WEB-APP-VORSCHAU' : 'GESCHÜTZTER DOMIDEX-ZUGANG'}</p>
          <h1>{mode === 'guest' ? 'Lerne DomiDex Web kennen.' : accessError ? 'Zugriff konnte nicht geprüft werden' : 'DomiDex Web verbinden'}</h1>
          <span>{mode === 'guest' ? 'Du kannst alle Bereiche ansehen. Persönliche Sammlungen, Binder und Portfolio-Daten werden dabei weder geladen noch verändert.' : accessError ? 'Deine Anmeldung besteht, aber die sichere Zugriffsprüfung ist gerade nicht erreichbar. Das bedeutet nicht, dass deine Freigabe fehlt. Bitte versuche die Prüfung erneut; bei anhaltendem Fehler wende dich an den Support.' : 'Melde dich in der DomiDex-App mit demselben Konto an und lass den Web-Zugang freischalten. Erst danach lädt diese Website deine private Sammlung.'}</span>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="access-actions">
            {mode === 'guest' ? <button onClick={onSignIn}><LogIn /> Mit Google anmelden</button> : <><button onClick={onRefresh}><RefreshCw /> Zugriff erneut prüfen</button><button className="quiet" onClick={onLogout}><LogOut /> Abmelden</button></>}
            <a href="/">Zur DomiDex Website</a>
          </div>
          <small><ShieldCheck /> Ohne bestätigte Web-Freigabe bleiben persönliche Firebase-Daten serverseitig gesperrt.</small>
        </section>
        <section className="preview-surface" aria-label={`${label} ohne persönliche Daten`}>
          <header><span>{label}</span><em>Keine persönlichen Daten</em></header>
          {view === 'binder' ? <div className="preview-binder"><img src="/domidex-logo.jpg" alt="" /><b>Digitaler Binder</b><span>Öffnen, blättern und Varianten getrennt verwalten</span></div> : <><div className="preview-metrics"><i /><i /><i /><i /></div><div className="preview-panels"><i /><i /></div></>}
        </section>
      </div>
    </section>
  </main>;
}

function Overview({ entries, prices, total, binders, onNavigate, offline }: { entries: CollectionEntry[]; prices: Record<string, number | null | undefined>; total: number; binders: BinderGroup[]; onNavigate: (view: View) => void; offline: boolean }) {
  const count = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const coverage = sumKnownPrices(entries, prices);
  const top = [...entries].filter((entry) => typeof prices[entry.syncId] === 'number').sort((a, b) => (prices[b.syncId]! * b.quantity) - (prices[a.syncId]! * a.quantity)).slice(0, 4);
  return <div className="app-view">
    <div className="view-title"><div><p>DEINE SAMMLUNG</p><h1>Willkommen zurück.</h1><span>Echte Daten aus deinem gemeinsamen DomiDex-Konto.</span></div><button onClick={() => onNavigate('search')}><Plus /> Karte hinzufügen</button></div>
    <div className="metric-grid">
      <Metric title={coverage.priced < count ? 'Bewerteter Teilbestand' : 'Gesamtwert'} value={coverage.priced || !count ? formatPrice(total) : 'Noch nicht verfügbar'} detail={`${coverage.priced}/${count} Karten · Cardmarket-Trend`} accent="violet" />
      <Metric title="Karten" value={String(count)} detail={`${entries.length} eindeutige Varianten`} accent="cyan" />
      <Metric title="Sets" value={String(binders.length)} detail="mit gesammelten Karten" accent="green" />
      <Metric title="Synchronisation" value={offline ? 'Offline' : 'Verbunden'} detail={offline ? 'Verbindung prüfen' : 'Android ↔ Web'} accent="gold" />
    </div>
    <div className="dashboard-grid">
      <section className="panel"><PanelTitle title="Letzte Karten" action="Sammlung öffnen" onAction={() => onNavigate('collection')} />{entries.length ? <div className="recent-grid">{entries.slice(0, 6).map((entry) => <CardTile entry={entry} price={prices[entry.syncId]} key={entry.syncId} />)}</div> : <Empty title="Noch keine Karten" text="Füge deine erste Karte in der Android-App oder hier über die Suche hinzu." />}</section>
      <section className="panel"><PanelTitle title="Wertvollste Karten" />{top.length ? <div className="value-list">{top.map((entry, index) => <div key={entry.syncId}><span>{index + 1}</span><img src={entry.imageUrl ?? '/domidex-logo.jpg'} alt="" /><div><b>{entry.name}</b><small>{entry.setName} · {entry.finish}</small></div><strong>{formatPrice(prices[entry.syncId]! * entry.quantity)}</strong></div>)}</div> : <Empty title="Noch keine bepreisten Karten" text="Nur eindeutig zugeordnete Trendpreise werden berücksichtigt." />}</section>
    </div>
  </div>;
}

export function BinderView({ binders, prices, user, onError }: { binders: BinderGroup[]; prices: Record<string, number | null>; user: NonNullable<ReturnType<typeof useAuth>['user']>; onError: (value: string) => void }) {
  const [binderIndex, setBinderIndex] = useState(0); const [page, setPage] = useState(0); const [open, setOpen] = useState(false); const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [setCards, setSetCards] = useState<TcgCardSummary[]>([]); const [printedTotal, setPrintedTotal] = useState(0); const [setLoading, setSetLoading] = useState(false);
  const binder = binders[Math.min(binderIndex, Math.max(0, binders.length - 1))];
  useEffect(() => { setPage(0); setOpen(false); setSelectedSlotId(null); }, [binderIndex]);
  useEffect(() => {
    let active = true; setSetCards([]); setPrintedTotal(0); setSetLoading(false); if (!binder?.sourceSetId) return;
    setSetLoading(true); void loadSet(binder.sourceSetId).then((set) => { if (active) { setSetCards(set.cards ?? []); setPrintedTotal(set.cardCount?.official ?? 0); } }).catch(() => { if (active) onError('Das vollständige Set konnte nicht geladen werden. Der vorhandene Bestand bleibt sichtbar.'); }).finally(() => { if (active) setSetLoading(false); });
    return () => { active = false; };
  }, [binder?.sourceSetId, onError]);
  if (!binder) return <div className="app-view"><div className="view-title"><div><p>BINDER</p><h1>Deine Binder.</h1></div></div><Empty title="Noch kein Binder" text="Sobald eine Karte hinzugefügt wird, erscheint ihr Set-Binder automatisch hier." /></div>;
  const summaries = setCards.length ? setCards : binder.entries.map((entry) => ({ id: entry.sourceCardId ?? entry.syncId, localId: entry.collectorNumber, name: entry.name, rarity: entry.rarity, image: entry.imageUrl ?? undefined }));
  const slots = buildBinderSlots(summaries, binder.entries, printedTotal); const pages = paginateBinderSlots(slots); const displayedPage = Math.min(page, Math.max(0, pages.length - 1)); const visible = pages[displayedPage] ?? []; const selected = selectedSlotId ? slots.find((slot) => slot.slotId === selectedSlotId) ?? null : null;
  const changePage = (nextPage: number) => { if (nextPage < 0 || nextPage >= pages.length) return; setPage(nextPage); };
  return <div className="app-view binder-view">
    <div className="view-title"><div><p>MASTER-SET BINDER</p><h1>{binder.name}</h1><span>{binder.entries.reduce((sum, entry) => sum + entry.quantity, 0)} Karten · {slots.filter((slot) => slot.owned.length).length}/{slots.length || binder.entries.length} Plätze · {formatKnownValuation(sumKnownPrices(binder.entries, prices))}</span></div><select aria-label="Binder auswählen" value={binderIndex} onChange={(event) => setBinderIndex(Number(event.target.value))}>{binders.map((item, index) => <option value={index} key={item.id}>{item.name}</option>)}</select></div>
    <section className={`interactive-binder ${open ? 'is-open' : ''}`}>
      {!open ? <button className="binder-cover" onClick={() => setOpen(true)}><img src="/domidex-logo.jpg" alt="" /><small>DOMIDEX BINDER</small><strong>{binder.name}</strong><span>Öffnen</span></button> : <>
        {setLoading ? <div className="binder-set-loading"><LoaderCircle className="spin" /><span>Alle Set-Karten werden geladen …</span></div> : <div className="binder-book"><div className="pocket-page">{[0,1,2,3].map((slot) => <BinderPocket slot={visible[slot]} onSelect={(item) => setSelectedSlotId(item.slotId)} key={visible[slot]?.slotId ?? slot} />)}</div><div className="binder-spine"><i/><i/><i/><i/></div><div className="pocket-page">{[4,5,6,7].map((slot) => <BinderPocket slot={visible[slot]} onSelect={(item) => setSelectedSlotId(item.slotId)} key={visible[slot]?.slotId ?? slot} />)}</div></div>}
        <div className="page-controls"><button aria-label="Vorherige Binderseite" disabled={displayedPage === 0} onClick={() => changePage(displayedPage - 1)}><ChevronLeft /></button><span>Seite {displayedPage + 1} / {Math.max(1, pages.length)}</span><button aria-label="Nächste Binderseite" disabled={displayedPage >= pages.length - 1} onClick={() => changePage(displayedPage + 1)}><ChevronRight /></button><button className="close-binder" onClick={() => setOpen(false)}>Binder schließen</button></div>
      </>}
    </section>
    {selected && <BinderCardDialog slot={selected} entries={binder.entries} prices={prices} user={user} busy={busy} setBusy={setBusy} onClose={() => setSelectedSlotId(null)} onError={onError} />}
  </div>;
}

function CollectionView({ entries, prices, user, onError }: { entries: CollectionEntry[]; prices: Record<string, number | null>; user: NonNullable<ReturnType<typeof useAuth>['user']>; onError: (value: string) => void }) {
  const [query, setQuery] = useState(''); const [selectedId, setSelectedId] = useState<string | null>(null); const [busy, setBusy] = useState(false); const selected = selectedId ? entries.find((entry) => entry.syncId === selectedId) ?? null : null;
  const filtered = entries.filter((entry) => `${entry.name} ${entry.setName} ${entry.collectorNumber}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (prices[b.syncId] ?? -1) - (prices[a.syncId] ?? -1));
  const mutate = async (entry: CollectionEntry, delta: number) => { setBusy(true); try { await changeQuantity(user, entry, delta); if (delta < 0 && entry.quantity === 1) setSelectedId(null); } catch { onError('Die Kartenmenge konnte nicht aktualisiert werden.'); } finally { setBusy(false); } };
  return <div className="app-view"><div className="view-title"><div><p>SAMMLUNG</p><h1>Alle Karten.</h1><span>{entries.reduce((sum, entry) => sum + entry.quantity, 0)} Karten in {new Set(entries.map((entry) => entry.setName)).size} Sets</span></div><label className="search-field"><Search /><input aria-label="Sammlung durchsuchen" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sammlung durchsuchen" /></label></div>{filtered.length ? <div className="collection-grid">{filtered.map((entry) => <button onClick={() => setSelectedId(entry.syncId)} key={entry.syncId}><CardTile entry={entry} price={prices[entry.syncId]} /><span className="quantity-badge">×{entry.quantity}</span></button>)}</div> : <Empty title="Keine Karten gefunden" text="Passe deine Suche an oder füge eine neue Karte hinzu." />}{selected && <CardDialog entry={selected} price={prices[selected.syncId]} busy={busy} onClose={() => setSelectedId(null)} onChange={mutate} />}</div>;
}

function SearchView({ entries, user, onError }: { entries: CollectionEntry[]; user: NonNullable<ReturnType<typeof useAuth>['user']>; onError: (value: string) => void }) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<TcgCardSummary[]>([]); const [card, setCard] = useState<TcgCardDetail | null>(null); const [variantIndex, setVariantIndex] = useState(0); const [quantity, setQuantity] = useState(1); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const variants = card?.variants_detailed?.length ? card.variants_detailed : card ? [{ type: 'Normal', size: 'Standard', pricing: card.pricing }] : [];
  const variant = variants[variantIndex] ?? variants[0]; const price = card && variant ? exactTrendPrice(card, variant) : null;
  const search = async () => { setBusy(true); setMessage(''); try { setResults(await searchCards(query)); setCard(null); } catch (error) { onError(error instanceof Error ? error.message : 'Kartensuche fehlgeschlagen.'); } finally { setBusy(false); } };
  const choose = async (summary: TcgCardSummary) => { setBusy(true); setMessage(''); try { setCard(await loadCard(summary.id)); setVariantIndex(0); setQuantity(1); } catch (error) { onError(error instanceof Error ? error.message : 'Kartendetails fehlen.'); } finally { setBusy(false); } };
  const add = async () => { if (!card || !variant) return; setBusy(true); setMessage(''); try { await addExactCard(user, card, variant, quantity, entries); setMessage(`${card.name} wurde synchronisiert.`); } catch (error) { onError(error instanceof Error ? error.message : 'Karte konnte nicht hinzugefügt werden.'); } finally { setBusy(false); } };
  return <div className="app-view"><div className="view-title"><div><p>MANUELL HINZUFÜGEN</p><h1>Karte suchen.</h1><span>Set, Karte, Variante und Menge – der Scanner bleibt in der Android-App.</span></div></div><div className="search-layout"><section className="panel search-panel"><form onSubmit={(event) => { event.preventDefault(); void search(); }}><label className="search-field large"><Search /><input aria-label="Kartenname suchen" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kartenname, z. B. Glurak" /><button disabled={busy || query.trim().length < 2}>{busy ? <LoaderCircle className="spin" /> : 'Suchen'}</button></label></form><div className="search-results">{results.map((result) => <button className={card?.id === result.id ? 'active' : ''} onClick={() => void choose(result)} key={result.id}><div className="mini-card">{result.image ? <img src={imageUrl(result.image, 'low') ?? ''} alt={result.name} loading="lazy" /> : <span className="image-unavailable"><ImageOff /><small>Kein offizielles Bild</small></span>}</div><div><b>{result.name}</b><small>#{result.localId} · {result.id}</small></div><ChevronRight /></button>)}</div>{!results.length && !busy && <Empty title="Suche im deutschen Kartenkatalog" text="Es werden nur echte TCGdex-Kartenidentitäten verwendet." />}</section><section className="panel card-add-panel">{card && variant ? <><div className="selected-card"><div className="selected-card-image">{card.image ? <img src={imageUrl(card.image) ?? ''} alt={card.name} /> : <span className="image-unavailable large"><ImageOff /><small>Kein offizielles Bild verfügbar</small></span>}</div><div><p>{card.set.name}</p><h2>{card.name}</h2><span>#{card.localId} · {card.rarity ?? 'Seltenheit unbekannt'}</span></div></div><label>Variante<select value={variantIndex} onChange={(event) => setVariantIndex(Number(event.target.value))}>{variants.map((item, index) => <option value={index} key={`${item.variantId ?? item.type}-${collectionVariantLabel(item)}-${index}`}>{item.type} · {collectionVariantLabel(item)}</option>)}</select></label><div className="add-price"><span>Cardmarket Trendpreis</span><strong>{price === null ? 'Preis nicht verfügbar' : formatPrice(price)}</strong><small>{price === null ? 'Keine eindeutige Preiszuordnung für diese Variante.' : `Exakte Quelle · Produkt ${variant.pricing?.cardmarket?.idProduct ?? card.pricing?.cardmarket?.idProduct}`}</small></div><label>Menge<div className="stepper"><button onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus /></button><output>{quantity}</output><button onClick={() => setQuantity((value) => Math.min(100, value + 1))}><Plus /></button></div></label><button className="add-card-button" disabled={busy} onClick={() => void add()}>{busy ? <LoaderCircle className="spin" /> : <Plus />} Zur Sammlung hinzufügen</button>{message && <p className="success-message">✓ {message}</p>}</> : <Empty title="Wähle eine Karte" text="Danach erscheinen die tatsächlich gemeldeten Varianten und der passende Cardmarket-Trendpreis." />}</section></div></div>;
}

function Portfolio({ entries, prices, total, pricedCount, totalCount }: { entries: CollectionEntry[]; prices: Record<string, number | null>; total: number; pricedCount: number; totalCount: number }) {
  const groups = Object.entries(entries.reduce<Record<string, { value: number; cards: number; priced: number }>>((result, entry) => { const current = result[entry.setName] ?? { value: 0, cards: 0, priced: 0 }; const part = sumKnownPrices([entry], prices); current.cards += part.quantity; current.value += part.value; current.priced += part.priced; result[entry.setName] = current; return result; }, {})).sort((a,b) => b[1].value-a[1].value);
  return <div className="app-view"><div className="view-title"><div><p>PORTFOLIO</p><h1>{pricedCount || !totalCount ? formatPrice(total) : 'Preis nicht verfügbar'}</h1><span>{pricedCount < totalCount ? 'Teilbewertung: ' : ''}Nur aktuell geladene, eindeutig zugeordnete Cardmarket-Trendpreise.</span></div></div><div className="portfolio-layout"><section className="panel portfolio-total"><span>BEWERTETER BESTAND</span><strong>{pricedCount} / {totalCount}</strong><div className="price-ring" style={{ '--progress': `${totalCount ? pricedCount/totalCount*360 : 0}deg` } as React.CSSProperties}><b>{totalCount ? Math.round(pricedCount/totalCount*100) : 0}%</b></div><p>Unbepreiste Karten werden transparent ausgeschlossen – niemals mit erfundenen 0 € verrechnet.</p></section><section className="panel"><PanelTitle title="Wert nach Set" />{groups.length ? <div className="set-values">{groups.map(([name, group]) => <div key={name}><div><b>{name}</b><small>{group.cards} Karten</small></div><strong>{formatKnownValuation({ ...group, quantity: group.cards })}</strong><span><i style={{ width: `${total ? Math.max(2,group.value/total*100) : 2}%` }} /></span></div>)}</div> : <Empty title="Noch keine Portfoliodaten" text="Füge Karten hinzu, um den echten Set-Wert zu sehen." />}</section></div></div>;
}

function SettingsView({ userName, onLogout }: { userName: string; onLogout: () => void }) { return <div className="app-view"><div className="view-title"><div><p>EINSTELLUNGEN</p><h1>Dein DomiDex.</h1></div></div><section className="panel settings-list"><div><CircleUserRound /><span><b>{userName}</b><small>Firebase-/Google-Konto</small></span><ShieldCheck /></div><div><Sparkles /><span><b>Design</b><small>Dunkel · DomiDex Violet</small></span></div><div><BadgeEuro /><span><b>Preise</b><small>Cardmarket Trend · keine Ersatzwerte</small></span></div><a href="/datenschutz">Datenschutz</a><a href="/konto-loeschen">Informationen zur Kontolöschung</a><a href="/account/delete">Konto und Cloud-Daten löschen</a><button onClick={onLogout}><LogOut /> Abmelden</button></section></div>; }

function BinderCardDialog({ slot, entries, prices, user, busy, setBusy, onClose, onError }: { slot: BinderSlot; entries: CollectionEntry[]; prices: Record<string, number | null>; user: NonNullable<ReturnType<typeof useAuth>['user']>; busy: boolean; setBusy: (value: boolean) => void; onClose: () => void; onError: (value: string) => void }) {
  const [ownedIndex, setOwnedIndex] = useState(0); const owned = slot.owned[Math.min(ownedIndex, Math.max(0, slot.owned.length - 1))]; const [card, setCard] = useState<TcgCardDetail | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; setLoading(true); setCard(null); void loadCard(canonicalTcgCardId(slot.card.id)).then((value) => { if (active) setCard(value); }).catch(() => { if (active) onError('Kartendetails konnten nicht geladen werden.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [onError, slot.card.id]);
  if (owned) {
    const mutate = async (entry: CollectionEntry, delta: number) => { setBusy(true); try { await changeQuantity(user, entry, delta); if (delta < 0 && entry.quantity === 1) onClose(); } catch { onError('Die Kartenmenge konnte nicht aktualisiert werden.'); } finally { setBusy(false); } };
    return <CardDialog entry={owned} price={prices[owned.syncId]} alternatives={slot.owned} selectedIndex={ownedIndex} onSelect={setOwnedIndex} busy={busy} onClose={onClose} onChange={mutate} />;
  }
  const variants = card?.variants_detailed?.length ? card.variants_detailed : card ? [{ type: 'Normal', size: 'Standard', pricing: card.pricing }] : [];
  const variant = variantForBinderSlot(variants, slot); const price = card && variant ? exactTrendPrice(card, variant) : null;
  const add = async () => { if (!card || !variant) return; setBusy(true); try { await addExactCard(user, card, variant, 1, entries); onClose(); } catch { onError('Die Karte konnte nicht zum Binder hinzugefügt werden.'); } finally { setBusy(false); } };
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="card-dialog missing-card-dialog" role="dialog" aria-modal="true" aria-labelledby="binder-card-title"><ModalFocus onClose={onClose} /><button className="dialog-close" onClick={onClose} aria-label="Schließen"><X /></button><div className="dialog-card-image missing-preview"><img src={imageUrl(card?.image ?? slot.card.image, 'high') ?? '/domidex-logo.jpg'} alt={slot.card.name} /></div><div className="dialog-card-info"><p>{card?.set.name ?? 'Set-Karte'} · NICHT IM BESITZ</p><h2 id="binder-card-title">{card?.name ?? slot.card.name}</h2><span>#{card?.localId ?? slot.card.localId} · {card?.rarity ?? slot.card.rarity ?? 'Seltenheit nicht angegeben'}</span>{loading ? <div className="binder-detail-loading"><LoaderCircle className="spin" /> Kartendaten werden geladen …</div> : <><div className="binder-print-identity"><span>Variante</span><strong>{slot.finish} · {slot.variant}</strong></div><dl><div><dt>Besitzstatus</dt><dd>Fehlt im Binder</dd></div><div><dt>Cardmarket Trend</dt><dd>{price === null ? 'Preis nicht verfügbar' : formatPrice(price)}</dd></div></dl><button className="binder-add-button" disabled={busy || !variant} onClick={() => void add()}>{busy ? <LoaderCircle className="spin" /> : <Plus />} Zur Sammlung hinzufügen</button></>}</div></section></div>;
}

function CardDialog({ entry, price, alternatives, selectedIndex = 0, onSelect, busy, onClose, onChange }: { entry: CollectionEntry; price: number | null | undefined; alternatives?: CollectionEntry[]; selectedIndex?: number; onSelect?: (index: number) => void; busy: boolean; onClose: () => void; onChange: (entry: CollectionEntry, delta: number) => void }) { return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="card-dialog" role="dialog" aria-modal="true" aria-labelledby="card-title"><ModalFocus onClose={onClose} /><button className="dialog-close" onClick={onClose} aria-label="Schließen"><X /></button><div className="dialog-card-image"><img src={entry.imageUrl ?? '/domidex-logo.jpg'} alt={entry.name} /></div><div className="dialog-card-info"><p>{entry.setName}</p><h2 id="card-title">{entry.name}</h2><span>#{entry.collectorNumber} · {entry.language === 'GERMAN' ? 'Deutsch' : entry.language}</span>{alternatives && alternatives.length > 1 && onSelect && <label className="binder-variant"><span>Gesammelte Variante</span><select value={selectedIndex} onChange={(event) => onSelect(Number(event.target.value))}>{alternatives.map((item, index) => <option value={index} key={item.syncId}>{item.finish} · {item.variant}</option>)}</select></label>}<dl><div><dt>Variante</dt><dd>{entry.finish} · {entry.variant}</dd></div><div><dt>Zustand</dt><dd>{entry.condition || 'Nicht angegeben'}</dd></div><div><dt>Cardmarket Trend</dt><dd><PriceText entry={entry} price={price} /></dd></div><div><dt>Gesamtwert</dt><dd>{typeof price === 'number' ? formatPrice(price * entry.quantity) : 'Preis nicht verfügbar'}</dd></div></dl><div className="dialog-actions"><button aria-label={entry.quantity === 1 ? 'Karte entfernen' : 'Menge verringern'} disabled={busy} onClick={() => onChange(entry,-1)}>{entry.quantity === 1 ? <Trash2 /> : <Minus />}</button><output>{entry.quantity}</output><button aria-label="Menge erhöhen" disabled={busy} onClick={() => onChange(entry,1)}><Plus /></button></div></div></section></div>; }

function BinderPocket({ slot, onSelect }: { slot?: BinderSlot; onSelect: (slot: BinderSlot) => void }) { const owned = slot?.owned[0]; return <button className={`binder-pocket ${slot && !owned ? 'missing-card' : slot ? '' : 'empty-pocket'}`} disabled={!slot} onClick={() => slot && onSelect(slot)}>{slot ? <><img src={owned?.imageUrl ?? imageUrl(slot.card.image, 'low') ?? '/domidex-logo.jpg'} alt={slot.card.name} /><span>{owned ? `×${slot.owned.reduce((sum, entry) => sum + entry.quantity, 0)}` : `#${slot.card.localId}`}</span><small>{slot.finish}{!owned ? ' · fehlt' : ''}</small></> : <><b>—</b><small>Kein Kartenplatz</small></>}</button>; }

function CardTile({ entry, price }: { entry: CollectionEntry; price: number | null | undefined }) { return <article className="card-tile"><div>{entry.imageUrl ? <img src={entry.imageUrl} alt={entry.name} loading="lazy" /> : <img src="/domidex-logo.jpg" alt="" />}</div><p>{entry.setName}</p><h3>{entry.name}</h3><span>#{entry.collectorNumber} · {entry.finish}</span><strong><PriceText entry={entry} price={price} /></strong></article>; }
function Metric({ title, value, detail, accent }: { title: string; value: string; detail: string; accent: string }) { return <article className={`metric ${accent}`}><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>; }
function PriceText({ entry, price }: { entry: CollectionEntry; price: number | null | undefined }) {
  const errors = useContext(PriceErrors);
  return <>{errors.has(entry.syncId) ? 'Laden fehlgeschlagen' : price === undefined ? 'Preis wird geladen …' : price === null ? 'Preis nicht verfügbar' : formatPrice(price)}</>;
}
function PanelTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) { return <header className="panel-title"><h2>{title}</h2>{action && <button onClick={onAction}>{action} <ChevronRight /></button>}</header>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><FolderSearch /><h2>{title}</h2><p>{text}</p></div>; }
function AppLoading({ compact = false }: { compact?: boolean }) { return <main className={compact ? 'app-loading compact' : 'app-loading'}><img src="/domidex-logo.jpg" alt="DomiDex" /><LoaderCircle className="spin" /><p>Deine Sammlung wird vorbereitet …</p></main>; }

interface BinderGroup { id: string; name: string; sourceSetId: string | null; entries: CollectionEntry[]; }
function groupBinders(entries: CollectionEntry[]): BinderGroup[] { return Object.values(entries.reduce<Record<string,BinderGroup>>((groups,entry) => { const current=groups[entry.binderId]??{id:entry.binderId,name:entry.binderName,sourceSetId:entry.sourceSetId,entries:[]}; if (!current.sourceSetId && entry.sourceSetId) current.sourceSetId=entry.sourceSetId; current.entries.push(entry); groups[entry.binderId]=current; return groups;},{})).sort((a,b)=>a.name.localeCompare(b.name,'de')); }
function formatPrice(value:number){return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value);}
