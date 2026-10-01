import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PATCH } from '@/app/api/admin/scan-reports/route';
import { requireScannerLabToken } from '@/lib/server/firebase-token';
import { loadScannerIndex } from '@/lib/server/scanner-references';
import { privateOperations } from '@/lib/server/private-cloud-operations';
import { encodeFields } from '@/lib/server/firestore-rest';

vi.mock('@/lib/server/firebase-token', () => ({ requireScannerLabToken: vi.fn() }));
vi.mock('@/lib/server/scanner-references', () => ({ loadScannerIndex: vi.fn() }));
vi.mock('@/lib/server/private-cloud-operations', () => ({ privateOperations: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireScannerLabToken).mockResolvedValue({ sub: 'admin-user' } as never);
  vi.mocked(privateOperations).mockResolvedValue({ serverAuthorization: async () => 'Bearer server-only' } as never);
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('scanner report admin route', () => {
  it('atomically confirms the official identity as an Android hint, retaining original analysis key', async () => {
    vi.mocked(loadScannerIndex).mockResolvedValue(scannerIndex(['normal', 'reverse']) as never);
    const source = firestoreReport('scan-1', '2026-09-07T10:00:00Z', 'owner-1');
    const key = { schemaVersion: 1, knowledgeVersion: 1, scannerVersion: 'scanner-v2.1', fingerprint: 'a'.repeat(64) };
    Object.assign(source.fields, encodeFields({ knowledgeContext: key }));
    let commit: { writes: Array<Record<string, any>> } | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input).endsWith(':commit')) { commit = JSON.parse(requestBody(init?.body)); return jsonResponse({ writeResults: [{}, {}] }); }
      return jsonResponse(source);
    }));
    const response = await PATCH(reviewRequest('reverse'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ report: { recognitionFeedback: 'READY', knowledgeContext: key } });
    expect(commit?.writes[0].currentDocument).toEqual({ updateTime: source.updateTime });
    expect(commit?.writes[0].update.fields.recognitionReference).toEqual(encodeFields({ reference: {
      schemaVersion: 1, sourceSetId: 'sv3', sourceCardId: 'sv3-137', cardNumber: '137', variant: 'reverse',
    } }).reference);
    expect(commit?.writes).toHaveLength(2); // Report + audit only; no fake votes, profile release or extra public document.
  });

  it('labels a saved old report without original fingerprint as needing a new scan', async () => {
    vi.mocked(loadScannerIndex).mockResolvedValue(scannerIndex(['normal']) as never);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => requestUrl(input).endsWith(':commit')
      ? jsonResponse({ writeResults: [{}, {}] }) : jsonResponse(firestoreReport('scan-1', '2026-09-07T10:00:00Z'))));
    const response = await PATCH(reviewRequest('normal'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ report: { recognitionFeedback: 'NEEDS_NEW_SCAN', knowledgeContext: null } });
  });

  it('does not recreate a concurrently deleted/edited report or claim success on a rejected atomic commit', async () => {
    vi.mocked(loadScannerIndex).mockResolvedValue(scannerIndex(['normal']) as never);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => requestUrl(input).endsWith(':commit')
      ? jsonResponse({ error: 'Precondition failed' }, 409) : jsonResponse(firestoreReport('scan-1', '2026-09-07T10:00:00Z'))));
    const response = await PATCH(reviewRequest('normal'));
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty('report');
  });

  it('returns all reports newest first to the legacy client across multiple Firestore pages', async () => {
    const documents = Array.from({ length: 61 }, (_, index) => firestoreReport(
      `scan-${String(index).padStart(2, '0')}`,
      new Date(Date.UTC(2026, 8, 24, 0, index)).toISOString(),
    ));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(requestUrl(input));
      expect(url.pathname).toMatch(/\/documents\/scannerReports$/);
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer server-only' });
      expect(url.searchParams.get('pageSize')).toBe('300');
      return url.searchParams.has('pageToken')
        ? jsonResponse({ documents: documents.slice(30) })
        : jsonResponse({ documents: documents.slice(0, 30), nextPageToken: 'legacy/+ cursor' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('https://domidex.web.app/api/admin/scan-reports', {
      headers: { Authorization: 'Bearer admin-token' },
    }));
    const body = await response.json() as { reports: Array<{ documentId: string }>; total: number };

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body.total).toBe(61);
    expect(body.reports.map((report) => report.documentId)).toEqual(documents.map((item) => item.name.split('/').pop()).reverse());
    expect(body).not.toHaveProperty('nextPageToken');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(requestUrl(fetchMock.mock.calls[1][0])).searchParams.get('pageToken')).toBe('legacy/+ cursor');
  });

  it.each(['?pageSize=', '?pageToken='])('keeps explicit pagination for %s even when its value is empty', async (query) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input));
      if (url.pathname.endsWith(':runAggregationQuery')) return jsonResponse([{ result: { aggregateFields: { total: { integerValue: '61' } } } }]);
      expect(url.searchParams.get('pageSize')).toBe('48');
      expect(url.searchParams.get('orderBy')).toBe('createdAt desc');
      return jsonResponse({ documents: [firestoreReport('scan-1', '2026-09-24T10:00:00Z')], nextPageToken: 'next-page' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request(`https://domidex.web.app/api/admin/scan-reports${query}`, {
      headers: { Authorization: 'Bearer admin-token' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 61, nextPageToken: 'next-page' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['', '?pageSize=48'])('returns a visible service error instead of an empty list when Firestore fails for %s', async (query) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'denied' }, 403)));

    const response = await GET(new Request(`https://domidex.web.app/api/admin/scan-reports${query}`, {
      headers: { Authorization: 'Bearer admin-token' },
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: expect.any(String), errorId: expect.any(String) });
    expect(body).not.toHaveProperty('reports');
    expect(body).not.toHaveProperty('total');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('forwards the cursor and returns a stable aggregate total with the next page token', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith(':runAggregationQuery')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer server-only' });
        return jsonResponse([{ result: { aggregateFields: { total: { integerValue: '61' } } } }]);
      }
      return jsonResponse({
        documents: [firestoreReport('scan-old', '2026-09-05T10:00:00Z'), firestoreReport('scan-new', '2026-09-07T10:00:00Z')],
        nextPageToken: 'next/+ cursor',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('https://domidex.web.app/api/admin/scan-reports?pageSize=48&pageToken=current%2F%2B%20cursor', {
      headers: { Authorization: 'Bearer admin-token' },
    }));
    const body = await response.json() as { reports: Array<{ documentId: string }>; total: number; nextPageToken: string | null };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ total: 61, nextPageToken: 'next/+ cursor' });
    expect(body.reports.map((report) => report.documentId)).toEqual(['scan-new', 'scan-old']);
    const listCall = fetchMock.mock.calls.find(([input]) => !requestUrl(input).endsWith(':runAggregationQuery'))!;
    const listUrl = new URL(requestUrl(listCall[0]));
    expect(listUrl.searchParams.get('pageSize')).toBe('48');
    expect(listUrl.searchParams.get('pageToken')).toBe('current/+ cursor');
    expect(listUrl.searchParams.get('orderBy')).toBe('createdAt desc');
  });

  it('persists a catalog-backed variant, preserves owner data and records the exact audit value', async () => {
    vi.mocked(loadScannerIndex).mockResolvedValue(scannerIndex(['normal', 'reverse']) as never);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith('/scannerReports/scan-1')) return jsonResponse(firestoreReport('scan-1', '2026-09-07T10:00:00Z', 'owner-1'));
      if (url.endsWith(':commit')) return jsonResponse({ writeResults: [{}, {}] });
      throw new Error(`Unerwarteter Testaufruf: ${url} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(reviewRequest('reverse'));

    expect(response.status).toBe(200);
    expect(loadScannerIndex).toHaveBeenCalledExactlyOnceWith('Bearer server-only', 'server');
    const commitCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith(':commit'))!;
    const commit = JSON.parse(requestBody(commitCall[1]?.body)) as { writes: Array<{ update: { fields: Record<string, { stringValue?: string }> } }> };
    expect(commit.writes[0].update.fields.ownerUid.stringValue).toBe('owner-1');
    expect(commit.writes[0].update.fields.referenceVariant.stringValue).toBe('reverse');
    expect(commit.writes[1].update.fields.referenceVariant.stringValue).toBe('reverse');
  });

  it('rejects a variant that is not on the selected reference before committing', async () => {
    vi.mocked(loadScannerIndex).mockResolvedValue(scannerIndex(['normal', 'reverse']) as never);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith('/scannerReports/scan-1')) return jsonResponse(firestoreReport('scan-1', '2026-09-07T10:00:00Z', 'owner-1'));
      throw new Error(`Unerwarteter Schreibversuch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(reviewRequest('Fire'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Die gewählte Variante gehört nicht zur Referenzkarte.' });
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).endsWith(':commit'))).toBe(false);
  });

  it('does not write a report review when its server-authenticated reference index is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(loadScannerIndex).mockRejectedValue(new Error('STORAGE_403'));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method ?? 'GET').toBe('GET');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer server-only');
      expect(requestUrl(input)).toMatch(/\/scannerReports\/scan-1$/);
      return jsonResponse(firestoreReport('scan-1', '2026-09-07T10:00:00Z', 'owner-1'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(reviewRequest('reverse'));

    expect(response.status).toBe(503);
    expect(loadScannerIndex).toHaveBeenCalledExactlyOnceWith('Bearer server-only', 'server');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ error: expect.any(String), errorId: expect.any(String) });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('normalizes a missing legacy variant to null during a status-only review', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith('/scannerReports/scan-1')) return jsonResponse(firestoreReport('scan-1', '2026-09-07T10:00:00Z', 'owner-1'));
      if (url.endsWith(':commit')) return jsonResponse({ writeResults: [{}, {}] });
      throw new Error(`Unerwarteter Testaufruf: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(new Request('https://domidex.web.app/api/admin/scan-reports', {
      method: 'PATCH', headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: 'scan-1', reviewStatus: 'IN_REVIEW', reviewNote: 'Wird geprüft' }),
    }));

    expect(response.status).toBe(200);
    const commitCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith(':commit'))!;
    const commit = JSON.parse(requestBody(commitCall[1]?.body)) as { writes: Array<{ update: { fields: Record<string, { nullValue?: null }> } }> };
    expect(commit.writes[0].update.fields.referenceVariant).toEqual({ nullValue: null });
  });
});

function reviewRequest(variant: string) {
  return new Request('https://domidex.web.app/api/admin/scan-reports', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportId: 'scan-1', reviewStatus: 'RESOLVED', reviewNote: 'Geprüft',
      reference: { id: 'sv3-137', cardKey: 'sv3-137', variant },
    }),
  });
}

function firestoreReport(id: string, createdAt: string, ownerUid = 'owner') {
  return {
    name: `projects/test/databases/(default)/documents/scannerReports/${id}`,
    updateTime: '2026-09-24T00:00:00.000000Z',
    fields: {
      scanId: { stringValue: id },
      createdAt: { stringValue: createdAt },
      captureType: { stringValue: 'MANUAL_CAPTURE' },
      reviewStatus: { stringValue: 'NEW' },
      failureReason: { stringValue: 'Echter Testreport.' },
      ownerUid: { stringValue: ownerUid },
    },
  };
}

function scannerIndex(variants: string[]) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-07T00:00:00.000Z',
    stats: {},
    cards: [{
      cardKey: 'sv3-137', id: 'sv3-137', setId: 'sv3', setName: 'Obsidianflammen', series: 'Karmesin & Purpur', localId: '137', nameDe: 'Glurak-ex',
      category: 'Pokemon', rarity: 'Special Illustration Rare', hp: 330, types: ['Fire'], stage: 'Stage2', illustrator: 'Test', dexId: [6], variants,
      imageFile: 'sv3-137.webp', sourceImageUrl: null, referenceAvailable: true, metadataAvailable: true, layoutFamily: 'EX', calibrationStatus: 'unclassified',
    }],
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBody(body: BodyInit | null | undefined) {
  if (typeof body !== 'string') throw new Error('String request body expected.');
  return body;
}
