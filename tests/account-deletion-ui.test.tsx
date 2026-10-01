// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletion } from '@/components/account-deletion';

const mocks = vi.hoisted(() => ({ logout: vi.fn(), token: vi.fn(), reauthenticate: vi.fn() }));
const owner = vi.hoisted(() => ({ uid: 'synthetic-owner', getIdToken: mocks.token }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({
  user: owner, loading: false, logout: mocks.logout,
}) }));
vi.mock('@/lib/firebase-client', () => ({ firebaseAuth: { currentUser: owner } }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {}, reauthenticateWithPopup: mocks.reauthenticate,
  onAuthStateChanged: (_auth: unknown, listener: (user: typeof owner) => void) => { listener(owner); return vi.fn(); },
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.token.mockResolvedValue('synthetic-token');
  mocks.reauthenticate.mockResolvedValue(undefined);
  mocks.logout.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function submit(status: string, ok = true) {
  vi.mocked(fetch).mockResolvedValue({ ok, json: async () => ({ status, jobId: 'synthetic-job' }) } as Response);
  render(<AccountDeletion />);
  const check = screen.getByRole('checkbox');
  expect(check).toBeInstanceOf(HTMLInputElement);
  if (!(check instanceof HTMLInputElement)) throw Error('Expected checkbox');
  expect(check.checked).toBe(false);
  const button = screen.getByRole('button', { name: 'Anmeldung bestätigen und Löschauftrag senden' });
  expect(button).toBeInstanceOf(HTMLButtonElement);
  if (!(button instanceof HTMLButtonElement)) throw Error('Expected button');
  expect(button.disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(check); fireEvent.click(button);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await screen.findByRole('status');
  return screen.getByRole('status').textContent;
}

describe('truthful account-deletion progress', () => {
  for (const [status, label] of [
    ['PENDING_SESSION_EXPIRY', 'Zugriff wird sicher beendet'],
    ['ACTIVE_DATA_DELETED_PENDING_PROVIDER_RETENTION', 'technische Wiederherstellungsfrist beim Speicheranbieter'],
    ['PROVIDER_PURGE_NOT_CONFIRMED', 'endgültige Entfernung beim Speicheranbieter noch nicht bestätigt'],
    ['WAITING_FOR_TOKEN_EXPIRY', 'Zugriff wird sicher beendet'],
    ['PARTIAL_FAILURE', 'erneute Bearbeitung erforderlich'],
  ]) it(`explains ${status} without claiming complete deletion or signing out`, async () => {
    const message = await submit(status);
    expect(message).toContain(label);
    expect(message).toContain('Die vollständige Löschung ist noch nicht bestätigt');
    expect(message).toContain('synthetic-job');
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe(JSON.stringify({ confirm: 'DELETE_DOMIDEX_ACCOUNT' }));
  });
  it('keeps an unknown future status incomplete instead of inventing success', async () => {
    expect(await submit('FUTURE_STATUS')).toContain('Die vollständige Löschung ist noch nicht bestätigt');
    expect(mocks.logout).not.toHaveBeenCalled();
  });
  it('only an acknowledged COMPLETE status is shown as complete', async () => {
    expect(await submit('COMPLETE')).toBe('Die Kontolöschung wurde abgeschlossen.');
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
  });
  it('never displays an unsuccessful HTTP response as complete', async () => {
    expect(await submit('COMPLETE', false)).toContain('konnte nicht abgeschlossen werden');
    expect(mocks.logout).not.toHaveBeenCalled();
  });
});
