import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeScannerReport } from '@/lib/scanner-report';
import { commitDocuments, setWrite } from '@/lib/server/firestore-rest';

describe('scan report normalization', () => {
  it('keeps technical review data and rejects foreign image references', () => {
    const report = normalizeScannerReport({
      documentId: 'scan-1', scanId: 'scan-1', createdAt: '2026-09-02T01:00:00Z', captureType: 'MANUAL_CAPTURE',
      captureImagePath: 'scanner-report-images/other/capture.jpg', reviewStatus: 'IN_REVIEW', confidence: .82,
      ocrTokens: ['Pikachu', '025/165'], zoneConfidence: { name: .9, invalid: 4 },
      attempts: [{ label: 'Analyse 1', guessedName: 'Pikachu', confidence: .82 }],
    });
    expect(report?.captureImagePath).toBeNull();
    expect(report?.captureType).toBe('MANUAL_CAPTURE');
    expect(report?.reviewStatus).toBe('IN_REVIEW');
    expect(report?.zoneConfidence).toEqual({ name: .9 });
    expect(report?.attempts[0].guessedName).toBe('Pikachu');
  });

  it('accepts only the report-owned private image path and verified metadata', () => {
    const report = normalizeScannerReport({
      documentId: 'scan-3', captureType: 'MANUAL_CAPTURE',
      captureImagePath: 'scanner-report-images/scan-3/capture.webp',
      imageSha256: 'a'.repeat(64), imageContentType: 'image/webp', imageSizeBytes: 42,
    });
    expect(report?.captureImagePath).toBe('scanner-report-images/scan-3/capture.webp');
    expect(report?.imageSha256).toBe('a'.repeat(64));
  });

  it('defaults unknown review states without inventing scan results', () => {
    const report = normalizeScannerReport({ documentId: 'scan-2', status: 'UNKNOWN' });
    expect(report?.reviewStatus).toBe('NEW');
    expect(report?.guessedName).toBeNull();
    expect(report?.confidence).toBeNull();
    expect(report?.failureReason).toBe('Kein Fehlergrund übermittelt.');
  });

  it('keeps explicit null confidence unknown and normalizes a real review variant', () => {
    const report = normalizeScannerReport({ documentId: 'scan-null', confidence: null, attempts: [{ confidence: null }], referenceVariant: 'reverse' });
    expect(report?.confidence).toBeNull();
    expect(report?.attempts[0].confidence).toBeNull();
    expect(report?.referenceVariant).toBe('reverse');
  });
});

describe('scan report Firestore persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to the HTTPS commit endpoint with a Firestore resource name and create-only protection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ writeResults: [{}] })));
    vi.stubGlobal('fetch', fetchMock);

    await commitDocuments([
      setWrite('scannerReports', 'scan-1', { schemaVersion: 1, reviewStatus: 'NEW' }, true),
    ], 'Bearer test-only');

    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'cardvault-715ac';
    const documentRoot = `projects/${projectId}/databases/(default)/documents`;
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://firestore.googleapis.com/v1/${documentRoot}:commit`);
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({ writes: [{
      update: {
        name: `${documentRoot}/scannerReports/scan-1`,
        fields: { schemaVersion: { integerValue: '1' }, reviewStatus: { stringValue: 'NEW' } },
      },
      currentDocument: { exists: false },
    }] });
  });

  it('keeps ordinary writes free of create-only preconditions', () => {
    expect(setWrite('scannerReports', 'scan-1', { reviewStatus: 'IN_REVIEW' }))
      .not.toHaveProperty('currentDocument');
    expect(setWrite('scannerReports', 'scan-1', { reviewStatus: 'IN_REVIEW' }, false))
      .not.toHaveProperty('currentDocument');
  });

  it('does not report successful persistence when Firestore rejects the commit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })));
    await expect(commitDocuments([
      setWrite('scannerReports', 'scan-1', { schemaVersion: 1 }, true),
    ], 'Bearer test-only')).rejects.toThrow('FIRESTORE_400');
  });
});
