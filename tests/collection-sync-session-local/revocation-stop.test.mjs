// Controlled local Node children only: no Android, SDK, emulator or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChild } from '../private-operations-local/safety.mjs';
import { REVOCATION, REVOCATION_CLASS, assertRevocationMayCreate } from './revocation.mjs';

const start = 'INSTRUMENTATION_STATUS: class=' + REVOCATION_CLASS + '\n' +
  'INSTRUMENTATION_STATUS: test=' + REVOCATION.method + '\n' +
  'INSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: 1\n';

for (const scenario of [
  { name: 'SIGINT', signal: 'SIGINT', reason: 'interrupted' },
  { name: 'SIGTERM', signal: 'SIGTERM', reason: 'interrupted' },
  { name: 'timeout', timeout: true, reason: 'timeout' },
  { name: 'output handler', handlerThrows: true, reason: 'output-handler-failed' },
  { name: 'output limit', outputLimit: true, reason: 'output-limit' },
  { name: 'throwing stop observer', handlerThrows: true, observerThrows: true, reason: 'output-handler-failed' },
]) {
  void test('child stop synchronously forbids a deferred create: ' + scenario.name, { timeout: 15_000 }, async () => {
    const lifecycle = { running: true, cancelled: false, output: start };
    let releaseAdmin; const adminRead = new Promise(resolve => { releaseAdmin = resolve; });
    let createCalls = 0; let continuationRunning = null;
    const continuation = adminRead.then(() => {
      continuationRunning = lifecycle.running;
      assertRevocationMayCreate(lifecycle); createCalls++;
    }).then(() => null, error => error);
    let observedStop = null; let stopCalls = 0; let runningAtStop = null; let settledAtStop = null;
    let settled = false; let ready = ''; let actionSent = false;
    const source = scenario.outputLimit
      ? "process.stdout.write(Buffer.alloc(17 * 1024 * 1024, 'x')); setInterval(() => {}, 1000);"
      : "process.stdout.write('ready\\n'); setInterval(() => {}, 1000);";
    const result = await runChild(process.execPath, ['-e', source], {
      cwd: process.cwd(), env: { ...process.env }, timeoutMs: scenario.timeout ? 100 : 5_000,
      onStop: reason => {
        stopCalls++; observedStop = reason; runningAtStop = lifecycle.running; settledAtStop = settled;
        lifecycle.cancelled = true; releaseAdmin();
        if (scenario.observerThrows) throw Error('Deliberate observer failure must not prevent termination');
      },
      onOutput: chunk => {
        if (scenario.timeout || scenario.outputLimit || actionSent) return;
        ready += String(chunk);
        if (!ready.includes('ready\n')) return;
        actionSent = true;
        if (scenario.signal) process.emit(scenario.signal);
        if (scenario.handlerThrows) throw Error('Deliberate output-handler failure');
      },
    }).then(value => { settled = true; lifecycle.running = false; return value; });
    assert.equal(result.code, 1); assert.equal(result.stopped, scenario.reason);
    assert.equal(observedStop, scenario.reason); assert.equal(stopCalls, 1);
    assert.equal(runningAtStop, true); assert.equal(settledAtStop, false);
    const continuationError = await continuation;
    assert.ok(continuationError instanceof assert.AssertionError);
    assert.equal(continuationRunning, true, 'The awaited read resumed in the stop-to-close window');
    assert.equal(createCalls, 0); assert.equal(lifecycle.cancelled, true);
  });
}
void test('omitting the stop observer preserves a normally completed child result', { timeout: 10_000 }, async () => {
  let output = '';
  const result = await runChild(process.execPath, ['-e', "process.stdout.write('unchanged\\n');"], {
    cwd: process.cwd(), env: { ...process.env }, timeoutMs: 5_000, onOutput: chunk => { output += String(chunk); },
  });
  assert.deepEqual(result, { code: 0, signal: null, stopped: null, error: null });
  assert.equal(output, 'unchanged\n');
});
