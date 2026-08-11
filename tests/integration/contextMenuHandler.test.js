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
  test('switch item activates the target tab and focuses its window', async () => {
    chrome.tabs.update.mockResolvedValue({ windowId: 7 });
    getClickHandler()({ menuItemId: 'noisy-tab-5-switch' });
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(7, { focused: true });
  });

  test('mute item mutes an unmuted tab', async () => {
    await getClickHandler()({ menuItemId: 'noisy-tab-7-mute' });
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { muted: true });
  });

  test('mute item immediately updates the menu item label', async () => {
    await getClickHandler()({ menuItemId: 'noisy-tab-7-mute' });
    expect(chrome.contextMenus.update).toHaveBeenCalledWith(
      'noisy-tab-7-mute',
      expect.objectContaining({ title: expect.stringContaining('menuUnmuteTab') })
    );
  });

  test('mute item unmutes a previously shush-muted tab', async () => {
    const { shushMutedTabs } = background;
    shushMutedTabs.add(7);
    await getClickHandler()({ menuItemId: 'noisy-tab-7-mute' });
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { muted: false });
  });

  test('find-noisy-tabs item triggers a tab query', async () => {
    chrome.tabs.query.mockResolvedValue([]);
    getClickHandler()({ menuItemId: 'find-noisy-tabs' });
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.tabs.query).toHaveBeenCalled();
  });

  test('switch item shows a notification when the tab is in a different Vivaldi workspace', async () => {
    chrome.tabs.get.mockResolvedValue({
      id: 5, windowId: 1, vivExtData: JSON.stringify({ workspaceId: 2 }),
    });
    chrome.tabs.query.mockResolvedValue([
      { id: 99, windowId: 1, vivExtData: JSON.stringify({ workspaceId: 1 }) },
    ]);
    chrome.tabs.update.mockResolvedValue({ windowId: 1 });
    getClickHandler()({ menuItemId: 'noisy-tab-5-switch' });
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'tabInOtherWorkspace' })
    );
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true });
  });

  test('switch item shows no notification when the tab is in the same Vivaldi workspace', async () => {
    chrome.tabs.get.mockResolvedValue({
      id: 5, windowId: 1, vivExtData: JSON.stringify({ workspaceId: 1 }),
    });
    chrome.tabs.query.mockResolvedValue([
      { id: 99, windowId: 1, vivExtData: JSON.stringify({ workspaceId: 1 }) },
    ]);
    chrome.tabs.update.mockResolvedValue({ windowId: 1 });
    getClickHandler()({ menuItemId: 'noisy-tab-5-switch' });
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });
});
