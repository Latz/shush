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
      // Just under the measured 96/93/88/91 (vitest 5's v8 provider counts functions and
      // statements more strictly than 3.x did) so only a real regression fails the run.
      thresholds: { lines: 94, statements: 92, functions: 86, branches: 88 },
    },
  },
});
