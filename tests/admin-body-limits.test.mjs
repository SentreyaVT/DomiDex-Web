import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as findTester, PATCH as changeTester } from '@/app/api/admin/testers/route';
import { PUT as saveSite } from '@/app/api/admin/site-content/route';
import { POST as saveProfile } from '@/app/api/admin/scanner-profiles/route';
import { PATCH as reviewReport, DELETE as removeReport } from '@/app/api/admin/scan-reports/route';
import { deleteReport } from '../backend/security/images.mjs';
import { createScannerDraft } from '@/lib/scanner-profile';

const boundary = vi.hoisted(() => ({
  authorize: vi.fn(), serverAuthorization: vi.fn(), deleteReport: vi.fn(),
  findAuthUserByEmail: vi.fn(), setAppAccessClaim: vi.fn(), setPretesterClaim: vi.fn(), setScannerLabAccessClaim: vi.fn(),
  listDocuments: vi.fn(), getDocument: vi.fn(), getDocumentWithVersion: vi.fn(), commitDocuments: vi.fn(),
  actorFor: vi.fn(), documentRead: vi.fn(), storageFile: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@/lib/server/private-cloud-operations', () => ({ privateOperations: async () => boundary }));
vi.mock('@/lib/server/firebase-admin-auth', () => ({
  boundedPageSize: value => Number(value), listManagedUsers: vi.fn(),
  findAuthUserByEmail: boundary.findAuthUserByEmail, setAppAccessClaim: boundary.setAppAccessClaim,
  setPretesterClaim: boundary.setPretesterClaim, setScannerLabAccessClaim: boundary.setScannerLabAccessClaim,
}));
vi.mock('@/lib/server/firestore-rest', () => ({
  listDocuments: boundary.listDocuments, getDocument: boundary.getDocument,
  getDocumentWithVersion: boundary.getDocumentWithVersion, commitDocuments: boundary.commitDocuments,
  listDocumentsPage: vi.fn(), countDocuments: vi.fn(),
  setWrite: (collection, documentId, value, createOnly) => ({ collection, documentId, value, createOnly }),
}));
vi.mock('@/lib/server/scanner-references', () => ({ loadScannerIndex: vi.fn() }));
vi.mock('../backend/security/firebase.mjs', async importOriginal => ({
  ...await importOriginal(), actorFor: boundary.actorFor,
}));

const bearer = 'Bearer local-body-test';
const reportId = 'local-report';
const plainBodies = {
  testerLookup: { email: 'tester@example.invalid' },
  testerChange: { uid: 'local-user', scannerLabAccess: true },
  site: { heroTitle: 'DomiDex', updates: [], roadmap: [] },
  profile: () => ({ action: 'saveDraft', profile: createScannerDraft() }),
  review: { reportId, reviewStatus: 'IN_REVIEW', reviewNote: 'Bitte prüfen.', reference: null },
  delete: { reportId, confirm: `DELETE_SCAN_REPORT:${reportId}` },
};
// Pinned wire-byte limits; full existing field maxima are exercised below.
const routes = [
  { name: 'tester lookup', path: 'testers', method: 'POST', call: findTester, limit: 4096, body: () => plainBodies.testerLookup },
  { name: 'tester role change', path: 'testers', method: 'PATCH', call: changeTester, limit: 4096, body: () => plainBodies.testerChange },
  { name: 'site content', path: 'site-content', method: 'PUT', call: saveSite, limit: 4 * 1024 * 1024, body: () => plainBodies.site },
  { name: 'scanner profile', path: 'scanner-profiles', method: 'POST', call: saveProfile, limit: 1024 * 1024, body: plainBodies.profile },
  { name: 'scan review', path: 'scan-reports', method: 'PATCH', call: reviewReport, limit: 32 * 1024, body: () => plainBodies.review },
  { name: 'scan deletion', path: 'scan-reports', method: 'DELETE', call: removeReport, limit: 4096, body: () => plainBodies.delete },
];

beforeEach(() => {
  vi.resetAllMocks();
  boundary.authorize.mockImplementation(async authorization => {
    if (authorization !== bearer) throw new Error('AUTH_REQUIRED');
    return { sub: 'local-admin', admin: true, scannerLabAccess: true };
  });
  boundary.actorFor.mockImplementation(async request => {
    if (request.headers.get('authorization') !== bearer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 });
    return { uid: 'local-admin', admin: true, authTime: Date.now() };
  });
  boundary.serverAuthorization.mockResolvedValue('Bearer local-iam-fixture');
  boundary.findAuthUserByEmail.mockResolvedValue({ uid: 'local-user' });
  boundary.setScannerLabAccessClaim.mockResolvedValue({ uid: 'local-user', scannerLabAccess: true });
  boundary.listDocuments.mockResolvedValue([]);
  boundary.getDocument.mockResolvedValue(null);
  boundary.getDocumentWithVersion.mockResolvedValue({
    document: { documentId: reportId, scanId: reportId, reviewStatus: 'NEW', captureType: 'MANUAL_CAPTURE' },
    updateTime: '2026-10-01T00:00:00Z',
  });
  boundary.commitDocuments.mockResolvedValue({});
  boundary.documentRead.mockResolvedValue({ exists: false });
  boundary.deleteReport.mockImplementation(request => deleteReport(request, {
    db: { doc: () => ({ get: boundary.documentRead }) }, bucket: { file: boundary.storageFile },
  }));
  boundary.fetch.mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', boundary.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function input(route, source, headers = {}, authorization = bearer) {
  return new Request(`https://example.invalid/api/admin/${route.path}`, {
    method: route.method,
    headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}), ...headers },
    body: source, ...(source instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
}
function chunked(source) {
  const bytes = new TextEncoder().encode(source);
  let offset = 0;
  const cancel = vi.fn();
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const next = Math.min(bytes.length, offset + 1024);
      controller.enqueue(bytes.subarray(offset, next)); offset = next;
    }, cancel,
  });
  return { stream, cancel, bytesPulled: () => offset };
}
function assertNoDataOperations() {
  for (const name of ['findAuthUserByEmail', 'setAppAccessClaim', 'setPretesterClaim', 'setScannerLabAccessClaim',
    'listDocuments', 'getDocument', 'getDocumentWithVersion', 'commitDocuments', 'documentRead', 'storageFile', 'fetch']) {
    expect(boundary[name], name).not.toHaveBeenCalled();
  }
}

for (const route of routes) describe(`${route.name} bounded JSON`, () => {
  it('preserves an ordinary existing request and accepts exactly the byte boundary', async () => {
    const source = JSON.stringify(route.body());
    expect((await route.call(input(route, source))).status).toBe(200);
    const padding = route.limit - new TextEncoder().encode(source).length;
    const exact = chunked(source + ' '.repeat(padding));
    expect((await route.call(input(route, exact.stream))).status).toBe(200);
    expect(exact.cancel).not.toHaveBeenCalled();
  });

  it.each([{}, { 'Content-Length': '1' }])('cancels an oversized real stream with absent or dishonest length: %j', async headers => {
    const body = chunked(JSON.stringify(route.body()) + ' '.repeat(route.limit + 8192));
    const response = await route.call(input(route, body.stream, headers));
    expect(response.status).toBe(413);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(body.cancel).toHaveBeenCalledOnce();
    expect(body.bytesPulled()).toBeLessThanOrEqual(route.limit + 2048);
    assertNoDataOperations();
  });

  it('rejects declared excess before consuming a body', async () => {
    const request = input(route, '{}', { 'Content-Length': String(route.limit + 1) });
    const read = vi.spyOn(request.body, 'getReader');
    expect((await route.call(request)).status).toBe(413);
    expect(read).not.toHaveBeenCalled();
    assertNoDataOperations();
  });

  it.each(['{broken', 'null', '[]', '"text"'])('rejects malformed or non-object JSON safely: %s', async source => {
    const response = await route.call(input(route, source));
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    assertNoDataOperations();
  });

  it('keeps authorization before parsing even an oversized declared body', async () => {
    const request = input(route, '{}', { 'Content-Length': String(route.limit + 1) }, null);
    const read = vi.spyOn(request.body, 'getReader');
    expect((await route.call(request)).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    assertNoDataOperations();
  });
});

const text = length => 'ä'.repeat(length);
const escaped = value => JSON.stringify(value).replaceAll('ä', '\\u00e4');

describe('existing maximum payload compatibility including JSON unicode escapes', () => {
  it('keeps all 50 full updates, 80 roadmap entries and full site fields', async () => {
    const body = {
      heroTitle: text(240), heroSubtitle: text(1000), statusBanner: text(400), currentVersion: text(40),
      currentBuild: text(40), releaseStatus: text(40), discordText: text(1000), kickstarterCta: text(100),
      discordUrl: `https://example.invalid/${'a'.repeat(1976)}`, kickstarterUrl: `https://example.invalid/${'a'.repeat(1976)}`,
      updates: Array.from({ length: 50 }, () => ({ id: text(80), title: text(160), date: text(30), version: text(40),
        build: text(40), summary: text(500), details: text(4000), imageUrl: text(2000), linkUrl: text(2000), active: true })),
      roadmap: Array.from({ length: 80 }, (_, order) => ({ id: text(80), title: text(160), description: text(1000), status: 'Planned', order })),
    };
    const source = escaped(body);
    expect(source.length).toBeGreaterThan(3_000_000);
    expect(source.length).toBeLessThan(routes[2].limit);
    expect((await saveSite(input(routes[2], chunked(source).stream))).status).toBe(200);
    const saved = JSON.parse(boundary.fetch.mock.calls[0][1].body).fields;
    expect(saved.updates.arrayValue.values).toHaveLength(50);
    expect(saved.roadmap.arrayValue.values).toHaveLength(80);
    expect(saved.updates.arrayValue.values[49].mapValue.fields.details.stringValue).toBe(text(4000));
  });

  it('keeps 64 full scanner zones and existing profile text maxima', async () => {
    const draft = createScannerDraft();
    const profile = { ...draft, name: text(160), description: text(2000), layoutFamily: text(120),
      scope: { level: 'layout', value: text(160) }, changelog: text(2000),
      zones: Array.from({ length: 64 }, (_, index) => ({ ...draft.zones[0], id: `zone-${index}`.padEnd(80, 'a'),
        label: text(120), preprocessingHint: text(120), notes: text(1000) })),
    };
    const source = escaped({ action: 'saveDraft', profile, changelog: text(2000) });
    expect(source.length).toBeGreaterThan(500_000);
    expect(source.length).toBeLessThan(routes[3].limit);
    const response = await saveProfile(input(routes[3], chunked(source).stream));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.version.zones).toHaveLength(64);
    expect(saved.version.zones[63].notes).toBe(text(1000));
    expect(saved.version.description).toBe(text(2000));
  });

  it('keeps a full 2000-character review note even when escaped', async () => {
    const body = { ...plainBodies.review, reviewNote: text(2000) };
    const source = escaped(body);
    expect(source.length).toBeGreaterThan(12000);
    const response = await reviewReport(input(routes[4], chunked(source).stream));
    expect(response.status).toBe(200);
    expect((await response.json()).report.reviewNote).toBe(body.reviewNote);
  });

  it('keeps the existing email, UID and deletion-ID maxima', async () => {
    const email = `${'a'.repeat(240)}@example.test`;
    expect(email.length).toBeLessThanOrEqual(254);
    expect((await findTester(input(routes[0], JSON.stringify({ email })))).status).toBe(200);
    expect((await changeTester(input(routes[1], JSON.stringify({ uid: 'a'.repeat(128), scannerLabAccess: true })))).status).toBe(200);
    const id = 'a'.repeat(128);
    expect((await removeReport(input(routes[5], JSON.stringify({ reportId: id, confirm: `DELETE_SCAN_REPORT:${id}` })))).status).toBe(200);
  });
});
