# Projects Register

> Load when a specific project is being discussed.
> Contains: project state, goals, key decisions, blockers, stakeholders.

<!-- Add entries as: ## [Project Name] with subheadings for Status, Goals, Decisions, Blockers -->

## Shush! (Chrome Extension MV3)

- **Status**: stable at commit `a472dcf` (2026-02-21) ^tr150155e1bf
- **confidence**: high
- **evidence**: all 7 issues from code_review_1.md resolved; extension renamed from "Where's the Noise" to "Shush!" ^tr3b7e6a0d5f
- **last_verified**: 2026-02-21

### What was built
Context menu feature added to `background-simple.js` (active service worker):
- Proactive menu updates on audio state changes (`tabs.onUpdated`, `onRemoved`, `onActivated`)
- Audible tabs listed with Switch/Mute sub-items
- Currently active tab shown as plain `(current tab)` label — no sub-items
- Current tab detected via `chrome.tabs.query({ active: true, lastFocusedWindow: true })` (not `getCurrent` — unreliable in service workers)
- Manual "Find Noisy Tabs" click still works with notifications
- `buildNoisyTabsList()` shared helper; no dead fields; no console.log; else comment in onClicked

### Key files
- `background-simple.js` — service worker (badge + context menu)
- `popup.js` / `popup.html` — popup UI (separate, unchanged)
- `manifest.json` — MV3, permissions: tabs, notifications, activeTab, windows, contextMenus
