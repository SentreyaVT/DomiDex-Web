import { describe, it, expect } from 'vitest';
import { createSharingRouter } from '../scripts/sharing-runtime.mjs';
import { fileURLToPath } from 'node:url';
const token = 'A'.repeat(43);
describe('isolated sharing runtime', () => {
  it('serves the Android association as JSON without login or redirects and preserves existing signers', async () => {
    const route = createSharingRouter({ operations: {}, root: fileURLToPath(new URL('../sharing-entry', import.meta.url)), enabled: () => false });
    const url = 'https://domidex.web.app/.well-known/assetlinks.json';
    const result = await route(new Request(url));
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('application/json');
    expect(result.headers.get('location')).toBeNull();
    const associations = await result.json();
    expect(associations).toHaveLength(1);
    expect(associations[0].target.package_name).toBe('com.dominik.cardvault');
    expect(associations[0].target.sha256_cert_fingerprints).toHaveLength(4);
    expect(associations[0].target.sha256_cert_fingerprints).toContain('61:E8:31:4B:14:7E:44:65:3B:8E:0D:16:9F:E6:CA:F2:27:60:C3:6E:E4:77:95:CD:84:71:B4:34:16:6B:A8:54');
    expect((await route(new Request(url, { method: 'HEAD' }))).body).toBeNull();
    expect((await route(new Request(url, { method: 'POST' }))).status).toBe(405);
  });
  it('does not intercept existing app, auth, admin or legal routes', async () => {
    const route = createSharingRouter({ operations: {}, root: '.', enabled: () => true });
    for (const path of ['/', '/app', '/api/admin/testers', '/api/pretester/scan-reports', '/datenschutz', '/__/auth/handler', '/_next/static/main.js']) expect(await route(new Request('https://domidex.web.app' + path))).toBeNull();
  });
  it('retains activation gate and rejects public writes', async () => {
    const off = createSharingRouter({ operations: {}, root: '.', enabled: () => false });
    expect((await off(new Request('https://domidex.web.app/api/binder-shares'))).status).toBe(404);
    const on = createSharingRouter({ operations: {}, root: '.', enabled: () => true });
    for (const path of ['/share/', '/api/shared-binders/']) expect((await on(new Request('https://domidex.web.app'+path+token, { method: 'POST' }))).status).toBe(405);
  });
  it('delegates exact request and applies privacy headers', async () => {
    let received;
    const route = createSharingRouter({ operations: { listBinderShares: async r => { received = r; return Response.json({ shares: [] }); } }, root: '.', enabled: () => true });
    const request = new Request('https://domidex.web.app/api/binder-shares?binderId=example');
    const result = await route(request);
    expect(received).toBe(request); expect(await result.json()).toEqual({ shares: [] });
    expect(result.headers.get('cache-control')).toContain('no-store'); expect(result.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('never exposes exception details or serves arbitrary filesystem paths', async () => {
    const route = createSharingRouter({ operations: { createBinderShare: async () => { throw Error('SECRET'); } }, root: '.', enabled: () => true });
    const result = await route(new Request('https://domidex.web.app/api/binder-shares', { method: 'POST' }));
    expect(result.status).toBe(503); expect(await result.text()).not.toContain('SECRET');
    expect(await route(new Request('https://domidex.web.app/_binder-sharing-v1/assets/.env'))).toBeNull();
    expect(await route(new Request('https://domidex.web.app/binder-materials/private-image.png'))).toBeNull();
  });
});
