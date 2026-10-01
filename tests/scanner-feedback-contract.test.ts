import { describe, it, expect } from 'vitest';
import { normalizeKnowledgeContext, normalizeRecognitionReference, scannerFeedbackState, scannerFeedbackMessage } from '@/lib/scanner-feedback';
import { normalizeScannerReport } from '@/lib/scanner-report';

const context = { schemaVersion: 1, knowledgeVersion: 1, scannerVersion: 'scanner-v2.1', fingerprint: 'a'.repeat(64) };
const reference = { schemaVersion: 1, sourceSetId: 'sv3', sourceCardId: 'sv3-137', cardNumber: '137', variant: 'reverse' };

describe('original scanner feedback context', () => {
  it('preserves only the four original versioned identity fields', () => {
    expect(normalizeKnowledgeContext({ ...context, photo: 'private', email: 'private' })).toEqual(context);
    expect(normalizeScannerReport({ documentId: 'sample', knowledgeContext: context })?.knowledgeContext).toEqual(context);
  });
  it.each([null, {}, { ...context, fingerprint: 'A'.repeat(64) }, { ...context, fingerprint: 'a'.repeat(63) },
    { ...context, knowledgeVersion: 2 }, { ...context, schemaVersion: 2 }, { ...context, scannerVersion: 'scanner-v3' }])('rejects unsupported/absent context %j', value => {
    expect(normalizeKnowledgeContext(value)).toBeNull();
  });
  it('never derives the fingerprint from photo hashes or OCR', () => {
    expect(normalizeScannerReport({ documentId: 'sample', imageSha256: 'a'.repeat(64), ocrTokens: ['137'] })?.knowledgeContext).toBeNull();
  });
  it('does not turn NEW uploads with injected server metadata into a confirmation', () => {
    const report = normalizeScannerReport({ documentId: 'sample', reviewStatus: 'NEW', knowledgeContext: context,
      recognitionReference: reference, recognitionFeedback: 'READY' });
    expect(report?.recognitionFeedback).toBe('NOT_CONFIRMED');
    expect(report).not.toHaveProperty('recognitionReference');
  });
  it('requires exact reference identity and variant for ready state', () => {
    const report = { reviewStatus: 'RESOLVED', knowledgeContext: context, recognitionReference: reference, referenceCardId: 'sv3-137', referenceVariant: 'reverse' };
    expect(scannerFeedbackState(report)).toBe('READY');
    expect(scannerFeedbackState({ ...report, referenceCardId: 'sv3-138' })).toBe('UNSUPPORTED_REFERENCE');
    expect(scannerFeedbackState({ ...report, referenceVariant: 'holo' })).toBe('UNSUPPORTED_REFERENCE');
    expect(scannerFeedbackState({ ...report, reviewStatus: 'IN_REVIEW' })).toBe('NOT_CONFIRMED');
    expect(scannerFeedbackState({ ...report, knowledgeContext: null })).toBe('NEEDS_NEW_SCAN');
  });
  it('does not accept names instead of catalog identity or invented variants', () => {
    expect(normalizeRecognitionReference(reference)).toEqual(reference);
    expect(normalizeRecognitionReference({ ...reference, sourceCardId: 'Glurak ex' })).toBeNull();
    expect(normalizeRecognitionReference({ ...reference, variant: 'rainbow-custom' })).toBeNull();
  });
  it('explains old report and release limitations instead of claiming model training', () => {
    expect(scannerFeedbackMessage('READY')).toContain('Release 26 noch nicht');
    expect(scannerFeedbackMessage('NEEDS_NEW_SCAN')).toContain('erneut scannen');
  });
});
