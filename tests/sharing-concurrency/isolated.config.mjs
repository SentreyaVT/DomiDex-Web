import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({ root, envDir: false, resolve: { alias: { '@': root } }, test: {
  environment: 'node', globals: false, pool: 'forks', maxWorkers: 1, testTimeout: 60_000,
  include: ['tests/sharing-concurrency/read-binder-concurrency.test.mjs'],
  setupFiles: [fileURLToPath(new URL('../sharing-scale/network-guard.mjs', import.meta.url))],
} });
