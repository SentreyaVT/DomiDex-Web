import type { CollectionEntry } from './domain';

export function sortedCollection(entries: CollectionEntry[], prices: Record<string, number | null>, query: string) {
  const search = query.trim().toLocaleLowerCase('de');
  const value = (id: string) => typeof prices[id] === 'number' && Number.isFinite(prices[id]) ? prices[id]! : -1;
  return entries.filter((entry) => `${entry.name} ${entry.setName} ${entry.collectorNumber}`.toLocaleLowerCase('de').includes(search))
    .sort((left, right) => value(right.syncId) - value(left.syncId) || left.syncId.localeCompare(right.syncId));
}

/** Only the catalog's documented high/low WebP siblings are interchangeable. */
export function collectionThumbnail(image: string) {
  try {
    const url = new URL(image);
    if (url.protocol === 'https:' && url.hostname === 'assets.tcgdex.net' && !url.port && !url.username && !url.password && !url.search && !url.hash
      && /^\/[a-z]{2}\/[a-zA-Z0-9._/-]+\/high\.webp$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/high\.webp$/, '/low.webp'); return url.href;
    }
  } catch { /* Existing non-catalog paths remain unchanged; do not invent thumbnail URLs. */ }
  return image;
}

export function collectionWindow(count: number, columns: number, stride: number, top: number, viewport: number, overscan = 2) {
  const rows = Math.ceil(count / columns);
  const firstRow = Math.min(Math.max(0, rows - 1), Math.max(0, Math.floor(Math.max(0, -top) / stride) - overscan));
  const lastRow = Math.min(rows, Math.max(firstRow + 1, Math.ceil(Math.max(0, viewport - top) / stride) + overscan));
  return { start: firstRow * columns, end: Math.min(count, lastRow * columns), rows };
}
