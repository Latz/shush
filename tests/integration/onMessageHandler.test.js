'use strict';

let onMessageHandler;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  await import('../../background.js');
  onMessageHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];
});

describe('onMessage handler — getShushMutedTabs', () => {
  test('returns empty array when no tabs are shush-muted', async () => {
    const bg = await import('../../background.js');
    const sendResponse = vi.fn();
    onMessageHandler({ action: 'getShushMutedTabs' }, null, sendResponse);
    await bg.restored;
    expect(sendResponse).toHaveBeenCalledWith([]);
  });

  test('returns current shushMutedTabs as an array of IDs', async () => {
    const bg = await import('../../background.js');
    bg.shushMutedTabs.add(42);
    bg.shushMutedTabs.add(99);
    const sendResponse = vi.fn();
    onMessageHandler({ action: 'getShushMutedTabs' }, null, sendResponse);
    await bg.restored;
    expect(sendResponse).toHaveBeenCalledWith(expect.arrayContaining([42, 99]));
    expect(sendResponse.mock.calls[0][0]).toHaveLength(2);
  });

  test('returns true — the reply waits for the restore to finish', () => {
    const result = onMessageHandler({ action: 'getShushMutedTabs' }, null, vi.fn());
    expect(result).toBe(true);
  });
});

describe('onMessage handler — muteTab input validation', () => {
  test('ignores message with non-integer tabId (string)', () => {
    const sendResponse = vi.fn();
    const result = onMessageHandler({ action: 'muteTab', tabId: 'evil', muted: true }, null, sendResponse);
    expect(result).toBeUndefined();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    // Answered rather than left hanging, so the sender does not see a closed port
    expect(sendResponse).toHaveBeenCalledWith({ muted: false, error: 'invalid' });
  });

  test('ignores message with negative tabId', () => {
    const result = onMessageHandler({ action: 'muteTab', tabId: -1, muted: true }, null, vi.fn());
    expect(result).toBeUndefined();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  test('ignores message with float tabId', () => {
    const result = onMessageHandler({ action: 'muteTab', tabId: 1.5, muted: true }, null, vi.fn());
    expect(result).toBeUndefined();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  test('ignores message with non-boolean muted', () => {
    const result = onMessageHandler({ action: 'muteTab', tabId: 1, muted: 'yes' }, null, vi.fn());
    expect(result).toBeUndefined();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  test('accepts valid tabId and boolean muted, returns true for async response', async () => {
    const bg = await import('../../background.js');
    const result = onMessageHandler({ action: 'muteTab', tabId: 1, muted: true }, null, vi.fn());
    expect(result).toBe(true);
    await bg.restored;
    await Promise.resolve();
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { muted: true });
  });
});

describe('onMessage handler — muteTab persistence', () => {
  test('saves shushMutedTabs to storage after muting', async () => {
    chrome.tabs.update.mockResolvedValue({ mutedInfo: { muted: true } });
    onMessageHandler({ action: 'muteTab', tabId: 5, muted: true }, null, vi.fn());
    await new Promise(r => setTimeout(r, 0)); // let the async handler settle
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ shush_muted_tabs: expect.arrayContaining([5]) })
    );
  });

  test('saves shushMutedTabs to storage after unmuting', async () => {
    const bg = await import('../../background.js');
    bg.shushMutedTabs.add(5);
    chrome.tabs.update.mockResolvedValue({ mutedInfo: { muted: false } });
    onMessageHandler({ action: 'muteTab', tabId: 5, muted: false }, null, vi.fn());
    await new Promise(r => setTimeout(r, 0)); // let the async handler settle
    const lastCall = chrome.storage.local.set.mock.calls.at(-1)[0];
    expect(lastCall.shush_muted_tabs).not.toContain(5);
  });
});

describe('service worker startup — shushMutedTabs restore', () => {
  test('populates Set from chrome.storage.local on import', async () => {
    globalThis.setupChromeMock();
    chrome.storage.local.get.mockResolvedValue({ shush_muted_tabs: [10, 20] });
    vi.resetModules();
    const bg = await import('../../background.js');
    await bg.restored;
    expect(bg.shushMutedTabs.has(10)).toBe(true);
    expect(bg.shushMutedTabs.has(20)).toBe(true);
  });

  test('leaves Set empty when storage returns no data', async () => {
    globalThis.setupChromeMock();
    chrome.storage.local.get.mockResolvedValue({});
    vi.resetModules();
    const bg = await import('../../background.js');
    await bg.restored;
    expect(bg.shushMutedTabs.size).toBe(0);
  });
});
