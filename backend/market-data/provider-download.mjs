import { request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import { PROVIDER_LIMITS, normalizeProviderSnapshot } from './ingestion.mjs';

/** Trusted server ingestion only. No storage, credentials, publication, timer or
 * network at import time. Exactly the same public feeds as Android; no caller URL,
 * redirects, compressed transfer, proxy agent, retries or uploaded price truth.
 * A deadline destroys the actual request/response, not only a racing Promise.
 * Byte ceilings apply to the body; they are NOT a bound on JSON-normalization heap.
 */
export const PROVIDER_URLS = Object.freeze({
  products: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json',
  prices: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json',
});
export const DOWNLOAD_POLICY = Object.freeze({ deadlineMs: 120_000, idleMs: 15_000, headerBytes: 16_384 });
const failure = (code) => new Error(`MARKET_DOWNLOAD_${code}`);

function budget(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some((key) => !['maxBytes', 'deadlineMs', 'idleMs', 'request', 'signal'].includes(key))) {
    throw failure('OPTIONS');
  }
  const maxBytes = options.maxBytes ?? PROVIDER_LIMITS.fileBytes;
  const deadlineMs = options.deadlineMs ?? DOWNLOAD_POLICY.deadlineMs;
  const idleMs = options.idleMs ?? DOWNLOAD_POLICY.idleMs;
  for (const [value, maximum] of [[maxBytes, PROVIDER_LIMITS.fileBytes],
    [deadlineMs, DOWNLOAD_POLICY.deadlineMs], [idleMs, DOWNLOAD_POLICY.idleMs]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw failure('OPTIONS');
  }
  // request is a local test seam, not a configurable endpoint or public API.
  const request = options.request ?? httpsRequest;
  if (typeof request !== 'function' || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) {
    throw failure('OPTIONS');
  }
  return { maxBytes, deadlineMs, idleMs, request, signal: options.signal };
}

export function downloadProviderFile(kind, options = {}) {
  if (typeof kind !== 'string' || !Object.hasOwn(PROVIDER_URLS, kind)) return Promise.reject(failure('KIND'));
  const url = PROVIDER_URLS[kind];
  let limits;
  try { limits = budget(options); } catch (error) { return Promise.reject(error); }
  const { maxBytes, deadlineMs, idleMs, request, signal } = limits;
  if (signal?.aborted) return Promise.reject(failure('ABORTED'));
  return new Promise((resolve, reject) => {
    let req, response, settled = false, total = 0;
    const chunks = [];
    const hash = createHash('sha256');
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) {
        chunks.length = 0;
        // Listeners remain installed to observe late socket/destroy errors.
        response?.destroy();
        req?.destroy();
        reject(error);
      } else {
        const bytes = Buffer.concat(chunks, total);
        chunks.length = 0;
        resolve({ bytes, receipt: Object.freeze({ kind, url,
          bytes: total, sha256: hash.digest('hex') }) });
      }
    };
    const abort = () => finish(failure('ABORTED'));
    const timer = setTimeout(() => finish(failure('DEADLINE')), deadlineMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try {
      req = request(url, {
        method: 'GET', agent: false, rejectUnauthorized: true,
        maxHeaderSize: DOWNLOAD_POLICY.headerBytes,
        headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
      });
      req.on('error', () => finish(failure('REQUEST')));
      req.on('response', (incoming) => {
        if (settled) { incoming.destroy(); return; }
        if (response) { incoming.destroy(); finish(failure('REPEATED_RESPONSE')); return; }
        response = incoming;
        response.on('error', () => finish(failure('RESPONSE')));
        response.on('aborted', () => finish(failure('INCOMPLETE')));
        response.on('close', () => { if (!settled) finish(failure('INCOMPLETE')); });
        const encoding = incoming.headers['content-encoding'];
        const contentType = incoming.headers['content-type'];
        const length = incoming.headers['content-length'];
        if (incoming.statusCode !== 200) { finish(failure('STATUS')); return; }
        if (encoding !== undefined && encoding !== 'identity') { finish(failure('ENCODING')); return; }
        if (typeof contentType !== 'string' || !/^(application\/json|application\/octet-stream)(?:\s*;[^\r\n]*)?$/i.test(contentType)) {
          finish(failure('CONTENT_TYPE')); return;
        }
        if (length !== undefined && (typeof length !== 'string' || !/^[1-9][0-9]{0,8}$/.test(length) || Number(length) > maxBytes)) {
          finish(failure('LENGTH')); return;
        }
        response.on('data', (chunk) => {
          if (settled) return;
          if (!(chunk instanceof Uint8Array) || chunk.byteLength > maxBytes - total) { finish(failure('BODY_LIMIT')); return; }
          if (chunk.byteLength === 0) return;
          const owned = Buffer.from(chunk);
          total += owned.byteLength;
          chunks.push(owned);
          hash.update(owned);
        });
        response.on('end', () => {
          if (total === 0 || !incoming.complete || (length !== undefined && total !== Number(length))) {
            finish(failure('INCOMPLETE'));
          } else finish();
        });
      });
      req.setTimeout(idleMs, () => finish(failure('IDLE')));
      if (settled) req.destroy();
      else req.end();
    } catch { finish(failure('REQUEST')); }
  });
}

/** Sequential downloads limit concurrent bodies to one. Neither a first-feed
 * success nor a partial pair can be published here. Normalization requires both
 * complete validated feeds and keeps their ORIGINAL source timestamps. No
 * transport receipt is a trusted clock for destructive Android maintenance.
 */
export async function downloadProviderSnapshot(options = {}) {
  const products = await downloadProviderFile('products', options);
  const prices = await downloadProviderFile('prices', options);
  if (options.signal?.aborted) throw failure('ABORTED');
  const result = normalizeProviderSnapshot(products.bytes, prices.bytes);
  return { ...result, downloads: Object.freeze([products.receipt, prices.receipt]) };
}
