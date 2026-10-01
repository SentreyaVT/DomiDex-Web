// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SharedBinder, SharedCard } from '@/lib/shared-binder';
import { SharedBinderViewer } from '@/components/shared-binder-viewer';

// Only the decorative material is replaced; requests and the real viewer state are exercised.
vi.mock('@/components/shared-binder-material', () => ({
  SharedBinderMaterial: ({ effect }: { effect: string }) => <span data-material-id={effect} />,
}));

const token = 'x'.repeat(43);
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
const originalCard: SharedCard = {
  slot: 1, cardId: 'synthetic-001', name: 'Testkarte', setName: 'Testset',
  collectorNumber: '001', image: '/synthetic-card.webp', finish: 'Holo',
  holoEffectId: 'galaxy', holoIntensity: 0.5,
  price: { amount: 12.34, currency: 'EUR', source: 'Cardmarket', asOf: '2026-10-01' },
};
function binder(title: string, cards: SharedCard[] = [originalCard], unavailableSlots: number[] = []): SharedBinder {
  return { title, coverStyle: 'galaxy', page: 0, pageCount: 2, cards, unavailableSlots };
}
function response(data: SharedBinder): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function openViewer() {
  const view = render(<SharedBinderViewer token={token} />);
  fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*groß ansehen/ }));
  expect(within(screen.getByRole('dialog')).getByText(/Cardmarket:.*12,34/)).toBeTruthy();
  return view;
}
function refresh() { fireEvent(document, new Event('visibilitychange')); }
async function publish(data: SharedBinder) {
  vi.mocked(fetch).mockResolvedValueOnce(response(data));
  refresh();
  // Await the successful DTO publication, not a timer or an assumed fetch completion.
  await screen.findByRole('heading', { level: 1, name: data.title });
}

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(binder('Ursprünglicher Binder'))));
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) {
    this.removeAttribute('open'); this.dispatchEvent(new Event('close'));
  } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('shared binder successful refresh and open large-card view', () => {
  it('labels a confirmed alternative as selected Cardmarket metric, never as trend', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(binder('Alternative', [{ ...originalCard,
      price: { ...originalCard.price!, basis: 'selection' },
    }])));
    render(<SharedBinderViewer token={token} />);
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*groß ansehen/ }));
    expect(within(screen.getByRole('dialog')).getByText(/Gewählte Cardmarket-Kennzahl:.*12,34/)).toBeTruthy();
    expect(within(screen.getByRole('dialog')).queryByText(/Trend/)).toBeNull();
  });

  it('does not turn an unavailable amount or omitted total into zero', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(binder('Preis außerhalb des Freigabeformats', [{ ...originalCard,
      price: { ...originalCard.price!, amount: null },
    }])));
    render(<SharedBinderViewer token={token} />);
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*groß ansehen/ }));
    expect(screen.queryByText(/Binderwert:/)).toBeNull();
    expect(within(screen.getByRole('dialog')).queryByText(/0,00/)).toBeNull();
    expect(within(screen.getByRole('dialog')).getByText(/nicht verfügbar/i)).toBeTruthy();
  });

  it('removes a revoked price from the already open dialog when the latest DTO omits price', async () => {
    await openViewer();
    const { price: _price, ...withoutPrice } = originalCard;
    await publish(binder('Preise jetzt ausgeblendet', [withoutPrice]));
    expect(within(screen.getByLabelText('Binderseite 1')).queryByText(/12,34/)).toBeNull();
    expect(within(screen.getByRole('dialog')).queryByText(/Cardmarket|12,34/)).toBeNull();
  });

  it('closes the already open card when a successful response removes that card', async () => {
    await openViewer();
    await publish(binder('Karte entfernt', []));
    expect(screen.queryByRole('button', { name: /Testkarte.*groß ansehen/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByAltText('Testkarte')).toBeNull();
  });

  it('does not retain previous card data when its current slot is explicitly unavailable', async () => {
    await openViewer();
    await publish(binder('Kartendaten nicht mehr verfügbar', [], [originalCard.slot]));
    expect(screen.getByText('Kartendaten gerade nicht verfügbar')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByAltText('Testkarte')).toBeNull();
  });

  it('does not keep or silently replace the selection when a different card occupies the same slot', async () => {
    await openViewer();
    await publish(binder('Platz neu belegt', [{ ...originalCard, cardId: 'synthetic-002', name: 'Andere Karte' }]));
    expect(screen.getByRole('button', { name: /Andere Karte.*groß ansehen/ })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByAltText('Testkarte')).toBeNull();
  });

  it('closes an invalidated native modal in the commit phase before it can paint empty', async () => {
    const committedOpen: boolean[] = [];
    const title = 'Commit mit ersetzter Karte';
    render(<React.Profiler id="shared-viewer" onRender={() => {
      // Profiler observes the real commit after child layout effects, before passive
      // effects. Do not replace hooks or wait away an already-painted empty modal.
      const dialog = document.querySelector('dialog');
      if (document.querySelector('h1')?.textContent === title && dialog instanceof HTMLDialogElement) {
        committedOpen.push(dialog.open);
      }
    }}><SharedBinderViewer token={token} /></React.Profiler>);
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*groß ansehen/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await publish(binder(title, [{ ...originalCard, cardId: 'synthetic-002', name: 'Andere Karte' }]));
    expect(committedOpen.length).toBeGreaterThan(0);
    expect(committedOpen.every(open => open === false)).toBe(true);
  });

  it('refreshes the selected card price and visual data from the latest successful DTO', async () => {
    await openViewer();
    await publish(binder('Daten aktualisiert', [{
      ...originalCard, name: 'Aktuelle Testkarte', image: '/updated-synthetic-card.webp', holoEffectId: 'aurora',
      price: { ...originalCard.price!, amount: 3.21 },
    }]));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText(/Cardmarket:.*12,34/)).toBeNull();
    expect(within(dialog).getByText(/Cardmarket:.*3,21/)).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Aktuelle Testkarte' })).toBeTruthy();
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe('/updated-synthetic-card.webp');
    expect(dialog.querySelector('[data-material-id="aurora"]')).toBeTruthy();
  });

  it.each([
    ['finish', { finish: 'Reverse Holo' }],
    ['collector number', { collectorNumber: '002' }],
    ['slot', { slot: originalCard.slot + 1 }],
  ] as const)('closes rather than retaining a selection whose %s identity changed', async (_field, change) => {
    await openViewer();
    await publish(binder('Identität geändert', [{ ...originalCard, ...change }]));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open a dialog automatically on initial load or a successful refresh', async () => {
    render(<SharedBinderViewer token={token} />);
    await screen.findByRole('heading', { level: 1, name: 'Ursprünglicher Binder' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await publish(binder('Ohne Klick aktualisiert'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('preserves an open unchanged selection and its user-controlled tilt through refresh, then resets on removal', async () => {
    await openViewer();
    const dialog = screen.getByRole('dialog');
    const surface = within(dialog).getByRole('img').parentElement;
    const showcase = surface?.parentElement;
    if (!(surface instanceof HTMLElement) || !(showcase instanceof HTMLElement)) throw new Error('Missing real viewer showcase');
    vi.spyOn(showcase, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, toJSON: () => ({}) });
    fireEvent(showcase, new MouseEvent('pointermove', { bubbles: true, clientX: 75, clientY: 25 }));
    expect(surface.style.transform).toContain('rotateX(4deg) rotateY(4deg)');
    await publish(binder('Unverändert aktualisiert'));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(surface.style.transform).toContain('rotateX(4deg) rotateY(4deg)');
    await publish(binder('Auswahl entfernt', []));
    expect(screen.queryByRole('dialog')).toBeNull();
    await publish(binder('Karte später wieder vorhanden'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Testkarte.*groß ansehen/ }));
    expect(within(screen.getByRole('dialog')).getByRole('img').parentElement?.style.transform).toContain('rotateX(0deg) rotateY(0deg)');
  });

  it('ignores an older priced DTO after a newer successful DTO has hidden prices', async () => {
    await openViewer();
    const older = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(older.promise);
    refresh();
    const { price: _price, ...withoutPrice } = originalCard;
    await publish(binder('Neue Antwort ohne Preise', [withoutPrice]));
    await act(async () => { older.resolve(response(binder('Veraltete Antwort mit Preisen'))); });
    expect(screen.getByRole('heading', { level: 1, name: 'Neue Antwort ohne Preise' })).toBeTruthy();
    expect(within(screen.getByRole('dialog')).queryByText(/Cardmarket|12,34/)).toBeNull();
  });

  it('keeps the existing latest-request guard after a newer revocation response', async () => {
    await openViewer();
    const older = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(older.promise);
    refresh();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
    refresh();
    await screen.findByRole('alert');
    await act(async () => { older.resolve(response(binder('Veraltete positive Antwort'))); });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Veraltete positive Antwort' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByAltText('Testkarte')).toBeNull();
  });

  it('does not publish an aborted old-token response after the viewer switches shares', async () => {
    const view = await openViewer();
    const oldToken = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(oldToken.promise);
    refresh();
    vi.mocked(fetch).mockResolvedValueOnce(response(binder('Neue Freigabe', [])));
    view.rerender(<SharedBinderViewer token={'y'.repeat(43)} />);
    await screen.findByRole('heading', { level: 1, name: 'Neue Freigabe' });
    await act(async () => { oldToken.resolve(response(binder('Alte Freigabe'))); });
    expect(screen.getByRole('heading', { level: 1, name: 'Neue Freigabe' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Alte Freigabe' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('aborts a pending manual retry when the viewer unmounts', async () => {
    const retry = deferred<Response>();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockReturnValueOnce(retry.promise);
    const view = render(<SharedBinderViewer token={token} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(fetch).toHaveBeenCalledTimes(2);
    const retrySignal = vi.mocked(fetch).mock.calls[1][1]?.signal;

    try {
      expect(retrySignal).toBeInstanceOf(AbortSignal);
      expect(retrySignal?.aborted).toBe(false);
      view.unmount();
      expect(retrySignal?.aborted).toBe(true);
    } finally {
      // The mock deliberately ignores abort; settle even when the RED assertion fails.
      await act(async () => { retry.resolve(response(binder('Verspäteter manueller Retry'))); });
    }
  });

  it('aborts a manual retry on token change and ignores its late JSON body', async () => {
    const oldBody = deferred<SharedBinder>();
    const readOldBody = vi.fn(() => oldBody.promise);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce({ ok: true, json: readOldBody } as unknown as Response);
    const view = render(<SharedBinderViewer token={token} />);
    await screen.findByRole('alert');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' })); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(readOldBody).toHaveBeenCalledTimes(1);
    const retrySignal = vi.mocked(fetch).mock.calls[1][1]?.signal;

    try {
      expect(retrySignal).toBeInstanceOf(AbortSignal);
      expect(retrySignal?.aborted).toBe(false);
      vi.mocked(fetch).mockResolvedValueOnce(response(binder('Neue Freigabe nach Retry', [])));
      view.rerender(<SharedBinderViewer token={'y'.repeat(43)} />);
      await screen.findByRole('heading', { level: 1, name: 'Neue Freigabe nach Retry' });
      expect(retrySignal?.aborted).toBe(true);

      await act(async () => { oldBody.resolve(binder('Alte Freigabe aus manuellem Retry')); });
      expect(screen.getByRole('heading', { level: 1, name: 'Neue Freigabe nach Retry' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Alte Freigabe aus manuellem Retry' })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      await act(async () => { oldBody.resolve(binder('Alte Freigabe aus manuellem Retry')); });
    }
  });
});

describe('shared binder slow automatic refresh lifetime', () => {
  it('publishes 20-second initial and periodic responses instead of invalidating every answer', async () => {
    vi.useFakeTimers();
    const pending: ReturnType<typeof deferred<Response>>[] = [];
    const startedAt: number[] = [];
    vi.mocked(fetch).mockReset().mockImplementation(() => {
      startedAt.push(Date.now());
      const request = deferred<Response>(); pending.push(request); return request.promise;
    });
    const view = render(<SharedBinderViewer token={token} />);
    try {
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status').textContent).toContain('Binder wird geladen');
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      await act(async () => { pending[0].resolve(response(binder('Erste Antwort nach 20 Sekunden'))); });
      // A 15-second tick must not make the first successful answer permanently stale.
      expect(screen.getByRole('heading', { level: 1, name: 'Erste Antwort nach 20 Sekunden' })).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: /Testkarte.*groß ansehen/ }));

      // Allow the next normal polling opportunity, without prescribing whether its
      // cadence is interval-based or measured from the previous completed request.
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('heading', { name: 'Erste Antwort nach 20 Sekunden' })).toBeTruthy();
      const remainingResponseTime = 20_000 - (Date.now() - startedAt[1]);
      expect(remainingResponseTime).toBeGreaterThan(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(remainingResponseTime); });
      await act(async () => { pending[1].resolve(response(binder('Aktualisierung nach weiteren 20 Sekunden', [{
        ...originalCard, price: { ...originalCard.price!, amount: 3.21 },
      }]))); });
      expect(screen.getByRole('heading', { level: 1, name: 'Aktualisierung nach weiteren 20 Sekunden' })).toBeTruthy();
      expect(within(screen.getByRole('dialog')).getByText(/Cardmarket:.*3,21/)).toBeTruthy();
      expect(within(screen.getByRole('dialog')).queryByText(/Cardmarket:.*12,34/)).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      // Deliberately abort-ignoring transport: settle every captured request, even on RED.
      await act(async () => { pending.forEach(request => request.resolve(response(binder('Abgebrochene Antwort')))); });
      vi.clearAllTimers(); vi.useRealTimers();
    }
  });

  it('does not start a parallel periodic request while the current JSON body is still pending', async () => {
    vi.useFakeTimers();
    const body = deferred<SharedBinder>();
    const readBody = vi.fn(() => body.promise);
    vi.mocked(fetch).mockReset().mockImplementation(async () => ({ ok: true, json: readBody }) as unknown as Response);
    const view = render(<SharedBinderViewer token={token} />);
    try {
      await act(async () => {});
      expect(readBody).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(readBody).toHaveBeenCalledTimes(1);
      await act(async () => { body.resolve(binder('Langsamer JSON-Body vollständig')); });
      expect(screen.getByRole('heading', { level: 1, name: 'Langsamer JSON-Body vollständig' })).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      view.unmount();
      await act(async () => { body.resolve(binder('Abgebrochener JSON-Body')); });
      vi.clearAllTimers(); vi.useRealTimers();
    }
  });

  it.each(['fetch', 'json'] as const)('clears stale content after a 30-second %s deadline and recovers without reviving the timed-out answer', async (stage) => {
    vi.useFakeTimers();
    const oldFetch = deferred<Response>();
    const oldBody = deferred<SharedBinder>();
    const readOldBody = vi.fn(() => oldBody.promise);
    const subsequent: ReturnType<typeof deferred<Response>>[] = [];
    vi.mocked(fetch).mockReset().mockResolvedValueOnce(response(binder('Binder vor hängender Antwort')))
      .mockImplementationOnce(() => stage === 'fetch' ? oldFetch.promise
        : Promise.resolve({ ok: true, json: readOldBody } as unknown as Response))
      .mockImplementation(() => { const request = deferred<Response>(); subsequent.push(request); return request.promise; });
    const view = render(<SharedBinderViewer token={token} />);
    try {
      await act(async () => {});
      fireEvent.click(screen.getByRole('button', { name: /Testkarte.*groß ansehen/ }));
      expect(screen.getByRole('dialog')).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(fetch).toHaveBeenCalledTimes(2);
      if (stage === 'json') expect(readOldBody).toHaveBeenCalledTimes(1);
      const oldSignal = vi.mocked(fetch).mock.calls[1][1]?.signal;
      expect(oldSignal).toBeInstanceOf(AbortSignal);

      // This is an explicit local 30-second request policy, not a server SLA.
      // It covers both awaiting headers and awaiting the full JSON body, while
      // allowing the separate 20-second successful-response regression above.
      await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
      expect(oldSignal?.aborted).toBe(false);
      expect(screen.getByRole('heading', { name: 'Binder vor hängender Antwort' })).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(oldSignal?.aborted).toBe(true);
      expect(screen.queryByRole('heading', { name: 'Binder vor hängender Antwort' })).toBeNull();
      expect(screen.queryByAltText('Testkarte')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('alert')).toBeTruthy();

      // A deadline must release the in-flight slot even when transport ignores
      // abort. A fresh attempt must start no later than the next polling chance.
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(fetch).toHaveBeenCalledTimes(3);
      const newSignal = vi.mocked(fetch).mock.calls[2][1]?.signal;
      expect(newSignal).toBeInstanceOf(AbortSignal);
      expect(newSignal?.aborted).toBe(false);
      await act(async () => { subsequent[0].resolve(response(binder('Nach Zeitlimit wieder geladen', [{
        ...originalCard, price: { ...originalCard.price!, amount: 3.21 },
      }]))); });
      expect(screen.getByRole('heading', { name: 'Nach Zeitlimit wieder geladen' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();

      // Neither a fetch nor a body that completes after its ignored abort may
      // restore stale prices, the old binder, or the previously open modal.
      await act(async () => {
        oldFetch.resolve(response(binder('Verspätete Antwort nach Zeitlimit')));
        oldBody.resolve(binder('Verspätete Antwort nach Zeitlimit'));
      });
      expect(screen.getByRole('heading', { name: 'Nach Zeitlimit wieder geladen' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Verspätete Antwort nach Zeitlimit' })).toBeNull();
      expect(screen.queryByText(/12,34/)).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      view.unmount();
      await act(async () => {
        oldFetch.resolve(response(binder('Abgebrochene Antwort')));
        oldBody.resolve(binder('Abgebrochener JSON-Body'));
        subsequent.forEach(request => request.resolve(response(binder('Abgebrochener Folgeversuch'))));
      });
      vi.clearAllTimers(); vi.useRealTimers();
    }
  });

  it.each(['token', 'page', 'unmount'] as const)('still aborts a slow scheduled refresh on %s and never publishes its late data', async (change) => {
    vi.useFakeTimers();
    const pending: ReturnType<typeof deferred<Response>>[] = [];
    vi.mocked(fetch).mockReset().mockResolvedValueOnce(response(binder('Binder vor langsamem Refresh')))
      .mockImplementation(() => { const request = deferred<Response>(); pending.push(request); return request.promise; });
    const view = render(<SharedBinderViewer token={token} />);
    try {
      await act(async () => {});
      expect(screen.getByRole('heading', { name: 'Binder vor langsamem Refresh' })).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(fetch).toHaveBeenCalledTimes(2);
      const oldSignal = vi.mocked(fetch).mock.calls[1][1]?.signal;
      expect(oldSignal).toBeInstanceOf(AbortSignal);
      expect(oldSignal?.aborted).toBe(false);

      if (change === 'unmount') {
        view.unmount();
        expect(oldSignal?.aborted).toBe(true);
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        expect(fetch).toHaveBeenCalledTimes(2);
      } else {
        vi.mocked(fetch).mockResolvedValueOnce(response({ ...binder('Neuer Kontext sofort geladen', []), page: change === 'page' ? 1 : 0 }));
        await act(async () => {
          if (change === 'token') view.rerender(<SharedBinderViewer token={'y'.repeat(43)} />);
          else fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
        });
        expect(oldSignal?.aborted).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(vi.mocked(fetch).mock.calls[2][0]).toBe(change === 'token'
          ? `/api/shared-binders/${'y'.repeat(43)}?page=0` : `/api/shared-binders/${token}?page=1`);
        expect(screen.getByRole('heading', { name: 'Neuer Kontext sofort geladen' })).toBeTruthy();
        await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      }
      await act(async () => { pending[0].resolve(response(binder('Verspäteter alter periodischer Refresh'))); });
      expect(screen.queryByRole('heading', { name: 'Verspäteter alter periodischer Refresh' })).toBeNull();
      if (change !== 'unmount') expect(screen.getByRole('heading', { name: 'Neuer Kontext sofort geladen' })).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      view.unmount();
      await act(async () => { pending.forEach(request => request.resolve(response(binder('Abgebrochene Antwort')))); });
      vi.clearAllTimers(); vi.useRealTimers();
    }
  });
});
