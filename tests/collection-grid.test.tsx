// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowedCollectionGrid } from '@/components/windowed-collection-grid';
import { collectionThumbnail, collectionWindow, sortedCollection } from '@/lib/collection-grid';
import type { CollectionEntry } from '@/lib/domain';

const entries: CollectionEntry[] = Array.from({ length: 10000 }, (_, index) => ({ syncId: `entry-${index}`, name: `Karte ${index}`, setName: index % 2 ? 'Set B' : 'Set A', collectorNumber: String(index), finish: index % 2 ? 'Holo' : 'Normal', variant: 'Standard', quantity: 1 }) as CollectionEntry);
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('getComputedStyle', vi.fn().mockReturnValue({ gridTemplateColumns: '145px 145px 145px 145px', columnGap: '13px', getPropertyValue: () => '' }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function controlledGeometry(height: (button: HTMLElement, inlineWidth: number) => number) {
  let width = 145, nextFrame = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const measurements: { cssWidth: number; inlineWidth: number; index: string | undefined }[] = [];
  const observers: TestResizeObserver[] = [];
  class TestResizeObserver implements ResizeObserver {
    readonly targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
    observe = vi.fn((target: Element) => { this.targets.add(target); });
    unobserve = vi.fn((target: Element) => { this.targets.delete(target); });
    disconnect = vi.fn(() => { this.targets.clear(); });
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrame++; frames.set(id, callback); return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('scrollY', 0);
  vi.stubGlobal('getComputedStyle', vi.fn(() => ({
    gridTemplateColumns: Array(4).fill(`${width}px`).join(' '), columnGap: '13px', getPropertyValue: () => '',
  })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    const inlineWidth = Number.parseFloat(this.style.width);
    measurements.push({ cssWidth: width, inlineWidth, index: this.dataset.collectionIndex });
    return height(this, inlineWidth);
  });
  return {
    frames, observers, measurements,
    setWidth(value: number) { width = value; },
    resize(target: Element) {
      const listening = observers.filter(observer => observer.targets.has(target));
      expect(listening).toHaveLength(1);
      act(() => listening[0].callback([{ target } as ResizeObserverEntry], listening[0]));
    },
    flushFrames() {
      let flushed = 0;
      while (frames.size) {
        expect(++flushed).toBeLessThanOrEqual(20);
        const [id, callback] = frames.entries().next().value!;
        frames.delete(id);
        act(() => callback(flushed * 16));
      }
      return flushed;
    },
  };
}

describe('bounded large-collection presentation', () => {
  it('measures a taller destination neighbour before the first End scroll', () => {
    const geometry = controlledGeometry(button => button.dataset.collectionIndex === '349' ? 480 : 300);
    render(<WindowedCollectionGrid entries={entries.slice(0, 351)} onSelect={vi.fn()} renderCard={(entry) => <span>{entry.name}</span>} />);
    const first = screen.getAllByRole('button')[0];
    expect(screen.queryByRole('button', { name: /^Karte 349,/ })).toBeNull();
    act(() => first.focus());
    const neighbourMeasuredAtScroll: boolean[] = [];
    vi.mocked(scrollTo).mockImplementation(() => {
      neighbourMeasuredAtScroll.push(geometry.measurements.some(read => read.index === '349' && read.inlineWidth === 145));
    });
    fireEvent.keyDown(first, { key: 'End' });
    geometry.flushFrames();
    const last = screen.getByRole('button', { name: /^Karte 350,/ });
    expect(document.activeElement).toBe(last);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 87 * 493 - 24, behavior: 'auto' });
    expect(neighbourMeasuredAtScroll).toEqual([true]);
    expect(last.style.top).toBe(`${87 * 493}px`);
    expect(screen.getByRole('group', { name: 'Karten in der Sammlung' }).style.height).toBe(`${88 * 493 - 13}px`);
    expect(screen.getAllByRole('button').length).toBeLessThan(40);
  });
  it('scrolls End to the committed taller target stride instead of the previous row height', () => {
    const geometry = controlledGeometry(button => button.dataset.collectionIndex === '350' ? 420 : 300);
    render(<WindowedCollectionGrid entries={entries.slice(0, 351)} onSelect={vi.fn()} renderCard={(entry) => <span>{entry.name}</span>} />);
    const first = screen.getAllByRole('button')[0];
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'End' });
    geometry.flushFrames();
    const last = screen.getByRole('button', { name: /^Karte 350,/ });
    expect(document.activeElement).toBe(last);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 87 * 433 - 24, behavior: 'auto' });
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 87 * 313 - 24, behavior: 'auto' });
    expect(last.style.top).toBe(`${87 * 433}px`);
    expect(screen.getByRole('group', { name: 'Karten in der Sammlung' }).style.height).toBe(`${88 * 433 - 13}px`);
    expect(screen.getAllByRole('button').length).toBeLessThan(40);
  });
  it('honors a second End request when the final card already has keyboard focus', () => {
    const geometry = controlledGeometry(button => button.dataset.collectionIndex === '350' ? 420 : 300);
    render(<WindowedCollectionGrid entries={entries.slice(0, 351)} onSelect={vi.fn()} renderCard={(entry) => <span>{entry.name}</span>} />);
    const first = screen.getAllByRole('button')[0];
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'End' });
    geometry.flushFrames();
    const last = screen.getByRole('button', { name: /^Karte 350,/ });
    expect(document.activeElement).toBe(last);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(last, { key: 'End' });
    geometry.flushFrames();
    expect(document.activeElement).toBe(last);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenNthCalledWith(2, { top: 37647, behavior: 'auto' });
    expect(screen.getAllByRole('button').length).toBeLessThan(40);
  });
  it('observes later growth of a nonfirst tile and retains that height at unchanged geometry', () => {
    let laterHeight = 300;
    const geometry = controlledGeometry(button => button.dataset.collectionIndex === '7' ? laterHeight : 300);
    render(<WindowedCollectionGrid entries={entries.slice(0, 351)} onSelect={vi.fn()} renderCard={(entry) => <span>{entry.name}</span>} />);
    const group = screen.getByRole('group', { name: 'Karten in der Sammlung' });
    const later = screen.getByRole('button', { name: /^Karte 7,/ });
    expect(later).not.toBe(screen.getAllByRole('button')[0]);
    expect(group.style.height).toBe(`${88 * 313 - 13}px`);
    laterHeight = 430;
    geometry.resize(later);
    expect(geometry.frames.size).toBe(1);
    expect(group.style.height).toBe(`${88 * 313 - 13}px`);
    expect(geometry.flushFrames()).toBe(1);
    expect(group.style.height).toBe(`${88 * 443 - 13}px`);
    laterHeight = 300;
    geometry.resize(later);
    geometry.flushFrames();
    expect(group.style.height).toBe(`${88 * 443 - 13}px`);
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it('resets the height bound for new widths without measuring tiles at their stale inline width', () => {
    const geometry = controlledGeometry((_button, width) => width === 110 ? 420 : width === 200 ? 260 : 300);
    render(<WindowedCollectionGrid entries={entries.slice(0, 351)} onSelect={vi.fn()} renderCard={(entry) => <span>{entry.name}</span>} />);
    const group = screen.getByRole('group', { name: 'Karten in der Sammlung' });
    expect(group.style.height).toBe(`${88 * 313 - 13}px`);
    for (const [width, rowHeight] of [[110, 420], [200, 260]]) {
      geometry.measurements.length = 0;
      geometry.setWidth(width);
      geometry.resize(group);
      geometry.flushFrames();
      expect(screen.getAllByRole('button').every(button => button.style.width === `${width}px`)).toBe(true);
      expect(geometry.measurements.length).toBeGreaterThan(0);
      expect(geometry.measurements.every(read => read.cssWidth === width && read.inlineWidth === width)).toBe(true);
      expect(group.style.height).toBe(`${88 * (rowHeight + 13) - 13}px`);
      expect(screen.getAllByRole('button').length).toBeLessThan(40);
    }
  });
  it('cancels obsolete frames and observers across filtering empty results and unmount', () => {
    const geometry = controlledGeometry(() => 300);
    const select = vi.fn();
    const renderCard = (entry: CollectionEntry) => <span>{entry.name}</span>;
    const { rerender, unmount } = render(<WindowedCollectionGrid entries={entries.slice(0, 351)} onSelect={select} renderCard={renderCard} />);
    const originalObservers = [...geometry.observers];
    fireEvent.scroll(window);
    expect(geometry.frames.size).toBe(1);
    rerender(<WindowedCollectionGrid entries={[entries[349]]} onSelect={select} renderCard={renderCard} />);
    expect(geometry.frames.size).toBe(0);
    expect(originalObservers.every(observer => observer.disconnect.mock.calls.length > 0 && observer.targets.size === 0)).toBe(true);
    const only = screen.getByRole('button', { name: /^Karte 349,/ });
    fireEvent.click(only);
    expect(select).toHaveBeenCalledExactlyOnceWith('entry-349');
    const filteredObservers = [...geometry.observers];
    geometry.resize(only);
    expect(geometry.frames.size).toBe(1);
    rerender(<WindowedCollectionGrid entries={[]} onSelect={select} renderCard={renderCard} />);
    expect(geometry.frames.size).toBe(0);
    expect(filteredObservers.every(observer => observer.disconnect.mock.calls.length > 0 && observer.targets.size === 0)).toBe(true);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Karten in der Sammlung' }).style.height).toBe('0px');
    fireEvent.resize(window);
    expect(geometry.frames.size).toBe(1);
    unmount();
    expect(geometry.frames.size).toBe(0);
    expect(geometry.observers.every(observer => observer.disconnect.mock.calls.length > 0 && observer.targets.size === 0)).toBe(true);
    const scheduled = vi.mocked(requestAnimationFrame).mock.calls.length;
    fireEvent.scroll(window); fireEvent.resize(window);
    expect(geometry.frames.size).toBe(0);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(scheduled);
  });
  it('settles a scrolled window when a taller price tile crosses the measurement boundary', () => {
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.classList.contains('collection-grid') ? -10000 : 0 } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.collectionIndex === '140' ? 350 : 300;
    });
    // At 300px the window [116,148) includes the taller tile140; at350px
    // [100,132) excludes it. Measuring only the current window must not cycle.
    expect(() => render(<WindowedCollectionGrid entries={entries.slice(0, 351)} onSelect={vi.fn()} renderCard={(entry) => <span>{entry.name}</span>} />)).not.toThrow();
    const group = screen.getByRole('group', { name: 'Karten in der Sammlung' });
    expect(group.style.height).toBe(`${88 * 363 - 13}px`);
    expect(screen.getAllByRole('button').length).toBeLessThan(40);
    expect(group.querySelector('[data-collection-index="140"]')).toBeNull();
    expect(group.querySelector('[data-collection-index="100"]')).not.toBeNull();
  });
  it('renders only visible rows with overscan rather than ten thousand cards', () => {
    render(<WindowedCollectionGrid entries={entries} onSelect={vi.fn()} renderCard={(entry) => <span>{entry.name}</span>} />);
    expect(screen.getAllByRole('button').length).toBeLessThan(40);
    expect(screen.queryByRole('button', { name: /^Karte 9999,/ })).toBeNull();
    expect(screen.getByRole('group', { name: 'Karten in der Sammlung' }).style.height).toMatch(/px$/);
  });
  it('keeps full-collection filtering and highest-price-first ordering with stable printing identity', () => {
    const prices = { 'entry-9998': 900, 'entry-10': 50, 'entry-12': 50 };
    const result = sortedCollection(entries, prices, 'Set A');
    expect(result).toHaveLength(5000);
    expect(result.slice(0, 3).map((entry) => entry.syncId)).toEqual(['entry-9998', 'entry-10', 'entry-12']);
    expect(result[0]).toBe(entries[9998]);
    expect(entries[0].syncId).toBe('entry-0');
    const select = vi.fn();
    render(<WindowedCollectionGrid entries={result} onSelect={select} renderCard={(entry) => <span>{entry.name}</span>} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(select).toHaveBeenCalledWith('entry-9998');
  });
  it('can reach the final card by keyboard without mounting preceding thousands of buttons', async () => {
    render(<WindowedCollectionGrid entries={entries} onSelect={vi.fn()} renderCard={(entry) => <span>{entry.name}</span>} />);
    const first = screen.getAllByRole('button')[0];
    act(() => { first.focus(); });
    fireEvent.keyDown(first, { key: 'End' });
    const last = screen.getByRole('button', { name: /^Karte 9999,/ });
    await waitFor(() => expect(document.activeElement).toBe(last));
    expect(screen.getAllByRole('button').length).toBeLessThan(42);
    expect(scrollTo).toHaveBeenCalled();
    fireEvent.keyDown(last, { key: 'Home' });
    await waitFor(() => expect(document.activeElement).toBe(first));
  });
  it('reuses the right ID after filtering/reordering, never a stale visual slot', () => {
    const select = vi.fn();
    const { rerender } = render(<WindowedCollectionGrid entries={entries} onSelect={select} renderCard={(entry) => <span>{entry.name}</span>} />);
    rerender(<WindowedCollectionGrid entries={[entries[9999], entries[100]]} onSelect={select} renderCard={(entry) => <span>{entry.name}</span>} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(select).toHaveBeenCalledWith('entry-9999');
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
  it('bounds rows at the middle and tail of a very large scrolled grid', () => {
    const middle = collectionWindow(10000, 6, 350, -100000, 900);
    expect(middle.start).toBeGreaterThan(1000); expect(middle.end - middle.start).toBeLessThan(60);
    const tail = collectionWindow(3, 4, 300, -100000, 900);
    expect(tail).toEqual({ start: 0, end: 3, rows: 1 });
  });
  it('only swaps known TCGdex thumbnail paths, not signed or unrelated card URLs', () => {
    expect(collectionThumbnail('https://assets.tcgdex.net/de/sv/sv03.5/001/high.webp')).toBe('https://assets.tcgdex.net/de/sv/sv03.5/001/low.webp');
    for (const url of ['https://example.invalid/high.webp', 'https://assets.tcgdex.net/de/sv/sv03.5/001/high.webp?token=private', '/my/high.webp', 'https://assets.tcgdex.net/de/sv/sv03.5/001']) expect(collectionThumbnail(url)).toBe(url);
  });
});
