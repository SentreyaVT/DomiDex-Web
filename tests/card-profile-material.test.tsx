// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardProfileMaterial } from '@/components/card-profile-material';
import { cardEffectConfigs, drawCardProfile } from '@/lib/card-profile-visual';

vi.mock('@/lib/card-profile-visual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/card-profile-visual')>();
  return { ...actual, drawCardProfile: vi.fn() };
});

const resting = { x: 0, y: 0 };
let resize: (() => void) | undefined;
const disconnect = vi.fn();
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(420);
  vi.mocked(drawCardProfile).mockClear();
  disconnect.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('source profile canvas lifecycle', () => {
  it('uses the exact parent tilt and stays optically still while idle', () => {
    const { rerender, container } = render(<CardProfileMaterial profile={cardEffectConfigs.HOLO} tilt={resting} />);
    expect(container.querySelector('canvas')?.dataset.profileId).toBe('HOLO');
    expect(vi.mocked(drawCardProfile).mock.calls.at(-1)?.slice(1)).toEqual([300, 420, cardEffectConfigs.HOLO, resting]);
    const count = vi.mocked(drawCardProfile).mock.calls.length;
    vi.useFakeTimers();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(drawCardProfile).toHaveBeenCalledTimes(count);
    rerender(<CardProfileMaterial profile={cardEffectConfigs.HOLO} tilt={{ x: 8, y: -4 }} />);
    expect(vi.mocked(drawCardProfile).mock.calls.at(-1)?.[4]).toEqual({ x: 8, y: -4 });
    rerender(<CardProfileMaterial profile={cardEffectConfigs.HOLO} tilt={resting} />);
    expect(vi.mocked(drawCardProfile).mock.calls.at(-1)?.[4]).toEqual(resting);
  });

  it('redraws layout changes and detaches its observer when removed', () => {
    const { rerender, container, unmount } = render(<CardProfileMaterial profile={cardEffectConfigs.NONE} tilt={resting} />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(drawCardProfile).not.toHaveBeenCalled();
    rerender(<CardProfileMaterial profile={cardEffectConfigs.FULL_GOLD} tilt={resting} />);
    expect(container.querySelector('canvas')?.dataset.profileId).toBe('FULL_GOLD');
    expect(drawCardProfile).toHaveBeenCalledOnce();
    act(() => resize?.());
    expect(drawCardProfile).toHaveBeenCalledTimes(2);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
