// @vitest-environment jsdom
'use strict';

const DEFAULT_ACTIVE_TAB = { id: 1, url: 'https://current.com', title: 'Current' };

beforeEach(() => {
  document.body.innerHTML = '<div id="content"></div>';
  globalThis.setupChromeMock();
  // window.close is called by the switch button handler
  globalThis.close = vi.fn();
  vi.resetModules();
});

async function loadPopup(audibleTabs = [], activeTab = DEFAULT_ACTIVE_TAB) {
  chrome.tabs.query.mockImplementation((filter) => {
    if (filter.audible) return Promise.resolve(audibleTabs);
    if (filter.active) return Promise.resolve([activeTab]);
    return Promise.resolve([]);
  });
  await import('../../popup.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  // Wait for async loadNoisyTabs to complete
  await new Promise(r => setTimeout(r, 50));
}

describe('loadNoisyTabs', () => {
  test('shows no-audio message when no tabs are audible', async () => {
    await loadPopup([]);
    expect(document.getElementById('content').innerHTML).toContain('noAudio');
  });

  test('shows current-tab message when only the active tab is audible', async () => {
    const active = { id: 1, url: 'https://current.com', title: 'Current' };
    await loadPopup([active], active);
    expect(document.getElementById('content').innerHTML).toContain('audioCurrentTab');
  });

  test('renders a tab item for each background audible tab', async () => {
    const bgTab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    await loadPopup([bgTab]);
    expect(document.querySelectorAll('.tab-item').length).toBe(1);
  });

  test('skips tabs without http(s) URLs', async () => {
    const chromeTab = { id: 3, url: 'chrome://newtab', title: 'New Tab' };
    await loadPopup([chromeTab]);
    expect(document.getElementById('content').innerHTML).toContain('noAudio');
  });

  test('shows unmute button for muted tabs', async () => {
    const muted = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: true } };
    await loadPopup([muted]);
    const buttons = document.querySelectorAll('.unmute-btn');
    expect(buttons.length).toBe(1);
  });

  test('shows mute button for unmuted tabs', async () => {
    const unmuted = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    await loadPopup([unmuted]);
    const buttons = document.querySelectorAll('.mute-btn');
    expect(buttons.length).toBe(1);
  });

  test('renders favicon when favIconUrl is set', async () => {
    const tab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: 'https://music.com/favicon.ico', mutedInfo: { muted: false } };
    await loadPopup([tab]);
    expect(document.querySelectorAll('.tab-favicon').length).toBe(1);
  });

  test('removes favicon img from DOM on load error', async () => {
    const tab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: 'https://music.com/favicon.ico', mutedInfo: { muted: false } };
    await loadPopup([tab]);
    const img = document.querySelector('.tab-favicon');
    img.dispatchEvent(new Event('error'));
    expect(document.querySelectorAll('.tab-favicon').length).toBe(0);
  });

  test('shows error message when chrome.tabs.query rejects', async () => {
    chrome.tabs.query.mockRejectedValue(new Error('API error'));
    await import('../../popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise(r => setTimeout(r, 50));
    expect(document.getElementById('content').innerHTML).toContain('errorLoadTabs');
  });

  test('switch button activates the tab, focuses its window, and closes the popup', async () => {
    const bgTab = { id: 2, windowId: 3, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    await loadPopup([bgTab]);
    document.querySelector('.switch-btn').click();
    expect(chrome.tabs.update).toHaveBeenCalledWith(2, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(globalThis.close).toHaveBeenCalled();
  });

  test('mute button sends muteTab message and updates button state', async () => {
    const bgTab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ muted: true });
    await loadPopup([bgTab]);
    document.querySelector('.mute-btn').click();
    await new Promise(r => setTimeout(r, 50));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'muteTab', tabId: 2, muted: true })
    );
    expect(document.querySelector('.unmute-btn')).not.toBeNull();
  });

  test('mute button logs error when sendMessage rejects', async () => {
    const bgTab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    chrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('Connection closed'));
    await loadPopup([bgTab]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    document.querySelector('.mute-btn').click();
    await new Promise(r => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledWith('Mute failed:', expect.any(Error));
    spy.mockRestore();
  });
});
