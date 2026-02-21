// Popup script for Shush extension

async function loadNoisyTabs() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="no-tabs">Scanning for noisy tabs...</div>';

  try {
    const [allTabs, currentWindow] = await Promise.all([
      chrome.tabs.query({}),
      chrome.windows.getCurrent()
    ]);
    // Get the current window's active tab from the already-fetched allTabs
    const currentActiveTab = allTabs.find(t => t.active && t.windowId === currentWindow.id);

    // Check each tab for audio
    const noisyTabsList = [];
    let totalAudioTabs = 0;

    for (const tab of allTabs) {
      // Skip tabs without URLs (like chrome:// pages)
      if (!tab.url || !tab.url.startsWith('http')) continue;

      const isAudible = tab.audible;
      const isActiveInCurrentWindow = currentActiveTab && tab.id === currentActiveTab.id;

      if (isAudible) {
        totalAudioTabs++;
        if (!isActiveInCurrentWindow) {
          noisyTabsList.push({
            id: tab.id,
            title: tab.title || 'Untitled',
            url: tab.url,
            favIconUrl: tab.favIconUrl || '',
            muted: tab.mutedInfo?.muted || false
          });
        }
      }
    }

    // Handle different scenarios
    if (totalAudioTabs === 0) {
      content.innerHTML = '<div class="no-tabs">No tabs are playing audio. All quiet!</div>';
    } else if (noisyTabsList.length === 0) {
      content.innerHTML = '<div class="no-tabs">All audio is coming from the current tab.</div>';
    } else {
      // Show noisy tabs
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
          img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
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
        switchBtn.textContent = 'Switch';
        switchBtn.addEventListener('click', () => {
          chrome.tabs.update(tab.id, { active: true });
          window.close();
        });
        actions.appendChild(switchBtn);

        const muteBtn = document.createElement('button');
        muteBtn.className = tab.muted ? 'unmute-btn' : 'mute-btn';
        muteBtn.textContent = tab.muted ? 'Unmute' : 'Mute';
        muteBtn.addEventListener('click', async () => {
          const nowMuted = !tab.muted;
          try {
            // Delegate mute to background service worker to avoid popup-context revert
            const response = await chrome.runtime.sendMessage({ action: 'muteTab', tabId: tab.id, muted: nowMuted });
            const actuallyMuted = response?.muted ?? nowMuted;
            tab.muted = actuallyMuted;
            muteBtn.textContent = actuallyMuted ? 'Unmute' : 'Mute';
            muteBtn.className = actuallyMuted ? 'unmute-btn' : 'mute-btn';
          } catch (err) {
            console.error('Mute failed:', err);
          }
        });
        actions.appendChild(muteBtn);

        item.appendChild(actions);
        content.appendChild(item);
      });
    }
  } catch (error) {
    console.error('Error loading noisy tabs:', error);
    content.innerHTML = '<div class="no-tabs">Error loading tabs. Please try again.</div>';
  }
}

// Load tabs when popup opens
document.addEventListener('DOMContentLoaded', loadNoisyTabs);
