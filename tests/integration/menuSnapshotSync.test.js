'use strict';

let background;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
  await background.restored;
});

/** Points chrome.tabs.query at a fixed tab list, with a distinct active tab. */
function mockTabs(tabs, activeTab = { id: 1, url: 'https://current.com' }) {
  chrome.tabs.query.mockImplementation((filter) =>
    Promise.resolve(filter.active ? [activeTab] : tabs));
}

describe('menu snapshot stays in sync with what is rendered', () => {
  test('a scan-rendered menu is still reset once its tabs go quiet', async () => {
    const { scanAndShowResults, updateAll } = background;
    const noisy = { id: 5, url: 'https://music.com', title: 'Music', audible: true };

    // Render via the scan path, which bypasses updateAll's snapshot bookkeeping.
    mockTabs([noisy]);
    await scanAndShowResults();
    expect(chrome.contextMenus.create.mock.calls.map(c => c[0].id)).toContain('noisy-tab-5');

    // Tab goes silent. The empty list fingerprints to '' — the same value lastMenuSnapshot
    // held before the scan, so a stale snapshot would make this a no-op and strand the entry.
    chrome.contextMenus.removeAll.mockClear();
    chrome.contextMenus.create.mockClear();
    mockTabs([]);
    await updateAll();

    expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id);
    expect(ids).toContain('find-noisy-tabs');
    expect(ids).not.toContain('noisy-tab-5');
  });

  test('an unchanged list after a scan is still deduped to a no-op', async () => {
    const { scanAndShowResults, updateAll } = background;
    const noisy = { id: 5, url: 'https://music.com', title: 'Music', audible: true };
    mockTabs([noisy]);

    await scanAndShowResults();
    chrome.contextMenus.removeAll.mockClear();

    await updateAll();
    expect(chrome.contextMenus.removeAll).not.toHaveBeenCalled();
  });
});

describe('restore failure', () => {
  test('listeners keep working when the persisted set cannot be read', async () => {
    globalThis.setupChromeMock();
    chrome.storage.local.get.mockRejectedValue(new Error('storage unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    const bg = await import('../../background.js');

    // Must resolve, not reject: every entry point awaits it and most have no try/catch.
    await expect(bg.restored).resolves.toBeUndefined();
    expect(bg.shushMutedTabs.size).toBe(0);

    const onRemoved = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    await expect(onRemoved(5)).resolves.not.toThrow();
  });
});
