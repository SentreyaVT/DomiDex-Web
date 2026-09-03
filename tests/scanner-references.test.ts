import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRemoteReferenceImage, tcgdexReferenceUrl } from '@/lib/server/scanner-references';

describe('Firebase scanner reference archive', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
});
