import { switchToTab } from './shared/vivaldi.js';
import { applyMediaMute } from './shared/media-mute.js';
import { cleanTabTitle, shortTitle, isWebTab } from './shared/tab-title.js';

// Handle mute requests from popup (avoids popup-context revert behaviour)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'muteTab') {
    const { tabId, muted } = message;
    if (!Number.isInteger(tabId) || tabId <= 0 || typeof muted !== 'boolean') {
      // Answer explicitly: returning without a response closes the port and surfaces
      // as a "message port closed" rejection in the sender rather than a result.
      sendResponse({ muted: false, error: 'invalid' });
      return;
    }
    (async () => {
      try {
        await restored;
        const actualMuted = await muteOneTab(tabId, muted);
        saveShushMutedTabs();
        scheduleUpdate();
        sendResponse({ muted: actualMuted });
      } catch {
        sendResponse({ muted });
      }
    })();
    return true; // keep channel open for async response
  }
  if (message?.action === 'muteTabs') {
    const { tabIds, muted } = message;
    if (!Array.isArray(tabIds) || tabIds.some(id => !Number.isInteger(id) || id <= 0)
        || typeof muted !== 'boolean') {
      sendResponse({ error: 'invalid' });
      return;
    }
    (async () => {
      await restored;
      // allSettled: one closed tab must not stop the rest. One save and one update for the
      // whole batch instead of one per tab.
      await Promise.allSettled(tabIds.map(id => muteOneTab(id, muted)));
      saveShushMutedTabs();
      scheduleUpdate();
      sendResponse({ ok: true });
    })();
    return true; // keep channel open for async response
  }
  if (message?.action !== 'getShushMutedTabs') {
    return;
  }

  // Must await `restored`: a message can be the very event that woke the worker, in which
  // case the set is still empty and the popup would render nothing as muted.
  restored.then(() => sendResponse([...shushMutedTabs])).catch(() => sendResponse([]));
  return true; // keep channel open for async response
});

/**
 * Mutes or unmutes one tab and records it in shushMutedTabs. Does not save or schedule an update:
 * callers do that once, so a batch costs one write instead of one per tab.
 * @param {number} tabId
 * @param {boolean} muted
 * @returns {Promise<boolean>} the mute state the browser reports afterwards.
 */
async function muteOneTab(tabId, muted) {
  const tab = await chrome.tabs.update(tabId, { muted });
  const actualMuted = tab.mutedInfo?.muted ?? muted;
  injectMediaMute(tabId, actualMuted);
  if (actualMuted) {
    shushMutedTabs.add(tabId);
  } else {
    shushMutedTabs.delete(tabId);
  }
  return actualMuted;
}

// Timestamp of the last injection per tab, used by reinjectMediaMute to skip redundant
// re-injections. Entries are dropped in tabs.onRemoved.
const lastInjectAt = new Map();
// The injected prototype patch and observer already hold the mute, so a re-run only helps
// for frames added since; 10 s is plenty for that and keeps a tab that flips `audible` every
// few seconds from re-running the script in every frame each time.
const REINJECT_COOLDOWN_MS = 10_000;

/**
 * Injects a content script (main world) that mutes/unmutes all audio and video elements in a tab.
 * While muting, also patches HTMLMediaElement.prototype.muted so the page's own scripts can't
 * un-mute an existing element, and installs a MutationObserver so newly added media stays muted.
 * Records the injection time so reinjectMediaMute can suppress redundant follow-ups.
 * @param {number} tabId
 * @param {boolean} muted
 */
function injectMediaMute(tabId, muted) {
  lastInjectAt.set(tabId, Date.now());
  chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    // MAIN world so the .muted property patch inside applyMediaMute applies to the page's own
    // scripts, not just the extension's isolated world.
    world: 'MAIN',
    // Serialized to source and re-evaluated in the page, so applyMediaMute must stay
    // self-contained — see the note at the top of shared/media-mute.js.
    func: applyMediaMute,
    args: [muted]
  }).catch(() => {}); // silently ignore restricted pages (chrome://, PDFs, etc.)
}

/**
 * Re-applies the mute injection to an already-shush-muted tab, skipping calls that land within
 * REINJECT_COOLDOWN_MS of the previous injection for the same tab. A muted tab can flip `audible`
 * many times a minute (ad breaks, silence gaps) and every injection re-runs the script in every
 * frame; the injected function is idempotent, so a re-inject that just happened adds nothing.
 * Only for the audible path — navigation ('complete') must always re-inject, since the previous
 * injection lived in the old document.
 * @param {number} tabId
 */
function reinjectMediaMute(tabId) {
  if (Date.now() - (lastInjectAt.get(tabId) ?? 0) < REINJECT_COOLDOWN_MS) return;
  injectMediaMute(tabId, true);
}

// Tabs muted via the context menu — kept visible in the menu even after muting
// makes them non-audible. Cleared when unmuted or tab closed.
const shushMutedTabs = new Set();

/**
 * Persists shushMutedTabs to chrome.storage.local.
 * Deliberately un-debounced: a pending setTimeout does not keep an MV3 service worker
 * alive, so a deferred write can be dropped entirely when Chrome terminates the worker
 * between the mute and the flush. chrome.storage.local.set already coalesces internally.
 * @returns {Promise<void>}
 */
function saveShushMutedTabs() {
  // Callers are listeners that have nothing useful to do about a failed write, so the
  // rejection is logged here rather than left to become an unhandled rejection at each site.
  return chrome.storage.local.set({ shush_muted_tabs: [...shushMutedTabs] })
    .catch(error => { console.error('Failed to persist muted tabs:', error); });
}

// Restore persisted muted-tab IDs when the service worker restarts.
// Chrome dispatches the event that woke the worker as soon as top-level evaluation
// finishes — i.e. before this get() resolves — so every entry point that reads or writes
// shushMutedTabs must await this promise first. Without it, an early tabs.onRemoved would
// call saveShushMutedTabs() on a still-empty set and wipe the persisted state.
const restored = (async () => {
  const result = await chrome.storage.local.get('shush_muted_tabs');
  if (Array.isArray(result?.shush_muted_tabs)) {
    // Storage is an external input: keep only well-formed tab IDs.
    result.shush_muted_tabs.filter(id => Number.isInteger(id) && id > 0).forEach(id => shushMutedTabs.add(id));
  }
})().catch((error) => {
  // Must never reject: every entry point awaits this, and most of them are listeners with
  // no try/catch, so a rejected `restored` would silently disable mute tracking for the
  // whole life of the worker. Losing the persisted set degrades to an empty one instead.
  console.error('Failed to restore muted tabs:', error);
});

// Session-storage flag marking a scheduled update that has not finished yet.
const UPDATE_PENDING_KEY = 'shush_update_pending';

// Single debounced update replacing scheduleBadgeUpdate + scheduleMenuUpdate
let updateTimeout;
let updatePending = false;

/** Best-effort session-storage write; absent (e.g. Vivaldi) or failing storage just loses the recovery. */
function setUpdatePendingFlag(pending) {
  const session = chrome.storage.session;
  if (!session) return;
  const op = pending ? session.set({ [UPDATE_PENDING_KEY]: true }) : session.remove(UPDATE_PENDING_KEY);
  Promise.resolve(op).catch(() => {});
}

/**
 * Queues a context menu rebuild; resets the timer on each call (150 ms debounce).
 * A pending setTimeout does not keep an MV3 service worker alive, so a worker terminated inside
 * the debounce window would silently drop the update. The pending state is therefore mirrored to
 * session storage and replayed on the next worker start (see recoverPendingUpdate).
 */
function scheduleUpdate() {
  clearTimeout(updateTimeout);
  if (!updatePending) {
    updatePending = true;
    setUpdatePendingFlag(true);
  }
  // 150ms: snapshot diffing in updateAll makes no-op calls near-free, so debounce can be short
  updateTimeout = setTimeout(async () => {
    updatePending = false;
    try {
      await updateAll();
    } catch (error) {
      console.error('Scheduled update failed:', error);
    } finally {
      // A schedule that arrived while the update ran owns the flag now; only clear it if none did.
      if (!updatePending) setUpdatePendingFlag(false);
    }
  }, 150);
}

/** Runs once per worker start: replays an update the previous worker was killed before running. */
async function recoverPendingUpdate() {
  try {
    const result = await chrome.storage.session?.get(UPDATE_PENDING_KEY);
    const pending = result?.[UPDATE_PENDING_KEY];
    if (pending) scheduleUpdate();
  } catch {
    // storage.session unavailable — nothing to recover
  }
}
recoverPendingUpdate();

// Snapshot of the last menu render — used to skip redundant full rebuilds
// null, not '': an empty noisy-tab list snapshots to the empty string, so a string sentinel
// would compare equal to it and suppress the reset to the basic menu on a fresh worker.
let lastMenuSnapshot = null;

/**
 * Produces a stable string fingerprint of the current noisy-tab list.
 * Used by updateAll to skip context menu rebuilds when nothing has changed.
 * @param {Array<{id: number, muted: boolean, isCurrentTab: boolean}>} noisyTabsList
 * @returns {string}
 */
function menuSnapshot(noisyTabsList) {
  // join over JSON.stringify: the result is only ever compared to the previous one, so the
  // serialization round-trip bought nothing. '|' cannot occur in the fields being joined.
  return noisyTabsList.map(t => `${t.id}:${t.muted}:${t.isCurrentTab}`).join('|');
}

/**
 * Reports whether a tab currently reads as muted, from Shush!'s perspective.
 * Must match the `muted` field buildNoisyTabsList puts on the menu: shushMutedTabs alone is
 * not enough, because a tab the user muted with the browser's own tab mute is labelled
 * "Unmute Tab" but absent from our set — toggling on the set alone would then mute it again.
 * shushMutedTabs is still consulted first, since Vivaldi does not reliably update mutedInfo.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function isTabMuted(tabId) {
  if (shushMutedTabs.has(tabId)) return true;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return tab?.mutedInfo?.muted ?? false;
}

/**
 * Toggles the mute state of a tab triggered from the context menu.
 * Updates shushMutedTabs, flips the menu item label immediately, then schedules a full rebuild.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function handleMuteToggle(tabId) {
  await restored;
  const nowMuted = !(await isTabMuted(tabId));
  const tab = await chrome.tabs.update(tabId, { muted: nowMuted }).catch(() => null);
  if (!tab) return; // tab closed while we were resolving its state — nothing to track
  injectMediaMute(tabId, nowMuted);
  // Track tabs muted via context menu so updateAll() keeps them in the menu
  // (muting makes a tab non-audible, so without tracking it disappears)
  if (nowMuted) {
    shushMutedTabs.add(tabId);
  } else {
    shushMutedTabs.delete(tabId);
  }
  saveShushMutedTabs();
  // Flip the mute item label immediately; scheduleUpdate() will do the full rebuild
  chrome.contextMenus.update(`noisy-tab-${tabId}-mute`, {
    title: nowMuted
      ? `🔊 ${chrome.i18n.getMessage('menuUnmuteTab')}`
      : `🔇 ${chrome.i18n.getMessage('menuMuteTab')}`
  }).catch(() => {}); // item may not exist if menu hasn't been expanded
  // Invalidate snapshot so the next updateAll() forces a full rebuild
  lastMenuSnapshot = null;
  scheduleUpdate();
}

// Matches the per-tab action items built by createTabChildItems. [1-9]\d* encodes
// "positive integer" directly, so no separate range check on the parsed id is needed.
const TAB_MENU_ITEM_ID = /^noisy-tab-([1-9]\d*)-(switch|mute)$/;

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "find-noisy-tabs") {
    scanAndShowResults();
    return;
  }
  // menuItemId is string|number per the API, and only our own string IDs are actionable.
  if (typeof info.menuItemId !== 'string') return;

  // One anchored match replaces the previous endsWith + double-replace + range-check per action.
  // The \d+ capture already rules out the non-numeric and negative IDs those checks guarded against.
  const action = TAB_MENU_ITEM_ID.exec(info.menuItemId);
  if (!action) return; // click on a noisy-tab-N parent label (current tab or background tab title)

  const tabId = Number(action[1]);
  try {
    if (action[2] === 'switch') {
      await switchToTab(tabId);
    } else {
      await handleMuteToggle(tabId);
    }
  } catch (error) {
    // e.g. the tab was closed between the menu render and the click
    console.error('Context menu action failed:', error);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-mute-current') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await handleMuteToggle(tab.id);
  } catch (error) {
    console.error('Mute shortcut failed:', error);
  }
});

// Background service worker for Shush! extension

chrome.runtime.onInstalled.addListener(() => {
  // Keys of the removed popup-side copy of the muted list; the background set is the only one now.
  chrome.storage.local.remove(['shush_saved_tabs', 'shush_session_nonce']).catch(() => {});
  // Menus do not survive an update or reload; the first update pass builds the base menu.
  updateAll();
});

chrome.runtime.onStartup.addListener(async () => {
  // Tab IDs are not stable across browser restarts: a persisted ID would now point at an
  // unrelated tab and show it as muted. Start every browser session with an empty set.
  await restored;
  if (shushMutedTabs.size > 0) {
    shushMutedTabs.clear();
    saveShushMutedTabs();
  }
  updateAll();
});

// Listen for tab close to update menu
chrome.tabs.onRemoved.addListener(async (tabId) => {
  lastInjectAt.delete(tabId);
  // Await the restore before deleting + saving, or a close that woke the worker would
  // persist an empty set over the real one.
  await restored;
  // Most closed tabs were never shush-muted; skip the storage write for those.
  if (shushMutedTabs.delete(tabId)) saveShushMutedTabs();
  scheduleUpdate();
});

// Track audio state and re-inject mute on navigation (mute is lost on page load in Vivaldi)
async function onTabUpdated(tabId, changeInfo) {
  await restored;
  if (changeInfo.status === 'complete' && shushMutedTabs.has(tabId)) {
    injectMediaMute(tabId, true);
  }
  // The user unmuted with the browser's own control (reason 'user'; our own updates report
  // 'extension'): forget the tab and release the page-level hold, or it would still read as
  // muted here and stay silenced in the page.
  if (changeInfo.mutedInfo?.muted === false && changeInfo.mutedInfo.reason === 'user'
      && shushMutedTabs.delete(tabId)) {
    saveShushMutedTabs();
    injectMediaMute(tabId, false);
  }
  if (changeInfo.audible !== undefined || changeInfo.mutedInfo !== undefined) scheduleUpdate();
  if (changeInfo.audible === true && shushMutedTabs.has(tabId)) {
    reinjectMediaMute(tabId);
  }
}

// Use declarative event filter where supported; fall back to JS-side check (e.g. Vivaldi)
try {
  // @ts-expect-error -- the event-filter argument is missing from @types/chrome; the catch below covers browsers that reject it
  chrome.tabs.onUpdated.addListener(onTabUpdated, { properties: ['audible', 'status', 'mutedInfo'] });
} catch (error) {
  console.debug('Event filter not supported, falling back to unfiltered listener:', error);
  chrome.tabs.onUpdated.addListener(onTabUpdated);
}

// Listen for tab activation to update menu
chrome.tabs.onActivated.addListener(() => {
  scheduleUpdate();
});

/**
 * Fetches the noisy tabs and the focused active tab, then derives the noisy-tab list locally.
 * Audible tabs come from the small audible-only query; shush-muted tabs (no longer audible once
 * muted) are fetched by ID — bounded by the muted count, usually 1-3 — instead of serialising
 * every open tab with chrome.tabs.query({}) on every tab switch. A muted ID that no longer
 * resolves is dropped (missed onRemoved, e.g. while the worker was down), so it can neither
 * linger in storage nor match a recycled ID.
 * Shared by updateAll and scanAndShowResults to avoid duplicate queries.
 * @returns {Promise<{noisyTabs: chrome.tabs.Tab[], currentActiveTab: chrome.tabs.Tab|undefined}>}
 */
async function fetchNoisyData() {
  await restored; // shushMutedTabs picks the lookups below
  const [audibleTabs, [currentActiveTab], mutedLookups] = await Promise.all([
    chrome.tabs.query({ audible: true }),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    Promise.all([...shushMutedTabs].map(id =>
      chrome.tabs.get(id).then(tab => ({ id, tab }), () => ({ id, tab: null }))))
  ]);

  const byId = new Map(audibleTabs.map(t => [t.id, t]));
  let pruned = false;
  for (const { id, tab } of mutedLookups) {
    if (!tab) {
      shushMutedTabs.delete(id);
      lastInjectAt.delete(id);
      pruned = true;
    } else if (!byId.has(tab.id)) {
      byId.set(tab.id, tab);
    }
  }
  if (pruned) saveShushMutedTabs();
  // Same order query({}) gave: by window, then position, so a muted tab that turns audible
  // again does not jump and force a menu rebuild.
  const noisyTabs = byId.values().toArray()
    .toSorted((x, y) => (x.windowId ?? 0) - (y.windowId ?? 0) || (x.index ?? 0) - (y.index ?? 0));
  return { noisyTabs, currentActiveTab };
}

// Serializes every menu mutation. updateAll and scanAndShowResults are both async and both
// rebuild the menu, and nothing stops a debounced update from overlapping a user-triggered
// scan — interleaving two removeAll + rebuild sequences would leave a mixed-up menu.
let menuWriteQueue = Promise.resolve();

/**
 * Runs `task` after any menu write already in flight has settled.
 * @param {() => Promise<void>} task
 * @returns {Promise<void>}
 */
function queueMenuWrite(task) {
  menuWriteQueue = menuWriteQueue.then(task, task);
  return menuWriteQueue;
}

/**
 * Updates the context menu to reflect the current set of noisy tabs.
 * Skips all work if the tab list and mute states match the previous render; otherwise rebuilds.
 * @returns {Promise<void>}
 */
function updateAll() {
  return queueMenuWrite(updateAllNow);
}

/** The body of updateAll; always run through queueMenuWrite, never called directly. */
async function updateAllNow() {
  try {
    const { noisyTabs, currentActiveTab } = await fetchNoisyData();
    const noisyTabsList = buildNoisyTabsList(noisyTabs, currentActiveTab);

    // Skip full rebuild when nothing visible changed (IPC-heavy operation)
    const snapshot = menuSnapshot(noisyTabsList);
    if (snapshot === lastMenuSnapshot) return;
    lastMenuSnapshot = snapshot;

    if (noisyTabsList.length === 0) {
      chrome.contextMenus.removeAll(createFindMenu);
    } else {
      await showNoisyTabsInMenu(noisyTabsList);
    }
  } catch (error) {
    console.error('Update error:', error);
  }
}

/**
 * Transforms raw tab objects into the display shape used by the menu and popup.
 * Pure function — reads shushMutedTabs but never mutates state.
 * @param {chrome.tabs.Tab[]} noisyTabs - Audible + shush-muted tabs, already deduped.
 * @param {chrome.tabs.Tab|undefined} currentActiveTab
 * @returns {Array<{id: number, title: string, muted: boolean, isCurrentTab: boolean}>}
 */
function buildNoisyTabsList(noisyTabs, currentActiveTab) {
  const noisyTabsList = [];
  for (const tab of noisyTabs) {
    if (!isWebTab(tab)) continue;
    noisyTabsList.push({
      id: tab.id,
      title: tab.title || chrome.i18n.getMessage('untitled'),
      muted: shushMutedTabs.has(tab.id) || tab.mutedInfo?.muted || false,
      isCurrentTab: tab.id === currentActiveTab?.id
    });
  }
  return noisyTabsList;
}

/**
 * Triggered by the "Find Noisy Tabs" menu item.
 * Shows a notification when there is nothing to act on, otherwise populates the menu.
 * @returns {Promise<void>}
 */
function scanAndShowResults() {
  return queueMenuWrite(scanAndShowResultsNow);
}

/** The body of scanAndShowResults; always run through queueMenuWrite. */
async function scanAndShowResultsNow() {
  try {
    const { noisyTabs, currentActiveTab } = await fetchNoisyData();
    const noisyTabsList = buildNoisyTabsList(noisyTabs, currentActiveTab);
    const backgroundNoisyTabs = noisyTabsList.filter(t => !t.isCurrentTab);

    if (noisyTabsList.length === 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: "Shush!",
        message: chrome.i18n.getMessage('noAudio')
      });
    } else if (backgroundNoisyTabs.length === 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: "Shush!",
        message: chrome.i18n.getMessage('audioCurrentTab')
      });
    } else {
      await showNoisyTabsInMenu(noisyTabsList);
    }
  } catch (error) {
    console.error('Scan error:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: "Shush!",
      message: chrome.i18n.getMessage('errorScanTabs')
    });
  }
}

// NOTE: Menu state is not persisted across service worker restarts. If the worker
// is killed while the menu is in its expanded state (after a scan), the menu will
// remain expanded until the user clicks "Find Noisy Tabs" again. This is an
// unavoidable consequence of storing menu state only in Chrome's context menu registry.
/** Passed as the callback to chrome.contextMenus.create/update; logs any lastError. */
function logContextMenuError() {
  if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError);
}

/** The collapsed menu: "Shush!" with a single "Find Noisy Tabs" child. */
function createFindMenu() {
  chrome.contextMenus.create({
    id: "shush-menu",
    title: "Shush!",
    contexts: ["all"]
  }, logContextMenuError);
  chrome.contextMenus.create({
    id: "find-noisy-tabs",
    parentId: "shush-menu",
    title: chrome.i18n.getMessage('menuFindNoisyTabs'),
    contexts: ["all"]
  }, logContextMenuError);
}

/**
 * Builds the parent menu label for a noisy tab: title, trimmed to 30 chars and stripped of any
 * leading notification count, plus the "(current tab)" and "(muted)" suffixes.
 * @param {{title: string, muted: boolean, isCurrentTab: boolean}} tab
 * @returns {string}
 */
function tabMenuTitle(tab) {
  const currentLabel = tab.isCurrentTab ? ` ${chrome.i18n.getMessage('menuCurrentTab')}` : '';
  const mutedLabel = tab.muted ? ` ${chrome.i18n.getMessage('menuMuted')}` : '';
  return `${shortTitle(cleanTabTitle(tab.title))}${currentLabel}${mutedLabel}`;
}

/**
 * Label for a tab's mute/unmute child item.
 * @param {{muted: boolean}} tab
 * @returns {string}
 */
function muteItemTitle(tab) {
  return tab.muted
    ? `🔊 ${chrome.i18n.getMessage('menuUnmuteTab')}`
    : `🔇 ${chrome.i18n.getMessage('menuMuteTab')}`;
}

/**
 * Creates the Switch/Mute child items under a tab's parent entry.
 * Only background tabs get them — the current tab is a plain label.
 * @param {{id: number, muted: boolean}} tab
 */
function createTabChildItems(tab) {
  const itemId = `noisy-tab-${tab.id}`;
  chrome.contextMenus.create({
    id: `${itemId}-switch`,
    parentId: itemId,
    title: `→ ${chrome.i18n.getMessage('menuSwitchToTab')}`,
    contexts: ["all"]
  }, logContextMenuError);

  chrome.contextMenus.create({
    id: `${itemId}-mute`,
    parentId: itemId,
    title: muteItemTitle(tab),
    contexts: ["all"]
  }, logContextMenuError);
}

/**
 * Clears the Shush! context menu and rebuilds it with one sub-tree per noisy tab.
 * Uses a Promise wrapper because chrome.contextMenus only exposes callback-style APIs.
 * @param {Array<{id: number, title: string, muted: boolean, isCurrentTab: boolean}>} noisyTabsList
 * @returns {Promise<void>}
 */
function showNoisyTabsInMenu(noisyTabsList) {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "shush-menu",
        title: "Shush!",
        contexts: ["all"]
      }, logContextMenuError);

      noisyTabsList.forEach((tab) => {
        chrome.contextMenus.create({
          id: `noisy-tab-${tab.id}`,
          parentId: "shush-menu",
          title: tabMenuTitle(tab),
          contexts: ["all"]
        }, logContextMenuError);

        if (!tab.isCurrentTab) createTabChildItems(tab);
      });

      // Record the fingerprint here rather than only in updateAll: scanAndShowResults renders
      // through this function too, and if it left lastMenuSnapshot stale, a later updateAll
      // could match the stale value and skip a rebuild the menu actually needed.
      lastMenuSnapshot = menuSnapshot(noisyTabsList);

      // Chrome serialises contextMenus operations within a single callback, so
      // resolve() is called after all creates have been queued and will execute
      // in order — no need to await each individual create.
      resolve();
    });
  });
}

export { buildNoisyTabsList, showNoisyTabsInMenu, scanAndShowResults, updateAll, shushMutedTabs, scheduleUpdate, fetchNoisyData, handleMuteToggle, restored };
// Re-exported for tests, which exercise the Vivaldi helpers through this module's surface.
export { getVivaldiWorkspaceId } from './shared/vivaldi.js';
