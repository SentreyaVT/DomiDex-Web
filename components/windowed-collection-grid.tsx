'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CollectionEntry } from '@/lib/domain';
import { collectionWindow } from '@/lib/collection-grid';

/** Windowed rows retain the existing CSS grid's sizing and normal page scrolling. */
export function WindowedCollectionGrid({ entries, onSelect, renderCard }: { entries: CollectionEntry[]; onSelect: (id: string) => void; renderCard: (entry: CollectionEntry) => ReactNode }) {
  const grid = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const [metrics, setMetrics] = useState({ columns: 4, width: 145, rowHeight: 300, gap: 13, top: 0, viewport: 900 });
  const range = collectionWindow(entries.length, metrics.columns, metrics.rowHeight + metrics.gap, metrics.top, metrics.viewport);
  const rendered = useMemo(() => {
    const indices = Array.from({ length: range.end - range.start }, (_, index) => range.start + index);
    const focused = focusedId ? entries.findIndex((entry) => entry.syncId === focusedId) : -1;
    if (focused >= 0 && !indices.includes(focused)) indices.push(focused);
    return indices.sort((left, right) => left - right);
  }, [entries, focusedId, range.start, range.end]);

  useLayoutEffect(() => {
    const node = grid.current; if (!node) return;
    let frame = 0;
    const measure = () => {
      const css = getComputedStyle(node), tracks = css.gridTemplateColumns.split(' ').filter((track) => /^\d+(\.\d+)?px$/.test(track));
      const columns = Math.max(1, tracks.length || 4), gap = parseFloat(css.columnGap) || 13;
      const width = tracks.length ? parseFloat(tracks[0]) : Math.max(1, (node.clientWidth - gap * (columns - 1)) / columns);
      const rowHeight = Math.max(0, ...Array.from(node.querySelectorAll<HTMLButtonElement>('button')).map((button) => button.offsetHeight)) || 300;
      const next = { columns, width, rowHeight, gap, top: node.getBoundingClientRect().top, viewport: window.innerHeight || 900 };
      setMetrics((current) => Object.keys(next).every((key) => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure(); window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(node);
    const first = node.querySelector('button'); if (first) observer?.observe(first);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, [entries.length, metrics.width, range.start]);
  useEffect(() => {
    if (pendingFocus.current) { buttons.current.get(pendingFocus.current)?.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [focusedId, rendered]);

  function moveFocus(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -metrics.columns, ArrowDown: metrics.columns, Home: -index, End: entries.length - 1 - index };
    if (!(event.key in delta)) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(entries.length - 1, index + delta[event.key])), id = entries[target].syncId;
    pendingFocus.current = id; setFocusedId(id);
    const node = grid.current;
    if (node) window.scrollTo({ top: Math.max(0, window.scrollY + node.getBoundingClientRect().top + Math.floor(target / metrics.columns) * (metrics.rowHeight + metrics.gap) - 24), behavior: 'auto' });
  }
  return <div className="collection-grid" ref={grid} role="group" aria-label="Karten in der Sammlung" style={{ position: 'relative', height: Math.max(0, range.rows * (metrics.rowHeight + metrics.gap) - metrics.gap) }}>
    {rendered.map((index) => {
      const entry = entries[index];
      return <button key={entry.syncId} ref={(button) => { if (button) buttons.current.set(entry.syncId, button); else buttons.current.delete(entry.syncId); }}
        data-collection-index={index} data-collection-id={entry.syncId}
        aria-label={`${entry.name}, ${entry.setName}, Nummer ${entry.collectorNumber}, ${entry.finish}, ${entry.variant}, ${entry.quantity} im Besitz`}
        onFocus={() => setFocusedId(entry.syncId)} onKeyDown={(event) => moveFocus(event, index)} onClick={() => onSelect(entry.syncId)}
        style={{ position: 'absolute', top: Math.floor(index / metrics.columns) * (metrics.rowHeight + metrics.gap), left: index % metrics.columns * (metrics.width + metrics.gap), width: metrics.width }}>
        {renderCard(entry)}<span className="quantity-badge">×{entry.quantity}</span>
      </button>;
    })}
  </div>;
}
