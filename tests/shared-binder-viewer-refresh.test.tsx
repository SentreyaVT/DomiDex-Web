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
});
