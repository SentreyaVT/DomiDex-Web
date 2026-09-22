/** Bound bytes while streaming, including chunked bodies without Content-Length. */
export async function boundedJson(request: Request, maximumBytes = 8192): Promise<Record<string, unknown>> {
  const reject = (code: string, status: number): never => { throw Object.assign(new Error(code), { status }); };
  if (Number(request.headers.get('content-length') || 0) > maximumBytes) reject('REQUEST_TOO_LARGE', 413);
  if (!request.body) reject('INVALID_REQUEST', 400);
  const reader = request.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximumBytes) {
        try { await reader.cancel(); } catch { /* Cancellation must not replace the size rejection. */ }
        reject('REQUEST_TOO_LARGE', 413);
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { reject('INVALID_REQUEST', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('INVALID_REQUEST', 400);
  return value as Record<string, unknown>;
}
