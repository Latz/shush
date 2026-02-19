// Background service worker for Where's the Noise extension
// Monitors tabs for audio playback

// Register context menu click handler FIRST
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log('Context menu clicked:', info.menuItemId);

  if (info.menuItemId === "find-noisy-tabs") {
    console.log('Starting scan...');
    scanAndShowResults();
  } else if (info.menuItemId === "close-menu") {
    console.log('Closing menu...');
    // Recreate the original menu
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "find-noisy-tabs",
        title: "Find Noisy Tabs",
        contexts: ["all"]
      });
    });
  } else if (info.menuItemId.endsWith("-switch")) {
    console.log('Switching tab...');
    // Extract tab ID from menu item ID
    const tabIdStr = info.menuItemId.replace("-switch", "").replace("noisy-tab-", "");
    const tabId = parseInt(tabIdStr);
    if (tabId) {
      chrome.tabs.update(tabId, { active: true });
    }
  } else if (info.menuItemId.endsWith("-mute")) {
    console.log('Muting/unmuting tab...');
    // Extract tab ID from menu item ID
    const tabIdStr = info.menuItemId.replace("-mute", "").replace("noisy-tab-", "");
    const tabId = parseInt(tabIdStr);
    if (tabId) {
      // Get the tab to check if it's muted
      chrome.tabs.get(tabId, (tab) => {
        if (tab) {
          const isMuted = tab.mutedInfo?.muted || false;
          chrome.tabs.update(tabId, { muted: !isMuted });

          // Show notification
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'Where\'s the Noise',
            message: isMuted ? `Unmuted: ${tab.title}` : `Muted: ${tab.title}`
          });
        }
      });
    }
  }
});

// Create initial menu on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Where\'s the Noise extension installed');

  // Create context menu
  chrome.contextMenus.create({
    id: "find-noisy-tabs",
    title: "Find Noisy Tabs",
    contexts: ["all"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error creating menu:', chrome.runtime.lastError);
    } else {
      console.log('Menu created successfully');
    }
  });

  // Update badge on install
  updateBadge();
});


// Update badge when extension starts
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Listen for tab close to update badge
chrome.tabs.onRemoved.addListener(() => {
  scheduleBadgeUpdate();
});

// Listen for tab updates to track audio state
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Check if audio state changed
  if (changeInfo.audible !== undefined) {
    console.log(`Tab ${tabId} audio state: ${changeInfo.audible ? 'playing' : 'silent'}`);
    // Schedule badge update when audio state changes
    scheduleBadgeUpdate();
  }
});

// Listen for tab activation to update badge
chrome.tabs.onActivated.addListener(() => {
  updateBadge();
});

// Update the browser action badge with audio count
function updateBadge() {
  // Get all tabs to count audio tabs (using all windows for proper badge count)
  chrome.tabs.query({}, (tabs) => {
    const audioTabs = tabs.filter(t => t.audible).length;

    if (audioTabs > 0) {
      // Show count if there are audio tabs
      const count = audioTabs.toString();
      chrome.action.setBadgeText({ text: count });
      chrome.action.setBadgeBackgroundColor({
        color: '#000000'
      });
    } else {
      // Clear badge if no audio
      chrome.action.setBadgeText({ text: '' });
    }
  });
}

// Throttled badge update to prevent performance issues
let badgeUpdateTimeout;
function scheduleBadgeUpdate() {
  clearTimeout(badgeUpdateTimeout);
  badgeUpdateTimeout = setTimeout(() => {
    updateBadge();
  }, 500);
}

// Scan tabs and show results in context menu
async function scanAndShowResults() {
  console.log('scanAndShowResults called');

  try {
    // Get all tabs from all windows
    const allTabs = await chrome.tabs.query({});
    console.log('Found', allTabs.length, 'tabs');

    // Get the current window and its active tab
    const currentWindow = await chrome.windows.getCurrent({ populate: true });
    const currentActiveTab = currentWindow.tabs.find(t => t.active);
    console.log('Current active tab:', currentActiveTab?.title);

    // Check each tab for audio
    const noisyTabsList = [];
    let totalAudioTabs = 0;

    for (const tab of allTabs) {
      // Skip tabs without URLs (like chrome:// pages)
      if (!tab.url || !tab.url.startsWith('http')) continue;

      // Check if tab is audible
      const isAudible = tab.audible;
      // Only consider a tab "not noisy" if it's the active tab in the CURRENT window
      const isActiveInCurrentWindow = currentActiveTab && tab.id === currentActiveTab.id;

      if (isAudible) {
        totalAudioTabs++;
        if (!isActiveInCurrentWindow) {
          noisyTabsList.push({
            id: tab.id,
            title: tab.title || 'Untitled',
            url: tab.url,
            muted: tab.mutedInfo?.muted || false
          });
        }
      }
    }

    console.log('Total audio tabs:', totalAudioTabs);
    console.log('Noisy tabs (not active):', noisyTabsList.length);

    // Handle different scenarios
    if (totalAudioTabs === 0) {
      // No tabs are playing audio
      console.log('No audio tabs, showing notification');
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Where\'s the Noise',
        message: 'No tabs are playing audio. All quiet!'
      });
    } else if (totalAudioTabs === 1) {
      // Only one tab is playing audio - switch to it
      console.log('One audio tab, switching to it');
      const audioTab = noisyTabsList[0] || allTabs.find(t => t.audible);
      if (audioTab) {
        chrome.tabs.update(audioTab.id, { active: true });
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Where\'s the Noise',
          message: `Switched to the only noisy tab: ${audioTab.title}`
        });
      }
    } else if (noisyTabsList.length === 0) {
      // All audio is coming from the current tab
      console.log('All audio from current tab, showing notification');
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Where\'s the Noise',
        message: 'All audio is coming from the current tab.'
      });
    } else {
      // Multiple noisy tabs - show them in the context menu
      console.log('Multiple noisy tabs, showing in menu');
      showNoisyTabsInMenu(noisyTabsList);
    }

  } catch (error) {
    console.error('Scan error:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Where\'s the Noise',
      message: 'Error scanning tabs. Please try again.'
    });
  }
}

// Show noisy tabs in the context menu
function showNoisyTabsInMenu(noisyTabsList) {
  console.log('Showing noisy tabs in menu:', noisyTabsList.length);

  // First, remove any existing noisy tab menu items
  chrome.contextMenus.removeAll(() => {
    console.log('Menu cleared, recreating...');

    // Recreate the main menu item
    chrome.contextMenus.create({
      id: "find-noisy-tabs",
      title: "Find Noisy Tabs",
      contexts: ["all"]
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error creating find-noisy-tabs:', chrome.runtime.lastError);
      }
    });

    // Add separator
    chrome.contextMenus.create({
      id: "separator",
      contexts: ["all"],
      type: "separator"
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error creating separator:', chrome.runtime.lastError);
      }
    });

    // Add each noisy tab as a sub-menu item
    noisyTabsList.forEach((tab, index) => {
      const tabTitle = tab.title.length > 30 ? tab.title.substring(0, 27) + '...' : tab.title;
      const tabId = `noisy-tab-${tab.id}`;

      console.log(`Creating menu item for tab ${tab.id}: ${tabTitle}`);

      // Create parent menu item for the tab
      chrome.contextMenus.create({
        id: tabId,
        title: `${tabTitle} ${tab.muted ? '(muted)' : ''}`,
        contexts: ["all"]
      }, () => {
        if (chrome.runtime.lastError) {
          console.error(`Error creating parent for tab ${tab.id}:`, chrome.runtime.lastError);
        }
      });

      // Add "Switch to Tab" action
      chrome.contextMenus.create({
        id: `${tabId}-switch`,
        parentId: tabId,
        title: "Switch to Tab",
        contexts: ["all"]
      }, () => {
        if (chrome.runtime.lastError) {
          console.error(`Error creating switch for tab ${tab.id}:`, chrome.runtime.lastError);
        }
      });

      // Add "Mute Tab" / "Unmute Tab" action
      const muteTitle = tab.muted ? "Unmute Tab" : "Mute Tab";
      chrome.contextMenus.create({
        id: `${tabId}-mute`,
        parentId: tabId,
        title: muteTitle,
        contexts: ["all"]
      }, () => {
        if (chrome.runtime.lastError) {
          console.error(`Error creating mute for tab ${tab.id}:`, chrome.runtime.lastError);
        }
      });
    });

    // Add separator before exit option
    chrome.contextMenus.create({
      id: "separator2",
      contexts: ["all"],
      type: "separator"
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error creating separator2:', chrome.runtime.lastError);
      }
    });

    // Add "Close Menu" option
    chrome.contextMenus.create({
      id: "close-menu",
      title: "Close Menu",
      contexts: ["all"]
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error creating close-menu:', chrome.runtime.lastError);
      }
    });

    console.log('Menu recreated successfully');
  });
}

