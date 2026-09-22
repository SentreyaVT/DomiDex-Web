import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PATCH } from '@/app/api/admin/scan-reports/route';
import { requireAdminToken } from '@/lib/server/firebase-token';
import { loadScannerIndex } from '@/lib/server/scanner-references';
import { privateOperations } from '@/lib/server/private-cloud-operations';

vi.mock('@/lib/server/firebase-token', () => ({ requireAdminToken: vi.fn() }));
vi.mock('@/lib/server/scanner-references', () => ({ loadScannerIndex: vi.fn() }));
vi.mock('@/lib/server/private-cloud-operations', () => ({ privateOperations: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAdminToken).mockResolvedValue({ sub: 'admin-user' } as never);
  vi.mocked(privateOperations).mockResolvedValue({ serverAuthorization: async () => 'Bearer server-only' } as never);
});

afterEach(() => vi.unstubAllGlobals());

describe('scanner report admin route', () => {
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
