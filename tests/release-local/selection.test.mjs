import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitEnvironment, unitFiles, unitGroups } from './selection.mjs';

const scripts = () => Object.fromEntries(unitGroups.map((name) => [name,
  'vitest run --config vitest.config.ts tests/safe.test.ts tests/other.test.tsx']));
await test('unit selection deduplicates groups and includes the targeted regression suites', () => {
  const result = unitFiles(scripts());
  assert.equal(result.length, 19);
  assert.ok(result.includes('tests/collection-prices-incremental.test.ts'));
  assert.ok(result.includes('tests/account-deletion-session.test.tsx'));
  assert.ok(result.includes('tests/shared-binder-price-parity.test.mjs'));
  assert.ok(result.includes('tests/shared-binder-catalog-parity.test.mjs'));
  assert.ok(result.includes('tests/shared-binder-placement-projection.test.mjs'));
  assert.ok(result.includes('tests/shared-binder-request-abort.test.mjs'));
  assert.ok(result.includes('tests/printing-descriptor-parity.test.mjs'));
  assert.ok(result.includes('tests/composed-printing-markers.test.mjs'));
  assert.ok(result.includes('tests/private-sync-time-anchor.test.mjs'));
  assert.ok(result.includes('tests/private-sync-time-anchor-route.test.ts'));
  assert.ok(result.includes('tests/read-rate-limit.test.mjs'));
  assert.ok(result.includes('tests/read-quota-deletion.test.mjs'));
  assert.deepEqual(result, [...result].sort());
});
for (const suffix of ['tests/firestore.rules.test.ts', 'tests/sync-emulator.test.ts',
  '../tests/outside.test.ts', 'tests/safe.test.ts;echo secret', 'tests/safe.test.ts --passWithNoTests', '',
  'tests/nested/unknown.test.ts']) await test(`rejects unapproved selection ${JSON.stringify(suffix)}`, () => {
  assert.throws(() => unitFiles({ ...scripts(), test: `vitest run --config vitest.config.ts ${suffix}` }));
});
await test('missing groups and arbitrary commands fail closed', () => {
  assert.throws(() => unitFiles({}));
  assert.throws(() => unitFiles({ ...scripts(), test: 'firebase deploy' }));
});
await test('child environment drops inherited credentials and execution options', () => {
  const result = unitEnvironment({ PATH: 'local-path', GOOGLE_APPLICATION_CREDENTIALS: 'do-not-copy',
    FIREBASE_TOKEN: 'do-not-copy', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'do-not-copy',
    NODE_OPTIONS: '--require=untrusted', HTTP_PROXY: 'do-not-copy', HOME: 'do-not-copy' }, 'C:/some path/guard.cjs');
  assert.deepEqual(result, { NODE_ENV: 'test', CI: '1', NO_COLOR: '1', DOMIDEX_RELEASE_LOCAL: '1',
    PATH: 'local-path', NODE_OPTIONS: '--require="C:/some path/guard.cjs"' });
  assert.throws(() => unitEnvironment({}, 'bad"path'));
  assert.equal(unitEnvironment({}, 'C:\\some path\\guard.cjs').NODE_OPTIONS, '--require="C:/some path/guard.cjs"');
});
