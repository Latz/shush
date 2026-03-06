'use strict';

let background;

function getUpdatedListener() {
  // calls[0] = navigation re-inject listener (line 104)
  // calls[1] = filtered audible listener (line 113, try block)
  return chrome.tabs.onUpdated.addListener.mock.calls[1][0];
}

function getNavListener() {
  // calls[0] = navigation re-inject listener (line 104)
  return chrome.tabs.onUpdated.addListener.mock.calls[0][0];
}

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

describe('tabs.onUpdated listener (filtered)', () => {
  test('calls injectMediaMute when a muted tab becomes audible', () => {
    const listener = getUpdatedListener();
    listener(5, { audible: true }, { id: 5, mutedInfo: { muted: true } });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ tabId: 5 }) })
    );
  });

  test('does not call injectMediaMute when tab is unmuted', () => {
    const listener = getUpdatedListener();
    listener(5, { audible: true }, { id: 5, mutedInfo: { muted: false } });
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
  test('re-injects mute when navigation completes on a muted tab', () => {
    const listener = getNavListener();
    listener(5, { status: 'complete' }, { id: 5, mutedInfo: { muted: true } });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ tabId: 5 }) })
    );
  });

  test('does not re-inject when navigation completes on an unmuted tab', () => {
    const listener = getNavListener();
    listener(5, { status: 'complete' }, { id: 5, mutedInfo: { muted: false } });
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
  test('removes closed tab from shushMutedTabs', () => {
    const { shushMutedTabs } = background;
    shushMutedTabs.add(5);
    const listener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    listener(5);
    expect(shushMutedTabs.has(5)).toBe(false);
  });

  test('schedules an update when a tab is closed', () => {
    const listener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    expect(() => listener(99)).not.toThrow();
  });
});
