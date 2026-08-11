# Performance Review — Shush! (2026-08-11)

Scope: full pass over `background.js` and `popup.js` on `master` @ `886f1f1`, cross-checked against `performance_review_2026-08-02.md`, `performance_review.md` (2026-03-07) and `performance_proposals.md`. Four commits have landed since the last review (`5614715`, `3c6caab`, `2d48fbf`, `886f1f1`); `3c6caab` closed the top finding from that pass, `886f1f1` added new code that has not been reviewed before.

## Verdict

The 08-02 top finding (N × `chrome.tabs.get()` in `fetchNoisyData`) is **fixed** and the fix is sound — N+2 IPC round-trips collapsed to 2. No regressions. Two items carry forward unchanged, and three new items surfaced, all in the "wasted work / scaling ceiling" category rather than anything user-visible at typical scale (2–6 noisy tabs).

The most valuable remaining changes, in order: **throttle the injected `MutationObserver`** (still the only finding that burns time inside the *user's* page), **make `fetchNoisyData`'s full-tab query conditional** (the `3c6caab` fix left a strictly-better variant on the table), and **drop the redundant popup query** (the same pattern `3c6caab` applied to the background, not yet applied to the popup's user-perceived path).

---

## Findings

### 1. Injected `MutationObserver` does an unthrottled full-page `querySelectorAll` on every mutation batch
**File:** `background.js:62-67` — *carried forward from 2026-08-02 #2, unchanged*

```js
if (!globalThis.__shushObserver) {
  globalThis.__shushObserver = new MutationObserver(() => {
    document.querySelectorAll('audio, video').forEach(el => { el.muted = true; });
  });
  globalThis.__shushObserver.observe(document.documentElement, { childList: true, subtree: true });
}
```

The observer watches the entire document subtree for any `childList` change — not scoped to media-relevant mutations — and on every batch re-runs a full `document.querySelectorAll('audio, video')` traversal of the whole page, once per frame (`allFrames: true`). On a normal page this fires rarely and is imperceptible. On DOM-churny pages *while muted* — infinite-scroll feeds, live chat, SPA dashboards re-rendering — every unrelated mutation (a new chat message, a list re-render) re-triggers a document-wide element scan. Native `MutationObserver` microtask batching collapses bursts into one callback per batch, but a churny page still produces many batches per second.

This runs inside the user's page, not the extension's own budget, but it is attributable to Shush! and lands on exactly the class of site the extension is most used on (video/audio-heavy sites that are also DOM-heavy — YouTube live chat, Twitch).

Two independent, low-effort mitigations:
- **Coalesce**: set a `pending` flag and do the rescan once in a `queueMicrotask`/`requestAnimationFrame` instead of synchronously per batch.
- **Filter first**: walk `mutation.addedNodes` and only rescan when an added node is (or contains) an `audio`/`video` element — most batches would then cost a cheap node-type check and nothing else.

The property-descriptor patch on `HTMLMediaElement.prototype.muted` (`background.js:45-55`) already covers the "existing element gets un-muted by page script" case, so the observer's only job is *newly added* elements — which makes the `addedNodes` filter the more precise fix of the two.

**Priority: Medium.** No cost at typical usage, degrades per-mutation on a specific and predictable class of page.

---

### 2. `fetchNoisyData` queries every tab unconditionally, even when nothing is shush-muted
**File:** `background.js:298-305` — *new*

```js
async function fetchNoisyData() {
  const [allTabs, [currentActiveTab]] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
  ]);
  const noisyTabs = allTabs.filter(t => t.audible || shushMutedTabs.has(t.id));
  return { noisyTabs, currentActiveTab };
}
```

`3c6caab` correctly traded N+2 IPC calls for 2 by replacing the per-muted-tab `chrome.tabs.get()` fan-out with a single `chrome.tabs.query({})`. That is the right call whenever `shushMutedTabs` is non-empty. But the query is now unconditional, and `chrome.tabs.query({})` serializes a full `Tab` object per open tab — `title`, `url`, `favIconUrl`, `mutedInfo`, and the rest — across the extension messaging boundary. For a user with 150+ tabs open and *nothing* shush-muted, this is a materially larger payload than the `chrome.tabs.query({ audible: true })` it replaced, and it runs on every `scheduleUpdate()` tick: tab activation, tab close, and every `audible`/`status` change.

The refinement keeps both wins:

```js
const [audibleTabs, allTabs, [currentActiveTab]] = await Promise.all([
  chrome.tabs.query({ audible: true }),
  shushMutedTabs.size > 0 ? chrome.tabs.query({}) : Promise.resolve(null),
  chrome.tabs.query({ active: true, lastFocusedWindow: true })
]);
const noisyTabs = allTabs
  ? allTabs.filter(t => t.audible || shushMutedTabs.has(t.id))
  : audibleTabs;
```

Still 2–3 IPC calls, never N, and the common idle case (nothing muted) pays only for the audible tabs. Note this makes the *count* of calls 3 in the muted case, so if the goal is strictly minimal call count rather than minimal payload, the alternative is to keep the single `query({})` and accept the payload — the tradeoff is IPC round-trips vs. bytes serialized. Given `scheduleUpdate()` is debounced at 150 ms, payload is the more relevant axis.

**Priority: Medium.** Small diff, no behaviour change, strictly better payload profile for heavy-tab users.

---

### 3. `injectMediaMute` re-injects across all frames on every audible transition
**File:** `background.js:263-285` (listener) → `background.js:36-75` (injection) — *new*

```js
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && shushMutedTabs.has(tabId)) {
    injectMediaMute(tabId, true);
  }
  if (changeInfo.audible !== undefined) {
    scheduleUpdate();
    if (changeInfo.audible === true && shushMutedTabs.has(tabId)) {
      injectMediaMute(tabId, true);
    }
  }
}, { properties: ['audible', 'status'] });
```

For a shush-muted tab, *every* transition to `audible: true` fires a fresh `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', ... })`. A page whose audio starts and stops repeatedly — ad breaks, silence gaps between tracks, a video player that pauses on scroll — produces a stream of these transitions, and each one re-injects and re-executes the function in **every frame** of the tab, re-running `document.querySelectorAll('audio, video')` per frame.

The injected function is idempotent — it guards on `globalThis.__shushMutedDescriptor` and `globalThis.__shushObserver`, so repeat injections don't stack observers or double-wrap the property descriptor — so this is wasted work, not a correctness bug. But the injection machinery itself (frame enumeration, script serialization, per-frame execution context setup) is not free, and it scales with frame count on ad-heavy pages, which are precisely the pages that flip audible most often.

The re-injection exists for a real reason: the header comment notes mute is lost on page load in Vivaldi, and `audible: true` on an already-muted tab is a signal the page has escaped the mute. So it cannot simply be removed. Options:
- Skip when the page reports it is already handling it — have the injected function return `globalThis.__shushActive`, and only re-inject on `audible` when the previous injection didn't take.
- Per-tab cooldown: track `lastInject.get(tabId)` and skip if injected within the last ~1 s. Simplest, and the `status === 'complete'` path would naturally suppress the immediately-following `audible` re-inject.

**Priority: Medium.** Bounded and invisible on a well-behaved page; grows with frame count × audible-transition frequency.

---

### 4. `popup.js` runs two overlapping tab queries where one suffices
**File:** `popup.js:137-146` — *new*

```js
const [audibleTabs, [currentActiveTab], allTabs, bgMutedIds, savedData] = await Promise.all([
  chrome.tabs.query({ audible: true }),
  chrome.tabs.query({ active: true, currentWindow: true }),
  chrome.tabs.query({}),
  chrome.runtime.sendMessage({ action: 'getShushMutedTabs' }).catch(() => []),
  chrome.storage.local.get('shush_saved_tabs'),
]);
```

`chrome.tabs.query({ audible: true })` and `chrome.tabs.query({})` are both awaited in the same `Promise.all`, and the first is a strict subset of the second — `audibleTabs` is fully derivable as `allTabs.filter(t => t.audible)`, and `tabById` is already built from `allTabs` on the next line. This is the same redundancy `3c6caab` removed from `background.js`; it just wasn't applied here. Dropping it takes the popup from 5 concurrent IPC operations to 4.

Because the calls are parallel, the saving is throughput rather than latency — but this is the popup-open path, the one place in the extension where the user is actively waiting on a render, and `content.innerHTML` sits on the "Scanning…" placeholder until all five settle. Worth taking on the visible path.

**Priority: Low–Medium.** One-line change, no behaviour difference.

---

### 5. `renderTabs` appends DOM nodes one at a time without batching
**File:** `popup.js:78-123` — *carried forward from 2026-08-02 #4, unchanged*

Each tab item and its 4–6 child nodes (favicon, title div, switch button, mute button) are created with `document.createElement` and appended directly into `content`, which stays attached to the live DOM throughout (`content.innerHTML = ''` clears its children but does not detach the container itself). Building into a `DocumentFragment` and appending once would remove any per-item reflow cost.

At the popup's realistic scale (1–10 tabs) this is not measurable. **Nit-level; not worth a dedicated change** unless this function is being touched for another reason.

---

### 6. Full `removeAll()` + menu rebuild per update cycle
**File:** `background.js:419-465` — *carried forward from 2026-08-02 #3, unchanged; no action*

Still as analyzed and correctly deprioritized in `performance_proposals.md` ("Not worth it: incremental context menu updates"): up to `3N + 2` serialized `contextMenus.create` calls per debounce cycle, where N = noisy tab count. At 2–6 tabs this is negligible, and diffing would add more complexity than it saves. The `lastMenuSnapshot` fingerprint (`background.js:117-119`) already makes no-op cycles free, which is the part that actually mattered.

Noted only as a documented scaling ceiling — a user habitually running 20+ audible/muted tabs would see linear growth here, still bounded by the 150 ms debounce and Chrome's own serialization. **No action recommended.**

---

## Closed since 2026-08-02

### ✅ Finding #1 — N × `chrome.tabs.get()` in `fetchNoisyData` — fixed in `3c6caab`

The old code fired one `chrome.tabs.get()` per shush-muted tab (N+2 IPC round-trips total). Current implementation:

```js
const [allTabs, [currentActiveTab]] = await Promise.all([
  chrome.tabs.query({}),
  chrome.tabs.query({ active: true, lastFocusedWindow: true })
]);
const noisyTabs = allTabs.filter(t => t.audible || shushMutedTabs.has(t.id));
```

Two IPC calls regardless of how many tabs are muted, with the audible and shush-muted sets both derived locally from one result — exactly the `tabById` pattern `popup.js:146` already used, as the last review recommended. Confirmed fixed. See finding #2 above for the remaining refinement, which is a payload optimization on top of this, not a reopening of the original issue.

### Still-valid closures from `performance_review.md` (2026-03-07)

Re-verified, no change since the 08-02 pass:
- **Fallback listener guard clause** (`background.js:276-284`) — the existing structure already short-circuits correctly; an explicit guard would be redundant. No change needed.
- **Console statements** — all 10 remaining `console.*` calls are `console.error`/`console.debug` on genuine error or fallback paths; none in a hot loop or per-event path. No change needed.
- **Proposals #1 / #2 / #4** (merge badge+menu update, parallelize independent queries, declarative event filter) — shipped, confirmed present in `fetchNoisyData` and the `{ properties: ['audible', 'status'] }` listener.
- **Proposal #3** (drop `populate: true`) — moot; `popup.js` never calls `chrome.windows.getCurrent()`.

---

## Noticed but out of scope (not performance)

- **`switchToTab` and `getVivaldiWorkspaceId` are duplicated verbatim** between `background.js:157-197` and `popup.js:238-276` (introduced in `886f1f1`). No runtime cost — the two extra IPC calls happen on an explicit user click, where they're free — but the two copies will drift. A shared module would be the natural fix if either is touched again.
- **`popup.js:221` uses `window.addEventListener('unload', ...)`** to persist `shush_saved_tabs`. `unload` is deprecated and not reliably fired; `pagehide` (or `visibilitychange` → `hidden`) is the modern replacement and fires reliably on popup dismissal. This is a reliability issue with the save, not a performance one.
- **CSS: no findings.** `popup.css` uses custom-property tokens with a `prefers-color-scheme` override block, flat single-class selectors, and one non-looping `@keyframes shush-pop` on `h3`. No layout thrash, no expensive selectors, no animated layout properties (`color` only). Clean.

---

## Summary

| # | Finding | File | Priority | Status |
|---|---------|------|----------|--------|
| 1 | Unthrottled `MutationObserver` full-DOM rescan | `background.js:62-67` | Medium | **Fixed 2026-08-11** |
| 2 | Unconditional `chrome.tabs.query({})` per update tick | `background.js:298-305` | Medium | **Fixed 2026-08-11** |
| 3 | Re-injection across all frames per audible transition | `background.js:263-285` | Medium | **Fixed 2026-08-11** |
| 4 | Redundant `audible` query alongside full query | `popup.js:137-146` | Low–Med | **Fixed 2026-08-11** |
| 5 | No `DocumentFragment` batching in `renderTabs` | `popup.js:78-123` | Nit | **Fixed 2026-08-11** |
| 6 | Full menu `removeAll()` + rebuild | `background.js:419-465` | — | **Fixed 2026-08-11** |

## Fixes applied (2026-08-11)

Findings 1–4 were implemented immediately after this review; line references above point at the pre-fix code. What shipped:

1. **Observer scoped to `addedNodes`** — the callback now walks `mutation.addedNodes` and mutes only nodes that are, or contain, `audio`/`video`. Batches with no media (the overwhelming majority on churny pages) cost a node-type check instead of a document-wide `querySelectorAll`. Safe because the `HTMLMediaElement.prototype.muted` patch already covers existing elements; the observer only ever needed to catch newly inserted ones.

2. **`fetchNoisyData` queries all tabs only when something is shush-muted** — base case is `chrome.tabs.query({ audible: true })`; the full `query({})` is issued conditionally on `shushMutedTabs.size > 0`, since resolving muted-and-therefore-inaudible tabs is the only thing that needs it. Idle ticks with nothing muted no longer serialize every open tab.

3. **`reinjectMediaMute(tabId)` with a 1 s per-tab cooldown** — applied to the `audible` path only. The `status === 'complete'` path still injects unconditionally: after a navigation the previous injection lived in the old document, so suppressing it there would leave a freshly-loaded page unmuted. `injectMediaMute` stamps `lastInjectAt`, so the re-inject that normally follows a page load is absorbed by the cooldown; `tabs.onRemoved` drops the entry.

4. **Popup derives `audibleTabs` from `allTabs`** — `allTabs.filter(t => t.audible)` replaces the second query, taking popup open from 5 concurrent IPC operations to 4. The test helper in `tests/unit/popup.test.js` was updated to match: audible fixtures are now merged into the `query({})` result with `audible: true` rather than served from a separate mock branch.

Findings 5 and 6 were then fixed as well, on request, despite both having been deprioritized above:

5. **`renderTabs` builds into a `DocumentFragment`** — items are assembled off-document and attached with a single `content.appendChild(fragment)`, one DOM mutation per render instead of one per tab. Nit-level as assessed; the change is three lines and carries no risk.

6. **Context menu diffs in place when the tab set is unchanged** — `canDiffMenu()` gates two paths. Same tab IDs in the same order → `applyMenuDiff()` updates only the parent label (on a mute or current-tab change), the mute item's label, and the Switch/Mute children when a tab becomes or stops being the current tab. Tabs added or removed → the existing `removeAll()` + rebuild, unchanged.

   The gating is what makes this safe, and it is why the earlier reviews and `performance_proposals.md` declined the general version: `chrome.contextMenus` exposes no reorder API, so a naive incremental update lets menu order drift away from tab order as items come and go. Restricting the diff to an unchanged tab set sidesteps that entirely — recreating a tab's own children only appends under that parent, leaving top-level order untouched. The scaling ceiling for a 20+ noisy-tab user is now paid only when tabs actually enter or leave the list, not on every mute toggle or tab switch.

   Supporting refactor: `tabMenuTitle()`, `muteItemTitle()` and `createTabChildItems()` are shared by both paths so they cannot drift, and `renderedTabs` (cleared *before* the async `removeAll()` on the empty path) tracks what the menu currently holds. Covered by `tests/unit/menuDiff.test.js`; `chrome.contextMenus.remove` was added to the test mock.

**Still open:** `menuSnapshot()` does not include tab titles, so a title-only change triggers no menu update at all — a renamed tab keeps its old label until something else changes. `applyMenuDiff` handles titles correctly if reached, but the snapshot early-return means it is not. Pre-existing behaviour, left as is.
