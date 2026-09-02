export const scanReportStatuses = [
  'NEW',
  'IN_REVIEW',
  'RESOLVED',
  'PROFILE_CHANGE_REQUIRED',
  'CANDIDATE_TESTING',
  'PUBLISHED',
  'REJECTED',
] as const;

export type ScanReportStatus = typeof scanReportStatuses[number];

export interface ScanAnalysisAttempt {
  label: string;
  guessedName: string | null;
  guessedSet: string | null;
  guessedNumber: string | null;
  confidence: number | null;
  outcome: string | null;
}

export interface ScannerReport {
  documentId: string;
  scanId: string;
  createdAt: string;
  captureType: string;
  captureImageUrl: string | null;
  attempts: ScanAnalysisAttempt[];
  ocrTokens: string[];
  guessedName: string | null;
  guessedSet: string | null;
  guessedNumber: string | null;
  confidence: number | null;
  zoneConfidence: Record<string, number>;
  profileId: string | null;
  profileVersion: number | null;
  failureReason: string;
  reviewStatus: ScanReportStatus;
  referenceCardId: string | null;
  referenceCardKey: string | null;
  reviewNote: string;
  reviewedAt: string | null;
}

export function normalizeScannerReport(value: Record<string, unknown>): ScannerReport | null {
  const documentId = cleanId(value.documentId);
  const scanId = cleanId(value.scanId) || documentId;
  if (!documentId || !scanId) return null;
  const statusValue = typeof value.reviewStatus === 'string' ? value.reviewStatus : value.status;
  const reviewStatus = scanReportStatuses.includes(statusValue as ScanReportStatus)
    ? statusValue as ScanReportStatus
    : 'NEW';
  return {
    documentId,
    scanId,
    createdAt: cleanText(value.createdAt, 80),
    captureType: cleanText(value.captureType, 80) || 'UNBEKANNT',
    captureImageUrl: safeImageUrl(value.captureImageUrl),
    attempts: Array.isArray(value.attempts) ? value.attempts.slice(0, 4).map(normalizeAttempt) : [],
    ocrTokens: Array.isArray(value.ocrTokens)
      ? value.ocrTokens.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 120)).slice(0, 100)
      : [],
    guessedName: nullableText(value.guessedName, 200),
    guessedSet: nullableText(value.guessedSet, 160),
    guessedNumber: nullableText(value.guessedNumber, 80),
    confidence: nullableUnit(value.confidence),
    zoneConfidence: normalizeConfidenceMap(value.zoneConfidence),
    profileId: nullableId(value.profileId),
    profileVersion: nullablePositiveInteger(value.profileVersion),
    failureReason: cleanText(value.failureReason, 1_000) || 'Kein Fehlergrund übermittelt.',
    reviewStatus,
    referenceCardId: nullableId(value.referenceCardId),
    referenceCardKey: nullableId(value.referenceCardKey),
    reviewNote: cleanText(value.reviewNote, 2_000),
    reviewedAt: nullableText(value.reviewedAt, 80),
  };
}

function normalizeAttempt(value: unknown, index: number): ScanAnalysisAttempt {
  const item = isRecord(value) ? value : {};
  return {
    label: cleanText(item.label, 80) || `Analyse ${index + 1}`,
    guessedName: nullableText(item.guessedName, 200),
    guessedSet: nullableText(item.guessedSet, 160),
    guessedNumber: nullableText(item.guessedNumber, 80),
    confidence: nullableUnit(item.confidence),
    outcome: nullableText(item.outcome, 80),
  };
}

function normalizeConfidenceMap(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const confidence = nullableUnit(item);
    return confidence === null ? [] : [[cleanText(key, 80), confidence]];
  }).filter(([key]) => Boolean(key)));
}

function safeImageUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString().slice(0, 2_000) : null;
  } catch { return null; }
}

function nullableText(value: unknown, maximum: number) { const text = cleanText(value, maximum); return text || null; }
function nullableId(value: unknown) { const id = cleanId(value); return id || null; }
function nullableUnit(value: unknown) { const number = Number(value); return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null; }
function nullablePositiveInteger(value: unknown) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : null; }
function cleanId(value: unknown) { return typeof value === 'string' ? value.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128) : ''; }
function cleanText(value: unknown, maximum: number) { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
