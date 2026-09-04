export const zoneTypes = [
  'collectorNumber', 'setIdentifier', 'cardName', 'artwork', 'hp', 'type',
  'category', 'rarity', 'cardFrame', 'custom', 'ignore',
] as const;

export const profileStatuses = ['draft', 'testing', 'candidate', 'production', 'deprecated'] as const;
export const scopeLevels = ['global', 'layout', 'series', 'set', 'card'] as const;

// No trusted benchmark runner is connected yet. A status change or a stored
// benchmark row is not proof that this profile passed the real scanner engine.
export const scannerPublicationBlockReason = 'Veröffentlichung gesperrt: Die automatische Prüfung mit der echten Scanner-Engine ist noch nicht angebunden. Entwürfe und Fehlscan-Reviews können weiterhin gespeichert werden.';

export function scannerProductionActionBlockReason(action: string): string | null {
  return action === 'publish' || action === 'rollback' ? scannerPublicationBlockReason : null;
}

export type ScannerZoneType = typeof zoneTypes[number];
export type ScannerProfileStatus = typeof profileStatuses[number];
export type ScannerScopeLevel = typeof scopeLevels[number];

export interface ScannerScope { level: ScannerScopeLevel; value: string | null; }

export interface ScannerZone {
  id: string;
  type: ScannerZoneType;
  label: string;
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  weight: number;
  tolerance: number;
  reliability: number;
  preprocessingHint: string;
  notes: string;
}

export interface ScannerProfileVersion {
  documentId?: string;
  profileId: string;
  profileVersion: number;
  schemaVersion: 1;
  name: string;
  description: string;
  layoutFamily: string;
  scope: ScannerScope;
  zones: ScannerZone[];
  confidenceThreshold: number;
  fallbackPriority: ScannerZoneType[];
  frameRequired: boolean;
  frameFallbackEnabled: boolean;
  analysisPaths: { frameAssisted: boolean; frameIndependent: boolean };
  tolerance: number;
  status: ScannerProfileStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  publishedAt: string | null;
  publishedBy: string | null;
  changelog: string;
}

export interface ScannerReference {
  cardKey: string;
  id: string;
  setId: string;
  setName: string | null;
  series: string | null;
  localId: string;
  nameDe: string;
  category: string | null;
  rarity: string | null;
  hp: number | null;
  types: string[];
  stage: string | null;
  illustrator: string | null;
  dexId: number[];
  variants: string[];
  imageFile: string;
  sourceImageUrl?: string | null;
  referenceAvailable: boolean;
  metadataAvailable: boolean;
  layoutFamily: string;
  calibrationStatus: 'unclassified' | 'covered' | 'override';
}

export interface ScannerBenchmark {
  benchmarkId: string;
  profileId: string;
  profileVersion: number;
  mode: 'REAL' | 'NOT_CONNECTED' | 'DEMO';
  startedAt: string;
  completedAt: string | null;
  testedCards: number;
  correct: number;
  incorrect: number;
  notRecognized: number;
  falsePositive: number;
  accuracy: number | null;
  averageConfidence: number | null;
  errorsBySet: Record<string, number>;
  errorsByLayout: Record<string, number>;
  zoneReliability: Record<string, number>;
  problemCards: string[];
  regressionAgainstPrevious: number | null;
}

export const layoutFamilies = [
  'Standard Pokémon', 'Trainer', 'Item', 'Supporter', 'EX', 'GX', 'V', 'VMAX',
  'VSTAR', 'Full Art', 'Illustration Rare', 'Special Illustration Rare', 'Promo', 'Special Layout',
];

export function createScannerDraft(): ScannerProfileVersion {
  const now = new Date().toISOString();
  return {
    profileId: crypto.randomUUID(), profileVersion: 0, schemaVersion: 1,
    name: 'Neues Scannerprofil', description: '', layoutFamily: 'Standard Pokémon',
    scope: { level: 'layout', value: 'Standard Pokémon' },
    zones: [
      zone('collector-number', 'collectorNumber', 'Kartennummer', .06, .88, .34, .08, 1),
      zone('set-identifier', 'setIdentifier', 'Set-Kürzel', .06, .82, .28, .07, .9),
      zone('card-name', 'cardName', 'Kartenname', .08, .05, .64, .1, .75),
      zone('artwork', 'artwork', 'Artwork', .09, .18, .82, .4, .7),
    ],
    confidenceThreshold: .85,
    fallbackPriority: ['collectorNumber', 'setIdentifier', 'cardName', 'artwork'],
    frameRequired: false,
    frameFallbackEnabled: true,
    analysisPaths: { frameAssisted: true, frameIndependent: true },
    tolerance: .15,
    status: 'draft', createdAt: now, updatedAt: now, createdBy: '',
    publishedAt: null, publishedBy: null, changelog: '',
  };
}

export function validateScannerProfile(input: ScannerProfileVersion) {
  const errors: string[] = [];
  if (!input.profileId || input.profileId.length > 120) errors.push('Ungültige Profil-ID.');
  if (!Number.isInteger(input.profileVersion) || input.profileVersion < 0) errors.push('Ungültige Profilversion.');
  if (input.schemaVersion !== 1) errors.push('Nicht unterstützte Schema-Version.');
  if (!input.name.trim() || input.name.length > 160) errors.push('Profilname fehlt oder ist zu lang.');
  if (!layoutFamilies.includes(input.layoutFamily) && !input.layoutFamily.trim()) errors.push('Layout-Familie fehlt.');
  if (!scopeLevels.includes(input.scope.level)) errors.push('Ungültiger Profil-Scope.');
  if (input.scope.level !== 'global' && !input.scope.value?.trim()) errors.push('Der gewählte Scope benötigt einen Wert.');
  if (!profileStatuses.includes(input.status)) errors.push('Ungültiger Profilstatus.');
  if (!unit(input.confidenceThreshold) || !unit(input.tolerance)) errors.push('Confidence und Toleranz müssen zwischen 0 und 1 liegen.');
  if (!input.analysisPaths.frameAssisted && !input.analysisPaths.frameIndependent) errors.push('Mindestens ein Analyseweg muss aktiv sein.');
  if (input.frameRequired && input.frameFallbackEnabled) errors.push('Ein zwingender Frame kann nicht gleichzeitig Frame-Fallback erlauben.');
  if (new Set(input.zones.map((item) => item.id)).size !== input.zones.length) errors.push('Zonen-IDs müssen eindeutig sein.');
  if (input.zones.length > 64) errors.push('Ein Profil darf höchstens 64 Analysezonen enthalten.');
  for (const item of input.zones) {
    if (!item.id || item.id.length > 80) errors.push('Eine Zone hat eine ungültige ID.');
    if (!zoneTypes.includes(item.type)) errors.push(`Zone ${item.id}: ungültiger Typ.`);
    if (![item.x, item.y, item.width, item.height, item.weight, item.tolerance, item.reliability].every(unit)) errors.push(`Zone ${item.id}: Werte müssen zwischen 0 und 1 liegen.`);
    if (item.width <= 0 || item.height <= 0 || item.x + item.width > 1.000001 || item.y + item.height > 1.000001) errors.push(`Zone ${item.id}: Geometrie liegt außerhalb der Karte.`);
  }
  return { valid: errors.length === 0, errors };
}

export function canTransition(from: ScannerProfileStatus, to: ScannerProfileStatus) {
  return (from === 'draft' && to === 'testing') || (from === 'testing' && to === 'candidate') ||
    (from === 'candidate' && to === 'production') || (from === 'production' && to === 'deprecated');
}

export function resolveScannerProfile(profiles: ScannerProfileVersion[], context: { cardId?: string; setId?: string; series?: string; layoutFamily?: string }) {
  const matches = profiles.filter((profile) => profile.status === 'production' && scopeMatches(profile.scope, context));
  return matches.sort((a, b) => scopeRank(b.scope.level) - scopeRank(a.scope.level) || b.profileVersion - a.profileVersion || a.profileId.localeCompare(b.profileId))[0] ?? null;
}

export function clampZone(item: ScannerZone): ScannerZone {
  const width = clamp(item.width, .005, 1); const height = clamp(item.height, .005, 1);
  return { ...item, x: clamp(item.x, 0, 1 - width), y: clamp(item.y, 0, 1 - height), width, height };
}

function zone(id: string, type: ScannerZoneType, label: string, x: number, y: number, width: number, height: number, weight: number): ScannerZone {
  return { id, type, label, enabled: true, x, y, width, height, weight, tolerance: .15, reliability: .8, preprocessingHint: 'auto', notes: '' };
}
function unit(value: number) { return Number.isFinite(value) && value >= 0 && value <= 1; }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum)); }
function scopeRank(level: ScannerScopeLevel) { return scopeLevels.indexOf(level); }
function scopeMatches(scope: ScannerScope, context: { cardId?: string; setId?: string; series?: string; layoutFamily?: string }) {
  if (scope.level === 'global') return true;
  const values = { card: context.cardId, set: context.setId, series: context.series, layout: context.layoutFamily };
  return values[scope.level]?.toLowerCase() === scope.value?.toLowerCase();
}
