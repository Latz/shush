// @vitest-environment jsdom
'use strict';

const DEFAULT_ACTIVE_TAB = { id: 1, url: 'https://current.com', title: 'Current' };

beforeEach(() => {
  document.body.innerHTML = '<button id="mute-all-btn" class="mute-all-btn" hidden></button><div id="content"></div>';
  globalThis.setupChromeMock();
  // window.close is called by the switch button handler
  globalThis.close = vi.fn();
  vi.resetModules();
});

// Each test imports a fresh popup.js module instance, but this file's jsdom `document` is
// shared across all tests — dispatching a real 'DOMContentLoaded' event would re-trigger every
// prior test's still-registered listener too. Capture just this import's handler and invoke it
// directly instead, so nothing accumulates on `document` across tests.
async function importPopupAndInit() {
  let handler;
  const originalAddEventListener = document.addEventListener.bind(document);
  document.addEventListener = (type, fn, ...rest) => {
    if (type === 'DOMContentLoaded') { handler = fn; return; }
    return originalAddEventListener(type, fn, ...rest);
  };
  await import('../../popup.js');
  document.addEventListener = originalAddEventListener;
  handler();
}

async function loadPopup(audibleTabs = [], activeTab = DEFAULT_ACTIVE_TAB, allTabs = []) {
  chrome.tabs.query.mockImplementation((filter) => {
    if (filter.audible) return Promise.resolve(audibleTabs);
    if (filter.active) return Promise.resolve([activeTab]);
    return Promise.resolve(allTabs); // chrome.tabs.query({}) — all open tabs
  });
  await importPopupAndInit();
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
    await importPopupAndInit();
    await new Promise(r => setTimeout(r, 50));
    expect(document.getElementById('content').innerHTML).toContain('errorLoadTabs');
  });

  test('switch button activates the tab, focuses its window, and closes the popup', async () => {
    const bgTab = { id: 2, windowId: 3, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    await loadPopup([bgTab]);
    document.querySelector('.switch-btn').click();
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.tabs.update).toHaveBeenCalledWith(2, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(globalThis.close).toHaveBeenCalled();
  });

  test('mute button updates UI immediately before sendMessage resolves', async () => {
    const bgTab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    let resolve;
    const pendingMutePromise = new Promise(r => { resolve = r; });
    chrome.runtime.sendMessage = vi.fn().mockImplementation((msg) => {
      if (msg.action === 'getShushMutedTabs') return Promise.resolve([]);
      return pendingMutePromise;
    });
    await loadPopup([bgTab]);
    document.querySelector('.mute-btn').click();
    // UI should update synchronously before the promise resolves
    expect(document.querySelector('.unmute-btn')).not.toBeNull();
    resolve({ muted: true });
  });

  test('mute button sends muteTab message and updates button state', async () => {
    const bgTab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    chrome.runtime.sendMessage = vi.fn().mockImplementation((msg) => {
      if (msg.action === 'getShushMutedTabs') return Promise.resolve([]);
      return Promise.resolve({ muted: true });
    });
    await loadPopup([bgTab]);
    document.querySelector('.mute-btn').click();
    await new Promise(r => setTimeout(r, 50));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'muteTab', tabId: 2, muted: true })
    );
    expect(document.querySelector('.unmute-btn')).not.toBeNull();
  });

  test('mute button reverts UI on sendMessage error', async () => {
    const bgTab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    chrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('Connection closed'));
    await loadPopup([bgTab]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.querySelector('.mute-btn').click();
    await new Promise(r => setTimeout(r, 50));
    // Should revert to mute-btn after error
    expect(document.querySelector('.mute-btn')).not.toBeNull();
    expect(document.querySelector('.unmute-btn')).toBeNull();
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

  test('shows context-menu-muted tab with unmute button when no audible tabs', async () => {
    const bgMutedTab = { id: 42, windowId: 5, url: 'https://video.com', title: 'Video', favIconUrl: '' };
    chrome.runtime.sendMessage = vi.fn().mockImplementation((msg) => {
      if (msg.action === 'getShushMutedTabs') return Promise.resolve([42]);
      return Promise.resolve({});
    });
    await loadPopup([], DEFAULT_ACTIVE_TAB, [bgMutedTab]);
    expect(document.querySelectorAll('.unmute-btn').length).toBe(1);
  });

  test('does not duplicate a tab that is both audible and context-menu-muted', async () => {
    const tab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    chrome.runtime.sendMessage = vi.fn().mockImplementation((msg) => {
      if (msg.action === 'getShushMutedTabs') return Promise.resolve([2]);
      return Promise.resolve({});
    });
    await loadPopup([tab], DEFAULT_ACTIVE_TAB, [tab]);
    expect(document.querySelectorAll('.tab-item').length).toBe(1);
  });

  test('shows audible tabs normally when getShushMutedTabs rejects', async () => {
    const bgTab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    chrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('SW inactive'));
    await loadPopup([bgTab]);
    expect(document.querySelectorAll('.tab-item').length).toBe(1);
  });

  test('context-menu-muted tab is marked muted regardless of live mutedInfo', async () => {
    const bgMutedTab = { id: 42, windowId: 5, url: 'https://video.com', title: 'Video', favIconUrl: '', mutedInfo: { muted: false } };
    chrome.runtime.sendMessage = vi.fn().mockImplementation((msg) => {
      if (msg.action === 'getShushMutedTabs') return Promise.resolve([42]);
      return Promise.resolve({});
    });
    await loadPopup([], DEFAULT_ACTIVE_TAB, [bgMutedTab]);
    // Should show as muted (unmute-btn) even though mutedInfo.muted is false
    expect(document.querySelectorAll('.unmute-btn').length).toBe(1);
  });
});

describe('Mute All', () => {
  test('button is hidden when there are no noisy tabs', async () => {
    await loadPopup([]);
    expect(document.getElementById('mute-all-btn').hidden).toBe(true);
  });

  test('button is visible when there is at least one unmuted background tab', async () => {
    const bgTab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    await loadPopup([bgTab]);
    expect(document.getElementById('mute-all-btn').hidden).toBe(false);
  });

  test('button is hidden when all background tabs are already muted', async () => {
    const mutedTab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: true } };
    await loadPopup([mutedTab]);
    expect(document.getElementById('mute-all-btn').hidden).toBe(true);
  });

  test('clicking sends one muteTab message per unmuted tab, none for already-muted tabs', async () => {
    const unmuted = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    const muted = { id: 3, url: 'https://video.com', title: 'Video', favIconUrl: '', mutedInfo: { muted: true } };
    chrome.runtime.sendMessage = vi.fn().mockImplementation((msg) => {
      if (msg.action === 'getShushMutedTabs') return Promise.resolve([]);
      return Promise.resolve({ muted: true });
    });
    await loadPopup([unmuted, muted]);
    document.getElementById('mute-all-btn').click();
    await new Promise(r => setTimeout(r, 50));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'muteTab', tabId: 2, muted: true })
    );
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'muteTab', tabId: 3 })
    );
  });

  test('after clicking, the list re-renders with those tabs muted and the button hides again', async () => {
    const bgTab = { id: 2, windowId: 1, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    let shushMuted = [];
    chrome.runtime.sendMessage = vi.fn().mockImplementation((msg) => {
      if (msg.action === 'getShushMutedTabs') return Promise.resolve(shushMuted);
      if (msg.action === 'muteTab') {
        shushMuted = [...shushMuted, msg.tabId];
        return Promise.resolve({ muted: true });
      }
      return Promise.resolve({});
    });
    // Once a tab is shush-muted it stops being audible (real browser behavior) —
    // simulate that so the reload after Mute All reflects the new state.
    chrome.tabs.query.mockImplementation((filter) => {
      if (filter.audible) return Promise.resolve(shushMuted.includes(bgTab.id) ? [] : [bgTab]);
      if (filter.active) return Promise.resolve([DEFAULT_ACTIVE_TAB]);
      return Promise.resolve([bgTab]);
    });
    await importPopupAndInit();
    await new Promise(r => setTimeout(r, 50));

    document.getElementById('mute-all-btn').click();
    await new Promise(r => setTimeout(r, 50));
    expect(document.querySelectorAll('.unmute-btn').length).toBe(1);
    expect(document.getElementById('mute-all-btn').hidden).toBe(true);
  });
});

describe('popup storage — loadSavedTabs', () => {
  test('returns saved muted tabs from chrome.storage.local', async () => {
    const savedTab = { tabId: 7, muted: true };
    const tab7 = { id: 7, windowId: 2, url: 'https://saved.com', title: 'Saved', favIconUrl: '' };
    chrome.storage.local.get.mockResolvedValue({ shush_saved_tabs: [savedTab] });
    await loadPopup([], DEFAULT_ACTIVE_TAB, [tab7]);
    expect(document.querySelectorAll('.unmute-btn').length).toBe(1);
  });

  test('returns empty array when no saved tabs in storage', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    await loadPopup([]);
    expect(document.getElementById('content').innerHTML).toContain('noAudio');
  });

  test('excludes saved tabs where the tab no longer exists', async () => {
    const savedTab = { tabId: 99, muted: true };
    chrome.storage.local.get.mockResolvedValue({ shush_saved_tabs: [savedTab] });
    // Tab 99 not in allTabs → tabById.has(99) is false → excluded
    await loadPopup([], DEFAULT_ACTIVE_TAB, []);
    expect(document.getElementById('content').innerHTML).toContain('noAudio');
  });
});

describe('popup storage — checkSessionNonce', () => {
  test('clears saved tabs when session nonce has changed', async () => {
    chrome.storage.session.get.mockResolvedValue({ sessionNonce: 'new-nonce' });
    chrome.storage.local.get.mockImplementation((key) => {
      if (key === 'shush_session_nonce') return Promise.resolve({ shush_session_nonce: 'old-nonce' });
      return Promise.resolve({});
    });
    await loadPopup([]);
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('shush_saved_tabs');
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ shush_session_nonce: 'new-nonce' })
    );
  });

  test('skips nonce check when chrome.storage.session is unavailable', async () => {
    const { session, ...storageWithoutSession } = chrome.storage;
    chrome.storage = storageWithoutSession;
    await loadPopup([]);
    // Should not throw and should still render normally
    expect(document.getElementById('content')).not.toBeNull();
  });
});

describe('popup storage — unload persistence', () => {
  test('saves displayed tabs to chrome.storage.local on unload', async () => {
    const bgTab = { id: 2, url: 'https://music.com', title: 'Music', favIconUrl: '', mutedInfo: { muted: false } };
    await loadPopup([bgTab]);
    window.dispatchEvent(new Event('unload'));
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        shush_saved_tabs: expect.arrayContaining([
          expect.objectContaining({ tabId: 2 })
        ])
      })
    );
  });
});
