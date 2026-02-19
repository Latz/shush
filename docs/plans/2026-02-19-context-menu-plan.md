# Context Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a right-click context menu as an additional access point alongside the existing popup, using the same scan logic.

**Architecture:** Extend `background-simple.js` (the active service worker) with context menu registration, a click handler, and scan logic ported from `popup.js`. The manifest gets one new permission. `background.js` is deleted.

**Tech Stack:** Chrome Extension MV3, `chrome.contextMenus`, `chrome.tabs`, `chrome.windows`, `chrome.notifications`

---

### Task 1: Add `contextMenus` permission to manifest.json

**Files:**
- Modify: `manifest.json`

**Step 1: Add the permission**

In `manifest.json`, add `"contextMenus"` to the `permissions` array:

```json
"permissions": [
  "tabs",
  "notifications",
  "activeTab",
  "windows",
  "contextMenus"
],
```

**Step 2: Verify**

Open `chrome://extensions`, click "Reload" on the extension. No errors should appear in the extension card.

**Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: add contextMenus permission"
```

---

### Task 2: Register context menu on install

**Files:**
- Modify: `background-simple.js`

**Step 1: Add `contextMenus.create` inside the existing `onInstalled` listener**

The existing listener currently only calls `updateBadge()`. Add the menu creation before that call:

```js
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
```

**Step 2: Verify**

Reload the extension in `chrome://extensions`. Right-click anywhere on a webpage — "Find Noisy Tabs" should appear in the context menu.

**Step 3: Commit**

```bash
git add background-simple.js
git commit -m "feat: register Find Noisy Tabs context menu on install"
```

---

### Task 3: Add the context menu click handler

**Files:**
- Modify: `background-simple.js`

**Step 1: Add the click handler at the top of the file (before all other code)**

The handler must be registered at the top so it is attached before Chrome can fire events:

```js
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "find-noisy-tabs") {
    scanAndShowResults();
  } else if (info.menuItemId === "close-menu") {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "find-noisy-tabs",
        title: "Find Noisy Tabs",
        contexts: ["all"]
      });
    });
  } else if (info.menuItemId.endsWith("-switch")) {
    const tabId = parseInt(info.menuItemId.replace("-switch", "").replace("noisy-tab-", ""));
    if (tabId) chrome.tabs.update(tabId, { active: true });
  } else if (info.menuItemId.endsWith("-mute")) {
    const tabId = parseInt(info.menuItemId.replace("-mute", "").replace("noisy-tab-", ""));
    if (tabId) {
      chrome.tabs.get(tabId, (t) => {
        if (t) chrome.tabs.update(tabId, { muted: !t.mutedInfo?.muted });
      });
    }
  }
});
```

**Step 2: Verify**

Reload extension. Right-click → "Find Noisy Tabs". In the service worker DevTools console (chrome://extensions → "Inspect views: service worker"), you should see no errors. The click does nothing visible yet (scanAndShowResults is not defined) — that is expected.

**Step 3: Commit**

```bash
git add background-simple.js
git commit -m "feat: add context menu click handler"
```

---

### Task 4: Add `scanAndShowResults`

**Files:**
- Modify: `background-simple.js`

**Step 1: Add the function at the bottom of the file**

This is ported directly from `popup.js` with notification fallbacks for the quiet states:

```js
async function scanAndShowResults() {
  try {
    const allTabs = await chrome.tabs.query({});
    const currentWindow = await chrome.windows.getCurrent({ populate: true });
    const currentActiveTab = currentWindow.tabs.find(t => t.active);

    const noisyTabsList = [];
    let totalAudioTabs = 0;

    for (const tab of allTabs) {
      if (!tab.url || !tab.url.startsWith('http')) continue;
      if (tab.audible) {
        totalAudioTabs++;
        const isActiveInCurrentWindow = currentActiveTab && tab.id === currentActiveTab.id;
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

    if (totalAudioTabs === 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: "Where's the Noise",
        message: 'No tabs are playing audio. All quiet!'
      });
    } else if (noisyTabsList.length === 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: "Where's the Noise",
        message: 'All audio is coming from the current tab.'
      });
    } else {
      showNoisyTabsInMenu(noisyTabsList);
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
```

**Step 2: Verify quiet state**

With no audio playing anywhere, reload extension, right-click → "Find Noisy Tabs". A desktop notification should appear: "No tabs are playing audio. All quiet!"

**Step 3: Commit**

```bash
git add background-simple.js
git commit -m "feat: add scanAndShowResults to context menu handler"
```

---

### Task 5: Add `showNoisyTabsInMenu`

**Files:**
- Modify: `background-simple.js`

**Step 1: Add the function at the bottom of the file**

```js
function showNoisyTabsInMenu(noisyTabsList) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "find-noisy-tabs",
      title: "Find Noisy Tabs",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "separator",
      type: "separator",
      contexts: ["all"]
    });

    noisyTabsList.forEach((tab) => {
      const tabTitle = tab.title.length > 30 ? tab.title.substring(0, 27) + '...' : tab.title;
      const itemId = `noisy-tab-${tab.id}`;

      chrome.contextMenus.create({
        id: itemId,
        title: `${tabTitle}${tab.muted ? ' (muted)' : ''}`,
        contexts: ["all"]
      });

      chrome.contextMenus.create({
        id: `${itemId}-switch`,
        parentId: itemId,
        title: "Switch to Tab",
        contexts: ["all"]
      });

      chrome.contextMenus.create({
        id: `${itemId}-mute`,
        parentId: itemId,
        title: tab.muted ? "Unmute Tab" : "Mute Tab",
        contexts: ["all"]
      });
    });

    chrome.contextMenus.create({
      id: "separator2",
      type: "separator",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "close-menu",
      title: "Close Menu",
      contexts: ["all"]
    });
  });
}
```

**Step 2: Verify full flow**

Open 2+ tabs with audio playing (e.g. YouTube in background tabs). Reload extension. Right-click → "Find Noisy Tabs". The menu should rebuild showing each noisy tab with Switch/Mute sub-items and a "Close Menu" option at the bottom.

- Click "Switch to Tab" → Chrome switches to that tab
- Click "Mute Tab" → tab is muted
- Click "Close Menu" → menu resets to just "Find Noisy Tabs"

**Step 3: Commit**

```bash
git add background-simple.js
git commit -m "feat: add dynamic context menu rebuild for noisy tabs"
```

---

### Task 6: Delete `background.js`

**Files:**
- Delete: `background.js`

**Step 1: Delete the file**

```bash
git rm background.js
```

**Step 2: Verify**

Reload extension in `chrome://extensions`. No errors. Full flow still works.

**Step 3: Commit**

```bash
git commit -m "chore: remove unused background.js"
```
