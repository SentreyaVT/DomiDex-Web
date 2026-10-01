import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  root,
  // Never load the application's .env files for this synthetic harness.
  envDir: false,
  resolve: { alias: { '@': root } },
  test: {
    environment: 'node', globals: false, pool: 'forks', maxWorkers: 1,
    include: ['tests/sharing-scale/read-binder-scale.test.mjs'],
    setupFiles: [fileURLToPath(new URL('./network-guard.mjs', import.meta.url))],
    testTimeout: 60_000,
  },
});
