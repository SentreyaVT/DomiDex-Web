import { describe, expect, it } from 'vitest';
import { normalizeScannerReport } from '@/lib/scanner-report';

describe('scan report normalization', () => {
  it('keeps technical review data and strips unsafe image URLs', () => {
    const report = normalizeScannerReport({
      documentId: 'scan-1', scanId: 'scan-1', createdAt: '2026-09-02T01:00:00Z', captureType: 'CAMERA',
      captureImageUrl: 'javascript:alert(1)', reviewStatus: 'IN_REVIEW', confidence: .82,
      ocrTokens: ['Pikachu', '025/165'], zoneConfidence: { name: .9, invalid: 4 },
      attempts: [{ label: 'Analyse 1', guessedName: 'Pikachu', confidence: .82 }],
    });
    expect(report?.captureImageUrl).toBeNull();
    expect(report?.reviewStatus).toBe('IN_REVIEW');
    expect(report?.zoneConfidence).toEqual({ name: .9 });
    expect(report?.attempts[0].guessedName).toBe('Pikachu');
  });

  it('defaults unknown review states without inventing scan results', () => {
    const report = normalizeScannerReport({ documentId: 'scan-2', status: 'UNKNOWN' });
    expect(report?.reviewStatus).toBe('NEW');
    expect(report?.guessedName).toBeNull();
    expect(report?.failureReason).toBe('Kein Fehlergrund übermittelt.');
  });
});
