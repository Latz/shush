# Design: Vivaldi Muting Fix via Content Script Injection

**Date:** 2026-02-20
**Status:** Approved

## Problem

`chrome.tabs.update({ muted: true })` sets `mutedInfo.muted = true` in Vivaldi but does not silence audio playback. This is a Vivaldi bug — the extension API and the audio pipeline are disconnected. Confirmed via diagnostic logging: `mutedInfo.muted: true`, `audible: true` after mute call.

## Approach

Belt-and-suspenders muting:

1. `chrome.tabs.update({ muted })` — handles Chrome-level muting (works in Chrome, no-op in Vivaldi)
2. `chrome.scripting.executeScript` — injects a one-shot function into the tab that sets `.muted` on every `<audio>` and `<video>` element, including inside iframes

Both run on every mute/unmute in both browsers. Chrome gets double coverage (harmless). Vivaldi gets the only path that actually works for it.

## Files Changed

- `manifest.json` — add permissions
- `background-simple.js` — add `injectMediaMute` helper, call it from both mute paths; remove diagnostic logs

## Permissions

```json
"permissions": ["tabs", "notifications", "activeTab", "windows", "contextMenus", "scripting"],
"host_permissions": ["<all_urls>"]
```

- `"scripting"` — required for `chrome.scripting.executeScript`
- `"<all_urls>"` — required to inject into arbitrary background tabs

Injection failures (chrome://, extension pages, PDFs) are silently swallowed via `.catch(() => {})`. These pages don't have audio anyway.

## Key Implementation Detail

```js
function injectMediaMute(tabId, muted) {
  chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (m) => { document.querySelectorAll('audio, video').forEach(el => el.muted = m); },
    args: [muted]
  }).catch(() => {});
}
```

`allFrames: true` ensures embedded iframes (e.g. embedded video players) are also muted.

Called from:
- `muteTab` message handler (popup → background)
- Context menu `-mute` click handler

## Limitations (Out of Scope for v1)

- **Web Audio API sources** — not reachable via `<audio>/<video>` elements; affects rare custom audio players and games
- **Post-navigation re-muting** — content script mute is lost on page navigation in Vivaldi; `mutedInfo` persists but audio resumes; requires `tabs.onUpdated` listener to re-inject
