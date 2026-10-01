'use client';

import {
  AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  Eye, EyeOff, Filter, ImageIcon, Layers3, LoaderCircle, Maximize2, Move, RefreshCw,
  RotateCw, Save, Search, ShieldCheck, Trash2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScannerProfileVersion, ScannerReference, ScannerZoneType } from '@/lib/scanner-profile';
import type { ScannerReport, ScanReportStatus } from '@/lib/scanner-report';
import { scannerFeedbackMessage } from '@/lib/scanner-feedback';

interface ReferenceResponse {
  connected: boolean;
  cards: ScannerReference[];
  total: number;
  page: number;
  pageSize: number;
  message?: string;
}

interface ReferenceSelection { reference: ScannerReference | null; variant: string | null; }

interface Props {
  reports: ScannerReport[];
  totalReports: number;
  hasMore: boolean;
  nextPageToken: string | null;
  loadingMore: boolean;
  selectedReportId: string | null;
  profiles: ScannerProfileVersion[];
  working: boolean;
  userToken: () => Promise<string>;
  reviewDirty: boolean;
  canDelete: boolean;
  canCalibrate: boolean;
  onReviewDirtyChange: (dirty: boolean) => void;
  onSelectReport: (id: string) => void;
  onRefresh: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  onSave: (report: ScannerReport, status: ScanReportStatus, note: string, selection?: ReferenceSelection) => Promise<void>;
  onOpenCalibration: (report: ScannerReport, reference: ScannerReference) => void;
  onReauthenticate?: () => Promise<void>;
}

type StatusFilter = 'ALL' | 'OPEN' | 'RESOLVED' | 'REJECTED';
type Decision = 'ACCEPTED' | 'AMBIGUOUS' | 'REJECTED' | 'UNKNOWN';
const pageSize = 12;
const statusLabels: Record<ScanReportStatus, string> = {
  NEW: 'Neu', IN_REVIEW: 'In Prüfung', RESOLVED: 'Gelöst', PROFILE_CHANGE_REQUIRED: 'Profiländerung nötig',
  CANDIDATE_TESTING: 'Kandidat wird geprüft', PUBLISHED: 'Übernommen', REJECTED: 'Verworfen',
};
const decisionLabels: Record<Decision, string> = { ACCEPTED: 'Eindeutig', AMBIGUOUS: 'Mehrdeutig', REJECTED: 'Nicht erkannt', UNKNOWN: 'Nicht übermittelt' };

export function ScannerReportWorkspace({ reports, totalReports, hasMore, nextPageToken, loadingMore, selectedReportId, profiles, working, userToken, reviewDirty, canDelete, canCalibrate, onReviewDirtyChange, onSelectReport, onRefresh, onLoadMore, onSave, onOpenCalibration, onReauthenticate }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [decisionFilter, setDecisionFilter] = useState<Decision | 'ALL'>('ALL');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | '7D'>('ALL');
  const [page, setPage] = useState(1);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<ScannerReport[]>([]);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [needsReauthentication, setNeedsReauthentication] = useState(false);
  const [reauthenticating, setReauthenticating] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const automaticPageAttempts = useRef(new Set<string>());

  const selectedReport = reports.find((report) => report.documentId === selectedReportId) ?? null;
  const filtered = useMemo(() => reports.filter((report) => reportMatches(report, search, statusFilter, decisionFilter, dateFilter)), [reports, search, statusFilter, decisionFilter, dateFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleReports = filtered.slice((page - 1) * pageSize, page * pageSize);
  const openReports = filtered.filter((report) => isOpenStatus(report.reviewStatus));
  const exhaustiveFilter = Boolean(search.trim() || statusFilter !== 'ALL' || decisionFilter !== 'ALL' || dateFilter !== 'ALL');
  const filterSignature = `${search.trim()}|${statusFilter}|${decisionFilter}|${dateFilter}`;

  useEffect(() => { setPage(1); }, [search, statusFilter, decisionFilter, dateFilter]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  useEffect(() => {
    if (!exhaustiveFilter || !nextPageToken || loadingMore) return;
    const attempt = `${filterSignature}|${nextPageToken}`;
    if (automaticPageAttempts.current.has(attempt)) return;
    automaticPageAttempts.current.add(attempt);
    void onLoadMore();
  }, [exhaustiveFilter, filterSignature, loadingMore, nextPageToken, onLoadMore]);

  const confirmNavigation = useCallback(() => {
    if (!reviewDirty) return true;
    if (!window.confirm('Ungespeicherte Review-Änderungen verwerfen?')) return false;
    onReviewDirtyChange(false);
    return true;
  }, [onReviewDirtyChange, reviewDirty]);

  const selectReport = useCallback((id: string) => {
    if (!confirmNavigation()) return;
    onSelectReport(id);
  }, [confirmNavigation, onSelectReport]);

  const refresh = useCallback(() => {
    if (confirmNavigation()) void onRefresh();
  }, [confirmNavigation, onRefresh]);

  const requestDelete = (targets: ScannerReport[]) => {
    if (!canDelete) return;
    setDeleteTargets(targets);
    setDeleteConfirmation('');
    setError('');
  };

  const confirmDelete = async () => {
    if (!canDelete || deleteConfirmation !== 'LÖSCHEN' || deleteTargets.length === 0) return;
    setDeleteWorking(true); setError(''); setNotice('');
    const failures: string[] = [];
    const remaining = new Set<string>();
    let removed = 0;
    try {
      const token = await userToken();
      for (const [index, report] of deleteTargets.entries()) {
        const response = await fetch('/api/admin/scan-reports', {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportId: report.documentId, confirm: `DELETE_SCAN_REPORT:${report.documentId}` }),
        });
        const result = await response.json() as { ok?: boolean; error?: string; imageDeleted?: boolean; reportDeleted?: boolean };
        if (!response.ok || !result.ok) {
          failures.push(`${shortId(report.documentId)}: ${deleteError(result.error)}`);
          remaining.add(report.documentId);
          if (result.error === 'RECENT_LOGIN_REQUIRED' || result.error === 'AUTH_REQUIRED') {
            setNeedsReauthentication(true);
            deleteTargets.slice(index).forEach(item => remaining.add(item.documentId));
            break; // Do not issue the same rejected request for every selected scan.
          }
        }
        else removed += 1;
      }
      setDeleteTargets([]); setDeleteConfirmation(''); setSelectedForDelete(remaining);
      await onRefresh();
      if (removed) setNotice(`${removed} Scan-Report${removed === 1 ? '' : 's'} entfernt. Zugeordnete Bilder wurden aus dem aktiven Speicher gelöscht; eine zeitlich begrenzte Provider-Aufbewahrung kann bestehen.`);
      if (failures.length) setError(`Nicht vollständig gelöscht: ${failures.join(' · ')} Bitte erneut prüfen; globale Scanner-Daten wurden nicht verändert.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Löschen konnte nicht abgeschlossen werden.');
      await onRefresh().catch(() => undefined);
    } finally { setDeleteWorking(false); }
  };

  const reauthenticateForDeletion = async () => {
    if (!canDelete || !onReauthenticate || reauthenticating) return;
    setReauthenticating(true); setError(''); setNotice('');
    try {
      await onReauthenticate();
      setNeedsReauthentication(false);
      setNotice('Google-Anmeldung bestätigt. Es wurde nichts automatisch gelöscht. Bitte die ausgewählten Scans prüfen und das Löschen erneut bestätigen.');
    } catch (reason) {
      const code = typeof reason === 'object' && reason && 'code' in reason ? String(reason.code) : '';
      setError(code.includes('popup-blocked') ? 'Bitte das Google-Anmeldefenster im Browser erlauben und erneut versuchen.'
        : code.includes('user-mismatch') ? 'Bitte dasselbe Google-Konto wie hier im Scanner Lab bestätigen.'
        : 'Google-Anmeldung nicht bestätigt. Es wurde nichts gelöscht. Bitte erneut versuchen.');
    } finally { setReauthenticating(false); }
  };

  const toggleVisibleSelection = () => {
    const allSelected = visibleReports.length > 0 && visibleReports.every((report) => selectedForDelete.has(report.documentId));
    setSelectedForDelete((current) => {
      const next = new Set(current);
      visibleReports.forEach((report) => allSelected ? next.delete(report.documentId) : next.add(report.documentId));
      return next;
    });
  };

  return <section className="sl-report-shell">
    <ol className="sl-review-guide" aria-label="So prüfst du einen Fehlscan">
      <li><b>1 · Foto ansehen</b><span>Wähle links einen Fehlscan und prüfe die Aufnahme.</span></li>
      <li><b>2 · Karte auswählen</b><span>Vergleiche die Karte mit dem Katalog. Suche bei Bedarf nach Set oder Nummer.</span></li>
      <li><b>3 · Ergebnis speichern</b><span>Bestätige die Karte oder speichere den Fall zur weiteren Prüfung.</span></li>
    </ol>
    <DashboardMetrics reports={reports} totalReports={totalReports} />
    {notice && <div className="sl-notice success"><CheckCircle2 />{notice}</div>}
    {error && <div className="sl-notice error"><AlertTriangle />{error}</div>}
    {canDelete && needsReauthentication && <div className="sl-notice"><ShieldCheck /><div><p>Zum sicheren Löschen muss deine Google-Anmeldung erneut bestätigt werden. Die noch nicht gelöschten Scans bleiben ausgewählt.</p>{onReauthenticate && <button className="primary" disabled={reauthenticating} onClick={() => void reauthenticateForDeletion()}>{reauthenticating ? 'Google-Anmeldung läuft …' : 'Google-Anmeldung bestätigen'}</button>}</div></div>}
    <div className="sl-toolbar">
      <label className="sl-search"><Search /><span className="sr-only">Fehlscans durchsuchen</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, Set, Nummer oder Scan-ID suchen" /></label>
      <label><Filter /><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="ALL">Alle Status</option><option value="OPEN">Offen</option><option value="RESOLVED">Gelöst</option><option value="REJECTED">Verworfen</option></select></label>
      <label><CircleHelp /><span>Ergebnis</span><select value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value as Decision | 'ALL')}><option value="ALL">Alle Ergebnisse</option>{Object.entries(decisionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label><Clock3 /><span>Zeitraum</span><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as 'ALL' | 'TODAY' | '7D')}><option value="ALL">Gesamter Zeitraum</option><option value="TODAY">Heute</option><option value="7D">Letzte 7 Tage</option></select></label>
      <button className="sl-icon-button" onClick={refresh} aria-label="Scan-Reports aktualisieren" title="Aktualisieren"><RefreshCw /></button>
    </div>
    <div className="sl-main-grid">
      <aside className="sl-queue" aria-label="Scan-Report Warteschlange">
        <header><div><p>ZUM PRÜFEN AUSWÄHLEN</p><h2>{filtered.length} Fehlscans</h2></div><span>{openReports.length} offen</span></header>
        {canDelete && <div className="sl-bulkbar">
          <label><input type="checkbox" checked={visibleReports.length > 0 && visibleReports.every((report) => selectedForDelete.has(report.documentId))} onChange={toggleVisibleSelection} /> Seite auswählen</label>
          <button disabled={selectedForDelete.size === 0} onClick={() => requestDelete(reports.filter((report) => selectedForDelete.has(report.documentId)))}><Trash2 /> {selectedForDelete.size || ''}</button>
        </div>}
        <div className="sl-report-list">
          {visibleReports.map((report) => <article className={report.documentId === selectedReportId ? 'active' : ''} key={report.documentId}>
            {canDelete && <label className="sl-select-report" title="Zum Löschen auswählen"><span className="sr-only">Scan-Report {shortId(report.documentId)} zum Löschen auswählen</span><input type="checkbox" checked={selectedForDelete.has(report.documentId)} onChange={() => setSelectedForDelete((current) => toggleSet(current, report.documentId))} /></label>}
            <button className="sl-report-open" onClick={() => selectReport(report.documentId)}>
              <div className="sl-report-thumb">{report.captureImagePath ? <PrivateImage endpoint={`/api/admin/scan-reports/${encodeURIComponent(report.documentId)}/image?view=thumb`} alt="Vorschau der Scanaufnahme" userToken={userToken} lazy /> : <ImageIcon />}</div>
              <div className="sl-report-copy"><span><StatusBadge status={report.reviewStatus} /><DecisionBadge decision={scanDecision(report)} /></span><b>{report.guessedName ?? 'Karte nicht erkannt'}</b><small>{report.guessedSet ?? 'Set unbekannt'} · {report.guessedNumber ?? 'Nummer unbekannt'}</small><time>{formatTimestamp(report.createdAt)} · {confidenceText(report.confidence)}</time></div>
            </button>
          </article>)}
          {!visibleReports.length && <div className="sl-empty"><Search /><h3>Keine passenden Fehlscans</h3><p>Ändere die Filter oder aktualisiere die Liste, nachdem ein Fehlscan aus der App gesendet wurde.</p>{exhaustiveFilter && <button onClick={() => { setSearch(''); setStatusFilter('ALL'); setDecisionFilter('ALL'); setDateFilter('ALL'); }}>Alle Fehlscans anzeigen</button>}</div>}
        </div>
        <footer><button aria-label="Vorherige Report-Seite" title="Vorherige Report-Seite" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft /></button><span>Seite {page} von {totalPages} · {reports.length}/{totalReports} geladen</span><button aria-label="Nächste Report-Seite" title="Nächste Report-Seite" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}><ChevronRight /></button>{hasMore && <button className="sl-load-more" disabled={loadingMore} onClick={() => void onLoadMore()}>{loadingMore ? <LoaderCircle className="spin" /> : <PlusLabel />} Mehr</button>}</footer>
      </aside>
      <ReportReviewPanel
        key={selectedReport?.documentId ?? 'empty'}
        report={selectedReport} reports={filtered} profiles={profiles} working={working} userToken={userToken} canDelete={canDelete} canCalibrate={canCalibrate}
        onSave={onSave} onOpenCalibration={(report, reference) => { if (confirmNavigation()) onOpenCalibration(report, reference); }} onSelectReport={selectReport} onDirtyChange={onReviewDirtyChange}
        onDelete={(report) => requestDelete([report])}
      />
    </div>
    {canDelete && deleteTargets.length > 0 && <DeleteDialog targets={deleteTargets} confirmation={deleteConfirmation} working={deleteWorking} onConfirmation={setDeleteConfirmation} onCancel={() => { if (!deleteWorking) { setDeleteTargets([]); setDeleteConfirmation(''); } }} onConfirm={() => void confirmDelete()} />}
  </section>;
}

function DashboardMetrics({ reports, totalReports }: { reports: ScannerReport[]; totalReports: number }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const open = reports.filter((report) => isOpenStatus(report.reviewStatus)).length;
  const review = reports.filter((report) => report.reviewStatus === 'IN_REVIEW').length;
  const resolved = reports.filter((report) => ['RESOLVED', 'PUBLISHED'].includes(report.reviewStatus)).length;
  const newToday = reports.filter((report) => new Date(report.createdAt).getTime() >= today.getTime()).length;
  const partial = reports.length < totalReports;
  return <div className="sl-metrics" aria-label="Scanner-Lab Übersicht">
    <Metric label={partial ? 'Offen (geladen)' : 'Offene Fälle'} value={open} tone="violet" />
    <Metric label={partial ? 'Neu heute (geladen)' : 'Neu heute'} value={newToday} tone="cyan" />
    <Metric label={partial ? 'In Prüfung (geladen)' : 'In Prüfung'} value={review} tone="amber" />
    <Metric label={partial ? 'Gelöst (geladen)' : 'Gelöst'} value={resolved} tone="green" />
    <Metric label="Gesamt" value={totalReports} tone="neutral" />
  </div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article className={`sl-metric ${tone}`}><span>{label}</span><strong>{value.toLocaleString('de-DE')}</strong></article>;
}

function ReportReviewPanel({ report, reports, profiles, working, userToken, canDelete, canCalibrate, onSave, onOpenCalibration, onSelectReport, onDelete, onDirtyChange }: {
  report: ScannerReport | null; reports: ScannerReport[]; profiles: ScannerProfileVersion[]; working: boolean; userToken: () => Promise<string>;
  canDelete: boolean; canCalibrate: boolean;
  onSave: Props['onSave']; onOpenCalibration: Props['onOpenCalibration']; onSelectReport: (id: string) => void; onDelete: (report: ScannerReport) => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const [status, setStatus] = useState<ScanReportStatus>(report?.reviewStatus ?? 'NEW');
  const [note, setNote] = useState(report?.reviewNote ?? '');
  const [reference, setReference] = useState<ScannerReference | null>(null);
  const [variant, setVariant] = useState<string | null>(report?.referenceVariant ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const initial = useRef({ status: report?.reviewStatus ?? 'NEW', note: report?.reviewNote ?? '', referenceId: report?.referenceCardId ?? '', variant: report?.referenceVariant ?? '' });

  useEffect(() => {
    if (!report) return;
    const setValue = report.guessedSet?.trim() ?? '';
    const numberValue = collectorNumberQuery(report.guessedNumber ?? '');
    if (!report.referenceCardId && (!setValue || !numberValue)) return;
    const controller = new AbortController();
    const query = report.referenceCardId ?? numberValue;
    const setFilter = report.referenceCardId ? '' : scannerSetFilter(setValue);
    void userToken().then((token) => fetch(`/api/admin/scanner-references?q=${encodeURIComponent(query)}${setFilter}&page=1&pageSize=48`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }))
      .then((response) => response.ok ? response.json() as Promise<ReferenceResponse> : Promise.reject(new Error('REFERENCE_UNAVAILABLE')))
      .then((body) => {
        const candidates = report.referenceCardId
          ? body.cards.filter((card) => card.id === report.referenceCardId && (!report.referenceCardKey || card.cardKey === report.referenceCardKey))
          : body.cards.filter((card) => sameScannerSet(card, setValue) && collectorNumberKey(card.localId) === collectorNumberKey(numberValue));
        if (candidates.length === 1) {
          const match = candidates[0];
          const resolvedVariant = report.referenceVariant ?? (match.variants.length === 1 ? match.variants[0] : null);
          setReference(match);
          setVariant(resolvedVariant);
          if (!report.referenceCardId) initial.current = { ...initial.current, referenceId: match.id, variant: resolvedVariant ?? '' };
        }
      }).catch(() => undefined);
    return () => controller.abort();
  }, [report, userToken]);

  const dirty = !!report && (status !== initial.current.status || note !== initial.current.note || (reference?.id ?? report.referenceCardId ?? '') !== initial.current.referenceId || (variant ?? '') !== initial.current.variant);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const exactProfile = report?.profileId && report.profileVersion ? profiles.find((item) => item.profileId === report.profileId && item.profileVersion === report.profileVersion) ?? null : null;
  const currentReferenceId = reference?.id ?? report?.referenceCardId ?? null;

  const persist = async (nextStatus: ScanReportStatus, selection?: ReferenceSelection) => {
    if (!report) return;
    try {
      await onSave(report, nextStatus, note, selection);
      setStatus(nextStatus); setSaveMessage('Gespeichert');
      initial.current = { status: nextStatus, note, referenceId: selection?.reference?.id ?? currentReferenceId ?? '', variant: selection?.variant ?? variant ?? '' };
    } catch { setSaveMessage(''); }
  };

  const reportIndex = report ? reports.findIndex((item) => item.documentId === report.documentId) : -1;
  const nextOpen = reportIndex >= 0 ? reports.slice(reportIndex + 1).find((item) => isOpenStatus(item.reviewStatus)) ?? null : null;

  if (!report) return <main className="sl-review sl-empty"><ImageIcon /><h2>Noch kein Scan-Report ausgewählt</h2><p>Wähle links einen echten, manuell gesendeten Fehlscan aus.</p></main>;
  return <main className="sl-review">
    <header className="sl-review-header"><div><p>FEHLSCAN {shortId(report.scanId)}</p><h2>{report.guessedName ?? 'Unbekannte Karte'}</h2><span>{formatTimestamp(report.createdAt)} · {report.captureType === 'MANUAL_CAPTURE' ? 'Manuell zur Prüfung gesendet' : 'Aufnahmetyp unbekannt'}</span></div><div><StatusBadge status={report.reviewStatus} />{canDelete && <button className="danger" onClick={() => onDelete(report)}><Trash2 /> Löschen</button>}</div></header>
    <section className="sl-identity-strip">
      <div><span>Vom Scanner vermutete Karte</span><strong>{[report.guessedName, report.guessedSet, report.guessedNumber].filter(Boolean).join(' · ') || 'Noch nicht erkannt'}</strong></div>
      <div><span>Scanner-Ergebnis</span><DecisionBadge decision={scanDecision(report)} /></div>
      <div><span>Erkennungssicherheit</span><strong>{confidenceText(report.confidence)}</strong></div>
      <div><span>Bearbeitungsstand</span><strong>{statusLabels[report.reviewStatus]}</strong></div>
    </section>
    <section className="sl-analysis-grid">
      <ReportImageViewer report={report} profile={exactProfile} userToken={userToken} canInspect={canCalibrate} />
      <div className="sl-analysis-summary">
        <header><p>ANALYSE</p><h3>Was ist passiert?</h3></header>
        <p className="sl-human-summary">{humanSummary(report)}</p>
        <dl>
          <div><dt>Kartenname</dt><dd>{report.guessedName ?? 'Nicht erkannt'}</dd></div>
          <div><dt>Set</dt><dd>{report.guessedSet ?? 'Nicht erkannt'}</dd></div>
          <div><dt>Kartennummer</dt><dd>{report.guessedNumber ?? 'Nicht erkannt'}</dd></div>
          <div><dt>Profil</dt><dd>{report.profileId ? `${report.profileId} · v${report.profileVersion ?? '?'}` : 'Nicht übermittelt'}</dd></div>
        </dl>
        <div className="sl-reason"><AlertTriangle /><div><span>Übermittelter Grund</span><p>{report.failureReason}</p></div></div>
        {report.attempts.length > 0 && <div className="sl-attempts"><h4>Analyseversuche</h4>{report.attempts.map((attempt, index) => <article key={`${attempt.label}-${index}`}><span><b>{attempt.label}</b><small>{attempt.outcome ?? 'Ergebnis nicht benannt'}</small></span><strong>{[attempt.guessedName, attempt.guessedSet, attempt.guessedNumber].filter(Boolean).join(' · ') || 'Keine Identität'}</strong><em>{confidenceText(attempt.confidence)}</em></article>)}</div>}
      </div>
    </section>
    <section className="sl-correction">
      <header><div><p>SCHRITT 2</p><h3>Passende Karte auswählen</h3></div><button className="secondary" onClick={() => setPickerOpen((value) => !value)}>{pickerOpen ? <X /> : <Search />}{pickerOpen ? 'Auswahl schließen' : 'Andere Karte auswählen'}</button></header>
      {currentReferenceId && <div className="sl-current-reference">{reference ? <span className="sl-current-reference-image"><PrivateImage endpoint={`/api/admin/scanner-reference-image/${encodeURIComponent(reference.imageFile)}`} alt={`Referenzkarte ${reference.nameDe}`} userToken={userToken} /></span> : <CheckCircle2 />}<div><span>Referenzkarte zum visuellen Vergleich</span><strong>{reference ? `${reference.nameDe} · ${reference.setId} · ${reference.localId}` : currentReferenceId}</strong>{variant && <small>Variante: {variant}</small>}</div></div>}
      {!currentReferenceId && <div className="sl-current-reference empty"><CircleHelp /><div><span>Noch keine passende Karte ausgewählt</span><strong>Öffne „Andere Karte auswählen“ und suche nach Set oder Kartennummer.</strong></div></div>}
      {pickerOpen && <ReferencePicker report={report} selected={reference} selectedVariant={variant} userToken={userToken} onSelect={(card, nextVariant) => { setReference(card); setVariant(nextVariant); }} />}
      {reference && reference.variants.length > 0 && <label className="sl-variant"><span>Variante</span><select value={variant ?? ''} onChange={(event) => setVariant(event.target.value || null)}><option value="">Variante auswählen</option>{reference.variants.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>}
      <h3 className="sl-save-heading">3 · Ergebnis speichern</h3>
      <p className="sl-save-help">Stimmen Foto, Karte und Variante überein? Mit der Bestätigung wird die geprüfte Zuordnung als Erkennungshinweis für Scanner und Analyse bereitgestellt, wenn diese Aufnahme eine Analysekennung enthält. Wenn du unsicher bist, wähle „In Prüfung speichern“.</p>
      <p className="sl-save-help" role="status" aria-label="Weitergabe an Scanner und Analyse">{scannerFeedbackMessage(report.recognitionFeedback ?? 'NOT_CONFIRMED')}</p>
      <div className="sl-review-actions">
        <button className="primary" disabled={working || !reference || (reference.variants.length > 0 && !variant)} onClick={() => void persist('RESOLVED', { reference, variant })}><Check /> Karte bestätigen und speichern</button>
        <button disabled={working} onClick={() => void persist('IN_REVIEW', reference ? { reference, variant } : undefined)}><Save /> In Prüfung speichern</button>
        <button disabled={working} onClick={() => void persist('REJECTED', reference ? { reference, variant } : undefined)}><X /> Als nicht zuordenbar markieren</button>
        {canCalibrate && <button disabled={!reference} onClick={() => reference && onOpenCalibration(report, reference)}><Layers3 /> Profil visuell prüfen</button>}
        {nextOpen && <button className="next" onClick={() => onSelectReport(nextOpen.documentId)}>Nächster offener Fall · {Math.max(0, reports.filter((item) => isOpenStatus(item.reviewStatus)).length - 1)} weitere <ChevronRight /></button>}
        {saveMessage && <span className="sl-saved"><Check />{saveMessage}</span>}
      </div>
      <label className="sl-review-note"><span>Notiz zur Prüfung (optional)</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Zum Beispiel: Kartennummer auf dem Foto schwer lesbar." /></label>
      {canCalibrate && <details className="sl-technical"><summary><span><Eye /> Technische Details für Fortgeschrittene</span><small>Texterkennung, Analysezonen und Bilddaten</small></summary><div>
        <section><h4>OCR-Tokens</h4><p>{report.ocrTokens.length ? report.ocrTokens.join(' · ') : 'Nicht übermittelt'}</p></section>
        <section><h4>Zonen-Confidence</h4><p>{Object.keys(report.zoneConfidence).length ? Object.entries(report.zoneConfidence).map(([key, value]) => `${key}: ${percent(value)}`).join(' · ') : 'Nicht übermittelt'}</p></section>
        <section><h4>Private Bilddaten</h4><p>{report.imageContentType ?? 'Typ unbekannt'} · {report.imageSizeBytes ? formatBytes(report.imageSizeBytes) : 'Größe unbekannt'} · SHA-256 {report.imageSha256 ? `${report.imageSha256.slice(0, 12)}…` : 'nicht übermittelt'}</p></section>
        <section><h4>Stabile IDs</h4><p>Report {report.documentId} · Scan {report.scanId} · Referenz {report.referenceCardKey ?? 'nicht gesetzt'}</p></section>
      </div></details>}
    </section>
  </main>;
}

function ReportImageViewer({ report, profile, userToken, canInspect }: { report: ScannerReport; profile: ScannerProfileVersion | null; userToken: () => Promise<string>; canInspect: boolean }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [original, setOriginal] = useState(false);
  const [overlays, setOverlays] = useState(false);
  const [enabledTypes, setEnabledTypes] = useState<Set<ScannerZoneType>>(new Set());
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const availableZones = profile?.zones.filter((zone) => zone.enabled && (report.zoneConfidence[zone.id] !== undefined || report.zoneConfidence[zone.type] !== undefined || report.zoneConfidence[zone.label] !== undefined)) ?? [];

  useEffect(() => { setZoom(1); setRotation(0); setPan({ x: 0, y: 0 }); setOriginal(false); setOverlays(false); setEnabledTypes(new Set()); }, [report.documentId]);
  const reset = () => { setZoom(1); setRotation(0); setPan({ x: 0, y: 0 }); setOriginal(false); };
  const toggleOverlay = () => {
    const next = !overlays; setOverlays(next);
    if (next && enabledTypes.size === 0) setEnabledTypes(new Set(availableZones.map((zone) => zone.type)));
  };
  return <div className="sl-viewer">
    <header><div><p>1 · FOTO ANSEHEN</p><span>{report.captureImagePath ? 'Private Scanaufnahme' : 'Kein Bild'}</span></div><div className="sl-viewer-tools">
      <button onClick={() => setZoom((value) => Math.max(.5, value - .2))} aria-label="Verkleinern"><ZoomOut /></button><output>{Math.round(zoom * 100)} %</output><button onClick={() => setZoom((value) => Math.min(4, value + .2))} aria-label="Vergrößern"><ZoomIn /></button>
      <button onClick={() => setRotation((value) => (value + 90) % 360)} aria-label="Ansicht drehen"><RotateCw /></button>
      <button onClick={() => { setZoom(1); setRotation(0); setPan({ x: 0, y: 0 }); setOriginal((value) => !value); }} aria-label="Originalgröße" aria-pressed={original}><Maximize2 /></button>
      <button onClick={reset} aria-label="Ansicht zurücksetzen"><RefreshCw /></button>
    </div></header>
    <div className={`sl-image-stage ${original ? 'original' : ''}`} onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, pan }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!drag.current) return; setPan({ x: drag.current.pan.x + event.clientX - drag.current.x, y: drag.current.pan.y + event.clientY - drag.current.y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {report.captureImagePath ? <div className="sl-image-plane" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)` }}><PrivateImage endpoint={`/api/admin/scan-reports/${encodeURIComponent(report.documentId)}/image`} alt="Private Originalaufnahme des Scan-Reports" userToken={userToken} />{overlays && availableZones.map((zone) => enabledTypes.has(zone.type) && <span className={`sl-zone-overlay zone-${zone.type}`} style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.width * 100}%`, height: `${zone.height * 100}%` }} key={zone.id}>{zone.label}</span>)}</div> : <div className="sl-image-missing"><ImageIcon /><span>Kein Bild übermittelt</span></div>}
      <span className="sl-pan-hint"><Move /> Ziehen zum Verschieben</span>
    </div>
    {canInspect && <footer><button disabled={!availableZones.length} className={overlays ? 'active' : ''} onClick={toggleOverlay}>{overlays ? <Eye /> : <EyeOff />} Analysezonen {availableZones.length ? `(${availableZones.length})` : 'nicht verfügbar'}</button>{overlays && <div>{Array.from(new Set(availableZones.map((zone) => zone.type))).map((type) => <label key={type}><input type="checkbox" checked={enabledTypes.has(type)} onChange={() => setEnabledTypes((current) => toggleSet(current, type))} /><i className={`zone-${type}`} />{zoneLabel(type)}</label>)}</div>}</footer>}
  </div>;
}

function ReferencePicker({ report, selected, selectedVariant, userToken, onSelect }: { report: ScannerReport; selected: ScannerReference | null; selectedVariant: string | null; userToken: () => Promise<string>; onSelect: (card: ScannerReference, variant: string | null) => void }) {
  const [setValue, setSetValue] = useState(report.guessedSet ?? '');
  const [numberValue, setNumberValue] = useState(report.guessedNumber ?? '');
  const [nameValue, setNameValue] = useState(report.guessedName ?? '');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReferenceResponse>({ connected: false, cards: [], total: 0, page: 1, pageSize: 12 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      const setQuery = setValue.trim();
      const q = collectorNumberQuery(numberValue) || nameValue.trim() || setQuery;
      const setFilter = scannerSetFilter(setQuery);
      void userToken().then((token) => fetch(`/api/admin/scanner-references?q=${encodeURIComponent(q)}${setFilter}&page=${page}&pageSize=12`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }))
        .then(async (response) => { const body = await response.json() as ReferenceResponse & { error?: string }; if (!response.ok) throw new Error(body.error || 'Referenzsuche fehlgeschlagen.'); return body; })
        .then(setData).catch((reason) => { if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message); }).finally(() => setLoading(false));
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [nameValue, numberValue, page, setValue, userToken]);

  const pages = Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize)));
  return <div className="sl-reference-picker">
    <div className="sl-picker-steps">
      <label><span>Setname oder Set-Kürzel</span><input value={setValue} onChange={(event) => { setSetValue(event.target.value); setPage(1); }} placeholder="z. B. sv3 oder Obsidianflammen" /></label>
      <label><span>Kartennummer</span><input value={numberValue} onChange={(event) => { setNumberValue(event.target.value); setPage(1); }} placeholder="z. B. 137" /></label>
      <label><span>Kartenname (optional)</span><input value={nameValue} onChange={(event) => { setNameValue(event.target.value); setPage(1); }} placeholder="Kartenname" /></label>
    </div>
    {loading && <div className="sl-picker-state"><LoaderCircle className="spin" /> Karten werden gesucht …</div>}
    {error && <div className="sl-picker-state error"><AlertTriangle />{error}</div>}
    {!loading && !error && !data.connected && <div className="sl-picker-state"><AlertTriangle />{data.message ?? 'Referenzarchiv nicht verbunden.'}</div>}
    {!loading && data.connected && <div className="sl-reference-results">{data.cards.map((card) => <button className={selected?.id === card.id ? 'active' : ''} onClick={() => onSelect(card, selected?.id === card.id ? selectedVariant : card.variants[0] ?? null)} key={card.cardKey}><PrivateImage endpoint={`/api/admin/scanner-reference-image/${encodeURIComponent(card.imageFile)}`} alt={card.nameDe} userToken={userToken} lazy /><span><b>{card.nameDe}</b><small>{card.setName ?? card.setId} · {card.setId} · #{card.localId}</small><em>{card.rarity ?? card.layoutFamily}</em></span>{selected?.id === card.id && <CheckCircle2 />}</button>)}</div>}
    {!loading && data.connected && data.cards.length === 0 && <div className="sl-picker-state"><Search />Keine passende reale Referenz gefunden.</div>}
    <div className="sl-picker-pages"><button aria-label="Vorherige Referenzseite" title="Vorherige Referenzseite" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft /></button><span>Seite {page} von {pages} · {data.total.toLocaleString('de-DE')} Treffer</span><button aria-label="Nächste Referenzseite" title="Nächste Referenzseite" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight /></button></div>
  </div>;
}

function DeleteDialog({ targets, confirmation, working, onConfirmation, onCancel, onConfirm }: { targets: ScannerReport[]; confirmation: string; working: boolean; onConfirmation: (value: string) => void; onCancel: () => void; onConfirm: () => void }) {
  const imageCount = targets.filter((item) => item.captureImagePath).length;
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !working) onCancel(); };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [onCancel, working]);
  return <div className="sl-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !working) onCancel(); }}><section className="sl-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
    <header><div><AlertTriangle /><span><p>ENDGÜLTIG LÖSCHEN</p><h2 id="delete-title">{targets.length === 1 ? 'Scan-Report löschen?' : `${targets.length} Scan-Reports löschen?`}</h2></span></div><button disabled={working} onClick={onCancel} aria-label="Dialog schließen"><X /></button></header>
    <p>Dieser Vorgang entfernt ausschließlich {targets.length} ausgewählte{targets.length === 1 ? 'n' : ''} Report{targets.length === 1 ? '' : 's'} und {imageCount} eindeutig zugeordnete{imageCount === 1 ? 's' : ''} private{imageCount === 1 ? 's' : ''} Scanbild{imageCount === 1 ? '' : 'er'}.</p>
    <ul>{targets.slice(0, 8).map((report) => <li key={report.documentId}><code>{report.documentId}</code><span>{report.guessedName ?? 'Nicht erkannt'}</span></li>)}{targets.length > 8 && <li>… und {targets.length - 8} weitere</li>}</ul>
    <div className="sl-preserved"><ShieldCheck /><span><b>Bleibt erhalten</b>Scannerprofile, Production-Manifest, Referenzkatalog, globales Scanwissen und Audit-Historie.</span></div>
    <label><span>Zur Bestätigung <b>LÖSCHEN</b> eingeben</span><input autoFocus value={confirmation} onChange={(event) => onConfirmation(event.target.value)} /></label>
    <footer><button disabled={working} onClick={onCancel}>Abbrechen</button><button className="danger" disabled={working || confirmation !== 'LÖSCHEN'} onClick={onConfirm}>{working ? <LoaderCircle className="spin" /> : <Trash2 />} Endgültig löschen</button></footer>
  </section></div>;
}

function PrivateImage({ endpoint, alt, userToken, lazy = false }: { endpoint: string; alt: string; userToken: () => Promise<string>; lazy?: boolean }) {
  const [source, setSource] = useState<{ endpoint: string; url: string } | null>(null);
  const [failedEndpoint, setFailedEndpoint] = useState('');
  const [visibleEndpoint, setVisibleEndpoint] = useState(lazy ? '' : endpoint);
  const target = useRef<HTMLElement | null>(null);
  const setTarget = useCallback((node: HTMLElement | null) => { target.current = node; }, []);

  useEffect(() => {
    if (!lazy) { setVisibleEndpoint(endpoint); return; }
    setVisibleEndpoint('');
    const element = target.current;
    if (!element || typeof IntersectionObserver === 'undefined') { setVisibleEndpoint(endpoint); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        setVisibleEndpoint(endpoint);
        observer.disconnect();
      }
    }, { rootMargin: '240px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [endpoint, lazy]);

  useEffect(() => {
    if (visibleEndpoint !== endpoint) return;
    let objectUrl = ''; const controller = new AbortController(); setFailedEndpoint('');
    void userToken().then((token) => fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }))
      .then((response) => response.ok ? response.blob() : Promise.reject(new Error('IMAGE_UNAVAILABLE')))
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setSource({ endpoint, url: objectUrl }); })
      .catch((reason) => { if (reason instanceof Error && reason.name !== 'AbortError') setFailedEndpoint(endpoint); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [endpoint, userToken, visibleEndpoint]);
  if (failedEndpoint === endpoint) return <span ref={setTarget} className="sl-image-error"><AlertTriangle />Bild nicht verfügbar</span>;
  if (source?.endpoint !== endpoint) return <span ref={setTarget} className="sl-image-loading"><LoaderCircle className="spin" /></span>;
  return <img ref={setTarget} src={source.url} alt={alt} loading={lazy ? 'lazy' : 'eager'} draggable={false} />;
}

function StatusBadge({ status }: { status: ScanReportStatus }) { return <span className={`sl-status status-${status.toLowerCase()}`}>{statusLabels[status]}</span>; }
function DecisionBadge({ decision }: { decision: Decision }) { return <span className={`sl-decision decision-${decision.toLowerCase()}`}>{decisionLabels[decision]}</span>; }
function isOpenStatus(status: ScanReportStatus) { return !['RESOLVED', 'PUBLISHED', 'REJECTED'].includes(status); }
function scanDecision(report: ScannerReport): Decision {
  const values = report.attempts.map((item) => item.outcome?.toUpperCase().trim()).filter(Boolean);
  if (values.some((value) => value === 'ACCEPTED')) return 'ACCEPTED';
  if (values.some((value) => value === 'AMBIGUOUS')) return 'AMBIGUOUS';
  if (values.some((value) => value === 'REJECTED')) return 'REJECTED';
  return 'UNKNOWN';
}
function humanSummary(report: ScannerReport) {
  const found = [report.guessedName && 'Name', report.guessedSet && 'Set', report.guessedNumber && 'Nummer'].filter(Boolean);
  const missing = [!report.guessedName && 'Name', !report.guessedSet && 'Set', !report.guessedNumber && 'Nummer'].filter(Boolean);
  if (!found.length) return 'Der Scanner konnte die Karte noch nicht zuordnen. Sieh dir das Foto an und suche unten die passende Karte.';
  if (missing.length) return `${found.join(', ')} wurden erkannt. ${missing.join(', ')} fehlen noch. Vergleiche das Foto mit der Auswahl unten.`;
  return 'Vergleiche Name, Set und Kartennummer auf dem Foto. Bestätige anschließend die passende Karte und Variante.';
}
function reportMatches(report: ScannerReport, search: string, status: StatusFilter, decision: Decision | 'ALL', date: 'ALL' | 'TODAY' | '7D') {
  const needle = search.trim().toLocaleLowerCase('de');
  if (needle && ![report.documentId, report.scanId, report.guessedName, report.guessedSet, report.guessedNumber].filter(Boolean).join(' ').toLocaleLowerCase('de').includes(needle)) return false;
  if (status === 'OPEN' && !isOpenStatus(report.reviewStatus)) return false;
  if (status === 'RESOLVED' && !['RESOLVED', 'PUBLISHED'].includes(report.reviewStatus)) return false;
  if (status === 'REJECTED' && report.reviewStatus !== 'REJECTED') return false;
  if (decision !== 'ALL' && scanDecision(report) !== decision) return false;
  const created = new Date(report.createdAt).getTime();
  if (date === 'TODAY') { const start = new Date(); start.setHours(0, 0, 0, 0); if (created < start.getTime()) return false; }
  if (date === '7D' && created < Date.now() - 7 * 86400_000) return false;
  return true;
}
function toggleSet<T>(current: Set<T>, item: T) { const next = new Set(current); if (next.has(item)) next.delete(item); else next.add(item); return next; }
function percent(value: number | null) { return value === null ? 'Nicht übermittelt' : `${Math.round(value * 100)} %`; }
function confidenceText(value: number | null) { if (value === null) return 'Nicht übermittelt'; return `${percent(value)} · ${value >= .85 ? 'Hoch' : value >= .6 ? 'Mittel' : 'Niedrig'}`; }
function formatTimestamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Zeitpunkt unbekannt' : new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function shortId(value: string) { return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value; }
function deleteError(code?: string) { return ({ PARTIAL_DELETE: 'Bild entfernt, Report blieb erhalten – sicher erneut versuchen.', REPORT_IMAGE_DELETE_FAILED: 'Privatbild konnte nicht gelöscht werden.', REPORT_IMAGE_RELATION_UNSAFE: 'Bildzuordnung war nicht eindeutig; nichts gelöscht.', ACCESS_DENIED: 'Adminberechtigung fehlt.', RECENT_LOGIN_REQUIRED: 'Bitte neu anmelden und das Löschen danach erneut bestätigen.', CONFIRMATION_REQUIRED: 'Bestätigung fehlt.' } as Record<string, string>)[code ?? ''] ?? 'Löschen fehlgeschlagen.'; }
function zoneLabel(type: ScannerZoneType) { return ({ collectorNumber: 'Kartennummer', setIdentifier: 'Set-Kürzel', cardName: 'Kartenname', artwork: 'Artwork', hp: 'KP', type: 'Typ', category: 'Kategorie', rarity: 'Seltenheit', cardFrame: 'Kartenrahmen', custom: 'Eigene Zone', ignore: 'Ignorieren' } as Record<ScannerZoneType, string>)[type]; }
function PlusLabel() { return <span aria-hidden="true">+</span>; }
function collectorNumberQuery(value: string) { return value.trim().split('/', 1)[0].trim().replace(/^#\s*/, ''); }
function collectorNumberKey(value: string) {
  const collector = collectorNumberQuery(value).toLocaleLowerCase('de').replace(/\s+/g, '');
  return /^\d+$/.test(collector) ? collector.replace(/^0+(?=\d)/, '') || '0' : collector;
}
function scannerSetFilter(value: string) {
  const set = value.trim();
  if (!set) return '';
  const exactId = /^(?=[a-z0-9._-]*[a-z])(?=[a-z0-9._-]*\d)[a-z0-9._-]{2,40}$/i.test(set);
  return exactId ? `&setId=${encodeURIComponent(set)}` : `&set=${encodeURIComponent(set)}`;
}
function sameScannerSet(card: ScannerReference, value: string) {
  const key = (text: string) => text.toLocaleLowerCase('de').replace(/[^a-z0-9äöüß]/g, '');
  return key(card.setId) === key(value) || key(card.setName ?? '') === key(value);
}
