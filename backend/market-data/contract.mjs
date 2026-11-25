import { createHash } from 'node:crypto';

/**
 * Schema 1: a CURRENT provider snapshot, not an archive/restore contract.
 * Only a trusted server ingestion path may publish it; validation/hash equality
 * is NOT provider authentication and must never make client uploads public truth.
 * No network, storage, Firebase, timer, clock, or deployment side effects here.
 * Twelve-calendar-month history retention is a separate policy, not implemented
 * or promised by this current-snapshot transport.
 */
export const LIMITS = Object.freeze({
  pageItems: 200,
  pageBytes: 256 * 1024,
  manifestBytes: 256 * 1024,
  snapshotItems: 200_000,
  requestIds: 100,
  requestBytes: 4 * 1024,
  nameBytes: 512,
  timestampBytes: 40,
  decimalBytes: 128,
  etagHeaderBytes: 1024,
  etagCount: 16,
});
export const NORMAL_FIELDS = Object.freeze(['average', 'low', 'trend', 'average1', 'average7', 'average30']);
export const REVERSE_FIELDS = Object.freeze(['average', 'low', 'trend']);
const MAX_INT64 = 9223372036854775807n;
const HEADER = Object.freeze({ schema: 1, kind: 'cardmarket-current-prices', source: 'CARDMARKET_PUBLIC_DOWNLOAD', currency: 'EUR' });
const HEADER_KEYS = Object.keys(HEADER);
const PRODUCT_KEYS = ['productId', 'categoryId', 'expansionId', 'metacardId', 'name'];
const PRICE_KEYS = ['productId', 'categoryId', 'normal', 'reverse'];
const RECORD_KEYS = [...PRODUCT_KEYS, 'normal', 'reverse'];
const PAYLOAD_KEYS = [...HEADER_KEYS, 'sourceTimestamp', 'catalogSourceTimestamp', 'index', 'totalItems', 'records'];
const MANIFEST_KEYS = [...HEADER_KEYS, 'sourceTimestamp', 'catalogSourceTimestamp', 'pageSize', 'totalItems', 'pages', 'generation'];
const fail = (code) => { throw new Error(`MARKET_DATA_${code}`); };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('OBJECT');
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail('FIELDS');
  for (const key of keys) if (!Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail('DATA_FIELDS');
}

function integer(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('INTEGER');
  return value;
}

function boundedString(value, maximum) {
  if (typeof value !== 'string' || value.length === 0 || !value.isWellFormed() ||
      Buffer.byteLength(value, 'utf8') > maximum || /[\u0000-\u001f\u007f]/u.test(value)) fail('STRING');
  return value;
}

export function validateProductId(value) {
  if (typeof value !== 'string' || value !== value.trim() || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > MAX_INT64) fail('PRODUCT_ID');
  return value;
}

function nullableId(value) { return value === null ? null : validateProductId(value); }

function minor(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value !== value.trim() || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > MAX_INT64) fail('MINOR');
  return value;
}

/** Exact BigDecimal-compatible HALF_UP cents conversion from an original decimal
 * lexeme, NEVER a JS Number. Negative nonzero source prices are rejected BEFORE
 * rounding (including -0.001), not clamped, replaced, or published. */
export function decimalEuroToMinor(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > LIMITS.decimalBytes) fail('DECIMAL');
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,4}))?$/.exec(value);
  if (!match || match[0] !== value) fail('DECIMAL');
  const fraction = match[3] ?? match[4] ?? '';
  const coefficient = BigInt(`${match[2] ?? '0'}${fraction}`);
  if (match[1] === '-' && coefficient !== 0n) fail('NEGATIVE_PRICE');
  const exponent = Number(match[5] ?? 0);
  if (Math.abs(exponent) > 1000) fail('DECIMAL_EXPONENT');
  const shift = exponent - fraction.length + 2;
  let result;
  if (shift >= 0) result = coefficient * (10n ** BigInt(shift));
  else {
    const divisor = 10n ** BigInt(-shift);
    result = coefficient / divisor;
    if ((coefficient % divisor) * 2n >= divisor) result++;
  }
  if (result > MAX_INT64) fail('MINOR_OVERFLOW');
  return result.toString();
}

/** Validate calendar/offset, retaining the provider's exact original spelling,
 * including +0200 versus +02:00 and up to nanosecond precision. No Date coercion. */
export function validateSourceTimestamp(value) {
  boundedString(value, LIMITS.timestampBytes);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):?(\d{2}))$/.exec(value);
  if (!m) fail('TIMESTAMP');
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      hour > 23 || minute > 59 || second > 59 ||
      (m[7] !== 'Z' && (Number(m[8]) > 18 || Number(m[9]) > 59 ||
        (Number(m[8]) === 18 && Number(m[9]) !== 0)))) fail('TIMESTAMP');
  return value;
}

function quotes(value, fields) {
  object(value, fields);
  return Object.fromEntries(fields.map((field) => [field, minor(value[field])]));
}

function product(value) {
  object(value, PRODUCT_KEYS);
  const name = boundedString(value.name, LIMITS.nameBytes);
  if (!name.trim()) fail('NAME');
  return {
    productId: validateProductId(value.productId), categoryId: validateProductId(value.categoryId),
    expansionId: nullableId(value.expansionId), metacardId: nullableId(value.metacardId), name,
  };
}

export function validateRecord(value) {
  object(value, RECORD_KEYS);
  return {
    ...product(Object.fromEntries(PRODUCT_KEYS.map((key) => [key, value[key]]))),
    normal: quotes(value.normal, NORMAL_FIELDS), reverse: quotes(value.reverse, REVERSE_FIELDS),
  };
}

/** Provider catalog/price rows can join ONLY by exact product + category ID.
 * Names are display metadata, never a lookup or a printing/variant identity. */
export function joinProductAndPrice(catalogProduct, price) {
  const metadata = product(catalogProduct);
  object(price, PRICE_KEYS);
  if (validateProductId(price.productId) !== metadata.productId ||
      validateProductId(price.categoryId) !== metadata.categoryId) fail('IDENTITY_CONTRADICTION');
  return validateRecord({ ...metadata, normal: price.normal, reverse: price.reverse });
}

function canonical(value, depth = 0) {
  if (depth > 16) fail('JSON_DEPTH');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    if (!value.isWellFormed()) fail('UTF8');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail('JSON_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) fail('JSON_ARRAY');
    const entries = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('JSON_ARRAY');
      entries.push(canonical(descriptor.value, depth + 1));
    }
    return `[${entries.join(',')}]`;
  }
  if (!value || typeof value !== 'object') fail('JSON_VALUE');
  const keys = Object.keys(value).sort();
  object(value, keys);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
}

/** Wire bytes are UTF-8, recursively lexicographic keys, no whitespace/BOM.
 * Exact canonical parsing also rejects duplicate keys instead of silently taking
 * the last contradictory JSON value. It is not a raw-provider JSON parser. */
export function encodeBoundedJson(value, maximum = LIMITS.pageBytes) {
  integer(maximum, 1, LIMITS.pageBytes);
  const bytes = Buffer.from(canonical(value), 'utf8');
  if (bytes.length > maximum) fail('BODY_LIMIT');
  return bytes;
}

function boundedBytes(value, maximum) {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maximum) fail('BODY_LIMIT');
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export function parseBoundedJson(value, maximum = LIMITS.pageBytes) {
  integer(maximum, 1, LIMITS.pageBytes);
  const bytes = boundedBytes(value, maximum);
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { fail('JSON'); }
  if (!encodeBoundedJson(parsed, maximum).equals(bytes)) fail('NONCANONICAL_JSON');
  return parsed;
}

function generation(value) {
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) fail('GENERATION');
  return value;
}

function header(value) {
  for (const key of HEADER_KEYS) if (value[key] !== HEADER[key]) fail('HEADER');
  validateSourceTimestamp(value.sourceTimestamp);
  validateSourceTimestamp(value.catalogSourceTimestamp);
}

function manifestBody(value) {
  return Object.fromEntries(MANIFEST_KEYS.filter((key) => key !== 'generation').map((key) => [key, value[key]]));
}

export function validateManifest(value) {
  object(value, MANIFEST_KEYS);
  header(value);
  if (value.pageSize !== LIMITS.pageItems) fail('PAGE_SIZE');
  integer(value.totalItems, 1, LIMITS.snapshotItems);
  const count = Math.ceil(value.totalItems / LIMITS.pageItems);
  if (!Array.isArray(value.pages) || value.pages.length !== count) fail('PAGE_COUNT');
  const pages = value.pages.map((entry, index) => {
    object(entry, ['index', 'count', 'bytes', 'sha256']);
    if (entry.index !== index || entry.count !== Math.min(LIMITS.pageItems, value.totalItems - index * LIMITS.pageItems)) fail('PAGE_COUNT');
    integer(entry.bytes, 1, LIMITS.pageBytes);
    generation(entry.sha256);
    return { ...entry };
  });
  const normalized = { ...HEADER, sourceTimestamp: value.sourceTimestamp,
    catalogSourceTimestamp: value.catalogSourceTimestamp, pageSize: value.pageSize,
    totalItems: value.totalItems, pages, generation: generation(value.generation) };
  if (hash(encodeBoundedJson(manifestBody(normalized), LIMITS.manifestBytes)) !== normalized.generation) fail('MANIFEST_GENERATION');
  encodeBoundedJson(normalized, LIMITS.manifestBytes);
  return normalized;
}

function pagePayload(page) { return Object.fromEntries(PAYLOAD_KEYS.map((key) => [key, page[key]])); }

export function validatePage(value, expectedManifest) {
  return pageWithValidatedManifest(value, validateManifest(expectedManifest));
}

function pageWithValidatedManifest(value, manifest) {
  object(value, [...PAYLOAD_KEYS, 'generation']);
  header(value);
  if (value.generation !== manifest.generation || value.sourceTimestamp !== manifest.sourceTimestamp ||
      value.catalogSourceTimestamp !== manifest.catalogSourceTimestamp || value.totalItems !== manifest.totalItems) fail('PAGE_GENERATION');
  integer(value.index, 0, manifest.pages.length - 1);
  const expected = manifest.pages[value.index];
  if (!Array.isArray(value.records) || value.records.length !== expected.count) fail('PAGE_COUNT');
  const records = value.records.map(validateRecord);
  for (let i = 1; i < records.length; i++) {
    if (BigInt(records[i - 1].productId) >= BigInt(records[i].productId)) fail('PRODUCT_ORDER');
  }
  const normalized = { ...pagePayload(value), records, generation: manifest.generation };
  const payloadBytes = encodeBoundedJson(pagePayload(normalized));
  // The manifest hashes ONLY the generation-free payload: no circular hash.
  if (payloadBytes.length !== expected.bytes || hash(payloadBytes) !== expected.sha256) fail('PAGE_DIGEST');
  encodeBoundedJson(normalized);
  return normalized;
}

export function validateSnapshot(expectedManifest, inputPages) {
  const manifest = validateManifest(expectedManifest);
  if (!Array.isArray(inputPages) || inputPages.length !== manifest.pages.length) fail('PAGE_COUNT');
  let lastId = 0n;
  const pages = [];
  for (let index = 0; index < inputPages.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(inputPages, index);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('PAGE_COUNT');
    const checked = pageWithValidatedManifest(descriptor.value, manifest);
    if (checked.index !== index || BigInt(checked.records[0].productId) <= lastId) fail('PRODUCT_ORDER');
    lastId = BigInt(checked.records.at(-1).productId);
    pages.push(checked);
  }
  return { manifest, pages };
}

/** All-or-nothing construction. Duplicate IDs, negative prices, bad metadata,
 * or any overflow reject the new generation; callers retain their last valid one. */
export function buildSnapshot({ sourceTimestamp, catalogSourceTimestamp, records }) {
  validateSourceTimestamp(sourceTimestamp);
  validateSourceTimestamp(catalogSourceTimestamp);
  if (!Array.isArray(records)) fail('RECORDS');
  integer(records.length, 1, LIMITS.snapshotItems);
  const sorted = records.map(validateRecord).sort((a, b) => BigInt(a.productId) < BigInt(b.productId) ? -1 : BigInt(a.productId) > BigInt(b.productId) ? 1 : 0);
  for (let i = 1; i < sorted.length; i++) if (sorted[i - 1].productId === sorted[i].productId) fail('DUPLICATE_PRODUCT');
  const payloads = [];
  for (let start = 0; start < sorted.length; start += LIMITS.pageItems) {
    payloads.push({ ...HEADER, sourceTimestamp, catalogSourceTimestamp, index: payloads.length,
      totalItems: sorted.length, records: sorted.slice(start, start + LIMITS.pageItems) });
  }
  const body = { ...HEADER, sourceTimestamp, catalogSourceTimestamp, pageSize: LIMITS.pageItems,
    totalItems: sorted.length, pages: payloads.map((payload) => {
      const bytes = encodeBoundedJson(payload);
      return { index: payload.index, count: payload.records.length, bytes: bytes.length, sha256: hash(bytes) };
    }) };
  const manifest = { ...body, generation: hash(encodeBoundedJson(body, LIMITS.manifestBytes)) };
  return validateSnapshot(manifest, payloads.map((payload) => ({ ...payload, generation: manifest.generation })));
}

export function validateIdRequest(value, expectedGeneration) {
  object(value, ['schema', 'generation', 'productIds']);
  if (value.schema !== 1 || generation(value.generation) !== generation(expectedGeneration)) fail('REQUEST_GENERATION');
  if (!Array.isArray(value.productIds) || value.productIds.length < 1 || value.productIds.length > LIMITS.requestIds) fail('REQUEST_IDS');
  const productIds = value.productIds.map(validateProductId);
  if (new Set(productIds).size !== productIds.length) fail('DUPLICATE_PRODUCT');
  const normalized = { schema: 1, generation: value.generation, productIds };
  encodeBoundedJson(normalized, LIMITS.requestBytes);
  return normalized;
}

export function etagForBytes(bytes) {
  return `"sha256-${hash(boundedBytes(bytes, LIMITS.pageBytes))}"`;
}

/** If-None-Match weak comparison for an existing GET/HEAD representation ONLY.
 * Not an If-Match/write precondition. Malformed/oversized headers fail closed. */
export function matchesIfNoneMatch(value, currentEtag) {
  if (typeof currentEtag !== 'string' || currentEtag.length !== 73 || !/^"sha256-[a-f0-9]{64}"$/.test(currentEtag)) fail('ETAG');
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > LIMITS.etagHeaderBytes ||
      /[^\t\x20-\x7e]/.test(value)) fail('ETAG_HEADER');
  if (value.trim() === '*') return true;
  let rest = value;
  const tags = [];
  while (rest.length > 0) {
    const match = /^[ \t]*((?:W\/)?"[\x21\x23-\x7e]*")[ \t]*(,|$)/.exec(rest);
    if (!match || tags.length === LIMITS.etagCount) fail('ETAG_HEADER');
    tags.push(match[1].replace(/^W\//, ''));
    rest = rest.slice(match[0].length);
    if (match[2] === ',' && rest.trim().length === 0) fail('ETAG_HEADER');
  }
  if (tags.length === 0) fail('ETAG_HEADER');
  return tags.includes(currentEtag);
}
