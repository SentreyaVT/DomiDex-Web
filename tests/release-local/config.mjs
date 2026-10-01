import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({ root, envDir: false, resolve: { alias: { '@': root } }, test: {
  environment: 'node', globals: true, maxWorkers: 4,
  setupFiles: [fileURLToPath(new URL('./setup.mjs', import.meta.url))],
} });
