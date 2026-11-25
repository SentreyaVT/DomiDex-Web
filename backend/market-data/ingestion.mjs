import { createHash } from 'node:crypto';
import {
  LIMITS, buildSnapshot, decimalEuroToMinor, joinProductAndPrice,
  validateProductId, validateRecord, validateSourceTimestamp,
} from './contract.mjs';

/** Local normalization of trusted provider download BYTES only. No fetch, publish,
 * persistence, client-upload route, historical archive, or retention enforcement.
 * Input/record limits are not a claim about peak JS heap usage during JSON.parse.
 */
export const PROVIDER_LIMITS = Object.freeze({ fileBytes: 128 * 1024 * 1024, records: LIMITS.snapshotItems,
  nesting: 8, numericLexeme: 128 });
export const SINGLES_CATEGORY = '51';
// Other categories actually present in the pinned official 2026-10-03 Pokemon
// price guide; do not silently expand the accepted feed scope to unknown IDs.
export const OTHER_GUIDE_CATEGORIES = Object.freeze(['52', '53', '54', '1013', '1014', '1015',
  '1016', '1017', '1064', '1083', '1654']);
const NORMAL = Object.freeze({ average: 'avg', low: 'low', trend: 'trend', average1: 'avg1', average7: 'avg7', average30: 'avg30' });
const REVERSE = Object.freeze({ average: 'avg-holo', low: 'low-holo', trend: 'trend-holo' });
const EXTRA_QUOTES = Object.freeze(['avg1-holo', 'avg7-holo', 'avg30-holo']);
const fail = (code) => { throw new Error(`MARKET_INGESTION_${code}`); };
class NumericLexeme {
  constructor(value) { this.value = value; Object.freeze(this); }
}

function hasAsciiControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

/** Node 22 must provide native reviver source context; never guess from its
 * version or recover a rounded Number using toString. The optional parser is
 * only a feature-probe seam; provider parsing itself always uses native JSON.parse. */
export function assertNativeJsonLexemeSupport(parser = JSON.parse) {
  const actual = [];
  try {
    parser('[9007199254740993,1.005,1e400]', (_key, value, context) => {
      if (typeof value === 'number') actual.push(context?.source);
      return value;
    });
  } catch { fail('UNSUPPORTED_JSON_RUNTIME'); }
  if (actual.length !== 3 || actual[0] !== '9007199254740993' || actual[1] !== '1.005' || actual[2] !== '1e400') {
    fail('UNSUPPORTED_JSON_RUNTIME');
  }
}

/** A structural budget/key-count guard, NOT a JSON grammar parser. Native
 * JSON.parse remains responsible for all syntax. A colon outside a JSON string
 * represents one source property; native reviver object key counts exclude its
 * synthetic root holder and arrays. Duplicate keys (including overwritten whole
 * subtrees) can only decrease the surviving property count, so equality is required.
 */
function sourcePropertyCount(text) {
  let quoted = false, escaped = false, depth = 0, properties = 0;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === ':') properties++;
    else if (character === '{' || character === '[') {
      if (++depth > PROVIDER_LIMITS.nesting) fail('DEPTH_LIMIT');
    } else if (character === '}' || character === ']') {
      if (--depth < 0) fail('JSON');
    }
  }
  return properties;
}

function limits(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some((key) => !['maxBytes', 'maxRecords'].includes(key))) fail('LIMITS');
  const maxBytes = options.maxBytes ?? PROVIDER_LIMITS.fileBytes;
  const maxRecords = options.maxRecords ?? PROVIDER_LIMITS.records;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > PROVIDER_LIMITS.fileBytes ||
      !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > PROVIDER_LIMITS.records) fail('LIMITS');
  return { maxBytes, maxRecords };
}

function parseProvider(bytes, arrayName, options) {
  const budget = limits(options);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > budget.maxBytes) fail('BYTE_LIMIT');
  assertNativeJsonLexemeSupport();
  // Own the source bytes so a caller cannot later change the receipt's input.
  const owned = Buffer.from(bytes);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(owned); }
  catch { fail('UTF8'); }
  const expectedProperties = sourcePropertyCount(text);
  let properties = 0;
  let parsed;
  try {
    parsed = JSON.parse(text, (key, value, context) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('RESERVED_KEY');
      if (typeof value === 'number') {
        if (typeof context?.source !== 'string' || context.source.length > PROVIDER_LIMITS.numericLexeme) fail('NUMERIC_LEXEME');
        return new NumericLexeme(context.source);
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) properties += Object.keys(value).length;
      return value;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('MARKET_INGESTION_')) throw error;
    fail('JSON'); // Never expose raw provider fragments or accidental credentials in an error.
  }
  if (properties !== expectedProperties) fail('DUPLICATE_KEY');
  fields(parsed, ['version', 'createdAt', arrayName], ['count']);
  if (!(parsed.version instanceof NumericLexeme) || parsed.version.value !== '1') fail('VERSION');
  const sourceTimestamp = validateSourceTimestamp(parsed.createdAt);
  const records = parsed[arrayName];
  if (!Array.isArray(records) || records.length < 1 || records.length > budget.maxRecords) fail('RECORD_LIMIT');
  if (Object.hasOwn(parsed, 'count') && (!(parsed.count instanceof NumericLexeme) || parsed.count.value !== String(records.length))) fail('DECLARED_COUNT');
  return { records, source: { sha256: createHash('sha256').update(owned).digest('hex'), bytes: owned.length,
    version: 1, sourceTimestamp, count: records.length } };
}

function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('OBJECT');
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) fail('FIELDS');
}

function sourceId(value) {
  if (!(value instanceof NumericLexeme)) fail('ID_TOKEN');
  return validateProductId(value.value);
}

function optionalSourceId(value) { return value === undefined || value === null ? null : sourceId(value); }

function money(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof NumericLexeme) return decimalEuroToMinor(value.value);
  // Android's Moshi/BigDecimal reader also permits a quoted decimal, losslessly.
  if (typeof value === 'string') return decimalEuroToMinor(value);
  fail('PRICE_TOKEN');
}

function unique(records) {
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.productId)) fail('DUPLICATE_PRODUCT');
    ids.add(record.productId);
  }
  return records;
}

export function parseProviderProducts(bytes, options = {}) {
  const { source, records } = parseProvider(bytes, 'products', options);
  const products = unique(records.map((row) => {
    fields(row, ['idProduct', 'name', 'idCategory'], ['idExpansion', 'idMetacard', 'categoryName', 'dateAdded']);
    const productId = sourceId(row.idProduct), categoryId = sourceId(row.idCategory);
    if (categoryId !== SINGLES_CATEGORY) fail('PRODUCT_CATEGORY');
    for (const field of ['categoryName', 'dateAdded']) {
      if (Object.hasOwn(row, field) && (typeof row[field] !== 'string' || !row[field].isWellFormed() ||
          Buffer.byteLength(row[field], 'utf8') > LIMITS.nameBytes || hasAsciiControlCharacter(row[field]))) fail('METADATA');
    }
    const metadata = { productId, categoryId, expansionId: optionalSourceId(row.idExpansion),
      metacardId: optionalSourceId(row.idMetacard), name: row.name };
    // Reuse the wire's metadata/ID validation without inventing a published quote.
    const checked = validateRecord({ ...metadata,
      normal: Object.fromEntries(Object.keys(NORMAL).map((key) => [key, null])),
      reverse: Object.fromEntries(Object.keys(REVERSE).map((key) => [key, null])) });
    const { normal: _ignoredNormal, reverse: _ignoredReverse, ...product } = checked;
    return product;
  }));
  return { source, products };
}

export function parseProviderPrices(bytes, options = {}) {
  const { source, records } = parseProvider(bytes, 'priceGuides', options);
  const prices = unique(records.map((row) => {
    fields(row, ['idProduct', 'idCategory'], [...Object.values(NORMAL), ...Object.values(REVERSE), ...EXTRA_QUOTES]);
    const productId = sourceId(row.idProduct), categoryId = sourceId(row.idCategory);
    if (categoryId !== SINGLES_CATEGORY && !OTHER_GUIDE_CATEGORIES.includes(categoryId)) fail('GUIDE_CATEGORY');
    // Validate these source fields if present, but schema1 deliberately does not
    // publish the three additional reverse averages that Android does not consume.
    for (const field of EXTRA_QUOTES) if (Object.hasOwn(row, field)) money(row[field]);
    return { productId, categoryId,
      normal: Object.fromEntries(Object.entries(NORMAL).map(([target, field]) => [target, money(row[field])])),
      reverse: Object.fromEntries(Object.entries(REVERSE).map(([target, field]) => [target, money(row[field])])) };
  }));
  return { source, prices };
}

/** Only actual guide rows are published as quotes. No synthesized timestamped
 * all-null quote for a catalog-only product, no name-based join, no dropped
 * conflicting ID, and no "all categories" or historical-completeness claim.
 */
export function normalizeProviderSnapshot(productsBytes, pricesBytes, options = {}) {
  const catalog = parseProviderProducts(productsBytes, options);
  const guide = parseProviderPrices(pricesBytes, options);
  const products = new Map(catalog.products.map((product) => [product.productId, product]));
  const matched = new Set();
  const records = [];
  const unmatchedGuideByCategory = {};
  for (const quote of guide.prices) {
    const product = products.get(quote.productId);
    if (product) {
      records.push(joinProductAndPrice(product, quote)); // Includes exact category equality.
      matched.add(quote.productId);
    } else if (quote.categoryId !== SINGLES_CATEGORY && OTHER_GUIDE_CATEGORIES.includes(quote.categoryId)) {
      unmatchedGuideByCategory[quote.categoryId] = (unmatchedGuideByCategory[quote.categoryId] ?? 0) + 1;
    } else fail('UNMATCHED_SINGLES_QUOTE');
  }
  const snapshot = buildSnapshot({ sourceTimestamp: guide.source.sourceTimestamp,
    catalogSourceTimestamp: catalog.source.sourceTimestamp, records });
  return { snapshot, receipt: { schema: 1, products: catalog.source, prices: guide.source,
    matchedProductCount: matched.size, catalogWithoutPriceCount: catalog.products.length - matched.size,
    unmatchedGuideCount: guide.prices.length - matched.size, unmatchedGuideByCategory,
    generation: snapshot.manifest.generation } };
}
