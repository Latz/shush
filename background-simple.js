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
    func: (m) => { document.querySelectorAll('audio, video').forEach(el => { el.muted = m; }); },
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
      chrome.tabs.get(tabId)
        .then(t => {
          const nowMuted = !t.mutedInfo?.muted;
          return chrome.tabs.update(tabId, { muted: nowMuted })
            .then(updated => injectMediaMute(tabId, updated.mutedInfo?.muted ?? nowMuted));
        })
        .catch(() => {}); // tab may have closed between menu click and handler
    }
  }
  // else: click on a noisy-tab-N parent label (current tab or background tab title) — no action
});

// Background service worker for Where's the Noise extension
// Handles badge tracking and context menu interactions

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "find-noisy-tabs",
    title: "Find Noisy Tabs",
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
chrome.tabs.onRemoved.addListener(() => {
  scheduleUpdate();
});

// Listen for tab updates to track audio state
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.audible !== undefined) {
    scheduleUpdate();
  }
});

// Listen for tab activation to update badge and menu
chrome.tabs.onActivated.addListener(() => {
  updateAll();
});

// Single debounced update replacing scheduleBadgeUpdate + scheduleMenuUpdate
let updateTimeout;
function scheduleUpdate() {
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => updateAll(), 500);
}

// Fetch tabs data once and update both badge and menu in a single pass
async function updateAll() {
  try {
    const allTabs = await chrome.tabs.query({});
    const [currentActiveTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

    // Update badge
    const audioCount = allTabs.filter(t => t.audible).length;
    if (audioCount > 0) {
      chrome.action.setBadgeText({ text: audioCount.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#000000' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }

    // Update menu
    const noisyTabsList = buildNoisyTabsList(allTabs, currentActiveTab);
    if (noisyTabsList.length === 0) {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
          id: "find-noisy-tabs",
          title: "Find Noisy Tabs",
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

// Pure function — builds noisy tabs list from pre-fetched data
function buildNoisyTabsList(allTabs, currentActiveTab) {
  const noisyTabsList = [];
  for (const tab of allTabs) {
    if (!tab.url || !tab.url.startsWith('http')) continue;
    if (tab.audible) {
      noisyTabsList.push({
        id: tab.id,
        title: tab.title || 'Untitled',
        muted: tab.mutedInfo?.muted || false,
        isCurrentTab: currentActiveTab && tab.id === currentActiveTab.id
      });
    }
  }
  return noisyTabsList;
}

async function scanAndShowResults() {
  try {
    const allTabs = await chrome.tabs.query({});
    const [currentActiveTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const noisyTabsList = buildNoisyTabsList(allTabs, currentActiveTab);
    const backgroundNoisyTabs = noisyTabsList.filter(t => !t.isCurrentTab);

    if (noisyTabsList.length === 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: "Where's the Noise",
        message: 'No tabs are playing audio. All quiet!'
      });
    } else if (backgroundNoisyTabs.length === 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: "Where's the Noise",
        message: 'All audio is coming from the current tab.'
      });
    } else {
      await showNoisyTabsInMenu(noisyTabsList);
    }
  } catch (error) {
    console.error('Scan error:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: "Where's the Noise",
      message: 'Error scanning tabs. Please try again.'
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
        id: "find-noisy-tabs",
        title: "Find Noisy Tabs",
        contexts: ["all"]
      }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });

      chrome.contextMenus.create({
        id: "separator",
        type: "separator",
        contexts: ["all"]
      }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });

      noisyTabsList.forEach((tab) => {
        const cleanTitle = tab.title.replace(/^\(\d+\)\s*/, '');
        const tabTitle = cleanTitle.length > 30 ? cleanTitle.substring(0, 27) + '...' : cleanTitle;
        const itemId = `noisy-tab-${tab.id}`;

        chrome.contextMenus.create({
          id: itemId,
          title: `${tabTitle}${tab.isCurrentTab ? ' (current tab)' : ''}${tab.muted ? ' (muted)' : ''}`,
          contexts: ["all"]
        }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });

        if (!tab.isCurrentTab) {
          chrome.contextMenus.create({
            id: `${itemId}-switch`,
            parentId: itemId,
            title: "Switch to Tab",
            contexts: ["all"]
          }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });

          chrome.contextMenus.create({
            id: `${itemId}-mute`,
            parentId: itemId,
            title: tab.muted ? "Unmute Tab" : "Mute Tab",
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
