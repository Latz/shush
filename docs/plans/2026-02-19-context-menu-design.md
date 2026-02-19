# Context Menu Feature Design

**Date:** 2026-02-19
**Status:** Approved

## Summary

Add a right-click context menu as an additional access point to the extension's noisy-tab scanning functionality. The popup remains the primary UI; the context menu is a complementary entry point.

## Files Changed

| File | Change |
|---|---|
| `manifest.json` | Add `"contextMenus"` to `permissions` |
| `background-simple.js` | Add context menu registration, scan logic, click handler |
| `background.js` | Delete (dead code) |

## Scan Logic

Ported directly from `popup.js`. Runs when the user clicks "Find Noisy Tabs" in the context menu.

Queries all tabs across all windows, identifies the active tab of the current window, then applies three-state logic:

1. **0 audible tabs** → notification: "No tabs playing audio. All quiet!"
2. **Audible tabs only from current tab** → notification: "All audio is coming from the current tab."
3. **1+ background noisy tabs** → dynamic menu rebuild

The current window's active tab is excluded from the noisy list, matching popup.js behaviour exactly.

## Context Menu Structure

**Initial state:**
```
Find Noisy Tabs
```

**After scan with multiple noisy tabs:**
```
Find Noisy Tabs
─────────────────
Tab Title One
  ├─ Switch to Tab
  └─ Mute Tab
Tab Title Two
  ├─ Switch to Tab
  └─ Unmute Tab
─────────────────
Close Menu
```

- Mute/Unmute label reflects the tab's mute state at scan time.
- "Close Menu" restores the initial single-item state.
- No post-action feedback needed after Switch or Mute — the user is done.
