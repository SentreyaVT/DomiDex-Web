import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({ root, envDir: false, resolve: { alias: { '@': root } }, test: {
  environment: 'node', globals: false, pool: 'forks', maxWorkers: 1,
  setupFiles: [fileURLToPath(new URL('../sharing-scale/network-guard.mjs', import.meta.url))],
  include: ['tests/public-catalog-cache/*.test.mjs', 'tests/shared-binder-collisions.test.mjs',
    'tests/shared-binder.test.ts', 'tests/sharing-runtime.test.mjs', 'tests/private-package.test.mjs'],
} });
