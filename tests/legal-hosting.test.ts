import { describe, expect, it } from 'vitest';
// Standalone deployment helper: no production API calls when imported.
import { legalHostingPlan } from '../scripts/publish-legal-pages.mjs';

const pages = ['datenschutz', 'kontakt', 'impressum', 'konto-loeschen', 'pre-beta'].map((route) => ({ route: `/${route}`, path: `/legal/${route}.html`, hash: route }));
const config = { rewrites: [{ glob: '**', run: { serviceId: 'domidex-web', region: 'europe-west1', tag: 'existing-pinned-revision' } }], headers: [{ glob: '/existing', headers: { 'X-Existing': 'keep' } }] };
describe('Legal-only hosting publication safety', () => {
  it('preserves existing asset hashes, runtime tag and existing headers without mutating input', () => {
    const before = JSON.stringify(config);
    const plan = legalHostingPlan(config, [{ path: '/assets/existing.css', hash: 'unchanged' }], pages);
    expect(plan.files['/assets/existing.css']).toBe('unchanged');
    expect(plan.config.rewrites.slice(5)).toEqual(config.rewrites);
    expect(plan.config.headers[0]).toEqual(config.headers[0]);
    expect(JSON.stringify(config)).toBe(before);
    expect(plan.config.rewrites[0]).toEqual({ regex: '^/datenschutz/?$', path: '/legal/datenschutz.html' });
  });
  it('refuses replacing any existing file', () => {
    expect(() => legalHostingPlan(config, [{ path: '/legal/datenschutz.html', hash: 'old' }], pages)).toThrow('collision');
  });
  it('refuses missing pinned runtime or unexpected routes', () => {
    expect(() => legalHostingPlan({ rewrites: [] }, [], pages)).toThrow('runtime');
    expect(() => legalHostingPlan(config, [], pages.slice(1))).toThrow('pages');
  });
  it('only updates the five existing legal artifacts with an explicit update option', () => {
    const first = legalHostingPlan(config, [{ path: '/assets/existing.css', hash: 'unchanged' }], pages);
    const updated = legalHostingPlan(first.config, Object.entries(first.files).map(([path, hash]) => ({ path, hash })), pages.map((file) => ({ ...file, hash: `${file.hash}-updated` })), true);
    expect(updated.config).toEqual(first.config);
    expect(updated.files['/assets/existing.css']).toBe('unchanged');
    expect(updated.files['/legal/datenschutz.html']).toBe('datenschutz-updated');
    expect(updated.updated).toBe(5);
    expect(() => legalHostingPlan(config, [], pages, true)).toThrow('Existing legal deployment');
  });
});
