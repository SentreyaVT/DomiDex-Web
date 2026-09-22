// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SharedBinderViewer } from '@/components/shared-binder-viewer';

const data = { title: 'Shared', coverStyle: 'galaxy', page: 0, pageCount: 1, unavailableSlots: [], cards: [{ slot: 1, cardId: 'sv1-200', name: 'Testkarte', setName: 'Set', collectorNumber: '200', image: 'https://assets.tcgdex.net/card/high.webp', finish: 'Normal', holoEffectId: 'galaxy', holoIntensity: .5 }] };
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('dedicated read-only shared binder viewer', () => {
  it('shows no private controls or disabled-price placeholders, including large card view', async () => {
    render(<SharedBinderViewer token={'x'.repeat(43)} />);
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*groß ansehen/ }));
    expect(screen.getByRole('dialog').getAttribute('open')).toBe('');
    expect(document.body.textContent).not.toMatch(/Kaufpreis|Besitz|Menge|Löschen|Hinzufügen|Bearbeiten|Preis verborgen|Cardmarket|€/);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/shared-binders/'), expect.objectContaining({ cache: 'no-store', referrerPolicy: 'no-referrer' }));
  });
  it('clears a previously open card after revocation is detected', async () => {
    render(<SharedBinderViewer token={'x'.repeat(43)} />);
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*groß ansehen/ }));
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.queryByAltText('Testkarte')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('distinguishes temporary card-data errors from empty slots', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...data, cards: [], unavailableSlots: [1] }) } as Response);
    render(<SharedBinderViewer token={'x'.repeat(43)} />);
    expect(await screen.findByText('Kartendaten gerade nicht verfügbar')).toBeTruthy();
  });
  it('uses the original material ID for the cover, binder card and showcase without a timeline', async () => {
    const { container } = render(<SharedBinderViewer token={'x'.repeat(43)} />);
    fireEvent.click(await screen.findByRole('button', { name: /Testkarte.*groß ansehen/ }));
    expect(screen.getByLabelText('Binder-Cover galaxy')).toBeTruthy();
    expect(container.querySelectorAll('[data-material-id="galaxy"]')).toHaveLength(3);
    expect(container.querySelectorAll('canvas')).toHaveLength(5);
    expect(container.querySelector('[style*="rotateX(0deg) rotateY(0deg)"]')).toBeTruthy();
  });
});
