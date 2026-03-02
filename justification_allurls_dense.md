# Justification for `host_permissions: ["<all_urls>"]`

## Why it's needed

`chrome.scripting.executeScript()` requires a matching host permission for the target tab. The extension mutes whichever tab the user picks — any site, unpredictable — so a narrow pattern would silently fail on most tabs. `<all_urls>` is the minimum that makes muting work universally.

## Why not a narrower alternative

- **Narrow URL patterns** — would silently fail on every unlisted site.
- **`activeTab`** — only covers the focused tab; this extension mutes *background* tabs.
- **Tab mute API alone** — non-functional in some other Chromium-based browsers (e.g. Vivaldi): `mutedInfo.muted` is set but audio continues. The injected script is the only reliable cross-browser fix.

## What the injected script does

Sets `.muted` on all `<audio>`/`<video>` elements (including iframes). Reads no page content, sends nothing, returns nothing. Injected once per explicit user action (Shush!/Unshush! button or context menu). No persistent content script.
