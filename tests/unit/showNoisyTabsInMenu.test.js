'use strict';

let background;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

describe('showNoisyTabsInMenu', () => {
  test('strips notification-count prefix from tab title', async () => {
    const { showNoisyTabsInMenu } = background;
    await showNoisyTabsInMenu([
      { id: 1, title: '(3) My Tab Title', isCurrentTab: false, muted: false },
    ]);
    const tabItem = chrome.contextMenus.create.mock.calls
      .find(c => c[0].id === 'noisy-tab-1');
    expect(tabItem[0].title).toBe('My Tab Title');
  });

  test('truncates titles longer than 30 characters', async () => {
    const { showNoisyTabsInMenu } = background;
    await showNoisyTabsInMenu([
      { id: 1, title: 'A'.repeat(35), isCurrentTab: false, muted: false },
    ]);
    const tabItem = chrome.contextMenus.create.mock.calls
      .find(c => c[0].id === 'noisy-tab-1');
    expect(tabItem[0].title).toBe('A'.repeat(27) + '...');
  });

  test('does not truncate titles of exactly 30 characters', async () => {
    const { showNoisyTabsInMenu } = background;
    const title = 'B'.repeat(30);
    await showNoisyTabsInMenu([
      { id: 1, title, isCurrentTab: false, muted: false },
    ]);
    const tabItem = chrome.contextMenus.create.mock.calls
      .find(c => c[0].id === 'noisy-tab-1');
    expect(tabItem[0].title).toBe(title);
  });

  test('creates switch and mute sub-items for background tabs', async () => {
    const { showNoisyTabsInMenu } = background;
    await showNoisyTabsInMenu([
      { id: 1, title: 'Tab', isCurrentTab: false, muted: false },
    ]);
    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).toContain('noisy-tab-1-switch');
    expect(ids).toContain('noisy-tab-1-mute');
  });

  test('does not create switch/mute items for the current tab', async () => {
    const { showNoisyTabsInMenu } = background;
    await showNoisyTabsInMenu([
      { id: 1, title: 'Tab', isCurrentTab: true, muted: false },
    ]);
    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).not.toContain('noisy-tab-1-switch');
    expect(ids).not.toContain('noisy-tab-1-mute');
  });

  test('shows unmute label for muted background tabs', async () => {
    const { showNoisyTabsInMenu } = background;
    await showNoisyTabsInMenu([
      { id: 1, title: 'Tab', isCurrentTab: false, muted: true },
    ]);
    const muteItem = chrome.contextMenus.create.mock.calls
      .find(c => c[0].id === 'noisy-tab-1-mute');
    expect(muteItem[0].title).toContain('menuUnmuteTab');
  });

  test('shows mute label for unmuted background tabs', async () => {
    const { showNoisyTabsInMenu } = background;
    await showNoisyTabsInMenu([
      { id: 1, title: 'Tab', isCurrentTab: false, muted: false },
    ]);
    const muteItem = chrome.contextMenus.create.mock.calls
      .find(c => c[0].id === 'noisy-tab-1-mute');
    expect(muteItem[0].title).toContain('menuMuteTab');
  });

  test('calls removeAll before creating menu items', async () => {
    const { showNoisyTabsInMenu } = background;
    await showNoisyTabsInMenu([
      { id: 1, title: 'Tab', isCurrentTab: false, muted: false },
    ]);
    expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
  });

  test('appends current-tab label to current tab title', async () => {
    const { showNoisyTabsInMenu } = background;
    await showNoisyTabsInMenu([
      { id: 1, title: 'Tab', isCurrentTab: true, muted: false },
    ]);
    const tabItem = chrome.contextMenus.create.mock.calls
      .find(c => c[0].id === 'noisy-tab-1');
    expect(tabItem[0].title).toContain('menuCurrentTab');
  });
});
