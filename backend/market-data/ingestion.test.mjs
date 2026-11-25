import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateSnapshot } from './contract.mjs';
import { PROVIDER_LIMITS, assertNativeJsonLexemeSupport, parseProviderProducts,
  parseProviderPrices, normalizeProviderSnapshot } from './ingestion.mjs';

const test = (...args) => { void nodeTest(...args); };

const AT = '2026-10-03T02:41:55+0200';
const CATALOG_AT = '2026-10-03T11:44:53+0200';
const product = (id = '41', extra = '') => `{"idProduct":${id},"idCategory":51,"name":"Same card name","idExpansion":99,"idMetacard":123${extra}}`;
const quote = (id = '41', category = '51', extra = '') => `{"idProduct":${id},"idCategory":${category},"avg":1.01,"low":2.02,"trend":3.03,"avg1":4.04,"avg7":5.05,"avg30":6.06,"avg-holo":7.07,"low-holo":8.08,"trend-holo":9.09${extra}}`;
const root = (array, rows, timestamp, extra = '') => Buffer.from(`{"version":1,"createdAt":"${timestamp}","${array}":[${rows.join(',')}]${extra}}`);
const products = (rows = [product()], extra = '') => root('products', rows, CATALOG_AT, extra);
const prices = (rows = [quote()], extra = '') => root('priceGuides', rows, AT, extra);
const rejects = (fn, code) => assert.throws(fn, new RegExp(`MARKET_(?:DATA|INGESTION)_${code}`));

test('native runtime feature probe verifies unsafe integer, decimal and overflow source lexemes', () => {
  assert.doesNotThrow(() => assertNativeJsonLexemeSupport());
  rejects(() => assertNativeJsonLexemeSupport(() => []), 'UNSUPPORTED_JSON_RUNTIME');
  rejects(() => assertNativeJsonLexemeSupport((_text, reviver) => {
    for (const value of [9007199254740992, 1.005, Infinity]) reviver('x', value, undefined);
  }), 'UNSUPPORTED_JSON_RUNTIME');
  rejects(() => assertNativeJsonLexemeSupport(() => { throw Error('unsupported'); }), 'UNSUPPORTED_JSON_RUNTIME');
});

test('provider fields map exactly to nine distinct schema1 quotes, with raw-source receipts', () => {
  const rawProducts = products(), rawPrices = prices();
  const { snapshot, receipt } = normalizeProviderSnapshot(rawProducts, rawPrices);
  assert.deepEqual(validateSnapshot(snapshot.manifest, snapshot.pages), snapshot);
  const row = snapshot.pages[0].records[0];
  assert.deepEqual(row.normal, { average: '101', low: '202', trend: '303', average1: '404', average7: '505', average30: '606' });
  assert.deepEqual(row.reverse, { average: '707', low: '808', trend: '909' });
  assert.equal(row.productId, '41');
  assert.equal(row.categoryId, '51');
  assert.equal(row.expansionId, '99');
  assert.equal(row.metacardId, '123');
  assert.equal(snapshot.manifest.source, 'CARDMARKET_PUBLIC_DOWNLOAD');
  assert.equal(snapshot.manifest.sourceTimestamp, AT);
  assert.equal(snapshot.manifest.catalogSourceTimestamp, CATALOG_AT);
  for (const [key, bytes] of [['products', rawProducts], ['prices', rawPrices]]) {
    assert.equal(receipt[key].bytes, bytes.length);
    assert.equal(receipt[key].sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(receipt[key].count, 1);
  }
});

test('bare JSON numbers retain cents and IDs beyond Number.MAX_SAFE_INTEGER exactly', () => {
  const id = '9007199254740993';
  const row = quote(id).replace('"trend":3.03', '"trend":90071992547409.93').replace('"trend-holo":9.09', '"trend-holo":92233720368547758.07');
  const result = normalizeProviderSnapshot(products([product(id)]), prices([row]));
  const actual = result.snapshot.pages[0].records[0];
  assert.equal(actual.productId, id);
  assert.equal(actual.normal.trend, '9007199254740993');
  assert.equal(actual.reverse.trend, '9223372036854775807');
});

test('half-up operates on original bare/quoted decimal lexemes without floating conversion', () => {
  for (const value of ['1.005', '1.005e0', '"1.005"', '"1\\u002e005"']) {
    const row = quote().replace('"trend":3.03', `"trend":${value}`);
    assert.equal(parseProviderPrices(prices([row])).prices[0].normal.trend, '101');
  }
});

test('missing/null fields remain null and actual zero is not treated as missing', () => {
  const row = '{"idProduct":41,"idCategory":51,"avg":8.88,"low":0,"trend":null,"trend-holo":null}';
  const actual = parseProviderPrices(prices([row])).prices[0];
  assert.deepEqual(actual.normal, { average: '888', low: '0', trend: null, average1: null, average7: null, average30: null });
  assert.deepEqual(actual.reverse, { average: null, low: null, trend: null });
});

test('three additional reverse day averages are validated but never substituted into the nine fields', () => {
  const row = quote('41', '51', ',"avg1-holo":123.45,"avg7-holo":234.56,"avg30-holo":345.67');
  const actual = parseProviderPrices(prices([row])).prices[0];
  assert.deepEqual(Object.keys(actual.reverse), ['average', 'low', 'trend']);
  assert.equal(actual.reverse.trend, '909');
  rejects(() => parseProviderPrices(prices([quote('41', '51', ',"avg1-holo":-1')])), 'NEGATIVE_PRICE');
});

test('negative values, overflowing cents and nonfinite strings reject the complete guide', () => {
  for (const value of ['-0.001', '-1', '92233720368547758.075', '1e400', '"NaN"', '"Infinity"', 'true', '{}', '[]']) {
    const bad = quote('42').replace('"trend":3.03', `"trend":${value}`);
    assert.throws(() => parseProviderPrices(prices([quote(), bad])));
  }
});

test('IDs use exact original positive integer tokens, never exponent aliases or quoted names', () => {
  for (const id of ['0', '-1', '41.0', '41e0', '"41"', '9223372036854775808', 'null', 'true']) {
    assert.throws(() => parseProviderProducts(products([product(id)])), id);
    assert.throws(() => parseProviderPrices(prices([quote(id)])), id);
  }
  const raw = products([product('9223372036854775807')]);
  assert.equal(parseProviderProducts(raw).products[0].productId, '9223372036854775807');
});

test('catalog source must be category51 and unknown guide categories fail closed', () => {
  rejects(() => parseProviderProducts(products([product().replace('"idCategory":51', '"idCategory":52')])), 'PRODUCT_CATEGORY');
  rejects(() => parseProviderPrices(prices([quote('41', '999999')])), 'GUIDE_CATEGORY');
});

test('known guide-only categories are accounted for, not mapped to similarly named singles', () => {
  const result = normalizeProviderSnapshot(products(), prices([quote(), quote('42', '52'), quote('43', '1654')]));
  assert.equal(result.receipt.prices.count, 3);
  assert.equal(result.receipt.matchedProductCount, 1);
  assert.equal(result.receipt.unmatchedGuideCount, 2);
  assert.deepEqual(result.receipt.unmatchedGuideByCategory, { 52: 1, 1654: 1 });
  assert.deepEqual(result.snapshot.pages[0].records.map((row) => row.productId), ['41']);
});

test('same product ID with different category is a conflict, never an ignored other-category quote', () => {
  rejects(() => normalizeProviderSnapshot(products(), prices([quote('41', '52')])), 'IDENTITY_CONTRADICTION');
  rejects(() => normalizeProviderSnapshot(products(), prices([quote(), quote('42')])), 'UNMATCHED_SINGLES_QUOTE');
});

test('catalog-only products are counted and not fabricated as timestamped missing-price rows', () => {
  const result = normalizeProviderSnapshot(products([product(), product('42')]), prices());
  assert.equal(result.receipt.catalogWithoutPriceCount, 1);
  assert.equal(result.snapshot.manifest.totalItems, 1);
  assert.equal(parseProviderProducts(products([product(), product('42')])).products.length, 2);
});

test('duplicate product IDs reject even equal rows and even otherwise skipped categories', () => {
  rejects(() => parseProviderProducts(products([product(), product()])), 'DUPLICATE_PRODUCT');
  rejects(() => parseProviderPrices(prices([quote(), quote()])), 'DUPLICATE_PRODUCT');
  rejects(() => parseProviderPrices(prices([quote('42', '52'), quote('42', '52')])), 'DUPLICATE_PRODUCT');
});

test('native syntax rejects malformed JSON, trailing objects, NaN and unescaped control characters', () => {
  for (const raw of ['{', '[}', '{"x":}', '{}{}', '{"x":NaN}', '{"x":1,}', '{"x":"bad\nline"}', '\ufeff{}']) {
    rejects(() => parseProviderProducts(Buffer.from(raw)), 'JSON');
  }
});

test('identical or contradictory duplicate keys cannot be hidden by native last-key-wins', () => {
  for (const extra of [',"version":1', ',"version":2', ',"createdAt":"other"', ',"products":[]']) {
    rejects(() => parseProviderProducts(products([product()], extra)), 'DUPLICATE_KEY');
  }
  for (const extra of [',"avg":1.01', ',"avg":9.99', ',"a\\u0076g":1.01']) {
    rejects(() => parseProviderPrices(prices([quote('41', '51', extra)])), 'DUPLICATE_KEY');
  }
});

test('duplicate key guard counts overwritten object/array subtrees and empty-string keys', () => {
  for (const suffix of [
    ',"extra":{"a":{"b":1}},"extra":null',
    ',"extra":[{"a":1},{"b":[{"c":2}]}],"extra":[]',
    ',"extra":{"":1,"":2}',
    ',"extra":{"same":{"a":1},"same":{"a":1}}',
  ]) rejects(() => parseProviderProducts(products([product()], suffix)), 'DUPLICATE_KEY');
});

test('escaped quotes/backslashes/unicode and colons inside strings do not inflate key counts', () => {
  const name = 'A: https://example.invalid/a:b "quoted" \\ path \\"end" : Ä';
  let raw = products([product()]).toString('utf8').replace('"Same card name"', JSON.stringify(name));
  raw = raw.replace('"name"', '"n\\u0061me"').replace('Ä', '\\u00c4');
  const actual = parseProviderProducts(Buffer.from(raw));
  assert.equal(actual.products[0].name, name);
  const formatted = Buffer.from(` \n\t${raw.replaceAll(',', ',\n  ')} \r\n`);
  assert.equal(parseProviderProducts(formatted).products[0].name, name);
});

test('root arrays/primitives and empty or unexpected root shapes cannot masquerade as a provider feed', () => {
  for (const raw of ['[]', '[{},{}]', 'null', '1', '"x"', '{}', '{"a":[{"b":1}]}']) {
    assert.throws(() => parseProviderProducts(Buffer.from(raw)));
  }
  rejects(() => parseProviderProducts(products([], ',"count":0')), 'RECORD_LIMIT');
  rejects(() => parseProviderProducts(products([product()], ',"extra":[{"a":1}]')), 'FIELDS');
});

test('prototype-related keys are rejected at any depth without executing a setter', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    rejects(() => parseProviderProducts(products([product()], `,"${key}":{"polluted":true}`)), 'RESERVED_KEY');
    rejects(() => parseProviderPrices(prices([quote('41', '51', `,"${key}":0`)])), 'RESERVED_KEY');
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('depth and actual UTF8 byte budgets apply before native provider parsing', () => {
  const raw = products();
  assert.equal(parseProviderProducts(raw, { maxBytes: raw.length }).source.bytes, raw.length);
  rejects(() => parseProviderProducts(raw, { maxBytes: raw.length - 1 }), 'BYTE_LIMIT');
  const deep = `${'['.repeat(PROVIDER_LIMITS.nesting + 1)}null${']'.repeat(PROVIDER_LIMITS.nesting + 1)}`;
  rejects(() => parseProviderProducts(Buffer.from(deep)), 'DEPTH_LIMIT');
  rejects(() => parseProviderProducts(Buffer.from([0xff])), 'UTF8');
  rejects(() => parseProviderProducts('{}'), 'BYTE_LIMIT');
});

test('record limits, declared counts and version are exact and cannot be relaxed above fixed maxima', () => {
  const raw = products([product(), product('42')], ',"count":2');
  assert.equal(parseProviderProducts(raw, { maxRecords: 2 }).products.length, 2);
  rejects(() => parseProviderProducts(raw, { maxRecords: 1 }), 'RECORD_LIMIT');
  for (const count of ['1', '3', '2.0', '2e0', '"2"', 'null']) {
    rejects(() => parseProviderProducts(products([product(), product('42')], `,"count":${count}`)), 'DECLARED_COUNT');
  }
  for (const version of ['2', '1.0', '1e0', '"1"', 'null']) {
    rejects(() => parseProviderProducts(Buffer.from(products().toString().replace('"version":1', `"version":${version}`))), 'VERSION');
  }
  for (const options of [{ maxRecords: PROVIDER_LIMITS.records + 1 }, { maxBytes: PROVIDER_LIMITS.fileBytes + 1 },
    { maxBytes: 0 }, { maxRecords: 0 }, { unknown: 1 }]) rejects(() => parseProviderProducts(products(), options), 'LIMITS');
});

test('optional metadata IDs remain null, malformed metadata and timestamps reject', () => {
  const raw = products(['{"idProduct":41,"idCategory":51,"name":"Card"}']);
  const row = parseProviderProducts(raw).products[0];
  assert.equal(row.expansionId, null); assert.equal(row.metacardId, null);
  rejects(() => parseProviderProducts(products([product('41', ',"dateAdded":123')])), 'METADATA');
  rejects(() => parseProviderProducts(root('products', [product()], '2026-02-30T00:00:00Z')), 'TIMESTAMP');
  assert.throws(() => parseProviderProducts(products([product().replace('Same card name', '\\ud800')])));
});

test('numeric token bound applies even to otherwise ignored metadata', () => {
  const huge = '1'.repeat(PROVIDER_LIMITS.numericLexeme + 1);
  rejects(() => parseProviderProducts(products([product('41', `,"dateAdded":${huge}`)])), 'NUMERIC_LEXEME');
});
