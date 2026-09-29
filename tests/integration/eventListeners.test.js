'use strict';

let background;

function getUpdatedListener() {
  // calls[0] = single merged listener (handles both audible changes and navigation)
  return chrome.tabs.onUpdated.addListener.mock.calls[0][0];
}

function getNavListener() {
  // same merged listener handles navigation re-injection
  return chrome.tabs.onUpdated.addListener.mock.calls[0][0];
}

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

describe('tabs.onUpdated listener (filtered)', () => {
  test('calls injectMediaMute when a shush-muted tab becomes audible', async () => {
    background.shushMutedTabs.add(5);
    const listener = getUpdatedListener();
    await listener(5, { audible: true });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ tabId: 5 }) })
    );
  });

  test('does not call injectMediaMute when tab is not shush-muted', async () => {
    const listener = getUpdatedListener();
    await listener(5, { audible: true });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe('tabs.onActivated listener', () => {
  test('triggers a debounced update when the active tab changes', () => {
    const listener = chrome.tabs.onActivated.addListener.mock.calls[0][0];
    // Calling it should not throw; scheduleUpdate() is invoked internally
    expect(() => listener({ tabId: 5 })).not.toThrow();
  });
});

describe('tabs.onUpdated navigation listener (Vivaldi mute re-inject)', () => {
  test('re-injects mute when navigation completes on a shush-muted tab', async () => {
    background.shushMutedTabs.add(5);
    const listener = getNavListener();
    await listener(5, { status: 'complete' });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ tabId: 5 }) })
    );
  });

  test('does not re-inject when navigation completes on a non-shush-muted tab', async () => {
    const listener = getNavListener();
    await listener(5, { status: 'complete' });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe('runtime.onStartup listener', () => {
  test('calls updateAll on browser startup', () => {
    chrome.tabs.query.mockResolvedValue([]);
    const listener = chrome.runtime.onStartup.addListener.mock.calls[0][0];
    expect(() => listener()).not.toThrow();
  });

  test('clears persisted muted tabs, whose IDs are meaningless in a new browser session', async () => {
    chrome.tabs.query.mockResolvedValue([]);
    await background.restored;
    background.shushMutedTabs.add(7);
    const listener = chrome.runtime.onStartup.addListener.mock.calls[0][0];
    await listener();
    expect(background.shushMutedTabs.size).toBe(0);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ shush_muted_tabs: [] });
  });
});

describe('fetchNoisyData pruning', () => {
  test('drops muted IDs whose tab no longer exists', async () => {
    await background.restored;
    background.shushMutedTabs.add(1);
    background.shushMutedTabs.add(2);
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.com', audible: false }]);
    await background.fetchNoisyData();
    expect([...background.shushMutedTabs]).toEqual([1]);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ shush_muted_tabs: [1] });
  });
});

describe('runtime.onMessage listener', () => {
  test('ignores malformed messages without throwing', () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    expect(() => listener(undefined, {}, vi.fn())).not.toThrow();
    expect(() => listener(null, {}, vi.fn())).not.toThrow();
  });
});

describe('tabs.onRemoved listener', () => {
  test('removes closed tab from shushMutedTabs', async () => {
    const { shushMutedTabs } = background;
    shushMutedTabs.add(5);
    const listener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    await listener(5);
    expect(shushMutedTabs.has(5)).toBe(false);
  });

  test('persists only when the closed tab was shush-muted', async () => {
    const { shushMutedTabs } = background;
    const listener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    chrome.storage.local.set.mockClear();
    await listener(12345);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    shushMutedTabs.add(5);
    await listener(5);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ shush_muted_tabs: [] });
  });

  test('schedules an update when a tab is closed', async () => {
    const listener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    await expect(listener(99)).resolves.not.toThrow();
  });
});

describe('scheduleUpdate durability', () => {
  test('marks an update pending in session storage and clears it once the update ran', async () => {
    vi.useFakeTimers();
    try {
      chrome.tabs.query.mockResolvedValue([]);
      background.scheduleUpdate();
      expect(chrome.storage.session.set).toHaveBeenCalledWith({ shush_update_pending: true });
      await vi.advanceTimersByTimeAsync(200);
      expect(chrome.storage.session.remove).toHaveBeenCalledWith('shush_update_pending');
    } finally {
      vi.useRealTimers();
    }
  });

  test('replays an update left pending by a terminated worker', async () => {
    vi.useFakeTimers();
    try {
      globalThis.setupChromeMock();
      chrome.storage.session.get.mockResolvedValue({ shush_update_pending: true });
      chrome.tabs.query.mockResolvedValue([]);
      vi.resetModules();
      await import('../../background.js');
      await vi.advanceTimersByTimeAsync(300);
      expect(chrome.tabs.query).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
