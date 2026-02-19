# Code Review — Where's the Noise (Chrome Extension)

**Date:** 2026-02-19
**Files reviewed:** `manifest.json`, `background.js`, `background-simple.js`, `popup.html`, `popup.js`, `options.html`, `options.js`, `README.md`

---

## Summary

The extension is functional in its current form but has several significant structural problems: a dead service worker file, substantial code duplication, a mislabeled options page, an XSS vector in the popup, and a README that documents features that don't exist. The core logic (badge counting, tab scanning, mute/switch actions) works correctly.

---

## Critical Issues

### 1. `background.js` is dead code — never loaded

**File:** `manifest.json:23`, `background.js` (entire file)

`manifest.json` registers `background-simple.js` as the service worker:

```json
"background": {
  "service_worker": "background-simple.js"
}
```

`background.js` is never loaded. It is 335 lines of unreachable code that includes the entire context menu system, a more elaborate scan flow, and notification logic. This creates a significant maintenance hazard — any edits to `background.js` have zero effect on the running extension.

**Action required:** Either wire `background.js` into the manifest or delete it.

---

### 2. `background.js` uses `contextMenus` — a permission not declared in manifest

**File:** `background.js:5,14,59,79`, `manifest.json:6-11`

`background.js` calls `chrome.contextMenus.create`, `chrome.contextMenus.removeAll`, and listens on `chrome.contextMenus.onClicked`, but `"contextMenus"` is absent from the `permissions` array in `manifest.json`. This would throw a runtime error if `background.js` were ever loaded.

---

### 3. XSS vulnerability in `popup.js`

**File:** `popup.js:57-66`

Tab titles and the `title` attribute are interpolated directly into `innerHTML` without escaping:

```js
const tabTitle = tab.title.length > 30 ? tab.title.substring(0, 27) + '...' : tab.title;
html += `
  <div class="tab-item">
    <div class="tab-title" title="${tab.title}">${tabTitle}</div>
    ...
  </div>
`;
```

A tab whose title contains `"`, `<`, `>`, or `</div><script>` would break the HTML structure or execute arbitrary script. A malicious webpage could craft its `<title>` to exploit this.

`options.js` correctly uses an `escapeHtml()` helper (line 159–163) but `popup.js` has no equivalent. The `title` attribute value (`tab.title`) is also unescaped.

**Fix:** Apply the same `escapeHtml()` function from `options.js` to both the element content and the attribute value before interpolation.

---

### 4. Duplicate `onInstalled` listener in `background.js`

**File:** `background.js:55-73` and `background.js:75-87`

`chrome.runtime.onInstalled.addListener` is registered twice. On install, both fire: `updateBadge()` runs twice, and `chrome.contextMenus.create` is called twice with the same ID `"find-noisy-tabs"`. The second call would produce a "Duplicate ID" error (visible in the first handler's error check at line 64, missing in the second). Since `background.js` is dead code this has no current effect, but it would be a bug if reactivated.

---

## Significant Issues

### 5. Tab scanning logic is duplicated across three files

**Files:** `background.js:157-181`, `popup.js:8-44`, `options.js:19-53`

The same logic — query all tabs, get current window, find active tab, filter audible non-active tabs, build `noisyTabsList` — is copy-pasted three times with minor variations. Bugs fixed in one copy are silently not fixed in the others. For example:

- `options.js` stores `favicon: tab.favIconUrl` (line 48) but `popup.js` does not.
- `background.js` has an early `continue` check for non-HTTP URLs; `popup.js` and `options.js` share the same check but code remains duplicated.

**Fix:** Extract the scan logic into a shared module or background message handler.

---

### 6. `options.html` / `options.js` is not an options page

**File:** `manifest.json:16`, `options.html`, `options.js`

`manifest.json` registers `options.html` as `options_page`. In Chrome, this opens when a user right-clicks the extension icon and selects "Options". However, the file contains a full audio-scanning UI with live tab results — not settings or preferences. There are no user-configurable options anywhere in the codebase.

This means:
- Users who click "Options" expecting settings get a scan results view instead.
- There is no actual options/settings functionality (no `chrome.storage` usage anywhere).
- The `favicon` field is collected in `options.js` (line 48) but never used in rendering.

---

### 7. `options.js` contains dead code path

**File:** `options.js:88-93`

Inside `displayResults`, there is a check for `noisyTabsList.length === 0` that executes only when `totalAudioTabs > 1`:

```js
if (noisyTabsList.length === 0) {
  noisyTabs.innerHTML = `<div>All audio is coming from the current tab. 🔊</div>`;
}
```

This condition is logically unreachable. `noisyTabsList` only excludes the single active tab. If `totalAudioTabs > 1`, at least one audible tab must be non-active, so `noisyTabsList.length` will always be ≥ 1. This is dead code with a misleading message.

---

### 8. Service worker `scheduleBadgeUpdate` throttle does not persist across wake cycles

**File:** `background-simple.js:56-63`

```js
let badgeUpdateTimeout;
function scheduleBadgeUpdate() {
  clearTimeout(badgeUpdateTimeout);
  badgeUpdateTimeout = setTimeout(() => { updateBadge(); }, 500);
}
```

`badgeUpdateTimeout` is a module-level variable in a Manifest V3 service worker. Service workers can be suspended and restarted between events, resetting all module-level state. On restart, `badgeUpdateTimeout` is `undefined`, so `clearTimeout(undefined)` is a no-op, and a new timer is created. Within a single wake cycle the throttle works correctly, but rapid events across sleep/wake boundaries could cause multiple badge updates in quick succession. For this extension's low-frequency use case this is acceptable, but worth noting.

---

## Minor Issues

### 9. `parseInt` without radix

**File:** `background.js:24,32`

```js
const tabId = parseInt(tabIdStr);
```

Should be `parseInt(tabIdStr, 10)` to prevent octal parsing issues (unlikely for tab IDs, but a best practice).

---

### 10. `popup.js` closes on mute without confirmation

**File:** `popup.js:79-86`

Clicking "Mute" in the popup calls `window.close()` immediately. The user gets no feedback that the action succeeded. `options.js` handles this better by updating the button text in place (`'Muted ✓'`) and disabling it (lines 134–143).

---

### 11. Unused `activeTab` permission

**File:** `manifest.json:9`

`"activeTab"` is declared but the extension uses the broader `"tabs"` permission (which grants access to all tabs, not just the active one). `activeTab` is redundant and adds unnecessary declared permissions.

---

### 12. `favIconUrl` collected but never rendered

**File:** `options.js:48`

```js
favicon: tab.favIconUrl,
```

This field is stored in every `noisyTabsList` entry but is never referenced in `displayResults`. Either render it (adds useful visual identification) or remove the field from the stored object.

---

### 13. Tab ID zero check is incorrect

**File:** `background.js:26,34`

```js
if (tabId) {
  chrome.tabs.update(tabId, { active: true });
}
```

`parseInt` returns `NaN` for invalid strings, not `0`. The check `if (tabId)` correctly guards against `NaN` (falsy), but the intent is unclear. A more explicit check would be `if (!isNaN(tabId))`.

---

## README Inaccuracies

**File:** `README.md`

The README documents features that do not exist in the current implementation:

| Claim in README | Reality |
|---|---|
| "Green badge when current tab is noisy, red when background tabs are noisy" | Badge is always black (`#000000`). No color differentiation. |
| "Badge Colors: Red badge / Green badge / No badge" | Only black or no badge. |
| "Click the extension icon → Click 'Find Noisy Tabs'" | Popup auto-scans on open; there is no "Find Noisy Tabs" button in `popup.html`. |
| "The `background.js` monitors..." | Manifest uses `background-simple.js`, not `background.js`. |
| Multi-window support listed as Future Enhancement | The code already queries all windows via `chrome.tabs.query({})` (no window filter). |
| Troubleshooting: "Extension only checks current window by default" | Incorrect — `chrome.tabs.query({})` queries all windows. |

---

## Architecture Observations

- The extension has two diverged implementations: the context menu approach (`background.js`) and the popup approach (`background-simple.js` + `popup.html`). Only the popup approach is active. The context menu code should be removed or clearly marked as experimental/unused.
- `options.html` loading `options.js` and functioning as an alternative popup suggests these files evolved from the popup. Consider consolidating the UI into a single well-maintained file or clearly separating concerns.
- No `chrome.storage` is used anywhere. If future enhancements (whitelist, auto-mute) are added, storage architecture will need to be designed from scratch.

---

## Issue Priority Summary

| # | Severity | Issue |
|---|---|---|
| 1 | Critical | `background.js` is never loaded — dead code |
| 2 | Critical | `contextMenus` permission missing for `background.js` |
| 3 | Critical | XSS via unescaped tab titles in `popup.js` |
| 4 | High | Duplicate `onInstalled` listener in `background.js` |
| 5 | High | Tab scan logic triplicated across three files |
| 6 | High | `options.html` is not an options page |
| 7 | Medium | Unreachable code path in `options.js:displayResults` |
| 8 | Medium | Service worker throttle variable resets on sleep |
| 9 | Low | `parseInt` missing radix |
| 10 | Low | Popup closes on mute with no user feedback |
| 11 | Low | `activeTab` permission is redundant |
| 12 | Low | `favIconUrl` collected but never displayed |
| 13 | Low | Tab ID falsy check imprecise |
| 14 | Info | README documents non-existent features |
