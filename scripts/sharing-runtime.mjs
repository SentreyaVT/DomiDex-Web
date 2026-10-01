import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const security = {
  'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://assets.tcgdex.net; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
const materials = new Set(['private_binder_cover_atlas.png', 'private_binder_holo_atlas.png', 'private_binder_element_holo_atlas.png']);
const response = (value, status = 200, type = 'application/json; charset=utf-8') => new Response(value, { status, headers: { ...security, 'Content-Type': type } });

/** Deliberately owns only the new sharing routes. All other requests reach the unchanged runtime. */
export function createSharingRouter({ operations, root, enabled = () => process.env.BINDER_SHARING_READY === 'verified-v1' }) {
  async function file(relative, type) {
    const path = resolve(root, relative);
    if (!path.startsWith(resolve(root) + sep)) return response('{"error":"NOT_FOUND"}', 404);
    try { return response(await readFile(path), 200, type); }
    catch { return response('{"error":"NOT_FOUND"}', 404); }
  }
  return async function sharing(request) {
    const path = new URL(request.url).pathname;
    // Association uses only public, registered Android signing fingerprints.
    // Preserve the old fingerprints; Android limits handling to manifest paths.
    if (path === '/.well-known/assetlinks.json') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return response('{"error":"METHOD_NOT_ALLOWED"}', 405);
      const result = await file('assetlinks.json', 'application/json; charset=utf-8');
      return request.method === 'HEAD' ? new Response(null, { status: result.status, headers: result.headers }) : result;
    }
    const owner = /^\/api\/binder-shares\/?$/.test(path);
    const publicApi = path.match(/^\/api\/shared-binders\/([A-Za-z0-9_-]{43})\/?$/);
    const page = /^\/share\/([A-Za-z0-9_-]{43})\/?$/.test(path);
    const asset = path.match(/^\/_binder-sharing-v1\/assets\/([A-Za-z0-9_.-]+\.(?:js|css))$/);
    const material = path.match(/^\/binder-materials\/([^/]+)$/);
    if (!owner && !publicApi && !page && !asset && !(material && materials.has(material[1]))) return null;
    if (!enabled()) return response('{"error":"NOT_FOUND"}', 404);
    if (!owner && request.method !== 'GET' && request.method !== 'HEAD') return response('{"error":"METHOD_NOT_ALLOWED"}', 405);
    try {
      let result;
      if (owner) {
        const action = { GET: 'listBinderShares', POST: 'createBinderShare', DELETE: 'revokeBinderShare' }[request.method];
        if (!action) return response('{"error":"METHOD_NOT_ALLOWED"}', 405);
        result = await operations[action](request);
      } else if (publicApi) {
        result = await operations.readBinderShare(request, { params: Promise.resolve({ token: publicApi[1] }) });
      } else if (page) result = await file('index.html', 'text/html; charset=utf-8');
      else if (asset) result = await file(`assets/${asset[1]}`, asset[1].endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
      else result = await file(`materials/${material[1]}`, 'image/png');
      const headers = new Headers(result.headers);
      for (const [name, value] of Object.entries(security)) headers.set(name, value);
      return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status, headers });
    } catch {
      // Never log bearer tokens, share URLs, request bodies or owner identifiers.
      return response('{"error":"SERVER_OPERATION_FAILED"}', 503);
    }
  };
}
