// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CalibrationWorkspace, ScannerLab } from '@/components/scanner-lab';
import { createScannerDraft, type ScannerReference } from '@/lib/scanner-profile';
import { ScannerReportWorkspace } from '@/components/scanner-report-workspace';
import { normalizeScannerReport, type ScannerReport } from '@/lib/scanner-report';

const auth = vi.hoisted(() => ({
  user: { getIdToken: vi.fn(async () => 'admin-token') },
  refreshClaims: vi.fn(async () => undefined),
  isAdmin: true,
  hasScannerLabAccess: true,
}));

vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({ user: auth.user, loading: false, isAdmin: auth.isAdmin, hasScannerLabAccess: auth.hasScannerLabAccess, refreshClaims: auth.refreshClaims }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); auth.isAdmin = true; auth.hasScannerLabAccess = true; });

function report(id: string, name: string, status: 'NEW' | 'RESOLVED' = 'NEW', overrides: Record<string, unknown> = {}): ScannerReport {
  return normalizeScannerReport({ documentId: id, scanId: id, createdAt: '2026-09-06T08:00:00Z', captureType: 'MANUAL_CAPTURE', guessedName: name,
    guessedSet: 'sv3', guessedNumber: name === 'Glurak' ? '125' : '025', reviewStatus: status, failureReason: 'Testreport ohne Bild.', ...overrides })!;
}

function setup(reports = [report('scan-pikachu', 'Pikachu'), report('scan-glurak', 'Glurak', 'RESOLVED')], selectedReportId: string | null = reports[0]?.documentId ?? null, reviewDirty = false, onReauthenticate?: () => Promise<void>) {
  const onRefresh = vi.fn(async () => undefined);
  const onSave = vi.fn(async () => undefined);
  const onSelectReport = vi.fn();
  const onReviewDirtyChange = vi.fn();
  render(<ScannerReportWorkspace reports={reports} totalReports={reports.length} hasMore={false} nextPageToken={null} loadingMore={false} selectedReportId={selectedReportId} profiles={[]} working={false} canDelete canCalibrate
    userToken={async () => 'admin-token'} reviewDirty={reviewDirty} onReauthenticate={onReauthenticate} onReviewDirtyChange={onReviewDirtyChange} onSelectReport={onSelectReport} onRefresh={onRefresh} onLoadMore={vi.fn(async () => undefined)} onSave={onSave} onOpenCalibration={vi.fn()} />);
  return { onRefresh, onSave, onSelectReport, onReviewDirtyChange };
}

describe('Scanner Lab review workspace', () => {
  it('offers explicit Google reauthentication and requires a fresh deletion confirmation afterward', async () => {
    const reauthenticate = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'DELETE'
      ? new Response(JSON.stringify({ ok: false, error: 'RECENT_LOGIN_REQUIRED' }), { status: 401 })
      : jsonResponse({ connected: false, cards: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    setup([report('scan-auth', 'Pikachu')], 'scan-auth', false, reauthenticate);
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Zur Bestätigung/ }), { target: { value: 'LÖSCHEN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Google-Anmeldung bestätigen' }));
    await waitFor(() => expect(reauthenticate).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Es wurde nichts automatisch gelöscht/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByRole('checkbox', { name: /Scan-Report .* zum Löschen auswählen/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('explains when an old confirmed image is saved but cannot feed the scanner', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ connected: false, cards: [], total: 0 })));
    setup([report('old-image', 'Pikachu', 'RESOLVED')]);
    expect(screen.getByRole('status', { name: 'Weitergabe an Scanner und Analyse' }).textContent).toContain('fehlt die Analysekennung');
    expect(screen.getByRole('status', { name: 'Weitergabe an Scanner und Analyse' }).textContent).toContain('erneut scannen');
  });

  it('shows the exact Android-version limitation for a ready lab hint', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ connected: false, cards: [], total: 0 })));
    setup([report('reviewed-image', 'Pikachu', 'RESOLVED', {
      knowledgeContext: { schemaVersion: 1, fingerprint: 'a'.repeat(64), knowledgeVersion: 1, scannerVersion: 'scanner-v2.1' },
      referenceCardId: 'sv3-025', referenceVariant: 'normal',
      recognitionReference: { schemaVersion: 1, sourceSetId: 'sv3', sourceCardId: 'sv3-025', cardNumber: '025', variant: 'normal' },
    })]);
    expect(screen.getByRole('status', { name: 'Weitergabe an Scanner und Analyse' }).textContent).toContain('Scanner und Analyse bereitgestellt');
    expect(screen.getByRole('status', { name: 'Weitergabe an Scanner und Analyse' }).textContent).toContain('Release 26 noch nicht');
  });

  it('shows an unknown loading state instead of zero reports before the first response', async () => {
    let resolveReports!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === '/api/admin/scanner-profiles') return jsonResponse({ profiles: [], versions: [], benchmarks: [], manifest: null });
      if (url.startsWith('/api/admin/scan-reports?')) return new Promise<Response>((resolve) => { resolveReports = resolve; });
      return jsonResponse({ connected: false, cards: [], total: 0, page: 1, pageSize: 24, stats: null });
    }));
    render(<ScannerLab />);
    expect(screen.getByRole('status').textContent).toContain('Fehlscans werden geladen');
    expect(screen.queryByText('0 Fehlscans')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Keine passenden Fehlscans' })).toBeNull();
    expect(screen.queryByLabelText('Scan-Report Warteschlange')).toBeNull();
    expect(screen.getByRole('button', { name: 'Fehlscans' }).textContent).not.toContain('0');
    await waitFor(() => expect(resolveReports).toBeTypeOf('function'));
    await act(async () => { resolveReports(jsonResponse({ reports: [], total: 0 })); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('0 Fehlscans')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Keine passenden Fehlscans' })).toBeTruthy();
  });

  it('keeps a failed initial list unknown and shows a real zero only after a successful retry', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === '/api/admin/scanner-profiles') return jsonResponse({ profiles: [], versions: [], benchmarks: [], manifest: null });
      if (url.startsWith('/api/admin/scan-reports?')) {
        attempts += 1;
        return attempts === 1
          ? new Response(JSON.stringify({ error: 'Fehlscans derzeit nicht erreichbar.', errorId: 'reports-unavailable' }), { status: 503 })
          : jsonResponse({ reports: [], total: 0 });
      }
      return jsonResponse({ connected: false, cards: [], total: 0, page: 1, pageSize: 24, stats: null });
    }));
    render(<ScannerLab />);
    expect(await screen.findByText(/Die Anzahl der Fehlscans ist noch unbekannt/)).toBeTruthy();
    expect(screen.getByText(/Fehler-ID: reports-unavailable/)).toBeTruthy();
    expect(screen.queryByText('0 Fehlscans')).toBeNull();
    expect(screen.queryByLabelText('Scan-Report Warteschlange')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Keine passenden Fehlscans' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fehlscans erneut laden' }));
    expect(await screen.findByText('0 Fehlscans')).toBeTruthy();
    expect(screen.queryByText(/Die Anzahl der Fehlscans ist noch unbekannt/)).toBeNull();
  });

  it('keeps loaded reports visible while refreshing and explains a failed refresh', async () => {
    let attempts = 0;
    let resolveRefresh!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === '/api/admin/scanner-profiles') return jsonResponse({ profiles: [], versions: [], benchmarks: [], manifest: null });
      if (url.startsWith('/api/admin/scan-reports?')) {
        attempts += 1;
        if (attempts === 1) return jsonResponse({ reports: [report('scan-existing', 'Pikachu')], total: 1 });
        return new Promise<Response>((resolve) => { resolveRefresh = resolve; });
      }
      return jsonResponse({ connected: false, cards: [], total: 0, page: 1, pageSize: 24, stats: null });
    }));
    render(<ScannerLab />);
    const queue = await screen.findByLabelText('Scan-Report Warteschlange');
    expect(within(queue).getByText('Pikachu')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fehlscans aktualisieren' }));
    expect(screen.getByText(/Die zuletzt geladenen Einträge bleiben sichtbar/).getAttribute('role')).toBe('status');
    expect(within(queue).getByText('Pikachu')).toBeTruthy();
    await waitFor(() => expect(resolveRefresh).toBeTypeOf('function'));
    await act(async () => { resolveRefresh(new Response(JSON.stringify({ error: 'Aktualisierung nicht möglich.' }), { status: 503 })); });
    expect(screen.getByText(/Neue Änderungen konnten nicht abgerufen werden/)).toBeTruthy();
    expect(screen.getByText('1 Fehlscans')).toBeTruthy();
    expect(within(queue).getByText('Pikachu')).toBeTruthy();
    expect(screen.queryByText(/Fehlscans werden aktualisiert/)).toBeNull();
  });

  it('lets Lab-only users review reports through three clear steps without admin controls', async () => {
    auth.isAdmin = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === '/api/admin/scanner-profiles') return jsonResponse({ profiles: [], versions: [], benchmarks: [], manifest: null });
      if (url.startsWith('/api/admin/scan-reports?')) return jsonResponse({ reports: [report('scan-lab', 'Pikachu')], total: 1 });
      if (url === '/api/admin/scan-reports' && init?.method === 'PATCH') return jsonResponse({ ok: true });
      return jsonResponse({ connected: true, cards: [], total: 0, page: 1, pageSize: 24, stats: null });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ScannerLab />);
    expect(within(await screen.findByLabelText('Scan-Report Warteschlange')).getByText('Pikachu')).toBeTruthy();
    const guide = screen.getByRole('list', { name: 'So prüfst du einen Fehlscan' });
    expect(within(guide).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByText('Neu').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Startseite' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('link', { name: 'Administration' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Expertenbereich: Scannerprofile' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Löschen' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Profil visuell prüfen' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Notiz zur Prüfung (optional)' }), { target: { value: 'Kartennummer schwer lesbar' } });
    fireEvent.click(screen.getByRole('button', { name: 'In Prüfung speichern' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => requestUrl(input) === '/api/admin/scan-reports' && init?.method === 'PATCH')).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')![1]!;
    expect(JSON.parse(patch.body as string)).toEqual({ reportId: 'scan-lab', reviewStatus: 'IN_REVIEW', reviewNote: 'Kartennummer schwer lesbar' });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE' || init?.method === 'POST')).toBe(false);
  });

  it('denies users without an explicit Lab grant before any report or image request', async () => {
    auth.isAdmin = false;
    auth.hasScannerLabAccess = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ScannerLab />);
    expect(screen.getByRole('heading', { name: '403 · Scanner Lab geschützt' })).toBeTruthy();
    await act(async () => undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers one clear way back from an empty filtered list', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('Name, Set, Nummer oder Scan-ID suchen'), { target: { value: 'does-not-exist' } });
    expect(screen.getByRole('heading', { name: 'Keine passenden Fehlscans' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alle Fehlscans anzeigen' }));
    expect(within(screen.getByLabelText('Scan-Report Warteschlange')).getByText('Pikachu')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Alle Fehlscans anzeigen' })).toBeNull();
  });

  it('names calibration controls and permits keyboard-style zone selection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === '/api/admin/scanner-profiles') return jsonResponse({ profiles: [], versions: [], benchmarks: [], manifest: null });
      if (url.startsWith('/api/admin/scan-reports?')) return jsonResponse({ reports: [], total: 0 });
      return jsonResponse({ connected: true, cards: [], total: 0, page: 1, pageSize: 24, stats: null });
    }));
    render(<ScannerLab />);
    fireEvent.click(screen.getByRole('button', { name: 'Expertenbereich: Scannerprofile' }));
    expect(screen.getByRole('textbox', { name: 'Kalibrierungsreferenz suchen' })).toBeTruthy();
    for (const name of ['Vorherige Kalibrierungsreferenzseite', 'Nächste Kalibrierungsreferenzseite', 'Kalibrierungsbild verkleinern', 'Kalibrierungsbild vergrößern', 'Kalibrierungsansicht zurücksetzen', 'Analysezone duplizieren', 'Analysezone löschen']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    const zone = createScannerDraft().zones.find((item) => item.enabled)!;
    fireEvent.click(screen.getByRole('button', { name: `Analysezone ${zone.label} auswählen` }));
    expect((screen.getByRole('textbox', { name: 'Bezeichnung' }) as HTMLInputElement).value).toBe(zone.label);
    await act(async () => undefined);
  });

  it('never overlays a late image from the previous calibration card', async () => {
    const pending = new Map<string, (response: Response) => void>();
    const makeUrl = vi.fn(() => 'blob:current-card');
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = makeUrl;
      static revokeObjectURL = revoke;
    });
    vi.stubGlobal('fetch', vi.fn((url: string) => new Promise<Response>((resolve) => pending.set(url, resolve))));
    const reference = (id: string) => ({ id, imageFile: `${id}.webp`, nameDe: id, setId: 'sv3', localId: id } as ScannerReference);
    const token = async () => 'test-admin';
    const props = { profile: createScannerDraft(), selectedZoneId: '', onSelectZone: vi.fn(), onChange: vi.fn(), userToken: token };
    const view = render(<CalibrationWorkspace {...props} reference={reference('old')} />);
    await waitFor(() => expect(pending.has('/api/admin/scanner-reference-image/old.webp')).toBe(true));
    view.rerender(<CalibrationWorkspace {...props} reference={reference('current')} />);
    await waitFor(() => expect(pending.has('/api/admin/scanner-reference-image/current.webp')).toBe(true));
    await act(async () => { pending.get('/api/admin/scanner-reference-image/current.webp')!(new Response(new Blob(['current']))); });
    expect((await screen.findByRole('img', { name: 'current' })).getAttribute('src')).toBe('blob:current-card');
    await act(async () => { pending.get('/api/admin/scanner-reference-image/old.webp')!(new Response(new Blob(['old']))); });
    expect(makeUrl).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: 'current' }).getAttribute('src')).toBe('blob:current-card');
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:current-card');
  });

  it('keeps reports usable when profiles fail and retries only the failed resource', async () => {
    let profileAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === '/api/admin/scanner-profiles') {
        profileAttempts += 1;
        return profileAttempts === 1
          ? new Response(JSON.stringify({ error: 'Profile derzeit nicht erreichbar.', errorId: 'safe-id' }), { status: 503 })
          : jsonResponse({ profiles: [], versions: [], benchmarks: [], manifest: null });
      }
      if (url.startsWith('/api/admin/scan-reports?')) return jsonResponse({ reports: [report('scan-pikachu', 'Pikachu')], total: 1 });
      return jsonResponse({ connected: false, cards: [], total: 0, page: 1, pageSize: 24, stats: null });
    }));
    render(<ScannerLab />);
    expect(within(await screen.findByLabelText('Scan-Report Warteschlange')).getByText('Pikachu')).toBeTruthy();
    expect(await screen.findByText(/Fehler-ID: safe-id/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Profile erneut laden' }));
    await waitFor(() => expect(screen.queryByText(/Fehler-ID: safe-id/)).toBeNull());
    expect(profileAttempts).toBe(2);
  });

  it('shows real reports, metrics and filters without inventing a confidence', () => {
    setup();
    expect(screen.getByText('2 Fehlscans')).toBeTruthy();
    const queue = screen.getByLabelText('Scan-Report Warteschlange');
    expect(within(queue).getByText('Pikachu')).toBeTruthy();
    expect(screen.getAllByText('Nicht übermittelt').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText('Name, Set, Nummer oder Scan-ID suchen'), { target: { value: 'Glurak' } });
    expect(within(queue).queryByText('Pikachu')).toBeNull();
    expect(within(queue).getByText('Glurak')).toBeTruthy();
  });

  it('cancels a destructive action without calling the server', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    setup([report('scan-pikachu', 'Pikachu')]);
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires the explicit phrase and refreshes after an exact report deletion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, reportDeleted: true, imageDeleted: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = setup([report('scan-pikachu', 'Pikachu')]);
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    const finalButton = screen.getByRole('button', { name: 'Endgültig löschen' });
    expect((finalButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Zur Bestätigung/), { target: { value: 'LÖSCHEN' } });
    fireEvent.click(finalButton);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/scan-reports', expect.objectContaining({ method: 'DELETE' }));
    const [, request] = fetchMock.mock.calls.find(([url, init]) => requestUrl(url) === '/api/admin/scan-reports' && init?.method === 'DELETE') as [string, RequestInit];
    expect(request.headers).toMatchObject({ Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' });
    expect(typeof request.body).toBe('string');
    expect(JSON.parse(request.body as string)).toEqual({ reportId: 'scan-pikachu', confirm: 'DELETE_SCAN_REPORT:scan-pikachu' });
  });

  it('uses descriptive names for report and reference pagination', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Vorherige Report-Seite' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nächste Report-Seite' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Andere Karte auswählen' }));
    expect(screen.getByRole('button', { name: 'Vorherige Referenzseite' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nächste Referenzseite' })).toBeTruthy();
  });

  it('selects the next open report after the current index', () => {
    const reports = [report('scan-first', 'Pikachu'), report('scan-current', 'Glurak'), report('scan-next', 'Evoli')];
    const { onSelectReport } = setup(reports, 'scan-current');
    fireEvent.click(screen.getByRole('button', { name: /Nächster offener Fall/ }));
    expect(onSelectReport).toHaveBeenCalledWith('scan-next');
  });

  it('does not lose unsaved review changes when another report is selected', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const reports = [report('scan-current', 'Pikachu'), report('scan-next', 'Evoli')];
    const { onSelectReport } = setup(reports, 'scan-current', true);
    const queue = screen.getByLabelText('Scan-Report Warteschlange');

    fireEvent.click(within(queue).getByText('Evoli').closest('button')!);
    expect(confirm).toHaveBeenCalledWith('Ungespeicherte Review-Änderungen verwerfen?');
    expect(onSelectReport).not.toHaveBeenCalled();
  });

  it('toggles original image size off again', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const imageReport = report('scan-image', 'Pikachu', 'NEW', { captureImagePath: 'scanner-report-images/scan-image/capture.webp' });
    setup([imageReport]);
    const toggle = screen.getByRole('button', { name: 'Originalgröße' });
    const stage = document.querySelector('.sl-image-stage');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(stage?.classList.contains('original')).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(stage?.classList.contains('original')).toBe(false);
  });

  it('waits for thumbnail intersection before fetching the private image', async () => {
    let reveal: (() => void) | null = null;
    class IntersectionObserverMock {
      private readonly callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) { this.callback = callback; }
      observe(target: Element) {
        reveal = () => this.callback([{ isIntersecting: true, intersectionRatio: 1, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    const imageReport = report('scan-lazy', 'Pikachu', 'NEW', { captureImagePath: 'scanner-report-images/scan-lazy/capture.webp' });
    setup([imageReport], null);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(reveal).not.toBeNull();
    act(() => { reveal?.(); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestUrl(fetchMock.mock.calls[0][0])).toContain('/api/admin/scan-reports/scan-lazy/image?view=thumb');
  });

  it('does not send a set name as an exact set id', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>().mockResolvedValue(jsonResponse({ connected: true, cards: [], total: 0, page: 1, pageSize: 12 }));
    vi.stubGlobal('fetch', fetchMock);
    const setNameReport = report('scan-set-name', 'Pikachu', 'NEW', { guessedName: null, guessedNumber: null, guessedSet: 'Obsidianflammen' });
    setup([setNameReport]);
    fireEvent.click(screen.getByRole('button', { name: 'Andere Karte auswählen' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = requestUrl(fetchMock.mock.calls[0][0]);
    expect(url).toContain('q=Obsidianflammen');
    expect(url).not.toContain('setId=');
    expect(url).toContain('set=Obsidianflammen');
  });

  it('resolves a printed collector fraction to one real catalog card before confirmation', async () => {
    const card = {
      cardKey: 'sv3-137', id: 'sv3-137', setId: 'sv3', setName: 'Obsidianflammen', series: 'Karmesin & Purpur', localId: '137', nameDe: 'Glurak-ex',
      category: 'Pokemon', rarity: 'Special Illustration Rare', hp: 330, types: ['Fire'], stage: 'Stage2', illustrator: 'Test', dexId: [6], variants: [],
      imageFile: 'sv3-137.webp', sourceImageUrl: null, referenceAvailable: true, metadataAvailable: true, layoutFamily: 'EX', calibrationStatus: 'unclassified',
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>().mockResolvedValue(jsonResponse({ connected: true, cards: [card], total: 1, page: 1, pageSize: 48 }));
    vi.stubGlobal('fetch', fetchMock);
    const { onSave } = setup([report('scan-fraction', 'Glurak', 'NEW', { guessedSet: 'sv3', guessedNumber: '137/197' })]);

    const confirm = screen.getByRole('button', { name: 'Karte bestätigen und speichern' });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText('Glurak-ex · sv3 · 137')).toBeTruthy();
    expect(requestUrl(fetchMock.mock.calls[0][0])).toContain('q=137&setId=sv3');
    fireEvent.click(confirm);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'scan-fraction' }), 'RESOLVED', '', { reference: card, variant: null }));
  });

  it('preserves an alphanumeric promo collector number before the printed total', async () => {
    const card = {
      cardKey: 'swshp-SWSH001', id: 'swshp-SWSH001', setId: 'swshp', setName: 'SWSH Black Star Promos', series: 'Schwert & Schild', localId: 'SWSH001', nameDe: 'Grookey',
      category: 'Pokemon', rarity: 'Promo', hp: 60, types: ['Grass'], stage: 'Basic', illustrator: 'Test', dexId: [810], variants: ['holo'],
      imageFile: 'swshp-SWSH001.webp', sourceImageUrl: null, referenceAvailable: true, metadataAvailable: true, layoutFamily: 'STANDARD', calibrationStatus: 'unclassified',
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>().mockResolvedValue(jsonResponse({ connected: true, cards: [card], total: 1, page: 1, pageSize: 48 }));
    vi.stubGlobal('fetch', fetchMock);
    setup([report('scan-promo', 'Grookey', 'NEW', { guessedSet: 'swshp', guessedNumber: 'SWSH001/SWSH300' })]);

    await screen.findByText('Grookey · swshp · SWSH001');
    expect(requestUrl(fetchMock.mock.calls[0][0])).toContain('q=SWSH001&set=swshp');
  });

  it('appends a cursor page without duplicating reports or shrinking the known total', async () => {
    const cursor = 'cursor/+ value';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === '/api/admin/scanner-profiles') return jsonResponse({ profiles: [], versions: [], benchmarks: [], manifest: null });
      if (url.includes('/api/admin/scan-reports?pageSize=48&pageToken=')) {
        return jsonResponse({ reports: [report('scan-glurak', 'Glurak', 'RESOLVED'), report('scan-evoli', 'Evoli')], total: 2, nextPageToken: null });
      }
      if (url === '/api/admin/scan-reports?pageSize=48') {
        return jsonResponse({ reports: [report('scan-pikachu', 'Pikachu'), report('scan-glurak', 'Glurak', 'RESOLVED')], total: 60, nextPageToken: cursor });
      }
      if (url.startsWith('/api/admin/scanner-references?')) return jsonResponse({ connected: false, cards: [], total: 0, page: 1, pageSize: 24, stats: null });
      throw new Error(`Unerwarteter Testaufruf: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ScannerLab />);
    const queue = await screen.findByLabelText('Scan-Report Warteschlange');
    expect(within(queue).getByText('Pikachu')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Mehr/ }));

    expect(await screen.findByText('Evoli')).toBeTruthy();
    expect(screen.getByText(/3\/60 geladen/)).toBeTruthy();
    expect(within(queue).getAllByText('Glurak')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => requestUrl(url) === `/api/admin/scan-reports?pageSize=48&pageToken=${encodeURIComponent(cursor)}`)).toBe(true);
  });
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
