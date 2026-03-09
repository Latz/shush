// Popup script for Shush! extension

let displayedTabs = [];

async function checkSessionNonce() {
  if (!chrome.storage?.session) {
    // session storage unavailable (e.g. Vivaldi) — skip nonce check.
    // loadSavedTabs() verifies each tab via chrome.tabs.get(), so closed/invalid tabs
    // from previous sessions are naturally filtered out without needing explicit cleanup.
    return;
  }
  const { sessionNonce } = await chrome.storage.session.get('sessionNonce');
  const storedNonce = localStorage.getItem('shush_session_nonce');
  if (!sessionNonce || sessionNonce !== storedNonce) {
    localStorage.removeItem('shush_saved_tabs');
    localStorage.setItem('shush_session_nonce', sessionNonce ?? '');
  }
}

async function loadSavedTabs() {
  const raw = localStorage.getItem('shush_saved_tabs');
  if (!raw) return [];
  try {
    const saved = JSON.parse(raw);
    const results = await Promise.allSettled(
      saved.map(entry => chrome.tabs.get(entry.tabId))
    );
    return results
      .map((result, i) => ({ result, entry: saved[i] }))
      .filter(({ result, entry }) => result.status === 'fulfilled' && entry.muted)
      .map(({ result, entry }) => ({
        ...result.value,
        // Use saved muted state — live mutedInfo is unreliable in Vivaldi
        mutedInfo: { muted: entry.muted }
      }));
  } catch {
    return [];
  }
}

function renderTabs(noisyTabsList) {
  displayedTabs = noisyTabsList;
  const content = document.getElementById('content');
  content.innerHTML = '';
  noisyTabsList.forEach(tab => {
    const cleanTitle = tab.title.replace(/^\(\d+\)\s*/, '');
    const tabTitle = cleanTitle.length > 30 ? cleanTitle.substring(0, 27) + '...' : cleanTitle;

    const item = document.createElement('div');
    item.className = 'tab-item';

    if (tab.favIconUrl) {
      const img = document.createElement('img');
      img.className = 'tab-favicon';
      img.src = tab.favIconUrl;
      img.addEventListener('error', () => { img.remove(); });
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
    switchBtn.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
      window.close();
    });
    actions.appendChild(switchBtn);

    const muteBtn = document.createElement('button');
    muteBtn.className = tab.muted ? 'unmute-btn' : 'mute-btn';
    muteBtn.textContent = tab.muted ? 'Unshush!' : 'Shush!';
    muteBtn.addEventListener('click', async () => {
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
    });
    actions.appendChild(muteBtn);

    item.appendChild(actions);
    content.appendChild(item);
  });
}

async function loadNoisyTabs() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('popupScanning')}</div>`;

  try {
    await checkSessionNonce();

    const [audibleTabs, [currentActiveTab], savedMutedTabs] = await Promise.all([
      chrome.tabs.query({ audible: true }),
      chrome.tabs.query({ active: true, currentWindow: true }),
      loadSavedTabs(),
    ]);

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

    const allTabs = [...displayedAudible, ...savedFiltered];

    // Handle different scenarios
    if (totalAudioTabs === 0 && allTabs.length === 0) {
      displayedTabs = [];
      content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('noAudio')}</div>`;
    } else if (allTabs.length === 0 && totalAudioTabs > 0) {
      displayedTabs = [];
      content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('audioCurrentTab')}</div>`;
    } else {
      renderTabs(allTabs);
    }
  } catch (error) {
    console.error('Error loading noisy tabs:', error);
    content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('errorLoadTabs')}</div>`;
  }
}

window.addEventListener('unload', () => {
  const toSave = displayedTabs.map(tab => ({
    tabId: tab.id,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    muted: tab.muted,
  }));
  localStorage.setItem('shush_saved_tabs', JSON.stringify(toSave));
});

// Load tabs when popup opens
document.addEventListener('DOMContentLoaded', loadNoisyTabs);
