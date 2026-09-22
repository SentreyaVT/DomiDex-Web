import { describe, expect, it, vi } from 'vitest';
import { boundedJson } from '@/lib/bounded-json';

describe('bounded JSON request reader', () => {
  it('parses a normal object without content-length', async () => {
    expect(await boundedJson(new Request('https://test.invalid', { method: 'POST', body: '{"confirm":true}' }))).toEqual({ confirm: true });
  });
  it('rejects a declared oversized body without consuming it', async () => {
    const request = new Request('https://test.invalid', { method: 'POST', headers: { 'Content-Length': '9000' }, body: '{}' });
    await expect(boundedJson(request)).rejects.toMatchObject({ message: 'REQUEST_TOO_LARGE', status: 413 });
    expect(request.bodyUsed).toBe(false);
  });
  it('cancels a chunked oversized stream rather than accumulating it', async () => {
    const cancel = vi.fn(); let count = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { count++; controller.enqueue(new Uint8Array(1024)); }, cancel });
    const request = new Request('https://test.invalid', { method: 'POST', body, duplex: 'half' } as RequestInit);
    await expect(boundedJson(request, 2048)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce(); expect(count).toBeLessThanOrEqual(4);
  });
  it.each(['[]', 'null', '{broken', '"string"'])('rejects non-object or malformed JSON: %s', async (body) => {
    await expect(boundedJson(new Request('https://test.invalid', { method: 'POST', body }))).rejects.toMatchObject({ status: 400 });
  });
});
