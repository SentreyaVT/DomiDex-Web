import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// Only explicitly listed local tests, no application .env or inherited credentials.
const env = { NODE_ENV: 'test', CI: '1', NO_COLOR: '1', DOMIDEX_SHARING_SCALE_ISOLATED: '1' };
for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) {
  if (process.env[name]) env[name] = process.env[name];
}
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url)),
  'run', '--config', fileURLToPath(new URL('./isolated.config.mjs', import.meta.url)), '--reporter=verbose'],
{ cwd: fileURLToPath(new URL('../../', import.meta.url)), env, encoding: 'utf8', windowsHide: true, timeout: 180_000,
  maxBuffer: 16 * 1024 * 1024 });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(output);
const directory = fileURLToPath(new URL('../../outputs/public-catalog-cache/', import.meta.url));
mkdirSync(directory, { recursive: true });
const report = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.log`);
writeFileSync(report, output, { encoding: 'utf8', flag: 'wx' });
console.log(`Saved isolated test log: ${report}`);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
