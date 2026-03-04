# Design: Re-inject Mute When Audible Changes on a Muted Tab

**Date:** 2026-03-04
**Status:** Approved

## Problem

After muting a tab in Vivaldi, sound eventually comes back. This happens on any site; muting works correctly in Chrome. The regression is Vivaldi-specific.

**Root cause:** Vivaldi relies entirely on our injected script to silence audio (`chrome.tabs.update({ muted })` is a no-op in Vivaldi). The injection is a one-shot: it sets `.muted = true` on all media elements and attaches a MutationObserver for new elements. But when Vivaldi suspends a background tab and restores it, the renderer context is wiped — the `MutationObserver` is gone and `.muted` is reset. `mutedInfo.muted` persists (Chrome API state) but audio resumes.

The existing `tabs.onUpdated` re-injection only fires on `status === 'complete'` (full page navigation), not on tab wakeup.

## Approach

Listen for `audible: true` on a tab whose `mutedInfo.muted` is `true`. That combination means: "audio started on a tab that Shush! muted" — the mute was lost. Re-inject immediately.

This targets the exact failure signal with zero polling overhead. It fires for any reason the mute is lost (tab suspension wakeup, site JS unmuting, etc.).

## Files Changed

- `background.js` only — extend the existing audible listener

## Implementation

Extend the existing `tabs.onUpdated` audible listener (both the declarative and fallback paths):

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

No new permissions, no new files.

## Alternatives Considered

**Periodic re-injection from background (alarms/setInterval):** Reliable but wasteful — re-injects even when nothing is wrong.

**In-page polling (setInterval in injected script):** Doesn't help during tab suspension since the interval is also suspended.

**MutationObserver attribute watching:** Doesn't catch `.muted = false` assignments (only HTML attribute changes, not IDL property changes).
