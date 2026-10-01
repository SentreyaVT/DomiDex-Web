import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({ root, envDir: false, test: {
  environment: 'node', globals: false, pool: 'forks', maxWorkers: 1, testTimeout: 30_000,
  include: ['tests/knowledge-concurrency/aggregation-concurrency.test.mjs',
    'tests/knowledge-concurrency/reducer-map-keys.test.mjs', 'tests/scan-knowledge-trigger.test.mjs'],
  setupFiles: [fileURLToPath(new URL('../sharing-scale/network-guard.mjs', import.meta.url))],
} });
