// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCardVisualRarity } from '@/components/use-card-visual-rarity';
import { resolveCardShowcaseEffect } from '@/lib/card-showcase-effect';
import { loadCard } from '@/lib/tcgdex';
import type { TcgCardDetail } from '@/lib/domain';

vi.mock('@/lib/tcgdex', () => ({ loadCard: vi.fn() }));

type Input = Parameters<typeof useCardVisualRarity>[0];
const saved: Input = Object.freeze({ sourceCardId: 'me04-091', sourceSetId: 'me04', collectorNumber: '091', rarity: 'Common', effectOverride: null, effectId: null });
// The bundled me04 manifest identifies Xerneas 091 as Illustration rare; 042 is the ordinary Rare.
const catalog: TcgCardDetail = { id: 'me04-091', localId: '091', name: 'Xerneas', rarity: 'Illustration rare', set: { id: 'me04', name: 'Testset' } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadCard).mockResolvedValue(catalog); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('catalog rarity refresh for visual rendering only', () => {
  it('uses the exact Xerneas catalog rarity instead of stale Common metadata without mutating the saved card', async () => {
    const { result } = renderHook(() => useCardVisualRarity(saved));
    expect(result.current).toBe('Common');
    await waitFor(() => expect(result.current).toBe('Illustration rare'));
    expect(loadCard).toHaveBeenCalledOnce();
    expect(loadCard).toHaveBeenCalledWith('me04-091');
    expect(resolveCardShowcaseEffect({ finish: 'Holo', rarity: result.current })).toMatchObject({ profile: { profile: 'ILLUSTRATION_RARE', zones: ['FULL_CARD'] } });
    expect(saved).toMatchObject({ rarity: 'Common', sourceCardId: 'me04-091', collectorNumber: '091', effectOverride: null });
  });

  it('supports the localized source rarity while preserving generic HOLO identity with full-card coverage', async () => {
    vi.mocked(loadCard).mockResolvedValue({ ...catalog, rarity: 'Selten, Illustration' });
    const input = { ...saved, effectOverride: 'HOLO' };
    const { result } = renderHook(() => useCardVisualRarity(input));
    await waitFor(() => expect(result.current).toBe('Selten, Illustration'));
    expect(resolveCardShowcaseEffect({ finish: 'Holo', effectOverride: 'HOLO', rarity: result.current })).toMatchObject({ profile: { profile: 'HOLO', zones: ['FULL_CARD'], intensity: .5 } });
    expect(input.rarity).toBe('Common');
  });

  it('accepts ordinary Selten without promoting it to a full-card profile', async () => {
    vi.mocked(loadCard).mockResolvedValue({ ...catalog, id: 'me04-042', localId: '042', rarity: 'Selten' });
    const { result } = renderHook(() => useCardVisualRarity({ ...saved, sourceCardId: 'me04-042', collectorNumber: '042' }));
    await waitFor(() => expect(result.current).toBe('Selten'));
    expect(resolveCardShowcaseEffect({ finish: 'Holo', rarity: result.current })).toMatchObject({ profile: { profile: 'HOLO', zones: ['ARTWORK', 'BORDER'] } });
  });

  it('normalizes an explicit printing suffix and formatting-only set/number differences', async () => {
    const { result } = renderHook(() => useCardVisualRarity({ ...saved, sourceCardId: 'me04-091-holofoil', sourceSetId: 'ME04', collectorNumber: '00091/120' }));
    await waitFor(() => expect(result.current).toBe('Illustration rare'));
    expect(loadCard).toHaveBeenCalledWith('me04-091');
  });

  it.each([
    { ...catalog, id: 'me04-042' },
    { ...catalog, set: { id: 'me03', name: 'Another set' } },
    { ...catalog, localId: '042' },
  ])('ignores conflicting returned card, set or collector number', async (conflict) => {
    vi.mocked(loadCard).mockResolvedValue(conflict);
    const { result } = renderHook(() => useCardVisualRarity(saved));
    await act(async () => { await Promise.resolve(); });
    expect(loadCard).toHaveBeenCalledOnce();
    expect(result.current).toBe('Common');
  });

  it('keeps the original rarity when the catalog request fails', async () => {
    vi.mocked(loadCard).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCardVisualRarity(saved));
    await act(async () => { await Promise.resolve(); });
    expect(loadCard).toHaveBeenCalledOnce();
    expect(result.current).toBe('Common');
  });

  it.each(['', '  ', 'UNKNOWN', undefined])('keeps saved metadata when the catalog rarity is unavailable (%s)', async (rarity) => {
    vi.mocked(loadCard).mockResolvedValue({ ...catalog, rarity });
    const { result } = renderHook(() => useCardVisualRarity(saved));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe('Common');
  });

  it('drops an old resolved rarity immediately on identity change, before the next response arrives', async () => {
    const next = deferred<TcgCardDetail>();
    vi.mocked(loadCard).mockResolvedValueOnce(catalog).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook((input: Input) => useCardVisualRarity(input), { initialProps: saved });
    await waitFor(() => expect(result.current).toBe('Illustration rare'));
    rerender({ ...saved, sourceCardId: 'me04-042', collectorNumber: '042', rarity: 'Rare' });
    expect(result.current).toBe('Rare');
    await act(async () => next.resolve({ ...catalog, id: 'me04-042', localId: '042', rarity: 'Selten' }));
    expect(result.current).toBe('Selten');
  });

  it('ignores a late response from a previous card after the new card has resolved', async () => {
    const previous = deferred<TcgCardDetail>(), current = deferred<TcgCardDetail>();
    vi.mocked(loadCard).mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook((input: Input) => useCardVisualRarity(input), { initialProps: saved });
    rerender({ ...saved, sourceCardId: 'me04-042', collectorNumber: '042', rarity: 'Rare' });
    await act(async () => current.resolve({ ...catalog, id: 'me04-042', localId: '042', rarity: 'Selten' }));
    expect(result.current).toBe('Selten');
    await act(async () => previous.resolve(catalog));
    expect(result.current).toBe('Selten');
    expect(loadCard).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...saved, sourceCardId: null },
    { ...saved, sourceCardId: undefined, rarity: undefined },
    { ...saved, sourceCardId: '', rarity: null },
    { ...saved, sourceSetId: null },
    { ...saved, collectorNumber: null },
    { ...saved, sourceCardId: 'invalid/card' },
    { ...saved, effectId: 'galaxy' },
    { ...saved, effectId: '' },
    { ...saved, effectId: 'none' },
    { ...saved, effectId: 'future-material' },
    { ...saved, effectOverride: 'NONE' },
    { ...saved, effectOverride: 'REVERSE_HOLO' },
    { ...saved, effectOverride: 'FULL_GOLD' },
    { ...saved, effectOverride: 'future-profile' },
  ])('skips unavailable identities and authoritative saved effects', async (input) => {
    const { result } = renderHook(() => useCardVisualRarity(input));
    await act(async () => { await Promise.resolve(); });
    expect(loadCard).not.toHaveBeenCalled();
    expect(result.current).toBe(input.rarity);
  });

  it('ignores an in-flight rarity response after an authoritative override is selected', async () => {
    const request = deferred<TcgCardDetail>();
    vi.mocked(loadCard).mockReturnValue(request.promise);
    const { result, rerender } = renderHook((input: Input) => useCardVisualRarity(input), { initialProps: saved });
    rerender({ ...saved, effectOverride: 'NONE' });
    await act(async () => request.resolve(catalog));
    expect(result.current).toBe('Common');
    expect(resolveCardShowcaseEffect({ finish: 'Holo', rarity: result.current, effectOverride: 'NONE' }).kind).toBe('none');
  });
});
