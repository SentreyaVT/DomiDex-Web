import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// node tests/sharing-concurrency/run.mjs [repetitions 1..3; default 3]
// No .env, credentials, network, emulator, cloud deployment or application writes.
const repetitions = Number(process.argv[2] ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3 || process.argv.length > 3) {
  throw Error('Usage: node tests/sharing-concurrency/run.mjs [repetitions 1..3]');
}
const env = { NODE_ENV: 'test', CI: '1', NO_COLOR: '1', DOMIDEX_SHARING_SCALE_ISOLATED: '1',
  DOMIDEX_SHARING_CONCURRENCY_REPETITIONS: String(repetitions) };
for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) {
  if (process.env[name]) env[name] = process.env[name];
}
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url)),
  'run', '--config', fileURLToPath(new URL('./isolated.config.mjs', import.meta.url)), '--reporter=verbose'],
{ cwd: fileURLToPath(new URL('../../', import.meta.url)), env, encoding: 'utf8', windowsHide: true,
  timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(output);
const directory = fileURLToPath(new URL('../../outputs/sharing-concurrency/', import.meta.url));
mkdirSync(directory, { recursive: true });
const report = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.log`);
writeFileSync(report, output, { encoding: 'utf8', flag: 'wx' });
console.log(`Saved isolated concurrency log: ${report}`);
const rows = output.split(/\r?\n/).filter((line) => line.startsWith('SHARING_CONCURRENCY_SIMULATION '))
  .map((line) => JSON.parse(line.slice('SHARING_CONCURRENCY_SIMULATION '.length)));
const metricsPath = report.replace(/\.log$/, '.metrics.json');
writeFileSync(metricsPath, JSON.stringify({ simulationOnly: true, repetitions,
  providerDelayMs: 2, processScope: 'Vitest worker including fixtures, repeated cold-module loads, cache and GC',
  cloudLatencyOrBillingMeasured: false, testExitCode: result.status, batches: rows }, null, 2), { encoding: 'utf8', flag: 'wx' });
console.log(`Saved structured simulation metrics: ${metricsPath}`);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
