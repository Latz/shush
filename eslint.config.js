import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2026,
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: {
      // error, not warn: eslint exits 0 on warnings, so as a warning this rule could never
      // fail the CI lint step. ignoreRestSiblings keeps `const { omitted, ...rest } = obj`
      // legal — that is a deliberate way to drop a key, not an unused variable.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Tests were previously excluded entirely, so nothing caught e.g. an assertion with no
    // matcher. vitest injects its API as globals (globals: true in vitest.config.js).
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly', test: 'readonly', expect: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly', vi: 'readonly',
      },
    },
  },
  {
    ignores: [
      'node_modules/', 'coverage/', 'Development/', '.scannerwork/',
      '.worktrees/', // separate git worktrees carrying their own copy of the source
      'bin/',        // bin/check.js is a shell script, not JavaScript
    ],
  },
];
