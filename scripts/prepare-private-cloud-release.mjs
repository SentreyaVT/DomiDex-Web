import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = process.cwd();
const runtime = path.join(root, '.domidex/scanner-publication-20260903/runtime/app/dist');
const release = path.join(root, '.domidex/security-gate/release');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const expected = {
  'route-CBKHjOu2.js': '6008c67d1cc9bd23a0a2279a0a17e8011571582ec931bc0cbff232c575c1abea',
  'route-B8adPCsW.js': 'f8c6a984e468996d5d82627fda4a44d78fa92ad83161d88d0e60fd03da33f8da',
  'route-DLEjaR7C.js': '6fb779a4e8350e9d26f63af4ef087dc3dfa336627d52e47e85e77dc4a623f3a3',
};
const manifest = [];
for (const [name, originalHash] of Object.entries(expected)) {
  const relative = `server/_next/static/${name}`;
  const original = fs.readFileSync(path.join(runtime, relative), 'utf8');
  assert.equal(hash(original), originalHash, `Unknown deployed route: ${name}`);
  let modified;
  if (name === 'route-CBKHjOu2.js') modified = "import { uploadReport } from '/app/backend/security/routes.mjs';\nexport async function POST(request) { return uploadReport(request); }\n";
  else if (name === 'route-B8adPCsW.js') modified = "export { readReportImage as GET } from '/app/backend/security/routes.mjs';\n";
  else {
    modified = original;
    for (const [functionName, delegate] of [['Se', 'deletionStatus'], ['Ce', 'deletionRequest']]) {
      const needle = `async function ${functionName}(e){`;
      assert.equal(modified.split(needle).length - 1, 1);
      modified = modified.replace(needle, `${needle}if(new URL(e.url).searchParams.get('action')==='delete-account')return(await import('/app/backend/security/routes.mjs')).${delegate}(e);`);
    }
  }
  const destination = path.join(release, 'overlay', relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, modified);
  manifest.push({ path: relative, before: originalHash, after: hash(modified) });
}
for (const directory of ['security', 'scan-knowledge']) {
  const out = path.join(release, 'backend', directory);
  fs.mkdirSync(out, { recursive: true });
  const allow = directory === 'security' ? ['package.json', 'package-lock.json', 'firebase.mjs', 'images.mjs', 'deletion.mjs', 'routes.mjs'] : ['package.json', 'knowledge-aggregate.js'];
  for (const name of allow) {
    let source = fs.readFileSync(path.join(root, 'backend', directory, name), 'utf8');
    if (name === 'images.mjs') source = source.replace("'../../lib/scanner-report.ts'", "'./scanner-report.mjs'");
    fs.writeFileSync(path.join(out, name), source);
  }
}
const normalizer = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/scanner-report.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
fs.writeFileSync(path.join(release, 'backend/security/scanner-report.mjs'), normalizer);
fs.writeFileSync(path.join(release, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.copyFileSync(path.join(root, 'Dockerfile.private-cloud'), path.join(release, 'Dockerfile'));
fs.copyFileSync(path.join(root, 'cloudbuild.private-cloud.yaml'), path.join(release, 'cloudbuild.yaml'));
fs.copyFileSync(path.join(root, 'scripts/verify-private-cloud-base.mjs'), path.join(release, 'verify-base.mjs'));
console.log(JSON.stringify({ serverRoutes: manifest.length, clientAssetsChanged: 0, cssChanged: 0, release }));
