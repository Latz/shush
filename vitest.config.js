import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/chrome-mock.js'],
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text'],
      reportsDirectory: 'coverage',
      include: ['background.js', 'popup.js', 'shared/*.js'],
      // Just under the measured 96/91/100 so only a real regression fails the run.
      thresholds: { lines: 94, statements: 94, functions: 98, branches: 88 },
    },
  },
});
