import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { securityHeaders } from '@/lib/security-headers';
import { createScannerDraft } from '@/lib/scanner-profile';
import { profileHistoryReducer } from '@/lib/scanner-profile-history';
import nextConfig from '../next.config';
import { matchHeaders, requestContextFromRequest } from '../node_modules/vinext/dist/config/config-matchers.js';

describe('release security contract', () => {
  it('applies configured security headers to the root and non-root routes with the installed production matcher', async () => {
    const rules = (await nextConfig.headers!()).map((rule) => {
      expect(rule.has).toBeUndefined();
      expect(rule.missing).toBeUndefined();
      return { source: rule.source, headers: rule.headers, basePath: rule.basePath };
    });
    for (const route of ['/', '/app', '/datenschutz', '/api/binder-shares']) {
      const context = requestContextFromRequest(new Request(`https://domidex.web.app${route}`));
      const matched = Object.fromEntries(matchHeaders(route, rules, context).map(({ key, value }) => [key, value]));
      expect(matched['X-Content-Type-Options'], route).toBe('nosniff');
      expect(matched['X-Frame-Options'], route).toBe('DENY');
      expect(matched['Content-Security-Policy'], route).toContain("frame-ancestors 'none'");
      expect(matched['Cross-Origin-Opener-Policy'], route).toBe('same-origin-allow-popups');
    }
  });
  it('uses identical Android and Web rules so a deployment cannot erase the other platform contract', () => {
    for (const file of ['firestore.rules', 'storage.rules']) {
      expect(readFileSync(file, 'utf8').replaceAll('\r\n', '\n')).toBe(readFileSync(`../CardVault/${file}`, 'utf8').replaceAll('\r\n', '\n'));
    }
  });
  it('blocks framing, objects and production eval while preserving Google popup login', () => {
    const headers = Object.fromEntries(securityHeaders(false).map(({ key, value }) => [key, value]));
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
    expect(headers['Content-Security-Policy']).not.toContain('unsafe-eval');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });
  it('undoes and redoes canvas coordinates together with profile fields', () => {
    const original = createScannerDraft();
    const moved = { ...original, zones: original.zones.map((zone, i) => i ? zone : { ...zone, x: .2 }) };
    const renamed = { ...moved, name: 'Neue Kalibrierung' };
    const initial = { present: original, past: [], future: [], saved: JSON.stringify(original) };
    const once = profileHistoryReducer(initial, { type: 'edit', value: moved });
    const twice = profileHistoryReducer(once, { type: 'edit', value: renamed });
    const undoName = profileHistoryReducer(twice, { type: 'undo' });
    expect(undoName.present).toEqual(moved);
    const undoGeometry = profileHistoryReducer(undoName, { type: 'undo' });
    expect(undoGeometry.present).toEqual(original);
    expect(profileHistoryReducer(undoGeometry, { type: 'redo' }).present).toEqual(moved);
    expect(profileHistoryReducer(undoName, { type: 'edit', value: { ...moved, name: 'Andere Änderung' } }).future).toEqual([]);
  });
  it('treats an entire pointer gesture as one undo step', () => {
    const original = createScannerDraft();
    let state = profileHistoryReducer({ present: original, past: [], future: [], saved: '' }, { type: 'replace', value: original });
    for (let i = 1; i <= 100; i += 1) state = profileHistoryReducer(state, { type: 'edit', group: 'one-drag', value: { ...original, zones: original.zones.map((zone, j) => j ? zone : { ...zone, x: i / 200 }) } });
    expect(state.past).toHaveLength(1);
    expect(profileHistoryReducer(state, { type: 'undo' }).present).toEqual(original);
    expect(profileHistoryReducer(profileHistoryReducer(state, { type: 'undo' }), { type: 'redo' }).present).toEqual(state.present);
  });
});
