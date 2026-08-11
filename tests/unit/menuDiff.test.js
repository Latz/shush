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

describe('context menu diffing', () => {
  test('updates items in place when only the mute state changed', async () => {
    const tab = { id: 2, url: 'https://music.com', title: 'Music', mutedInfo: { muted: false } };
    mockTabs([tab]);
    await background.updateAll();
    const rebuildsAfterFirstRender = chrome.contextMenus.removeAll.mock.calls.length;
    chrome.contextMenus.update.mockClear();

    mockTabs([{ ...tab, mutedInfo: { muted: true } }]);
    await background.updateAll();

    // No second teardown — the parent label and the mute item were updated in place
    expect(chrome.contextMenus.removeAll.mock.calls.length).toBe(rebuildsAfterFirstRender);
    expect(chrome.contextMenus.update).toHaveBeenCalledWith(
      'noisy-tab-2', expect.objectContaining({ title: expect.stringContaining('Music') })
    );
    expect(chrome.contextMenus.update).toHaveBeenCalledWith(
      'noisy-tab-2-mute', expect.any(Object)
    );
  });

  test('falls back to a full rebuild when a tab is added', async () => {
    const first = { id: 2, url: 'https://music.com', title: 'Music', mutedInfo: { muted: false } };
    mockTabs([first]);
    await background.updateAll();
    const rebuildsAfterFirstRender = chrome.contextMenus.removeAll.mock.calls.length;

    mockTabs([first, { id: 3, url: 'https://video.com', title: 'Video', mutedInfo: { muted: false } }]);
    await background.updateAll();

    expect(chrome.contextMenus.removeAll.mock.calls.length).toBe(rebuildsAfterFirstRender + 1);
  });

  test('removes the Switch/Mute items when a tab becomes the current tab', async () => {
    const tab = { id: 2, url: 'https://music.com', title: 'Music', mutedInfo: { muted: false } };
    mockTabs([tab]);
    await background.updateAll();

    // Same tab, now the active one — its actions no longer apply
    chrome.tabs.query.mockImplementation((filter) => {
      if (filter.active) return Promise.resolve([tab]);
      return Promise.resolve([tab]);
    });
    await background.updateAll();

    expect(chrome.contextMenus.remove).toHaveBeenCalledWith('noisy-tab-2-switch');
    expect(chrome.contextMenus.remove).toHaveBeenCalledWith('noisy-tab-2-mute');
  });

  test('recreates the Switch/Mute items when a tab stops being the current tab', async () => {
    const tab = { id: 2, url: 'https://music.com', title: 'Music', mutedInfo: { muted: false } };
    chrome.tabs.query.mockImplementation((filter) => {
      if (filter.active) return Promise.resolve([tab]);
      return Promise.resolve([tab]);
    });
    await background.updateAll();
    chrome.contextMenus.create.mockClear();

    mockTabs([tab]); // ACTIVE_TAB is active again, so tab 2 is a background tab
    await background.updateAll();

    const created = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(created).toContain('noisy-tab-2-switch');
    expect(created).toContain('noisy-tab-2-mute');
  });

  test('rebuilds from scratch after the menu was emptied', async () => {
    const tab = { id: 2, url: 'https://music.com', title: 'Music', mutedInfo: { muted: false } };
    mockTabs([tab]);
    await background.updateAll();

    mockTabs([]); // nothing noisy — menu collapses to "Find Noisy Tabs"
    await background.updateAll();
    const rebuildsWhileEmpty = chrome.contextMenus.removeAll.mock.calls.length;

    mockTabs([tab]); // same tab returns; menu no longer holds tab items, so diffing must not apply
    await background.updateAll();

    expect(chrome.contextMenus.removeAll.mock.calls.length).toBe(rebuildsWhileEmpty + 1);
  });
});
