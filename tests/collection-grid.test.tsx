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

describe('bounded large-collection presentation', () => {
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
