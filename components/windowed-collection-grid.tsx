'use client';

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CollectionEntry } from '@/lib/domain';
import { collectionWindow } from '@/lib/collection-grid';

type GridMetrics = { columns: number; width: number; rowHeight: number; gap: number; top: number; viewport: number };
const sameMetrics = (left: GridMetrics, right: GridMetrics) => (Object.keys(left) as (keyof GridMetrics)[]).every((key) => left[key] === right[key]);

/** Windowed rows retain the existing CSS grid's sizing and normal page scrolling. */
export function WindowedCollectionGrid({ entries, onSelect, renderCard }: { entries: CollectionEntry[]; onSelect: (id: string) => void; renderCard: (entry: CollectionEntry) => ReactNode }) {
  const grid = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const pendingFocus = useRef<string | null>(null);
  const measuredMetrics = useRef<GridMetrics | null>(null);
  const heightAtGeometry = useRef({ key: '', height: 0 });
  const [metrics, setMetrics] = useState({ columns: 4, width: 145, rowHeight: 300, gap: 13, top: 0, viewport: 900 });
  const range = collectionWindow(entries.length, metrics.columns, metrics.rowHeight + metrics.gap, metrics.top, metrics.viewport);
  const rendered = useMemo(() => {
    const indices = new Set(Array.from({ length: range.end - range.start }, (_, index) => range.start + index));
    const focused = focusedId ? entries.findIndex((entry) => entry.syncId === focusedId) : -1;
    if (focused >= 0) {
      // Measure the destination's neighbours before keyboard scrolling, too.
      // A taller neighbour first appearing AFTER the jump would otherwise
      // change every row's stride and push the focus target out of view.
      const stride = metrics.rowHeight + metrics.gap;
      const targetTop = Math.min(Math.floor(focused / metrics.columns) * stride,
        Math.max(0, Math.ceil(entries.length / metrics.columns) * stride - metrics.viewport));
      const target = collectionWindow(entries.length, metrics.columns, stride, -targetTop, metrics.viewport);
      for (let index = target.start; index < target.end; index++) indices.add(index);
      indices.add(focused);
    }
    return Array.from(indices).sort((left, right) => left - right);
  }, [entries, focusedId, range.start, range.end, metrics.columns, metrics.rowHeight, metrics.gap, metrics.viewport]);

  useLayoutEffect(() => {
    const node = grid.current; if (!node) return;
    let frame = 0;
    const measure = () => {
      const css = getComputedStyle(node), tracks = css.gridTemplateColumns.split(' ').filter((track) => /^\d+(\.\d+)?px$/.test(track));
      const columns = Math.max(1, tracks.length || 4), gap = parseFloat(css.columnGap) || 13;
      const width = tracks.length ? parseFloat(tracks[0]) : Math.max(1, (node.clientWidth - gap * (columns - 1)) / columns);
      const key = `${columns}:${width}:${gap}`;
      if (heightAtGeometry.current.key !== key) heightAtGeometry.current = { key, height: 0 };
      // A visible tile can leave the window because its own height changed the
      // stride. Never shrink the stride at the same geometry: that would bring
      // it back and synchronously oscillate. Resize starts a fresh measurement,
      // but only after React has committed the NEW inline tile width.
      if (width === metrics.width) {
        heightAtGeometry.current.height = Math.max(heightAtGeometry.current.height,
          ...Array.from(node.querySelectorAll<HTMLButtonElement>(':scope > button')).map((button) => button.offsetHeight));
      }
      const rowHeight = heightAtGeometry.current.height || metrics.rowHeight;
      const next = { columns, width, rowHeight, gap, top: node.getBoundingClientRect().top, viewport: window.innerHeight || 900 };
      measuredMetrics.current = next;
      setMetrics((current) => sameMetrics(current, next) ? current : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure(); window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(node);
    node.querySelectorAll(':scope > button').forEach((button) => observer?.observe(button));
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, [entries.length, metrics.width, metrics.rowHeight, rendered]);
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id || !measuredMetrics.current || !sameMetrics(metrics, measuredMetrics.current)) return;
    const button = buttons.current.get(id), node = grid.current;
    const index = entries.findIndex((entry) => entry.syncId === id);
    if (button && node && index >= 0) {
      button.focus({ preventScroll: true });
      // The newly mounted keyboard target may be taller than previous tiles.
      // Scroll only after that measurement is committed, using the final stride.
      window.scrollTo({ top: Math.max(0, window.scrollY + node.getBoundingClientRect().top + Math.floor(index / metrics.columns) * (metrics.rowHeight + metrics.gap) - 24), behavior: 'auto' });
    }
    pendingFocus.current = null;
  }, [entries, focusedId, focusRequest, metrics, rendered]);

  function moveFocus(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -metrics.columns, ArrowDown: metrics.columns, Home: -index, End: entries.length - 1 - index };
    if (!(event.key in delta)) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(entries.length - 1, index + delta[event.key])), id = entries[target].syncId;
    pendingFocus.current = id; setFocusedId(id); setFocusRequest((request) => request + 1);
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
