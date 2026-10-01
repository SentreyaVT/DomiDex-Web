// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinderSharingOwner } from '@/components/binder-sharing-owner';

const user = { uid: 'owner-a', getIdToken: vi.fn().mockResolvedValue('test-token') };
const flags = { showPrices: false, showTotal: false, showDisplayName: false };
const share = { shareId: 'f'.repeat(64), createdAt: 1234567890000, options: flags };
function response(data: unknown, status = 200) { return { ok: status < 400, status, json: async () => data } as Response; }
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return response({ ...share, path: `/share/${'a'.repeat(43)}` }, 201);
    if (init?.method === 'DELETE') return response({ ok: true });
    return response(String(_url).includes('binderId=') ? { shares: [] } : { binders: [{ binderId: 'binder-a', name: 'Mein privater Binder', coverStyle: 'galaxy' }] });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const writes = () => vi.mocked(fetch).mock.calls.filter(([, init]) => ['POST', 'DELETE'].includes(String(init?.method)));

describe('explicit owner-only binder sharing UX', () => {
  it('loads owner binders but creates nothing automatically and defaults all privacy flags OFF', async () => {
    render(<BinderSharingOwner user={user} />);
    await screen.findByText('Zusätzlich ausdrücklich freigeben');
    expect(screen.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);
    expect((screen.getByRole('button', { name: 'Freigabelink erstellen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith('/api/binder-shares', expect.objectContaining({ cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer test-token' } }));
  });
  it('requires explicit confirmation, returns the link only after success, and revokes with a second confirmation', async () => {
    render(<BinderSharingOwner user={user} />);
    fireEvent.click(await screen.findByLabelText(/Ich möchte diesen Binder/));
    const create = screen.getByRole('button', { name: 'Freigabelink erstellen' }) as HTMLButtonElement;
    // The form is present before the separate active-shares GET has finished.
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);
    const input = await screen.findByLabelText('Dein neuer Freigabelink') as HTMLInputElement;
    expect(input.value).toBe(`https://domidex.web.app/share/${'a'.repeat(43)}`);
    expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ binderId: 'binder-a', confirm: true, ...flags });
    expect((screen.getByLabelText(/Ich möchte diesen Binder/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Freigabe beenden' }));
    expect(writes()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Beenden bestätigen' }));
    await screen.findByText('Freigabe beendet. Der Link ist serverseitig ungültig.');
    expect(screen.queryByLabelText('Dein neuer Freigabelink')).toBeNull();
    expect(JSON.parse(writes()[1][1]!.body as string)).toEqual({ shareId: share.shareId, confirm: true });
  });
  it('never enables a closed server gate or copies account email into a public display name', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 404));
    render(<BinderSharingOwner user={user} />);
    await screen.findByText(/Binder-Freigaben sind noch nicht aktiviert/);
    expect(screen.queryByRole('button', { name: 'Freigabelink erstellen' })).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  it('keeps opt-ins independent and requires a separate non-email display name', async () => {
    render(<BinderSharingOwner user={user} />);
    fireEvent.click(await screen.findByLabelText('Aktuellen Binder-Gesamtwert anzeigen'));
    fireEvent.click(screen.getByLabelText('Anzeigename anzeigen'));
    const name = screen.getByLabelText('Öffentlicher Anzeigename') as HTMLInputElement;
    expect(name.value).toBe('');
    fireEvent.change(name, { target: { value: 'Sammler' } });
    fireEvent.click(screen.getByLabelText(/Ich möchte diesen Binder/));
    const create = screen.getByRole('button', { name: 'Freigabelink erstellen' }) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    // Prove the email restriction independently of the initial loading gate.
    fireEvent.change(name, { target: { value: 'owner@example.invalid' } });
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(writes()).toHaveLength(0);
    fireEvent.change(name, { target: { value: 'Sammler' } });
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);
    await screen.findByLabelText('Dein neuer Freigabelink');
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ binderId: 'binder-a', confirm: true, showTotal: true, showPrices: false, showDisplayName: true, displayName: 'Sammler' });
  });
  it('does not create while the active-shares GET is pending and becomes ready only after it completes', async () => {
    let finishShares!: (value: Response) => void;
    const pendingShares = new Promise<Response>((resolve) => { finishShares = resolve; });
    const normalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, init) => {
      const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      return requestUrl.includes('?binderId=binder-a') && init?.method === 'GET' ? pendingShares : normalFetch(url, init);
    });
    render(<BinderSharingOwner user={user} />);
    await screen.findByText('Aktive Freigaben werden geladen …');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/binder-shares?binderId=binder-a',
      expect.objectContaining({ method: 'GET', cache: 'no-store' })));
    fireEvent.click(screen.getByLabelText(/Ich möchte diesen Binder/));
    const create = screen.getByRole('button', { name: 'Freigabelink erstellen' }) as HTMLButtonElement;
    expect((screen.getByLabelText(/Ich möchte diesen Binder/) as HTMLInputElement).checked).toBe(true);
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(writes()).toHaveLength(0);
    expect(screen.queryByLabelText('Dein neuer Freigabelink')).toBeNull();
    await act(async () => { finishShares(response({ shares: [] })); });
    await waitFor(() => expect(create.disabled).toBe(false));
    expect(screen.queryByText('Aktive Freigaben werden geladen …')).toBeNull();
    expect(writes()).toHaveLength(0);
    fireEvent.click(create);
    const input = await screen.findByLabelText('Dein neuer Freigabelink') as HTMLInputElement;
    expect(input.value).toBe(`https://domidex.web.app/share/${'a'.repeat(43)}`);
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ binderId: 'binder-a', confirm: true, ...flags });
  });
  it('does not restore raw links from local persistence and ignores an old owner response', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<BinderSharingOwner user={user} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    rerender(<BinderSharingOwner user={{ uid: 'owner-b', getIdToken: vi.fn().mockResolvedValue('second') }} />);
    await screen.findByText('Zusätzlich ausdrücklich freigeben');
    await act(async () => { finish(response({ binders: [{ binderId: 'old', name: 'OLD_OWNER_PRIVATE', coverStyle: 'galaxy' }] })); });
    expect(screen.queryByText('OLD_OWNER_PRIVATE')).toBeNull();
    expect(screen.queryByLabelText('Dein neuer Freigabelink')).toBeNull();
  });
});
