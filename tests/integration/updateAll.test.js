'use strict';

let background;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

function mockQueries({ audible = [], allTabs, activeTab = { id: 1, url: 'https://current.com' } } = {}) {
  const tabs = allTabs ?? audible.map(t => ({ ...t, audible: true }));
  chrome.tabs.query.mockImplementation((filter) => {
    if (filter.active) return Promise.resolve([activeTab]);
    return Promise.resolve(tabs);
  });
}

describe('updateAll', () => {
  test('resets to basic Shush! menu when no noisy tabs exist', async () => {
    const { updateAll } = background;
    mockQueries({ audible: [] });

    await updateAll();

    expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).toContain('find-noisy-tabs');
    expect(ids).not.toContain('noisy-tab-1');
  });

  test('populates menu with audible background tabs', async () => {
    const { updateAll } = background;
    const bgTab = { id: 5, url: 'https://music.com', title: 'Music' };
    mockQueries({ audible: [bgTab] });

    await updateAll();

    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).toContain('noisy-tab-5');
  });

  test('includes shush-muted tabs alongside audible tabs', async () => {
    const { updateAll, shushMutedTabs } = background;
    shushMutedTabs.add(77);
    const bgTab = { id: 5, url: 'https://music.com', title: 'Music', audible: true };
    const mutedTab = { id: 77, url: 'https://muted.com', title: 'Muted', mutedInfo: { muted: true } };
    mockQueries({ allTabs: [bgTab, mutedTab] });

    await updateAll();

    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).toContain('noisy-tab-5');
    expect(ids).toContain('noisy-tab-77');
  });

  test('deduplicates a tab that is both audible and shush-muted', async () => {
    const { updateAll, shushMutedTabs } = background;
    const tab = { id: 5, url: 'https://music.com', title: 'Music', audible: true };
    shushMutedTabs.add(5);
    mockQueries({ allTabs: [tab] });

    await updateAll();

    const noisy5Calls = chrome.contextMenus.create.mock.calls
      .filter(c => c[0].id === 'noisy-tab-5');
    expect(noisy5Calls).toHaveLength(1);
  });

  test('ignores tabs in shushMutedTabs that are no longer open', async () => {
    const { updateAll, shushMutedTabs } = background;
    shushMutedTabs.add(999);
    mockQueries({ allTabs: [] });

    await expect(updateAll()).resolves.toBeUndefined();
    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).not.toContain('noisy-tab-999');
  });

  test('logs error and does not throw when tabs query rejects', async () => {
    const { updateAll } = background;
    chrome.tabs.query.mockRejectedValue(new Error('network error'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(updateAll()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith('Update error:', expect.any(Error));
    spy.mockRestore();
  });
});
