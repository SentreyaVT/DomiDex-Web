import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({ root, envDir: false, resolve: { alias: { '@': root } }, test: {
  include: ['tests/private-operations.test.mjs'], environment: 'node', globals: true,
  maxWorkers: 1, fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000,
} });
