import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { ScannerReference } from '../scanner-profile';

interface LocalScannerOptions { indexPath?: string; referenceDir?: string; secret: string; }
interface LocalScannerIndex { schemaVersion: number; generatedAt: string; stats: Record<string, number>; cards: ScannerReference[]; }

export function localScannerArchive(options: LocalScannerOptions): Plugin {
  let cached: { modified: number; value: LocalScannerIndex } | null = null;
  const index = async () => {
    if (!options.indexPath) return null;
    try {
      const stats = await fs.stat(options.indexPath);
      if (cached?.modified === stats.mtimeMs) return cached.value;
      const value = JSON.parse((await fs.readFile(options.indexPath, 'utf8')).replace(/^\uFEFF/, '')) as LocalScannerIndex;
      if (value.schemaVersion !== 1 || !Array.isArray(value.cards)) return null;
      cached = { modified: stats.mtimeMs, value }; return value;
    } catch { return null; }
  };
  return {
    name: 'domidex-local-scanner-archive',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const isIndex = url.pathname === '/__domidex-local/scanner-references';
        const imageMatch = url.pathname.match(/^\/__domidex-local\/scanner-reference-image\/([^/]+)$/);
        if (!isIndex && !imageMatch) return next();
        if (request.headers['x-domidex-local-secret'] !== options.secret) return json(response, 403, { error: 'Lokaler Zugriff verweigert.' });
        if (isIndex) {
          const value = await index();
          if (!value) return json(response, 200, { connected: false, cards: [], total: 0, stats: null, message: 'Lokales Referenzarchiv ist nicht verbunden.' });
          const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('de');
          const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
          const pageSize = Math.min(48, Math.max(8, Number(url.searchParams.get('pageSize')) || 24));
          const filtered = value.cards.filter((card) => !query || `${card.nameDe} ${card.id} ${card.setId} ${card.setName ?? ''} ${card.localId} ${card.rarity ?? ''}`.toLocaleLowerCase('de').includes(query));
          const start = (page - 1) * pageSize;
          return json(response, 200, { connected: true, cards: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, stats: value.stats, generatedAt: value.generatedAt });
        }
        const file = decodeURIComponent(imageMatch![1]);
        if (!options.referenceDir || !/^[A-Za-z0-9._-]+\.webp$/.test(file)) return json(response, 404, { error: 'Referenzbild nicht verfügbar.' });
        const root = path.resolve(options.referenceDir); const target = path.resolve(root, file);
        if (path.dirname(target) !== root) return json(response, 404, { error: 'Referenzbild nicht verfügbar.' });
        try {
          const bytes = await fs.readFile(target); response.statusCode = 200; response.setHeader('Content-Type', 'image/webp');
          response.setHeader('Cache-Control', 'private, max-age=3600'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.end(bytes);
        } catch { json(response, 404, { error: 'Referenzbild nicht verfügbar.' }); }
      });
    },
  };
}

function json(response: import('node:http').ServerResponse, status: number, body: unknown) {
  response.statusCode = status; response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(body));
}
