import { requireAdminToken, requireScannerLabToken } from '@/lib/server/firebase-token';
import { privateOperations } from '@/lib/server/private-cloud-operations';
import { serverFailure } from '@/lib/server/server-failure';
import { commitDocuments, getDocument, listDocuments, setWrite } from '@/lib/server/firestore-rest';
import { canTransition, profileStatuses, scannerProductionActionBlockReason, scopeLevels, validateScannerProfile, zoneTypes, type ScannerProfileStatus, type ScannerProfileVersion, type ScannerZone } from '@/lib/scanner-profile';
import { boundedJson } from '@/lib/bounded-json';

// Preserve 64 zones including full 1,000-character notes and profile metadata,
// with room for six-byte JSON unicode escapes and the existing action envelope.
const maximumBodyBytes = 1024 * 1024;

type Action = 'saveDraft' | 'markTesting' | 'createCandidate' | 'publish' | 'rollback';

export async function GET(request: Request) {
  try {
    await requireScannerLabToken(requiredAuthorization(request), request);
    const authorization = await (await privateOperations()).serverAuthorization();
    const [profiles, rawVersions, benchmarks, manifest] = await Promise.all([
      listDocuments('scannerProfiles', authorization), listDocuments('scannerProfileVersions', authorization),
      listDocuments('scannerBenchmarks', authorization), getDocument('scannerReleaseManifest/production', authorization),
    ]);
    const versions = rawVersions as unknown as ScannerProfileVersion[];
    return Response.json({ profiles, versions: versions.sort((a, b) => Number(b.profileVersion) - Number(a.profileVersion)), benchmarks, manifest }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const token = await requireAdminToken(requiredAuthorization(request), request);
    const body = await boundedJson(request, maximumBodyBytes) as { action?: Action; profile?: unknown; sourceDocumentId?: string; confirm?: string; changelog?: string };
    if (!body.action) throw new Error('INVALID_ACTION');
    const publicationBlock = scannerProductionActionBlockReason(body.action);
    if (publicationBlock) return Response.json({ error: publicationBlock, code: 'SCANNER_BENCHMARK_NOT_CONNECTED' }, { status: 409 });
    const authorization = await (await privateOperations()).serverAuthorization();
    const versions = (await listDocuments('scannerProfileVersions', authorization)) as unknown as ScannerProfileVersion[];
    const now = new Date().toISOString(); const actor = String(token.sub);
    if (body.action === 'saveDraft') {
      const input = normalizeProfile(body.profile); const nextVersion = latestVersion(versions, input.profileId) + 1;
      const value: ScannerProfileVersion = { ...input, profileVersion: nextVersion, status: 'draft', createdAt: now, updatedAt: now, createdBy: actor, publishedAt: null, publishedBy: null };
      assertValid(value); await writeVersion(value, authorization, actor, 'DRAFT_SAVED', null);
      return Response.json({ ok: true, version: value });
    }
    const source = versions.find((version) => version.documentId === body.sourceDocumentId);
    if (!source) throw new Error('SOURCE_NOT_FOUND');
    if (body.action === 'markTesting') return transition(source, 'testing', authorization, actor, now, body.changelog);
    if (body.action === 'createCandidate') return transition(source, 'candidate', authorization, actor, now, body.changelog);
    if (body.action === 'publish') {
      if (body.confirm !== 'PUBLISH') throw new Error('CONFIRM_REQUIRED');
      if (source.status !== 'candidate') throw new Error('INVALID_TRANSITION');
      return publishVersion(source, versions, authorization, actor, now, false, body.changelog);
    }
    if (body.action === 'rollback') {
      if (body.confirm !== 'ROLLBACK') throw new Error('CONFIRM_REQUIRED');
      if (!['production', 'deprecated'].includes(source.status)) throw new Error('INVALID_TRANSITION');
      return publishVersion(source, versions, authorization, actor, now, true, body.changelog);
    }
    throw new Error('INVALID_ACTION');
  } catch (error) { return errorResponse(error); }
}

async function transition(source: ScannerProfileVersion, target: ScannerProfileStatus, authorization: string, actor: string, now: string, changelog?: string) {
  if (!canTransition(source.status, target)) throw new Error('INVALID_TRANSITION');
  const versions = (await listDocuments('scannerProfileVersions', authorization)) as unknown as ScannerProfileVersion[];
  const value = { ...source, documentId: undefined, profileVersion: latestVersion(versions, source.profileId) + 1, status: target, createdAt: now, updatedAt: now, createdBy: actor, publishedAt: null, publishedBy: null, changelog: cleanText(changelog || source.changelog, 2_000) };
  assertValid(value); await writeVersion(value, authorization, actor, target === 'testing' ? 'TESTING_CREATED' : 'CANDIDATE_CREATED', source.documentId ?? null);
  return Response.json({ ok: true, version: value });
}

async function publishVersion(source: ScannerProfileVersion, versions: ScannerProfileVersion[], authorization: string, actor: string, now: string, rollback: boolean, changelog?: string) {
  const profileVersions = versions.filter((version) => version.profileId === source.profileId);
  const current = profileVersions.find((version) => version.status === 'production');
  const nextVersion = latestVersion(versions, source.profileId) + 1; const documentId = versionDocumentId(source.profileId, nextVersion);
  const value: ScannerProfileVersion = { ...source, documentId: undefined, profileVersion: nextVersion, status: 'production', createdAt: now, updatedAt: now, createdBy: actor, publishedAt: now, publishedBy: actor, changelog: cleanText(changelog || (rollback ? `Rollback auf v${source.profileVersion}` : source.changelog), 2_000) };
  assertValid(value); const checksum = await checksumFor(value);
  const existingManifest = await getDocument('scannerReleaseManifest/production', authorization) as { profiles?: Record<string, unknown> } | null;
  const manifest = {
    schemaVersion: 1, updatedAt: now, updatedBy: actor,
    checksumAlgorithm: 'SHA-256', checksumEncoding: 'hex', canonicalization: 'domidex-stable-json-v1',
    profiles: { ...existingManifest?.profiles, [source.profileId]: { documentId, profileVersion: nextVersion, checksum, layoutFamily: value.layoutFamily, scope: value.scope } },
    compatibility: { androidIntegration: 'not-connected', profileSchemaVersion: 1, manifestSchemaVersion: 1 }, minClientVersion: null,
  };
  const writes: Array<Record<string, unknown>> = [
    setWrite('scannerProfileVersions', documentId, value as unknown as Record<string, unknown>, true),
    setWrite('scannerProfiles', source.profileId, summary(value, documentId)),
    setWrite('scannerReleaseManifest', 'production', manifest),
    setWrite('scannerAudit', crypto.randomUUID(), audit(rollback ? 'PRODUCTION_ROLLBACK' : 'PRODUCTION_PUBLISHED', actor, source.profileId, documentId, source.documentId ?? null), true),
  ];
  if (current?.documentId) {
    const { documentId: _documentId, ...persistedCurrent } = current;
    writes.push(setWrite('scannerProfileVersions', current.documentId, { ...persistedCurrent, status: 'deprecated', updatedAt: now } as unknown as Record<string, unknown>));
  }
  await commitDocuments(writes, authorization);
  return Response.json({ ok: true, version: { ...value, documentId }, manifest, warning: 'Die echte Android-Scannerengine ist nicht verbunden; es wurden keine Benchmarkwerte erfunden.' });
}

async function writeVersion(value: ScannerProfileVersion, authorization: string, actor: string, action: string, sourceDocumentId: string | null) {
  const documentId = versionDocumentId(value.profileId, value.profileVersion);
  const existing = await getDocument(`scannerProfiles/${value.profileId}`, authorization) as Record<string, unknown> | null;
  const production = typeof existing?.currentProductionDocumentId === 'string' ? existing.currentProductionDocumentId : null;
  await commitDocuments([
    setWrite('scannerProfileVersions', documentId, value as unknown as Record<string, unknown>, true),
    setWrite('scannerProfiles', value.profileId, summary(value, documentId, production)),
    setWrite('scannerAudit', crypto.randomUUID(), audit(action, actor, value.profileId, documentId, sourceDocumentId), true),
  ], authorization);
}

function normalizeProfile(value: unknown): ScannerProfileVersion {
  if (!isRecord(value)) throw new Error('INVALID_PROFILE'); const input = value;
  const scope = isRecord(input.scope) ? input.scope : {}; const paths = isRecord(input.analysisPaths) ? input.analysisPaths : {};
  const zones = Array.isArray(input.zones) ? input.zones.slice(0, 64).map(normalizeZone) : [];
  const status = profileStatuses.includes(input.status as typeof profileStatuses[number]) ? input.status as typeof profileStatuses[number] : 'draft';
  const scopeLevel = scopeLevels.includes(inputValue(scope, 'level') as typeof scopeLevels[number]) ? inputValue(scope, 'level') as typeof scopeLevels[number] : 'global';
  return {
    profileId: cleanId(input.profileId) || crypto.randomUUID(), profileVersion: Number.isInteger(input.profileVersion) ? Number(input.profileVersion) : 0,
    schemaVersion: 1, name: cleanText(input.name, 160), description: cleanText(input.description, 2_000),
    layoutFamily: cleanText(input.layoutFamily, 120), scope: { level: scopeLevel, value: scopeLevel === 'global' ? null : cleanText(scope.value, 160) }, zones,
    confidenceThreshold: finite(input.confidenceThreshold), fallbackPriority: Array.isArray(input.fallbackPriority) ? input.fallbackPriority.filter((item): item is typeof zoneTypes[number] => zoneTypes.includes(item as typeof zoneTypes[number])).slice(0, 11) : [],
    frameRequired: input.frameRequired === true, frameFallbackEnabled: input.frameFallbackEnabled === true,
    analysisPaths: { frameAssisted: paths.frameAssisted !== false, frameIndependent: paths.frameIndependent === true },
    tolerance: finite(input.tolerance), status, createdAt: '', updatedAt: '', createdBy: '', publishedAt: null, publishedBy: null, changelog: cleanText(input.changelog, 2_000),
  };
}

function normalizeZone(value: unknown): ScannerZone { const item = isRecord(value) ? value : {}; const type = zoneTypes.includes(item.type as typeof zoneTypes[number]) ? item.type as typeof zoneTypes[number] : 'custom'; return { id: cleanId(item.id) || crypto.randomUUID(), type, label: cleanText(item.label, 120), enabled: item.enabled !== false, x: finite(item.x), y: finite(item.y), width: finite(item.width), height: finite(item.height), weight: finite(item.weight), tolerance: finite(item.tolerance), reliability: finite(item.reliability), preprocessingHint: cleanText(item.preprocessingHint, 120), notes: cleanText(item.notes, 1_000) }; }
function assertValid(value: ScannerProfileVersion) { const result = validateScannerProfile(value); if (!result.valid) throw new Error(`PROFILE_INVALID:${result.errors.join('|')}`); }
function summary(value: ScannerProfileVersion, documentId: string, currentProductionDocumentId: string | null = null) { return { profileId: value.profileId, name: value.name, description: value.description, layoutFamily: value.layoutFamily, scope: value.scope, latestVersion: value.profileVersion, latestDocumentId: documentId, latestStatus: value.status, updatedAt: value.updatedAt, currentProductionDocumentId: value.status === 'production' ? documentId : currentProductionDocumentId }; }
function audit(action: string, actor: string, profileId: string, documentId: string, sourceDocumentId: string | null) { return { action, actor, profileId, documentId, sourceDocumentId, createdAt: new Date().toISOString() }; }
function latestVersion(versions: ScannerProfileVersion[], profileId: string) { return versions.filter((value) => value.profileId === profileId).reduce((maximum, value) => Math.max(maximum, Number(value.profileVersion) || 0), 0); }
function versionDocumentId(profileId: string, version: number) { return `${profileId}--v${String(version).padStart(4, '0')}`; }
function cleanId(value: unknown) { return typeof value === 'string' ? value.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 120) : ''; }
function cleanText(value: unknown, maximum: number) { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }
function finite(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function requiredAuthorization(request: Request) { const value = request.headers.get('authorization'); if (!value) throw new Error('AUTH_REQUIRED'); return value; }
async function checksumFor(value: ScannerProfileVersion) { const encoded = new TextEncoder().encode(stable(value)); const digest = await crypto.subtle.digest('SHA-256', encoded); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`; return JSON.stringify(value) ?? 'null'; }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function inputValue(value: Record<string, unknown>, key: string) { return value[key]; }
function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN';
  const headers = { 'Cache-Control': 'private, no-store' };
  if (message === 'AUTH_REQUIRED') return Response.json({ error: 'Anmeldung erforderlich.' }, { status: 401, headers });
  if (message === 'ADMIN_REQUIRED') return Response.json({ error: 'Administratorrechte erforderlich.' }, { status: 403, headers });
  if (message === 'SCANNER_LAB_REQUIRED') return Response.json({ error: 'Scanner-Lab-Freigabe erforderlich.' }, { status: 403, headers });
  if (message === 'REQUEST_TOO_LARGE') return Response.json({ error: 'Die Anfrage ist zu groß.' }, { status: 413, headers });
  if (message === 'INVALID_REQUEST') return Response.json({ error: 'Ungültige JSON-Anfrage.' }, { status: 400, headers });
  if (message.startsWith('PROFILE_INVALID:')) return Response.json({ error: message.slice(16).split('|') }, { status: 400, headers });
  const known: Record<string, string> = { INVALID_ACTION: 'Unbekannte Aktion.', SOURCE_NOT_FOUND: 'Ausgangsversion wurde nicht gefunden.', INVALID_TRANSITION: 'Dieser Statuswechsel ist nicht zulässig.', CONFIRM_REQUIRED: 'Explizite Bestätigung fehlt.' };
  if (known[message]) return Response.json({ error: known[message] }, { status: 400, headers });
  return serverFailure('scanner-profiles', error, 'Scannerprofile konnten gerade nicht geladen oder gespeichert werden. Bitte erneut versuchen.');
}
