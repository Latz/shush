# Vivaldi Muting Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Mute button actually silence audio in Vivaldi by supplementing `chrome.tabs.update({ muted })` with a content script that sets `.muted` on all `<audio>` and `<video>` elements in the target tab.

**Architecture:** Two-pronged mute: `chrome.tabs.update` handles Chrome's native muting; `chrome.scripting.executeScript` injects a one-shot function that mutes media elements directly, covering Vivaldi where the API alone has no effect. Both paths run on every mute/unmute in every browser — belt and suspenders.

**Tech Stack:** Chrome Extension MV3, `chrome.scripting` API, service worker background script.

**Design doc:** `docs/plans/2026-02-20-vivaldi-mute-design.md`

---

### Task 1: Add permissions to manifest.json

**Files:**
- Modify: `manifest.json`

**Step 1: Add `"scripting"` to the permissions array**

Open `manifest.json`. The current permissions array is:
```json
"permissions": [
  "tabs",
  "notifications",
  "activeTab",
  "windows",
  "contextMenus"
]
```

Change it to:
```json
"permissions": [
  "tabs",
  "notifications",
  "activeTab",
  "windows",
  "contextMenus",
  "scripting"
]
```

**Step 2: Add `host_permissions` for `<all_urls>`**

After the `"permissions"` block, add a new top-level key (e.g. after `"action"`):
```json
"host_permissions": ["<all_urls>"]
```

Full manifest after both changes:
```json
{
  "manifest_version": 3,
  "name": "Where's the Noise",
  "version": "1.0.0",
  "description": "Detect tabs that are playing sound in the background - find noisy tabs that are not currently active",
  "permissions": [
    "tabs",
    "notifications",
    "activeTab",
    "windows",
    "contextMenus",
    "scripting"
  ],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_title": "Where's the Noise",
    "default_popup": "popup.html"
  },
  "options_page": "options.html",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "background": {
    "service_worker": "background-simple.js"
  }
}
```

**Step 3: Verify**

Reload extension at `chrome://extensions` (or `vivaldi://extensions`). No errors should appear in the extension card. The extension should load cleanly.

**Step 4: Commit**

```bash
git add manifest.json
git commit -m "feat: add scripting permission and host_permissions for content script muting"
```

---

### Task 2: Add `injectMediaMute` helper and wire it into both mute paths

**Files:**
- Modify: `background-simple.js`

**Context:** There are currently two places in `background-simple.js` that call `chrome.tabs.update` to mute:
1. The `muteTab` message handler (lines 1–9) — invoked from the popup
2. The context menu `-mute` click handler (lines 19–26) — invoked from right-click

Both need the content script injection added alongside the existing `chrome.tabs.update` call. There are also diagnostic `console.log` lines from earlier debugging (lines 5–10 area) that must be removed.

**Step 1: Replace the `muteTab` handler (remove diagnostic logs, add injection)**

The current handler (with diagnostic logs) looks like:
```js
if (message.action === 'muteTab') {
  chrome.tabs.update(message.tabId, { muted: message.muted })
    .then(tab => {
      console.log('[muteTab] update returned tab.mutedInfo:', JSON.stringify(tab.mutedInfo));
      const actualMuted = tab.mutedInfo?.muted ?? message.muted;
      // Cross-check: query tab fresh to see what Vivaldi really thinks
      chrome.tabs.get(message.tabId, (freshTab) => {
        console.log('[muteTab] fresh tab.mutedInfo:', JSON.stringify(freshTab?.mutedInfo), 'audible:', freshTab?.audible);
      });
      sendResponse({ muted: actualMuted });
    })
    .catch((err) => {
      console.error('[muteTab] update failed:', err);
      sendResponse({ muted: message.muted });
    });
  return true; // keep channel open for async response
}
```

Replace it with:
```js
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
```

**Step 2: Update the context menu `-mute` handler**

The current handler is:
```js
} else if (info.menuItemId.endsWith("-mute")) {
  const tabId = parseInt(info.menuItemId.replace("-mute", "").replace("noisy-tab-", ""), 10);
  if (Number.isFinite(tabId) && tabId > 0) {
    chrome.tabs.get(tabId, (t) => {
      if (t) chrome.tabs.update(tabId, { muted: !t.mutedInfo?.muted });
    });
  }
}
```

Replace it with:
```js
} else if (info.menuItemId.endsWith("-mute")) {
  const tabId = parseInt(info.menuItemId.replace("-mute", "").replace("noisy-tab-", ""), 10);
  if (Number.isFinite(tabId) && tabId > 0) {
    chrome.tabs.get(tabId, (t) => {
      if (t) {
        const nowMuted = !t.mutedInfo?.muted;
        chrome.tabs.update(tabId, { muted: nowMuted });
        injectMediaMute(tabId, nowMuted);
      }
    });
  }
}
```

**Step 3: Add the `injectMediaMute` helper**

Add this function near the top of the file, right after the `chrome.runtime.onMessage.addListener` block (i.e. before the `chrome.contextMenus.onClicked.addListener` block):

```js
function injectMediaMute(tabId, muted) {
  chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (m) => { document.querySelectorAll('audio, video').forEach(el => { el.muted = m; }); },
    args: [muted]
  }).catch(() => {}); // silently ignore restricted pages (chrome://, PDFs, etc.)
}
```

**Step 4: Verify the full file looks correct**

After edits, the top of `background-simple.js` should read:

```js
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
  }).catch(() => {});
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
      chrome.tabs.get(tabId, (t) => {
        if (t) {
          const nowMuted = !t.mutedInfo?.muted;
          chrome.tabs.update(tabId, { muted: nowMuted });
          injectMediaMute(tabId, nowMuted);
        }
      });
    }
  }
  // else: click on a noisy-tab-N parent label (current tab or background tab title) — no action
});
```

**Step 5: Manual test — Chrome**

1. Reload the extension
2. Open a tab playing audio (e.g. YouTube)
3. Open the popup — click **Mute**
4. Expected: audio stops, button shows "Unmute"
5. Click **Unmute**
6. Expected: audio resumes, button shows "Mute"
7. Repeat via right-click context menu → Mute Tab / Unmute Tab

**Step 6: Manual test — Vivaldi**

Same steps as above in Vivaldi. Expected result: audio now actually stops when muted (previously it kept playing).

**Step 7: Manual test — restricted page**

In Chrome or Vivaldi, open `chrome://extensions`, play audio in another tab, mute it from the popup. Expected: no errors in the service worker console (injection into `chrome://` fails silently, other tab is muted via `chrome.tabs.update` as usual).

**Step 8: Commit**

```bash
git add background-simple.js
git commit -m "fix: inject media element mute script to fix muting in Vivaldi"
```

---

### Task 3: Update README.md permissions table

**Files:**
- Modify: `README.md`

**Step 1: Add the two new permissions to the table**

The current table ends at `notifications`. Add two rows:

```markdown
| `scripting` | Inject a script into noisy tabs to mute `<audio>` and `<video>` elements directly — needed for browsers (e.g. Vivaldi) where the standard tab mute API does not silence audio playback |
| `<all_urls>` (host permission) | Required by the `scripting` API to inject into tabs regardless of which site they're on — the injected script only sets `.muted` on media elements and reads nothing |
```

**Step 2: Verify**

Read the updated table to confirm it renders sensibly and the justification is clear to a privacy-conscious user.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: explain scripting and host_permissions in README"
```

---

### Task 4: Final check

**Step 1: Confirm no console noise**

Open the service worker inspector in both Chrome and Vivaldi. Mute and unmute a tab. No `[muteTab]` diagnostic logs should appear (they were removed in Task 2).

**Step 2: Confirm `manifest.json` is valid JSON**

```bash
python3 -c "import json, sys; json.load(open('manifest.json')); print('valid')"
```

Expected output: `valid`
