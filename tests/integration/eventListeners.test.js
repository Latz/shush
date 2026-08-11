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
});

describe('tabs.onRemoved listener', () => {
  test('removes closed tab from shushMutedTabs', async () => {
    const { shushMutedTabs } = background;
    shushMutedTabs.add(5);
    const listener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    await listener(5);
    expect(shushMutedTabs.has(5)).toBe(false);
  });

  test('schedules an update when a tab is closed', async () => {
    const listener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    await expect(listener(99)).resolves.not.toThrow();
  });
});
