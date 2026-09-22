// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
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
  signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(), signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_store: unknown, _collection: string, uid: string) => ({ uid }),
  onSnapshot: (ref: { uid: string }, _options: unknown, next: typeof mock.snapshots[number]['next'], error: () => void) => {
    const stop = vi.fn(); mock.snapshots.push({ uid: ref.uid, next, error, stop }); return stop;
  },
}));

const account = (uid: string, claims: Record<string, unknown> = { admin: true }) => ({ uid, getIdTokenResult: vi.fn<(_force?: boolean) => Promise<{ claims: Record<string, unknown> }>>().mockResolvedValue({ claims }) });
const snapshot = (data?: Record<string, unknown>, fromCache = false) => ({ data: () => data, metadata: { fromCache } });
async function signIn(user: ReturnType<typeof account>) {
  await act(async () => { mock.auth.currentUser = user as unknown as User; mock.tokenChanged!(mock.auth.currentUser); });
}
beforeEach(() => { vi.useFakeTimers(); mock.auth.currentUser = null; mock.tokenChanged = null; mock.snapshots.length = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('server-confirmed access monitoring', () => {
  it('fails closed for cached data, identifies timeout and recovers on a server snapshot', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(account('owner'));
    act(() => mock.snapshots[0].next(snapshot({}, true)));
    expect(result.current.loading).toBe(true);
    expect(result.current.hasAppAccess).toBe(false);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current).toMatchObject({ loading: false, accessError: 'timeout', hasAppAccess: false });
    act(() => mock.snapshots[0].next(snapshot()));
    expect(result.current).toMatchObject({ loading: false, accessError: null, hasAppAccess: true, isAdmin: true });
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.accessError).toBeNull();
  });

  it('distinguishes permission/transport failure from a confirmed lack of entitlement', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await signIn(account('owner'));
    act(() => mock.snapshots[0].error());
    expect(result.current).toMatchObject({ loading: false, accessError: 'unavailable', hasAppAccess: false, isAdmin: false });
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
    expect(result.current).toMatchObject({ loading: true, accessError: null, hasAppAccess: false });
    act(() => mock.snapshots[0].next(snapshot()));
    act(() => mock.snapshots[1].next(snapshot({}, true)));
    expect(result.current.hasAppAccess).toBe(false);
    act(() => mock.snapshots[1].next(snapshot()));
    expect(result.current.hasAppAccess).toBe(true);
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
    expect(result.current).toMatchObject({ user: { uid: 'new' }, hasAppAccess: false, isAdmin: false });
    act(() => mock.snapshots[1].next(snapshot({ appAccess: false })));
    expect(result.current).toMatchObject({ accessError: null, hasAppAccess: false, isAdmin: false });
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
});
