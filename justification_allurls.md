# Justification for `host_permissions: ["<all_urls>"]`

The extension uses `chrome.scripting.executeScript()` to inject a small muting function directly into the DOM of tabs the user explicitly mutes. This is necessary because Chrome's built-in tab muting API (`chrome.tabs.update({ muted: true })`) does not reliably silence audio playback in all Chromium-based browsers. Specifically, in Vivaldi — a widely used Chromium-based browser — the API call succeeds and sets `mutedInfo.muted = true`, but the audio pipeline is not affected and the tab continues to play sound. The injected script is the only mechanism that actually silences audio in Vivaldi.

## Why `<all_urls>` is required

The `scripting` API requires a matching host permission for the target tab's URL before `executeScript()` is allowed to run. The extension cannot predict which sites a user will have open when they click Mute — it could be YouTube, Spotify, a podcast player, a video call, a news site with autoplay, or any other web page. A narrow host permission pattern (e.g., `*://*.youtube.com/*`) would silently fail on every site not explicitly listed, making muting non-functional for the majority of real-world use cases. `<all_urls>` is therefore the minimum permission that makes the feature work universally.

## What the injected script does — and does not do

The injected function is a single line:

```js
document.querySelectorAll('audio, video').forEach(el => { el.muted = m; });
```

It sets the `.muted` property on all `<audio>` and `<video>` elements in the page, including inside iframes (`allFrames: true`), to either `true` (mute) or `false` (unmute). It reads no page content, accesses no user data, does not communicate with any server, and returns nothing to the extension. The function is injected once per mute or unmute action and does not persist after execution.

## When injection occurs

The script is only injected in direct response to an explicit user action — clicking the Mute or Unmute button in the extension popup, or selecting "Mute Tab" / "Unmute Tab" from the right-click context menu. No script is injected automatically on page load, on tab creation, or in the background. There is no persistent content script registered in the manifest.

## Why a more restricted alternative is not viable

- **Narrow URL patterns**: Would require maintaining a list of every audio-capable website, and would fail silently for any site not on the list.
- **`activeTab` permission**: Only grants access to the currently focused tab. This extension's core purpose is to mute *background* tabs — tabs the user is not currently looking at — so `activeTab` does not apply.
- **Native tab mute API alone**: Works correctly in Chrome but is non-functional in Vivaldi (confirmed: `mutedInfo.muted` is set to `true` but `audible` remains `true` and audio continues to play). Without the injected script, the Mute button has no effect for Vivaldi users.

## Summary

`<all_urls>` is used exclusively to enable `executeScript()` to reach whichever tab the user chooses to mute, regardless of that tab's domain. The injected code is minimal, write-only, triggered only by explicit user action, and collects no data. There is no less-permissive alternative that preserves full functionality across all Chromium-based browsers.
