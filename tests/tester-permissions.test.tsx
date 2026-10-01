// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TesterPermissions } from '@/components/tester-permissions';

const auth = vi.hoisted(() => ({
  user: { getIdToken: vi.fn(async () => 'admin-token') },
  loading: false,
  isAdmin: true,
  isPretester: false,
  hasAppAccess: false,
  hasScannerLabAccess: false,
  refreshClaims: vi.fn(async () => undefined),
}));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => auth }));

function managedUser(overrides: Record<string, unknown> = {}) {
  return { uid: 'reviewer-uid', email: 'reviewer@example.test', displayName: 'Review Person', admin: false, pretester: false, appAccess: false, scannerLabAccess: false, createdAt: null, lastLoginAt: null, ...overrides };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  auth.isAdmin = true;
  auth.hasScannerLabAccess = false;
  auth.isPretester = false;
  auth.hasAppAccess = false;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('Scanner Lab permission management', () => {
  it('changes only the Scanner Lab field and preserves existing app and tester rights', async () => {
    const target = managedUser({ appAccess: true, pretester: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'PATCH'
      ? jsonResponse({ user: { ...target, scannerLabAccess: true } })
      : jsonResponse({ users: [target], nextPageToken: null }));
    vi.stubGlobal('fetch', fetchMock);
    render(<TesterPermissions />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scanner Lab freigeben' }));
    expect(await screen.findByRole('button', { name: 'Scanner Lab sperren' })).toBeTruthy();
    expect(confirm).toHaveBeenCalledOnce();
    const patchRequests = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patchRequests).toHaveLength(1);
    const [url, request] = patchRequests[0];
    expect(url).toBe('/api/admin/testers');
    expect(JSON.parse(request!.body as string)).toEqual({ uid: target.uid, scannerLabAccess: true });
    expect(new Headers(request!.headers).get('Authorization')).toBe('Bearer admin-token');
    expect(screen.getByRole('button', { name: 'Tester entfernen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Web sperren' })).toBeTruthy();
    expect(screen.getByText('ADMIN —')).toBeTruthy();
    expect(screen.getByText(/(?:Fotos|Bilder).*(?:anderer|fremder)|(?:andere|fremde).*Nutzer.*(?:Fotos|Bilder)/i)).toBeTruthy();
  });

  it('keeps a user with only Scanner Lab access in the granted list after a search and grant', async () => {
    const target = managedUser();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ user: target });
      if (init?.method === 'PATCH') return jsonResponse({ user: { ...target, scannerLabAccess: true } });
      return jsonResponse({ users: [], nextPageToken: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TesterPermissions />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox', { name: 'E-Mail-Adresse' }), { target: { value: target.email } });
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Scanner Lab freigeben' }));

    const granted = screen.getByRole('heading', { name: 'Freigeschaltete Nutzer' }).closest('section')!;
    expect(await within(granted).findByText(target.email)).toBeTruthy();
    expect(within(granted).getByRole('button', { name: 'Scanner Lab sperren' })).toBeTruthy();
    expect(within(granted).getByRole('button', { name: 'Web freigeben' })).toBeTruthy();
    expect(within(granted).getByRole('button', { name: 'Tester freigeben' })).toBeTruthy();
    expect(within(granted).getByText('ADMIN —')).toBeTruthy();
    const patchRequest = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')![1]!;
    expect(JSON.parse(patchRequest.body as string)).toEqual({ uid: target.uid, scannerLabAccess: true });
  });

  it.each(['Review Person', null])('requires target and access-scope confirmation before granting Scanner Lab (name=%s)', async (displayName) => {
    const target = managedUser({ displayName });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ users: [target], nextPageToken: null }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.stubGlobal('fetch', fetchMock);
    render(<TesterPermissions />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scanner Lab freigeben' }));

    expect(confirm).toHaveBeenCalledOnce();
    const message = confirm.mock.calls[0][0];
    expect(message).toContain(displayName || 'Ohne Anzeigename');
    expect(message).toContain(target.email);
    expect(message).toContain('Ansehen und Bearbeiten übermittelter Fehlscans');
    expect(message).toContain('privater Fotos anderer Nutzer');
    expect(message).toContain('keine allgemeinen Administratorrechte');
    expect(message).toContain('keine Profiländerungen');
    expect(message).toContain('kein Löschen von Reports');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Scanner Lab freigeben' })).toBeTruthy();
  });

  it.each([
    { field: 'pretester', button: 'Tester freigeben', grantedButton: 'Tester entfernen' },
    { field: 'appAccess', button: 'Web freigeben', grantedButton: 'Web sperren' },
  ])('keeps $field grants independent of Scanner Lab confirmation', async ({ field, button, grantedButton }) => {
    const target = managedUser();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'PATCH'
      ? jsonResponse({ user: { ...target, [field]: true } })
      : jsonResponse({ users: [target], nextPageToken: null }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.stubGlobal('fetch', fetchMock);
    render(<TesterPermissions />);

    fireEvent.click(await screen.findByRole('button', { name: button }));
    expect(await screen.findByRole('button', { name: grantedButton })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    const patchRequests = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patchRequests).toHaveLength(1);
    expect(JSON.parse(patchRequests[0][1]!.body as string)).toEqual({ uid: target.uid, [field]: true });
    expect(screen.getByRole('button', { name: 'Scanner Lab freigeben' })).toBeTruthy();
  });

  it('confirms revocation and removes a lab-only user from the granted list without changing other roles', async () => {
    const target = managedUser({ scannerLabAccess: true });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'PATCH'
      ? jsonResponse({ user: { ...target, scannerLabAccess: false } })
      : jsonResponse({ users: [target], nextPageToken: null }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.stubGlobal('fetch', fetchMock);
    render(<TesterPermissions />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scanner Lab sperren' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Scanner.?Lab.*Review Person/i));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
    expect(screen.getByText(target.email)).toBeTruthy();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Scanner Lab sperren' }));
    await waitFor(() => expect(screen.queryByText(target.email)).toBeNull());
    const patchRequests = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patchRequests).toHaveLength(1);
    expect(JSON.parse(patchRequests[0][1]!.body as string)).toEqual({ uid: target.uid, scannerLabAccess: false });
  });

  it.each([false, true])('denies permission management to a nonadmin with Scanner Lab access=%s', async (hasScannerLabAccess) => {
    auth.isAdmin = false;
    auth.hasScannerLabAccess = hasScannerLabAccess;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<TesterPermissions />);

    expect(screen.getByRole('heading', { name: '403 · Zugriff verweigert' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Scanner Lab freigeben' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Berechtigung erneut prüfen' }));
    expect(auth.refreshClaims).toHaveBeenCalledOnce();
  });
});
