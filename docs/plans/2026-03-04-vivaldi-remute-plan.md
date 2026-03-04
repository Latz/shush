# Vivaldi Re-Mute Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Re-inject mute when a muted tab becomes audible in Vivaldi, fixing the bug where sound returns after tab suspension or other mute-loss events.

**Architecture:** Extend the existing `tabs.onUpdated` audible listener in `background.js` to call `injectMediaMute(tabId, true)` whenever a tab fires `audible: true` while `mutedInfo.muted` is true. Both the declarative (filtered) and catch-fallback listener paths need the same addition.

**Tech Stack:** Chrome Extension MV3, `chrome.tabs.onUpdated`, `chrome.scripting.executeScript` (already in use).

**Design doc:** `docs/plans/2026-03-04-vivaldi-remute-design.md`

---

### Task 1: Extend the audible listener to re-inject mute

**Files:**
- Modify: `background.js` (lines 108–116)

**Step 1: Read the current listener**

Open `background.js` and locate the block starting around line 108:

```js
try {
  chrome.tabs.onUpdated.addListener(() => {
    scheduleUpdate();
  }, { properties: ['audible'] });
} catch (e) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.audible !== undefined) scheduleUpdate();
  });
}
```

Note the two paths: the declarative filtered listener (try block) and the fallback (catch block). Both need the fix.

**Step 2: Replace the block with the updated version**

Replace the entire try/catch block above with:

```js
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
```

Key changes:
- Both listener callbacks now accept `(tabId, changeInfo, tab)` instead of ignoring args
- After `scheduleUpdate()`, check: if audio just started (`audible === true`) on a tab Shush! muted (`mutedInfo?.muted`), re-inject immediately

**Step 3: Verify the file looks correct**

Read back the changed section. Confirm:
- The try block callback signature is `(tabId, changeInfo, tab)`
- The catch block callback signature is `(tabId, changeInfo, tab)`
- Both have the `if (changeInfo.audible === true && tab.mutedInfo?.muted)` guard
- `injectMediaMute` is called with `(tabId, true)` in both paths
- Nothing else in the file was changed

**Step 4: Manual test — Chrome (regression check)**

1. Reload the extension at `chrome://extensions`
2. Open a tab playing audio (e.g. any video site)
3. Open Shush! popup → click **Shush!**
4. Expected: audio stops immediately
5. Wait 30 seconds — audio must remain silent
6. Click **Unshush!** — audio must resume
7. No errors in the service worker console (`chrome://extensions` → Inspect views → service worker)

**Step 5: Manual test — Vivaldi**

1. Reload the extension at `vivaldi://extensions`
2. Open a tab playing audio, move it to background (open another tab in front)
3. Open Shush! popup → click **Shush!**
4. Expected: audio stops
5. Wait until Vivaldi may suspend the background tab (leave it 1–2 minutes if needed), or switch away and back
6. Audio must remain silent
7. Click **Unshush!** — audio must resume

**Step 6: Commit**

```bash
git add background.js
git commit -m "fix: re-inject mute when audible fires on a muted tab (Vivaldi wakeup)"
```

---

### Task 2: Final check

**Step 1: Confirm no console noise**

In Chrome: open service worker inspector, mute and unmute a tab. No unexpected errors or warnings.

In Vivaldi: same check at `vivaldi://extensions` → Inspect views → service worker.

**Step 2: Done**

No doc updates needed — the existing README and PRIVACY_POLICY already cover the `scripting` / `<all_urls>` justification. The new behavior is an internal fix with no user-visible permission changes.
