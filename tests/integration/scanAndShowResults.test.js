'use strict';

let background;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

function mockQueries({ audible = [], allTabs, activeTab = { id: 1, url: 'https://current.com', title: 'Current' } } = {}) {
  const tabs = allTabs ?? audible.map(t => ({ ...t, audible: true }));
  chrome.tabs.query.mockImplementation((filter) => {
    if (filter.active) return Promise.resolve([activeTab]);
    return Promise.resolve(tabs);
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
    mockQueries({
      allTabs: [{ id: 99, url: 'https://muted-tab.com', title: 'Muted Tab', mutedInfo: { muted: true } }],
    });

    await scanAndShowResults();

    expect(chrome.notifications.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'noAudio' })
    );
    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).toContain('noisy-tab-99');
  });

  test('ignores a shush-muted tab that is no longer open', async () => {
    const { scanAndShowResults, shushMutedTabs } = background;
    shushMutedTabs.add(999);
    mockQueries({ allTabs: [] });

    await scanAndShowResults();

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'noAudio' })
    );
  });

  test('does not show a tab that is both audible and shush-muted twice', async () => {
    const { scanAndShowResults, shushMutedTabs } = background;
    const tab = { id: 5, url: 'https://music.com', title: 'Music', audible: true };
    shushMutedTabs.add(5);
    mockQueries({ allTabs: [tab] });

    await scanAndShowResults();

    const noisy5Calls = chrome.contextMenus.create.mock.calls
      .filter(c => c[0].id === 'noisy-tab-5');
    expect(noisy5Calls).toHaveLength(1);
  });

  test('shows error notification when tabs query rejects', async () => {
    const { scanAndShowResults } = background;
    chrome.tabs.query.mockRejectedValue(new Error('network error'));

    await scanAndShowResults();

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'errorScanTabs' })
    );
  });
});
