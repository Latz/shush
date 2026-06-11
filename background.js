// Handle mute requests from popup (avoids popup-context revert behaviour)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'muteTab') {
    const { tabId, muted } = message;
    if (!Number.isInteger(tabId) || tabId <= 0 || typeof muted !== 'boolean') return;
    (async () => {
      try {
        const tab = await chrome.tabs.update(tabId, { muted });
        const actualMuted = tab.mutedInfo?.muted ?? muted;
        injectMediaMute(tabId, actualMuted);
        if (actualMuted) {
          shushMutedTabs.add(tabId);
        } else {
          shushMutedTabs.delete(tabId);
        }
        saveShushMutedTabs();
        scheduleUpdate();
        sendResponse({ muted: actualMuted });
      } catch {
        sendResponse({ muted });
      }
    })();
    return true; // keep channel open for async response
  } else if (message.action === 'getShushMutedTabs') {
    sendResponse([...shushMutedTabs]);
  }
});

/**
 * Injects a content script that mutes/unmutes all audio and video elements in a tab.
 * Also installs a MutationObserver when muting so dynamically added media stays muted.
 * @param {number} tabId
 * @param {boolean} muted
 */
function injectMediaMute(tabId, muted) {
  chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (m) => {
      document.querySelectorAll('audio, video').forEach(el => {
        el.muted = m;
        if (!m && el.paused && !el.ended) el.play().catch(() => {});
      });
      if (m) {
        if (!globalThis.__shushObserver) {
          globalThis.__shushObserver = new MutationObserver(() => {
            document.querySelectorAll('audio, video').forEach(el => { el.muted = true; });
          });
          globalThis.__shushObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
      } else if (globalThis.__shushObserver) {
        globalThis.__shushObserver.disconnect();
        globalThis.__shushObserver = null;
      }
    },
    args: [muted]
  }).catch(() => {}); // silently ignore restricted pages (chrome://, PDFs, etc.)
}

// Tabs muted via the context menu — kept visible in the menu even after muting
// makes them non-audible. Cleared when unmuted or tab closed.
const shushMutedTabs = new Set();

// Debounced: batches rapid storage writes (e.g. closing a window with many tabs)
let saveTimeout;
/** Persists shushMutedTabs to chrome.storage.local (debounced 100 ms). */
function saveShushMutedTabs() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    chrome.storage.local.set({ shush_muted_tabs: [...shushMutedTabs] });
  }, 100);
}

// Restore persisted muted-tab IDs when the service worker restarts
(async () => {
  const result = await chrome.storage.local.get('shush_muted_tabs');
  if (Array.isArray(result?.shush_muted_tabs)) {
    result.shush_muted_tabs.forEach(id => shushMutedTabs.add(id));
  }
})();

// Single debounced update replacing scheduleBadgeUpdate + scheduleMenuUpdate
let updateTimeout;
/** Queues a context menu rebuild; resets the timer on each call (150 ms debounce). */
function scheduleUpdate() {
  clearTimeout(updateTimeout);
  // 150ms: snapshot diffing in updateAll makes no-op calls near-free, so debounce can be short
  updateTimeout = setTimeout(() => updateAll(), 150);
}

// Snapshot of the last menu render — used to skip redundant full rebuilds
let lastMenuSnapshot = '';

/**
 * Produces a stable string fingerprint of the current noisy-tab list.
 * Used by updateAll to skip context menu rebuilds when nothing has changed.
 * @param {Array<{id: number, muted: boolean, isCurrentTab: boolean}>} noisyTabsList
 * @returns {string}
 */
function menuSnapshot(noisyTabsList) {
  return JSON.stringify(noisyTabsList.map(t => `${t.id}:${t.muted}:${t.isCurrentTab}`));
}

/**
 * Toggles the mute state of a tab triggered from the context menu.
 * Updates shushMutedTabs, flips the menu item label immediately, then schedules a full rebuild.
 * @param {number} tabId
 */
function handleMuteToggle(tabId) {
  // Use shushMutedTabs as source of truth: Vivaldi doesn't reliably update mutedInfo
  const nowMuted = !shushMutedTabs.has(tabId);
  chrome.tabs.update(tabId, { muted: nowMuted }).catch(() => {}); // tab may have closed
  injectMediaMute(tabId, nowMuted);
  // Track tabs muted via context menu so updateAll() keeps them in the menu
  // (muting makes a tab non-audible, so without tracking it disappears)
  if (nowMuted) {
    shushMutedTabs.add(tabId);
  } else {
    shushMutedTabs.delete(tabId);
  }
  saveShushMutedTabs();
  // Flip the mute item label immediately; scheduleUpdate() will do the full rebuild
  chrome.contextMenus.update(`noisy-tab-${tabId}-mute`, {
    title: nowMuted
      ? `🔊 ${chrome.i18n.getMessage('menuUnmuteTab')}`
      : `🔇 ${chrome.i18n.getMessage('menuMuteTab')}`
  }).catch(() => {}); // item may not exist if menu hasn't been expanded
  // Invalidate snapshot so the next updateAll() forces a full rebuild
  lastMenuSnapshot = '';
  scheduleUpdate();
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "find-noisy-tabs") {
    scanAndShowResults();
  } else if (info.menuItemId.endsWith("-switch")) {
    const tabId = Number.parseInt(info.menuItemId.replace("-switch", "").replace("noisy-tab-", ""), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      const tab = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } else if (info.menuItemId.endsWith("-mute")) {
    const tabId = Number.parseInt(info.menuItemId.replace("-mute", "").replace("noisy-tab-", ""), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      handleMuteToggle(tabId);
    }
  }
  // else: click on a noisy-tab-N parent label (current tab or background tab title) — no action
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-mute-current') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) handleMuteToggle(tab.id);
});

// Background service worker for Shush! extension

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "shush-menu",
    title: "Shush!",
    contexts: ["all"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error creating context menu:', chrome.runtime.lastError);
    }
  });
  chrome.contextMenus.create({
    id: "find-noisy-tabs",
    parentId: "shush-menu",
    title: chrome.i18n.getMessage('menuFindNoisyTabs'),
    contexts: ["all"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error creating context menu:', chrome.runtime.lastError);
    }
  });
  chrome.storage.session?.set({ sessionNonce: crypto.randomUUID() });
  updateAll();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session?.set({ sessionNonce: crypto.randomUUID() });
  updateAll();
});

// Listen for tab close to update menu
chrome.tabs.onRemoved.addListener((tabId) => {
  shushMutedTabs.delete(tabId);
  saveShushMutedTabs();
  scheduleUpdate();
});

// Track audio state and re-inject mute on navigation (mute is lost on page load in Vivaldi)
// Use declarative event filter where supported; fall back to JS-side check (e.g. Vivaldi)
try {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' && shushMutedTabs.has(tabId)) {
      injectMediaMute(tabId, true);
    }
    if (changeInfo.audible !== undefined) {
      scheduleUpdate();
      if (changeInfo.audible === true && shushMutedTabs.has(tabId)) {
        injectMediaMute(tabId, true);
      }
    }
  }, { properties: ['audible', 'status'] });
} catch (e) {
  console.debug('Event filter not supported, falling back to unfiltered listener:', e);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' && shushMutedTabs.has(tabId)) {
      injectMediaMute(tabId, true);
    }
    if (changeInfo.audible !== undefined) scheduleUpdate();
    if (changeInfo.audible === true && shushMutedTabs.has(tabId)) {
      injectMediaMute(tabId, true);
    }
  });
}

// Listen for tab activation to update menu
chrome.tabs.onActivated.addListener(() => {
  scheduleUpdate();
});

/**
 * Fetches audible tabs, shush-muted tab details, and the focused active tab in one round-trip.
 * Shared by updateAll and scanAndShowResults to avoid duplicate queries.
 * @returns {Promise<{noisyTabs: chrome.tabs.Tab[], currentActiveTab: chrome.tabs.Tab|undefined}>}
 */
async function fetchNoisyData() {
  const shushMutedIds = [...shushMutedTabs];
  const [audibleTabs, shushMutedDetails, [currentActiveTab]] = await Promise.all([
    chrome.tabs.query({ audible: true }),
    shushMutedIds.length > 0
      ? Promise.all(shushMutedIds.map(id => chrome.tabs.get(id).catch(() => null)))
      : Promise.resolve([]),
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
  ]);
  const noisyTabs = [...audibleTabs];
  for (const t of shushMutedDetails) {
    if (t && !noisyTabs.some(x => x.id === t.id)) noisyTabs.push(t);
  }
  return { noisyTabs, currentActiveTab };
}

/**
 * Rebuilds the context menu to reflect the current set of noisy tabs.
 * Skips the rebuild if the tab list and mute states match the previous render.
 * @returns {Promise<void>}
 */
async function updateAll() {
  try {
    const { noisyTabs, currentActiveTab } = await fetchNoisyData();
    const noisyTabsList = buildNoisyTabsList(noisyTabs, currentActiveTab);

    // Skip full rebuild when nothing visible changed (IPC-heavy operation)
    const snapshot = menuSnapshot(noisyTabsList);
    if (snapshot === lastMenuSnapshot) return;
    lastMenuSnapshot = snapshot;

    if (noisyTabsList.length === 0) {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
          id: "shush-menu",
          title: "Shush!",
          contexts: ["all"]
        }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });
        chrome.contextMenus.create({
          id: "find-noisy-tabs",
          parentId: "shush-menu",
          title: chrome.i18n.getMessage('menuFindNoisyTabs'),
          contexts: ["all"]
        }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });
      });
    } else {
      await showNoisyTabsInMenu(noisyTabsList);
    }
  } catch (error) {
    console.error('Update error:', error);
  }
}

/**
 * Transforms raw tab objects into the display shape used by the menu and popup.
 * Pure function — reads shushMutedTabs but never mutates state.
 * @param {chrome.tabs.Tab[]} noisyTabs - Audible + shush-muted tabs, already deduped.
 * @param {chrome.tabs.Tab|undefined} currentActiveTab
 * @returns {Array<{id: number, title: string, muted: boolean, isCurrentTab: boolean}>}
 */
function buildNoisyTabsList(noisyTabs, currentActiveTab) {
  const noisyTabsList = [];
  for (const tab of noisyTabs) {
    if (!tab.url?.startsWith('http')) continue;
    noisyTabsList.push({
      id: tab.id,
      title: tab.title || chrome.i18n.getMessage('untitled'),
      muted: shushMutedTabs.has(tab.id) || tab.mutedInfo?.muted || false,
      isCurrentTab: tab.id === currentActiveTab?.id
    });
  }
  return noisyTabsList;
}

/**
 * Triggered by the "Find Noisy Tabs" menu item.
 * Shows a notification when there is nothing to act on, otherwise populates the menu.
 * @returns {Promise<void>}
 */
async function scanAndShowResults() {
  try {
    const { noisyTabs, currentActiveTab } = await fetchNoisyData();
    const noisyTabsList = buildNoisyTabsList(noisyTabs, currentActiveTab);
    const backgroundNoisyTabs = noisyTabsList.filter(t => !t.isCurrentTab);

    if (noisyTabsList.length === 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: "Shush!",
        message: chrome.i18n.getMessage('noAudio')
      });
    } else if (backgroundNoisyTabs.length === 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: "Shush!",
        message: chrome.i18n.getMessage('audioCurrentTab')
      });
    } else {
      await showNoisyTabsInMenu(noisyTabsList);
    }
  } catch (error) {
    console.error('Scan error:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: "Shush!",
      message: chrome.i18n.getMessage('errorScanTabs')
    });
  }
}

// NOTE: Menu state is not persisted across service worker restarts. If the worker
// is killed while the menu is in its expanded state (after a scan), the menu will
// remain expanded until the user clicks "Find Noisy Tabs" again. This is an
// unavoidable consequence of storing menu state only in Chrome's context menu registry.
/** Passed as the callback to chrome.contextMenus.create/update; logs any lastError. */
function logContextMenuError() {
  if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError);
}

/**
 * Clears the Shush! context menu and rebuilds it with one sub-tree per noisy tab.
 * Uses a Promise wrapper because chrome.contextMenus only exposes callback-style APIs.
 * @param {Array<{id: number, title: string, muted: boolean, isCurrentTab: boolean}>} noisyTabsList
 * @returns {Promise<void>}
 */
function showNoisyTabsInMenu(noisyTabsList) {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "shush-menu",
        title: "Shush!",
        contexts: ["all"]
      }, logContextMenuError);

      noisyTabsList.forEach((tab) => {
        const cleanTitle = tab.title.replace(/^\(\d+\)\s*/, '');
        const tabTitle = cleanTitle.length > 30 ? cleanTitle.substring(0, 27) + '...' : cleanTitle;
        const itemId = `noisy-tab-${tab.id}`;
        const currentLabel = tab.isCurrentTab ? ` ${chrome.i18n.getMessage('menuCurrentTab')}` : '';
        const mutedLabel = tab.muted ? ` ${chrome.i18n.getMessage('menuMuted')}` : '';

        chrome.contextMenus.create({
          id: itemId,
          parentId: "shush-menu",
          title: `${tabTitle}${currentLabel}${mutedLabel}`,
          contexts: ["all"]
        }, logContextMenuError);

        if (!tab.isCurrentTab) {
          chrome.contextMenus.create({
            id: `${itemId}-switch`,
            parentId: itemId,
            title: `→ ${chrome.i18n.getMessage('menuSwitchToTab')}`,
            contexts: ["all"]
          }, logContextMenuError);

          chrome.contextMenus.create({
            id: `${itemId}-mute`,
            parentId: itemId,
            title: tab.muted ? `🔊 ${chrome.i18n.getMessage('menuUnmuteTab')}` : `🔇 ${chrome.i18n.getMessage('menuMuteTab')}`,
            contexts: ["all"]
          }, logContextMenuError);
        }
      });

      // Chrome serialises contextMenus operations within a single callback, so
      // resolve() is called after all creates have been queued and will execute
      // in order — no need to await each individual create.
      resolve();
    });
  });
}

export { buildNoisyTabsList, showNoisyTabsInMenu, scanAndShowResults, updateAll, shushMutedTabs, scheduleUpdate, fetchNoisyData };
