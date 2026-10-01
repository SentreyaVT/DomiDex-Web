import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({ root, envDir: false, resolve: { alias: { '@': root } }, test: {
  include: ['tests/android-web-price-local/web.test.ts'], environment: 'node', globals: false,
  maxWorkers: 1, fileParallelism: false, testTimeout: 40_000, hookTimeout: 30_000,
} });
