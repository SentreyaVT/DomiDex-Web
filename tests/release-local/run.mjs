import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { unitFiles, unitEnvironment } from './selection.mjs';

if (process.argv.length !== 2) throw Error('Usage: node tests/release-local/run.mjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const files = unitFiles(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts);
const env = unitEnvironment(process.env, fileURLToPath(new URL('./network-preload.cjs', import.meta.url)));
const directory = path.join(root, 'outputs/release-local');
mkdirSync(directory, { recursive: true });
const report = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
  '--config', fileURLToPath(new URL('./config.mjs', import.meta.url)), ...files,
  '--reporter=default', '--reporter=json', '--outputFile', `${report}.json`],
{ cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
writeFileSync(`${report}.log`, output, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(output);
console.log(`Saved isolated unit regression: ${report}.{json,log}`);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
