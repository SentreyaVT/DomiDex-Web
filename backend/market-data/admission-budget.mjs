import { encodeBoundedJson, parseBoundedJson } from './contract.mjs';

/** Trusted publisher admission only; not a public/client upload endpoint.
 * This independent control object MUST be reserved before any snapshot upload.
 * Integration with snapshot-store/GCS is deliberately not included here.
 *
 * Injected storage: read(path,{maxBytes}) -> null|{bytes:Uint8Array,version:string},
 * compareAndSwap(path,expectedVersion|null,bytes) -> boolean. Reads must enforce
 * the limit before buffering. CAS must be atomic; versions are opaque, identify
 * the bytes read, and must never be reused. No out-of-band delete/reset/edit of
 * this control object is permitted. A rejected CAS has an UNKNOWN outcome.
 *
 * No release, GC, deletion, lease or expiry exists. Partial/orphan/UNKNOWN work
 * remains charged. A timeout or missing object never authorizes releasing it.
 * The finite cap will eventually stop publication: this is NOT a continuous
 * production lifecycle solution and provides no historical restore guarantee.
 */
export const ADMISSION_POLICY = Object.freeze({
  path: 'public-market-data/schema-1/admission.json',
  controlBytes: 4096,
  maxGenerations: 4,
  maxReservedWireBytes: 1024 ** 3,
});
const fail = (code) => { throw new Error(`MARKET_ADMISSION_${code}`); };

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== keys.length) fail('FIELDS');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('FIELDS');
  }
}

function reservation(value) {
  exactObject(value, ['generation', 'wireBytes', 'attemptToken']);
  if (typeof value.generation !== 'string' || value.generation.length !== 64 || !/^[a-f0-9]{64}$/.test(value.generation)) fail('GENERATION');
  if (typeof value.attemptToken !== 'string' || value.attemptToken.length !== 32 || !/^[a-f0-9]{32}$/.test(value.attemptToken)) fail('ATTEMPT_TOKEN');
  if (!Number.isSafeInteger(value.wireBytes) || value.wireBytes < 1 || value.wireBytes > ADMISSION_POLICY.maxReservedWireBytes) fail('WIRE_BYTES');
  return { generation: value.generation, wireBytes: value.wireBytes, attemptToken: value.attemptToken };
}

/** Persisted state is nonempty: the FIRST reservation creates it with CAS(null).
 * A previously empty/reset state is not treated as a fresh usable budget.
 * Ordered entries eliminate aliases, duplicates, extra counters and sparse data.
 */
export function validateAdmissionState(value) {
  exactObject(value, ['schema', 'reservations']);
  if (value.schema !== 1) fail('SCHEMA');
  const input = value.reservations;
  if (!Array.isArray(input) || input.length < 1 || input.length > ADMISSION_POLICY.maxGenerations ||
      Reflect.ownKeys(input).length !== input.length + 1) fail('RESERVATIONS');
  let total = 0;
  let previous = '';
  const tokens = new Set();
  const reservations = [];
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('RESERVATIONS');
    const entry = reservation(descriptor.value);
    if (entry.generation <= previous) fail('GENERATION_ORDER');
    if (tokens.has(entry.attemptToken)) fail('DUPLICATE_ATTEMPT_TOKEN');
    if (entry.wireBytes > ADMISSION_POLICY.maxReservedWireBytes - total) fail('BYTE_BUDGET');
    total += entry.wireBytes;
    previous = entry.generation;
    tokens.add(entry.attemptToken);
    reservations.push(entry);
  }
  const state = { schema: 1, reservations };
  encodeBoundedJson(state, ADMISSION_POLICY.controlBytes);
  return state;
}

function same(left, right) {
  return left.generation === right.generation && left.wireBytes === right.wireBytes && left.attemptToken === right.attemptToken;
}

async function readControl(storage) {
  let value;
  try { value = await storage.read(ADMISSION_POLICY.path, { maxBytes: ADMISSION_POLICY.controlBytes }); }
  catch { fail('CONTROL_READ'); }
  if (value === null) return null;
  exactObject(value, ['bytes', 'version']);
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength < 1 || value.bytes.byteLength > ADMISSION_POLICY.controlBytes) fail('CONTROL_BYTES');
  if (typeof value.version !== 'string' || value.version.length < 1 || value.version.length > 256 || /[^\x21-\x7e]/.test(value.version)) fail('CONTROL_VERSION');
  const bytes = Buffer.from(value.bytes);
  return { state: validateAdmissionState(parseBoundedJson(bytes, ADMISSION_POLICY.controlBytes)), version: value.version };
}

function result(status, entry, state) {
  return { status, ...entry, reservedGenerations: state.reservations.length,
    reservedWireBytes: state.reservations.reduce((total, row) => total + row.wireBytes, 0) };
}

/** Caller supplies the budget from FINAL SERIALIZED wire representations (all
 * pages + manifest), not manifest.pages[].bytes which excludes generation fields.
 * This module validates that integer; it cannot authenticate how it was computed.
 * attemptToken is a once-generated 128-bit lowercase hex attempt identifier,
 * not user identity/authentication. Reuse exactly the tuple to inspect/reconcile
 * an uncertain attempt; another writer's token never adopts its reservation.
 */
export async function reserveAdmission(storage, input) {
  const requested = reservation(input); // owned scalar copy before the first await
  if (!storage || typeof storage.read !== 'function' || typeof storage.compareAndSwap !== 'function') fail('ADAPTER');
  const before = await readControl(storage);
  const entries = before?.state.reservations ?? [];
  const existing = entries.find(({ generation }) => generation === requested.generation);
  if (existing) {
    if (!same(existing, requested)) fail('GENERATION_RESERVATION_CONFLICT');
    return result('ALREADY_RESERVED', requested, before.state);
  }
  if (entries.some(({ attemptToken }) => attemptToken === requested.attemptToken)) fail('ATTEMPT_TOKEN_CONFLICT');
  if (entries.length >= ADMISSION_POLICY.maxGenerations) fail('GENERATION_BUDGET');
  const total = entries.reduce((sum, entry) => sum + entry.wireBytes, 0);
  if (requested.wireBytes > ADMISSION_POLICY.maxReservedWireBytes - total) fail('BYTE_BUDGET');
  const next = validateAdmissionState({ schema: 1, reservations: [...entries, requested]
    .sort((left, right) => left.generation < right.generation ? -1 : 1) });
  const bytes = encodeBoundedJson(next, ADMISSION_POLICY.controlBytes);
  let applied;
  try { applied = await storage.compareAndSwap(ADMISSION_POLICY.path, before?.version ?? null, Buffer.from(bytes)); }
  catch { fail('CAS_OUTCOME_UNKNOWN'); }
  if (typeof applied !== 'boolean') fail('CAS_OUTCOME_UNKNOWN');

  // No CAS retries. An uncertain write is never called uncommitted. Readback may
  // contain further legitimate reservations, but none of the prior entries may
  // disappear or change. Failure to verify after true CAS also remains UNKNOWN.
  let after;
  try { after = await readControl(storage); }
  catch { fail(applied ? 'CAS_OUTCOME_UNKNOWN' : 'CONTROL_READ'); }
  if (after === null) fail(applied ? 'CAS_OUTCOME_UNKNOWN' : 'CAS_CONFLICT');
  if (before && after.version === before.version &&
      !encodeBoundedJson(before.state).equals(encodeBoundedJson(after.state))) fail('STATE_VERSION');
  for (const entry of entries) {
    if (!after.state.reservations.some((candidate) => same(entry, candidate))) fail('STATE_REGRESSION');
  }
  const admitted = after.state.reservations.find(({ generation }) => generation === requested.generation);
  if (admitted && same(admitted, requested)) return result(applied ? 'RESERVED' : 'ALREADY_RESERVED', requested, after.state);
  if (applied) fail('CAS_OUTCOME_UNKNOWN');
  if (admitted) fail('GENERATION_RESERVATION_CONFLICT');
  fail('CAS_CONFLICT');
}
