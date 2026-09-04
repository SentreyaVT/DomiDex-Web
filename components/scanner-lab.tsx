'use client';

import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, ClipboardCheck, Copy, Database, FlaskConical,
  ImageIcon, Layers3, ListChecks, LoaderCircle, Plus, RefreshCw, Rocket, Save,
  ShieldAlert, Trash2, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import {
  clampZone, createScannerDraft, layoutFamilies, scannerProductionActionBlockReason, scannerPublicationBlockReason, scopeLevels, validateScannerProfile,
  zoneTypes, type ScannerProfileVersion, type ScannerReference, type ScannerScopeLevel, type ScannerZone, type ScannerZoneType,
} from '@/lib/scanner-profile';
import { scanReportStatuses, type ScannerReport, type ScanReportStatus } from '@/lib/scanner-report';

interface ReferenceResponse { connected: boolean; cards: ScannerReference[]; total: number; page: number; pageSize: number; stats: Record<string, number> | null; message?: string; }
interface ScannerProfileSummary { profileId: string; name?: string; latestVersion?: number; latestStatus?: string; }
interface ProfilesResponse { profiles: ScannerProfileSummary[]; versions: ScannerProfileVersion[]; benchmarks: Array<Record<string, unknown>>; manifest: Record<string, unknown> | null; }
interface ReportsResponse { reports: ScannerReport[]; total: number; }
type LabMode = 'calibration' | 'reports';

export function ScannerLab() {
  const { user, loading, isAdmin, refreshClaims } = useAuth();
  const [references, setReferences] = useState<ReferenceResponse>({ connected: false, cards: [], total: 0, page: 1, pageSize: 24, stats: null });
  const [profiles, setProfiles] = useState<ProfilesResponse>({ profiles: [], versions: [], benchmarks: [], manifest: null });
  const [reports, setReports] = useState<ReportsResponse>({ reports: [], total: 0 });
  const [mode, setMode] = useState<LabMode>('calibration');
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [selectedReference, setSelectedReference] = useState<ScannerReference | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null); const [reviewReference, setReviewReference] = useState<ScannerReference | null>(null);
  const [draft, setDraft] = useState<ScannerProfileVersion>(() => createScannerDraft()); const [selectedZoneId, setSelectedZoneId] = useState('collector-number');
  const [working, setWorking] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [history, setHistory] = useState<ScannerProfileVersion[]>([]); const [historyIndex, setHistoryIndex] = useState(-1);

  const authorized = useCallback(async (url: string, init?: RequestInit) => {
    if (!user) throw new Error('Anmeldung erforderlich.'); const token = await user.getIdToken();
    const headers = new Headers(init?.headers); headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...init, headers });
    const body = await response.json() as { error?: unknown }; if (!response.ok) throw new Error(Array.isArray(body.error) ? body.error.join(' ') : typeof body.error === 'string' ? body.error : 'Anfrage fehlgeschlagen.');
    return body;
  }, [user]);
  const userToken = useCallback(() => user!.getIdToken(), [user]);

  const refreshProfiles = useCallback(async () => {
    if (!isAdmin) return; setProfiles(await authorized('/api/admin/scanner-profiles') as ProfilesResponse);
  }, [authorized, isAdmin]);

  const refreshReports = useCallback(async () => {
    if (!isAdmin) return;
    const next = await authorized('/api/admin/scan-reports') as ReportsResponse;
    setReports(next); setSelectedReportId((current) => current && next.reports.some((item) => item.documentId === current) ? current : next.reports[0]?.documentId ?? null);
  }, [authorized, isAdmin]);

  useEffect(() => { if (isAdmin) void Promise.all([refreshProfiles(), refreshReports()]).catch((reason) => setError(reason.message)); }, [isAdmin, refreshProfiles, refreshReports]);
  useEffect(() => {
    if (!isAdmin) return; const timer = window.setTimeout(() => {
      void authorized(`/api/admin/scanner-references?q=${encodeURIComponent(query)}&page=${page}&pageSize=24`).then((body) => {
        const next = body as ReferenceResponse; setReferences(next);
        if (mode === 'calibration') setSelectedReference((current) => current && next.cards.some((item) => item.id === current.id) ? current : next.cards[0] ?? null);
      }).catch((reason) => setError(reason.message));
    }, 180); return () => window.clearTimeout(timer);
  }, [authorized, isAdmin, mode, page, query]);

  const patchDraft = (next: ScannerProfileVersion) => {
    setHistory((items) => [...items.slice(0, historyIndex + 1), draft].slice(-40)); setHistoryIndex((value) => Math.min(value + 1, 39)); setDraft(next);
  };
  const undo = () => { if (historyIndex < 0) return; const previous = history[historyIndex]; setDraft(previous); setHistoryIndex((value) => value - 1); };
  const selectedZone = draft.zones.find((zone) => zone.id === selectedZoneId) ?? null;
  const versions = profiles.versions.filter((version) => version.profileId === draft.profileId).sort((a, b) => b.profileVersion - a.profileVersion);
  const validation = validateScannerProfile(draft);
  const selectedReport = reports.reports.find((item) => item.documentId === selectedReportId) ?? null;

  const openProfile = (profileId: string) => {
    const latest = profiles.versions.filter((item) => item.profileId === profileId).sort((a, b) => b.profileVersion - a.profileVersion)[0];
    if (latest) { setDraft(latest); setSelectedZoneId(latest.zones[0]?.id ?? ''); setHistory([]); setHistoryIndex(-1); }
  };
  const newProfile = () => { const next = createScannerDraft(); setDraft(next); setSelectedZoneId(next.zones[0]?.id ?? ''); setHistory([]); setHistoryIndex(-1); };

  const updateReport = async (report: ScannerReport, reviewStatus: ScanReportStatus, reviewNote: string, reference?: ScannerReference | null) => {
    setWorking(true); setError(''); setMessage('');
    try {
      const payload: Record<string, unknown> = { reportId: report.documentId, reviewStatus, reviewNote };
      if (reference !== undefined) payload.reference = reference ? { id: reference.id, cardKey: reference.cardKey } : null;
      await authorized('/api/admin/scan-reports', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      setMessage('Scan-Review wurde sicher gespeichert.'); await refreshReports();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Scan-Review konnte nicht gespeichert werden.'); }
    finally { setWorking(false); }
  };

  const openCalibrationFromReport = (report: ScannerReport, reference: ScannerReference) => {
    const reported = report.profileId ? profiles.versions.filter((item) => item.profileId === report.profileId).sort((a, b) => b.profileVersion - a.profileVersion)[0] : null;
    const base = reported ?? createScannerDraft();
    setDraft({ ...base, documentId: undefined, status: 'draft', scope: { level: 'card', value: reference.id }, layoutFamily: reference.layoutFamily, changelog: `Kalibrierung aus Scan ${report.scanId}` });
    setSelectedReference(reference); setSelectedZoneId(base.zones[0]?.id ?? ''); setQuery(reference.id); setPage(1); setMode('calibration');
  };

  const execute = async (action: string, sourceDocumentId?: string) => {
    setWorking(true); setError(''); setMessage('');
    try {
      const publicationBlock = scannerProductionActionBlockReason(action);
      if (publicationBlock) { setError(publicationBlock); return; }
      let confirm: string | undefined;
      if (action === 'publish') { if (!window.confirm('Dieses geprüfte Scannerprofil wirklich veröffentlichen?')) return; confirm = 'PUBLISH'; }
      if (action === 'rollback') { if (!window.confirm('Diese frühere Konfiguration als neue Production-Version veröffentlichen?')) return; confirm = 'ROLLBACK'; }
      const body = await authorized('/api/admin/scanner-profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, profile: action === 'saveDraft' ? draft : undefined, sourceDocumentId, confirm, changelog: draft.changelog }) }) as { version?: ScannerProfileVersion; warning?: string };
      if (body.version) setDraft({ ...body.version, documentId: body.version.documentId });
      setMessage(body.warning || (action === 'saveDraft' ? 'Entwurf gespeichert. Das ist keine Veröffentlichung und kein Foto-Upload.' : 'Profilstatus gespeichert. Es wurde kein automatischer Erkennungstest ausgeführt.')); await refreshProfiles();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Aktion fehlgeschlagen.'); }
    finally { setWorking(false); }
  };

  if (loading) return <main className="admin-gate"><LoaderCircle className="spin" /><p>Scanner Lab wird geschützt geöffnet …</p></main>;
  if (!user) return <main className="admin-gate"><ShieldAlert /><h1>Anmeldung erforderlich</h1><a href="/login">Zum Login</a></main>;
  if (!isAdmin) return <main className="admin-gate"><ShieldAlert /><h1>403 · Scanner Lab geschützt</h1><p>Nur ein ausdrücklich freigegebener Firebase-Admin kann Scannerprofile lesen oder ändern.</p><button onClick={() => void refreshClaims()}>Berechtigung erneut prüfen</button></main>;

  return <main className="scanner-lab">
    <header className="lab-header"><a href="/admin"><ArrowLeft /> Administration</a><div><p>DOMIDEX ENGINEERING</p><h1>Scanner Control Center</h1><span>Fehlscan-Uploads findest du unter „Fehlscans“. Profilentwürfe werden separat gespeichert.</span></div><div className="lab-actions"><button onClick={undo} disabled={historyIndex < 0}><Undo2 /> Rückgängig</button><button className="primary" disabled={working || !validation.valid} onClick={() => void execute('saveDraft')}>{working ? <LoaderCircle className="spin" /> : <Save />} Entwurf speichern</button></div></header>
    {message && <div className="admin-success"><Check />{message}</div>}{error && <div className="form-error">{error}</div>}
    <section className="lab-metrics">
      <Metric icon={Database} label="Referenzkarten" value={references.stats ? String(references.stats.cardsProcessed ?? references.total) : 'Nicht verbunden'} />
      <Metric icon={Layers3} label="Profile" value={String(profiles.profiles.length)} />
      <Metric icon={ListChecks} label="Scan Reports" value={String(reports.total)} />
      <Metric icon={Rocket} label="Production" value={profiles.manifest ? 'Manifest aktiv' : 'Noch keine'} />
    </section>
    <nav className="lab-modebar" aria-label="Scanner-Lab Bereiche">
      <div><button className={mode === 'calibration' ? 'active' : ''} onClick={() => setMode('calibration')}><Layers3 /> Kalibrierung</button><button className={mode === 'reports' ? 'active' : ''} onClick={() => setMode('reports')}><ClipboardCheck /> Fehlscans <span>{reports.total}</span></button></div>
      <div className="profile-picker"><label>Profil<select value={profiles.profiles.some((item) => item.profileId === draft.profileId) ? draft.profileId : ''} onChange={(event) => openProfile(event.target.value)}><option value="">Ungespeicherter Entwurf</option>{profiles.profiles.map((item) => <option value={item.profileId} key={item.profileId}>{item.name ?? item.profileId} · v{item.latestVersion ?? 0}</option>)}</select></label><button onClick={newProfile}><Plus /> Neues Profil</button></div>
    </nav>
    {mode === 'calibration' ? <div className="lab-workspace">
      <ReferenceBrowser data={references} query={query} setQuery={(value) => { setQuery(value); setPage(1); }} page={page} setPage={setPage} selected={selectedReference} onSelect={setSelectedReference} userToken={userToken} />
      <CalibrationWorkspace reference={selectedReference} profile={draft} selectedZoneId={selectedZoneId} onSelectZone={setSelectedZoneId} onChange={setDraft} userToken={userToken} />
      <ProfileEditor profile={draft} selectedZone={selectedZone} onChange={patchDraft} onSelectZone={setSelectedZoneId} validation={validation.errors} />
    </div> : <div className="report-workspace">
      <ReportList reports={reports.reports} selectedId={selectedReportId} onSelect={(id) => { setSelectedReportId(id); setReviewReference(null); }} />
      <ReportReview report={selectedReport} reference={reviewReference} userToken={userToken} working={working} onSave={updateReport} onOpenCalibration={openCalibrationFromReport} />
      <ReferenceBrowser data={references} query={query} setQuery={(value) => { setQuery(value); setPage(1); }} page={page} setPage={setPage} selected={reviewReference} onSelect={setReviewReference} userToken={userToken} compact />
    </div>}
    {mode === 'calibration' && <section className="lab-bottom">
      <div className="lab-panel"><div className="lab-panel-title"><div><p>VERSIONEN</p><h2>Kontrollierter Release-Flow</h2></div><span>Save ≠ Publish</span></div>
        <div className="version-flow"><b>EDIT</b><i /> <b>DRAFT</b><i /> <b>TESTING</b><i /> <b>CANDIDATE</b><i /> <b>PRODUCTION</b></div>
        <p id="scanner-publication-block">{scannerPublicationBlockReason} „Testing“ und „Candidate“ sind nur Bearbeitungsstände, keine bestandenen Tests.</p>
        <div className="version-list">{versions.length ? versions.map((version) => <article key={version.documentId}><div><Status value={version.status} /><b>v{version.profileVersion}</b><span>{version.changelog || 'Kein Changelog'}</span></div><div>{version.status === 'draft' && <button disabled={working} onClick={() => void execute('markTesting', version.documentId)}>Für Prüfung vormerken</button>}{version.status === 'testing' && <button disabled={working} onClick={() => void execute('createCandidate', version.documentId)}>Candidate erzeugen</button>}{version.status === 'candidate' && <button className="danger" disabled={working || !!scannerProductionActionBlockReason('publish')} aria-describedby="scanner-publication-block" onClick={() => void execute('publish', version.documentId)}>Veröffentlichen gesperrt</button>}{version.status === 'deprecated' && <button disabled={working || !!scannerProductionActionBlockReason('rollback')} aria-describedby="scanner-publication-block" onClick={() => void execute('rollback', version.documentId)}>Rollback gesperrt</button>}<button onClick={() => setDraft(version)}>Öffnen</button></div></article>) : <p className="lab-empty">Noch keine gespeicherte Version. „Entwurf speichern“ erzeugt die erste unveränderlich nachvollziehbare Version.</p>}</div>
      </div>
      <div className="lab-panel benchmark-panel"><div className="lab-panel-title"><div><p>BENCHMARK</p><h2>Vorbereitet, nicht vorgetäuscht</h2></div></div><FlaskConical /><h3>Scannerengine nicht verbunden</h3><p>Das Lab erzeugt reale Konfigurationen. Accuracy, False Positives und Confidence werden erst angezeigt, wenn eine echte Engine Ergebnisse liefert.</p><dl><div><dt>Modus</dt><dd>NOT CONNECTED</dd></div><div><dt>Reale Läufe</dt><dd>{profiles.benchmarks.filter((item) => item.mode === 'REAL').length}</dd></div></dl></div>
    </section>}
  </main>;
}

function ReferenceBrowser({ data, query, setQuery, page, setPage, selected, onSelect, userToken, compact = false }: { data: ReferenceResponse; query: string; setQuery: (value: string) => void; page: number; setPage: (value: number) => void; selected: ScannerReference | null; onSelect: (value: ScannerReference) => void; userToken: () => Promise<string>; compact?: boolean }) {
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <aside className={`reference-browser lab-panel ${compact ? 'compact' : ''}`}><div className="lab-panel-title"><div><p>LOKALES ARCHIV</p><h2>Referenzen</h2></div><span>{data.total.toLocaleString('de-DE')}</span></div><label className="lab-search"><ImageIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, Set, ID, Nummer …" /></label>{!data.connected ? <div className="lab-empty"><Database /><p>{data.message ?? 'Archiv nicht verbunden.'}</p><code>npm run scanner:index</code></div> : <div className="reference-list">{data.cards.map((card) => <button className={selected?.id === card.id ? 'active' : ''} onClick={() => onSelect(card)} key={card.id}><ReferenceImage card={card} userToken={userToken} thumbnail /><div><b>{card.nameDe}</b><small>{card.setName ?? card.setId} · #{card.localId}</small><small>{card.id} · {card.layoutFamily}</small></div><em>{card.metadataAvailable ? 'META' : 'BILD'}</em></button>)}</div>}<div className="reference-pages"><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /></button><span>{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight /></button></div></aside>;
}

function ReportList({ reports, selectedId, onSelect }: { reports: ScannerReport[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <aside className="report-list lab-panel"><div className="lab-panel-title"><div><p>REVIEW QUEUE</p><h2>Fehlscans</h2></div><span>{reports.length}</span></div>{reports.length ? <div className="report-items">{reports.map((report) => <button className={selectedId === report.documentId ? 'active' : ''} onClick={() => onSelect(report.documentId)} key={report.documentId}><Status value={report.reviewStatus.toLowerCase()} /><b>{report.guessedName ?? 'Nicht erkannt'}</b><small>{report.guessedSet ?? 'Set unbekannt'} · {report.guessedNumber ?? 'Nr. unbekannt'}</small><time>{formatTimestamp(report.createdAt)}</time></button>)}</div> : <div className="lab-empty"><ClipboardCheck /><h3>Keine Scan Reports</h3><p>Sobald der vertrauenswürdige Backend-Pfad echte Fehlscans übermittelt, erscheinen sie hier. Es wurden keine Beispieldaten erzeugt.</p></div>}</aside>;
}

function ReportReview({ report, reference, userToken, working, onSave, onOpenCalibration }: { report: ScannerReport | null; reference: ScannerReference | null; userToken: () => Promise<string>; working: boolean; onSave: (report: ScannerReport, status: ScanReportStatus, note: string, reference?: ScannerReference | null) => Promise<void>; onOpenCalibration: (report: ScannerReport, reference: ScannerReference) => void }) {
  const [status, setStatus] = useState<ScanReportStatus>('NEW'); const [note, setNote] = useState('');
  useEffect(() => { setStatus(report?.reviewStatus ?? 'NEW'); setNote(report?.reviewNote ?? ''); }, [report]);
  if (!report) return <section className="report-review lab-panel"><div className="lab-empty"><ListChecks /><h2>Noch kein Fall ausgewählt</h2><p>Die Review-Oberfläche bleibt leer, bis ein echter Fehlscan vorliegt.</p></div></section>;
  return <section className="report-review lab-panel"><div className="lab-panel-title"><div><p>SCAN {report.scanId}</p><h2>Analyse & Vergleich</h2></div><Status value={report.reviewStatus.toLowerCase()} /></div><div className="report-compare"><figure><div>{report.captureImagePath ? <ReportImage report={report} userToken={userToken} /> : <span><ImageIcon />Kein Bild übermittelt</span>}</div><figcaption>Fehlscan · {report.captureType}</figcaption></figure><figure><div>{reference ? <ReferenceImage card={reference} userToken={userToken} /> : <span><Database />Referenz rechts auswählen</span>}</div><figcaption>{reference ? `${reference.nameDe} · ${reference.id}` : report.referenceCardId ? `Zugeordnet: ${report.referenceCardId}` : 'Noch nicht zugeordnet'}</figcaption></figure></div><div className="report-facts"><dl><div><dt>Zeitpunkt</dt><dd>{formatTimestamp(report.createdAt)}</dd></div><div><dt>Name</dt><dd>{report.guessedName ?? 'Nicht erkannt'}</dd></div><div><dt>Set</dt><dd>{report.guessedSet ?? 'Nicht erkannt'}</dd></div><div><dt>Nummer</dt><dd>{report.guessedNumber ?? 'Nicht erkannt'}</dd></div><div><dt>Confidence</dt><dd>{report.confidence === null ? 'Nicht übermittelt' : `${Math.round(report.confidence * 100)} %`}</dd></div><div><dt>Scannerprofil</dt><dd>{report.profileId ? `${report.profileId} · v${report.profileVersion ?? '?'}` : 'Nicht übermittelt'}</dd></div></dl><div className="report-reason"><span>Fehlergrund</span><p>{report.failureReason}</p></div></div>{report.attempts.length > 0 && <div className="report-attempts"><h3>Analyseversuche</h3>{report.attempts.map((attempt, index) => <article key={`${attempt.label}-${index}`}><b>{attempt.label}</b><span>{[attempt.guessedName, attempt.guessedSet, attempt.guessedNumber].filter(Boolean).join(' · ') || 'Keine Identität erkannt'}</span><em>{attempt.confidence === null ? '—' : `${Math.round(attempt.confidence * 100)} %`}</em></article>)}</div>}<div className="report-signals"><div><h3>OCR-Tokens</h3><p>{report.ocrTokens.length ? report.ocrTokens.join(' · ') : 'Nicht übermittelt'}</p></div><div><h3>Zonen-Confidence</h3><p>{Object.keys(report.zoneConfidence).length ? Object.entries(report.zoneConfidence).map(([key, value]) => `${key}: ${Math.round(value * 100)} %`).join(' · ') : 'Nicht übermittelt'}</p></div></div><div className="report-review-form"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as ScanReportStatus)}>{scanReportStatuses.map((item) => <option value={item} key={item}>{reportStatusLabel(item)}</option>)}</select></label><label>Review-Notiz<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Technische Entscheidung dokumentieren …" /></label><div><button disabled={working} onClick={() => void onSave(report, status, note)}><Save /> Review speichern</button><button disabled={working || !reference} onClick={() => reference && void onSave(report, status, note, reference)}><Check /> Referenz zuordnen</button><button className="primary" disabled={!reference} onClick={() => reference && onOpenCalibration(report, reference)}><Layers3 /> In Kalibrierung öffnen</button></div></div></section>;
}

function ReportImage({ report, userToken }: { report: ScannerReport; userToken: () => Promise<string> }) {
  const [source, setSource] = useState('');
  useEffect(() => {
    let objectUrl = ''; const controller = new AbortController(); setSource('');
    void userToken().then((token) => fetch(`/api/admin/scan-reports/${encodeURIComponent(report.documentId)}/image`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }))
      .then((response) => response.ok ? response.blob() : Promise.reject(new Error('IMAGE_UNAVAILABLE')))
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setSource(objectUrl); }).catch(() => undefined);
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [report.documentId, userToken]);
  return source ? <img src={source} alt="Private Fehlscan-Aufnahme" /> : <span><LoaderCircle className="spin" />Privates Bild wird geladen</span>;
}

function ReferenceImage({ card, userToken, thumbnail = false }: { card: ScannerReference; userToken: () => Promise<string>; thumbnail?: boolean }) {
  const [source, setSource] = useState('');
  useEffect(() => {
    let objectUrl = ''; const controller = new AbortController(); setSource('');
    void userToken().then((token) => fetch(`/api/admin/scanner-reference-image/${encodeURIComponent(card.imageFile)}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }))
      .then((response) => response.ok ? response.blob() : Promise.reject(new Error('IMAGE_UNAVAILABLE')))
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setSource(objectUrl); }).catch(() => undefined);
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [card.imageFile, userToken]);
  return source ? <img className={thumbnail ? 'reference-thumbnail' : 'reference-image'} src={source} alt={card.nameDe} loading={thumbnail ? 'lazy' : 'eager'} /> : <span className={thumbnail ? 'reference-thumbnail placeholder' : 'reference-image placeholder'}><ImageIcon /></span>;
}

function formatTimestamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Zeitpunkt unbekannt' : new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
function reportStatusLabel(value: ScanReportStatus) { return ({ NEW: 'Neu', IN_REVIEW: 'In Prüfung', RESOLVED: 'Gelöst', PROFILE_CHANGE_REQUIRED: 'Profiländerung nötig', CANDIDATE_TESTING: 'Candidate-Test', PUBLISHED: 'Veröffentlicht', REJECTED: 'Verworfen' } as const)[value]; }

function CalibrationWorkspace({ reference, profile, selectedZoneId, onSelectZone, onChange, userToken }: { reference: ScannerReference | null; profile: ScannerProfileVersion; selectedZoneId: string; onSelectZone: (id: string) => void; onChange: (value: ScannerProfileVersion) => void; userToken: () => Promise<string> }) {
  const [zoom, setZoom] = useState(1); const [pan, setPan] = useState({ x: 0, y: 0 }); const [image, setImage] = useState('');
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; x: number; y: number; zone: ScannerZone } | null>(null);
  useEffect(() => { let url = ''; if (!reference) { setImage(''); return; } void userToken().then((token) => fetch(`/api/admin/scanner-reference-image/${encodeURIComponent(reference.imageFile)}`, { headers: { Authorization: `Bearer ${token}` } })).then((response) => response.ok ? response.blob() : Promise.reject()).then((blob) => { url = URL.createObjectURL(blob); setImage(url); }).catch(() => setImage('')); return () => { if (url) URL.revokeObjectURL(url); }; }, [reference, userToken]);
  const move = (event: React.PointerEvent<HTMLDivElement>) => { const state = drag.current; if (!state) return; const rect = event.currentTarget.getBoundingClientRect(); const dx = (event.clientX - state.x) / rect.width; const dy = (event.clientY - state.y) / rect.height; const next = profile.zones.map((zone) => zone.id !== state.id ? zone : clampZone(state.mode === 'move' ? { ...state.zone, x: state.zone.x + dx, y: state.zone.y + dy } : { ...state.zone, width: state.zone.width + dx, height: state.zone.height + dy })); onChange({ ...profile, zones: next }); };
  return <section className="calibration-workspace lab-panel"><div className="lab-panel-title"><div><p>KALIBRIERUNGSFLÄCHE</p><h2>{reference?.nameDe ?? 'Referenz auswählen'}</h2></div><span>{reference ? `${reference.setId} · ${reference.localId}` : '—'}</span></div><div className="canvas-tools"><button onClick={() => setZoom((value) => Math.max(.7, value - .1))}><ZoomOut /></button><output>{Math.round(zoom * 100)} %</output><button onClick={() => setZoom((value) => Math.min(2.5, value + .1))}><ZoomIn /></button><label>X <input type="range" min="-40" max="40" value={pan.x} onChange={(event) => setPan((value) => ({ ...value, x: Number(event.target.value) }))} /></label><label>Y <input type="range" min="-40" max="40" value={pan.y} onChange={(event) => setPan((value) => ({ ...value, y: Number(event.target.value) }))} /></label><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><RefreshCw /></button></div><div className="calibration-viewport"><div className="calibration-card" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>{image ? <img src={image} alt={reference?.nameDe ?? ''} draggable={false} /> : <div className="reference-placeholder"><ImageIcon /><span>{reference ? 'Lokales Bild nicht verfügbar' : 'Karte auswählen'}</span></div>}{profile.zones.filter((zone) => zone.enabled).map((zone) => <button className={`analysis-zone zone-${zone.type} ${selectedZoneId === zone.id ? 'selected' : ''}`} style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.width * 100}%`, height: `${zone.height * 100}%` }} onPointerDown={(event) => { event.stopPropagation(); onSelectZone(zone.id); drag.current = { id: zone.id, mode: 'move', x: event.clientX, y: event.clientY, zone }; }} key={zone.id}><span>{zone.label}</span><i onPointerDown={(event) => { event.stopPropagation(); onSelectZone(zone.id); drag.current = { id: zone.id, mode: 'resize', x: event.clientX, y: event.clientY, zone }; }} /></button>)}</div></div><div className="zone-legend">{zoneTypes.slice(0, 9).map((type) => <span className={`zone-${type}`} key={type}><i />{type}</span>)}</div></section>;
}

function ProfileEditor({ profile, selectedZone, onChange, onSelectZone, validation }: { profile: ScannerProfileVersion; selectedZone: ScannerZone | null; onChange: (value: ScannerProfileVersion) => void; onSelectZone: (id: string) => void; validation: string[] }) {
  const patch = <K extends keyof ScannerProfileVersion>(key: K, value: ScannerProfileVersion[K]) => onChange({ ...profile, [key]: value });
  const patchZone = (value: ScannerZone) => patch('zones', profile.zones.map((zone) => zone.id === value.id ? clampZone(value) : zone));
  const add = () => { const zone: ScannerZone = { id: crypto.randomUUID(), type: 'custom', label: 'Neue Zone', enabled: true, x: .3, y: .3, width: .25, height: .12, weight: .5, tolerance: .15, reliability: .5, preprocessingHint: 'auto', notes: '' }; patch('zones', [...profile.zones, zone]); onSelectZone(zone.id); };
  return <aside className="profile-editor lab-panel"><div className="lab-panel-title"><div><p>PROFIL</p><h2>Analysekonfiguration</h2></div><Status value={profile.status} /></div><Field label="Name" value={profile.name} onChange={(value) => patch('name', value)} /><Field label="Beschreibung" value={profile.description} onChange={(value) => patch('description', value)} area /><div className="two-fields"><Select label="Layout-Familie" value={profile.layoutFamily} options={layoutFamilies} onChange={(value) => onChange({ ...profile, layoutFamily: value, scope: profile.scope.level === 'layout' ? { ...profile.scope, value } : profile.scope })} /><Select label="Scope" value={profile.scope.level} options={scopeLevels} onChange={(value) => patch('scope', { level: value as ScannerScopeLevel, value: value === 'global' ? null : profile.scope.value || profile.layoutFamily })} /></div>{profile.scope.level !== 'global' && <Field label="Scope-Wert" value={profile.scope.value ?? ''} onChange={(value) => patch('scope', { ...profile.scope, value })} />}<div className="switch-grid"><Switch label="Frame-assisted" checked={profile.analysisPaths.frameAssisted} onChange={(value) => patch('analysisPaths', { ...profile.analysisPaths, frameAssisted: value })} /><Switch label="Frame-independent Fallback" checked={profile.analysisPaths.frameIndependent} onChange={(value) => onChange({ ...profile, analysisPaths: { ...profile.analysisPaths, frameIndependent: value }, frameFallbackEnabled: value })} /></div><Range label="Confidence" value={profile.confidenceThreshold} onChange={(value) => patch('confidenceThreshold', value)} /><Range label="Globale Toleranz" value={profile.tolerance} onChange={(value) => patch('tolerance', value)} /><div className="zone-heading"><h3>Analysezonen</h3><button onClick={add}><Plus /> Zone</button></div><div className="zone-tabs">{profile.zones.map((zone) => <button className={selectedZone?.id === zone.id ? 'active' : ''} onClick={() => onSelectZone(zone.id)} key={zone.id}><i className={`zone-${zone.type}`} />{zone.label}</button>)}</div>{selectedZone && <div className="zone-form"><div className="zone-form-head"><b>{selectedZone.label}</b><button onClick={() => { const copy = { ...selectedZone, id: crypto.randomUUID(), label: `${selectedZone.label} Kopie`, x: Math.min(.9, selectedZone.x + .02), y: Math.min(.9, selectedZone.y + .02) }; patch('zones', [...profile.zones, clampZone(copy)]); }}><Copy /></button><button className="delete" onClick={() => patch('zones', profile.zones.filter((zone) => zone.id !== selectedZone.id))}><Trash2 /></button></div><Field label="Bezeichnung" value={selectedZone.label} onChange={(value) => patchZone({ ...selectedZone, label: value })} /><Select label="Merkmal" value={selectedZone.type} options={zoneTypes} onChange={(value) => patchZone({ ...selectedZone, type: value as ScannerZoneType })} /><Switch label="Aktiv" checked={selectedZone.enabled} onChange={(value) => patchZone({ ...selectedZone, enabled: value })} /><div className="four-fields">{(['x','y','width','height'] as const).map((key) => <NumberField label={key} value={selectedZone[key]} onChange={(value) => patchZone({ ...selectedZone, [key]: value })} key={key} />)}</div><Range label="Gewicht" value={selectedZone.weight} onChange={(value) => patchZone({ ...selectedZone, weight: value })} /><Range label="Toleranz" value={selectedZone.tolerance} onChange={(value) => patchZone({ ...selectedZone, tolerance: value })} /><Range label="Reliability" value={selectedZone.reliability} onChange={(value) => patchZone({ ...selectedZone, reliability: value })} /><Field label="Preprocessing" value={selectedZone.preprocessingHint} onChange={(value) => patchZone({ ...selectedZone, preprocessingHint: value })} /><Field label="Notizen" value={selectedZone.notes} onChange={(value) => patchZone({ ...selectedZone, notes: value })} area /></div>}<Field label="Versions-Changelog" value={profile.changelog} onChange={(value) => patch('changelog', value)} area />{validation.length > 0 && <ul className="profile-errors">{validation.map((item) => <li key={item}>{item}</li>)}</ul>}</aside>;
}

function Metric({ icon: Icon, label, value, warning = false }: { icon: typeof Database; label: string; value: string; warning?: boolean }) { return <article className={warning ? 'warning' : ''}><Icon /><div><span>{label}</span><b>{value}</b></div></article>; }
function Status({ value }: { value: string }) { return <span className={`profile-status status-${value}`}>{value.toUpperCase()}</span>; }
function Field({ label, value, onChange, area = false }: { label: string; value: string; onChange: (value: string) => void; area?: boolean }) { return <label className="lab-field"><span>{label}</span>{area ? <textarea value={value} rows={3} onChange={(event) => onChange(event.target.value)} /> : <input value={value} onChange={(event) => onChange(event.target.value)} />}</label>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) { return <label className="lab-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>; }
function Range({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="lab-range"><span>{label}<output>{value.toFixed(2)}</output></span><input type="range" min="0" max="1" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="lab-field"><span>{label}</span><input type="number" min="0" max="1" step="0.005" value={value.toFixed(3)} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="lab-switch"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><i />{label}</span></label>; }
