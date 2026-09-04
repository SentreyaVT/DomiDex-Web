// Render only the reviewed public React pages; never rebuild/replace the live app runtime.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = new Map();
function loadSource(relative) {
  const file = path.join(root, relative);
  if (cache.has(file)) return cache.get(file);
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = { exports: {} };
  const nativeRequire = createRequire(file);
  const requireSource = (id) => {
    if (id === '@/lib/legal-content') return loadSource('lib/legal-content.ts');
    if (id === './legal-page.css') return {};
    return nativeRequire(id);
  };
  // Only the two fixed, reviewed local source files are compiled; no request input.
  compileFunction(compiled, ['require', 'module', 'exports'], { filename: file })(requireSource, mod, mod.exports);
  cache.set(file, mod.exports);
  return mod.exports;
}
const { LegalPage } = loadSource('components/legal-page.tsx');
const { legalNavigation, legalContent } = loadSource('lib/legal-content.ts');
const out = path.join(root, '.domidex/legal-gate/hosting/legal');
fs.mkdirSync(out, { recursive: true });
const css = fs.readFileSync(path.join(root, 'components/legal-page.css'), 'utf8');
const files = [];
for (const item of legalNavigation) {
  const body = renderToStaticMarkup(React.createElement(LegalPage, { type: item.type }));
  const title = legalContent[item.type].title;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · DomiDex</title><link rel="canonical" href="https://domidex.web.app${item.href}"><link rel="icon" href="/favicon.jpg"><style>body{margin:0}${css}</style></head><body>${body}</body></html>`;
  const file = path.join(out, `${item.type}.html`);
  fs.writeFileSync(file, html);
  files.push({ route: item.href, path: `/legal/${item.type}.html`, sha256: createHash('sha256').update(html).digest('hex'), bytes: Buffer.byteLength(html) });
}
fs.writeFileSync(path.join(out, '../manifest.json'), JSON.stringify({ files }, null, 2));
console.log(JSON.stringify({ pages: files.length, scripts: 0, output: out }));
