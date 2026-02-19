// Background service worker for Where's the Noise extension
// Updated to use popup instead of context menu (to avoid Chrome caching issues)

// Update badge on install and startup
chrome.runtime.onInstalled.addListener(() => {
  console.log("Where's the Noise extension installed");
  chrome.contextMenus.create({
    id: "find-noisy-tabs",
    title: "Find Noisy Tabs",
    contexts: ["all"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error creating context menu:', chrome.runtime.lastError);
    }
  });
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Extension starting up');
  updateBadge();
});

// Listen for tab close to update badge
chrome.tabs.onRemoved.addListener(() => {
  console.log('Tab closed, updating badge...');
  scheduleBadgeUpdate();
});

// Listen for tab updates to track audio state
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Check if audio state changed
  if (changeInfo.audible !== undefined) {
    console.log(`Tab ${tabId} audio state: ${changeInfo.audible ? 'playing' : 'silent'}`);
    // Update badge when audio state changes
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
