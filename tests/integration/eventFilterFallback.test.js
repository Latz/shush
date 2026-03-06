'use strict';

// No beforeEach — this file controls its own import lifecycle so it can
// make chrome.tabs.onUpdated.addListener throw before background.js loads.

describe('event filter fallback', () => {
  test('logs debug and registers unfiltered listener when filter option throws', async () => {
    globalThis.setupChromeMock();
    // calls[0] = navigation listener (must succeed), calls[1] = filtered listener (throws)
    chrome.tabs.onUpdated.addListener
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error('Filter not supported'); });
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    vi.resetModules();
    await import('../../background.js');

    expect(spy).toHaveBeenCalledWith(
      'Event filter not supported, falling back to unfiltered listener:',
      expect.any(Error)
    );
    // nav call + filtered (throws) + fallback = 3 total
    expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  test('fallback listener calls injectMediaMute when muted tab becomes audible', async () => {
    globalThis.setupChromeMock();
    chrome.tabs.onUpdated.addListener
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error('Filter not supported'); });
    vi.spyOn(console, 'debug').mockImplementation(() => {});

    vi.resetModules();
    await import('../../background.js');

    // calls[0]=nav, calls[1]=filtered (throws), calls[2]=fallback
    const fallbackListener = chrome.tabs.onUpdated.addListener.mock.calls[2][0];
    fallbackListener(7, { audible: true }, { id: 7, mutedInfo: { muted: true } });

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ tabId: 7 }) })
    );
  });
});
