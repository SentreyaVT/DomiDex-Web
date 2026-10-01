import type { ScannerReference } from '@/lib/scanner-profile';
import { firebaseStorageBucket, readFirebaseStorageObject, readServerScannerReferenceObject } from './firebase-storage-rest';

export type ScannerReferenceAccessMode = 'firebase' | 'server';

interface MasterIndex {
  schemaVersion: number;
  generatedAt: string;
  stats: Record<string, number>;
  cards: ScannerReference[];
}

let cached: { path: string; modified: number; value: MasterIndex } | null = null;
let remoteCached: { bucket: string; mode: ScannerReferenceAccessMode; expiresAt: number; value: MasterIndex } | null = null;

export async function loadScannerIndex(authorization?: string | null, accessMode: ScannerReferenceAccessMode = 'firebase'): Promise<MasterIndex | null> {
  const indexPath = process.env.DOMIDEX_SCANNER_MASTER_INDEX_PATH?.trim();
  if (indexPath) {
    try {
      const fs = await import('node:fs/promises');
      const stat = await fs.stat(indexPath);
      if (cached?.path === indexPath && cached.modified === stat.mtimeMs) return cached.value;
      const value = parseMasterIndex(await fs.readFile(indexPath, 'utf8'));
      cached = { path: indexPath, modified: stat.mtimeMs, value };
      return value;
    } catch { /* Hosted workers use the Firebase archive below. */ }
  }
  return authorization ? loadRemoteScannerIndex(authorization, accessMode) : null;
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

export async function loadRemoteReferenceImage(file: string, authorization: string, accessMode: ScannerReferenceAccessMode = 'firebase') {
  if (!/^[A-Za-z0-9._-]+\.webp$/.test(file)) return null;
  return (accessMode === 'server' ? readServerScannerReferenceObject : readFirebaseStorageObject)(`scanner-reference/images/${file}`, authorization);
}

export async function loadUpstreamReferenceImage(file: string, authorization: string, accessMode: ScannerReferenceAccessMode = 'firebase') {
  if (!/^[A-Za-z0-9._-]+\.webp$/.test(file)) return null;
  const index = await loadScannerIndex(authorization, accessMode);
  const card = index?.cards.find((item) => item.imageFile === file);
  const source = tcgdexReferenceUrl(card?.sourceImageUrl);
  if (!source) return null;
  try {
    const response = await fetch(source, { headers: { Accept: 'image/webp,image/*' }, signal: AbortSignal.timeout(15_000) });
    return response.ok ? response : null;
  } catch { return null; }
}

export function tcgdexReferenceUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'assets.tcgdex.net' || !/^\/de\/[A-Za-z0-9._/-]+$/.test(url.pathname)) return null;
    return `${url.toString().replace(/\/$/, '')}/high.webp`;
  } catch { return null; }
}

export async function loadLocalScannerBridge(pathname: string) {
  const base = process.env.DOMIDEX_LOCAL_SCANNER_BRIDGE_URL?.trim();
  const secret = process.env.DOMIDEX_LOCAL_SCANNER_BRIDGE_SECRET?.trim();
  if (!base || !secret) return null;
  try {
    return await fetch(new URL(pathname, base), { headers: { 'X-DomiDex-Local-Secret': secret } });
  } catch { return null; }
}

async function loadRemoteScannerIndex(authorization: string, accessMode: ScannerReferenceAccessMode): Promise<MasterIndex | null> {
  const bucket = storageBucket();
  if (!bucket) {
    if (accessMode === 'server') throw new Error('STORAGE_NOT_CONFIGURED');
    return null;
  }
  if (remoteCached?.bucket === bucket && remoteCached.mode === accessMode && remoteCached.expiresAt > Date.now()) return remoteCached.value;
  const response = await (accessMode === 'server' ? readServerScannerReferenceObject : readFirebaseStorageObject)('scanner-reference/master-index.json', authorization);
  if (!response?.ok) return null;
  try {
    const value = parseMasterIndex(await response.text());
    remoteCached = { bucket, mode: accessMode, expiresAt: Date.now() + 10 * 60_000, value };
    return value;
  } catch {
    if (accessMode === 'server') throw new Error('SCANNER_REFERENCE_INDEX_INVALID');
    return null;
  }
}

function parseMasterIndex(source: string) {
  const value = JSON.parse(source.replace(/^\uFEFF/, '')) as MasterIndex;
  if (value.schemaVersion !== 1 || !Array.isArray(value.cards)) throw new Error('INVALID_INDEX');
  const allowedVariants = new Set(['normal', 'holo', 'reverse', 'metal', 'lenticular']);
  return {
    ...value,
    cards: value.cards.map((card) => ({
      ...card,
      variants: Array.isArray(card.variants) ? card.variants.filter((variant) => allowedVariants.has(variant)) : [],
    })),
  };
}

function storageBucket() { return firebaseStorageBucket(); }
