import { readFile } from 'node:fs/promises';

const routes = ['datenschutz', 'impressum', 'kontakt', 'konto-loeschen', 'pre-beta'];
const firebase = JSON.parse(await readFile('firebase.json', 'utf8'));
const hosting = Array.isArray(firebase.hosting) ? firebase.hosting : [firebase.hosting];
for (const host of hosting) {
  if (host.rewrites?.some((rule) => routes.some((route) => String(rule.source || rule.regex || '').includes(route)))) {
    throw new Error('LEGAL_RELEASE_DIVERGENCE: legal pages must be served by the same application revision');
  }
}
for (const route of routes) {
  const source = await readFile(`app/${route}/page.tsx`, 'utf8');
  if (!source.includes('@/components/legal-page') || !source.includes(`type="${route}"`)) {
    throw new Error(`LEGAL_ROUTE_DIVERGENCE:${route}`);
  }
}
const source = await readFile('lib/legal-content.ts', 'utf8');
if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(source)) throw new Error('PUBLIC_LOCALHOST_LINK');
console.log('Legal routes use the current application source and the same Hosting release.');
