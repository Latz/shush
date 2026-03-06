'use strict';

let background;

beforeEach(async () => {
  global.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

function mockQueries({ audible = [], activeTab = { id: 1, url: 'https://current.com', title: 'Current' } } = {}) {
  chrome.tabs.query.mockImplementation((filter) => {
    if (filter.audible) return Promise.resolve(audible);
    if (filter.active) return Promise.resolve([activeTab]);
    return Promise.resolve([]);
  });
}

describe('scanAndShowResults', () => {
  test('shows all-quiet notification when no audible tabs and no shush-muted tabs', async () => {
    const { scanAndShowResults } = background;
    mockQueries({ audible: [] });

    await scanAndShowResults();

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'noAudio' })
    );
  });

  test('shows current-tab notification when only the active tab is audible', async () => {
    const { scanAndShowResults } = background;
    const activeTab = { id: 1, url: 'https://current.com', title: 'Current' };
    mockQueries({ audible: [activeTab], activeTab });

    await scanAndShowResults();

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'audioCurrentTab' })
    );
  });

  test('shows noisy tabs in menu when background tabs are audible', async () => {
    const { scanAndShowResults } = background;
    const bgTab = { id: 2, url: 'https://music.com', title: 'Music' };
    mockQueries({ audible: [bgTab] });

    await scanAndShowResults();

    expect(chrome.notifications.create).not.toHaveBeenCalled();
    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).toContain('noisy-tab-2');
  });

  // Regression: before fix, shush-muted non-audible tabs were invisible to scanAndShowResults
  test('includes shush-muted non-audible tab instead of showing all-quiet', async () => {
    const { scanAndShowResults, shushMutedTabs } = background;
    shushMutedTabs.add(99);
    mockQueries({ audible: [] });
    chrome.tabs.get.mockResolvedValue({
      id: 99, url: 'https://muted-tab.com', title: 'Muted Tab', mutedInfo: { muted: true },
    });

    await scanAndShowResults();

    expect(chrome.notifications.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'noAudio' })
    );
    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).toContain('noisy-tab-99');
  });

  test('handles closed shush-muted tabs gracefully (tabs.get rejects)', async () => {
    const { scanAndShowResults, shushMutedTabs } = background;
    shushMutedTabs.add(999);
    mockQueries({ audible: [] });
    chrome.tabs.get.mockRejectedValue(new Error('No tab with id 999'));

    await scanAndShowResults();

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'noAudio' })
    );
  });

  test('does not show a tab that is both audible and shush-muted twice', async () => {
    const { scanAndShowResults, shushMutedTabs } = background;
    const tab = { id: 5, url: 'https://music.com', title: 'Music' };
    shushMutedTabs.add(5);
    mockQueries({ audible: [tab] });
    chrome.tabs.get.mockResolvedValue(tab);

    await scanAndShowResults();

    const noisy5Calls = chrome.contextMenus.create.mock.calls
      .filter(c => c[0].id === 'noisy-tab-5');
    expect(noisy5Calls).toHaveLength(1);
  });
});
