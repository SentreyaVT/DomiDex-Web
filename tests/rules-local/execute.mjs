// Copied unchanged to the isolated run directory. Never interpolate a source path
// into Firebase's shell command: the sole command remains `node execute.mjs`.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.DOMIDEX_PRIVATE_TEST_ROOT;
const directory = process.env.DOMIDEX_PRIVATE_TEST_RUN;
const androidRoot = process.env.DOMIDEX_RULES_ANDROID_ROOT;
if (!root || !directory || !androidRoot || path.resolve(directory) !== process.cwd() || !path.isAbsolute(androidRoot)) {
  throw Error('Isolated Rules runner context required.');
}
const { assertTestEnvironment, runChild, requireFile } = await import(pathToFileURL(path.join(root, 'tests/private-operations-local/safety.mjs')));
const { RULE_TESTS } = await import(pathToFileURL(path.join(root, 'tests/rules-local/run.mjs')));
const env = { ...process.env };
delete env.FIREBASE_CONFIG;
assertTestEnvironment(env, 'rules');
const result = await runChild(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap',
  `--test-reporter-destination=${path.join(directory, 'rules.tap')}`,
  ...RULE_TESTS.map(name => requireFile(path.join(androidRoot, name)))],
{ cwd: androidRoot, env, timeoutMs: 180_000, onOutput: chunk => process.stdout.write(chunk) });
if (result.stopped || result.error) console.error(`Rules child failed: ${result.stopped ?? result.error}`);
process.exitCode = result.code;
