import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Deliberately separate from ordinary unit tests; suites reject non-local targets.
// Serialize suites because both clear the same synthetic demo project between cases.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: false,
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node', globals: true, fileParallelism: false, maxWorkers: 1,
    testTimeout: 30_000, hookTimeout: 30_000,
    include: ['tests/sync-two-client.rules.test.ts', 'tests/price-selection-two-client.rules.test.ts'],
  },
});
