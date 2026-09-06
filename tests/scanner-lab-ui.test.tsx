// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ScannerLab } from '@/components/scanner-lab';
import { ScannerReportWorkspace } from '@/components/scanner-report-workspace';
import { normalizeScannerReport, type ScannerReport } from '@/lib/scanner-report';

const auth = vi.hoisted(() => ({
  user: { getIdToken: vi.fn(async () => 'admin-token') },
  refreshClaims: vi.fn(async () => undefined),
}));

vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({ user: auth.user, loading: false, isAdmin: true, refreshClaims: auth.refreshClaims }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function report(id: string, name: string, status: 'NEW' | 'RESOLVED' = 'NEW', overrides: Record<string, unknown> = {}): ScannerReport {
  return normalizeScannerReport({ documentId: id, scanId: id, createdAt: '2026-09-06T08:00:00Z', captureType: 'MANUAL_CAPTURE', guessedName: name,
    guessedSet: 'sv3', guessedNumber: name === 'Glurak' ? '125' : '025', reviewStatus: status, failureReason: 'Testreport ohne Bild.', ...overrides })!;
}

function setup(reports = [report('scan-pikachu', 'Pikachu'), report('scan-glurak', 'Glurak', 'RESOLVED')], selectedReportId: string | null = reports[0]?.documentId ?? null, reviewDirty = false) {
  const onRefresh = vi.fn(async () => undefined);
  const onSave = vi.fn(async () => undefined);
  const onSelectReport = vi.fn();
  const onReviewDirtyChange = vi.fn();
  render(<ScannerReportWorkspace reports={reports} totalReports={reports.length} hasMore={false} nextPageToken={null} loadingMore={false} selectedReportId={selectedReportId} profiles={[]} working={false}
    userToken={async () => 'admin-token'} reviewDirty={reviewDirty} onReviewDirtyChange={onReviewDirtyChange} onSelectReport={onSelectReport} onRefresh={onRefresh} onLoadMore={vi.fn(async () => undefined)} onSave={onSave} onOpenCalibration={vi.fn()} />);
  return { onRefresh, onSave, onSelectReport, onReviewDirtyChange };
}

describe('Scanner Lab review workspace', () => {
  it('shows real reports, metrics and filters without inventing a confidence', () => {
    setup();
    expect(screen.getByText('2 Reports')).toBeTruthy();
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

    const confirm = screen.getByRole('button', { name: 'Diese Karte ist korrekt' });
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
    const queue = screen.getByLabelText('Scan-Report Warteschlange');
    expect(await within(queue).findByText('Pikachu')).toBeTruthy();
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
