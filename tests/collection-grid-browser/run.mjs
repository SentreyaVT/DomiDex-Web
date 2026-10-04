import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// This fixture bundles the real grid and styles only. It never imports the app,
// credentials, Firebase, server routes, production config, or external artwork.
const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../..');
const outDir = path.join(repository, 'outputs/collection-grid-browser/dist');
const config = {
  configFile: false, envDir: false, root, publicDir: false,
  resolve: { alias: { '@': repository } },
  plugins: [react()], css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir, emptyOutDir: false, minify: true },
  preview: { host: '127.0.0.1', port: 4319, strictPort: true, open: false },
};
await build(config);
if (!process.argv.includes('--build-only')) {
  const server = await preview(config);
  server.printUrls();
  const close = () => server.httpServer.close(() => process.exit(0));
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
