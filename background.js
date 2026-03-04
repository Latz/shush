// Handle mute requests from popup (avoids popup-context revert behaviour)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'muteTab') {
    chrome.tabs.update(message.tabId, { muted: message.muted })
      .then(tab => {
        const actualMuted = tab.mutedInfo?.muted ?? message.muted;
        injectMediaMute(message.tabId, actualMuted);
        sendResponse({ muted: actualMuted });
      })
      .catch(() => sendResponse({ muted: message.muted }));
    return true; // keep channel open for async response
  }
});

function injectMediaMute(tabId, muted) {
  chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (m) => {
      document.querySelectorAll('audio, video').forEach(el => {
        el.muted = m;
        if (!m && el.paused && !el.ended) el.play().catch(() => {});
      });
      if (m) {
        if (!window.__shushObserver) {
          window.__shushObserver = new MutationObserver(() => {
            document.querySelectorAll('audio, video').forEach(el => { el.muted = true; });
          });
          window.__shushObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
      } else {
        if (window.__shushObserver) {
          window.__shushObserver.disconnect();
          window.__shushObserver = null;
        }
      }
    },
    args: [muted]
  }).catch(() => {}); // silently ignore restricted pages (chrome://, PDFs, etc.)
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "find-noisy-tabs") {
    scanAndShowResults();
  } else if (info.menuItemId.endsWith("-switch")) {
    const tabId = parseInt(info.menuItemId.replace("-switch", "").replace("noisy-tab-", ""), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      chrome.tabs.update(tabId, { active: true });
    }
  } else if (info.menuItemId.endsWith("-mute")) {
    const tabId = parseInt(info.menuItemId.replace("-mute", "").replace("noisy-tab-", ""), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
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
      scheduleUpdate();
    }
  }
  // else: click on a noisy-tab-N parent label (current tab or background tab title) — no action
});

// Background service worker for Shush! extension
// Handles badge tracking and context menu interactions

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
  updateAll();
});

chrome.runtime.onStartup.addListener(() => {
  updateAll();
});

// Listen for tab close to update badge and menu
chrome.tabs.onRemoved.addListener((tabId) => {
  shushMutedTabs.delete(tabId);
  scheduleUpdate();
});

// Re-inject mute on navigation for Vivaldi (content script mute is lost on page load)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.mutedInfo?.muted) {
    injectMediaMute(tabId, true);
  }
});

// Listen for tab updates to track audio state
// Use declarative event filter where supported; fall back to JS-side check (e.g. Vivaldi)
try {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    scheduleUpdate();
    if (changeInfo.audible === true && tab.mutedInfo?.muted) {
      injectMediaMute(tabId, true);
    }
  }, { properties: ['audible'] });
} catch (e) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.audible !== undefined) scheduleUpdate();
    if (changeInfo.audible === true && tab.mutedInfo?.muted) {
      injectMediaMute(tabId, true);
    }
  });
}

// Listen for tab activation to update badge and menu
chrome.tabs.onActivated.addListener(() => {
  scheduleUpdate();
});

// Tabs muted via the context menu — kept visible in the menu even after muting
// makes them non-audible. Cleared when unmuted or tab closed.
const shushMutedTabs = new Set();

// Single debounced update replacing scheduleBadgeUpdate + scheduleMenuUpdate
let updateTimeout;
function scheduleUpdate() {
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => updateAll(), 500);
}

// Fetch tabs data once and update both badge and menu in a single pass
async function updateAll() {
  try {
    const shushMutedIds = [...shushMutedTabs];
    const [audibleTabs, shushMutedDetails, [currentActiveTab]] = await Promise.all([
      chrome.tabs.query({ audible: true }),
      shushMutedIds.length > 0
        ? Promise.all(shushMutedIds.map(id => chrome.tabs.get(id).catch(() => null)))
        : Promise.resolve([]),
      chrome.tabs.query({ active: true, lastFocusedWindow: true })
    ]);

    // Union: audible tabs + Shush-muted tabs (deduped by id)
    const noisyTabs = [...audibleTabs];
    for (const t of shushMutedDetails) {
      if (t && !noisyTabs.some(x => x.id === t.id)) noisyTabs.push(t);
    }

    // Update menu
    const noisyTabsList = buildNoisyTabsList(noisyTabs, currentActiveTab);
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

// Pure function — builds noisy tabs list from pre-fetched audible tabs
function buildNoisyTabsList(noisyTabs, currentActiveTab) {
  const noisyTabsList = [];
  for (const tab of noisyTabs) {
    if (!tab.url || !tab.url.startsWith('http')) continue;
    noisyTabsList.push({
      id: tab.id,
      title: tab.title || chrome.i18n.getMessage('untitled'),
      muted: shushMutedTabs.has(tab.id) || tab.mutedInfo?.muted || false,
      isCurrentTab: currentActiveTab && tab.id === currentActiveTab.id
    });
  }
  return noisyTabsList;
}

async function scanAndShowResults() {
  try {
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
function showNoisyTabsInMenu(noisyTabsList) {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "shush-menu",
        title: "Shush!",
        contexts: ["all"]
      }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });

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
        }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });

        if (!tab.isCurrentTab) {
          chrome.contextMenus.create({
            id: `${itemId}-switch`,
            parentId: itemId,
            title: `→ ${chrome.i18n.getMessage('menuSwitchToTab')}`,
            contexts: ["all"]
          }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });

          chrome.contextMenus.create({
            id: `${itemId}-mute`,
            parentId: itemId,
            title: tab.muted ? `🔊 ${chrome.i18n.getMessage('menuUnmuteTab')}` : `🔇 ${chrome.i18n.getMessage('menuMuteTab')}`,
            contexts: ["all"]
          }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });
        }
      });

      // Chrome serialises contextMenus operations within a single callback, so
      // resolve() is called after all creates have been queued and will execute
      // in order — no need to await each individual create.
      resolve();
    });
  });
}

// Conditional CommonJS export for Jest tests.
// `typeof module` is undefined in Chrome service workers, so this is a no-op in production.
if (typeof module !== 'undefined') {
  module.exports = { buildNoisyTabsList, showNoisyTabsInMenu, scanAndShowResults, updateAll, shushMutedTabs, scheduleUpdate };
}
