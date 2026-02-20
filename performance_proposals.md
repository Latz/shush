# Performance Proposals

Four concrete propositions, ranked by impact.

---

## 1. Merge badge and menu into a single update pass (High impact)

`scheduleBadgeUpdate()` and `scheduleMenuUpdate()` are independent debounced timers. When `tabs.onUpdated` or `tabs.onRemoved` fires, both are scheduled, each firing its own `chrome.tabs.query({})` after 500ms. That's two full tab queries per event.

Replace both with a single `scheduleUpdate()` that queries once and drives both the badge count and the menu rebuild in one pass. Halves `tabs.query` calls in the common case.

---

## 2. Parallelise independent queries in `buildNoisyTabsList` and the popup (High impact)

In `buildNoisyTabsList` (`background-simple.js`, lines 127–128):
```js
const allTabs = await chrome.tabs.query({});                                // IPC call 1
const [currentActiveTab] = await chrome.tabs.query({ active: true, ... }); // IPC call 2 — waits for 1
```
Both queries are independent. Running them with `Promise.all` cuts wall-clock time roughly in half.

Same issue in `popup.js` (lines 9–12):
```js
const allTabs = await chrome.tabs.query({});
const currentWindow = await chrome.windows.getCurrent({ populate: true }); // waits for allTabs
```
Again independent — `Promise.all` applies here too.

---

## 3. Drop `populate: true` in the popup's `getCurrent` call (Medium impact)

`chrome.windows.getCurrent({ populate: true })` fetches full tab objects for every tab in the current window — but `allTabs` already contains all of that data. The only thing needed from `currentWindow` is its `id`, to identify which tab is active in this window. Dropping `populate: true` makes the call lightweight, then find the active tab with:
```js
const currentActiveTab = allTabs.find(t => t.active && t.windowId === currentWindow.id);
```

---

## 4. Use `onUpdated` event filter instead of filtering in JS (Medium impact)

```js
// Current — browser invokes callback for every tab property change, JS filters:
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.audible !== undefined) { ... }
});

// Better — browser filters before invoking JS at all:
chrome.tabs.onUpdated.addListener(handler, { properties: ['audible'] });
```

MV3 supports declarative event filters. The browser skips the JS callback entirely for irrelevant updates (URL changes, title changes, loading state, etc.), reducing unnecessary service worker wake-ups — which is particularly valuable since the service worker has a startup cost.

---

## Not worth it: incremental context menu updates

`showNoisyTabsInMenu` does a full `removeAll` + rebuild every time. Diffing against previous state and using `contextMenus.update()` on changed items would save a few IPC calls, but the Chrome context menu API serialises all operations anyway, the item count is small (typically 2–6 tabs), and the added state-tracking complexity outweighs the gain.
