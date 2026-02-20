# Performance #2 — Parallel Queries Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace sequential `await` pairs for independent tab queries with `Promise.all`, cutting wall-clock query time roughly in half at every fetch point.

**Architecture:** Three surgical edits — two in `background-simple.js` (`updateAll` and `scanAndShowResults`) and one in `popup.js`. Each location issues two independent `chrome.tabs.query` / `chrome.windows.getCurrent` calls sequentially today; wrapping them in `Promise.all` lets the browser process both in parallel. No logic changes, only the fetch pattern changes.

**Tech Stack:** Chrome Extension MV3, `Promise.all`, service worker + popup context.

---

### Task 1: Parallelise queries in `background-simple.js`

**Files:**
- Modify: `background-simple.js`

Two functions each have a sequential await pair that can run in parallel.

**Step 1: Edit `updateAll` — lines 117–118**

Current:
```js
const allTabs = await chrome.tabs.query({});
const [currentActiveTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
```

Replace with:
```js
const [allTabs, [currentActiveTab]] = await Promise.all([
  chrome.tabs.query({}),
  chrome.tabs.query({ active: true, lastFocusedWindow: true })
]);
```

**Step 2: Edit `scanAndShowResults` — lines 166–167**

Current:
```js
const allTabs = await chrome.tabs.query({});
const [currentActiveTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
```

Replace with:
```js
const [allTabs, [currentActiveTab]] = await Promise.all([
  chrome.tabs.query({}),
  chrome.tabs.query({ active: true, lastFocusedWindow: true })
]);
```

**Step 3: Verify — no sequential query pairs remain in the file**

```bash
grep -n "await chrome.tabs.query" /mnt/d/ChromeExtensions/where-s-the-noise/background-simple.js
```

Expected: every `await chrome.tabs.query` line is inside a `Promise.all` array — none appear as bare consecutive `await` statements. The output should show the lines inside Promise.all calls only.

**Step 4: Commit**

```bash
cd /mnt/d/ChromeExtensions/where-s-the-noise
git add background-simple.js
git commit -m "perf: parallelise tab queries in updateAll and scanAndShowResults"
```

---

### Task 2: Parallelise queries in `popup.js`

**Files:**
- Modify: `popup.js`

**Step 1: Edit `loadNoisyTabs` — lines 9–12**

Current:
```js
const allTabs = await chrome.tabs.query({});

// Get the current window and its active tab
const currentWindow = await chrome.windows.getCurrent({ populate: true });
const currentActiveTab = currentWindow.tabs.find(t => t.active);
```

Replace with:
```js
const [allTabs, currentWindow] = await Promise.all([
  chrome.tabs.query({}),
  chrome.windows.getCurrent({ populate: true })
]);
// Get the current window's active tab
const currentActiveTab = currentWindow.tabs.find(t => t.active);
```

**Step 2: Verify**

```bash
grep -n "await chrome" /mnt/d/ChromeExtensions/where-s-the-noise/popup.js
```

Expected: no bare sequential `await chrome.tabs.query` / `await chrome.windows.getCurrent` calls — both are inside the `Promise.all`.

**Step 3: Commit**

```bash
cd /mnt/d/ChromeExtensions/where-s-the-noise
git add popup.js
git commit -m "perf: parallelise tab and window queries in popup"
```
