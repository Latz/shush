import js from '@eslint/js';
import globals from 'globals';
import unicorn from 'eslint-plugin-unicorn';
import sonarjs from 'eslint-plugin-sonarjs';
import promise from 'eslint-plugin-promise';

export default [
  js.configs.recommended,
  unicorn.configs.recommended,
  sonarjs.configs.recommended,
  promise.configs['flat/recommended'],
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

      // unicorn rules that are style opinions or do not fit a service worker driven by
      // chrome.* callbacks. Everything else in unicorn's recommended set stays on.
      'unicorn/no-null': 'off',                            // chrome APIs and JSON.stringify use null
      'unicorn/name-replacements': 'off',                  // e.g. e/err/tab abbreviations are idiomatic here
      'unicorn/filename-case': 'off',                      // camelCase test names match the function under test
      'unicorn/prefer-module': 'off',                      // config files and the vitest setup are not ESM-only
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-top-level-assignment-in-function': 'off',   // service worker state lives in module scope
      'unicorn/no-top-level-side-effects': 'off',             // listener registration is the point of the worker
      'unicorn/no-global-object-property-assignment': 'off',  // shared/media-mute.js flags page state on globalThis
      'unicorn/single-line-block-comment-style': 'off',
      'unicorn/consistent-boolean-name': 'off',
      'unicorn/max-nested-calls': 'off',
      'unicorn/numeric-separators-style': 'off',
      // Style rules whose "fix" would change behaviour or fight the code's idioms:
      'unicorn/prefer-await': 'off',                       // fire-and-forget `.catch(() => {})` is deliberate, awaiting it would block
      'unicorn/prefer-then-catch': 'off',
      'unicorn/prefer-ternary': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/no-for-each': 'off',
      'unicorn/no-this-outside-of-class': 'off',           // the muted property setter needs the element as `this`
      'unicorn/prefer-number-is-safe-integer': 'off',
      'unicorn/prefer-simple-condition-first': 'off',
    },
  },
  {
    // Tests were previously excluded entirely, so nothing caught e.g. an assertion with no
    // matcher. vitest injects its API as globals (globals: true in vitest.config.js).
    files: ['tests/**/*.js', 'tests-a11y/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly', test: 'readonly', expect: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly', vi: 'readonly',
      },
    },
    rules: {
      // Test doubles: hand-rolled deferred promises, jsdom fixtures and mock defaults are
      // clearer written out than in the idiom these rules push.
      'promise/param-names': 'off',
      'unicorn/prefer-promise-with-resolvers': 'off',
      'unicorn/prefer-dom-node-html-methods': 'off',
      'unicorn/prefer-dom-node-append': 'off',
      'unicorn/prefer-dom-node-replace-children': 'off',
      'unicorn/prefer-object-define-properties': 'off',
      'unicorn/prefer-https': 'off',                        // fixture URLs, never fetched
      'unicorn/prefer-global-this': 'off',
      'unicorn/no-unnecessary-global-this': 'off',
      'unicorn/no-object-as-default-parameter': 'off',
      'unicorn/prefer-iterator-to-array': 'off',
    },
  },
  {
    ignores: [
      'node_modules/', 'coverage/', 'Development/', '.scannerwork/', '.stryker-tmp/', 'reports/',
      '.worktrees/', // separate git worktrees carrying their own copy of the source
      'bin/',        // bin/check.js is a shell script, not JavaScript
    ],
  },
];
