// Per DE/EN single-card response, after Fetch content decoding. This is not a
// provider SLA, total heap/download limit, or a process-wide concurrency limit.
const MAX_CARD_RESPONSE_BYTES = 1024 * 1024;

function cancelWithoutWaiting(bodyOrReader) {
  try {
    // A provider's underlying cancel hook can itself stall or reject. Releasing
    // our request must never wait for it, and its rejection must be observed.
    Promise.resolve(bodyOrReader?.cancel()).catch(() => {});
  } catch { /* Best-effort disposal must not replace the original failure. */ }
}

/** Scoped counterpart to Response.json(); private request JSON is unchanged. */
export async function readPublicCatalogResponse(response, signal) {
  if (signal.aborted || !response.ok || Number(response.headers.get('content-length') || 0) > MAX_CARD_RESPONSE_BYTES) {
    cancelWithoutWaiting(response.body);
    throw Error('PUBLIC_CATALOG_RESPONSE_UNAVAILABLE');
  }
  if (!response.body) throw Error('PUBLIC_CATALOG_RESPONSE_UNAVAILABLE');
  const reader = response.body.getReader();
  let cancelled = false, rejectAbort;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    cancelWithoutWaiting(reader);
  };
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  // Covers an already-aborted signal before Promise.race attaches its handlers.
  aborted.catch(() => {});
  const abort = () => { cancel(); rejectAbort(Error('PUBLIC_CATALOG_RESPONSE_ABORTED')); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    const reading = (async () => {
      const chunks = [];
      let size = 0;
      for (;;) {
        if (signal.aborted) throw Error('PUBLIC_CATALOG_RESPONSE_ABORTED');
        const result = await reader.read();
        if (signal.aborted) throw Error('PUBLIC_CATALOG_RESPONSE_ABORTED');
        if (result.done) break;
        if (!(result.value instanceof Uint8Array)) throw Error('PUBLIC_CATALOG_RESPONSE_INVALID');
        size += result.value.byteLength;
        if (size > MAX_CARD_RESPONSE_BYTES) throw Error('PUBLIC_CATALOG_RESPONSE_TOO_LARGE');
        chunks.push(result.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    })();
    // Abort also settles a stalled read. Both branches are observed, so a late
    // read rejection after cancellation cannot become an unhandled rejection.
    const bytes = await Promise.race([reading, aborted]);
    if (signal.aborted) throw Error('PUBLIC_CATALOG_RESPONSE_ABORTED');
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    try { reader.releaseLock(); } catch { /* Preserve the original parse/read/abort result. */ }
  }
}
