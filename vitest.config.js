import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/chrome-mock.js'],
    include: ['tests/**/*.test.js'],
  },
});
