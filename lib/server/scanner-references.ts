import type { ScannerReference } from '@/lib/scanner-profile';

interface MasterIndex {
  schemaVersion: number;
  generatedAt: string;
  stats: Record<string, number>;
  cards: ScannerReference[];
}

let cached: { path: string; modified: number; value: MasterIndex } | null = null;

export async function loadScannerIndex(): Promise<MasterIndex | null> {
  const indexPath = process.env.DOMIDEX_SCANNER_MASTER_INDEX_PATH?.trim();
  if (!indexPath) return null;
  try {
    const fs = await import('node:fs/promises');
    const stat = await fs.stat(indexPath);
    if (cached?.path === indexPath && cached.modified === stat.mtimeMs) return cached.value;
    const value = JSON.parse((await fs.readFile(indexPath, 'utf8')).replace(/^\uFEFF/, '')) as MasterIndex;
    if (value.schemaVersion !== 1 || !Array.isArray(value.cards)) throw new Error('INVALID_INDEX');
    cached = { path: indexPath, modified: stat.mtimeMs, value };
    return value;
  } catch { return null; }
}

export async function loadReferenceImage(file: string) {
  const referenceDir = process.env.DOMIDEX_SCANNER_REFERENCE_DIR?.trim();
  if (!referenceDir || !/^[A-Za-z0-9._-]+\.webp$/.test(file)) return null;
  try {
    const path = await import('node:path'); const fs = await import('node:fs/promises');
    const root = path.resolve(referenceDir); const target = path.resolve(root, file);
    if (path.dirname(target) !== root) return null;
    return await fs.readFile(target);
  } catch { return null; }
}
