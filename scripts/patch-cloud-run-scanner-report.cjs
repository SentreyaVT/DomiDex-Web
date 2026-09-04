// Emergency publication: retain the verified runtime and all frontend assets.
// The source equivalent remains in lib/server/firestore-rest.ts.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const directory = process.argv[2] || '/app/dist/server';
function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

// Match only the existing setWrite helper, including its create-only semantics.
const pattern = /function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)=!1\)\{return\{update:\{name:`\$\{([\w$]+)\}\/\$\{\2\}\/\$\{\3\}`,fields:([\w$]+)\(\4\)\},\.\.\.\5\?\{currentDocument:\{exists:!1\}\}:\{\}\}\}/g;
const matches = [];
for (const path of filesUnder(directory).filter((path) => path.endsWith('.js'))) {
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(pattern)) matches.push({ path, source, match });
}
assert.equal(matches.length, 1, 'Expected exactly one known Firestore write helper; refusing an unknown runtime');
const { path, source, match } = matches[0];
const [before, functionName, , , , , rootName, encoderName] = match;
const after = before.replace('`,fields:', '`.replace("https://firestore.googleapis.com/v1/",""),fields:');
assert.notEqual(before, after);

const root = 'https://firestore.googleapis.com/v1/projects/cardvault-715ac/databases/(default)/documents';
for (const createOnly of [undefined, false, true]) {
  const sandbox = { [rootName]: root, [encoderName]: (value) => value };
  const originalWrite = runInNewContext(`(${before})`, sandbox)('scannerReports', 'regression-test', { schemaVersion: 1 }, createOnly);
  const patchedWrite = runInNewContext(`(${after})`, sandbox)('scannerReports', 'regression-test', { schemaVersion: 1 }, createOnly);
  const expected = JSON.parse(JSON.stringify(originalWrite));
  expected.update.name = 'projects/cardvault-715ac/databases/(default)/documents/scannerReports/regression-test';
  assert.deepEqual(JSON.parse(JSON.stringify(patchedWrite)), expected);
}

// Only the function above changes; CSS, client bundles, auth and manifests stay intact.
writeFileSync(path, source.slice(0, match.index) + after + source.slice(match.index + before.length));
console.log(`Patched one Firestore write helper (${functionName}); all three compiled-helper regression checks passed.`);
