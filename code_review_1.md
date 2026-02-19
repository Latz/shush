# Code Review 1 — Where's the Noise (Chrome Extension)

**Date:** 2026-02-19
**Scope:** Context menu feature (commits `27fd948` → `daf36a8`)
**Files reviewed:** `background-simple.js`, `manifest.json`

---

## Summary

The context menu feature is largely solid. Proactive menu updates on audio state changes, correct MV3 patterns, and good defensive improvements over the original plan (radix-10 parseInt, `Number.isFinite` guard, `lastFocusedWindow` query). Two critical issues require fixing before this can be considered complete.

---

## Critical Issues

### 1. `scanAndShowResults` shows "All quiet!" when only the current tab is audible

**File:** `background-simple.js` — `scanAndShowResults`

The original plan specified three notification states:
1. Zero audible tabs → "No tabs are playing audio. All quiet!"
2. Audible tabs, but only from the current tab → "All audio is coming from the current tab."
3. Background noisy tabs → rebuild menu

During refactoring to add `isCurrentTab` support, the `totalAudioTabs` counter was removed. Now the current tab is included in `noisyTabsList` with `isCurrentTab: true`. When only the current tab is audible, `noisyTabsList` is non-empty (it contains the current tab), so the menu is rebuilt — but when the user clicks "Find Noisy Tabs" manually with no *other* tabs playing, `noisyTabsList.length === 0` fires the "All quiet!" notification, which is factually wrong.

**Fix:** Restore the `totalAudioTabs` counter and re-introduce the three-state branch in `scanAndShowResults`.

---

### 2. `showNoisyTabsInMenu` resolves its Promise before `contextMenus.create` calls complete

**File:** `background-simple.js` — `showNoisyTabsInMenu`

`resolve()` is called immediately after all `contextMenus.create` calls are *queued*, not after they *complete*. This works by accident because Chrome serialises these operations internally — but it is not guaranteed and creates a latent race condition. Additionally, `resolve()` is indented at a different level to the surrounding code, making it visually look like it is outside the `removeAll` callback:

```js
    noisyTabsList.forEach((tab) => { ... });

      resolve();      // ← misleading indent; is actually inside removeAll callback
    });
  });
```

**Fix:** Fix the indentation. Optionally add a comment clarifying that Chrome serialises these operations and `resolve()` is intentionally called after all creates are queued.

---

## Important Issues

### 3. `url` field stored in tab objects but never used

**File:** `background-simple.js` — both `updateMenuSilently` and `scanAndShowResults`

```js
noisyTabsList.push({
  id: tab.id,
  title: tab.title || 'Untitled',
  url: tab.url,       // never referenced anywhere
  muted: tab.mutedInfo?.muted || false,
  isCurrentTab: ...
});
```

`url` is captured in both scan functions but never consumed in `showNoisyTabsInMenu` or anywhere else. Dead data — remove from both push sites.

---

### 4. Redundant `chrome.tabs.get` before `tabs.update` in switch handler

**File:** `background-simple.js` — `onClicked` listener

```js
chrome.tabs.get(tabId, (t) => {
  if (t) chrome.tabs.update(tabId, { active: true });
});
```

`chrome.tabs.update` on a non-existent tab already fails gracefully via `chrome.runtime.lastError`. The `tabs.get` round-trip is unnecessary and `chrome.runtime.lastError` from the `tabs.get` call itself is not checked.

**Fix:** Remove the `tabs.get` wrapper; call `tabs.update` directly and check `chrome.runtime.lastError` in a callback if error visibility is needed.

---

## Suggestions

### 5. Duplicate scan logic between `updateMenuSilently` and `scanAndShowResults`

Both functions perform identical `chrome.tabs.query` calls and build `noisyTabsList` the same way. A shared `buildNoisyTabsList()` helper would prevent the two copies from drifting.

### 6. No default `else` branch in `onClicked`

The handler covers `find-noisy-tabs`, `-switch`, `-mute`. An explicit `else { /* no-op */ }` or comment would document intent for unhandled IDs (e.g. the `(current tab)` label item, which has no sub-items and is not clickable as an action).

### 7. `console.log` statements throughout

Present at startup, tab close, and audio state change events. Fine for development; worth removing or gating behind a debug flag before any distribution.

---

## What Was Done Well

- Event listeners registered at the top of the file before all other code — correct MV3 pattern
- `chrome.tabs.query({ active: true, lastFocusedWindow: true })` instead of `chrome.windows.getCurrent()` — meaningful improvement; `getCurrent` is unreliable in service workers
- `parseInt(..., 10)` radix and `Number.isFinite(tabId) && tabId > 0` guard — better than the plan's `if (tabId)`
- `scheduleMenuUpdate` uses its own `menuUpdateTimeout` variable, independent of `badgeUpdateTimeout`
- Service worker restart limitation documented in a comment above `showNoisyTabsInMenu`
- `contextMenus` permission correctly declared in manifest
- All `contextMenus.create` calls have `chrome.runtime.lastError` callbacks

---

## Issue Priority Summary

| # | Severity | Issue |
|---|----------|-------|
| 1 | Critical | `scanAndShowResults` shows "All quiet!" when only current tab is audible |
| 2 | Critical | `showNoisyTabsInMenu` resolves Promise before creates complete; misleading indentation |
| 3 | Important | `url` field in tab objects is dead data — never consumed |
| 4 | Important | Redundant `tabs.get` before `tabs.update` in switch handler |
| 5 | Suggestion | Duplicate scan logic between `updateMenuSilently` and `scanAndShowResults` |
| 6 | Suggestion | No default `else` branch in `onClicked` |
| 7 | Suggestion | `console.log` statements remain in production code |
