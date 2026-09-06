import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRemoteReferenceImage, loadScannerIndex, tcgdexReferenceUrl } from '@/lib/server/scanner-references';

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'domidex-scanner-reference-'));
  temporaryRoots.push(root);
  return root;
}

describe('Firebase scanner reference archive', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('forwards the verified Firebase session without exposing the object publicly', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'domidex-test.firebasestorage.app');
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await loadRemoteReferenceImage('A1-001.webp', 'Bearer firebase-id-token');

    expect(response?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('scanner-reference%2Fimages%2FA1-001.webp'),
      expect.objectContaining({ headers: { Authorization: 'Firebase firebase-id-token' } }),
    );
  });

  it('rejects unsafe reference filenames before requesting Storage', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'domidex-test.firebasestorage.app');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadRemoteReferenceImage('../secret.webp', 'Bearer token')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('permits only the official German TCGdex asset origin as hosted fallback', () => {
    expect(tcgdexReferenceUrl('https://assets.tcgdex.net/de/sv/sv03.5/001')).toBe('https://assets.tcgdex.net/de/sv/sv03.5/001/high.webp');
    expect(tcgdexReferenceUrl('https://example.com/de/sv/sv03.5/001')).toBeNull();
    expect(tcgdexReferenceUrl('https://assets.tcgdex.net/en/sv/sv03.5/001')).toBeNull();
  });

  it('sanitizes polluted legacy master-index variants while preserving every supported variant', async () => {
    const root = await temporaryRoot();
    const indexPath = path.join(root, 'master-index.json');
    await writeFile(indexPath, JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-09-07T00:00:00.000Z',
      stats: {},
      cards: [{ id: 'test-001', variants: ['normal', 'Fire', 'holo', 'Ability', 'reverse', 'Metal', 'metal', 'lenticular'] }],
    }));
    vi.stubEnv('DOMIDEX_SCANNER_MASTER_INDEX_PATH', indexPath);

    const index = await loadScannerIndex();

    expect(index?.cards[0].variants).toEqual(['normal', 'holo', 'reverse', 'metal', 'lenticular']);
  });

  it('does not extract weakness types when variants are absent and keeps only supported source variants', async () => {
    const root = await temporaryRoot();
    const referenceDir = path.join(root, 'references');
    const databaseDir = path.join(root, 'database');
    const cardDir = path.join(databaseDir, 'data', 'Test Series', 'Test Set');
    const outputPath = path.join(root, 'master-index.json');
    await Promise.all([mkdir(referenceDir, { recursive: true }), mkdir(cardDir, { recursive: true })]);
    await writeFile(path.join(databaseDir, 'data', 'Test Series.ts'), 'export default { name: { de: "Testserie" } };');
    await writeFile(path.join(databaseDir, 'data', 'Test Series', 'Test Set.ts'), 'export default { id: "test", name: { de: "Testset" } };');
    await writeFile(path.join(cardDir, '001.ts'), 'export default { name: { de: "Ohne Variante" }, weaknesses: [{ type: "Fire", value: "×2" }] };');
    await writeFile(path.join(cardDir, '002.ts'), `export default {
      name: { de: "Mit Varianten" },
      weaknesses: [{ type: "Metal", value: "×2" }],
      variants: [
        { type: "normal" }, { type: "holo" }, { type: "reverse" }, { type: "metal" }, { type: "lenticular" },
        { type: "Ability" }
      ]
    };`);
    await Promise.all([
      writeFile(path.join(referenceDir, 'test-001.webp'), new Uint8Array()),
      writeFile(path.join(referenceDir, 'test-002.webp'), new Uint8Array()),
      writeFile(path.join(referenceDir, 'scanner-index.json'), JSON.stringify([
        { id: 'test-001', localId: '001', name: 'Ohne Variante', file: 'test-001.webp', image: 'https://assets.tcgdex.net/de/test/test/001' },
        { id: 'test-002', localId: '002', name: 'Mit Varianten', file: 'test-002.webp', image: 'https://assets.tcgdex.net/de/test/test/002' },
      ])),
    ]);

    await execFileAsync(process.execPath, [path.resolve('scripts/build-scanner-reference-index.mjs')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DOMIDEX_SCANNER_REFERENCE_DIR: referenceDir,
        DOMIDEX_TCGDEX_DB_PATH: databaseDir,
        DOMIDEX_SCANNER_MASTER_INDEX_PATH: outputPath,
      },
    });
    const generated = JSON.parse(await readFile(outputPath, 'utf8')) as { cards: Array<{ id: string; variants: string[] }> };

    expect(generated.cards.find((card) => card.id === 'test-001')?.variants).toEqual([]);
    expect(generated.cards.find((card) => card.id === 'test-002')?.variants).toEqual(['normal', 'holo', 'reverse', 'metal', 'lenticular']);
  });
});
