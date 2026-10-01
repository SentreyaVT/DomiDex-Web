// Copied byte-for-byte into the fresh run directory. Firebase invokes only the
// fixed literal `node execute.mjs`; paths never become interpolated shell text.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.DOMIDEX_PRIVATE_TEST_ROOT;
const directory = process.env.DOMIDEX_PRIVATE_TEST_RUN;
if (!root || !directory || path.resolve(directory) !== process.cwd()) throw Error('Runner context required.');
const { assertTestEnvironment, runChild, requireFile } = await import(pathToFileURL(path.join(root, 'tests/private-operations-local/safety.mjs')));
// CLI adds an unused FIREBASE_CONFIG (including a database URL). The SDK test
// supplies its fixed demo project explicitly; never pass that config onward.
const env = { ...process.env };
delete env.FIREBASE_CONFIG;
assertTestEnvironment(env);
const result = await runChild(process.execPath, [requireFile(path.join(root, 'node_modules/vitest/vitest.mjs')), 'run',
  '--config', requireFile(path.join(root, 'tests/private-operations-local/config.mjs')),
  '--reporter=default', '--reporter=json', '--outputFile', path.join(directory, 'vitest-results.json')],
{ cwd: root, env, timeoutMs: 180_000, onOutput: (chunk) => process.stdout.write(chunk) });
if (result.stopped || result.error) console.error(`Test child failed: ${result.stopped ?? result.error}`);
process.exitCode = result.code;
