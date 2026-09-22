// Apply only the reviewed source-equivalent scanner publication fix to the
// verified production runtime. Do not rebuild unrelated local UI/auth changes.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const root = process.argv[2];
const output = process.argv[3];
assert(root && output, 'Usage: patch <verified dist directory> <new overlay directory>');
const reason = 'Veröffentlichung gesperrt: Die automatische Prüfung mit der echten Scanner-Engine ist noch nicht angebunden. Entwürfe und Fehlscan-Reviews können weiterhin gespeichert werden.';
const explanation = `${reason} „Testing“ und „Candidate“ sind nur Bearbeitungsstände, keine bestandenen Tests.`;
function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]);
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
const originals = new Map(filesUnder(root).map((path) => [relative(root, path).replaceAll('\\', '/'), readFileSync(path)]));
const changed = new Map();
function verified(path, expected) {
  const bytes = originals.get(path);
  assert(bytes && hash(bytes) === expected, `Unknown production file: ${path}`);
  return bytes.toString('utf8');
}
function once(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `Expected one known replacement: ${before}`);
  return source.replace(before, after);
}
const clientPath = 'client/_next/static/chunks/scanner-lab-BouSWTFK.js';
const ssrPath = 'server/ssr/_next/static/scanner-lab-D3DaYT9a.js';
const routePath = 'server/_next/static/route-DH4u75ZK.js';
const client = verified(clientPath, '94b65af528a8e19c4ebb15061cdf2f7bfdd67b82aad0e0fab098cf4d70eb5489');
const ssr = verified(ssrPath, '0731b3b29eec038e3c5eb329de3ab3f5730f181f68f4d1b6c83fa3793a0f91d4');
let route = verified(routePath, '8cb41fa9930f223ece4f65d365d18a58a8ee4f8ced9b375cdee878135230fcb4');
route = once(route, 'if(!a.action)throw Error(`INVALID_ACTION`);', `if(!a.action)throw Error(\`INVALID_ACTION\`);if(a.action===\`publish\`||a.action===\`rollback\`)return Response.json({error:${JSON.stringify(reason)},code:\`SCANNER_BENCHMARK_NOT_CONNECTED\`},{status:409});`);
changed.set(routePath, route);
function patchLab(source) {
  source = once(source, '$=async(e,t)=>{V(!0),G(``),U(``);try{let n;', `$=async(e,t)=>{V(!0),G(\`\`),U(\`\`);try{if(e===\`publish\`||e===\`rollback\`){G(${JSON.stringify(reason)});return}let n;`);
  source = once(source, 'Production wirklich veröffentlichen? Es ist keine echte Scanner-Benchmark-Engine verbunden.', 'Dieses geprüfte Scannerprofil wirklich veröffentlichen?');
  source = once(source, 'U(r.warning||`Scannerprofil wurde versioniert gespeichert.`)', 'U(r.warning||(e===`saveDraft`?`Entwurf gespeichert. Das ist keine Veröffentlichung und kein Foto-Upload.`:`Profilstatus gespeichert. Es wurde kein automatischer Erkennungstest ausgeführt.`))');
  source = once(source, 'Kalibrierung und sichere Profilversionierung · keine Web-Scanner-Simulation', 'Fehlscan-Uploads findest du unter „Fehlscans“. Profilentwürfe werden separat gespeichert.');
  assert.equal(source.split('Draft speichern').length - 1, 2);
  source = source.replaceAll('Draft speichern', 'Entwurf speichern');
  source = once(source, '(0,M.jsx)(`div`,{className:`version-list`,', `(0,M.jsx)(\`p\`,{id:\`scanner-publication-block\`,children:${JSON.stringify(explanation)}}),(0,M.jsx)(\`div\`,{className:\`version-list\`,`);
  source = once(source, '{onClick:()=>void $(`markTesting`,e.documentId),children:`Als Testing`}', '{disabled:B,onClick:()=>void $(`markTesting`,e.documentId),children:`Für Prüfung vormerken`}');
  source = once(source, '{onClick:()=>void $(`createCandidate`,e.documentId),children:`Candidate erzeugen`}', '{disabled:B,onClick:()=>void $(`createCandidate`,e.documentId),children:`Candidate erzeugen`}');
  source = once(source, '{className:`danger`,onClick:()=>void $(`publish`,e.documentId),children:`Production veröffentlichen`}', '{className:`danger`,disabled:!0,"aria-describedby":`scanner-publication-block`,onClick:()=>void $(`publish`,e.documentId),children:`Veröffentlichen gesperrt`}');
  source = once(source, '{onClick:()=>void $(`rollback`,e.documentId),children:`Rollback als neue Version`}', '{disabled:!0,"aria-describedby":`scanner-publication-block`,onClick:()=>void $(`rollback`,e.documentId),children:`Rollback gesperrt`}');
  return source;
}
changed.set(clientPath, patchLab(client));
changed.set(ssrPath, patchLab(ssr));

async function verifyCompiledRoute() {
  const writes = [];
  let reads = 0, versions = [];
  const code = route.replace(/^import.*?;import.*?;/, '').replace('export{f as GET,p as POST};', 'globalThis.post=p;');
  assert(!code.includes('import{') && !code.includes('export{'));
  const context = {
    Response, Error, crypto: webcrypto,
    e: async () => ({ sub: 'test-admin' }),
    t: (collection, id, data) => ({ collection, id, data }),
    n: async () => { reads++; return null; },
    r: async () => { reads++; return versions; },
    i: async (value) => { writes.push(...value); },
  };
  runInNewContext(code, context);
  for (const action of ['publish', 'rollback']) {
    const response = await context.post(new Request('https://test.invalid/', { method: 'POST', headers: { authorization: 'Bearer test-only' }, body: JSON.stringify({ action, confirm: action.toUpperCase() }) }));
    assert.equal(response.status, 409); assert.equal((await response.json()).error, reason);
  }
  assert.equal(reads, 0); assert.equal(writes.length, 0);
  assert.equal((await context.post(new Request('https://test.invalid/', { method: 'POST', body: '{}' }))).status, 401);
  const profile = { profileId: 'test', name: 'Test', layoutFamily: 'EX', scope: { level: 'global' }, zones: [], confidenceThreshold: .85, tolerance: .15, analysisPaths: { frameAssisted: true }, status: 'production' };
  const response = await context.post(new Request('https://test.invalid/', { method: 'POST', headers: { authorization: 'Bearer test-only' }, body: JSON.stringify({ action: 'saveDraft', profile }) }));
  assert.equal(response.status, 200); const draft = (await response.json()).version;
  assert.equal(draft.status, 'draft'); assert(!writes.some((write) => write.collection === 'scannerReleaseManifest'));
  for (const [action, status] of [['markTesting', 'testing'], ['createCandidate', 'candidate']]) {
    versions = [{ ...draft, documentId: 'test-source', status: action === 'markTesting' ? 'draft' : 'testing' }];
    const result = await context.post(new Request('https://test.invalid/', { method: 'POST', headers: { authorization: 'Bearer test-only' }, body: JSON.stringify({ action, sourceDocumentId: 'test-source' }) }));
    assert.equal(result.status, 200); assert.equal((await result.json()).version.status, status);
  }
  assert(!writes.some((write) => write.collection === 'scannerReleaseManifest'));
}
async function verifyCompiledUi(source) {
  const begin = source.indexOf('$=async(e,t)=>');
  const end = source.indexOf(';return t?', begin);
  assert(begin >= 0 && end > begin);
  let calls = 0, message = '', error = '', working;
  const context = { V: (value) => { working = value; }, G: (value) => { error = value; }, U: (value) => { message = value; },
    P: { changelog: '' }, F: () => {}, Z: async () => {}, Y: async () => { calls++; return {}; },
    window: { confirm: () => { throw Error('Unexpected confirmation'); } },
  };
  const execute = runInNewContext(`(${source.slice(begin + 2, end)})`, context);
  for (const action of ['publish', 'rollback']) { await execute(action); assert.equal(error, reason); assert.equal(calls, 0); assert.equal(working, false); }
  await execute('saveDraft'); assert.equal(calls, 1); assert(message.startsWith('Entwurf gespeichert.')); assert.equal(working, false);
}

async function main() {
  await verifyCompiledRoute();
  await verifyCompiledUi(changed.get(clientPath));
  await verifyCompiledUi(changed.get(ssrPath));
  // Cache-bust the changed client chunk and every importing client chunk.
  // Cyclic imports get a stable suffix; no stylesheet or application logic changes.
  const rename = new Map([[basename(clientPath), basename(clientPath).replace('.js', '-sp1.js')]]);
  let added;
  do {
    added = false;
    for (const [path, bytes] of originals) {
      if (!path.startsWith('client/') || !path.endsWith('.js') || rename.has(basename(path))) continue;
      if ([...rename.keys()].some((name) => bytes.toString('utf8').includes(name))) {
        rename.set(basename(path), basename(path).replace('.js', '-sp1.js')); added = true;
      }
    }
  } while (added);
  const report = [];
  for (const [path, bytes] of originals) {
    if (!/\.(js|json)$/.test(path)) continue;
    let source = changed.get(path) ?? bytes.toString('utf8');
    for (const [before, after] of rename) source = source.replaceAll(before, after);
    if (source === bytes.toString('utf8')) continue;
    const destination = path.startsWith('client/') && rename.has(basename(path)) ? path.slice(0, -basename(path).length) + rename.get(basename(path)) : path;
    const target = join(output, destination);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, source);
    report.push({ path: destination, previousPath: path, sha256: hash(source) });
  }
  assert(report.some((item) => item.path === routePath));
  assert(report.every((item) => !item.path.endsWith('.css')));
  writeFileSync(join(output, 'scanner-publication-patch.json'), JSON.stringify({ baseImage: 'sha256:9ac06cf639ce1e31b23b4442998cb668c80c401089e7e8a536620b4ad5c48da0', compiledChecks: 'passed', files: report }, null, 2));
  console.log(`Compiled server and both UI guards verified; ${report.length} overlay files, ${rename.size} cache-busted client chunks; all stylesheets unchanged.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
