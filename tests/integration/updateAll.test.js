'use strict';

let background;

beforeEach(async () => {
  global.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

function mockQueries({ audible = [], activeTab = { id: 1, url: 'https://current.com' } } = {}) {
  chrome.tabs.query.mockImplementation((filter) => {
    if (filter.audible) return Promise.resolve(audible);
    if (filter.active) return Promise.resolve([activeTab]);
    return Promise.resolve([]);
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
    const bgTab = { id: 5, url: 'https://music.com', title: 'Music' };
    mockQueries({ audible: [bgTab] });
    chrome.tabs.get.mockResolvedValue({
      id: 77, url: 'https://muted.com', title: 'Muted', mutedInfo: { muted: true },
    });

    await updateAll();

    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).toContain('noisy-tab-5');
    expect(ids).toContain('noisy-tab-77');
  });

  test('deduplicates a tab that is both audible and shush-muted', async () => {
    const { updateAll, shushMutedTabs } = background;
    const tab = { id: 5, url: 'https://music.com', title: 'Music' };
    shushMutedTabs.add(5);
    mockQueries({ audible: [tab] });
    chrome.tabs.get.mockResolvedValue(tab);

    await updateAll();

    const noisy5Calls = chrome.contextMenus.create.mock.calls
      .filter(c => c[0].id === 'noisy-tab-5');
    expect(noisy5Calls).toHaveLength(1);
  });

  test('ignores closed tabs in shushMutedTabs (tabs.get rejects)', async () => {
    const { updateAll, shushMutedTabs } = background;
    shushMutedTabs.add(999);
    mockQueries({ audible: [] });
    chrome.tabs.get.mockRejectedValue(new Error('No tab with id 999'));

    await expect(updateAll()).resolves.toBeUndefined();
    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).not.toContain('noisy-tab-999');
  });
});
