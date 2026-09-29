import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const manifest = readJson('manifest.json');
const locales = readdirSync('_locales');
const messages = Object.fromEntries(
  locales.map(l => [l, readJson(`_locales/${l}/messages.json`)])
);
const sortedKeys = (obj) => Object.keys(obj).toSorted((a, b) => a.localeCompare(b));
const baseKeys = sortedKeys(messages[manifest.default_locale]);

const sourceFiles = [
  'background.js', 'popup.js',
  ...readdirSync('shared').filter(f => f.endsWith('.js')).map(f => path.join('shared', f)),
];
const source = sourceFiles.map(f => readFileSync(f, 'utf8')).join('\n');
const usedKeys = new Set([
  ...[...source.matchAll(/i18n\.getMessage\(\s*'(\w+)'/g)].map(m => m[1]),
  // popup.js picks between two keys with a ternary, so also collect quoted keys inside it
  ...[...source.matchAll(/getMessage\([^)]*\?\s*'(\w+)'\s*:\s*'(\w+)'/g)].flatMap(m => [m[1], m[2]]),
  ...[...readFileSync('manifest.json', 'utf8').matchAll(/__MSG_(\w+)__/g)].map(m => m[1]),
]);

describe('locales', () => {
  test('default_locale has a directory', () => {
    expect(existsSync(`_locales/${manifest.default_locale}/messages.json`)).toBe(true);
  });

  test.each(locales)('%s has exactly the keys of the default locale', (locale) => {
    expect(sortedKeys(messages[locale])).toEqual(baseKeys);
  });

  test.each(locales)('%s has no empty messages', (locale) => {
    const entries = Object.entries(messages[locale]);
    for (const [key, entry] of entries) {
      expect(entry.message?.trim(), `${locale}.${key}`).toBeTruthy();
    }
  });

  test('every key used in the source exists in the default locale', () => {
    expect(usedKeys.size).toBeGreaterThan(0);
    expect([...usedKeys].filter(k => !baseKeys.includes(k))).toEqual([]);
  });

  test('every key in the default locale is used', () => {
    expect(baseKeys.filter(k => !usedKeys.has(k))).toEqual([]);
  });

  test('minimum_chrome_version covers the ES2025 iterator helpers', () => {
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(122);
  });
});
