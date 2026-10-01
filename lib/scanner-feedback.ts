/** Versioned identity-only bridge. Never infer this key from an uploaded JPEG or OCR snippets. */
export interface ScannerKnowledgeContext {
  schemaVersion: 1;
  fingerprint: string;
  scannerVersion: 'scanner-v2.1';
  knowledgeVersion: 1;
}

export interface ScannerRecognitionReference {
  schemaVersion: 1;
  sourceSetId: string;
  sourceCardId: string;
  cardNumber: string;
  variant: string;
}

export function normalizeKnowledgeContext(value: unknown): ScannerKnowledgeContext | null {
  if (!record(value) || value.schemaVersion !== 1 || value.knowledgeVersion !== 1
    || value.scannerVersion !== 'scanner-v2.1' || typeof value.fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.fingerprint)) return null;
  return { schemaVersion: 1, fingerprint: value.fingerprint, scannerVersion: value.scannerVersion, knowledgeVersion: 1 };
}

export function normalizeRecognitionReference(value: unknown): ScannerRecognitionReference | null {
  if (!record(value) || value.schemaVersion !== 1 || !id(value.sourceSetId) || !id(value.sourceCardId)
    || typeof value.cardNumber !== 'string' || !/^[A-Za-z0-9.-]{1,40}$/.test(value.cardNumber)
    || typeof value.variant !== 'string' || !['normal', 'holo', 'reverse', 'metal', 'lenticular'].includes(value.variant)) return null;
  return { schemaVersion: 1, sourceSetId: value.sourceSetId as string, sourceCardId: value.sourceCardId as string,
    cardNumber: value.cardNumber, variant: value.variant };
}

export type ScannerFeedbackState = 'NOT_CONFIRMED' | 'NEEDS_NEW_SCAN' | 'UNSUPPORTED_REFERENCE' | 'READY';

export function scannerFeedbackState(value: Record<string, unknown>): ScannerFeedbackState {
  if (value.reviewStatus !== 'RESOLVED') return 'NOT_CONFIRMED';
  if (!normalizeKnowledgeContext(value.knowledgeContext)) return 'NEEDS_NEW_SCAN';
  const reference = normalizeRecognitionReference(value.recognitionReference);
  return reference && reference.sourceCardId === value.referenceCardId && reference.variant === value.referenceVariant
    ? 'READY' : 'UNSUPPORTED_REFERENCE';
}

export function scannerFeedbackMessage(state: ScannerFeedbackState) {
  switch (state) {
    case 'READY': return 'Korrektur für Scanner und Analyse bereitgestellt. Die kommende App-Version kann sie bei passenden Scans als Erkennungshinweis nutzen; Release 26 noch nicht. Das ist kein neues KI-Training.';
    case 'NEEDS_NEW_SCAN': return 'Karte gespeichert. Dieser Aufnahme fehlt die Analysekennung. Für die Weitergabe an den Scanner bitte mit der kommenden App-Version erneut scannen, manuell ans ScanLab senden und hier bestätigen.';
    case 'UNSUPPORTED_REFERENCE': return 'Karte gespeichert. Die Zuordnung ist noch nicht als eindeutiger Erkennungshinweis nutzbar. Bitte Referenzkarte und Variante erneut prüfen.';
    default: return 'Noch kein Erkennungshinweis freigegeben. Erst „Karte bestätigen und speichern“ gibt eine geprüfte Zuordnung weiter.';
  }
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function id(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value); }
