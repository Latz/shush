'use strict';

// Regression tests for the service-worker state-restore race: Chrome dispatches the event
// that woke the worker as soon as top-level evaluation finishes, i.e. before the
// chrome.storage.local.get that repopulates shushMutedTabs has resolved.

let background;
let resolveGet;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  // Hold the restore read open so listeners run in the window where the set is still empty.
  chrome.storage.local.get.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));
  background = await import('../../background.js');
});

/** Lets the pending restore read complete with the given persisted IDs. */
async function finishRestore(ids) {
  resolveGet({ shush_muted_tabs: ids });
  await background.restored;
}

describe('restore race', () => {
  test('closing a tab before the restore finishes does not wipe persisted state', async () => {
    const listener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    const pending = listener(5); // fires while shushMutedTabs is still empty
    await finishRestore([5, 7]);
    await pending;

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ shush_muted_tabs: [7] });
    expect(background.shushMutedTabs.has(7)).toBe(true);
  });

  test('navigation completing before the restore finishes still re-injects the mute', async () => {
    const listener = chrome.tabs.onUpdated.addListener.mock.calls[0][0];
    const pending = listener(5, { status: 'complete' });
    await finishRestore([5]);
    await pending;

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ tabId: 5 }) })
    );
  });

  test('handleMuteToggle before the restore finishes toggles off, not on', async () => {
    const pending = background.handleMuteToggle(5);
    await finishRestore([5]);
    await pending;

    expect(chrome.tabs.update).toHaveBeenCalledWith(5, { muted: false });
    expect(background.shushMutedTabs.has(5)).toBe(false);
  });

  test('getShushMutedTabs answers with the restored set, not the empty one', async () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = vi.fn();
    const kept = listener({ action: 'getShushMutedTabs' }, {}, sendResponse);

    expect(kept).toBe(true); // channel held open for the async reply
    expect(sendResponse).not.toHaveBeenCalled();

    await finishRestore([5, 7]);
    expect(sendResponse).toHaveBeenCalledWith([5, 7]);
  });
});

describe('muteTab message validation', () => {
  test('answers invalid messages instead of closing the port silently', async () => {
    await finishRestore([]);
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = vi.fn();

    listener({ action: 'muteTab', tabId: 'nope', muted: true }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ muted: false, error: 'invalid' });
  });
});
