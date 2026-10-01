// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletion } from '@/components/account-deletion';

type TestUser = { uid: string; getIdToken: ReturnType<typeof vi.fn> };
const mock = vi.hoisted(() => ({
  user: null as TestUser | null,
  auth: { currentUser: null as TestUser | null },
  listeners: new Set<(user: TestUser | null) => void>(),
  logout: vi.fn(), reauthenticate: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: mock.user, loading: false, logout: mock.logout }) }));
vi.mock('@/lib/firebase-client', () => ({ firebaseAuth: mock.auth }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {}, reauthenticateWithPopup: mock.reauthenticate,
  onAuthStateChanged: (_auth: unknown, listener: (user: TestUser | null) => void) => {
    mock.listeners.add(listener); listener(mock.auth.currentUser);
    return () => mock.listeners.delete(listener);
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const account = (uid: string): TestUser => ({ uid, getIdToken: vi.fn().mockResolvedValue(`${uid}-token`) });
const response = (status = 'COMPLETE') => ({ ok: true, json: vi.fn().mockResolvedValue({ status, jobId: 'synthetic-job' }) });
function changeAccount(user: TestUser | null, notify = true) {
  mock.user = user; mock.auth.currentUser = user;
  if (notify) mock.listeners.forEach((listener) => listener(user));
}
function checkbox() { return screen.getByRole<HTMLInputElement>('checkbox'); }
function button() { return screen.getByRole<HTMLButtonElement>('button'); }
async function start() {
  await act(async () => { fireEvent.click(checkbox()); fireEvent.click(button()); });
}
beforeEach(() => {
  vi.resetAllMocks(); mock.listeners.clear(); changeAccount(account('owner-a'));
  mock.reauthenticate.mockResolvedValue(undefined); mock.logout.mockResolvedValue(undefined);
  mock.fetch.mockResolvedValue(response()); vi.stubGlobal('fetch', mock.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('account deletion is bound to the explicitly confirmed local auth session', () => {
  it('clears consent and status when the rendered owner changes', async () => {
    const view = render(<AccountDeletion />);
    fireEvent.click(checkbox()); expect(checkbox().checked).toBe(true);
    await act(async () => { changeAccount(account('owner-b')); view.rerender(<AccountDeletion />); });
    expect(checkbox().checked).toBe(false); expect(button().disabled).toBe(true);
    expect(mock.fetch).not.toHaveBeenCalled();
  });

  it('requires new consent after a previously submitted owner changes', async () => {
    mock.fetch.mockResolvedValue(response('PENDING_SESSION_EXPIRY'));
    const view = render(<AccountDeletion />); await start();
    expect(screen.getByRole('status').textContent).toContain('synthetic-job');
    await act(async () => { changeAccount(account('owner-b')); view.rerender(<AccountDeletion />); });
    expect(checkbox().checked).toBe(false); expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not begin reauthentication when Firebase already differs from the rendered owner', async () => {
    render(<AccountDeletion />); mock.auth.currentUser = account('owner-b'); await start();
    expect(mock.reauthenticate).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
  });

  it('cannot confirm through a stale owner view and carry that consent into the next owner', async () => {
    const view = render(<AccountDeletion />); const next = account('owner-b');
    await act(async () => {
      mock.auth.currentUser = next; mock.listeners.forEach((listener) => listener(next));
    });
    fireEvent.click(checkbox());
    await act(async () => { mock.user = next; view.rerender(<AccountDeletion />); });
    expect(checkbox().checked).toBe(false); expect(button().disabled).toBe(true);
    expect(mock.reauthenticate).not.toHaveBeenCalled();
  });

  it('does not request a token or POST after a switch during reauthentication', async () => {
    const old = mock.user!; const pending = deferred<void>(); mock.reauthenticate.mockReturnValue(pending.promise);
    const view = render(<AccountDeletion />); await start();
    await act(async () => { changeAccount(account('owner-b')); view.rerender(<AccountDeletion />); pending.resolve(); });
    expect(old.getIdToken).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
    expect(checkbox().checked).toBe(false); expect(mock.logout).not.toHaveBeenCalled();
  });

  it('does not POST after a switch during token retrieval even before a React rerender', async () => {
    const pending = deferred<string>(); mock.user!.getIdToken.mockReturnValue(pending.promise);
    render(<AccountDeletion />); await start();
    await act(async () => { changeAccount(account('owner-b'), false); pending.resolve('owner-a-token'); });
    expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.logout).not.toHaveBeenCalled();
  });

  it('invalidates an observed A to B to A round trip even if React only renders A', async () => {
    const old = mock.user!; const pending = deferred<void>(); mock.reauthenticate.mockReturnValue(pending.promise);
    render(<AccountDeletion />); await start();
    await act(async () => { changeAccount(account('owner-b')); changeAccount(old); pending.resolve(); });
    expect(mock.fetch).not.toHaveBeenCalled(); expect(checkbox().checked).toBe(false);
    expect(mock.logout).not.toHaveBeenCalled();
  });

  it('does not parse or publish an old fetch response or log out the new account', async () => {
    const pending = deferred<ReturnType<typeof response>>(); mock.fetch.mockReturnValue(pending.promise);
    const view = render(<AccountDeletion />); await start(); const oldResponse = response();
    await act(async () => { changeAccount(account('owner-b')); view.rerender(<AccountDeletion />); pending.resolve(oldResponse); });
    expect(oldResponse.json).not.toHaveBeenCalled(); expect(mock.logout).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull(); expect(checkbox().checked).toBe(false);
  });

  it('does not publish an old JSON response after an owner switch', async () => {
    const pending = deferred<{ status: string; jobId: string }>();
    mock.fetch.mockResolvedValue({ ok: true, json: () => pending.promise });
    const view = render(<AccountDeletion />); await start();
    await act(async () => { changeAccount(account('owner-b')); view.rerender(<AccountDeletion />); pending.resolve({ status: 'COMPLETE', jobId: 'old-job' }); });
    expect(mock.logout).not.toHaveBeenCalled(); expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not publish a late rejection into the new account', async () => {
    const pending = deferred<void>(); mock.reauthenticate.mockReturnValue(pending.promise);
    const view = render(<AccountDeletion />); await start();
    await act(async () => { changeAccount(account('owner-b')); view.rerender(<AccountDeletion />); pending.reject(Error('owner-a-private-error')); });
    expect(screen.queryByRole('status')).toBeNull(); expect(mock.fetch).not.toHaveBeenCalled();
  });

  it('an old finally cannot clear a newer account request busy state', async () => {
    const first = deferred<void>(); const second = deferred<void>();
    mock.reauthenticate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<AccountDeletion />); await start();
    await act(async () => { changeAccount(account('owner-b')); view.rerender(<AccountDeletion />); });
    await start(); expect(mock.reauthenticate).toHaveBeenCalledTimes(2);
    await act(async () => first.reject(Error('old failure')));
    expect(button().disabled).toBe(true); expect(button().textContent).toBe('Löschauftrag wird geprüft …');
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => second.resolve()); expect(mock.fetch).toHaveBeenCalledOnce();
  });

  it('does not continue a pending reauthentication after unmount', async () => {
    const pending = deferred<void>(); mock.reauthenticate.mockReturnValue(pending.promise);
    const view = render(<AccountDeletion />); await start(); view.unmount();
    await act(async () => pending.resolve());
    expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.logout).not.toHaveBeenCalled();
    expect(mock.listeners.size).toBe(0);
  });

  it('does not log out when an already sent response completes after unmount', async () => {
    const pending = deferred<ReturnType<typeof response>>(); mock.fetch.mockReturnValue(pending.promise);
    const view = render(<AccountDeletion />); await start(); view.unmount();
    await act(async () => pending.resolve(response())); expect(mock.logout).not.toHaveBeenCalled();
  });

  it('preserves the same-owner reauthentication callback and completes exactly once', async () => {
    const old = mock.user!;
    mock.reauthenticate.mockImplementation(async () => changeAccount(old));
    render(<AccountDeletion />); await start();
    expect(mock.fetch).toHaveBeenCalledOnce(); expect(mock.logout).toHaveBeenCalledOnce();
    expect(mock.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer owner-a-token');
    expect(screen.getByRole('status').textContent).toBe('Die Kontolöschung wurde abgeschlossen.');
  });

  it('keeps cancelled reauthentication local without submitting or signing out', async () => {
    mock.reauthenticate.mockRejectedValue(Error('Confirmation cancelled'));
    render(<AccountDeletion />); await start();
    expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.logout).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Confirmation cancelled');
    expect(button().disabled).toBe(false);
  });

  it('submits no duplicate request for two immediate clicks', async () => {
    const pending = deferred<void>(); mock.reauthenticate.mockReturnValue(pending.promise);
    render(<AccountDeletion />);
    await act(async () => { fireEvent.click(checkbox()); const target = button(); fireEvent.click(target); fireEvent.click(target); });
    expect(mock.reauthenticate).toHaveBeenCalledOnce();
    await act(async () => pending.resolve()); expect(mock.fetch).toHaveBeenCalledOnce();
  });
});
