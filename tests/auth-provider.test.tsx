// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { reauthenticateWithPopup, signOut } from 'firebase/auth';
import { AuthProvider, useAuth } from '@/components/auth-provider';

const mock = vi.hoisted(() => ({
  auth: { currentUser: null as User | null },
  tokenChanged: null as null | ((user: User | null) => void),
  snapshots: [] as Array<{ uid: string; next: (snapshot: { data: () => Record<string, unknown> | undefined; metadata: { fromCache: boolean } }) => void; error: () => void; stop: ReturnType<typeof vi.fn> }>,
}));
vi.mock('@/lib/firebase-client', () => ({ firebaseAuth: mock.auth, firestore: {}, googleProvider: {} }));
vi.mock('firebase/auth', () => ({
  getRedirectResult: vi.fn().mockResolvedValue(null),
  onIdTokenChanged: (_auth: unknown, next: (user: User | null) => void) => { mock.tokenChanged = next; return vi.fn(); },
  signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(), signOut: vi.fn(), reauthenticateWithPopup: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_store: unknown, _collection: string, uid: string) => ({ uid }),
  onSnapshot: (ref: { uid: string }, _options: unknown, next: typeof mock.snapshots[number]['next'], error: () => void) => {
    const stop = vi.fn(); mock.snapshots.push({ uid: ref.uid, next, error, stop }); return stop;
  },
}));

const account = (uid: string, claims: Record<string, unknown> = { admin: true }) => ({ uid, getIdToken: vi.fn().mockResolvedValue('fresh-token'), getIdTokenResult: vi.fn<(_force?: boolean) => Promise<{ claims: Record<string, unknown> }>>().mockResolvedValue({ claims }) });
const snapshot = (data?: Record<string, unknown>, fromCache = false) => ({ data: () => data, metadata: { fromCache } });
async function signIn(user: ReturnType<typeof account>) {
  await act(async () => { mock.auth.currentUser = user as unknown as User; mock.tokenChanged!(mock.auth.currentUser); });
}
beforeEach(() => { vi.useFakeTimers(); mock.auth.currentUser = null; mock.tokenChanged = null; mock.snapshots.length = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('server-confirmed access monitoring', () => {
  it('reauthenticates the same Google user and refreshes tokens without signing out or replacing the access subscription', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    const user = account('owner'); await signIn(user);
    act(() => mock.snapshots[0].next(snapshot()));
    const before = mock.snapshots.length;
    await act(async () => { await result.current.reauthenticate(); });
    expect(reauthenticateWithPopup).toHaveBeenCalledWith(user, {});
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(user.getIdTokenResult).toHaveBeenLastCalledWith(true);
    expect(signOut).not.toHaveBeenCalled(); expect(mock.snapshots.length).toBe(before);
    expect(result.current.isAdmin).toBe(true);
  });

  it('does not silently retry or treat cancelled Google confirmation as successful', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    const user = account('owner'); await signIn(user);
    vi.mocked(reauthenticateWithPopup).mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });
    await expect(result.current.reauthenticate()).rejects.toMatchObject({ code: 'auth/popup-closed-by-user' });
    expect(user.getIdToken).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
  });

  it.each(['switch', 'logout'])('does not restore the old account after %s during reauthentication token refresh', async (change) => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    const old = account('old-admin'); await signIn(old);
    act(() => mock.snapshots[0].next(snapshot()));
    let finishToken!: (token: string) => void;
    old.getIdToken.mockImplementationOnce(() => new Promise<string>((resolve) => { finishToken = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.reauthenticate(); });
    const rejected = expect(pending).rejects.toThrow('Konto hat sich geändert');
    if (change === 'switch') await signIn(account('new-user', { appAccess: true }));
    else await act(async () => { mock.auth.currentUser = null; mock.tokenChanged!(null); });
    await act(async () => { finishToken('old-token'); await rejected; });
    expect(result.current.user?.uid ?? null).toBe(change === 'switch' ? 'new-user' : null);
    expect(result.current.isAdmin).toBe(false);
    expect(old.getIdTokenResult).toHaveBeenCalledTimes(1);
    expect(mock.snapshots.filter((item) => item.uid === 'old-admin')).toHaveLength(1);
  });

  it('ignores delayed old-account auth callbacks after switching accounts', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    const old = account('old-admin'); await signIn(old);
    await signIn(account('new-user', { appAccess: true }));
    await act(async () => { mock.tokenChanged!(old as unknown as User); });
    expect(result.current.user?.uid).toBe('new-user');
    expect(result.current.isAdmin).toBe(false);
    expect(old.getIdTokenResult).toHaveBeenCalledTimes(1);
  });
  it('fails closed for cached data, identifies timeout and recovers on a server snapshot', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(account('owner'));
    act(() => mock.snapshots[0].next(snapshot({}, true)));
    expect(result.current.loading).toBe(true);
    expect(result.current.hasAppAccess).toBe(false);
    expect(result.current.hasScannerLabAccess).toBe(false);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current).toMatchObject({ loading: false, accessError: 'timeout', hasAppAccess: false, hasScannerLabAccess: false });
    act(() => mock.snapshots[0].next(snapshot()));
    expect(result.current).toMatchObject({ loading: false, accessError: null, hasAppAccess: true, isAdmin: true, hasScannerLabAccess: true });
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.accessError).toBeNull();
  });

  it('distinguishes permission/transport failure from a confirmed lack of entitlement', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(account('owner'));
    act(() => mock.snapshots[0].error());
    expect(result.current).toMatchObject({ loading: false, accessError: 'unavailable', hasAppAccess: false, isAdmin: false, hasScannerLabAccess: false });
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.accessError).toBe('unavailable');
  });

  it('refreshes claims AND restarts a failed subscription without allowing cached access', async () => {
    const user = account('owner');
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(user);
    act(() => mock.snapshots[0].error());
    await act(async () => { await result.current.refreshClaims(); });
    expect(user.getIdTokenResult).toHaveBeenLastCalledWith(true);
    expect(mock.snapshots).toHaveLength(2);
    expect(mock.snapshots[0].stop).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({ loading: true, accessError: null, hasAppAccess: false, hasScannerLabAccess: false });
    act(() => mock.snapshots[0].next(snapshot()));
    act(() => mock.snapshots[1].next(snapshot({}, true)));
    expect(result.current.hasAppAccess).toBe(false);
    expect(result.current.hasScannerLabAccess).toBe(false);
    act(() => mock.snapshots[1].next(snapshot()));
    expect(result.current.hasAppAccess).toBe(true);
    expect(result.current.hasScannerLabAccess).toBe(true);
  });

  it('ignores the previous owner subscription and delayed token claims after switching accounts', async () => {
    const old = account('old');
    let finishClaims!: (value: { claims: Record<string, unknown> }) => void;
    vi.mocked(old.getIdTokenResult).mockImplementation(() => new Promise((resolve) => { finishClaims = resolve; }));
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(old);
    await signIn(account('new', { appAccess: true }));
    expect(mock.snapshots.map((item) => item.uid)).toEqual(['old', 'new']);
    await act(async () => { finishClaims({ claims: { admin: true } }); });
    act(() => mock.snapshots[0].next(snapshot()));
    expect(result.current).toMatchObject({ user: { uid: 'new' }, hasAppAccess: false, isAdmin: false, hasScannerLabAccess: false });
    act(() => mock.snapshots[1].next(snapshot({ appAccess: false })));
    expect(result.current).toMatchObject({ accessError: null, hasAppAccess: false, isAdmin: false, hasScannerLabAccess: false });
  });

  it('enforces revocation immediately and never interprets malformed overrides as a grant', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(account('owner', { appAccess: true, pretester: true }));
    act(() => mock.snapshots[0].next(snapshot()));
    expect(result.current).toMatchObject({ hasAppAccess: true, isPretester: true });
    act(() => mock.snapshots[0].next(snapshot({ appAccess: 'true', pretester: false })));
    expect(result.current).toMatchObject({ hasAppAccess: false, isPretester: false, accessError: null });
    act(() => mock.snapshots[0].next(snapshot({ disabled: true })));
    expect(result.current.hasAppAccess).toBe(false);
  });

  it('grants Scanner Lab alone after server confirmation without granting app, tester or admin rights', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(account('lab-reviewer', { scannerLabAccess: true }));
    expect(result.current.hasScannerLabAccess).toBe(false);
    act(() => mock.snapshots[0].next(snapshot({ scannerLabAccess: true }, true)));
    expect(result.current.hasScannerLabAccess).toBe(false);
    act(() => mock.snapshots[0].next(snapshot({ scannerLabAccess: true })));
    expect(result.current).toMatchObject({ loading: false, hasScannerLabAccess: true, hasAppAccess: false, isPretester: false, isAdmin: false });
  });

  it.each([false, 'true', 1, null])('revokes Scanner Lab immediately for live override %j despite an existing token grant', async (override) => {
    const user = account('lab-reviewer', { scannerLabAccess: true });
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(user);
    act(() => mock.snapshots[0].next(snapshot()));
    expect(result.current.hasScannerLabAccess).toBe(true);
    act(() => mock.snapshots[0].next(snapshot({ scannerLabAccess: override })));
    expect(result.current).toMatchObject({ hasScannerLabAccess: false, accessError: null });
    expect(user.getIdTokenResult).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { scannerLabAccess: 'true' }, { appAccess: true }, { pretester: true }])('does not grant Scanner Lab from its access document without a valid role claim (%j)', async (claims) => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(account('non-reviewer', claims));
    act(() => mock.snapshots[0].next(snapshot({ scannerLabAccess: true })));
    expect(result.current.hasScannerLabAccess).toBe(false);
  });

  it('keeps admin Scanner Lab access but blocks it when the admin role is revoked or the account is disabled', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(account('admin', { admin: true }));
    act(() => mock.snapshots[0].next(snapshot({ scannerLabAccess: false })));
    expect(result.current).toMatchObject({ hasScannerLabAccess: true, isAdmin: true });
    act(() => mock.snapshots[0].next(snapshot({ admin: false })));
    expect(result.current).toMatchObject({ hasScannerLabAccess: false, isAdmin: false });
    act(() => mock.snapshots[0].next(snapshot({ disabled: true })));
    expect(result.current).toMatchObject({ hasScannerLabAccess: false, isAdmin: false });
  });

  it('clears a lab-only grant when monitoring fails, the account is disabled or the user signs out', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(account('lab-reviewer', { scannerLabAccess: true }));
    act(() => mock.snapshots[0].next(snapshot()));
    expect(result.current.hasScannerLabAccess).toBe(true);
    act(() => mock.snapshots[0].next(snapshot({ disabled: true })));
    expect(result.current.hasScannerLabAccess).toBe(false);
    act(() => mock.snapshots[0].error());
    expect(result.current).toMatchObject({ hasScannerLabAccess: false, accessError: 'unavailable' });
    await act(async () => { mock.auth.currentUser = null; mock.tokenChanged!(null); });
    expect(result.current).toMatchObject({ user: null, hasScannerLabAccess: false });
  });
});
