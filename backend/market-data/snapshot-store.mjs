import { createHash } from 'node:crypto';
import { LIMITS, encodeBoundedJson, parseBoundedJson, validateManifest, validatePage,
  validateSnapshot, validateSourceTimestamp } from './contract.mjs';

/** Trusted publisher/read orchestration, NOT a provider authentication boundary.
 * Never expose publishSnapshot as a client-upload/public-truth API.
 *
 * Injected adapter contract (no implementation or network clients here):
 *   read(path, { maxBytes }) -> null | { bytes: Uint8Array, version: string }
 *   createIfAbsent(path, bytes) -> boolean (true=created, false=already exists)
 *   compareAndSwap(path, expectedVersion|null, bytes) -> boolean
 * Reads MUST enforce maxBytes before buffering the response. Create and CAS MUST
 * be atomic; read versions MUST identify the bytes read and never be reused (ABA).
 * A resolved false CAS means not applied; a rejected CAS has an UNKNOWN outcome.
 * Immutable generation objects must not subsequently be overwritten or deleted.
 * The functions additionally check returned bytes and all content-address bindings.
 *
 * This low-level primitive does not itself enforce admission. Trusted production
 * integration must use publishAdmittedSnapshot from publisher.mjs, never this
 * function directly. No deletes, GC, continuous lifecycle, or history restore.
 * Those operational requirements remain open before production use. Partial
 * immutable writes are deliberately retained, not rolled back across publishers.
 */
export const STORE_POLICY = Object.freeze({
  namespace: 'public-market-data/schema-1',
  pointerPath: 'public-market-data/schema-1/current.json',
  pointerBytes: 512,
  parallelOperations: 4,
  maxPages: Math.ceil(LIMITS.snapshotItems / LIMITS.pageItems),
});
const fail = (code) => { throw new Error(`MARKET_SNAPSHOT_${code}`); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function checkedGeneration(value) {
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) fail('GENERATION');
  return value;
}

function checkedIndex(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= STORE_POLICY.maxPages || Object.is(value, -0)) fail('PAGE_INDEX');
  return value;
}

function generationRoot(generation) {
  return `${STORE_POLICY.namespace}/generations/${checkedGeneration(generation)}`;
}
function manifestPath(generation) { return `${generationRoot(generation)}/manifest.json`; }
function pagePath(generation, index) { return `${generationRoot(generation)}/pages/${checkedIndex(index)}.json`; }

function requireAdapter(storage, publishing = false) {
  if (!storage || typeof storage.read !== 'function' || (publishing &&
      (typeof storage.createIfAbsent !== 'function' || typeof storage.compareAndSwap !== 'function'))) fail('ADAPTER');
}

async function readBytes(storage, path, maximum, required = true) {
  let result;
  try { result = await storage.read(path, { maxBytes: maximum }); }
  catch { fail('STORAGE_READ'); }
  if (result === null) {
    if (required) fail('MISSING_OBJECT');
    return null;
  }
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      Reflect.ownKeys(result).length !== 2 || !Object.hasOwn(result, 'bytes') || !Object.hasOwn(result, 'version') ||
      !(result.bytes instanceof Uint8Array) || result.bytes.byteLength < 1 || result.bytes.byteLength > maximum ||
      typeof result.version !== 'string' || result.version.length < 1 || result.version.length > 256 ||
      /[^\x21-\x7e]/.test(result.version)) fail('STORAGE_RESPONSE');
  return { bytes: Buffer.from(result.bytes), version: result.version };
}

function pointerFromBytes(bytes) {
  const pointer = parseBoundedJson(bytes, STORE_POLICY.pointerBytes);
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer) ||
      Object.keys(pointer).length !== 3 || pointer.schema !== 1 ||
      !Object.hasOwn(pointer, 'generation') || !Object.hasOwn(pointer, 'manifestSha256')) fail('POINTER');
  checkedGeneration(pointer.generation);
  checkedGeneration(pointer.manifestSha256);
  return pointer;
}

async function readPointer(storage) {
  const result = await readBytes(storage, STORE_POLICY.pointerPath, STORE_POLICY.pointerBytes, false);
  return result === null ? null : { ...result, pointer: pointerFromBytes(result.bytes) };
}

async function samePointer(storage, before) {
  const after = await readPointer(storage);
  if (!after || after.version !== before.version || !after.bytes.equals(before.bytes)) fail('CURRENT_CHANGED');
}

async function storedManifest(storage, generation, expectedHash) {
  const stored = await readBytes(storage, manifestPath(generation), LIMITS.manifestBytes);
  if (expectedHash !== undefined && sha256(stored.bytes) !== expectedHash) fail('MANIFEST_DIGEST');
  const manifest = validateManifest(parseBoundedJson(stored.bytes, LIMITS.manifestBytes));
  if (manifest.generation !== generation) fail('MANIFEST_GENERATION');
  return manifest;
}

/** All started operations settle before return/rejection; a failed worker stops
 * new work, without abandoning other in-flight writes or their verification. */
async function boundedMap(items, operation) {
  const results = Array(items.length);
  let next = 0;
  let failure;
  const worker = async () => {
    while (failure === undefined && next < items.length) {
      const index = next++;
      try { results[index] = await operation(items[index], index); }
      catch (error) { failure ??= error instanceof Error ? error : new Error('MARKET_SNAPSHOT_STORAGE_FAILURE'); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(STORE_POLICY.parallelOperations, items.length) }, worker));
  if (failure !== undefined) throw failure;
  return results;
}

async function storedSnapshot(storage, generation, manifestHash) {
  const manifest = await storedManifest(storage, generation, manifestHash);
  const pages = await boundedMap(manifest.pages, async ({ index }) => {
    const result = await readBytes(storage, pagePath(generation, index), LIMITS.pageBytes);
    return parseBoundedJson(result.bytes);
  });
  return validateSnapshot(manifest, pages);
}

/** Pointer -> manifest -> pointer fence; never loads all pages for this endpoint.
 * The result proves this manifest binding, not contemporaneous page availability. */
export async function readCurrentManifest(storage) {
  requireAdapter(storage);
  const before = await readPointer(storage);
  if (before === null) return null;
  const manifest = await storedManifest(storage, before.pointer.generation, before.pointer.manifestSha256);
  await samePointer(storage, before);
  return manifest;
}

/** Pinned immutable generation, independent of whichever generation is current.
 * At most its manifest + requested page are read; no URL/path is supplied by a client. */
export async function readSnapshotPage(storage, generation, index) {
  requireAdapter(storage);
  checkedGeneration(generation);
  checkedIndex(index);
  const manifest = await storedManifest(storage, generation);
  if (index >= manifest.pages.length) fail('PAGE_INDEX');
  const result = await readBytes(storage, pagePath(generation, index), LIMITS.pageBytes);
  const page = validatePage(parseBoundedJson(result.bytes), manifest);
  if (page.index !== index) fail('PAGE_INDEX');
  return page;
}

/** Full verified read for publishing/diagnostics, not the normal per-page endpoint. */
export async function readCurrentSnapshot(storage) {
  requireAdapter(storage);
  const before = await readPointer(storage);
  if (before === null) return null;
  const snapshot = await storedSnapshot(storage, before.pointer.generation, before.pointer.manifestSha256);
  await samePointer(storage, before);
  return snapshot;
}

async function createVerified(storage, path, bytes, maximum) {
  let created;
  try { created = await storage.createIfAbsent(path, Buffer.from(bytes)); }
  catch { fail('STORAGE_WRITE'); }
  if (typeof created !== 'boolean') fail('STORAGE_RESPONSE');
  // Also verify an existing same-generation object; idempotence never authorizes
  // an overwrite, repairs a collision, or trusts createIfAbsent's return alone.
  const actual = await readBytes(storage, path, maximum);
  if (!actual.bytes.equals(bytes)) fail('IMMUTABLE_COLLISION');
}

// Compare validated Gregorian timestamps as exact nanoseconds from a common
// origin. Only bounded calendar components use Number; no Date/string coercion
// or millisecond truncation, and original provider timestamp strings stay intact.
function timestampNanos(value) {
  validateSourceTimestamp(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(value);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const previousYear = year - 1;
  let days = previousYear * 365 + Math.floor(previousYear / 4) - Math.floor(previousYear / 100) + Math.floor(previousYear / 400);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const months = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let index = 0; index < month - 1; index++) days += months[index];
  days += day - 1;
  const offset = match[8] === 'Z' ? 0 : (match[9] === '+' ? 1 : -1) * (Number(match[10]) * 3600 + Number(match[11]) * 60);
  const seconds = days * 86400 + hour * 3600 + minute * 60 + second - offset;
  return BigInt(seconds) * 1_000_000_000n + BigInt((match[7] ?? '').padEnd(9, '0'));
}

function requireNondecreasingSources(next, active) {
  if (timestampNanos(next.sourceTimestamp) < timestampNanos(active.sourceTimestamp)) fail('PRICE_TIME_REGRESSION');
  if (timestampNanos(next.catalogSourceTimestamp) < timestampNanos(active.catalogSourceTimestamp)) fail('CATALOG_TIME_REGRESSION');
}

/** Complete in-memory validation/serialization precedes even the pointer read.
 * max4 page writes; manifest only after all page writes have settled/verified.
 * Both source times must independently be >= the verified active generation;
 * equal instants may carry a legitimate corrected generation. CAS protects this
 * check from concurrent activation, without mixing old and new source content.
 * CAS is the sole activation operation. No pointer rollback or blind CAS retry.
 * ACTIVATED acknowledges that CAS point, not a promise against later publishers.
 * Optional admission is an INTERNAL hook, not a client-provided policy. It sees
 * an owned frozen budget of the exact final immutable wire bytes, after all early
 * checks and immediately before uploads. Any rejection prevents all uploads.
 */
export async function publishSnapshot(storage, input, { admitGeneration } = {}) {
  requireAdapter(storage, true);
  if (admitGeneration !== undefined && typeof admitGeneration !== 'function') fail('ADMISSION_HOOK');
  const checked = validateSnapshot(input?.manifest, input?.pages);
  const manifestBytes = encodeBoundedJson(checked.manifest, LIMITS.manifestBytes);
  const pages = checked.pages.map((page) => ({ index: page.index, bytes: encodeBoundedJson(page) }));
  const generation = checked.manifest.generation;
  const admission = Object.freeze({ generation,
    wireBytes: pages.reduce((total, page) => total + page.bytes.length, manifestBytes.length) });
  const pointer = { schema: 1, generation, manifestSha256: sha256(manifestBytes) };
  const pointerBytes = encodeBoundedJson(pointer, STORE_POLICY.pointerBytes);
  const before = await readPointer(storage);

  if (before?.pointer.generation === generation) {
    if (!before.bytes.equals(pointerBytes)) fail('POINTER_CONFLICT');
    await storedSnapshot(storage, generation, pointer.manifestSha256);
    await samePointer(storage, before);
    return { status: 'ALREADY_ACTIVE', generation };
  }

  if (before !== null) {
    const active = await storedManifest(storage, before.pointer.generation, before.pointer.manifestSha256);
    requireNondecreasingSources(checked.manifest, active);
  }

  if (admitGeneration !== undefined) await admitGeneration(admission);
  await boundedMap(pages, ({ index, bytes }) => createVerified(storage, pagePath(generation, index), bytes, LIMITS.pageBytes));
  await createVerified(storage, manifestPath(generation), manifestBytes, LIMITS.manifestBytes);
  // Verify the complete stored generation, not just independently successful writes.
  await storedSnapshot(storage, generation, pointer.manifestSha256);

  let applied;
  try { applied = await storage.compareAndSwap(STORE_POLICY.pointerPath, before?.version ?? null, Buffer.from(pointerBytes)); }
  catch { fail('ACTIVATION_OUTCOME_UNKNOWN'); }
  if (typeof applied !== 'boolean') fail('ACTIVATION_OUTCOME_UNKNOWN');
  if (applied) return { status: 'ACTIVATED', generation };

  // A concurrent publisher of precisely this generation may have won. Never
  // retry CAS; otherwise report the conflict without reverting the newer pointer.
  const concurrent = await readPointer(storage);
  if (concurrent?.bytes.equals(pointerBytes)) {
    await samePointer(storage, concurrent);
    return { status: 'ALREADY_ACTIVE', generation };
  }
  fail('CAS_CONFLICT');
}
