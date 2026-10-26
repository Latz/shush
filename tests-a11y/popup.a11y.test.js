// Runs axe-core against the real popup in a real browser. jsdom cannot do this: it has no
// layout and no light-dark()/contrast-color(), so colour contrast is only checkable in
// Chromium with the colour scheme emulated. Run with `npm run test:a11y`.
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { AxeBuilder } from '@axe-core/playwright';

const ORIGIN = 'https://shush.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
// 1x1 transparent PNG, standing in for chrome://favicon
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');

const LOCALES = ['en', 'de'];
const messagesOf = (locale) => Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(`_locales/${locale}/messages.json`, 'utf8')))
    .map(([key, { message }]) => [key, message]));

const TABS = [
  { id: 1, windowId: 1, url: 'https://current.example/', title: 'Current tab', active: true },
  { id: 2, windowId: 1, url: 'https://music.example/', title: '(3) A rather long video title that has to be truncated in the list',
    audible: true, favIconUrl: 'https://music.example/favicon.ico', mutedInfo: { muted: false } },
  { id: 3, windowId: 1, url: 'https://news.example/', title: 'Muted news site',
    audible: true, favIconUrl: 'https://news.example/favicon.ico', mutedInfo: { muted: true } },
];

const SCENARIOS = {
  'tab list': TABS,
  'no audio': [TABS[0]],
};

// Stands in for the chrome.* APIs popup.js touches; runs before any page script.
function installChromeMock({ tabs, messages }) {
  const store = {};
  const area = () => ({
    get: async (key) => (typeof key === 'string' ? { [key]: store[key] } : { ...store }),
    set: async (items) => { Object.assign(store, items); },
    remove: async (key) => { delete store[key]; },
  });
  globalThis.chrome = {
    i18n: { getMessage: (key) => messages[key] ?? key },
    runtime: {
      getURL: (p) => `${location.origin}${p}`,
      sendMessage: async () => [],
    },
    storage: { local: area(), session: area() },
    tabs: {
      query: async (filter) => (filter.active ? tabs.filter(t => t.active) : tabs),
      get: async (id) => tabs.find(t => t.id === id),
      update: async () => ({ windowId: 1 }),
    },
    windows: { update: async () => ({}) },
  };
}

// Browser: PW_EXECUTABLE (path to any Chromium-based browser) wins; otherwise locally the
// installed Chrome, and in CI playwright's bundled Chromium (`npx playwright install chromium`).
// Vivaldi is Chromium underneath, but a Playwright-launched Vivaldi 8.2 crashes with an access
// violation as soon as a context is created, so it cannot be the default.
let browser;
beforeAll(async () => {
  const executablePath = process.env.PW_EXECUTABLE;
  browser = await chromium.launch({
    executablePath,
    channel: executablePath || process.env.CI ? undefined : 'chrome',
  });
});

async function openPopup({ colorScheme, locale, tabs }) {
  const context = await browser.newContext({ colorScheme, viewport: { width: 320, height: 400 } });
  const page = await context.newPage();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/_favicon/') || pathname.endsWith('.ico')) {
      return route.fulfill({ contentType: 'image/png', body: PIXEL });
    }
    try {
      const file = pathname === '/' ? 'popup.html' : pathname.slice(1);
      return await route.fulfill({
        contentType: TYPES[path.extname(file)] ?? 'application/octet-stream',
        body: readFileSync(file),
      });
    } catch {
      return route.fulfill({ status: 404 });
    }
  });
  await page.addInitScript(installChromeMock, { tabs, messages: messagesOf(locale) });
  await page.goto(`${ORIGIN}/`);
  await page.locator('#content > *').first().waitFor();
  // The heading colour animates for 0.8s; measuring contrast mid-animation gives false alarms.
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
  return { context, page };
}

function describeViolation({ id, help, nodes }) {
  const lines = nodes.map((node) => {
    const detail = node.failureSummary?.split('\n').at(-1) ?? '';
    return `    ${node.target.join(' ')}  ${detail}`;
  });
  return [`${id}: ${help}`, ...lines].join('\n');
}

describe.each(['light', 'dark'])('popup accessibility (%s)', (colorScheme) => {
  describe.each(LOCALES)('%s', (locale) => {
    test.each(Object.entries(SCENARIOS))('%s has no axe violations', async (_name, tabs) => {
      const { context, page } = await openPopup({ colorScheme, locale, tabs });
      try {
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
          .analyze();
        expect(violations.map(v => describeViolation(v))).toEqual([]);
      } finally {
        await context.close();
      }
    }, 30_000);
  });
});
