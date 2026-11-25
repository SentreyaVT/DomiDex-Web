'use client';

import {
  BadgeEuro, BookOpen, ChevronLeft, ChevronRight, CircleUserRound, CloudOff, Eye, FolderSearch,
  ImageOff, LayoutDashboard, LibraryBig, LoaderCircle, LockKeyhole, LogIn, LogOut, Minus, Plus,
  RefreshCw, ScanLine, Search, Settings, ShieldCheck, Sparkles, Trash2, UserRoundCog, X,
} from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useAuth } from './auth-provider';
import { addExactCard, changeQuantity, collectionSyncIdForExactCard, subscribeCollection } from '@/lib/collection';
import { canonicalTcgCardId, cardVariantsForSelection, collectionVariantLabel, exactCardmarketProductId, exactTrendPrice, variantForCollectionEntry, type CollectionEntry, type TcgCardDetail, type TcgCardSummary, type TcgVariant } from '@/lib/domain';
import { buildBinderSlots, paginateBinderSlots, variantForBinderSlot, type BinderSlot } from '@/lib/binder';
import { orderBinderSlots, orderSetBinderOverview, type SetBinderOverviewSort, type SetBinderSlotSort } from '@/lib/binder-view-policy';
import { imageUrl, loadCard, loadSet, searchCards } from '@/lib/tcgdex';
import { adminNavigation } from '@/lib/admin-navigation';
import { useCollectionPrices } from './use-collection-prices';
import { useCollectionLayouts } from './use-collection-layouts';
import { setBinderEntries } from '@/lib/collection-layouts';
import { formatKnownValuation, sumKnownPrices } from '@/lib/collection-prices';
import { ModalFocus } from './modal-focus';
import { BinderSharingOwner } from './binder-sharing-owner';
import { WindowedCollectionGrid } from './windowed-collection-grid';
import { CardShowcase } from './card-showcase';
import { PrivateBinderGallery } from './private-binder-gallery';
import { collectionThumbnail, sortedCollection } from '@/lib/collection-grid';
import { clearCollectionPriceSelection, saveCollectionPriceSelection } from '@/lib/collection-price-selections';
import type { CollectionPriceResult } from '@/lib/collection-prices';
import { collectionPriceMetricLabel, type AlternativePriceCandidate, type CollectionPriceSelection } from '@/lib/price-alternatives';
import { PriceAlternativePicker } from './price-alternative-picker';
import './web-app-polish.css';

const PriceErrors = createContext<Set<string>>(new Set());

type View = 'overview' | 'binder' | 'collection' | 'search' | 'portfolio' | 'settings';

const navigation: Array<[View, string, typeof LayoutDashboard]> = [
  ['overview', 'Übersicht', LayoutDashboard], ['binder', 'Binder', BookOpen], ['collection', 'Sammlung', LibraryBig],
  ['search', 'Karte hinzufügen', Search], ['portfolio', 'Portfolio', BadgeEuro], ['settings', 'Einstellungen', Settings],
];

export function WebApp() {
  const { user, loading: authLoading, isAdmin, hasAppAccess, hasScannerLabAccess, accessError, logout, refreshClaims, signIn } = useAuth();
  const canOpenScannerLab = isAdmin || hasScannerLabAccess;
  const [view, setView] = useState<View>('overview');
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const { prices, priceSources, selections, selectionSyncFailed, failed: failedPrices, pending: pendingPrices, retry: retryPrices } = useCollectionPrices(entries, hasAppAccess ? user?.uid : undefined);
  const { visibility: setBinderVisibility, failed: layoutFailed } = useCollectionLayouts(hasAppAccess ? user?.uid : undefined);
  const syncInterrupted = offline || layoutFailed || selectionSyncFailed;

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
  const setBinders = useMemo(() => groupBinders(setBinderEntries(entries, setBinderVisibility)), [entries, setBinderVisibility]);

  if (authLoading) return <AppLoading />;
  if (!user) return <AccessPreview mode="guest" error={error} onSignIn={() => void signIn().catch(() => setError('Die Google-Anmeldung konnte nicht gestartet werden. Bitte lade die Seite neu und versuche es erneut.'))} />;
  if (!hasAppAccess) return <AccessPreview mode="connect" canOpenScannerLab={canOpenScannerLab} accessError={accessError} error={error} userName={user.displayName ?? user.email ?? 'DomiDex Nutzer'} onRefresh={() => void refreshClaims().catch(() => setError('Der Web-Zugang konnte nicht erneut geprüft werden.'))} onLogout={() => void logout()} />;

  return (
    <PriceErrors.Provider value={failedPrices}><main className="desktop-app collector-app">
      <aside className="desktop-sidebar">
        <a className="brand" href="/"><img src="/domidex-logo.jpg" alt="" /><span>Domi<span>Dex</span></span></a>
        <small className="collector-nav-label">DEIN SAMMLUNIVERSUM</small>
        <nav aria-label="Web-App Navigation">
          {canOpenScannerLab && <a className="scanner-lab-link" href="/admin/scanner-lab"><ScanLine aria-hidden="true" /><span>Scanner Lab</span></a>}
          {navigation.map(([key, label, Icon]) => <button className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined} title={label} onClick={() => setView(key)} key={key}><Icon /><span>{label}</span></button>)}
          {isAdmin && <div className="admin-navigation"><small>ADMIN</small>{adminNavigation(isAdmin).filter((item) => item.kind !== 'scanner').map((item) => { const Icon = item.kind === 'dashboard' ? ShieldCheck : UserRoundCog; return <a href={item.href} key={item.href}><Icon />{item.label}</a>; })}</div>}
        </nav>
        <div className="sidebar-account"><CircleUserRound /><div><strong>{user.displayName ?? 'DomiDex Nutzer'}</strong><small>{user.email}</small></div></div>
        <p className="collector-sidebar-note">Deine Karten. Deine Geschichte.</p>
      </aside>
      <section className="desktop-content">
        <header className="app-topbar">
          <div><span>DEIN SAMMLUNIVERSUM</span><b>{navigation.find(([key]) => key === view)?.[1]}</b></div>
          <div className="sync-pill" role="status">{syncInterrupted ? <><CloudOff /> Synchronisierung unterbrochen · letzte Ansicht</> : <><span /> {loading ? 'Sammlung wird geladen' : 'Sammlung geladen'}</>}</div>
        </header>
        {error && <div className="app-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fehler schließen"><X /></button></div>}
        {selectionSyncFailed && <div className="app-error" role="status">Deine gespeicherte Preisauswahl konnte nicht synchronisiert werden.<button onClick={retryPrices}>Preisauswahl erneut synchronisieren</button></div>}
        {failedPrices.size > 0 && <div className="app-error" role="status">Preise für {failedPrices.size} Einträge konnten nicht geladen werden.<button onClick={retryPrices} disabled={pendingPrices > 0}>Erneut versuchen</button></div>}
        {loading ? <AppLoading compact /> : (
          <>
            {view === 'overview' && <Overview entries={entries} prices={prices} priceSources={priceSources} selections={selections} total={portfolio} binders={binders} onNavigate={setView} offline={syncInterrupted} />}
            {view === 'binder' && <BinderView binders={setBinders} entries={entries} prices={prices} priceSources={priceSources} selections={selections} user={user} onError={setError} />}
            {view === 'collection' && <CollectionView entries={entries} prices={prices} priceSources={priceSources} selections={selections} user={user} onError={setError} />}
            {view === 'search' && <SearchView entries={entries} user={user} onError={setError} />}
            {view === 'portfolio' && <Portfolio entries={entries} prices={prices} total={portfolio} pricedCount={pricedCount} totalCount={totalCount} />}
            {view === 'settings' && <SettingsView userName={user.displayName ?? user.email ?? 'DomiDex Nutzer'} onLogout={() => void logout()} />}
          </>
        )}
      </section>
    </main></PriceErrors.Provider>
  );
}

function AccessPreview({ mode, error, accessError, userName, canOpenScannerLab = false, onSignIn, onRefresh, onLogout }: { mode: 'guest' | 'connect'; error?: string; accessError?: 'unavailable' | 'timeout' | null; userName?: string; canOpenScannerLab?: boolean; onSignIn?: () => void; onRefresh?: () => void; onLogout?: () => void }) {
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
          <span>{mode === 'guest' ? 'Du siehst eine Vorschau der Bereiche. Persönliche Sammlungen, Binder und Portfolio-Daten werden dabei weder geladen noch verändert. Für die geschlossene Alpha kannst du dich über den privaten Testerprozess im DomiDex-Discord bewerben.' : accessError ? 'Deine Anmeldung besteht, aber die sichere Zugriffsprüfung ist gerade nicht erreichbar. Das bedeutet nicht, dass deine Freigabe fehlt. Bitte versuche die Prüfung erneut; bei anhaltendem Fehler wende dich an den Support.' : 'DomiDex ist in der geschlossenen Alpha. Die Freischaltung läuft über das private Tester-Ticket im DomiDex-Discord. Verwende danach in Android und Web dasselbe freigeschaltete Google-Konto. Erst mit bestätigtem Web-Zugang lädt diese Website deine private Sammlung.'}</span>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="access-actions">
            {mode === 'connect' && canOpenScannerLab && <a className="scanner-lab-link" href="/admin/scanner-lab"><ScanLine aria-hidden="true" /> Scanner Lab</a>}
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

function Overview({ entries, prices, priceSources, selections, total, binders, onNavigate, offline }: { entries: CollectionEntry[]; prices: Record<string, number | null | undefined>; priceSources: Record<string, CollectionPriceResult['source']>; selections: Record<string, CollectionPriceSelection>; total: number; binders: BinderGroup[]; onNavigate: (view: View) => void; offline: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.syncId === selectedId);
  const count = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const coverage = sumKnownPrices(entries, prices);
  const top = [...entries].filter((entry) => typeof prices[entry.syncId] === 'number').sort((a, b) => (prices[b.syncId]! * b.quantity) - (prices[a.syncId]! * a.quantity)).slice(0, 4);
  const spotlight = top.find((entry) => entry.imageUrl) ?? entries.find((entry) => entry.imageUrl);
  return <div className="app-view collector-overview">
    <div className="view-title"><div><p>DEINE SAMMLUNG, DEIN DOMIDEX</p><h1>Schön, dass du da bist.</h1><span>Deine Karten. Deine Binder. Alles an einem Ort.</span></div><button onClick={() => onNavigate('search')}><Plus /> Karte hinzufügen</button></div>
    <section className="collection-hero" aria-label="Deine Sammlung im Überblick">
      <div className="collection-hero-copy">
        <p className="hero-kicker"><BadgeEuro aria-hidden="true" />{coverage.priced < count ? 'Bewerteter Teilbestand' : 'Gesamtwert deiner Sammlung'}</p>
        <h2>{coverage.priced || !count ? formatPrice(total) : 'Noch nicht verfügbar'}</h2>
        <p className="hero-price-detail">{coverage.priced}/{count} Karten · Cardmarket-Preise</p>
        <p className="hero-description">{count ? 'Jede Karte ein Fundstück. Entdecke deine Sammlung neu.' : 'Dein nächstes Lieblingsstück wartet schon. Starte deine Sammlung mit einer Karte.'}</p>
        <div className="hero-actions"><button onClick={() => onNavigate('binder')}><BookOpen aria-hidden="true" /> Zu meinen Bindern <ChevronRight aria-hidden="true" /></button><button className="quiet" onClick={() => onNavigate('portfolio')}>Portfolio ansehen <ChevronRight aria-hidden="true" /></button></div>
      </div>
      <div className="collection-spotlight">
        {spotlight ? <><button className="spotlight-open" aria-label={`Karte groß ansehen: ${spotlight.name}`} onClick={() => setSelectedId(spotlight.syncId)}><img src={spotlight.imageUrl!} alt={spotlight.name} decoding="async" /></button><div className="spotlight-caption"><small>AUS DEINER SAMMLUNG</small><strong>{spotlight.name}</strong><span>{spotlight.setName} · #{spotlight.collectorNumber}</span></div></> : <><div className="hero-empty-mark" aria-hidden="true"><BookOpen /></div><div className="spotlight-caption"><small>PLATZ FÜR DEINE LIEBLINGSKARTEN</small><strong>Deine Geschichte beginnt hier.</strong><span>Die nächste Karte könnte deine sein.</span></div></>}
      </div>
    </section>
    <div className="metric-grid collector-metrics">
      <Metric title="Karten" value={String(count)} detail={`${entries.length} eindeutige Varianten`} accent="cyan" />
      <Metric title="Sets" value={String(binders.length)} detail="mit gesammelten Karten" accent="green" />
      <Metric title="Synchronisation" value={offline ? 'Offline' : 'Verbunden'} detail={offline ? 'Verbindung prüfen' : 'Android ↔ Web'} accent="gold" />
    </div>
    <div className="dashboard-grid">
      <section className="panel recent-panel"><PanelTitle title="Letzte Karten" action="Sammlung öffnen" onAction={() => onNavigate('collection')} />{entries.length ? <div className="recent-grid">{entries.slice(0, 6).map((entry) => <button className="card-open" aria-label={`Karte groß ansehen: ${entry.name}`} onClick={() => setSelectedId(entry.syncId)} key={entry.syncId}><CardTile entry={entry} price={prices[entry.syncId]} /></button>)}</div> : <Empty title="Noch keine Karten" text="Füge deine erste Karte in der Android-App oder hier über die Suche hinzu." />}</section>
      <section className="panel ranking-panel"><PanelTitle title="Wertvollste Karten" />{top.length ? <div className="value-list">{top.map((entry, index) => <button className="value-card-row" aria-label={`Karte groß ansehen: ${entry.name}`} onClick={() => setSelectedId(entry.syncId)} key={entry.syncId}><span>{index + 1}</span><img src={entry.imageUrl ?? '/domidex-logo.jpg'} alt="" /><div><b>{entry.name}</b><small>{entry.setName} · {entry.finish}</small></div><strong>{formatPrice(prices[entry.syncId]! * entry.quantity)}</strong></button>)}</div> : <Empty title="Noch keine bepreisten Karten" text="Nur eindeutig zugeordnete Cardmarket-Werte werden berücksichtigt." />}</section>
    </div>
    {selected && <CardDialog key={selected.syncId} entry={selected} price={prices[selected.syncId]} priceSource={priceSources[selected.syncId]} selection={selections[selected.syncId]} busy={false} onClose={() => setSelectedId(null)} />}
  </div>;
}

export function BinderView({ binders, entries = binders.flatMap((item) => item.entries), prices, priceSources = {}, selections = {}, user, onError }: { binders: BinderGroup[]; entries?: CollectionEntry[]; prices: Record<string, number | null>; priceSources?: Record<string, CollectionPriceResult['source']>; selections?: Record<string, CollectionPriceSelection>; user: NonNullable<ReturnType<typeof useAuth>['user']>; onError: (value: string) => void }) {
  const [binderId, setBinderId] = useState<string | null>(null); const [page, setPage] = useState(0); const [open, setOpen] = useState(false); const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [setCards, setSetCards] = useState<TcgCardSummary[]>([]); const [printedTotal, setPrintedTotal] = useState(0); const [setLoading, setSetLoading] = useState(false); const [slotSort, setSlotSort] = useState<SetBinderSlotSort>('number_asc'); const [onlyMissing, setOnlyMissing] = useState(false);
  const [overviewSort, setOverviewSort] = useState<SetBinderOverviewSort>('name_asc');
  const [lastOpenedById, setLastOpenedById] = useState<Record<string, number>>({});
  const [catalogBySet, setCatalogBySet] = useState<Record<string, { cards: TcgCardSummary[]; official: number; releaseDate: string | null }>>({});
  const sourceSetKey = useMemo(() => [...new Set(binders.map((item) => item.sourceSetId?.trim().toLowerCase()).filter((id): id is string => Boolean(id)))].sort().join('|'), [binders]);
  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('domidex:set-binder-overview') ?? '{}') as { sort?: SetBinderOverviewSort; lastOpened?: Record<string, number> };
      const allowed: SetBinderOverviewSort[] = ['last_opened', 'last_added', 'newest_set', 'oldest_set', 'name_asc', 'name_desc', 'progress_desc', 'progress_asc', 'collected_desc', 'collected_asc', 'missing_desc', 'missing_asc'];
      if (allowed.includes(parsed.sort ?? 'name_asc')) setOverviewSort(parsed.sort ?? 'name_asc');
      if (parsed.lastOpened && typeof parsed.lastOpened === 'object') setLastOpenedById(Object.fromEntries(Object.entries(parsed.lastOpened).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0)));
    } catch { /* local preference is optional */ }
  }, []);
  useEffect(() => {
    let active = true;
    const ids = sourceSetKey ? sourceSetKey.split('|') : [];
    void (async () => {
      for (let start = 0; start < ids.length; start += 4) {
        const resolved = await Promise.all(ids.slice(start, start + 4).map(async (id) => {
          try { const set = await loadSet(id); return [id, { cards: set.cards ?? [], official: set.cardCount?.official ?? 0, releaseDate: set.releaseDate ?? null }] as const; } catch { return null; }
        }));
        if (!active) return;
        const available = resolved.filter((item): item is readonly [string, { cards: TcgCardSummary[]; official: number; releaseDate: string | null }] => item !== null);
        if (available.length) setCatalogBySet((current) => ({ ...current, ...Object.fromEntries(available) }));
      }
    })();
    return () => { active = false; };
  }, [sourceSetKey]);
  const overviewRecords = useMemo(() => binders.map((item) => {
    const metadata = item.sourceSetId ? catalogBySet[item.sourceSetId.trim().toLowerCase()] : undefined;
    if (!metadata) return { ...item, lastOpenedAt: lastOpenedById[item.id] ?? null, releaseDate: null, collectedSlots: null, totalSlots: null };
    const slots = buildBinderSlots(metadata.cards, item.entries, metadata.official);
    return { ...item, lastOpenedAt: lastOpenedById[item.id] ?? null, releaseDate: metadata.releaseDate, collectedSlots: slots.filter((slot) => slot.owned.length > 0).length, totalSlots: slots.length || metadata.official };
  }), [binders, catalogBySet, lastOpenedById]);
  const orderedBinders = useMemo(() => orderSetBinderOverview(overviewRecords, overviewSort), [overviewRecords, overviewSort]);
  const binder = orderedBinders.find((item) => item.id === binderId) ?? orderedBinders[0];
  const selectedBinderId = binder?.id;
  useEffect(() => { if (binder && binderId !== binder.id) setBinderId(binder.id); }, [binder, binderId]);
  useEffect(() => { setPage(0); setOpen(false); setSelectedSlotId(null); }, [selectedBinderId]);
  useEffect(() => {
    if (!selectedBinderId) return;
    const openedAt = Date.now();
    setLastOpenedById((current) => {
      const next = { ...current, [selectedBinderId]: openedAt };
      try { localStorage.setItem('domidex:set-binder-overview', JSON.stringify({ sort: overviewSort, lastOpened: next })); } catch { /* local preference is optional */ }
      return next;
    });
  }, [selectedBinderId, overviewSort]);
  useEffect(() => {
    if (!selectedBinderId) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`domidex:set-binder-view:${selectedBinderId}`) ?? '{}') as { sort?: SetBinderSlotSort; onlyMissing?: boolean };
      const allowed: SetBinderSlotSort[] = ['number_asc', 'number_desc', 'name_asc', 'name_desc', 'last_added', 'value_desc', 'value_asc', 'variant_asc', 'variant_desc'];
      setSlotSort(allowed.includes(saved.sort ?? 'number_asc') ? saved.sort! : 'number_asc'); setOnlyMissing(saved.onlyMissing === true);
    } catch { setSlotSort('number_asc'); setOnlyMissing(false); }
  }, [selectedBinderId]);
  useEffect(() => {
    let active = true; setSetCards([]); setPrintedTotal(0); setSetLoading(false); if (!binder?.sourceSetId) return;
    setSetLoading(true); void loadSet(binder.sourceSetId).then((set) => { if (active) { setSetCards(set.cards ?? []); setPrintedTotal(set.cardCount?.official ?? 0); } }).catch(() => { if (active) onError('Das vollständige Set konnte nicht geladen werden. Der vorhandene Bestand bleibt sichtbar.'); }).finally(() => { if (active) setSetLoading(false); });
    return () => { active = false; };
  }, [binder?.sourceSetId, onError]);
  if (!binder) return <div className="app-view"><div className="view-title"><div><p>BINDER</p><h1>Deine Binder.</h1></div></div><Empty title="Noch kein Set-Binder" text="Füge eine Karte hinzu oder blende eine gesammelte Karte im Set-Binder ein." /><PrivateBinderGallery user={user} entries={entries} prices={prices} /><BinderSharingOwner key={user.uid} user={user} /></div>;
  const summaries = setCards.length ? setCards : binder.entries.map((entry) => ({ id: entry.sourceCardId ?? entry.syncId, localId: entry.collectorNumber, name: entry.name, rarity: entry.rarity, image: entry.imageUrl ?? undefined }));
  const slots = buildBinderSlots(summaries, binder.entries, printedTotal); const displayedSlots = orderBinderSlots(slots, slotSort, onlyMissing, prices); const pages = paginateBinderSlots(displayedSlots); const displayedPage = Math.min(page, Math.max(0, pages.length - 1)); const visible = pages[displayedPage] ?? []; const selected = selectedSlotId ? slots.find((slot) => slot.slotId === selectedSlotId) ?? null : null;
  const changePage = (nextPage: number) => { if (nextPage < 0 || nextPage >= pages.length) return; setPage(nextPage); };
  return <div className="app-view binder-view">
    <div className="view-title"><div><p>MASTER-SET BINDER</p><h1>{binder.name}</h1><span>{binder.entries.reduce((sum, entry) => sum + entry.quantity, 0)} Karten · {slots.filter((slot) => slot.owned.length).length}/{slots.length || binder.entries.length} Plätze · {formatKnownValuation(sumKnownPrices(binder.entries, prices))}</span></div><div className="binder-overview-controls"><label>Binder-Übersicht<select aria-label="Set-Binder Übersicht sortieren" value={overviewSort} onChange={(event) => { const sort = event.target.value as SetBinderOverviewSort; setOverviewSort(sort); try { localStorage.setItem('domidex:set-binder-overview', JSON.stringify({ sort, lastOpened: lastOpenedById })); } catch {} }}><option value="last_opened">Zuletzt verwendet</option><option value="last_added">Zuletzt hinzugefügt</option><option value="newest_set">Neueste Sets</option><option value="oldest_set">Älteste Sets</option><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option><option value="progress_desc">Fortschritt hoch → niedrig</option><option value="progress_asc">Fortschritt niedrig → hoch</option><option value="collected_desc">Meiste gesammelt</option><option value="collected_asc">Wenigste gesammelt</option><option value="missing_desc">Meiste fehlend</option><option value="missing_asc">Wenigste fehlend</option></select></label><select aria-label="Binder auswählen" value={binder.id} onChange={(event) => setBinderId(event.target.value)}>{orderedBinders.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div></div>
    <div className="binder-view-controls" aria-label="Set-Binder sortieren und filtern"><label>Sortierung<select aria-label="Set-Binder sortieren" value={slotSort} onChange={(event) => { const sort = event.target.value as SetBinderSlotSort; setSlotSort(sort); setPage(0); try { localStorage.setItem(`domidex:set-binder-view:${binder.id}`, JSON.stringify({ sort, onlyMissing })); } catch {} }}><option value="number_asc">Kartennummer ↑</option><option value="number_desc">Kartennummer ↓</option><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option><option value="last_added">Zuletzt hinzugefügt</option><option value="value_desc">Höchster Kartenwert</option><option value="value_asc">Niedrigster Kartenwert</option><option value="variant_asc">Variante A–Z</option><option value="variant_desc">Variante Z–A</option></select></label><label><input aria-label="Nur fehlende Karten" type="checkbox" checked={onlyMissing} onChange={(event) => { const enabled = event.target.checked; setOnlyMissing(enabled); setPage(0); try { localStorage.setItem(`domidex:set-binder-view:${binder.id}`, JSON.stringify({ sort: slotSort, onlyMissing: enabled })); } catch {} }} /> Nur fehlende Karten</label></div>
    <section className={`interactive-binder ${open ? 'is-open' : ''}`}>
      {!open ? <button className="binder-cover" onClick={() => setOpen(true)}><img src="/domidex-logo.jpg" alt="" /><small>DOMIDEX BINDER</small><strong>{binder.name}</strong><span>Öffnen</span></button> : <>
        {setLoading ? <div className="binder-set-loading"><LoaderCircle className="spin" /><span>Alle Set-Karten werden geladen …</span></div> : <div className="binder-book"><div className="pocket-page">{[0,1,2,3].map((slot) => <BinderPocket slot={visible[slot]} onSelect={(item) => setSelectedSlotId(item.slotId)} key={visible[slot]?.slotId ?? slot} />)}</div><div className="binder-spine"><i/><i/><i/><i/></div><div className="pocket-page">{[4,5,6,7].map((slot) => <BinderPocket slot={visible[slot]} onSelect={(item) => setSelectedSlotId(item.slotId)} key={visible[slot]?.slotId ?? slot} />)}</div></div>}
        <div className="page-controls"><button aria-label="Vorherige Binderseite" disabled={displayedPage === 0} onClick={() => changePage(displayedPage - 1)}><ChevronLeft /></button><span>Seite {displayedPage + 1} / {Math.max(1, pages.length)}</span><button aria-label="Nächste Binderseite" disabled={displayedPage >= pages.length - 1} onClick={() => changePage(displayedPage + 1)}><ChevronRight /></button><button className="close-binder" onClick={() => setOpen(false)}>Binder schließen</button></div>
      </>}
    </section>
    {selected && <BinderCardDialog slot={selected} entries={entries} prices={prices} priceSources={priceSources} selections={selections} user={user} busy={busy} setBusy={setBusy} onClose={() => setSelectedSlotId(null)} onError={onError} />}
    <PrivateBinderGallery user={user} entries={entries} prices={prices} />
    <BinderSharingOwner key={user.uid} user={user} />
  </div>;
}

export function CollectionView({ entries, prices, priceSources = {}, selections = {}, user, onError }: { entries: CollectionEntry[]; prices: Record<string, number | null>; priceSources?: Record<string, CollectionPriceResult['source']>; selections?: Record<string, CollectionPriceSelection>; user: NonNullable<ReturnType<typeof useAuth>['user']>; onError: (value: string) => void }) {
  const [query, setQuery] = useState(''); const [selectedId, setSelectedId] = useState<string | null>(null); const [busy, setBusy] = useState(false); const selected = selectedId ? entries.find((entry) => entry.syncId === selectedId) ?? null : null;
  const filtered = useMemo(() => sortedCollection(entries, prices, query), [entries, prices, query]);
  const mutate = async (entry: CollectionEntry, delta: number) => { setBusy(true); try { await changeQuantity(user, entry, delta); if (delta < 0 && entry.quantity === 1) setSelectedId(null); } catch { onError('Die Kartenmenge konnte nicht aktualisiert werden.'); } finally { setBusy(false); } };
  return <div className="app-view"><div className="view-title"><div><p>SAMMLUNG</p><h1>Alle Karten.</h1><span>{entries.reduce((sum, entry) => sum + entry.quantity, 0)} Karten in {new Set(entries.map((entry) => entry.setName)).size} Sets</span></div><label className="search-field"><Search /><input aria-label="Sammlung durchsuchen" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sammlung durchsuchen" /></label></div>{filtered.length ? <WindowedCollectionGrid entries={filtered} onSelect={setSelectedId} renderCard={(entry) => <CardTile entry={entry} price={prices[entry.syncId]} />} /> : <Empty title="Keine Karten gefunden" text="Passe deine Suche an oder füge eine neue Karte hinzu." />}{selected && <CardDialog entry={selected} price={prices[selected.syncId]} priceSource={priceSources[selected.syncId]} selection={selections[selected.syncId]} user={user} onError={onError} busy={busy} onClose={() => setSelectedId(null)} onChange={mutate} />}</div>;
}

type CardAddUser = NonNullable<ReturnType<typeof useAuth>['user']>;
type PendingCardPrice = { user: CardAddUser; ownerUid: string; syncId: string; cardName: string; candidate: AlternativePriceCandidate };
type CardAddScope = { identity: string; active: boolean; inFlight: boolean; pending: PendingCardPrice | null };

/** A committed collection write is never retried to repair its optional sidecar. */
function useCardAddition({ user, card, variant, entries, context, onError, onSuccess, onBusy }: {
  user: CardAddUser; card: TcgCardDetail | null; variant?: TcgVariant; entries: CollectionEntry[];
  context: string; onError: (message: string) => void; onSuccess: (name: string) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const identity = JSON.stringify([user.uid, context, card?.id, variant?.variantId, variant?.type,
    variant && collectionVariantLabel(variant), card && variant && exactCardmarketProductId(card, variant)]);
  const scope = useMemo<CardAddScope>(() => ({ identity, active: false, inFlight: false, pending: null }), [identity]);
  const [busyScope, setBusyScope] = useState<CardAddScope | null>(null);
  const [pendingState, setPendingState] = useState<{ scope: CardAddScope; failed: boolean } | null>(null);
  // Invalidate before a newly committed account/card context can receive old results.
  useLayoutEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.pending = null;
      if (scope.inFlight) { scope.inFlight = false; onBusy?.(false); }
    };
  }, [scope, onBusy]);
  const start = () => { scope.inFlight = true; setBusyScope(scope); onBusy?.(true); };
  const finish = () => {
    if (!scope.active) return;
    scope.inFlight = false; setBusyScope(null); onBusy?.(false);
  };
  const savePending = async (target: PendingCardPrice) => {
    setPendingState({ scope, failed: false });
    try {
      await saveCollectionPriceSelection(target.user, target.syncId, target.candidate);
      if (!scope.active) return;
      scope.pending = null; setPendingState(null); onSuccess(target.cardName);
    } catch {
      if (scope.active) setPendingState({ scope, failed: true });
    }
  };
  const add = async (quantity: number, candidate: AlternativePriceCandidate | null) => {
    if (!scope.active || scope.inFlight || scope.pending || !card || !variant) return;
    start();
    try {
      const syncId = collectionSyncIdForExactCard(user.uid, card, variant, entries);
      await addExactCard(user, card, variant, quantity, entries);
      if (!scope.active) return;
      if (candidate) {
        const target = { user, ownerUid: user.uid, syncId, cardName: card.name, candidate: { ...candidate } };
        scope.pending = target;
        await savePending(target);
      } else onSuccess(card.name);
    } catch (error) {
      if (scope.active) onError(error instanceof Error ? error.message : 'Karte konnte nicht hinzugefügt werden.');
    } finally { finish(); }
  };
  const retry = async () => {
    const target = scope.pending;
    if (!scope.active || scope.inFlight || !target || target.ownerUid !== user.uid) return;
    start();
    try { await savePending(target); } finally { finish(); }
  };
  return {
    add, retry, busy: busyScope === scope,
    pending: pendingState?.scope === scope && scope.pending ? { failed: pendingState.failed } : null,
  };
}

function PendingCardPriceNotice({ failed, busy, onRetry }: { failed: boolean; busy: boolean; onRetry: () => void }) {
  return <section className="price-alternative-picker" aria-label="Ausstehende Preisauswahl">
    <p role="status">{failed ? 'Karte wurde hinzugefügt. Die Preisauswahl konnte nicht gespeichert werden.' : 'Karte wurde hinzugefügt. Die Preisauswahl wird gespeichert …'}</p>
    <small>Die Kartenmenge bleibt erhalten. Erneut speichern wiederholt nur die Preisauswahl.</small>
    <button type="button" disabled={busy} onClick={onRetry}>Preisauswahl erneut speichern</button>
  </section>;
}

function SearchView({ entries, user, onError }: { entries: CollectionEntry[]; user: NonNullable<ReturnType<typeof useAuth>['user']>; onError: (value: string) => void }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectionGeneration, setSelectionGeneration] = useState(0);
  const [query, setQuery] = useState(''); const [results, setResults] = useState<TcgCardSummary[]>([]); const [card, setCard] = useState<TcgCardDetail | null>(null); const [variantIndex, setVariantIndex] = useState(0); const [quantity, setQuantity] = useState(1); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [fallbackCandidate, setFallbackCandidate] = useState<AlternativePriceCandidate | null>(null);
  const variants = card ? cardVariantsForSelection(card) : [];
  const variant = variants[variantIndex] ?? variants[0]; const price = card && variant ? exactTrendPrice(card, variant) : null;
  const addition = useCardAddition({ user, card, variant, entries, context: `${selectionGeneration}:${variantIndex}`, onError,
    onSuccess: (name) => setMessage(`${name} wurde synchronisiert.`) });
  const adding = busy || addition.busy;
  useEffect(() => { setFallbackCandidate(null); setMessage(''); }, [card?.id, variantIndex, selectionGeneration, user.uid]);
  const search = async () => { setSelectionGeneration((value) => value + 1); setBusy(true); setMessage(''); try { setResults(await searchCards(query)); setCard(null); } catch (error) { onError(error instanceof Error ? error.message : 'Kartensuche fehlgeschlagen.'); } finally { setBusy(false); } };
  const choose = async (summary: TcgCardSummary) => { setSelectionGeneration((value) => value + 1); setBusy(true); setMessage(''); try { setCard(await loadCard(summary.id)); setVariantIndex(0); setQuantity(1); } catch (error) { onError(error instanceof Error ? error.message : 'Kartendetails fehlen.'); } finally { setBusy(false); } };
  const add = () => { setMessage(''); return addition.add(quantity, price === null ? fallbackCandidate : null); };
  return <div className="app-view"><div className="view-title"><div><p>MANUELL HINZUFÜGEN</p><h1>Karte suchen.</h1><span>Set, Karte, Variante und Menge – der Scanner bleibt in der Android-App.</span></div></div><div className="search-layout"><section className="panel search-panel"><form onSubmit={(event) => { event.preventDefault(); void search(); }}><label className="search-field large"><Search /><input aria-label="Kartenname suchen" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kartenname, z. B. Glurak" /><button disabled={adding || query.trim().length < 2}>{adding ? <LoaderCircle className="spin" /> : 'Suchen'}</button></label></form><div className="search-results">{results.map((result) => <button className={card?.id === result.id ? 'active' : ''} onClick={() => void choose(result)} key={result.id}><div className="mini-card">{result.image ? <img src={imageUrl(result.image, 'low') ?? ''} alt={result.name} loading="lazy" /> : <span className="image-unavailable"><ImageOff /><small>Kein offizielles Bild</small></span>}</div><div><b>{result.name}</b><small>#{result.localId} · {result.id}</small></div><ChevronRight /></button>)}</div>{!results.length && !adding && <Empty title="Suche im deutschen Kartenkatalog" text="Geprüfte Karten aus TCGdex und dem ergänzten DomiDex-Katalog." />}</section><section className="panel card-add-panel">{card && variant ? <><div className="selected-card"><button className="selected-card-image card-open" aria-label={`Karte groß ansehen: ${card.name}`} onClick={() => setPreviewOpen(true)}>{card.image ? <img src={imageUrl(card.image) ?? ''} alt={card.name} /> : <span className="image-unavailable large"><ImageOff /><small>Kein offizielles Bild verfügbar</small></span>}</button><div><p>{card.set.name}</p><h2>{card.name}</h2><span>#{card.localId} · {card.rarity ?? 'Seltenheit unbekannt'}</span></div></div><label>Variante<select value={variantIndex} onChange={(event) => setVariantIndex(Number(event.target.value))}>{variants.map((item, index) => <option value={index} key={`${item.variantId ?? item.type}-${collectionVariantLabel(item)}-${index}`}>{item.type} · {collectionVariantLabel(item)}</option>)}</select></label><div className="add-price"><span>Cardmarket Trendpreis</span><strong>{price === null ? 'Preis nicht verfügbar' : formatPrice(price)}</strong><small>{price === null ? 'Keine eindeutige Trendpreis-Zuordnung für diese Variante.' : `Exakte Quelle · Produkt ${exactCardmarketProductId(card, variant)}`}</small></div>{price === null && !addition.pending && <PriceAlternativePicker key={`${user.uid}-${selectionGeneration}-${card.id}-${variantIndex}`} card={card} variant={variant} disabled={adding} confirmLabel="Fürs Hinzufügen auswählen" successLabel="Für diese Karte vorgemerkt; gespeichert wird beim Hinzufügen." onConfirm={setFallbackCandidate} onError={onError} />}<label>Menge<div className="stepper"><button onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus /></button><output>{quantity}</output><button onClick={() => setQuantity((value) => Math.min(100, value + 1))}><Plus /></button></div></label>{addition.pending ? <PendingCardPriceNotice failed={addition.pending.failed} busy={addition.busy} onRetry={() => void addition.retry()} /> : <button className="add-card-button" disabled={adding} onClick={() => void add()}>{adding ? <LoaderCircle className="spin" /> : <Plus />} Zur Sammlung hinzufügen</button>}{message && <p className="success-message">✓ {message}</p>}</> : <Empty title="Wähle eine Karte" text="Danach erscheinen die tatsächlich gemeldeten Varianten und der passende Cardmarket-Preis." />}</section></div>{previewOpen && card && variant && <CardArtDialog key={`${card.id}-${variantIndex}`} image={imageUrl(card.image)} name={card.name} finish={variant.type} rarity={card.rarity} variant={collectionVariantLabel(variant)} onClose={() => setPreviewOpen(false)} />}</div>;
}

function Portfolio({ entries, prices, total, pricedCount, totalCount }: { entries: CollectionEntry[]; prices: Record<string, number | null>; total: number; pricedCount: number; totalCount: number }) {
  const groups = Object.entries(entries.reduce<Record<string, { value: number; cards: number; priced: number }>>((result, entry) => { const current = result[entry.setName] ?? { value: 0, cards: 0, priced: 0 }; const part = sumKnownPrices([entry], prices); current.cards += part.quantity; current.value += part.value; current.priced += part.priced; result[entry.setName] = current; return result; }, {})).sort((a,b) => b[1].value-a[1].value);
  return <div className="app-view"><div className="view-title"><div><p>PORTFOLIO</p><h1>{pricedCount || !totalCount ? formatPrice(total) : 'Preis nicht verfügbar'}</h1><span>{pricedCount < totalCount ? 'Teilbewertung: ' : ''}Trendpreise werden bevorzugt; bewusst bestätigte Cardmarket-Ersatzkennzahlen ergänzen fehlende Trends.</span></div></div><div className="portfolio-layout"><section className="panel portfolio-total"><span>BEWERTETER BESTAND</span><strong>{pricedCount} / {totalCount}</strong><div className="price-ring" style={{ '--progress': `${totalCount ? pricedCount/totalCount*360 : 0}deg` } as React.CSSProperties}><b>{totalCount ? Math.round(pricedCount/totalCount*100) : 0}%</b></div><p>Unbepreiste Karten werden transparent ausgeschlossen – niemals mit erfundenen 0 € verrechnet.</p></section><section className="panel"><PanelTitle title="Wert nach Set" />{groups.length ? <div className="set-values">{groups.map(([name, group]) => <div key={name}><div><b>{name}</b><small>{group.cards} Karten</small></div><strong>{formatKnownValuation({ ...group, quantity: group.cards })}</strong><span><i style={{ width: `${total ? Math.max(2,group.value/total*100) : 2}%` }} /></span></div>)}</div> : <Empty title="Noch keine Portfoliodaten" text="Füge Karten hinzu, um den echten Set-Wert zu sehen." />}</section></div></div>;
}

function SettingsView({ userName, onLogout }: { userName: string; onLogout: () => void }) { return <div className="app-view"><div className="view-title"><div><p>EINSTELLUNGEN</p><h1>Dein DomiDex.</h1></div></div><section className="panel settings-list"><div><CircleUserRound /><span><b>{userName}</b><small>Firebase-/Google-Konto</small></span><ShieldCheck /></div><div><Sparkles /><span><b>Design</b><small>Dunkel · DomiDex Violet</small></span></div><div><BadgeEuro /><span><b>Preise</b><small>Cardmarket Trend bevorzugt · Ersatzkennzahl nur nach deiner Bestätigung</small></span></div><a href="/datenschutz">Datenschutz</a><a href="/konto-loeschen">Informationen zur Kontolöschung</a><a href="/account/delete">Konto und Cloud-Daten löschen</a><button onClick={onLogout}><LogOut /> Abmelden</button></section></div>; }

function BinderCardDialog({ slot, entries, prices, priceSources, selections, user, busy, setBusy, onClose, onError }: { slot: BinderSlot; entries: CollectionEntry[]; prices: Record<string, number | null>; priceSources: Record<string, CollectionPriceResult['source']>; selections: Record<string, CollectionPriceSelection>; user: NonNullable<ReturnType<typeof useAuth>['user']>; busy: boolean; setBusy: (value: boolean) => void; onClose: () => void; onError: (value: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [ownedIndex, setOwnedIndex] = useState(0); const owned = slot.owned[Math.min(ownedIndex, Math.max(0, slot.owned.length - 1))]; const [card, setCard] = useState<TcgCardDetail | null>(null); const [loading, setLoading] = useState(true); const [fallbackCandidate, setFallbackCandidate] = useState<AlternativePriceCandidate | null>(null);
  useEffect(() => { let active = true; setLoading(true); setCard(null); void loadCard(canonicalTcgCardId(slot.card.id)).then((value) => { if (active) setCard(value); }).catch(() => { if (active) onError('Kartendetails konnten nicht geladen werden.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [onError, slot.card.id]);
  useEffect(() => { setFallbackCandidate(null); }, [slot.slotId, card?.id, user.uid]);
  const variants = card ? cardVariantsForSelection(card) : [];
  const variant = variantForBinderSlot(variants, slot); const price = card && variant ? exactTrendPrice(card, variant) : null;
  const addition = useCardAddition({ user, card, variant, entries, context: slot.slotId, onError,
    onSuccess: onClose, onBusy: setBusy });
  if (owned && !addition.pending && !addition.busy) {
    const mutate = async (entry: CollectionEntry, delta: number) => { setBusy(true); try { await changeQuantity(user, entry, delta); if (delta < 0 && entry.quantity === 1) onClose(); } catch { onError('Die Kartenmenge konnte nicht aktualisiert werden.'); } finally { setBusy(false); } };
    return <CardDialog entry={owned} price={prices[owned.syncId]} priceSource={priceSources[owned.syncId]} selection={selections[owned.syncId]} user={user} onError={onError} alternatives={slot.owned} selectedIndex={ownedIndex} onSelect={setOwnedIndex} busy={busy} onClose={onClose} onChange={mutate} />;
  }
  const add = () => addition.add(1, price === null ? fallbackCandidate : null);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className={`card-dialog missing-card-dialog ${expanded ? 'card-dialog--expanded' : ''}`} role="dialog" aria-modal="true" aria-labelledby="binder-card-title"><ModalFocus onClose={onClose} /><button className="dialog-close" onClick={onClose} aria-label="Schließen"><X /></button><div className="dialog-card-image"><CardShowcase key={slot.slotId} image={imageUrl(card?.image ?? slot.card.image, 'high')} name={card?.name ?? slot.card.name} finish={slot.finish} rarity={card?.rarity ?? slot.card.rarity} variant={slot.variant} expanded={expanded} onExpand={() => setExpanded((value) => !value)} /></div><div className="dialog-card-info"><p>{card?.set.name ?? 'Set-Karte'} · {addition.pending || owned ? 'HINZUGEFÜGT' : 'NICHT IM BESITZ'}</p><h2 id="binder-card-title">{card?.name ?? slot.card.name}</h2><span>#{card?.localId ?? slot.card.localId} · {card?.rarity ?? slot.card.rarity ?? 'Seltenheit nicht angegeben'}</span>{loading ? <div className="binder-detail-loading"><LoaderCircle className="spin" /> Kartendaten werden geladen …</div> : <><div className="binder-print-identity"><span>Variante</span><strong>{slot.finish} · {slot.variant}</strong></div><dl><div><dt>Besitzstatus</dt><dd>{addition.pending || owned ? 'Karte hinzugefügt' : 'Fehlt im Binder'}</dd></div><div><dt>Cardmarket Trend</dt><dd>{price === null ? 'Preis nicht verfügbar' : formatPrice(price)}</dd></div></dl>{price === null && card && variant && !addition.pending && <PriceAlternativePicker key={`${user.uid}-${slot.slotId}-${variant.variantId ?? variant.type}`} card={card} variant={variant} disabled={busy} confirmLabel="Fürs Hinzufügen auswählen" successLabel="Für diese Karte vorgemerkt; gespeichert wird beim Hinzufügen." onConfirm={setFallbackCandidate} onError={onError} />}{addition.pending ? <PendingCardPriceNotice failed={addition.pending.failed} busy={addition.busy} onRetry={() => void addition.retry()} /> : <button className="binder-add-button" disabled={busy || !variant} onClick={() => void add()}>{busy ? <LoaderCircle className="spin" /> : <Plus />} Zur Sammlung hinzufügen</button>}</>}</div></section></div>;
}

function CardDialog({ entry, price, priceSource, selection, user, onError, alternatives, selectedIndex = 0, onSelect, busy, onClose, onChange }: { entry: CollectionEntry; price: number | null | undefined; priceSource?: CollectionPriceResult['source']; selection?: CollectionPriceSelection; user?: NonNullable<ReturnType<typeof useAuth>['user']>; onError?: (value: string) => void; alternatives?: CollectionEntry[]; selectedIndex?: number; onSelect?: (index: number) => void; busy: boolean; onClose: () => void; onChange?: (entry: CollectionEntry, delta: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className={`card-dialog ${expanded ? 'card-dialog--expanded' : ''}`} role="dialog" aria-modal="true" aria-labelledby="card-title">
      <ModalFocus onClose={onClose} />
      <button className="dialog-close" onClick={onClose} aria-label="Schließen"><X /></button>
      <div className="dialog-card-image"><CardShowcase key={entry.syncId} sourceCardId={entry.sourceCardId} sourceSetId={entry.sourceSetId} collectorNumber={entry.collectorNumber} image={entry.imageUrl} name={entry.name} finish={entry.finish} rarity={entry.rarity} variant={entry.variant} effectOverride={entry.effectOverride} expanded={expanded} onExpand={() => setExpanded((value) => !value)} /></div>
      <div className="dialog-card-info">
        <p>{entry.setName}</p><h2 id="card-title">{entry.name}</h2><span>#{entry.collectorNumber} · {entry.language === 'GERMAN' ? 'Deutsch' : entry.language}</span>
        {alternatives && alternatives.length > 1 && onSelect && <label className="binder-variant"><span>Gesammelte Variante</span><select value={selectedIndex} onChange={(event) => onSelect(Number(event.target.value))}>{alternatives.map((item, index) => <option value={index} key={item.syncId}>{item.finish} · {item.variant}</option>)}</select></label>}
        <dl>
          <div><dt>Variante</dt><dd>{entry.finish} · {entry.variant}</dd></div>
          <div><dt>Zustand</dt><dd>{entry.condition || 'Nicht angegeben'}</dd></div>
          <div><dt>{priceSource === 'manual' ? 'Cardmarket Auswahl' : 'Cardmarket Trend'}</dt><dd><PriceText entry={entry} price={price} /></dd></div>
          <div><dt>Gesamtwert</dt><dd>{typeof price === 'number' ? formatPrice(price * entry.quantity) : 'Preis nicht verfügbar'}</dd></div>
        </dl>
        {(priceSource !== 'trend' || (selection && !selection.cleared)) && user && onError && <OwnedPriceAlternative entry={entry} selection={selection} user={user} disabled={busy} onError={onError} />}
        {priceSource === 'manual' && (!user || !onError) && selection?.metric && <p className="card-view-only">Manuell bestätigt: {collectionPriceMetricLabel(selection.metric)}</p>}
        {onChange ? <div className="dialog-actions"><button aria-label={entry.quantity === 1 ? 'Karte entfernen' : 'Menge verringern'} disabled={busy} onClick={() => onChange(entry,-1)}>{entry.quantity === 1 ? <Trash2 /> : <Minus />}</button><output>{entry.quantity}</output><button aria-label="Menge erhöhen" disabled={busy} onClick={() => onChange(entry,1)}><Plus /></button></div> : <p className="card-view-only">{entry.quantity} × in deiner Sammlung · Nur Ansicht</p>}
      </div>
    </section>
  </div>;
}

function OwnedPriceAlternative({ entry, selection, user, disabled, onError }: { entry: CollectionEntry; selection?: CollectionPriceSelection; user: NonNullable<ReturnType<typeof useAuth>['user']>; disabled: boolean; onError: (value: string) => void }) {
  const [card, setCard] = useState<TcgCardDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true; setCard(null); setLoaded(false);
    if (!entry.sourceCardId) { setLoaded(true); return; }
    void loadCard(canonicalTcgCardId(entry.sourceCardId)).then((value) => { if (active) setCard(value); }).catch(() => { if (active) onError('Die alternativen Cardmarket-Preise konnten nicht geladen werden.'); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [entry.sourceCardId, onError]);
  const clear = () => clearCollectionPriceSelection(user, entry.syncId);
  if (!card) return loaded && selection && !selection.cleared ? <section className="price-alternative-picker" aria-label="Gespeicherte Cardmarket-Preiskennzahl"><small>Die gespeicherte Ersatzkennzahl passt nicht mehr zu verfügbaren Kartendaten.</small><button type="button" className="price-alternative-clear" disabled={disabled} onClick={() => void clear().catch((error) => onError(error instanceof Error ? error.message : 'Die Preiskennzahl konnte nicht entfernt werden.'))}>Gespeicherte Auswahl entfernen</button></section> : null;
  const variant = variantForCollectionEntry(card, entry);
  if (!variant) return selection && !selection.cleared ? <section className="price-alternative-picker" aria-label="Gespeicherte Cardmarket-Preiskennzahl"><small>Die gespeicherte Ersatzkennzahl passt nicht mehr zur aktuellen Kartenvariante.</small><button type="button" className="price-alternative-clear" disabled={disabled} onClick={() => void clear().catch((error) => onError(error instanceof Error ? error.message : 'Die Preiskennzahl konnte nicht entfernt werden.'))}>Gespeicherte Auswahl entfernen</button></section> : null;
  if (exactTrendPrice(card, variant) !== null) return selection && !selection.cleared ? <section className="price-alternative-picker" aria-label="Gespeicherte Cardmarket-Preiskennzahl"><small>Der verfügbare Trendpreis wird für die Bewertung verwendet.</small><button type="button" className="price-alternative-clear" disabled={disabled} onClick={() => void clear().catch((error) => onError(error instanceof Error ? error.message : 'Die Preiskennzahl konnte nicht entfernt werden.'))}>Gespeicherte Auswahl entfernen</button></section> : null;
  return <PriceAlternativePicker card={card} variant={variant} selection={selection} disabled={disabled} onConfirm={(candidate) => saveCollectionPriceSelection(user, entry.syncId, candidate)} onClear={clear} onError={onError} />;
}

function CardArtDialog({ image, name, finish, rarity, variant, onClose }: { image: string | null; name: string; finish: string; rarity?: string; variant?: string; onClose: () => void }) {
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="card-dialog card-dialog--expanded card-art-dialog" role="dialog" aria-modal="true" aria-labelledby="card-art-title">
      <ModalFocus onClose={onClose} /><button className="dialog-close" onClick={onClose} aria-label="Schließen"><X /></button>
      <div className="dialog-card-image"><CardShowcase image={image} name={name} finish={finish} rarity={rarity} variant={variant} expanded /></div>
      <div className="dialog-card-info"><p>KARTENANSICHT</p><h2 id="card-art-title">{name}</h2><span>{finish}</span><p className="card-view-only">Die Vorschau verändert weder Karte noch Variante.</p></div>
    </section>
  </div>;
}

function BinderPocket({ slot, onSelect }: { slot?: BinderSlot; onSelect: (slot: BinderSlot) => void }) { const owned = slot?.owned[0]; return <button className={`binder-pocket ${slot && !owned ? 'missing-card' : slot ? '' : 'empty-pocket'}`} disabled={!slot} onClick={() => slot && onSelect(slot)}>{slot ? <><img src={owned?.imageUrl ?? imageUrl(slot.card.image, 'low') ?? '/domidex-logo.jpg'} alt={slot.card.name} /><span>{owned ? `×${slot.owned.reduce((sum, entry) => sum + entry.quantity, 0)}` : `#${slot.card.localId}`}</span><small>{slot.finish}{!owned ? ' · fehlt' : ''}</small></> : <><b>—</b><small>Kein Kartenplatz</small></>}</button>; }

function CardTile({ entry, price }: { entry: CollectionEntry; price: number | null | undefined }) { return <article className="card-tile"><div>{entry.imageUrl ? <img src={collectionThumbnail(entry.imageUrl)} alt={entry.name} loading="lazy" decoding="async" /> : <img src="/domidex-logo.jpg" alt="" />}</div><p>{entry.setName}</p><h3>{entry.name}</h3><span>#{entry.collectorNumber} · {entry.finish}</span><strong><PriceText entry={entry} price={price} /></strong></article>; }
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
