import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Actual local handler + real reducer, SDK-boundary doubles. No .env or credentials.
if (process.argv.length !== 2) throw Error('Usage: node tests/knowledge-concurrency/run.mjs');
const env = { NODE_ENV: 'test', CI: '1', NO_COLOR: '1', DOMIDEX_SHARING_SCALE_ISOLATED: '1' };
for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) {
  if (process.env[name]) env[name] = process.env[name];
}
const preload = fileURLToPath(new URL('../release-local/network-preload.cjs', import.meta.url)).replaceAll('\\', '/');
env.NODE_OPTIONS = `--require ${JSON.stringify(preload)}`;
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url)),
  'run', '--config', fileURLToPath(new URL('./isolated.config.mjs', import.meta.url)), '--reporter=verbose'],
{ cwd: fileURLToPath(new URL('../../', import.meta.url)), env, encoding: 'utf8', windowsHide: true,
  timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(output);
const directory = fileURLToPath(new URL('../../outputs/knowledge-concurrency/', import.meta.url));
mkdirSync(directory, { recursive: true });
const report = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.log`);
writeFileSync(report, output, { encoding: 'utf8', flag: 'wx' });
const metrics = output.split(/\r?\n/).filter(line => line.startsWith('KNOWLEDGE_CONCURRENCY_SIMULATION '))
  .map(line => JSON.parse(line.slice('KNOWLEDGE_CONCURRENCY_SIMULATION '.length)));
writeFileSync(report.replace(/\.log$/, '.metrics.json'), JSON.stringify({ simulationOnly: true,
  realFirestoreSdkTransactions: false, cloudLatencyOrBillingMeasured: false,
  model: 'deterministic optimistic conflict/retry simulation without backoff',
  testExitCode: result.status, batches: metrics }, null, 2), { encoding: 'utf8', flag: 'wx' });
console.log(`Saved offline Knowledge simulation: ${report}`);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
