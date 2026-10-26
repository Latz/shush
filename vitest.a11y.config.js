import { defineConfig } from 'vitest/config';

// Separate from vitest.config.js: these tests need a real browser and are slower, so
// `npm test` (and its coverage run) stays browser-free.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests-a11y/**/*.test.js'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
