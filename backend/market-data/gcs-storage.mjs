import { createHash } from 'node:crypto';
import { LIMITS } from './contract.mjs';
import { STORE_POLICY } from './snapshot-store.mjs';
import { ADMISSION_POLICY } from './admission-budget.mjs';

/** Adapter for an explicitly INJECTED @google-cloud/storage Bucket (SDK 7.22.0).
 * This module creates no Storage/Firebase client, reads no credentials and does
 * no IO at import/factory time. The caller must supply a dedicated retry-disabled
 * client: autoRetry=false and a positive Storage.timeout <=30s are checked,
 * never configured or toggled here. This SDK timeout is PER HTTP REQUEST, not
 * a total operation/auth deadline: project/credential lookup and authorization
 * happen before it. No Promise.race hides a potentially late pointer write.
 * No list/delete/GC API. The separate publisher admission imposes a finite
 * reservation cap, not a continuous lifecycle. IAM, deployment and historical
 * retention/restore remain open. Payload buffering is bounded; SDK
 * metadata/error-response internals are not a process-wide memory guarantee.
 */
export const GCS_POLICY = Object.freeze({ readStreamTimeoutMs: 30_000, writeTimeoutMs: 30_000 });
const error = (code) => new Error(`MARKET_GCS_${code}`);
const fail = (code) => { throw error(code); };

function pathPolicy(path) {
  if (path === STORE_POLICY.pointerPath) return { pointer: true, limit: STORE_POLICY.pointerBytes };
  // Like the current pointer, admission is CAS-only; never an immutable create.
  if (path === ADMISSION_POLICY.path) return { pointer: true, limit: ADMISSION_POLICY.controlBytes };
  if (typeof path !== 'string') fail('PATH');
  const match = /^public-market-data\/schema-1\/generations\/[a-f0-9]{64}\/(manifest\.json|pages\/(0|[1-9][0-9]{0,2})\.json)$/.exec(path);
  if (!match || match[0] !== path || (match[2] !== undefined && Number(match[2]) >= STORE_POLICY.maxPages)) fail('PATH');
  return { pointer: false, limit: match[1] === 'manifest.json' ? LIMITS.manifestBytes : LIMITS.pageBytes };
}

function requireClientPolicy(bucket) {
  if (!bucket || typeof bucket.file !== 'function' || bucket.storage?.retryOptions?.autoRetry !== false) fail('RETRY_POLICY');
  // SDK save() bails immediately when autoRetry=false. Do not demand maxRetries=0:
  // this SDK's constructor treats that falsy option as its default retry count.
  // Service.request_ overwrites per-call timeout with Storage.timeout, including
  // undefined. A save({timeout:30000}) alone therefore does NOT bound its request.
  const timeout = bucket.storage.timeout;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > GCS_POLICY.writeTimeoutMs) fail('TIMEOUT_POLICY');
}

function safeGeneration(value) {
  // SDK File({generation:string}) internally converts to Number. Reject rather
  // than round an opaque GCS version outside the SDK's exact integer range.
  if (typeof value !== 'string' || value.length > 16 || !/^[1-9][0-9]*$/.test(value)) fail('GENERATION');
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || String(numeric) !== value) fail('GENERATION');
  return numeric;
}

function boundedSize(value, limit) {
  if (typeof value !== 'string' || value.length > 6 || !/^[1-9][0-9]*$/.test(value)) fail('SIZE');
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size > limit || String(size) !== value) fail('SIZE');
  return size;
}

function ownedBytes(value, limit) {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > limit) fail('BODY_LIMIT');
  return Buffer.from(value);
}

function noEncoding(value) { return value === undefined || value === 'identity'; }

function collectStream(stream, { version, size, maxBytes, crc32c }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let responseSeen = false;
    let settled = false;
    const finish = (failure, bytes) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failure) {
        // Keep the error listener until close: SDK pipeline destruction can emit
        // a later error. Never buffer an over-budget chunk or an HTTP error body.
        chunks.length = 0;
        stream.destroy();
        reject(failure);
      } else resolve(bytes);
    };
    const timer = setTimeout(() => finish(error('READ_TIMEOUT')), GCS_POLICY.readStreamTimeoutMs);
    stream.on('error', () => finish(error('READ_STREAM')));
    stream.on('response', (response) => {
      if (settled) return;
      const headers = response?.headers;
      if (responseSeen || response?.statusCode !== 200 || !headers ||
          headers['x-goog-generation'] !== version || headers['content-length'] !== String(size) ||
          !noEncoding(headers['content-encoding']) || headers['x-goog-stored-content-encoding'] !== 'identity' ||
          (headers['x-goog-stored-content-length'] !== undefined && headers['x-goog-stored-content-length'] !== String(size)) ||
          typeof headers['x-goog-hash'] !== 'string' ||
          headers['x-goog-hash'].split(',').map((part) => part.trim()).filter((part) => part.startsWith('crc32c=')).join(',') !== `crc32c=${crc32c}`) {
        finish(error('READ_RESPONSE'));
        return;
      }
      responseSeen = true;
    });
    stream.on('data', (chunk) => {
      if (settled) return;
      if (!responseSeen || !(chunk instanceof Uint8Array)) { finish(error('READ_RESPONSE')); return; }
      if (chunk.byteLength > maxBytes - total || chunk.byteLength > size - total) { finish(error('BODY_LIMIT')); return; }
      if (chunk.byteLength === 0) return;
      total += chunk.byteLength;
      chunks.push(Buffer.from(chunk));
    });
    stream.on('end', () => {
      if (settled) return;
      if (!responseSeen || total !== size) finish(error('READ_INCOMPLETE'));
      else finish(null, Buffer.concat(chunks, total));
    });
    stream.on('close', () => { if (!settled) finish(error('READ_INCOMPLETE')); });
  });
}

/** @param {import('@google-cloud/storage').Bucket} bucket */
export function createGcsStorage(bucket) {
  requireClientPolicy(bucket);

  async function read(path, options) {
    const { limit } = pathPolicy(path);
    const maxBytes = options?.maxBytes;
    if (!options || Object.keys(options).length !== 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > limit) fail('READ_LIMIT');
    requireClientPolicy(bucket);
    let metadata;
    try { [metadata] = await bucket.file(path).getMetadata(); }
    catch (cause) { if (cause?.code === 404) return null; throw error('METADATA_READ'); }
    if (!metadata || metadata.name !== path || !noEncoding(metadata.contentEncoding) ||
        typeof metadata.crc32c !== 'string' || !/^[A-Za-z0-9+/]{6}==$/.test(metadata.crc32c) ||
        Buffer.from(metadata.crc32c, 'base64').toString('base64') !== metadata.crc32c) fail('METADATA');
    const version = metadata.generation;
    const generation = safeGeneration(version);
    const size = boundedSize(metadata.size, maxBytes);
    requireClientPolicy(bucket);
    // Pin the exact generation whose size/checksum were inspected. An overwrite
    // now yields the old pinned bytes (if retained) or an error, never new bytes
    // falsely labelled with the old version. A media 404 is NOT missing-current.
    const stream = bucket.file(path, { generation }).createReadStream({ decompress: false, validation: 'crc32c' });
    const bytes = await collectStream(stream, { version, size, maxBytes, crc32c: metadata.crc32c });
    return { bytes, version };
  }

  async function save(path, bytes, expected) {
    requireClientPolicy(bucket);
    // SDK client-side upload validation may call File.delete() on mismatch
    // (7.22.0 file.js _File_validateIntegrity). Disable that destructive path;
    // the supplied MD5 is checked by GCS BEFORE storing a single-request upload.
    // https://docs.cloud.google.com/storage/docs/data-validation#server-side-validation-for-data-writes
    // https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert
    // This transport checksum is not authenticity; snapshot-store still verifies
    // exact stored bytes and its SHA256 generation/page bindings before activation.
    try {
      await bucket.file(path).save(bytes, {
        resumable: false, gzip: false, validation: false, timeout: GCS_POLICY.writeTimeoutMs,
        preconditionOpts: { ifGenerationMatch: expected },
        metadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store',
          md5Hash: createHash('md5').update(bytes).digest('base64') },
      });
      return true;
    } catch (cause) {
      // Only an actual numeric SDK HTTP 412 is a known precondition rejection.
      // Timeouts, checksum errors, auth failures, lost responses etc. throw;
      // pointer callers must classify their activation outcome as UNKNOWN.
      if (cause?.code === 412) return false;
      throw error('WRITE_OUTCOME_UNKNOWN');
    }
  }

  return Object.freeze({
    read,
    async createIfAbsent(path, value) {
      const policy = pathPolicy(path);
      if (policy.pointer) fail('WRITE_PATH');
      return save(path, ownedBytes(value, policy.limit), 0);
    },
    async compareAndSwap(path, expectedVersion, value) {
      const policy = pathPolicy(path);
      if (!policy.pointer) fail('WRITE_PATH');
      if (expectedVersion !== null) safeGeneration(expectedVersion);
      return save(path, ownedBytes(value, policy.limit), expectedVersion ?? 0);
    },
  });
}
