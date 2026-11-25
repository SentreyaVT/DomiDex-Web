import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  LIMITS, NORMAL_FIELDS, REVERSE_FIELDS, validateProductId, decimalEuroToMinor,
  validateSourceTimestamp, validateRecord, joinProductAndPrice, buildSnapshot,
  validateManifest, validatePage, validateSnapshot, encodeBoundedJson, parseBoundedJson,
  validateIdRequest, etagForBytes, matchesIfNoneMatch,
} from './contract.mjs';

const AT = '2026-10-04T02:48:57+0200';
const CATALOG_AT = '2026-10-03T01:02:03.123456789+02:00';
const copy = (value) => structuredClone(value);
const digest = (value) => createHash('sha256').update(encodeBoundedJson(value)).digest('hex');
const metadata = (id = '41') => ({ productId: id, categoryId: '52', expansionId: '99', metacardId: null, name: 'Same display name' });
const record = (id = '41') => ({ ...metadata(id), normal: { average: '101', low: '202', trend: '303',
  average1: '404', average7: '505', average30: '606' }, reverse: { average: '707', low: '808', trend: '909' } });
const snapshot = (records = [record()], overrides = {}) => buildSnapshot({ sourceTimestamp: AT,
  catalogSourceTimestamp: CATALOG_AT, records, ...overrides });
const rejects = (fn, category) => assert.throws(fn, new RegExp(`MARKET_DATA_${category}`));

test('all nine prices remain distinct with EUR/source and exact original timestamps', () => {
  const { manifest, pages } = snapshot();
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.kind, 'cardmarket-current-prices');
  assert.equal(manifest.source, 'CARDMARKET_PUBLIC_DOWNLOAD');
  assert.equal(manifest.currency, 'EUR');
  assert.equal(manifest.sourceTimestamp, AT);
  assert.equal(manifest.catalogSourceTimestamp, CATALOG_AT);
  assert.deepEqual(pages[0].records[0], record());
  assert.equal(NORMAL_FIELDS.length + REVERSE_FIELDS.length, 9);
  assert.equal(Object.hasOwn(manifest, 'history'), false);
  assert.equal(Object.hasOwn(manifest, 'url'), false);
});

test('null never becomes zero, normal average never replaces a missing trend', () => {
  const row = record();
  row.normal.trend = null;
  row.normal.low = '0';
  row.reverse.trend = null;
  row.reverse.average = null;
  const actual = snapshot([row]).pages[0].records[0];
  assert.equal(actual.normal.trend, null);
  assert.equal(actual.normal.low, '0');
  assert.equal(actual.normal.average, '101');
  assert.equal(actual.reverse.trend, null);
  assert.equal(actual.reverse.average, null);
  for (const field of NORMAL_FIELDS) row.normal[field] = null;
  for (const field of REVERSE_FIELDS) row.reverse[field] = null;
  assert.deepEqual(validateRecord(row), row);
});

test('missing or unknown price fields reject rather than infer defaults', () => {
  for (const [variant, fields] of [['normal', NORMAL_FIELDS], ['reverse', REVERSE_FIELDS]]) {
    for (const field of fields) {
      const row = record(); delete row[variant][field];
      rejects(() => validateRecord(row), 'FIELDS');
    }
  }
  const extra = record(); extra.reverse.average7 = '88';
  rejects(() => validateRecord(extra), 'FIELDS');
});

test('exact int64 IDs never pass through JS Number and aliases are rejected', () => {
  assert.equal(validateProductId('9223372036854775807'), '9223372036854775807');
  assert.equal(validateProductId('9007199254740993'), '9007199254740993');
  for (const invalid of [0, 41, 9007199254740992, 1n, '', '0', '01', '-1', '+1', '1.0', '1e2',
    ' 41', '41 ', '41\n', '9223372036854775808', '9'.repeat(100), null, undefined]) {
    rejects(() => validateProductId(invalid), 'PRODUCT_ID');
  }
});

test('provider rows join only by matching product and category IDs, never display name', () => {
  const prices = { productId: '41', categoryId: '52', normal: record().normal, reverse: record().reverse };
  assert.deepEqual(joinProductAndPrice(metadata(), prices), record());
  rejects(() => joinProductAndPrice(metadata('42'), prices), 'IDENTITY_CONTRADICTION');
  rejects(() => joinProductAndPrice(metadata(), { ...prices, categoryId: '53' }), 'IDENTITY_CONTRADICTION');
  const sameNames = snapshot([record('42'), record('41')]).pages[0].records;
  assert.deepEqual(sameNames.map((row) => row.productId), ['41', '42']);
  assert.equal(sameNames[0].name, sameNames[1].name);
});

test('price fields permit exactly nonnegative canonical int64 strings or null', () => {
  const row = record(); row.normal.trend = '9223372036854775807';
  assert.equal(validateRecord(row).normal.trend, '9223372036854775807');
  for (const bad of ['9223372036854775808', '-1', '-0', '+1', '01', '1.0', '1e2', '1\n', '', 1, 0, NaN, Infinity, 1n, undefined]) {
    const badRow = record(); badRow.reverse.trend = bad;
    rejects(() => validateRecord(badRow), 'MINOR');
  }
});

test('HALF_UP conversion is exact before/after the unsafe JS integer boundary', () => {
  for (const [input, expected] of [
    ['0', '0'], ['-0.00', '0'], ['0.004', '0'], ['0.005', '1'], ['0.015', '2'],
    ['1.005', '101'], ['9.995', '1000'], ['.005', '1'], ['+1.234', '123'],
    ['1.234e2', '12340'], ['5e-3', '1'], ['1e-1000', '0'],
    ['90071992547409.93', '9007199254740993'],
    ['92233720368547758.07', '9223372036854775807'],
    ['92233720368547758.074', '9223372036854775807'],
  ]) assert.equal(decimalEuroToMinor(input), expected, input);
  assert.equal(decimalEuroToMinor(null), null);
});

test('negative raw money fails before rounding instead of silently becoming zero', () => {
  for (const input of ['-0.001', '-0.005', '-1', '-92233720368547758.08']) {
    rejects(() => decimalEuroToMinor(input), 'NEGATIVE_PRICE');
  }
});

test('overflow, lost Number lexemes and excessive decimal work are rejected', () => {
  for (const input of ['92233720368547758.075', '92233720368547758.08', '1e1000']) {
    rejects(() => decimalEuroToMinor(input), 'MINOR_OVERFLOW');
  }
  for (const input of [1, 1.005, 9007199254740992, NaN, Infinity, 'NaN', 'Infinity', '', ' 1', '1 ',
    '1\n', '1,00', '0x10', '1e', '1e10001', '1'.repeat(129), undefined]) {
    rejects(() => decimalEuroToMinor(input), 'DECIMAL');
  }
  rejects(() => decimalEuroToMinor('1e1001'), 'DECIMAL_EXPONENT');
});

test('source timestamps preserve exact offset spelling with strict calendar checks', () => {
  for (const value of [AT, CATALOG_AT, '2024-02-29T23:59:59Z', '2026-10-04T00:00:00+18:00']) {
    assert.equal(validateSourceTimestamp(value), value);
  }
  for (const value of ['2025-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-00-01T00:00:00Z',
    '2026-10-04T24:00:00Z', '2026-10-04T00:60:00Z', '2026-10-04T00:00:60Z',
    '2026-10-04T00:00:00+18:01', '2026-10-04T00:00:00+19:00', '2026-10-04T00:00:00',
    '2026-10-04', '0000-01-01T00:00:00Z', '2026-10-04T00:00:00.1234567890Z']) {
    rejects(() => validateSourceTimestamp(value), 'TIMESTAMP');
  }
  rejects(() => validateSourceTimestamp('x'.repeat(41)), 'STRING');
});

test('metadata identity and UTF8 name limits are explicit, not lossy truncation', () => {
  const row = record(); row.name = 'Ä'.repeat(256);
  assert.equal(validateRecord(row).name, row.name);
  row.name += 'Ä'; rejects(() => validateRecord(row), 'STRING');
  for (const name of ['', ' ', '\nsecret', '\ud800']) {
    const bad = record(); bad.name = name; assert.throws(() => validateRecord(bad));
  }
  for (const field of ['categoryId', 'expansionId', 'metacardId']) {
    const bad = record(); bad[field] = 52; rejects(() => validateRecord(bad), 'PRODUCT_ID');
  }
  const extra = record(); extra.ownerUid = 'not-market-data'; rejects(() => validateRecord(extra), 'FIELDS');
});

test('pages have fixed 200-record windows, sorted numeric IDs and complete counts', () => {
  const input = Array.from({ length: 201 }, (_, index) => record(String(201 - index)));
  const { manifest, pages } = snapshot(input);
  assert.deepEqual(manifest.pages.map(({ index, count }) => [index, count]), [[0, 200], [1, 1]]);
  assert.equal(manifest.totalItems, 201);
  assert.equal(pages[0].records[8].productId, '9');
  assert.equal(pages[0].records[9].productId, '10');
  assert.equal(pages[1].records[0].productId, '201');
  assert.equal(input[0].productId, '201');
  assert.deepEqual(validateSnapshot(manifest, pages), { manifest, pages });
});

test('duplicate IDs reject the entire new snapshot even for identical rows', () => {
  rejects(() => snapshot([record(), record()]), 'DUPLICATE_PRODUCT');
  const conflict = record(); conflict.normal.trend = '999';
  rejects(() => snapshot([record(), conflict]), 'DUPLICATE_PRODUCT');
  const bad = record('42'); bad.reverse.trend = '-1';
  rejects(() => snapshot([record(), bad]), 'MINOR');
  rejects(() => snapshot([]), 'INTEGER');
  rejects(() => snapshot(Array(LIMITS.snapshotItems + 1).fill(record())), 'INTEGER');
});

test('generation binds manifest and generation-free page bytes without a cycle', () => {
  const { manifest, pages } = snapshot();
  const { generation, ...manifestBody } = manifest;
  assert.equal(generation, digest(manifestBody));
  const { generation: pageGeneration, ...payload } = pages[0];
  assert.equal(pageGeneration, generation);
  assert.equal(manifest.pages[0].sha256, digest(payload));
  assert.equal(manifest.pages[0].bytes, encodeBoundedJson(payload).length);
  assert.notEqual(digest(pages[0]), manifest.pages[0].sha256);
  assert.equal(snapshot([record()]).manifest.generation, generation);
});

test('unknown schema/source/currency or manifest URL never passes validation', () => {
  for (const [field, value] of [['schema', 2], ['source', 'CLIENT'], ['source', 'CARDMARKET'], ['currency', 'USD'], ['kind', 'history']]) {
    const manifest = copy(snapshot().manifest); manifest[field] = value;
    rejects(() => validateManifest(manifest), 'HEADER');
  }
  const manifest = copy(snapshot().manifest); manifest.pages[0].url = 'https://untrusted.invalid/page';
  rejects(() => validateManifest(manifest), 'FIELDS');
});

test('manifest corruption, counters, digest and byte declarations fail closed', () => {
  for (const mutate of [
    (m) => { m.generation = '0'.repeat(64); },
    (m) => { m.pages[0].sha256 = '0'.repeat(64); },
    (m) => { m.pages[0].bytes++; },
    (m) => { m.totalItems++; },
    (m) => { m.pageSize = 201; },
    (m) => { m.pages[0].index = 1; },
    (m) => { m.pages[0].count = 0; },
    (m) => { m.pages[0].bytes = LIMITS.pageBytes + 1; },
  ]) {
    const manifest = copy(snapshot().manifest); mutate(manifest);
    assert.throws(() => validateManifest(manifest));
  }
});

test('a valid page from another generation cannot be mixed into the current manifest', () => {
  const first = snapshot();
  const changed = record(); changed.reverse.trend = '910';
  const second = snapshot([changed]);
  assert.notEqual(first.manifest.generation, second.manifest.generation);
  rejects(() => validatePage(second.pages[0], first.manifest), 'PAGE_GENERATION');
  const forged = copy(second.pages[0]); forged.generation = first.manifest.generation;
  rejects(() => validatePage(forged, first.manifest), 'PAGE_DIGEST');
});

test('source times, IDs, fields, page positions and counts are inside page integrity', () => {
  const original = snapshot();
  for (const mutate of [
    (p) => { p.sourceTimestamp = '2026-10-04T01:00:00Z'; },
    (p) => { p.catalogSourceTimestamp = '2026-10-04T01:00:00Z'; },
    (p) => { p.records[0].productId = '42'; },
    (p) => { p.records[0].normal.average = '303'; },
    (p) => { p.index = 1; },
    (p) => { p.totalItems = 2; },
    (p) => { p.records.push(record('42')); },
  ]) {
    const page = copy(original.pages[0]); mutate(page);
    assert.throws(() => validatePage(page, original.manifest));
  }
});

test('even internally hashed pages cannot repeat an ID across a page boundary', () => {
  const { manifest, pages } = snapshot(Array.from({ length: 201 }, (_, i) => record(String(i + 1))));
  pages[1].records[0].productId = '200';
  const { generation: ignoredPageGeneration, ...payload } = pages[1];
  manifest.pages[1].sha256 = digest(payload);
  manifest.pages[1].bytes = encodeBoundedJson(payload).length;
  const { generation: ignoredGeneration, ...body } = manifest;
  manifest.generation = digest(body);
  pages.forEach((page) => { page.generation = manifest.generation; });
  assert.equal(validatePage(pages[1], manifest).records[0].productId, '200');
  rejects(() => validateSnapshot(manifest, pages), 'PRODUCT_ORDER');
});

test('complete snapshot validation rejects sparse missing pages even when array length matches', () => {
  const one = snapshot();
  rejects(() => validateSnapshot(one.manifest, Array(1)), 'PAGE_COUNT');
  const two = snapshot(Array.from({ length: 201 }, (_, i) => record(String(i + 1))));
  for (const index of [0, 1]) {
    const pages = copy(two.pages); delete pages[index];
    rejects(() => validateSnapshot(two.manifest, pages), 'PAGE_COUNT');
  }
  const getter = [];
  Object.defineProperty(getter, 0, { enumerable: true, get: () => { throw Error('must not execute'); } });
  rejects(() => validateSnapshot(one.manifest, getter), 'PAGE_COUNT');
});

test('mutating provider inputs or validator copies cannot alter a built snapshot', () => {
  const input = record();
  const result = snapshot([input]);
  const checked = validatePage(result.pages[0], result.manifest);
  input.normal.trend = '777'; checked.records[0].reverse.trend = '888';
  assert.equal(result.pages[0].records[0].normal.trend, '303');
  assert.equal(result.pages[0].records[0].reverse.trend, '909');
});

test('bounded JSON counts actual UTF8 bytes and rejects oversized bodies before parsing', () => {
  const bytes = encodeBoundedJson({ x: 'Ä' });
  assert.equal(bytes.length, 10);
  assert.deepEqual(parseBoundedJson(bytes, 10), { x: 'Ä' });
  rejects(() => parseBoundedJson(bytes, 9), 'BODY_LIMIT');
  rejects(() => encodeBoundedJson({ x: 'Ä' }, 9), 'BODY_LIMIT');
  rejects(() => parseBoundedJson(Buffer.alloc(LIMITS.pageBytes + 1, 32)), 'BODY_LIMIT');
  rejects(() => encodeBoundedJson({ x: 'x'.repeat(LIMITS.pageBytes) }), 'BODY_LIMIT');
});

test('wire rejects duplicate keys, invalid UTF8, unsafe JSON numbers and noncanonical bytes', () => {
  for (const text of ['{"a":1,"a":2}', '{ "a":1}', '{"b":1,"a":2}', '{"x":1e3}', '{"x":-0}']) {
    assert.throws(() => parseBoundedJson(Buffer.from(text)));
  }
  rejects(() => parseBoundedJson(Buffer.from([0xff])), 'JSON');
  rejects(() => parseBoundedJson(Buffer.from('\ufeff{}')), 'JSON');
  rejects(() => parseBoundedJson(Buffer.from('{"x":9007199254740993}')), 'JSON_NUMBER');
  let deep = null; for (let i = 0; i < 18; i++) deep = [deep];
  rejects(() => encodeBoundedJson(deep), 'JSON_DEPTH');
  rejects(() => encodeBoundedJson({ x: undefined }), 'JSON_VALUE');
  rejects(() => encodeBoundedJson(Array(2)), 'JSON_ARRAY');
  const sparse = Array(2); sparse[1] = 1; sparse.extra = 2;
  rejects(() => encodeBoundedJson(sparse), 'JSON_ARRAY');
});

test('ID requests require an exact generation, bounded unique IDs and schema', () => {
  const gen = snapshot().manifest.generation;
  const request = { schema: 1, generation: gen, productIds: Array.from({ length: 100 }, (_, i) => String(i + 1)) };
  assert.deepEqual(validateIdRequest(request, gen), request);
  for (const productIds of [[], ['1', '1'], ['0'], [1], [...request.productIds, '101']]) {
    assert.throws(() => validateIdRequest({ ...request, productIds }, gen));
  }
  rejects(() => validateIdRequest(request, '0'.repeat(64)), 'REQUEST_GENERATION');
  rejects(() => validateIdRequest({ ...request, schema: 2 }, gen), 'REQUEST_GENERATION');
  rejects(() => validateIdRequest({ ...request, name: 'not-an-ID' }, gen), 'FIELDS');
});

test('strong ETag hashes exact representation bytes and changes with any value', () => {
  const bytes = encodeBoundedJson(snapshot().pages[0]);
  const etag = etagForBytes(bytes);
  assert.match(etag, /^"sha256-[a-f0-9]{64}"$/);
  assert.equal(etag, etagForBytes(Buffer.from(bytes)));
  const changed = record(); changed.normal.low = null;
  assert.notEqual(etag, etagForBytes(encodeBoundedJson(snapshot([changed]).pages[0])));
  rejects(() => etagForBytes(Buffer.alloc(LIMITS.pageBytes + 1)), 'BODY_LIMIT');
});

test('GET conditional matching handles weak tags, lists and wildcard without write semantics', () => {
  const etag = etagForBytes(encodeBoundedJson(snapshot().pages[0]));
  assert.equal(matchesIfNoneMatch(null, etag), false);
  assert.equal(matchesIfNoneMatch(undefined, etag), false);
  assert.equal(matchesIfNoneMatch('"not-current"', etag), false);
  for (const value of [etag, `W/${etag}`, '*', `"left,right", W/${etag}`, ` ${etag} , "other" `]) {
    assert.equal(matchesIfNoneMatch(value, etag), true);
  }
});

test('malformed conditional headers never manufacture a successful not-modified result', () => {
  const etag = etagForBytes(encodeBoundedJson(snapshot().pages[0]));
  for (const value of ['', ' ', `${etag},`, `*,${etag}`, '*\r\n', '\n*', `${etag}\r\nX:bad`, 'W/no-quotes',
    `${etag} garbage`, Array(17).fill('"a"').join(','), 'a'.repeat(1025), [etag]]) {
    rejects(() => matchesIfNoneMatch(value, etag), 'ETAG_HEADER');
  }
  rejects(() => matchesIfNoneMatch('*', 'bad-etag'), 'ETAG');
  rejects(() => matchesIfNoneMatch('*', `${etag}\n`), 'ETAG');
});
