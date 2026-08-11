import { switchToTab } from './shared/vivaldi.js';

// Handle mute requests from popup (avoids popup-context revert behaviour)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'muteTab') {
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
        const tab = await chrome.tabs.update(tabId, { muted });
        const actualMuted = tab.mutedInfo?.muted ?? muted;
        injectMediaMute(tabId, actualMuted);
        if (actualMuted) {
          shushMutedTabs.add(tabId);
        } else {
          shushMutedTabs.delete(tabId);
        }
        saveShushMutedTabs();
        scheduleUpdate();
        sendResponse({ muted: actualMuted });
      } catch {
        sendResponse({ muted });
      }
    })();
    return true; // keep channel open for async response
  } else if (message.action === 'getShushMutedTabs') {
    // Must await `restored`: a message can be the very event that woke the worker, in which
    // case the set is still empty and the popup would render nothing as muted.
    restored.then(() => sendResponse([...shushMutedTabs]));
    return true; // keep channel open for async response
  }
});

// Timestamp of the last injection per tab, used by reinjectMediaMute to skip redundant
// re-injections. Entries are dropped in tabs.onRemoved.
const lastInjectAt = new Map();
const REINJECT_COOLDOWN_MS = 1000;

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
    world: 'MAIN', // required so the .muted property patch below applies to the page's own scripts, not just the extension's isolated world
    func: (m) => {
      // Intercept the page's own writes to .muted so a player that reuses an existing
      // element (e.g. Spotify/podcast players calling el.muted = false between tracks)
      // can't un-mute out from under us — closes the gap the MutationObserver below
      // can't cover, since that only reacts to new elements, not property writes on existing ones.
      const proto = HTMLMediaElement.prototype;
      if (!globalThis.__shushMutedDescriptor) {
        const desc = Object.getOwnPropertyDescriptor(proto, 'muted');
        globalThis.__shushMutedDescriptor = desc;
        Object.defineProperty(proto, 'muted', {
          configurable: true,
          get() { return desc.get.call(this); },
          set(v) { desc.set.call(this, globalThis.__shushActive ? true : v); }
        });
      }
      globalThis.__shushActive = m;

      document.querySelectorAll('audio, video').forEach(el => {
        el.muted = m;
        if (!m && el.paused && !el.ended) el.play().catch(() => {});
      });
      if (m) {
        if (!globalThis.__shushObserver) {
          // Only inspect nodes that were actually added, rather than re-scanning the whole
          // document per mutation batch: on churny pages (live chat, infinite scroll) the vast
          // majority of batches contain no media at all, and a full querySelectorAll per batch
          // is page-visible jank. Existing elements are already covered by the .muted patch above,
          // so newly inserted nodes are the only thing this observer needs to catch.
          globalThis.__shushObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.matches('audio, video')) {
                  node.muted = true;
                } else {
                  node.querySelectorAll('audio, video').forEach(el => { el.muted = true; });
                }
              }
            }
          });
          globalThis.__shushObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
      } else if (globalThis.__shushObserver) {
        globalThis.__shushObserver.disconnect();
        globalThis.__shushObserver = null;
      }
    },
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
  return chrome.storage.local.set({ shush_muted_tabs: [...shushMutedTabs] });
}

// Restore persisted muted-tab IDs when the service worker restarts.
// Chrome dispatches the event that woke the worker as soon as top-level evaluation
// finishes — i.e. before this get() resolves — so every entry point that reads or writes
// shushMutedTabs must await this promise first. Without it, an early tabs.onRemoved would
// call saveShushMutedTabs() on a still-empty set and wipe the persisted state.
const restored = (async () => {
  const result = await chrome.storage.local.get('shush_muted_tabs');
  if (Array.isArray(result?.shush_muted_tabs)) {
    result.shush_muted_tabs.forEach(id => shushMutedTabs.add(id));
  }
})();

// Single debounced update replacing scheduleBadgeUpdate + scheduleMenuUpdate
let updateTimeout;
/** Queues a context menu rebuild; resets the timer on each call (150 ms debounce). */
function scheduleUpdate() {
  clearTimeout(updateTimeout);
  // 150ms: snapshot diffing in updateAll makes no-op calls near-free, so debounce can be short
  updateTimeout = setTimeout(() => updateAll(), 150);
}

// Snapshot of the last menu render — used to skip redundant full rebuilds
let lastMenuSnapshot = '';

/**
 * Produces a stable string fingerprint of the current noisy-tab list.
 * Used by updateAll to skip context menu rebuilds when nothing has changed.
 * @param {Array<{id: number, muted: boolean, isCurrentTab: boolean}>} noisyTabsList
 * @returns {string}
 */
function menuSnapshot(noisyTabsList) {
  return JSON.stringify(noisyTabsList.map(t => `${t.id}:${t.muted}:${t.isCurrentTab}`));
}

/**
 * Toggles the mute state of a tab triggered from the context menu.
 * Updates shushMutedTabs, flips the menu item label immediately, then schedules a full rebuild.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function handleMuteToggle(tabId) {
  await restored;
  // Use shushMutedTabs as source of truth: Vivaldi doesn't reliably update mutedInfo
  const nowMuted = !shushMutedTabs.has(tabId);
  chrome.tabs.update(tabId, { muted: nowMuted }).catch(() => {}); // tab may have closed
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
  lastMenuSnapshot = '';
  scheduleUpdate();
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "find-noisy-tabs") {
    scanAndShowResults();
  } else if (info.menuItemId.endsWith("-switch")) {
    const tabId = Number.parseInt(info.menuItemId.replace("-switch", "").replace("noisy-tab-", ""), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      await switchToTab(tabId);
    }
  } else if (info.menuItemId.endsWith("-mute")) {
    const tabId = Number.parseInt(info.menuItemId.replace("-mute", "").replace("noisy-tab-", ""), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      await handleMuteToggle(tabId);
    }
  }
  // else: click on a noisy-tab-N parent label (current tab or background tab title) — no action
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-mute-current') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await handleMuteToggle(tab.id);
});

// Background service worker for Shush! extension

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "shush-menu",
    title: "Shush!",
    contexts: ["all"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error creating context menu:', chrome.runtime.lastError);
    }
  });
  chrome.contextMenus.create({
    id: "find-noisy-tabs",
    parentId: "shush-menu",
    title: chrome.i18n.getMessage('menuFindNoisyTabs'),
    contexts: ["all"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error creating context menu:', chrome.runtime.lastError);
    }
  });
  chrome.storage.session?.set({ sessionNonce: crypto.randomUUID() });
  updateAll();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session?.set({ sessionNonce: crypto.randomUUID() });
  updateAll();
});

// Listen for tab close to update menu
chrome.tabs.onRemoved.addListener(async (tabId) => {
  lastInjectAt.delete(tabId);
  // Await the restore before deleting + saving, or a close that woke the worker would
  // persist an empty set over the real one.
  await restored;
  shushMutedTabs.delete(tabId);
  saveShushMutedTabs();
  scheduleUpdate();
});

// Track audio state and re-inject mute on navigation (mute is lost on page load in Vivaldi)
// Use declarative event filter where supported; fall back to JS-side check (e.g. Vivaldi)
try {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    await restored;
    if (changeInfo.status === 'complete' && shushMutedTabs.has(tabId)) {
      injectMediaMute(tabId, true);
    }
    if (changeInfo.audible !== undefined) {
      scheduleUpdate();
      if (changeInfo.audible === true && shushMutedTabs.has(tabId)) {
        reinjectMediaMute(tabId);
      }
    }
  }, { properties: ['audible', 'status'] });
} catch (e) {
  console.debug('Event filter not supported, falling back to unfiltered listener:', e);
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    await restored;
    if (changeInfo.status === 'complete' && shushMutedTabs.has(tabId)) {
      injectMediaMute(tabId, true);
    }
    if (changeInfo.audible !== undefined) scheduleUpdate();
    if (changeInfo.audible === true && shushMutedTabs.has(tabId)) {
      reinjectMediaMute(tabId);
    }
  });
}

// Listen for tab activation to update menu
chrome.tabs.onActivated.addListener(() => {
  scheduleUpdate();
});

/**
 * Fetches the audible tabs and the focused active tab, then derives the noisy-tab list locally.
 * The full chrome.tabs.query({}) is only issued when something is shush-muted: it is the one way
 * to resolve muted (and therefore no longer audible) tabs without one chrome.tabs.get() per tab,
 * but it serializes every open tab, which is wasted payload on every scheduleUpdate() tick when
 * nothing is muted. Shared by updateAll and scanAndShowResults to avoid duplicate queries.
 * @returns {Promise<{noisyTabs: chrome.tabs.Tab[], currentActiveTab: chrome.tabs.Tab|undefined}>}
 */
async function fetchNoisyData() {
  await restored; // shushMutedTabs gates the full-query branch below
  const [audibleTabs, allTabs, [currentActiveTab]] = await Promise.all([
    chrome.tabs.query({ audible: true }),
    shushMutedTabs.size > 0 ? chrome.tabs.query({}) : Promise.resolve(null),
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
  ]);
  const noisyTabs = allTabs
    ? allTabs.filter(t => t.audible || shushMutedTabs.has(t.id))
    : audibleTabs;
  return { noisyTabs, currentActiveTab };
}

/**
 * Checks whether the menu can be updated in place rather than torn down and rebuilt:
 * the same tab IDs, in the same order, as what is currently rendered. Any insertion or removal
 * needs the full rebuild, since chrome.contextMenus offers no way to reorder existing items.
 * @param {Array<{id: number}>} noisyTabsList
 * @returns {boolean}
 */
function canDiffMenu(noisyTabsList) {
  return renderedTabs !== null
    && renderedTabs.length === noisyTabsList.length
    && renderedTabs.every((tab, i) => tab.id === noisyTabsList[i].id);
}

/**
 * Updates the context menu to reflect the current set of noisy tabs.
 * Skips all work if the tab list and mute states match the previous render; updates items in
 * place when only labels changed; falls back to a full rebuild when tabs were added or removed.
 * @returns {Promise<void>}
 */
async function updateAll() {
  try {
    const { noisyTabs, currentActiveTab } = await fetchNoisyData();
    const noisyTabsList = buildNoisyTabsList(noisyTabs, currentActiveTab);

    // Skip full rebuild when nothing visible changed (IPC-heavy operation)
    const snapshot = menuSnapshot(noisyTabsList);
    if (snapshot === lastMenuSnapshot) return;
    lastMenuSnapshot = snapshot;

    if (noisyTabsList.length === 0) {
      renderedTabs = null; // set before the async removeAll so a queued update can't diff against a stale menu
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
          id: "shush-menu",
          title: "Shush!",
          contexts: ["all"]
        }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });
        chrome.contextMenus.create({
          id: "find-noisy-tabs",
          parentId: "shush-menu",
          title: chrome.i18n.getMessage('menuFindNoisyTabs'),
          contexts: ["all"]
        }, () => { if (chrome.runtime.lastError) console.error('Context menu error:', chrome.runtime.lastError); });
      });
    } else if (canDiffMenu(noisyTabsList)) {
      applyMenuDiff(noisyTabsList);
      renderedTabs = noisyTabsList;
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
    if (!tab.url?.startsWith('http')) continue;
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
async function scanAndShowResults() {
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

/**
 * Builds the parent menu label for a noisy tab: title, trimmed to 30 chars and stripped of any
 * leading notification count, plus the "(current tab)" and "(muted)" suffixes.
 * @param {{title: string, muted: boolean, isCurrentTab: boolean}} tab
 * @returns {string}
 */
function tabMenuTitle(tab) {
  const cleanTitle = tab.title.replace(/^\(\d+\)\s*/, '');
  const tabTitle = cleanTitle.length > 30 ? cleanTitle.substring(0, 27) + '...' : cleanTitle;
  const currentLabel = tab.isCurrentTab ? ` ${chrome.i18n.getMessage('menuCurrentTab')}` : '';
  const mutedLabel = tab.muted ? ` ${chrome.i18n.getMessage('menuMuted')}` : '';
  return `${tabTitle}${currentLabel}${mutedLabel}`;
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

// What the menu currently shows, or null when it is not in the noisy-tab state (never built,
// or rebuilt as the empty "Find Noisy Tabs" menu). Gates the in-place diff in applyMenuDiff.
let renderedTabs = null;

/**
 * Updates the existing menu in place to match noisyTabsList, without a removeAll() + rebuild.
 * Only valid when the tab IDs are unchanged and in the same order — chrome.contextMenus has no
 * reorder API, so anything that would change positions has to go through the full rebuild instead.
 * @param {Array<{id: number, title: string, muted: boolean, isCurrentTab: boolean}>} noisyTabsList
 */
function applyMenuDiff(noisyTabsList) {
  const previousById = new Map(renderedTabs.map(t => [t.id, t]));

  for (const tab of noisyTabsList) {
    const previous = previousById.get(tab.id);
    const itemId = `noisy-tab-${tab.id}`;

    if (previous.muted !== tab.muted || previous.isCurrentTab !== tab.isCurrentTab || previous.title !== tab.title) {
      chrome.contextMenus.update(itemId, { title: tabMenuTitle(tab) }).catch(() => {});
    }

    if (previous.isCurrentTab !== tab.isCurrentTab) {
      // Became the current tab: drop its actions. Stopped being it: recreate them. Recreating
      // appends under this parent only, so sibling order at the top level is untouched.
      if (tab.isCurrentTab) {
        chrome.contextMenus.remove(`${itemId}-switch`).catch(() => {});
        chrome.contextMenus.remove(`${itemId}-mute`).catch(() => {});
      } else {
        createTabChildItems(tab);
      }
    } else if (!tab.isCurrentTab && previous.muted !== tab.muted) {
      chrome.contextMenus.update(`${itemId}-mute`, { title: muteItemTitle(tab) }).catch(() => {});
    }
  }
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

      renderedTabs = noisyTabsList;

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
