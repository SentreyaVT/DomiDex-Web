// Loopback-only, read-only preview of the exact static deployment pages.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.domidex/legal-gate/hosting');
const { files } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1:3006');
  const page = files.find((file) => file.route === url.pathname);
  if (page) { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fs.readFileSync(path.join(root, page.path))); return; }
  if (!['/domidex-logo.jpg', '/favicon.jpg'].includes(url.pathname)) { response.writeHead(404); response.end(); return; }
  try { const upstream = await fetch(`https://domidex.web.app${url.pathname}`); response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream' }); response.end(Buffer.from(await upstream.arrayBuffer())); }
  catch { response.writeHead(502); response.end(); }
}).listen(3006, '127.0.0.1', () => console.log('Legal preview: http://127.0.0.1:3006/konto-loeschen'));
