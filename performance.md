# Performance Review — Shush! (2026-09-29)

Scope: full pass over `background.js`, `popup.js`, `shared/media-mute.js` and `manifest.json` on `master` @ `2c3a06a` (1.0.1). The previous review (2026-08-11) closed six items; since then the code gained a `restored` gate, an `updateAll`/`scanAndShowResults` write queue, `menuSnapshot`, the popup session-nonce logic and `pagehide` saves. This pass covers that new code and the remaining hot paths.

## Verdict

Healthy. All 08-11 fixes are present and correct (observer scoped to `addedNodes`, conditional `query({})`, 1 s re-inject cooldown, popup derives audible tabs from `allTabs`, fragment rendering, gated menu diff). No regressions. Nothing here is user-visible at typical scale (2–6 noisy tabs); the findings are wasted storage writes, IPC and serial awaits.

## Findings

### 1. `tabs.onRemoved` writes storage for every closed tab — Medium
`background.js:252-260`. The listener runs `shushMutedTabs.delete(tabId); saveShushMutedTabs();` unconditionally. `delete` returns `false` for nearly every close (the tab was never shush-muted), yet each close still does a `chrome.storage.local.set` and a `scheduleUpdate()`. Closing a window of 50 tabs means 50 storage writes.
**Fix:** `if (shushMutedTabs.delete(tabId)) saveShushMutedTabs();`. Keep `scheduleUpdate()`, since a closed audible tab leaves the menu.

### 2. Popup open has three serial stages — Low–Medium
`popup.js:213-225`. `checkSessionNonce()` awaits `session.get`, then `local.get`, then possibly `local.remove`/`local.set`; only then does the parallel batch start (which itself reads `shush_saved_tabs`). This is the path the user waits on.
**Fix:** move the nonce reads into the one `Promise.all`, decide staleness in memory, and do the `remove`/`set` fire-and-forget after render.

### 3. Mute All fans out N messages — Low–Medium
`popup.js:137-145` sends N `muteTab` messages. Each in `background.js:14-31` does `tabs.update`, an all-frames `executeScript` and a `storage.local.set`; only `scheduleUpdate` is debounced. The "coalesces internally" claim on `saveShushMutedTabs` is unverified, so treat the N writes as real.
**Fix:** add a batch `muteTabs` action: one set update, one save, one scheduled update.

### 4. Redundant snapshot reset in `handleMuteToggle` — Low
`background.js:178-186`. `lastMenuSnapshot = null` is redundant because `muted` is already in the fingerprint, and `applyMenuDiff` then updates the same label the immediate `contextMenus.update` just set. One extra IPC per toggle. Keep the immediate update (instant feedback); the reset can go. Not worth a standalone change.

### 5. Full-tab query on every activation while anything is muted — Low
`background.js:292` → `fetchNoisyData` (305-316). With one shush-muted tab, each tab switch serializes every open tab (matters at 150+ tabs), debounced at 150 ms. Alternative: `query({audible:true})` plus `tabs.get` per id in `shushMutedTabs` (bounded by the muted count, usually 1–3). Only worth it if heavy-tab users report jank. Same idea applies to `popup.js:222`.

### 6. Popup saves state redundantly — Low
`saveTabState` (`popup.js:287`) runs on render, on each mute click and on `pagehide`: 2–4 `storage.local.set` calls per popup session, usually with an identical payload. **Fix:** remember the last serialized payload and skip identical writes. The eager saves themselves are correct (see the comment at `popup.js:282`).

### 7. Injected payload — no action
`shared/media-mute.js`. The prototype `muted` patch stays installed after unmute, adding one function-call layer per `.muted` access for the tab's life; negligible. The observer runs only while muted and is disconnected on unmute. `querySelectorAll` per added root is proportional to inserted content.

### 8. Service worker lifecycle — no action
Listeners register synchronously at top level; `restored` is a single `storage.get` per wake; the `onUpdated` filter (`['audible','status']`) is applied. `status: 'loading'` still wakes the callback twice per navigation and cannot be filtered further. The 150 ms `setTimeout` in `scheduleUpdate` does not keep the worker alive, so a shutdown inside that window drops one update — a staleness risk, not a cost.

### 9. Package weight — no action
Icons ~16 KB, CSS 2.8 KB, no bundled dependencies, no content scripts, host permissions already narrowed to `http(s)`.

## Summary

| # | Finding | File | Priority |
|---|---------|------|----------|
| 1 | Storage write on every tab close | `background.js:252` | Medium |
| 2 | Serial awaits before popup batch | `popup.js:213` | Low–Med |
| 3 | Mute All = N messages / N writes | `popup.js:137` | Low–Med |
| 4 | Redundant snapshot reset | `background.js:178` | Low |
| 5 | Full-tab query on every activation | `background.js:305` | Low |
| 6 | Redundant `saveTabState` writes | `popup.js:287` | Low |
| 7–9 | Injected payload, SW lifecycle, package size | — | None |

**Suggested follow-up:** do #1 and #2 (small diffs, clear win); #3 if Mute All is a common flow; skip #4–#6 unless touching those functions anyway.

## Appendix: closed in the 2026-08-11 review

1. `MutationObserver` scoped to `addedNodes` instead of a full-document rescan.
2. `fetchNoisyData` issues `query({})` only when something is shush-muted.
3. `reinjectMediaMute` with a 1 s per-tab cooldown on the `audible` path.
4. Popup derives audible tabs from `allTabs` (one fewer query).
5. `renderTabs` builds into a `DocumentFragment`.
6. Context menu diffs in place when the tab set is unchanged (`canDiffMenu` / `applyMenuDiff`).

Still open from that review: `menuSnapshot()` omits tab titles, so a title-only change does not refresh the menu. This is a correctness quirk rather than a performance one.
