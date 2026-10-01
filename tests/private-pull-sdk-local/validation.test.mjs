import test from 'node:test';
import assert from 'node:assert/strict';
import { SERIAL, AVD, TEST_CLASS, TEST_NAMES, validateInstrumentation } from './run.mjs';

void test('Android driver pins the isolated emulator and exact test class', () => {
  assert.equal(SERIAL, 'emulator-5554');
  assert.equal(AVD, 'DomiDex_R27_Baseline_API36');
  assert.equal(TEST_CLASS, 'com.dominik.cardvault.data.sync.PrivatePullSdkCompletenessInstrumentedTest');
  assert.equal(Object.isFrozen(TEST_NAMES), true);
});
void test('instrumentation proof requires all three exact scenarios once and no failure or skip', () => {
  const status = (name, code) => `INSTRUMENTATION_STATUS: class=${TEST_CLASS}\nINSTRUMENTATION_STATUS: test=${name}\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
  const valid = TEST_NAMES.map(name => status(name, 1) + status(name, 0)).join('') + '\nOK (3 tests)\n\nINSTRUMENTATION_CODE: -1\n';
  assert.deepEqual(validateInstrumentation(valid), { passed: 3, names: [...TEST_NAMES] });
  assert.equal(validateInstrumentation(valid.replaceAll('\n', '\r\n')).passed, 3);
  for (const broken of ['', valid.replace('OK (3 tests)', 'OK (2 tests)'), valid.replace('INSTRUMENTATION_CODE: -1', ''),
    valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -3'), valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -4'),
    valid.replaceAll(TEST_NAMES[0], TEST_NAMES[1]), valid.replaceAll(TEST_CLASS, 'different.Test'),
    valid + 'INSTRUMENTATION_FAILED: Process crashed\n', valid.replace('STATUS_CODE: 0', 'STATUS_CODE: -2'),
    status(TEST_NAMES[0], 0) + valid]) assert.throws(() => validateInstrumentation(broken));
});
