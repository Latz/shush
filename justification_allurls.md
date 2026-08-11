# Justification for `host_permissions: ["http://*/*", "https://*/*"]`

The extension uses `chrome.scripting.executeScript()` to inject a small muting function directly into the DOM of tabs the user has explicitly muted. This is necessary because Chrome's built-in tab muting API (`chrome.tabs.update({ muted: true })`) does not reliably silence audio playback in all Chromium-based browsers. Specifically, in Vivaldi — a widely used Chromium-based browser — the API call succeeds and sets `mutedInfo.muted = true`, but the audio pipeline is not affected and the tab continues to play sound. The injected script is the only mechanism that actually silences audio in Vivaldi.

Because Vivaldi also loses the mute state on page navigation, the extension re-runs the same injection automatically whenever a tab the user has already muted finishes loading a new page or starts playing audio again — this keeps a user's mute choice in effect across navigation without requiring them to re-click Mute on every page load. No tab is ever muted without the user first taking an explicit mute action on it.

## Why broad http/https host permissions are required

The `scripting` API requires a matching host permission for the target tab's URL before `executeScript()` is allowed to run. The extension cannot predict which sites a user will have open when they click Mute — it could be YouTube, Spotify, a podcast player, a video call, a news site with autoplay, or any other web page. A narrow host permission pattern (e.g., `*://*.youtube.com/*`) would silently fail on every site not explicitly listed, making muting non-functional for the majority of real-world use cases. Broad `http://*/*` + `https://*/*` coverage is therefore the minimum permission that makes the feature work universally. It is deliberately narrower than `<all_urls>`: the extension only ever acts on tabs whose URL starts with `http`, so `file://`, `ftp://` and other schemes are excluded.

## What the injected script does — and does not do

The injected function sets the `.muted` property on all `<audio>` and `<video>` elements in the page, including inside iframes (`allFrames: true`), to either `true` (mute) or `false` (unmute). When muting, it also installs a `MutationObserver` that keeps newly-added `<audio>`/`<video>` elements muted for as long as the tab stays muted (e.g. a video site that lazy-loads a new player); this observer is disconnected as soon as the tab is unmuted. It reads no page content, accesses no user data, does not communicate with any server, and returns nothing to the extension.

## When injection occurs

The script only ever runs against a tab the user has explicitly muted or unmuted — by clicking the Mute/Unmute button in the extension popup, selecting "Mute Tab"/"Unmute Tab" from the right-click context menu, or using the mute keyboard shortcut. It is re-injected automatically on subsequent page loads or audio-start events for a tab that is already in that muted state, purely to re-apply the user's existing choice after Vivaldi's navigation-triggered mute reset — never to mute a tab the user has not acted on. There is no persistent content script registered in the manifest; the injection itself runs once per invocation (mute action, unmute action, or re-apply-on-navigation), not as a standing script, though the MutationObserver it installs remains active in the page for the duration of the mute.

## Why a more restricted alternative is not viable

- **`<all_urls>`**: Broader than the extension uses. Every code path filters on an `http`-prefixed URL before acting, so the non-web schemes `<all_urls>` would additionally grant are never needed.
- **Narrow URL patterns**: Would require maintaining a list of every audio-capable website, and would fail silently for any site not on the list.
- **`activeTab` permission**: Only grants access to the currently focused tab. This extension's core purpose is to mute *background* tabs — tabs the user is not currently looking at — so `activeTab` does not apply.
- **Native tab mute API alone**: Works correctly in Chrome but is non-functional in Vivaldi (confirmed: `mutedInfo.muted` is set to `true` but `audible` remains `true` and audio continues to play). Without the injected script, the Mute button has no effect for Vivaldi users.

## Summary

These host permissions are used exclusively to enable `executeScript()` to reach whichever tab the user chooses to mute, regardless of that tab's domain. The injected code is minimal, write-only, scoped only to tabs the user has explicitly muted (including automatic re-application after navigation, for that same tab, until unmuted), and collects no data. There is no less-permissive alternative that preserves full functionality across all Chromium-based browsers.
