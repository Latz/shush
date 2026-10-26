'use strict';

let background;

const ACTIVE_TAB = { id: 1, url: 'https://current.com', title: 'Current', audible: false };

/**
 * Points chrome.tabs.query at a fixed set of audible tabs plus the active tab, matching the
 * two queries fetchNoisyData issues when nothing is shush-muted.
 * @param {chrome.tabs.Tab[]} audibleTabs
 */
function mockTabs(audibleTabs) {
  chrome.tabs.query.mockImplementation((filter) => {
    if (filter.active) return Promise.resolve([ACTIVE_TAB]);
    return Promise.resolve(audibleTabs);
  });
}

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

describe('context menu rebuilds', () => {
  test('rebuilds when only the mute state changed', async () => {
    const tab = { id: 2, url: 'https://music.com', title: 'Music', mutedInfo: { muted: false } };
    mockTabs([tab]);
    await background.updateAll();
    const rebuildsAfterFirstRender = chrome.contextMenus.removeAll.mock.calls.length;

    mockTabs([{ ...tab, mutedInfo: { muted: true } }]);
    await background.updateAll();

    expect(chrome.contextMenus.removeAll.mock.calls.length).toBe(rebuildsAfterFirstRender + 1);
  });

  test('does nothing when the list is unchanged', async () => {
    const tab = { id: 2, url: 'https://music.com', title: 'Music', mutedInfo: { muted: false } };
    mockTabs([tab]);
    await background.updateAll();
    const rebuildsAfterFirstRender = chrome.contextMenus.removeAll.mock.calls.length;

    await background.updateAll();

    expect(chrome.contextMenus.removeAll.mock.calls.length).toBe(rebuildsAfterFirstRender);
  });

  test('builds the Find Noisy Tabs menu when nothing is noisy', async () => {
    mockTabs([]);
    await background.updateAll();

    const created = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(created).toEqual(['shush-menu', 'find-noisy-tabs']);
  });

  test('a tab that is not the current one gets Switch and Mute items', async () => {
    mockTabs([{ id: 2, url: 'https://music.com', title: 'Music', mutedInfo: { muted: false } }]);
    await background.updateAll();

    const created = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(created).toEqual(expect.arrayContaining(['noisy-tab-2-switch', 'noisy-tab-2-mute']));
  });

  test('rebuilds when a tab is added', async () => {
    const first = { id: 2, url: 'https://music.com', title: 'Music', mutedInfo: { muted: false } };
    mockTabs([first]);
    await background.updateAll();
    const rebuildsAfterFirstRender = chrome.contextMenus.removeAll.mock.calls.length;

    mockTabs([first, { id: 3, url: 'https://video.com', title: 'Video', mutedInfo: { muted: false } }]);
    await background.updateAll();

    expect(chrome.contextMenus.removeAll.mock.calls.length).toBe(rebuildsAfterFirstRender + 1);
  });

  test('rebuilds from scratch after the menu was emptied', async () => {
    const tab = { id: 2, url: 'https://music.com', title: 'Music', mutedInfo: { muted: false } };
    mockTabs([tab]);
    await background.updateAll();

    mockTabs([]); // nothing noisy — menu collapses to "Find Noisy Tabs"
    await background.updateAll();
    const rebuildsWhileEmpty = chrome.contextMenus.removeAll.mock.calls.length;

    mockTabs([tab]);
    await background.updateAll();

    expect(chrome.contextMenus.removeAll.mock.calls.length).toBe(rebuildsWhileEmpty + 1);
  });
});
