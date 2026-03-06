'use strict';

let background;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

function getClickHandler() {
  return chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
}

describe('context menu click handler', () => {
  test('switch item activates the target tab', () => {
    getClickHandler()({ menuItemId: 'noisy-tab-5-switch' });
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true });
  });

  test('mute item mutes an unmuted tab', () => {
    getClickHandler()({ menuItemId: 'noisy-tab-7-mute' });
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { muted: true });
  });

  test('mute item unmutes a previously shush-muted tab', () => {
    const { shushMutedTabs } = background;
    shushMutedTabs.add(7);
    getClickHandler()({ menuItemId: 'noisy-tab-7-mute' });
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { muted: false });
  });

  test('find-noisy-tabs item triggers a tab query', async () => {
    chrome.tabs.query.mockResolvedValue([]);
    getClickHandler()({ menuItemId: 'find-noisy-tabs' });
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.tabs.query).toHaveBeenCalled();
  });
});
