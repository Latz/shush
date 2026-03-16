'use strict';

let onMessageHandler;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  await import('../../background.js');
  onMessageHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];
});

describe('onMessage handler — getShushMutedTabs', () => {
  test('returns empty array when no tabs are shush-muted', () => {
    const sendResponse = vi.fn();
    onMessageHandler({ action: 'getShushMutedTabs' }, null, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith([]);
  });

  test('returns current shushMutedTabs as an array of IDs', async () => {
    const bg = await import('../../background.js');
    bg.shushMutedTabs.add(42);
    bg.shushMutedTabs.add(99);
    const sendResponse = vi.fn();
    onMessageHandler({ action: 'getShushMutedTabs' }, null, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(expect.arrayContaining([42, 99]));
    expect(sendResponse.mock.calls[0][0]).toHaveLength(2);
  });

  test('does not return true (sendResponse is synchronous)', () => {
    const result = onMessageHandler({ action: 'getShushMutedTabs' }, null, vi.fn());
    expect(result).not.toBe(true);
  });
});
