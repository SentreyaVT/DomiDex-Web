import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run: node tests/sharing-scale/run.mjs [repetitions 1..10; default 3]
// No cloud, emulators, application env files, credentials or production writes.
const repetitions = Number(process.argv[2] ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10 || process.argv.length > 3) {
  throw Error('Usage: node tests/sharing-scale/run.mjs [repetitions 1..10]');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const env = { NODE_ENV: 'test', CI: '1', NO_COLOR: '1',
  DOMIDEX_SHARING_SCALE_ISOLATED: '1', DOMIDEX_SHARING_SCALE_REPETITIONS: String(repetitions) };
for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) {
  if (process.env[name]) env[name] = process.env[name];
}
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url)),
  'run', '--config', fileURLToPath(new URL('./isolated.config.mjs', import.meta.url)), '--reporter=verbose'],
{ cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 180_000 });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
