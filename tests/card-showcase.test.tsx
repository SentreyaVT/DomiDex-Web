// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardShowcase } from '@/components/card-showcase';
import { resolveCardShowcaseEffect } from '@/lib/card-showcase-effect';
import { drawSharedHolo, holoIds } from '@/lib/shared-binder-visual';

vi.mock('@/lib/shared-binder-visual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shared-binder-visual')>();
  return { ...actual, drawSharedHolo: vi.fn() };
});

let reduced = false;
let motionChanged: (() => void) | undefined;
beforeEach(() => {
  reduced = false;
  motionChanged = undefined;
  vi.stubGlobal('React', React);
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; }, addEventListener: (_: string, callback: () => void) => { motionChanged = callback; }, removeEventListener: vi.fn() }));
  vi.stubGlobal('Image', class {
    onload?: () => void;
    width = 2000;
    height = 2400;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerType: string;
    pointerId: number;
    isPrimary: boolean;
    constructor(type: string, options: PointerEventInit = {}) {
      super(type, options);
      this.pointerType = options.pointerType ?? 'mouse';
      this.pointerId = options.pointerId ?? 1;
      this.isPrimary = options.isPrimary ?? true;
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(420);
  vi.mocked(drawSharedHolo).mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function setup(extra: Partial<React.ComponentProps<typeof CardShowcase>> = {}) {
  const rendered = render(<CardShowcase image="https://assets.tcgdex.net/card/high.webp" name="Testkarte" effectId="galaxy" intensity={.5} {...extra} />);
  const stage = screen.getByRole('button', { name: 'Testkarte: interaktive Kartenansicht' });
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 300, height: 420 } as DOMRect);
  return { ...rendered, stage, card: rendered.container.querySelector('[data-card-surface]') as HTMLElement };
}

describe('interactive large card', () => {
  it('uses exactly the same bounded angle for the card and both original material layers', async () => {
    const { stage, card, container } = setup();
    await waitFor(() => expect(drawSharedHolo).toHaveBeenCalled());
    fireEvent.pointerMove(stage, { clientX: 300, clientY: 0, pointerType: 'mouse' });
    expect(card.style.transform).toContain('rotateX(8deg) rotateY(8deg)');
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(container.querySelector('[data-material-id="galaxy"]')?.parentElement).toBe(card);
    expect(vi.mocked(drawSharedHolo).mock.calls.slice(-2).map((call) => call[6])).toEqual([{ x: 8, y: 8 }, { x: 8, y: 8 }]);
    fireEvent.pointerLeave(stage);
    expect(card.style.transform).toContain('rotateX(0deg) rotateY(0deg)');
  });

  it('does not redraw or alter the effect while idle', async () => {
    const { card } = setup();
    await waitFor(() => expect(drawSharedHolo).toHaveBeenCalled());
    const count = vi.mocked(drawSharedHolo).mock.calls.length;
    const transform = card.style.transform;
    vi.useFakeTimers();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(drawSharedHolo).toHaveBeenCalledTimes(count);
    expect(card.style.transform).toBe(transform);
  });

  it('supports bounded keyboard movement and Home reset without opening another dialog', () => {
    const expand = vi.fn();
    const { stage, card, container } = setup({ onExpand: expand });
    for (let index = 0; index < 10; index++) fireEvent.keyDown(stage, { key: 'ArrowRight' });
    fireEvent.keyDown(stage, { key: 'ArrowUp' });
    expect(card.style.transform).toContain('rotateX(2deg) rotateY(8deg)');
    fireEvent.keyDown(stage, { key: 'Home' });
    expect(card.style.transform).toContain('rotateX(0deg) rotateY(0deg)');
    fireEvent.click(screen.getByRole('button', { name: 'Großansicht' }));
    expect(expand).toHaveBeenCalledOnce();
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('only follows an active touch and resets on cancellation, release and focus loss', () => {
    const { stage, card } = setup();
    const touch = { pointerType: 'touch', pointerId: 3, clientX: 300, clientY: 0, button: 0 };
    fireEvent.pointerMove(stage, touch);
    expect(card.dataset.tiltY).toBe('0');
    fireEvent.pointerDown(stage, touch);
    expect(card.dataset.tiltY).toBe('8');
    fireEvent.pointerMove(stage, { ...touch, pointerId: 4, clientX: 0 });
    expect(card.dataset.tiltY).toBe('8');
    fireEvent.pointerCancel(stage, touch);
    expect(card.dataset.tiltY).toBe('0');
    fireEvent.pointerDown(stage, touch);
    fireEvent.pointerUp(stage, touch);
    expect(card.dataset.tiltY).toBe('0');
    fireEvent.pointerDown(stage, touch);
    fireEvent.blur(window);
    expect(card.dataset.tiltY).toBe('0');
  });

  it('respects reduced motion at runtime for rotation and material together', async () => {
    const { stage, card } = setup();
    await waitFor(() => expect(drawSharedHolo).toHaveBeenCalled());
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    act(() => { reduced = true; motionChanged?.(); });
    fireEvent.pointerMove(stage, { clientX: 300, clientY: 0 });
    fireEvent.keyDown(stage, { key: 'ArrowUp' });
    expect(card.style.transform).toContain('rotateX(0deg) rotateY(0deg)');
    expect(vi.mocked(drawSharedHolo).mock.calls.at(-1)?.[6]).toEqual({ x: 0, y: 0 });
    expect(screen.getByText('Ruhige Ansicht · Bewegung ist reduziert.')).toBeTruthy();
  });

  it('keeps unavailable images honest and removes their material', () => {
    const { container } = setup();
    fireEvent.error(screen.getByAltText('Testkarte'));
    expect(screen.getByText('Kartenbild nicht verfügbar')).toBeTruthy();
    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('source-based showcase effects', () => {
  it('uses every supported placement ID unchanged and preserves zero intensity', () => {
    for (const id of holoIds) expect(resolveCardShowcaseEffect({ effectId: id, intensity: .72 })).toMatchObject({ id, intensity: .72, kind: 'material' });
    expect(resolveCardShowcaseEffect({ effectId: 'galaxy', intensity: 0 }).intensity).toBe(0);
    expect(resolveCardShowcaseEffect({ effectId: 'galaxy', intensity: Infinity }).intensity).toBe(0);
    expect(resolveCardShowcaseEffect({ effectId: 'galaxy', intensity: 2 }).intensity).toBe(1);
  });
  it('never invents a holo for a normal finish or an explicit NONE override', () => {
    expect(resolveCardShowcaseEffect({ finish: 'Normal' }).id).toBeNull();
    expect(resolveCardShowcaseEffect({ finish: 'Holo', effectOverride: 'NONE' }).id).toBeNull();
    expect(resolveCardShowcaseEffect({ finish: 'Holo', effectId: 'none' }).id).toBeNull();
  });
  it('resolves collection Holo to its own profile instead of a binder atlas material', () => {
    expect(resolveCardShowcaseEffect({ finish: 'Holo' })).toMatchObject({ id: null, profile: { profile: 'HOLO', zones: ['ARTWORK', 'BORDER'], intensity: .5 }, kind: 'profile' });
    expect(resolveCardShowcaseEffect({ finish: 'Normal', effectOverride: 'HOLO' }).kind).toBe('profile');
  });
  it('preserves every supported Android profile and keeps unknown saved values honest', () => {
    for (const effectOverride of ['REVERSE_HOLO', 'DOUBLE_RARE', 'ILLUSTRATION_RARE', 'ULTRA_RARE', 'SPECIAL_ILLUSTRATION_RARE', 'HYPER_RARE', 'FULL_GOLD', 'EX', 'FULL_ART', 'SPECIAL']) {
      expect(resolveCardShowcaseEffect({ effectOverride, finish: 'Holo' })).toMatchObject({ id: null, profile: { profile: effectOverride }, kind: 'profile' });
    }
    expect(resolveCardShowcaseEffect({ effectOverride: 'future_profile', finish: 'Holo' })).toMatchObject({ id: null, profile: null, kind: 'unsupported', note: expect.stringContaining('noch nicht verfügbar') });
    expect(resolveCardShowcaseEffect({ effectId: 'future_material', finish: 'Holo' }).kind).toBe('unsupported');
    expect(resolveCardShowcaseEffect({ finish: 'Reverse Holo' })).toMatchObject({ kind: 'profile', profile: { profile: 'REVERSE_HOLO', zones: ['BODY'] } });
  });
});
