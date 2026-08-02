// Popup script for Shush! extension

const tabDataMap = new Map();

/**
 * Detects a new browser session and clears stale saved tabs when one is found.
 * Skipped silently on browsers (e.g. Vivaldi) that don't support chrome.storage.session.
 * @returns {Promise<void>}
 */
async function checkSessionNonce() {
  if (!chrome.storage?.session) {
    // session storage unavailable (e.g. Vivaldi) — skip nonce check.
    // loadSavedTabs() verifies each tab via tabById, so closed/invalid tabs
    // from previous sessions are naturally filtered out without needing explicit cleanup.
    return;
  }
  const { sessionNonce } = await chrome.storage.session.get('sessionNonce');
  const { shush_session_nonce: storedNonce } = await chrome.storage.local.get('shush_session_nonce');
  if (!sessionNonce || sessionNonce !== storedNonce) {
    await chrome.storage.local.remove('shush_saved_tabs');
    chrome.storage.local.set({ shush_session_nonce: sessionNonce ?? '' });
  }
}

/**
 * Filters persisted muted tabs to those still open in the current browser session.
 * Uses the shared tabById Map to avoid extra chrome.tabs.get IPC calls.
 * @param {{shush_saved_tabs?: Array<{tabId: number, muted: boolean}>}} savedData
 * @param {Map<number, chrome.tabs.Tab>} tabById
 * @returns {Array<chrome.tabs.Tab & {mutedInfo: {muted: boolean}}>}
 */
function loadSavedTabs(savedData, tabById) {
  const saved = savedData.shush_saved_tabs;
  if (!saved) return [];
  return saved
    .filter(entry => entry.muted && tabById.has(entry.tabId))
    .map(entry => ({
      ...tabById.get(entry.tabId),
      // Use saved muted state — live mutedInfo is unreliable in Vivaldi
      mutedInfo: { muted: entry.muted }
    }));
}

/**
 * Replaces #content with a tab item for each entry in noisyTabsList.
 * Populates tabDataMap so the delegated click listener can resolve tab objects by ID.
 * @param {Array<{id: number, windowId: number, title: string, favIconUrl: string, muted: boolean}>} noisyTabsList
 */
function renderTabs(noisyTabsList) {
  tabDataMap.clear();
  noisyTabsList.forEach(tab => { tabDataMap.set(tab.id, tab); });

  const content = document.getElementById('content');
  content.innerHTML = '';
  noisyTabsList.forEach(tab => {
    const cleanTitle = tab.title.replace(/^\(\d+\)\s*/, '');
    const tabTitle = cleanTitle.length > 30 ? cleanTitle.substring(0, 27) + '...' : cleanTitle;

    const item = document.createElement('div');
    item.className = 'tab-item';
    item.dataset.tabId = tab.id;

    if (tab.favIconUrl) {
      const img = document.createElement('img');
      img.className = 'tab-favicon';
      img.src = tab.favIconUrl;
      item.appendChild(img);
    }

    const titleDiv = document.createElement('div');
    titleDiv.className = 'tab-title';
    titleDiv.title = cleanTitle;
    titleDiv.textContent = tabTitle;
    item.appendChild(titleDiv);

    const actions = document.createElement('div');
    actions.className = 'tab-actions';

    const switchBtn = document.createElement('button');
    switchBtn.className = 'switch-btn';
    switchBtn.textContent = chrome.i18n.getMessage('btnSwitch');
    actions.appendChild(switchBtn);

    const muteBtn = document.createElement('button');
    muteBtn.className = tab.muted ? 'unmute-btn' : 'mute-btn';
    muteBtn.textContent = tab.muted ? 'Unshush!' : 'Shush!';
    actions.appendChild(muteBtn);

    item.appendChild(actions);
    content.appendChild(item);
  });
}

/**
 * Entry point called on DOMContentLoaded.
 * Fetches audible, saved, and context-menu-muted tabs in parallel, then renders them.
 * @returns {Promise<void>}
 */
async function loadNoisyTabs() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('popupScanning')}</div>`;

  try {
    await checkSessionNonce();

    const [audibleTabs, [currentActiveTab], allTabs, bgMutedIds, savedData] = await Promise.all([
      chrome.tabs.query({ audible: true }),
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.tabs.query({}),
      chrome.runtime.sendMessage({ action: 'getShushMutedTabs' }).catch(() => []),
      chrome.storage.local.get('shush_saved_tabs'),
    ]);

    // Single map covering all open tabs — used instead of N individual chrome.tabs.get calls
    const tabById = new Map(allTabs.map(t => [t.id, t]));
    const savedMutedTabs = loadSavedTabs(savedData, tabById);

    const bgMutedTabs = bgMutedIds
      .map(id => tabById.get(id))
      .filter(Boolean);

    const activeTabId = currentActiveTab?.id;

    // Build the audible list (existing logic)
    const displayedAudible = [];
    let totalAudioTabs = 0;
    for (const tab of audibleTabs) {
      if (!tab.url?.startsWith('http')) continue;
      totalAudioTabs++;
      if (tab.id !== activeTabId) {
        displayedAudible.push({
          id: tab.id,
          windowId: tab.windowId,
          title: tab.title || chrome.i18n.getMessage('untitled'),
          url: tab.url,
          favIconUrl: tab.favIconUrl || '',
          muted: tab.mutedInfo?.muted || false
        });
      }
    }

    // Add saved muted tabs not already in the audible list and not the active tab
    const audibleIds = new Set(displayedAudible.map(t => t.id));
    const savedFiltered = savedMutedTabs
      .filter(tab => !audibleIds.has(tab.id) && tab.id !== activeTabId && tab.url?.startsWith('http'))
      .map(tab => ({
        id: tab.id,
        windowId: tab.windowId,
        title: tab.title || chrome.i18n.getMessage('untitled'),
        url: tab.url,
        favIconUrl: tab.favIconUrl || '',
        muted: tab.mutedInfo?.muted || false
      }));

    // Add context-menu-muted tabs not already shown and not the active tab
    const savedIds = new Set(savedFiltered.map(t => t.id));
    const bgMutedFiltered = bgMutedTabs
      .filter(tab => !audibleIds.has(tab.id) && !savedIds.has(tab.id) && tab.id !== activeTabId && tab.url?.startsWith('http'))
      .map(tab => ({
        id: tab.id,
        windowId: tab.windowId,
        title: tab.title || chrome.i18n.getMessage('untitled'),
        url: tab.url,
        favIconUrl: tab.favIconUrl || '',
        muted: true
      }));

    const allDisplayedTabs = [...displayedAudible, ...savedFiltered, ...bgMutedFiltered];

    // Handle different scenarios
    if (totalAudioTabs === 0 && allDisplayedTabs.length === 0) {
      tabDataMap.clear();
      content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('noAudio')}</div>`;
    } else if (allDisplayedTabs.length === 0 && totalAudioTabs > 0) {
      tabDataMap.clear();
      content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('audioCurrentTab')}</div>`;
    } else {
      renderTabs(allDisplayedTabs);
    }
  } catch (error) {
    console.error('Error loading noisy tabs:', error);
    content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('errorLoadTabs')}</div>`;
  }
}

window.addEventListener('unload', () => {
  const toSave = [...tabDataMap.values()].map(tab => ({
    tabId: tab.id,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    muted: tab.muted,
  }));
  chrome.storage.local.set({ shush_saved_tabs: toSave });
});

/**
 * Reads the Vivaldi-specific workspace ID off a tab, if present.
 * Undocumented field (vivExtData); absent entirely on Chrome, so this is a natural no-op there.
 * Normalizes to Number since Vivaldi has been observed reporting the same ID as either an int or a float.
 * @param {chrome.tabs.Tab} tab
 * @returns {number|null}
 */
function getVivaldiWorkspaceId(tab) {
  if (!tab?.vivExtData) return null;
  try {
    const id = JSON.parse(tab.vivExtData)?.workspaceId;
    return id === undefined || id === null ? null : Number(id);
  } catch {
    return null;
  }
}

/**
 * Activates a tab and focuses its window. On Vivaldi, if the tab belongs to a different
 * Workspace than the one currently shown, the tab becomes active per the API but stays
 * hidden (Workspaces are a UI-only filter with no extension API to switch) — in that case
 * also shows a notification explaining why nothing visibly changed.
 * @param {number} tabId
 * @param {number} windowId
 * @returns {Promise<void>}
 */
async function switchToTab(tabId, windowId) {
  const target = await chrome.tabs.get(tabId).catch(() => null);
  if (target) {
    const [activeInWindow] = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
    if (target.vivExtData || activeInWindow?.vivExtData) {
      const targetWorkspace = getVivaldiWorkspaceId(target);
      const activeWorkspace = getVivaldiWorkspaceId(activeInWindow);
      if (targetWorkspace !== activeWorkspace) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: "Shush!",
          message: chrome.i18n.getMessage('tabInOtherWorkspace')
        });
      }
    }
  }
  chrome.tabs.update(tabId, { active: true });
  chrome.windows.update(windowId, { focused: true });
}

document.addEventListener('DOMContentLoaded', () => {
  const content = document.getElementById('content');

  content.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-tab-id]');
    if (!item) return;
    const tab = tabDataMap.get(Number(item.dataset.tabId));
    if (!tab) return;

    if (e.target.closest('.switch-btn')) {
      await switchToTab(tab.id, tab.windowId);
      window.close();
    } else {
      const muteBtn = e.target.closest('.mute-btn, .unmute-btn');
      if (!muteBtn) return;
      const nowMuted = !tab.muted;
      // Update UI immediately; correct below if background returns a different state
      tab.muted = nowMuted;
      muteBtn.textContent = nowMuted ? 'Unshush!' : 'Shush!';
      muteBtn.className = nowMuted ? 'unmute-btn' : 'mute-btn';
      try {
        // Delegate mute to background service worker to avoid popup-context revert
        const response = await chrome.runtime.sendMessage({ action: 'muteTab', tabId: tab.id, muted: nowMuted });
        const actuallyMuted = response?.muted ?? nowMuted;
        if (actuallyMuted !== nowMuted) {
          tab.muted = actuallyMuted;
          muteBtn.textContent = actuallyMuted ? 'Unshush!' : 'Shush!';
          muteBtn.className = actuallyMuted ? 'unmute-btn' : 'mute-btn';
        }
      } catch (err) {
        console.error('Mute failed:', err);
        // Revert optimistic update on error
        tab.muted = !nowMuted;
        muteBtn.textContent = tab.muted ? 'Unshush!' : 'Shush!';
        muteBtn.className = tab.muted ? 'unmute-btn' : 'mute-btn';
      }
    }
  });

  // Capture phase: error events don't bubble, so use capture to handle favicon load failures
  content.addEventListener('error', (e) => {
    if (e.target.matches('.tab-favicon')) e.target.remove();
  }, true);

  loadNoisyTabs();
});
