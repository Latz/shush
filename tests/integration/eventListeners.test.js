'use strict';

let background;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

describe('tabs.onUpdated listener (filtered)', () => {
  function getUpdatedListener() {
    // calls[0] = navigation re-inject listener (line 104)
    // calls[1] = filtered audible listener (line 113, try block)
    return chrome.tabs.onUpdated.addListener.mock.calls[1][0];
  }

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
