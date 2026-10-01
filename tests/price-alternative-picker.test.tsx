// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriceAlternativePicker } from '@/components/price-alternative-picker';
import type { TcgCardDetail, TcgVariant } from '@/lib/domain';

afterEach(cleanup);

const variant = {
  type: 'Holo', size: 'Standard', pricing: { cardmarket: {
    idProduct: 733596, trend: null, avg: 4.44, low: 3.33, unit: 'EUR', updated: '2026-09-25T08:00:00Z',
  } },
} as TcgVariant;
const card = {
  id: 'sv03.5-001', localId: '001', name: 'Bisasam', set: { id: 'sv03.5', name: '151' }, variants_detailed: [variant],
} as TcgCardDetail;

describe('manual Cardmarket alternative picker', () => {
  it('requires an explicit confirmation of a real metric for the exact variant', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    render(<PriceAlternativePicker card={card} variant={variant} onConfirm={confirm} />);
    expect(confirm).not.toHaveBeenCalled();
    const picker = screen.getByRole('combobox', { name: 'Preiskennzahl' });
    if (!(picker instanceof HTMLSelectElement)) throw new Error('Price metric picker must be a select element.');
    expect(picker.value).toBe('');
    expect((screen.getByRole('button', { name: 'Auswahl bestätigen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/kein garantierter Verkaufs- oder Ankaufspreis/i)).toBeTruthy();
    expect(screen.getByText(/Datenstand der Preisquelle/i)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Preiskennzahl' }), { target: { value: 'normal_low' } });
    fireEvent.click(screen.getByRole('button', { name: 'Auswahl bestätigen' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      metric: 'normal_low', productId: 733596, amountMinor: 333, currency: 'EUR',
    })));
    expect(screen.getByRole('status').textContent).toBe('Preiskennzahl bestätigt.');
  });

  it('does not offer an alternative when the guide snapshot is incomplete', () => {
    const incomplete = { ...variant, pricing: { cardmarket: { idProduct: 733596, avg: 4.44, unit: 'EUR' } } } as TcgVariant;
    render(<PriceAlternativePicker card={{ ...card, variants_detailed: [incomplete] }} variant={incomplete} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('keine bestätigbare');
  });

  it('shows a saved choice only as context and allows clearing it without available candidates', async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const selection = { schemaVersion: 1, ownerUid: 'owner', entrySyncId: 'entry', revision: 1, lastMutationId: 'm1', updatedAtClient: 1,
      cleared: false, sourceSetId: 'sv03.5', sourceCardId: 'sv03.5-001', collectorNumber: '001', language: 'GERMAN', finish: 'Holo', variant: 'Standard',
      productId: 733596, metric: 'normal_avg_sell', amountMinor: 444, currency: 'EUR', sourceAt: 1_788_220_800_000, selectedAt: 1_788_220_900_000 } as const;
    const incomplete = { ...variant, pricing: { cardmarket: { idProduct: 733596, unit: 'EUR' } } } as TcgVariant;
    render(<PriceAlternativePicker card={{ ...card, variants_detailed: [incomplete] }} variant={incomplete} selection={selection} onConfirm={vi.fn()} onClear={clear} />);
    expect(screen.getByText(/Aktuell gespeichert/i).textContent).toContain('Durchschnittlicher Verkaufspreis');
    fireEvent.click(screen.getByRole('button', { name: 'Gespeicherte Auswahl entfernen' }));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
  });

  it('warns when available comparison metrics materially diverge', () => {
    const divergent = { ...variant, pricing: { cardmarket: { ...variant.pricing!.cardmarket!, avg: 4.44, low: 2 } } } as TcgVariant;
    render(<PriceAlternativePicker card={{ ...card, variants_detailed: [divergent] }} variant={divergent} onConfirm={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('weichen deutlich ab');
  });
});
