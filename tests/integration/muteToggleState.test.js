'use strict';

// The context menu labels a tab as muted if EITHER shushMutedTabs has it or the browser
// reports mutedInfo.muted. handleMuteToggle has to read the same union, or a tab muted
// with the browser's own tab mute is labelled "Unmute Tab" and mutes again when clicked.

let background;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
  await background.restored;
});

describe('handleMuteToggle — mute state resolution', () => {
  test('unmutes a tab the browser reports as muted but Shush! never muted', async () => {
    chrome.tabs.get.mockResolvedValue({ id: 7, mutedInfo: { muted: true } });
    chrome.tabs.update.mockResolvedValue({ id: 7, mutedInfo: { muted: false } });

    await background.handleMuteToggle(7);

    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { muted: false });
    expect(background.shushMutedTabs.has(7)).toBe(false);
  });

  test('mutes a tab that is neither shush-muted nor browser-muted', async () => {
    chrome.tabs.get.mockResolvedValue({ id: 7, mutedInfo: { muted: false } });
    chrome.tabs.update.mockResolvedValue({ id: 7, mutedInfo: { muted: true } });

    await background.handleMuteToggle(7);

    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { muted: true });
    expect(background.shushMutedTabs.has(7)).toBe(true);
  });

  test('trusts shushMutedTabs without querying the tab (Vivaldi mutedInfo is unreliable)', async () => {
    background.shushMutedTabs.add(7);
    chrome.tabs.update.mockResolvedValue({ id: 7, mutedInfo: { muted: false } });

    await background.handleMuteToggle(7);

    expect(chrome.tabs.get).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { muted: false });
  });

  test('does not re-add a tab that closed while its state was being resolved', async () => {
    // tabs.update rejects once the tab is gone; without the guard the id would be written
    // back into shushMutedTabs after tabs.onRemoved had already cleaned it up.
    chrome.tabs.get.mockResolvedValue({ id: 7, mutedInfo: { muted: false } });
    chrome.tabs.update.mockRejectedValue(new Error('No tab with id: 7'));

    await background.handleMuteToggle(7);

    expect(background.shushMutedTabs.has(7)).toBe(false);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
