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
      // ignoreRestSiblings: `const { omitted, ...rest } = obj` is a deliberate way to drop a
      // key, not an unused variable.
      'no-unused-vars': ['warn', { ignoreRestSiblings: true }],
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
  { ignores: ['node_modules/', 'coverage/', 'Development/', '.scannerwork/'] },
];
