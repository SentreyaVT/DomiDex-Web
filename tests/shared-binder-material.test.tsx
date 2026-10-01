// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SharedBinderMaterial } from '@/components/shared-binder-material';
import { drawSharedHolo, proceduralHoloIds } from '@/lib/shared-binder-visual';

vi.mock('@/lib/shared-binder-visual', async (original) => ({
  ...await original<typeof import('@/lib/shared-binder-visual')>(),
  drawSharedHolo: vi.fn(),
}));
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('Image', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(630);
  vi.spyOn(HTMLCanvasElement.prototype, 'clientHeight', 'get').mockReturnValue(880);
  vi.mocked(drawSharedHolo).mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('procedural shared binder material lifecycle', () => {
  it.each(proceduralHoloIds)('renders %s immediately without fetching an obsolete atlas', (effect) => {
    render(<SharedBinderMaterial effect={effect} intensity={.68} tilt={{ x: 1, y: -2 }} />);
    expect(Image).not.toHaveBeenCalled();
    expect(drawSharedHolo).toHaveBeenCalledTimes(2);
    expect(vi.mocked(drawSharedHolo).mock.calls.at(-1)?.slice(4)).toEqual([effect, .68, { x: 1, y: -2 }, 'grooves']);
  });
  it('renders anniversary immediately without an atlas and reuses precisely the passed card tilt', () => {
    const { container, rerender } = render(<SharedBinderMaterial effect="anniversary_30" intensity={.68} tilt={{ x: 2, y: -4 }} />);
    expect(Image).not.toHaveBeenCalled();
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(drawSharedHolo).toHaveBeenCalledTimes(2);
    expect(vi.mocked(drawSharedHolo).mock.calls.map((call) => [call[1], call[4], call[5], call[6], call[7]])).toEqual([
      [null, 'anniversary_30', .68, { x: 2, y: -4 }, 'light'],
      [null, 'anniversary_30', .68, { x: 2, y: -4 }, 'grooves'],
    ]);
    rerender(<SharedBinderMaterial effect="anniversary_30" intensity={.68} tilt={{ x: 2, y: -4 }} />);
    expect(drawSharedHolo).toHaveBeenCalledTimes(2);
    rerender(<SharedBinderMaterial effect="anniversary_30" intensity={.68} tilt={{ x: -3, y: 5 }} />);
    expect(vi.mocked(drawSharedHolo).mock.calls.at(-1)?.[6]).toEqual({ x: -3, y: 5 });
  });
  it('can enable an initially disabled procedural effect and removes it again at zero', () => {
    const { container, rerender } = render(<SharedBinderMaterial effect="anniversary_30" intensity={0} />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(drawSharedHolo).not.toHaveBeenCalled();
    rerender(<SharedBinderMaterial effect="anniversary_30" intensity={.52} />);
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(drawSharedHolo).toHaveBeenCalledTimes(2);
    rerender(<SharedBinderMaterial effect="anniversary_30" intensity={0} />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(Image).not.toHaveBeenCalled();
  });
});
