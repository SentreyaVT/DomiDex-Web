// Preserve the verified production runtime; apply only the approved binder patch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
const [stage, output] = process.argv.slice(2);
assert(stage && output, 'Usage: patch <scanner-publication stage> <new overlay>');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
const root = path.join(stage, 'runtime/app/dist');
const originals = new Map(walk(root).map((p) => [path.relative(root, p).replaceAll('\\', '/'), fs.readFileSync(p)]));
const previous = path.join(stage, 'release/overlay');
const previousPatch = JSON.parse(fs.readFileSync(path.join(previous, 'scanner-publication-patch.json')));
for (const item of previousPatch.files) {
  const bytes = fs.readFileSync(path.join(previous, item.path));
  assert.equal(hash(bytes), item.sha256, 'Existing scanner guard must match');
  originals.set(item.path, bytes);
}
const changed = new Map();
function verified(p, digest) { const bytes = originals.get(p); assert.equal(hash(bytes), digest, `Unknown runtime: ${p}`); return bytes.toString('utf8'); }
function once(source, before, after) { assert.equal(source.split(before).length - 1, 1, `Known replacement: ${before}`); return source.replace(before, after); }
function functionText(source, name) { const start = source.indexOf(`function ${name}(`); assert(start >= 0); const end = source.indexOf('function ', start + 1); assert(end > start); return source.slice(start, end); }
function checkComponent(source) {
  const code = functionText(source, 'ke');
  assert(!code.includes('turn:') && !code.includes('!!C') && !code.includes('!!x'));
  const state = []; let cursor = 0;
  const slots = Array.from({ length: 10 }, (_, i) => ({ slotId: `test-${i}`, owned: [], card: { id: `test-${i}`, name: `Card ${i}` } }));
  const jsx = (type, props) => ({ type, props });
  const context = { F: { useState: (initial) => { const key = cursor++; if (!(key in state)) state[key] = initial; return [state[key], (value) => { state[key] = value; }]; }, useEffect: () => {} },
    q: { jsx, jsxs: jsx, Fragment: 'fragment' }, ye: () => slots, xe: (items) => [items.slice(0, 8), items.slice(8)],
    $: () => '0,00 €', Z: 'empty', Ie: 'pocket', Pe: 'dialog', u: 'spinner', c: 'previous', s: 'next', i: 'spinner', D: 'previous', E: 'next' };
  const component = runInNewContext(`(${code})`, context);
  const render = () => { cursor = 0; return component({ binders: [{ name: 'Test', entries: [] }], prices: {}, user: { uid: 'test' }, onError: () => {} }); };
  function elements(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(elements); return [node, ...elements(node.props?.children)]; }
  const find = (tree, test) => { const result = elements(tree).find(test); assert(result, 'Expected binder element'); return result; };
  const button = (tree, name) => find(tree, (e) => e.props?.['aria-label'] === name);
  let tree = render(); find(tree, (e) => e.props?.className === 'binder-cover').props.onClick(); tree = render();
  assert.equal(button(tree, 'Vorherige Binderseite').props.disabled, true);
  assert.equal(button(tree, 'Nächste Binderseite').props.disabled, false);
  assert.equal(elements(tree).filter((e) => e.type === 'pocket').length, 8);
  button(tree, 'Nächste Binderseite').props.onClick(); tree = render();
  assert.equal(button(tree, 'Nächste Binderseite').props.disabled, true);
  assert.equal(button(tree, 'Vorherige Binderseite').props.disabled, false);
  assert.equal(elements(tree).filter((e) => e.type === 'pocket' && e.props.slot).length, 2);
  button(tree, 'Vorherige Binderseite').props.onClick(); tree = render();
  find(tree, (e) => e.type === 'pocket').props.onSelect(slots[0]); tree = render();
  assert.equal(find(tree, (e) => e.type === 'dialog').props.slot.slotId, 'test-0');
  find(tree, (e) => e.props?.className === 'close-binder').props.onClick();
  find(render(), (e) => e.props?.className === 'binder-cover');
}
const variants = [
  ['client/_next/static/chunks/web-app-wBJyCO5H.js', '87e5f9889f9dd875c6866b0ef5ce9d81f88c393286a8ae159e3fd66f4daa2a0d', [
    [',[C,w]=(0,F.useState)(null)', ''], ['m(null),w(null)', 'm(null)'],
    ['A=e=>{C||e<0||e>=D.length||(w({direction:e>o?`next`:`previous`,slots:O}),l(e))}', 'A=e=>{e<0||e>=D.length||l(e)}'],
    [',C&&(0,q.jsx)(Le,{turn:C,onFinish:()=>w(null)})', ''],
    ['disabled:o===0||!!C', 'disabled:o===0'], ['disabled:o>=D.length-1||!!C', 'disabled:o>=D.length-1'],
  ]],
  ['server/ssr/_next/static/web-app-DMB8JPzj.js', 'ec80cca100c1e1fb923d1d743f26b45c034a42b39c7345bde87cfcaa05ec1772', [
    [',[x,S]=(0,F.useState)(null)', ''], ['f(null),S(null)', 'f(null)'],
    ['A=e=>{x||e<0||e>=T.length||(S({direction:e>s?`next`:`previous`,slots:O}),c(e))}', 'A=e=>{e<0||e>=T.length||c(e)}'],
    [',x&&(0,q.jsx)(Le,{turn:x,onFinish:()=>S(null)})', ''],
    ['disabled:s===0||!!x', 'disabled:s===0'], ['disabled:s>=T.length-1||!!x', 'disabled:s>=T.length-1'],
  ]],
];
for (const [p, digest, replacements] of variants) {
  const original = verified(p, digest);
  let source = original;
  for (const [before, after] of replacements) source = once(source, before, after);
  source = once(source, functionText(source, 'Le'), '');
  assert.equal(original.replace(functionText(original, 'ke'), '').replace(functionText(original, 'Le'), ''), source.replace(functionText(source, 'ke'), ''), 'No non-binder function may change');
  assert(!source.includes('binder-turn-sheet'));
  checkComponent(source); changed.set(p, source);
}
const sourceCss = fs.readFileSync('app/globals.css', 'utf8');
const marker = '/* Open collection binder only:';
assert.equal(sourceCss.split(marker).length, 2);
const appendedCss = '\n' + sourceCss.slice(sourceCss.indexOf(marker));
assert.equal((appendedCss.match(/\.binder-view /g) || []).length, 8);
const cssFile = 'index.OLhSsBjw.css';
for (const p of ['client/_next/static/css/' + cssFile, 'server/_next/static/css/' + cssFile]) {
  const original = verified(p, '04c40648d947a79e6de0f1750729e7798d34798967b3f0b9fc25c444c2b6aa58');
  changed.set(p, original + appendedCss);
}
// New filenames prevent old immutable Hosting assets from masking the patch.
const rename = new Map([[path.basename(variants[0][0]), 'web-app-wBJyCO5H-bl1.js'], [cssFile, 'index.OLhSsBjw-bl1.css']]);
let added;
do {
  added = false;
  for (const [p, bytes] of originals) {
    if (!p.startsWith('client/') || !p.endsWith('.js') || rename.has(path.basename(p))) continue;
    if ([...rename.keys()].some((name) => bytes.toString('utf8').includes(name))) { rename.set(path.basename(p), path.basename(p).replace('.js', '-bl1.js')); added = true; }
  }
} while (added);
const report = [];
for (const [p, bytes] of originals) {
  if (!/\.(js|json|css)$/.test(p)) continue;
  let source = changed.get(p) ?? bytes.toString('utf8');
  for (const [before, after] of rename) source = source.replaceAll(before, after);
  if (source === bytes.toString('utf8')) continue;
  const destination = rename.has(path.basename(p)) && (p.startsWith('client/') || p.endsWith('.css')) ? p.slice(0, -path.basename(p).length) + rename.get(path.basename(p)) : p;
  const target = path.join(output, destination); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
  report.push({ path: destination, previousPath: p, sha256: hash(source) });
}
assert(!report.some((e) => e.path.includes('/route-') || e.path.includes('/firebase')));
const manifest = { baseImage: 'sha256:1499f7b1aaddbd7f78457d9073f60a1fd77004200f818a36f7b0332809e932e3', compiledChecks: 'passed', files: report };
fs.writeFileSync(path.join(output, 'binder-layout-patch.json'), JSON.stringify(manifest, null, 2));
console.log(`Both compiled binder components checked; ${report.length} overlay files; original CSS preserved with scoped append only.`);
