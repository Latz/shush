# Projects Register

> Load when a specific project is being discussed.
> Contains: project state, goals, key decisions, blockers, stakeholders.

<!-- Add entries as: ## [Project Name] with subheadings for Status, Goals, Decisions, Blockers -->

## Shush! (Chrome Extension MV3)

- **Status**: v1.0.0 released (2026-03-04); GitHub repo at https://github.com/Latz/shush ^tr6a1f8c3e9d
- **confidence**: high
- **evidence**: GitHub repo created and v1.0.0 release tagged 2026-03-04; previously stable at `a472dcf` (2026-02-21)
- **last_verified**: 2026-03-04

### What was built
Context menu feature added to `background.js` (active service worker):
- Proactive menu updates on audio state changes (`tabs.onUpdated`, `onRemoved`, `onActivated`)
- Audible tabs listed with Switch/Mute sub-items
- Currently active tab shown as plain `(current tab)` label — no sub-items
- Current tab detected via `chrome.tabs.query({ active: true, lastFocusedWindow: true })` (not `getCurrent` — unreliable in service workers)
- Manual "Find Noisy Tabs" click still works with notifications
- `buildNoisyTabsList()` shared helper; no dead fields; no console.log; else comment in onClicked

### Key files
- `background.js` — service worker (context menu)
- `popup.js` / `popup.html` — popup UI (separate, unchanged)
- `manifest.json` — MV3, permissions: tabs, notifications, activeTab, windows, contextMenus
