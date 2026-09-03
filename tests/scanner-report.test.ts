import { describe, expect, it } from 'vitest';
import { normalizeScannerReport } from '@/lib/scanner-report';

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
    expect(report?.failureReason).toBe('Kein Fehlergrund übermittelt.');
  });
});
